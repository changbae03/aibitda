import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import AdmZip from "adm-zip";
import { pool } from "@workspace/db";
import { loadKRXList, getKRXCache } from "../lib/krx-cache";
import { fetchInvestorData } from "../lib/pykrx-client";
import { setCorpCodeMap } from "../lib/dart-corp-cache.js";

const router = Router();

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

interface TrendingTheme {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

interface DiscoveredStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale: string;
  dartVerified?: boolean;
  dartIndustry?: string;
  dartBizMatch?: boolean | null; // true=사업보고서 키워드 일치, false=불일치, null=미캐시
}

interface DiscoverResult {
  theme: string;
  summary: string;
  stocks: DiscoveredStock[];
  invalid?: boolean;
  reason?: string;
}

// ─── DART 업종 검증 ─────────────────────────────────────────────────────────

let corpCodeMap: Map<string, string> | null = null;
let corpCodeCachedAt = 0;
const CORP_CODE_TTL = 24 * 60 * 60 * 1000;
let corpCodeLoading = false;

const CORP_CODE_CACHE_KEY = "dart_corp_code_map_v1";

async function saveCorpCodeMapToDB(map: Map<string, string>): Promise<void> {
  try {
    const data = JSON.stringify(Object.fromEntries(map));
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30일
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET data = $2, expires_at = $3`,
      [CORP_CODE_CACHE_KEY, data, expiresAt]
    );
    console.log(`[DART] corp code map DB 저장 완료: ${map.size}개`);
  } catch (e: any) {
    console.error("[DART] DB 저장 실패:", e.message);
  }
}

async function loadCorpCodeMapFromDB(): Promise<boolean> {
  try {
    // system_cache 테이블이 아직 없을 수 있으므로 먼저 생성
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);
    const r = await pool.query(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [CORP_CODE_CACHE_KEY]
    );
    if (!r.rows.length) {
      console.log("[DART] DB 캐시 없음 — 다운로드 필요");
      return false;
    }
    // pg는 JSONB 컬럼을 이미 객체로 파싱해서 반환
    const raw = r.rows[0].data;
    const obj: Record<string, string> = typeof raw === "string" ? JSON.parse(raw) : raw;
    corpCodeMap = new Map(Object.entries(obj));
    corpCodeCachedAt = Date.now();
    setCorpCodeMap(corpCodeMap);
    console.log(`[DART] corp code map DB 복원 완료: ${corpCodeMap.size}개`);
    return true;
  } catch (e: any) {
    console.error("[DART] DB 복원 실패:", e.message);
    return false;
  }
}

async function loadCorpCodeMap(): Promise<void> {
  if (corpCodeLoading) return;
  if (corpCodeMap && Date.now() - corpCodeCachedAt < CORP_CODE_TTL) return;

  const DART_KEY = process.env.DART_API_KEY;
  if (!DART_KEY) return;

  // 1) DB 캐시에서 먼저 복원 시도
  const restoredFromDB = await loadCorpCodeMapFromDB();
  if (restoredFromDB) return;

  // 2) DB 캐시 없으면 DART API에서 다운로드 (백그라운드, 타임아웃 없음)
  corpCodeLoading = true;
  try {
    console.log("[DART] corpCode.xml 다운로드 시작...");
    const resp = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${DART_KEY}`);
    if (!resp.ok) return;

    const buf = Buffer.from(await resp.arrayBuffer());
    const zip = new AdmZip(buf);
    const entry = zip.getEntries().find(e => e.entryName.endsWith(".xml"));
    if (!entry) return;

    const xml = entry.getData().toString("utf-8");
    const map = new Map<string, string>();
    for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
      const block = m[1];
      const cc = block.match(/<corp_code>(.*?)<\/corp_code>/)?.[1]?.trim();
      const sc = block.match(/<stock_code>\s*(.*?)\s*<\/stock_code>/)?.[1]?.trim();
      if (cc && sc && sc.length === 6) map.set(sc, cc);
    }

    corpCodeMap = map;
    corpCodeCachedAt = Date.now();
    setCorpCodeMap(map);
    console.log(`[DART] corp code map 로드 완료: ${map.size}개`);

    // 3) DB에 저장 (다음 재시작 때 즉시 복원)
    await saveCorpCodeMapToDB(map);
  } catch (e) {
    console.error("[DART] loadCorpCodeMap error:", e);
  } finally {
    corpCodeLoading = false;
  }
}

// 서버 기동 시 백그라운드에서 미리 로드
loadCorpCodeMap().catch(() => {});

function getCorpCodeMap(): Map<string, string> {
  return corpCodeMap ?? new Map();
}

// KSIC(한국표준산업분류) 코드 → 업종 레이블
const INDUTY_LABELS: Record<string, string> = {
  "21": "의약품", "210": "의약품", "211": "의약품", "212": "의약품", "213": "의약품", "214": "의약품",
  "26": "반도체/전자", "261": "전자부품", "262": "컴퓨터", "263": "통신장비", "264": "반도체",
  "265": "전자부품", "266": "전자부품",
  "27": "의료기기/정밀기기", "271": "의료기기", "272": "의료기기",
  "28": "전기장비", "281": "전동기", "282": "전지/배터리", "283": "전선", "284": "변압기", "289": "전기장비",
  "29": "기타기계", "291": "일반기계", "292": "특수목적기계",
  "30": "자동차/항공", "301": "자동차", "302": "자동차", "303": "자동차", "304": "항공기", "309": "기타운송",
  "31": "조선", "311": "조선", "312": "조선",
  "35": "방산", "351": "방산", "352": "방산",
  "20": "화학", "201": "기초화학", "204": "합성섬유", "206": "기타화학", "207": "고무",
  "58": "소프트웨어", "620": "IT서비스", "630": "정보서비스",
};

function indutyLabel(code: string): string {
  return INDUTY_LABELS[code] ?? INDUTY_LABELS[code.slice(0, 2)] ?? INDUTY_LABELS[code.slice(0, 1)] ?? "기타";
}

async function getDartIndutyCode(stockCode: string, codeMap: Map<string, string>): Promise<string | null> {
  const DART_KEY = process.env.DART_API_KEY;
  if (!DART_KEY) return null;
  const corpCode = codeMap.get(stockCode);
  if (!corpCode) return null;
  try {
    const r = await fetch(`https://opendart.fss.or.kr/api/company.json?crtfc_key=${DART_KEY}&corp_code=${corpCode}`);
    const d = await r.json();
    return d.status === "000" && d.induty_code ? (d.induty_code as string) : null;
  } catch { return null; }
}

function isIndutyRelevant(indutyCode: string, theme: string): boolean {
  const thm = theme.toLowerCase();
  const code = indutyCode.padStart(3, "0");
  const prefix2 = code.slice(0, 2);

  // 의약품 제조업 (21x)
  const isPharma = prefix2 === "21";
  // 의료기기 (27x)
  const isMedDevice = prefix2 === "27";
  // 반도체/전자 (26x)
  const isSemi = prefix2 === "26";
  // 전기장비/변압기/전지 (28x)
  const isElecEquip = prefix2 === "28";
  // 자동차 (302, 303)
  const isAuto = code === "302" || code === "303" || code === "301";
  // 조선 (311, 312)
  const isShip = prefix2 === "31";
  // 방산 (35x)
  const isDefense = prefix2 === "35";
  // 화학 (20x)
  const isChem = prefix2 === "20";
  // 일반기계 (29x)
  const isMachinery = prefix2 === "29";
  // 소프트웨어/IT (58x, 62x, 63x)
  const isIT = prefix2 === "58" || code.startsWith("62") || code.startsWith("63");

  // 제조업 전체 여부 (KSIC 10~39)
  const isManufacturing = parseInt(prefix2, 10) >= 10 && parseInt(prefix2, 10) <= 39;

  // 테마-업종 매칭
  // 의약품/바이오 테마: 의약품·의료기기만 허용
  if (["mrna", "백신", "치료제", "신약", "glp", "바이오", "cmo", "위탁생산", "임상"].some(k => thm.includes(k))) {
    return isPharma || isMedDevice;
  }
  // 반도체/HBM 테마: 반도체·전자만 허용
  if (["반도체", "hbm", "메모리", "파운드리", "칩", "웨이퍼", "후공정"].some(k => thm.includes(k))) {
    return isSemi;
  }
  // 방산 테마: 제조업 전체 포함 (방산 대기업들 KSIC 코드 다양 — 한화:항공기, LIG:기계, 현대로템:철도 등)
  if (["방산", "방위", "k-방산", "무기", "탄약", "함정"].some(k => thm.includes(k))) {
    return isManufacturing;
  }
  // 조선 테마: 조선·기계 허용
  if (["조선", "선박", "lng선", "해양플랜트"].some(k => thm.includes(k))) {
    return isShip || isMachinery;
  }
  // 자동차/EV 테마
  if (["자동차", "전기차", "자율주행", "ev"].some(k => thm.includes(k))) {
    return isAuto || isChem || isElecEquip; // 배터리·전장 공급망 포함
  }
  // 배터리 테마
  if (["배터리", "2차전지", "전고체", "전지", "양극재", "음극재"].some(k => thm.includes(k))) {
    return isChem || isElecEquip;
  }
  // 전력 인프라 테마
  if (["hvdc", "변압기", "전력설비", "전력인프라"].some(k => thm.includes(k))) {
    return isElecEquip || isMachinery;
  }
  // 로봇/자동화 테마
  if (["로봇", "자동화", "스마트팩토리"].some(k => thm.includes(k))) {
    return isMachinery || isSemi || isElecEquip;
  }
  // AI/SW/클라우드 테마
  if (["ai", "클라우드", "소프트웨어", "saas", "데이터센터"].some(k => thm.includes(k))) {
    return isIT || isSemi;
  }

  // 테마 미매핑 → 명백한 불일치만 제외
  // 제약/바이오 업종을 비제약 테마에서 제외
  if (isPharma && !["바이오", "의약", "제약", "임상", "cmo"].some(k => thm.includes(k))) return false;
  // IT 업종을 비IT 제조 테마에서 제외
  if (isIT && isManufacturing && ["조선", "방산", "배터리", "반도체"].some(k => thm.includes(k))) return false;

  return true; // 기본 포함
}

// ─── DART 사업보고서 캐시 키워드 매칭 (DB 전용, API 호출 없음) ──────────────

/**
 * dart_biz_content 테이블에 캐시된 사업보고서 본문에서 테마 키워드를 검색.
 * - true  : 본문 있고 키워드 1개 이상 발견 (테마 연관 확인됨)
 * - false : 본문 있으나 키워드 없음 (테마 무관 가능성 높음)
 * - null  : 캐시 없음 (판단 불가 — 필터 적용 안 함)
 */
async function checkDartBizCached(
  corpCode: string,
  keywords: string[],
): Promise<boolean | null> {
  if (!corpCode || !keywords.length) return null;
  try {
    const r = await pool.query<{ content: string }>(
      "SELECT content FROM dart_biz_content WHERE corp_code = $1 LIMIT 1",
      [corpCode],
    );
    if (!r.rows[0]?.content) return null; // 캐시 없음

    const text = r.rows[0].content.toLowerCase();
    return keywords.some((kw) => text.includes(kw));
  } catch {
    return null; // DB 오류 → 판단 보류
  }
}

/** 테마 문자열에서 검색 키워드 배열 추출 */
function extractThemeKeywords(theme: string): string[] {
  // 전체 테마, 그리고 공백/하이픈/숫자로 분리한 단어들
  const raw = [theme, ...theme.split(/[\s\-·]+/)];
  return [
    ...new Set(
      raw
        .map((t) => t.toLowerCase().replace(/[^가-힣a-z0-9]/g, "").trim())
        .filter((t) => t.length >= 2),
    ),
  ];
}

let trendingCache: { themes: TrendingTheme[]; cachedAt: number } | null = null;
const TRENDING_TTL = 3 * 60 * 60 * 1000;

// ─── 핫 테마 피드: 트렌딩 테마 + 관련주 ──────────────────────────────────────

interface ThemeFeedItem extends TrendingTheme {
  summary: string;
  stocks: Array<{
    ticker: string;
    name: string;
    market: "KR" | "US";
    sector?: string;
    rationale: string;
  }>;
}

let feedCache: { feed: ThemeFeedItem[]; cachedAt: number } | null = null;
const FEED_TTL = 3 * 60 * 60 * 1000;
const FEED_CACHE_DB_KEY = "themes_feed_cache_v16";
let feedRebuildInProgress = false;

async function saveFeedCacheToDB(feed: ThemeFeedItem[]): Promise<void> {
  try {
    const data = JSON.stringify(feed);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일 보관
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET data = $2, expires_at = $3`,
      [FEED_CACHE_DB_KEY, data, expiresAt]
    );
  } catch (e: any) {
    console.error("[themes] feed DB 저장 실패:", e.message);
  }
}

async function loadFeedCacheFromDB(): Promise<ThemeFeedItem[] | null> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      )
    `);
    const r = await pool.query(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [FEED_CACHE_DB_KEY]
    );
    if (r.rows.length > 0) {
      const raw = r.rows[0].data;
      const parsed = (typeof raw === "string" ? JSON.parse(raw) : raw) as ThemeFeedItem[];
      console.log(`[themes] feed DB 복원 완료: ${parsed.length}개 테마`);
      return parsed;
    }
  } catch (e: any) {
    console.error("[themes] feed DB 로드 실패:", e.message);
  }
  return null;
}

async function rebuildFeedInBackground(): Promise<void> {
  if (feedRebuildInProgress) return;
  feedRebuildInProgress = true;
  try {
    // trendingCache가 유효하면 재사용, 없으면 AI로 새로 생성 (FALLBACK 대신)
    let themes: TrendingTheme[];
    if (trendingCache && Date.now() - trendingCache.cachedAt < TRENDING_TTL) {
      themes = trendingCache.themes;
    } else {
      try {
        themes = await generateTrendingThemes();
        trendingCache = { themes, cachedAt: Date.now() };
        console.log("[themes] 트렌딩 테마 AI 생성 완료:", themes.map(t => t.name).join(", "));
      } catch (e) {
        console.warn("[themes] AI 생성 실패, 폴백 사용:", e);
        themes = FALLBACK_THEMES;
      }
    }
    const krxList = await loadKRXList().catch(() => getKRXCache());
    const settled = await Promise.allSettled(
      themes.map(t => discoverThemeFast(t, krxList))
    );
    const feed: ThemeFeedItem[] = settled.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { ...themes[i], summary: themes[i].description, stocks: [] }
    );
    feedCache = { feed, cachedAt: Date.now() };
    await saveFeedCacheToDB(feed);
    console.log("[themes] feed 백그라운드 갱신 완료");
  } catch (e) {
    console.error("[themes] feed 백그라운드 갱신 실패:", e);
  } finally {
    feedRebuildInProgress = false;
  }
}

// 서버 시작 시 DB에서 피드 캐시 복원 (없으면 자동 rebuild)
(async () => {
  const stored = await loadFeedCacheFromDB();
  if (stored) {
    feedCache = { feed: stored, cachedAt: Date.now() - FEED_TTL + 30 * 60 * 1000 }; // 30분 뒤 갱신
    console.log(`[themes] 피드 캐시 복원 완료 (${stored.length}개 테마) — 키: ${FEED_CACHE_DB_KEY}`);
  } else {
    console.log(`[themes] 피드 캐시 없음 (키: ${FEED_CACHE_DB_KEY}) — 자동 rebuild 시작`);
    rebuildFeedInBackground();
  }
})();

function _normFN(s: string) {
  return s.toLowerCase()
    .replace(/\s*\(주\)\s*|\s*주식회사\s*/gi, "")
    .replace(/[\s\-·,.]/g, "");
}
function _strictMatch(a: string, b: string): boolean {
  const na = _normFN(a), nb = _normFN(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [sh, lo] = na.length <= nb.length ? [na, nb] : [nb, na];
  return sh.length >= 3 && lo.includes(sh);
}

async function discoverThemeFast(
  theme: TrendingTheme,
  krxList: Array<{ code: string; name: string }>,
): Promise<ThemeFeedItem> {
  // 테마 키워드로 KRX 후보 종목 필터링 (Gemini에게 실제 코드 제공)
  const kwRaw = `${theme.name} ${theme.description}`;
  const keywords = kwRaw
    .split(/[\s·,\-·]+/)
    .map(k => k.replace(/[()（）]/g, "").trim())
    .filter(k => k.length >= 2);
  // ── 섹터별 씨드 티커 (회사명에 테마 키워드가 없는 경우 candidateMap 보완) ──
  const THEME_SEED_MAP: Array<{ themeKW: string[]; tickers: [string, string][] }> = [
    {
      themeKW: ["방산", "k-방산", "k방산", "방위", "무기", "탄약", "함정", "전차", "미사일", "포탄", "장갑"],
      tickers: [
        ["012450", "한화에어로스페이스"], ["079550", "LIG넥스원"], ["047810", "한국항공우주"],
        ["064350", "현대로템"], ["103140", "풍산"], ["012800", "진합"], ["008600", "한국유리"],
        ["000720", "현대건설"], ["086280", "현대글로비스"], ["029960", "코맥스"],
        ["272210", "한화시스템"], ["000240", "한국타이어앤테크놀로지"],
        ["014570", "성우하이텍"], ["302430", "HLB생명과학"],
      ],
    },
    {
      themeKW: ["조선", "lng선", "lng", "선박", "해양"],
      tickers: [
        ["009540", "HD한국조선해양"], ["010140", "삼성중공업"], ["042660", "한화오션"],
        ["267250", "HD현대"], ["009830", "한화"], ["078070", "STX중공업"],
        ["138040", "메리츠금융지주"], ["100090", "삼성엔지니어링"],
        ["005440", "현대지에프홀딩스"], ["138930", "BNK금융지주"],
      ],
    },
    {
      themeKW: ["바이오", "제약", "치료제", "임상", "cmo", "위탁생산", "신약", "mrna", "glp"],
      tickers: [
        ["068270", "셀트리온"], ["207940", "삼성바이오로직스"], ["128940", "한미약품"],
        ["145020", "휴젤"], ["086900", "메디톡스"], ["009290", "광동제약"],
        ["000100", "유한양행"], ["069620", "대웅제약"], ["185750", "종근당"],
        ["326030", "SK바이오팜"], ["302440", "SK바이오사이언스"],
      ],
    },
    {
      themeKW: ["hvdc", "변압기", "전력인프라", "송전", "전력기기"],
      tickers: [
        ["105560", "KB금융"], ["096770", "SK이노베이션"], ["012690", "모텍스"],
        ["094820", "일진파워"], ["267260", "HD현대일렉트릭"], ["001680", "대상"],
        ["011090", "LG이노텍"], ["004490", "세방전지"], ["298040", "효성중공업"],
        ["298000", "효성티앤씨"], ["120110", "코오롱인더"],
      ],
    },
    {
      // 금리 인하 수혜 — 대출 증가, 자산 가격 상승
      themeKW: ["금리인하", "부동산", "리츠", "금리 인하"],
      tickers: [
        ["105560", "KB금융"], ["055550", "신한지주"], ["086790", "하나금융지주"],
        ["316140", "우리금융지주"], ["138040", "메리츠금융지주"], ["139130", "DGB금융지주"],
        ["000060", "메리츠화재"], ["088350", "한화생명"],
      ],
    },
    {
      // 금리 인상 수혜 — 예금·보험·저축은행 이자수익 증가
      themeKW: ["금리인상", "고금리", "금리 인상", "인상", "예금", "보험유입"],
      tickers: [
        ["032830", "삼성생명"], ["088350", "한화생명"], ["000060", "메리츠화재"],
        ["001450", "현대해상"], ["000370", "한화손해보험"], ["105560", "KB금융"],
        ["055550", "신한지주"], ["086790", "하나금융지주"], ["316140", "우리금융지주"],
        ["138040", "메리츠금융지주"], ["175330", "JB금융지주"], ["139130", "DGB금융지주"],
        ["006360", "GS건설"], ["000720", "현대건설"],
      ],
    },
    {
      // 코스닥·중소형주 테마 — 코스닥 대표 종목 씨드
      themeKW: ["코스닥", "중소형", "소형주"],
      tickers: [
        ["086980", "쇼박스"], ["042700", "한미반도체"], ["196170", "알테오젠"],
        ["039030", "이오테크닉스"], ["253450", "스튜디오드래곤"], ["214150", "클래시스"],
        ["263720", "디앤씨미디어"], ["122870", "와이지엔터테인먼트"], ["035900", "JYP엔터테인먼트"],
        ["240810", "원익IPS"], ["357780", "솔브레인"], ["036540", "SFA반도체"],
        ["336370", "솔루스첨단소재"], ["091990", "셀트리온헬스케어"], ["078340", "컴투스"],
        ["377300", "카카오페이"], ["112040", "위메이드"], ["293490", "카카오게임즈"],
        ["259960", "크래프톤"], ["034220", "LG디스플레이"], ["145020", "휴젤"],
        ["086900", "메디톡스"], ["039200", "오스코텍"], ["236340", "메가스터디교육"],
      ],
    },
    {
      // 반도체·소부장 테마
      themeKW: ["반도체", "소부장", "소재", "부품", "장비", "hbm"],
      tickers: [
        ["042700", "한미반도체"], ["000660", "SK하이닉스"], ["005930", "삼성전자"],
        ["240810", "원익IPS"], ["039030", "이오테크닉스"], ["357780", "솔브레인"],
        ["036540", "SFA반도체"], ["036540", "SFA반도체"], ["091070", "토비스"],
        ["336370", "솔루스첨단소재"], ["232140", "와이아이케이"], ["140860", "파크시스템스"],
        ["950130", "엑시콘"], ["440710", "에이피티씨"], ["104830", "원익머트리얼즈"],
        ["254120", "솔루엠"], ["365340", "성일하이텍"], ["000990", "DB하이텍"],
      ],
    },
    {
      // AI·데이터센터 테마
      themeKW: ["ai", "인공지능", "데이터센터", "클라우드", "온디바이스"],
      tickers: [
        ["042700", "한미반도체"], ["000660", "SK하이닉스"], ["035420", "NAVER"],
        ["035720", "카카오"], ["030200", "KT"], ["017670", "SK텔레콤"],
        ["011210", "현대위아"], ["079550", "LIG넥스원"], ["030530", "원익홀딩스"],
        ["232140", "와이아이케이"], ["950130", "엑시콘"], ["080220", "제주반도체"],
        ["033640", "네패스아크"], ["012510", "더존비즈온"], ["091170", "파워로직스"],
      ],
    },
    {
      // 중국·소비재·수출 테마
      themeKW: ["중국", "소비재", "화장품", "k-뷰티", "면세"],
      tickers: [
        ["090430", "아모레퍼시픽"], ["051600", "한국전력"], ["161890", "한국콜마"],
        ["002790", "아모레G"], ["085660", "차바이오텍"], ["000120", "CJ대한통운"],
        ["069960", "현대백화점"], ["023530", "롯데쇼핑"], ["004170", "신세계"],
        ["008770", "호텔신라"], ["187790", "코디아이엔씨"], ["214420", "토니모리"],
      ],
    },
    {
      // 고환율 수혜·수출 테마 — "수출" 단독 키워드 제거 (원전수출·방산수출 등 복합어 오염 방지)
      themeKW: ["고환율", "환율", "달러강세", "원달러"],
      tickers: [
        ["005930", "삼성전자"], ["000660", "SK하이닉스"], ["005380", "현대자동차"],
        ["000270", "기아"], ["009540", "HD한국조선해양"], ["010140", "삼성중공업"],
        ["042660", "한화오션"], ["103140", "풍산"], ["090430", "아모레퍼시픽"],
        ["012450", "한화에어로스페이스"], ["047810", "한국항공우주"],
      ],
    },
    {
      // 원전·SMR·핵에너지 테마 — 핵심 원전 설비·설계·정비 기업만 (조선·방산 제외)
      themeKW: ["원전", "원자력", "smr", "소형모듈", "핵에너지", "원자로", "체코원전", "원전수출", "원전 수출", "핵발전"],
      tickers: [
        ["034020", "두산에너빌리티"],  // 원자로·증기발생기 핵심 설비 제조
        ["052690", "한전기술"],        // 원전 설계 독점 (한수원 자회사)
        ["051600", "한전KPS"],         // 원전 정비·보수 독점 (한수원 자회사)
        ["015760", "한국전력"],        // 원전 운영 모기업
        ["083650", "비에이치아이"],    // 원전 열교환기·압력용기 제조
        ["032820", "우리기술"],        // 원전 계측제어 시스템(MMIS)
        ["298040", "효성중공업"],      // 원전 변압기·전력기기
        ["010120", "LS ELECTRIC"],     // 원전 전기설비·차단기
        ["000720", "현대건설"],        // 원전 EPC (체코 수주 주관사)
        ["047040", "대우건설"],        // 원전 토건·시공
        ["006360", "GS건설"],          // 원전 건설 참여
        ["014620", "성광벤드"],        // 원전 배관 피팅·연결재
        ["082640", "동양이엔피"],      // 원전 1차 계통 부품
        ["064350", "현대로템"],        // 원전 특수 부품 제조
      ],
    },
  ];

  const themeKwLowerForSeed = `${theme.name} ${theme.description}`.toLowerCase();
  const candidateMap = new Map<string, string>();

  // 씨드 티커 먼저 추가 (테마 키워드가 회사명에 없어도 올바른 종목 확보)
  for (const rule of THEME_SEED_MAP) {
    if (rule.themeKW.some(kw => themeKwLowerForSeed.includes(kw))) {
      for (const [code, name] of rule.tickers) {
        candidateMap.set(code, name);
      }
    }
  }

  // 이름 기반 키워드 매칭으로 추가 후보 보완
  // ※ 부분문자열 오매칭 방지: 회사명 앞부분 or 공백 경계에서만 허용
  //   예) "원전" 키워드 → "대원전선" 매칭 차단 (대+원전 구조), "원전기술" 허용
  function nameMatchesKeyword(companyName: string, kw: string): boolean {
    const n = companyName.trim();
    if (n === kw) return true;
    if (n.startsWith(kw)) return true;
    // 공백 뒤에 등장하는 경우만 허용 ("한국 원전기술" 등)
    return n.includes(` ${kw}`);
  }

  for (const item of krxList) {
    for (const kw of keywords) {
      if (nameMatchesKeyword(item.name, kw)) {
        candidateMap.set(item.code, item.name);
        break;
      }
    }
    if (candidateMap.size >= 100) break;
  }
  const candidateLines = [...candidateMap.entries()]
    .slice(0, 80)
    .map(([code, name]) => `${code} ${name}`)
    .join(", ");

  // 테마 성격에 따라 구성 지침 동적 결정
  const themeTextLower = `${theme.name} ${theme.description}`.toLowerCase();
  const isKosdaqSmallCap = ["코스닥", "중소형", "소형주"].some(kw => themeTextLower.includes(kw));
  const isKospiLargeCap  = ["코스피", "대형주", "블루칩"].some(kw => themeTextLower.includes(kw));

  const krComposition = isKosdaqSmallCap
    ? `【한국 7개 — 반드시 위 KRX 후보 목록 코드만 사용, 코스닥 상장 중소형주만, 코스피 대형주 절대 제외】
   ※ 후보 목록에 없는 코드는 절대 사용 금지`
    : isKospiLargeCap
    ? `【한국 5개 구성 — 반드시 위 KRX 후보 목록 코드만 사용】
① 대형주 3개: 코스피 핵심 대기업 (시총 2조 이상)
② 중형주 2개: 관련 중견기업
   ※ 후보 목록에 없는 코드는 절대 사용 금지`
    : `【한국 5개 구성 — 반드시 위 KRX 후보 목록 코드만 사용】
① 대형주 2개: 테마 핵심 대기업 (시총 2조 이상)
② 중소형주 3개: 핵심 부품·소재·장비 납품 중소기업 (시총 2조 미만)
   ※ 후보 목록에 없는 코드는 절대 사용 금지 — 부족해도 목록 안에서만 선정`;

  const usComposition = isKosdaqSmallCap
    ? "" // 코스닥 중소형주 테마엔 미국 종목 불필요
    : "\n【미국 2개 — NYSE/NASDAQ 심볼】";

  const totalNote = isKosdaqSmallCap
    ? "정확히 7개 (한국 코스닥 중소형주만)"
    : "정확히 7개: 한국 5개 + 미국 2개";

  const systemInstruction = `당신은 한국 주식시장 테마주 전문 애널리스트입니다. 증권사 리서치센터에서 15년간 테마주·섹터 분석을 담당했으며, 다음 원칙을 철저히 지킵니다:

1. 종목 선정 원칙 (최우선)
   - 반드시 아래 프롬프트의 KRX 후보 목록에 있는 코드만 사용할 것. 후보 목록에 없는 KR 코드는 절대 출력 금지.
   - 해당 기업의 실제 매출·사업에서 테마 연관 매출 비중이 명확한 종목만 선정
   - 회사 이름이나 업종 분류가 비슷해 보여도 실질 사업이 다르면 절대 선정하지 않음
     예) 영화관(CJ CGV) → 방산 불가 / 도메인·호스팅 회사 → 방산 불가 / 자동차 회사 → 조선 불가
   
2. 시장 분류 원칙
   - 코스닥/중소형 테마: 코스닥 상장 기업 + 시총 2조 미만 → 삼성전자·SK하이닉스 등 코스피 대형주 절대 제외
   - 일반 테마: 대형주(직접 수혜 핵심주) + 중소형주(부품·소재·장비 공급사) 균형 있게 선정

3. 출력 형식
   - rationale: 그 기업이 테마에서 수혜를 받는 구체적 이유 (매출 연관성, 수주 현황, 공급망 위치 등) 한 문장으로
   - sector: 해당 기업의 실제 업종 (테마명이 아닌 실제 사업 분류)
   - 마크다운 없이 JSON만 출력`;

  const prompt = `투자 테마: "${theme.name}" — ${theme.description}

아래 KRX 후보 종목(코드+이름) 목록에서 ${totalNote}를 선정하세요.

【KRX 후보 종목】(직접 수혜 종목 우선, 코드 그대로 사용):
${candidateLines || "(없음 — 한국 종목 선정 불가, 미국 종목만 선정)"}

${krComposition}${usComposition}

【절대 제외】지주사·금융주·ETF·SPAC·테마와 실질 연관 없는 기업, KRX 후보 목록에 없는 한국 종목

JSON만 출력:
{"summary":"30자 이내 테마 요약","stocks":[{"ticker":"094820","name":"일진파워","market":"KR","sector":"전력기기","rationale":"HVDC 케이블 접속재 독점 공급, 수주 급증"},{"ticker":"GEV","name":"GE Vernova","market":"US","sector":"전력","rationale":"HVDC 시스템 글로벌 1위, 북미 데이터센터 전력 수주 확대"}]}`;

  const resp = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.3,
      thinkingConfig: { thinkingBudget: 0 },
      systemInstruction,
    },
  });

  const rawText = resp.text ?? "";
  console.log(`[themes][${theme.name}] Gemini raw: ${rawText.slice(0, 400)}`);
  const parsed = safeParseJson<{ summary: string; stocks: ThemeFeedItem["stocks"] }>(rawText);
  let stocks: ThemeFeedItem["stocks"] = (parsed?.stocks ?? []).map(s => ({
    ...s, market: s.market === "KR" ? "KR" : "US",
  }));

  // KR: 이름 → 코드 매핑 / US: 심볼 유효성 체크
  stocks = stocks.flatMap(s => {
    if (s.market === "US") {
      return /^[A-Z]{1,6}(\.[A-Z]{1,2})?$/.test(s.ticker) ? [s] : [];
    }
    const gName = s.name || s.ticker;
    if (/^\d{6}$/.test(s.ticker)) {
      const k = krxList.find(k => k.code === s.ticker);
      return k ? [{ ...s, ticker: k.code, name: k.name }] : [];
    }
    const k = krxList.find(k => _strictMatch(k.name, gName));
    return k ? [{ ...s, ticker: k.code, name: k.name }] : [];
  });

  // 업종-테마 불일치 필터: 자동차·항공사가 방산/HVDC/조선/금융 테마에 들어오는 오류 차단
  const KOSPI_LARGE_CAPS = [
    "005930", // 삼성전자
    "000660", // SK하이닉스
    "005380", // 현대자동차
    "000270", // 기아
    "068270", // 셀트리온
    "005490", // POSCO홀딩스
    "035420", // NAVER
    "051910", // LG화학
    "006400", // 삼성SDI
    "066570", // LG전자
    "105560", // KB금융
    "055550", // 신한지주
    "086790", // 하나금융지주
    "003550", // LG
    "012330", // 현대모비스
    "034730", // SK
    "017670", // SK텔레콤
    "030200", // KT
    "032830", // 삼성생명
    "096770", // SK이노베이션
  ];

  const BAD_SECTOR_THEME: Array<{ tickers: string[]; badThemeKW: string[] }> = [
    {
      // 코스피 대형주 — 코스닥·중소형주 테마에서 제외
      tickers: KOSPI_LARGE_CAPS,
      badThemeKW: ["코스닥", "중소형", "소형주"],
    },
    {
      // 방산·조선·비철금속 기업 — 원전 테마에서 차단 (부품 납품 명목 혼입 방지)
      tickers: [
        "012450", // 한화에어로스페이스 (방산·항공)
        "079550", // LIG넥스원 (방산)
        "047810", // 한국항공우주 (방산)
        "010140", // 삼성중공업 (조선)
        "009540", // HD한국조선해양 (조선)
        "042660", // 한화오션 (조선)
        "267250", // HD현대 (조선 지주)
        "103140", // 풍산 (비철금속·탄약)
        "006340", // 대원전선 (케이블)
        "064350", // 현대로템 (K2전차·방산)
      ],
      badThemeKW: ["원전", "원자력", "smr", "소형모듈", "핵에너지", "원자로", "체코원전", "핵발전"],
    },
    {
      // IT·도메인·호스팅 기업 — 방산·조선·HVDC·반도체·바이오 테마 차단
      tickers: ["079940", "047050", "035600"], // 가비아, 네이블, K아이컴 등 IT서비스
      badThemeKW: ["방산", "k-방산", "k방산", "방위", "무기", "탄약", "함정", "전차", "조선", "lng", "hvdc", "변압기", "반도체", "바이오", "제약"],
    },
    {
      tickers: ["003490", "020560"], // 대한항공, 아시아나 등 항공사
      badThemeKW: ["hvdc", "변압기", "방산", "조선", "lng", "반도체", "배터리", "바이오"],
    },
    {
      tickers: ["005380", "000270"], // 현대자동차, 기아 — 자동차주
      badThemeKW: ["hvdc", "변압기", "방산", "k-방산", "k방산", "방위", "조선", "lng", "금융", "은행"],
    },
    {
      // 배터리/2차전지 기업 — 방산·조선·HVDC·반도체 테마 차단
      tickers: ["006400", "373220", "096770", "247540", "003670", "066970", "005070", "112610", "357780"],
      badThemeKW: ["방산", "k-방산", "k방산", "방위", "무기", "탄약", "함정", "전차", "조선", "lng선", "hvdc", "변압기", "전력인프라"],
    },
    {
      // 게임/IT/플랫폼 기업 — 바이오·방산·조선·HVDC 테마 차단
      tickers: ["263750", "036570", "251270", "035420", "035720", "293490", "112040", "194480", "377300", "259960"],
      badThemeKW: ["바이오", "제약", "치료제", "glp", "mrna", "백신", "임상", "cmo", "위탁생산", "방산", "k-방산", "조선", "hvdc", "변압기"],
    },
    {
      // 영화관·엔터·미디어 기업 — 방산·반도체·조선·HVDC 테마 차단
      tickers: ["079160", "036120", "035760", "041510", "067160"],
      // CJ CGV, 씨젠(혼동 방지), CJ ENM, S.M., 하이브
      badThemeKW: ["방산", "k-방산", "k방산", "방위", "무기", "반도체", "조선", "lng", "hvdc", "변압기", "바이오", "제약"],
    },
  ];
  const themeKwLower = `${theme.name} ${theme.description}`.toLowerCase();
  stocks = stocks.filter(s => {
    for (const rule of BAD_SECTOR_THEME) {
      if (rule.tickers.includes(s.ticker) &&
          rule.badThemeKW.some(kw => themeKwLower.includes(kw))) {
        console.log(`[themes][discoverFast] 업종불일치 제거: ${s.ticker}(${s.name}) ← "${theme.name}"`);
        return false;
      }
    }
    return true;
  });

  // ── 후보 목록 외 KR 종목 차단 (hallucination 핵심 방어선) ────────────────
  // AI가 후보 목록에 없는 코드를 임의로 추가하는 것을 서버에서 최종 차단
  stocks = stocks.filter(s => {
    if (s.market !== "KR") return true; // 미국 종목은 통과
    if (candidateMap.has(s.ticker)) return true; // 후보 목록 내 → 통과
    // 후보 목록 밖 → 차단 (로그 남김)
    console.log(`[themes][discoverFast] 후보목록 외 제거: ${s.ticker}(${s.name}) ← "${theme.name}"`);
    return false;
  });

  // 중복 제거
  const seen = new Set<string>();
  stocks = stocks.filter(s => !seen.has(s.ticker) && seen.add(s.ticker) !== undefined);

  return { ...theme, summary: parsed?.summary ?? theme.description, stocks: stocks.slice(0, 8) };
}

router.get("/themes/trending-feed", async (req, res) => {
  try {
    const forceRebuild = req.query["rebuild"] === "true";
    if (forceRebuild) {
      feedCache = null;
      feedRebuildInProgress = false;
      pool.query(`DELETE FROM system_cache WHERE key = $1`, [FEED_CACHE_DB_KEY]).catch(() => {});
      rebuildFeedInBackground();
      return res.json([]);
    }

    const now = Date.now();
    const isFresh = feedCache && (now - feedCache.cachedAt < FEED_TTL);
    const isStale = feedCache && !isFresh;

    // 신선한 캐시 → 즉시 반환
    if (isFresh && feedCache) {
      return res.json(feedCache.feed);
    }

    // 만료된 캐시(stale) → 즉시 반환 + 백그라운드 갱신
    if (isStale && feedCache) {
      res.json(feedCache.feed);
      rebuildFeedInBackground();
      return;
    }

    // 캐시 없음(첫 시작) → 백그라운드 갱신 시작하고 빈 배열 반환 (프론트가 재시도)
    rebuildFeedInBackground();
    return res.json([]);
  } catch (e) {
    console.error("[themes/trending-feed]", e);
    return res.status(500).json({ error: "피드 로드 실패" });
  }
});

// 트렌딩 테마 갱신 시 피드 캐시도 무효화 (같이 갱신되도록)
function invalidateFeedCache() { feedCache = null; }

function safeParseJson<T>(text: string): T | null {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // 1) 전체 텍스트 직접 파싱 (마크다운 제거 후 순수 JSON인 경우)
  try { return JSON.parse(cleaned) as T; } catch {}
  // 2) 객체 추출
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]) as T; } catch {} }
  // 3) 배열 추출
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]) as T; } catch {} }
  return null;
}

const FALLBACK_THEMES: TrendingTheme[] = [
  { id: "hvdc_transformer",  name: "HVDC·변압기",      description: "데이터센터 전력 병목으로 수주 급증",   emoji: "⚡" },
  { id: "k_defense_export",  name: "K-방산 수출",      description: "트럼프 후 동맹 재편·수출 계약 급증",  emoji: "🛡️" },
  { id: "glp1_cmo",          name: "GLP-1 CMO",        description: "비만치료제 공급 부족·CMO 수주 폭증",  emoji: "💊" },
  { id: "spacex_related",    name: "스페이스X 관련주", description: "발사체·위성망 수혜 부품·장비 공급사", emoji: "🚀" },
  { id: "shipbuilding_lng",  name: "조선 LNG선",       description: "LNG 운반선 수주잔고 역대 최고",       emoji: "🚢" },
  { id: "value_up_bank",     name: "밸류업 금융주",    description: "자사주 소각·배당 확대 정책 수혜",     emoji: "🏦" },
  { id: "ai_agent_infra",    name: "AI 에이전트 인프라", description: "추론 모델 확산으로 서버·스토리지 수요", emoji: "🤖" },
  { id: "tariff_reroute",    name: "관세 우회 물류",   description: "미중 관세로 공급망 재편·물류 수혜",   emoji: "🌐" },
  { id: "battery_solid",     name: "전고체 배터리",    description: "2027 양산 경쟁·소재·장비주 선반영",   emoji: "🔋" },
];

/** AI + KRX 실데이터로 트렌딩 테마 8개 생성 (캐시 미고려 순수 생성) */
async function generateTrendingThemes(): Promise<TrendingTheme[]> {
  const kstNow = new Date(Date.now() + 9 * 3600_000);
  const today = `${kstNow.getUTCFullYear()}년 ${kstNow.getUTCMonth() + 1}월 ${kstNow.getUTCDate()}일`;

  // ── 최근 3거래일 기관·외국인 순매수 실데이터 ────────────────────────────
  const toDate = kstNow.toISOString().slice(0, 10);
  const fromDateObj = new Date(kstNow);
  fromDateObj.setDate(fromDateObj.getDate() - 7); // 주말·공휴일 포함해도 3거래일 확보
  const fromDate = fromDateObj.toISOString().slice(0, 10);

  let investorContext = "";
  try {
    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchInvestorData("KOSPI",  fromDate, toDate),
      fetchInvestorData("KOSDAQ", fromDate, toDate),
    ]);
    const fmt = (rows: typeof kospiRows) =>
      rows.slice(-3).map(r =>
        `  ${r.date}: 외국인 ${r.foreign >= 0 ? "+" : ""}${r.foreign.toLocaleString()}억, 기관 ${r.institution >= 0 ? "+" : ""}${r.institution.toLocaleString()}억`
      ).join("\n");
    const kospiText  = fmt(kospiRows);
    const kosdaqText = fmt(kosdaqRows);
    if (kospiText || kosdaqText) {
      investorContext = `=== 최근 3거래일 실제 기관·외국인 순매수 (KRX 데이터) ===
[KOSPI]
${kospiText || "  데이터 없음"}

[KOSDAQ]
${kosdaqText || "  데이터 없음"}
===`;
    }
  } catch { /* pykrx 실패 시 무시 */ }

  // ── 시장 브리핑 (뉴스·키워드) + 금리 실데이터 ────────────────────────────
  let briefContext = "";
  try {
    const MARKET_PORT = process.env.MARKET_INTERNAL_PORT ?? "8082";
    const briefRes = await fetch(`http://localhost:${MARKET_PORT}/api/market-analysis/brief`);
    if (briefRes.ok) {
      const brief = await briefRes.json() as Record<string, unknown>;
      const events = (brief.marketEvents as Array<{title:string;direction:string}> | undefined)
        ?.map(e => `- ${e.title} (${e.direction === "positive" ? "긍정" : e.direction === "negative" ? "부정" : "중립"})`)
        .join("\n") ?? "";
      const topics = (brief.keyTopics as Array<{keyword:string;description:string}> | undefined)
        ?.map(t => `- ${t.keyword}: ${t.description}`)
        .join("\n") ?? "";
      if (events || topics) {
        briefContext = `=== 시장 뉴스·키워드 ===
코스피: ${brief.kospiCurrent ?? ""} (${(brief.kospiChange as number) >= 0 ? "+" : ""}${brief.kospiChange ?? ""}%)
코스닥: ${brief.kosdaqCurrent ?? ""}
주요 이벤트:
${events}
핵심 키워드:
${topics}
===`;
      }
    }
  } catch { /* 브리핑 실패 시 무시 */ }

  // ── 금리 실데이터 (FRED/ECOS) ────────────────────────────────────────────
  // 함수 스코프에 선언 — 사후 교정 코드에서도 접근 가능
  let krRate: number | null = null;
  let krCpi:  number | null = null;
  let rateContext = "";
  try {
    const macroRes = await fetch(`http://localhost:8080/api/macro/dashboard`);
    if (macroRes.ok) {
      const macro = await macroRes.json() as Record<string, any>;
      // 실제 구조: { categories: [{id, items: [{id, value}]}] }
      type MacroItem = { id: string; value: number | null };
      type MacroCat  = { id: string; items: MacroItem[] };
      const cats = (macro?.categories ?? []) as MacroCat[];
      const flatten = cats.flatMap(c => c.items ?? []);
      const findVal = (id: string): number | null =>
        flatten.find(i => i.id === id)?.value ?? null;
      krRate = findVal("bok-rate");
      krCpi  = findVal("kr-cpi");
      const usRate = findVal("us-rate") ?? null;
      const us10y  = findVal("us10y")  ?? null;
      const usCpi  = findVal("us-cpi") ?? null;
      const parts: string[] = [];
      if (krRate  != null) parts.push(`한국 기준금리: ${krRate}%`);
      if (usRate  != null) parts.push(`미국 기준금리: ${usRate}`);
      if (us10y   != null) parts.push(`미국 10년 국채: ${us10y}%`);
      if (krCpi   != null) parts.push(`한국 CPI(YoY): ${krCpi}%`);
      if (usCpi   != null) parts.push(`미국 CPI(YoY): ${usCpi}%`);
      if (parts.length) {
        // CPI vs 기준금리 비교로 금리 방향 자동 판단
        const krRateNum  = typeof krRate === "number" ? krRate : parseFloat(String(krRate));
        const krCpiNum   = typeof krCpi  === "number" ? krCpi  : parseFloat(String(krCpi));
        let rateDirection = "";
        if (!isNaN(krRateNum) && !isNaN(krCpiNum)) {
          if (krCpiNum > krRateNum + 0.3) {
            rateDirection = `\n⚠️ 금리 방향 판단: 한국 물가(${krCpiNum}%)가 기준금리(${krRateNum}%)를 크게 상회 → 금리 인상 또는 동결 압력. "금리인하 기대" 테마는 현재 상황과 맞지 않으므로 생성 금지. 대신 "금리 인상 대비", "고금리 수혜", "예금·보험 유입" 등 인상 방향 테마를 생성할 것.`;
          } else if (krCpiNum < krRateNum - 0.3) {
            rateDirection = `\n💡 금리 방향 판단: 물가(${krCpiNum}%)가 기준금리(${krRateNum}%) 아래 → 금리 인하 여력 존재. "금리인하 기대" 테마 생성 가능.`;
          } else {
            rateDirection = `\n💡 금리 방향 판단: 물가(${krCpiNum}%)와 기준금리(${krRateNum}%) 비슷 → 동결 또는 소폭 인하 가능성. 확정적 방향 테마는 신중하게 생성할 것.`;
          }
        }
        rateContext = `=== 현재 금리·물가 실데이터 ===
${parts.join(", ")}${rateDirection}
===`;
      }
    }
  } catch { /* 실패 시 무시 */ }

  const contextBlock = [investorContext, rateContext, briefContext].filter(Boolean).join("\n\n");

  const prompt = `오늘은 ${today}입니다.${contextBlock ? "\n\n" + contextBlock : ""}

위 실제 데이터를 바탕으로, 최근 3거래일 기준 기관·외국인 순매수가 집중된 테마 8개를 선정해주세요.

조건:
- KRX 실데이터에서 기관·외국인이 실제로 순매수한 섹터·테마를 최우선으로 반영하세요
- 반드시 ${today} 시점에도 진행 중인 이슈여야 합니다 — 이미 종료된 이벤트는 절대 제외
- 금리 관련 테마는 위 실데이터(기준금리·CPI·장기금리) 기준으로 현재 방향(인상/동결/인하)을 정확히 반영하세요 — 실데이터와 다른 방향의 테마 생성 금지
- "AI 반도체", "바이오", "2차전지" 같은 상시 포괄 테마는 피하고 구체적인 수급 드라이버(수주·정책·실적·이벤트)를 명시하세요
- 한국 코스피·코스닥 중심, 관련 미국 시장 테마도 포함 가능

마크다운 없이 아래 JSON 배열만 출력하세요:
[{"id":"영문_스네이크","name":"한글 테마명(10자 이내)","description":"수급 이유 한 줄(20자 이내)","emoji":"이모지"}]`;

  const themeAnalystSystem = `당신은 한국 주식시장 테마주 전문 애널리스트입니다. 기관·외국인 수급 데이터를 기반으로 시장을 주도하는 투자 테마를 발굴하는 것이 전문입니다.

핵심 원칙:
- 실제 KRX 수급 데이터와 뉴스를 교차 검증하여 테마를 선정합니다
- 금리·환율 등 매크로 지표는 반드시 제공된 실데이터 수치 기준으로 판단합니다 (훈련 데이터의 과거 방향을 투영하지 않음)
- "AI 반도체", "2차전지" 같은 만년 테마가 아니라, 지금 이 순간 수급이 집중되는 구체적 드라이버(특정 수주·정책·실적 발표)를 포착합니다
- 이미 종료된 이벤트(과거 선거·지나간 실적 시즌 등)는 절대 테마로 선정하지 않습니다`;

  const resp = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.5,
      thinkingConfig: { thinkingBudget: 0 },
      systemInstruction: themeAnalystSystem,
    },
  });

  let themes = safeParseJson<TrendingTheme[]>(resp.text ?? "");
  if (!themes || !Array.isArray(themes) || themes.length === 0) throw new Error("parse fail");

  // ── 금리 방향 사후 교정 ────────────────────────────────────────────────────
  // AI가 프롬프트 경고를 무시하고 틀린 방향 테마를 생성할 경우 서버에서 교체
  try {
    const krRateNum = typeof krRate === "number" ? krRate : parseFloat(String(krRate ?? ""));
    const krCpiNum  = typeof krCpi  === "number" ? krCpi  : parseFloat(String(krCpi  ?? ""));
    if (!isNaN(krRateNum) && !isNaN(krCpiNum) && krCpiNum > krRateNum + 0.3) {
      // 물가 > 기준금리 → 인상 압력: "금리인하" 테마 교체
      themes = themes.map(t => {
        const txt = `${t.name} ${t.description}`.toLowerCase();
        if (txt.includes("금리인하") || txt.includes("금리 인하")) {
          console.log(`[themes] 금리 방향 교정: "${t.name}" → "고금리 수혜" (CPI ${krCpiNum}% > 기준금리 ${krRateNum}%)`);
          return {
            ...t,
            id: "high_rate_beneficiary",
            name: "고금리 수혜주",
            description: "물가 상승·금리인상 기대, 보험·은행 이익 개선",
            emoji: "🏦",
          };
        }
        return t;
      });
    }
  } catch { /* 교정 실패 시 원본 유지 */ }

  // ── 중복 테마 제거 (정규화 이름 기준, 첫 번째 유지) ──────────────────────
  // "고금리 수혜주" / "고금리 수혜" 처럼 조사·접미사만 다른 경우도 같은 테마로 처리
  const normalizeThemeName = (name: string) =>
    name.trim()
      .replace(/주$/, "")          // 말미 "주" 제거 (수혜주→수혜)
      .replace(/\s+/g, "")         // 공백 제거
      .toLowerCase();

  const seen = new Set<string>();
  themes = themes.filter(t => {
    const key = normalizeThemeName(t.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return themes;
}

router.get("/themes/trending", async (_req, res) => {
  try {
    if (trendingCache && Date.now() - trendingCache.cachedAt < TRENDING_TTL) {
      return res.json(trendingCache.themes);
    }
    const themes = await generateTrendingThemes();
    trendingCache = { themes, cachedAt: Date.now() };
    invalidateFeedCache();
    return res.json(themes);
  } catch (e) {
    console.error("[themes/trending]", e);
    return res.json(FALLBACK_THEMES);
  }
});

router.post("/themes/discover", async (req, res) => {
  try {
    const { theme } = req.body as { theme: string };
    if (!theme?.trim()) return res.status(400).json({ error: "테마를 입력해주세요." });

    const trimmed = theme.trim();

    // ── STEP 0A: 서버 사전 차단 — KRX 종목명·코드 직접 입력 ────────────────
    const krxCache = await loadKRXList().catch(() => getKRXCache());
    const exactKrxMatch = krxCache.find(s => s.name === trimmed || s.code === trimmed);
    if (exactKrxMatch) {
      return res.status(400).json({
        error: `'${trimmed}'은(는) 상장 종목입니다. 테마 발굴 대신 AI 기업분석 기능을 이용해주세요.`,
        invalid: true,
      });
    }

    // ── STEP 0B: 한글 2~4자 단어 — 알려진 투자 테마 키워드가 아니면 거절 ────
    // 사람 이름(정원오, 홍길동 등)·국가명(미국, 중국)·의미없는 단어 차단
    const PURE_KOREAN = /^[가-힣]{2,4}$/;
    const KNOWN_SHORT_THEMES = new Set([
      "반도체","방산","조선","바이오","배터리","자동차","로봇","소재","금융","보험",
      "건설","에너지","화학","철강","항공","게임","헬스케어","물류","콘텐츠","미디어",
      "제약","의료","의약","식품","농업","전력","가스","유통","패션","뷰티","해운",
      "통신","핀테크","부동산","리츠","소프트웨어","인터넷","클라우드","리오프닝",
      "전기차","방위","조세","증시","채권","환율","금리","인플레","공매도","PBR",
    ]);
    if (PURE_KOREAN.test(trimmed) && !KNOWN_SHORT_THEMES.has(trimmed)) {
      return res.status(400).json({
        error: `'${trimmed}'은(는) 투자 테마로 인식하기 어렵습니다. "K-방산", "AI 에이전트", "GLP-1 비만치료제" 처럼 더 구체적인 테마를 입력해주세요.`,
        invalid: true,
      });
    }

    // ── CACHE CHECK: 동일 테마 24시간 캐시 (theme_stock_cache 우선, system_cache 폴백) ─
    const THEME_CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
    const themeCacheKey = `themes_discover_v2_${trimmed.toLowerCase().replace(/\s+/g, "_")}`;
    try {
      const cached = await pool.query(
        `SELECT data FROM theme_stock_cache WHERE theme_key = $1 AND expires_at > NOW()`,
        [themeCacheKey]
      );
      if (cached.rows.length) {
        console.log(`[themes] 캐시 히트(theme_stock_cache): "${trimmed}"`);
        return res.json(JSON.parse(cached.rows[0].data));
      }
    } catch (_) { /* 캐시 미스 시 정상 진행 */ }
    // 레거시 system_cache 폴백
    try {
      const cached = await pool.query(
        `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
        [themeCacheKey]
      );
      if (cached.rows.length) {
        console.log(`[themes] 캐시 히트(system_cache): "${trimmed}"`);
        return res.json(JSON.parse(cached.rows[0].data));
      }
    } catch (_) { /* 캐시 미스 시 정상 진행 */ }

    // ── STEP 1: Gemini — 투자 테마 여부 최종 검증 ───────────────────────────
    const validationPrompt = `다음 입력이 주식 투자 테마인지 판단하세요. JSON만 출력하세요.

투자 테마란: 여러 기업이 수혜를 받는 섹터·산업·정책·기술 흐름입니다.
예시(valid=true): "K-방산", "AI 반도체", "금리 인하 수혜", "스페이스X 관련주", "엔비디아 협력사", "테슬라 부품주"
  → "[비상장·대형사] 관련주/협력사/부품주" 형태는 공개 수혜 기업을 발굴하는 투자 테마로 valid=true
투자 테마가 아닌 것: 단순 사람 이름, 단독 국가명, 의미 없는 단어, 욕설

입력: "${trimmed}"
출력 형식: {"valid":true} 또는 {"valid":false,"reason":"한 문장 이유"}`;

    const validResp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: validationPrompt }] }],
      config: { temperature: 0.0, thinkingConfig: { thinkingBudget: 0 } },
    });

    const validation = safeParseJson<{ valid: boolean; reason?: string }>(validResp.text ?? "");
    if (!validation?.valid) {
      return res.status(400).json({
        error: validation?.reason ?? `'${trimmed}'은(는) 투자 테마로 인식할 수 없습니다.`,
        invalid: true,
      });
    }

    // ── STEP 2A: Gemini — 대형·중형주 발굴 (병렬) ────────────────────────
    const largeCapPrompt = `투자 테마: "${trimmed}"

이 테마의 핵심 수혜 상장 주식 6~8개를 선정하세요 (대형주·중형주 위주).
한국(코스피·코스닥)과 미국(NYSE·NASDAQ) 혼합. 한국 관련 테마면 KR 종목 과반.

※ 테마가 "스페이스X 관련주", "엔비디아 협력사", "테슬라 부품주" 등 비상장·대형사 관련주 형태인 경우:
   해당 기업에 부품·기술·서비스를 실제 납품하거나 핵심 협력 관계인 상장사를 찾으세요.
   추측·기대 수준이 아닌 실제 계약·납품 이력이 있는 기업 우선.

【포함 기준 — 아래 조건을 모두 충족해야 포함】
- 해당 테마 관련 매출·수주·파이프라인이 전체 사업의 30% 이상
- 기업 스스로 해당 테마 제품·서비스를 직접 생산·판매·개발

【절대 포함 금지】
- 지주회사(LG·SK·한화 지주 등): 자회사가 수혜여도 지주 본체는 제외
- 업종 불일치: 방산 테마 → 바이오/제약 불가 / 바이오 테마 → 방산/반도체 불가 / 우주 테마 → 바이오 불가
- "군 의료", "부품 납품 기대", "관련 시장 성장 수혜" 같은 원거리 연결고리
- 간접 수혜, 기대감, 중장기 영향 수준의 기업

ticker 규칙:
- 한국(KR): ticker 필드에 한국어 회사명을 그대로 입력 (예: "LIG넥스원"). 절대 숫자 코드 금지.
- 미국: NYSE·NASDAQ 심볼 (예: "RKLB")

마크다운 없이 JSON만:
{"theme":"${trimmed}","summary":"한 줄 요약","stocks":[{"ticker":"LIG넥스원","name":"LIG넥스원","market":"KR","sector":"방산","rationale":"이유"}]}`;

    // ── STEP 2B: Gemini — 소형·스몰캡 전문기업 발굴 (병렬) ──────────────
    const smallCapPrompt = `투자 테마: "${trimmed}"

이 테마의 소형주·스몰캡 순수전문기업(pure-play) 6~8개를 선정하세요.

【포함 기준 — 모두 충족 필수】
• 기업의 현재 주력 사업이 이 테마 업종과 100% 일치
• 해당 테마 관련 매출·수주·파이프라인이 전체 사업의 50% 이상
• 기업 스스로 해당 테마 제품·서비스를 직접 생산·판매·개발

【절대 포함 금지】
• 대기업(삼성·현대·SK·LG·한화·포스코·롯데·GS) 계열 및 지주회사
• 업종 불일치 — 아래는 절대 금지 예시:
  - 바이오/CMO/제약/GLP 테마 → 게임·IT·소프트웨어·전자·방산·자동차·배터리 기업 불가
  - 방산/무기/K-방산 테마 → 바이오·제약·게임·IT·배터리 기업 불가
  - 반도체/HBM 테마 → 바이오·제약·조선·방산 기업 불가
  - 조선/LNG 테마 → 바이오·게임·IT·반도체 기업 불가
• 기업명만 보고 포함 결정 금지 — 반드시 그 기업의 실제 사업(주력 매출원)으로 판단
• "수혜 기대", "간접 연관", "중장기 가능성" 수준 기업 금지

ticker 규칙:
- 한국(KR): ticker 필드에 한국어 회사명을 그대로 입력 (예: "에코프로비엠"). 절대 숫자 코드 금지.
- 미국: NYSE·NASDAQ 심볼

마크다운 없이 JSON만:
{"stocks":[{"ticker":"에코프로비엠","name":"에코프로비엠","market":"KR","sector":"2차전지","rationale":"이유"}]}`;

    // ── STEP 2C: Gemini — 코스닥 중소형 전문기업 발굴 (병렬) ──────────────
    const midCapKRPrompt = `투자 테마: "${trimmed}"

코스닥·코스피에 상장된 중소형 테마 전문기업 6~8개를 선정하세요 (시총 300억~1조 내외).

【포함 기준 — 모두 충족 필수】
• 반드시 한국(KR) 상장 종목만 — 미국 종목 금지
• 기업의 현재 주력 사업(매출의 40% 이상)이 이 테마 업종과 직접 일치
• 기업 스스로 해당 테마 제품·서비스를 직접 생산·납품

【절대 포함 금지】
• 대기업(삼성·현대·SK·LG·한화·포스코·롯데·GS) 계열 및 순수지주회사
• 업종 불일치 — 아래는 절대 금지 예시:
  - 바이오/CMO/제약/GLP/항암 테마 → 게임·IT·소프트웨어·전자·방산·자동차·배터리 기업 불가
  - 방산/무기/K-방산 테마 → 바이오·제약·게임·IT·배터리·전자 기업 불가
  - 반도체/HBM/파운드리 테마 → 바이오·제약·조선·방산·게임 기업 불가
  - 조선/LNG/해양 테마 → 바이오·게임·IT·반도체·배터리 기업 불가
  - 2차전지/배터리 테마 → 방산·조선·게임·바이오 기업 불가
• 기업 이름만 보고 판단 금지 — 반드시 그 기업의 실제 주력 사업으로 판단
• 간접 수혜·기대감·"고객사 확대 시 수혜 예상" 수준

ticker 규칙:
- 한국(KR): ticker 필드에 한국어 회사명을 그대로 입력 (예: "쎄트렉아이"). 절대 숫자 코드 금지.
- 미국 종목은 이 배치에 포함 금지.

마크다운 없이 JSON만:
{"stocks":[{"ticker":"쎄트렉아이","name":"쎄트렉아이","market":"KR","sector":"위성","rationale":"이유"}]}`;

    const codeMap = getCorpCodeMap();

    const [largeResp, smallResp, midKRResp] = await Promise.all([
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: largeCapPrompt }] }],
        config: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
      }),
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: smallCapPrompt }] }],
        config: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
      }),
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: midCapKRPrompt }] }],
        config: { temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
      }),
    ]);

    const largePart = safeParseJson<DiscoverResult>(largeResp.text ?? "");
    const smallPart = safeParseJson<{ stocks: DiscoverResult["stocks"] }>(smallResp.text ?? "");
    const midKRPart = safeParseJson<{ stocks: DiscoverResult["stocks"] }>(midKRResp.text ?? "");
    if (!largePart?.stocks?.length) throw new Error("parse fail");

    // 세 배치 병합 (중복 ticker 제거)
    const seenTickers = new Set(largePart.stocks.map(s => s.ticker));
    const extraSmall = (smallPart?.stocks ?? []).filter(s => !seenTickers.has(s.ticker));
    extraSmall.forEach(s => seenTickers.add(s.ticker));
    const extraMidKR = (midKRPart?.stocks ?? []).filter(s => !seenTickers.has(s.ticker));
    const result: DiscoverResult = {
      ...largePart,
      stocks: [...largePart.stocks, ...extraSmall, ...extraMidKR],
    };

    // market 정규화: NYSE·NASDAQ·OTC 등 → "US", 그 외 비-KR → "US"
    for (const s of result.stocks) {
      if (s.market !== "KR") s.market = "US";
    }

    if (!result?.stocks?.length) throw new Error("parse fail");

    // ── KR 종목 티커·이름 교정 및 할루시네이션 제거 ──────────────────────────
    {
      // 이름 유사도: 정규화 후 한쪽이 다른 쪽을 포함하거나 한글 2자 이상 공유
      function normName(s: string): string {
        return s
          .toLowerCase()
          .replace(/\s*\(주\)\s*|\s*주식회사\s*|\s*(inc|corp|ltd|co\.?)\.?\s*/gi, "")
          .replace(/[\s\-·,\.]/g, "");
      }
      // 영문 약어 → 한국어 음역 (LS→엘에스, LG→엘지 등)
      const ABBR_KR: Record<string, string> = {
        ls: "엘에스", lg: "엘지", sk: "에스케이", kt: "케이티",
        cj: "씨제이", gs: "지에스", hd: "에이치디", kb: "케이비",
        db: "디비", nh: "엔에이치", kcc: "케이씨씨", oci: "오씨아이",
        posco: "포스코", hyundai: "현대", samsung: "삼성",
      };
      function namesSimilar(a: string, b: string): boolean {
        const na = normName(a);
        const nb = normName(b);
        if (!na || !nb) return true; // 비어 있으면 판단 보류
        if (na.includes(nb) || nb.includes(na)) return true;
        // 한글 3자 이상 교집합 ("대한" 등 2자 공통 접두어는 불충분)
        const krChars = [...na].filter(c => /[가-힣]/.test(c) && nb.includes(c));
        if (krChars.length >= 3) return true;
        // 영문 약어 ↔ 한국어 음역 매칭 (LS ↔ 엘에스일렉트릭)
        const safeA = a.replace(/[\s\-·]/g, "").toLowerCase();
        const safeB = b.replace(/[\s\-·]/g, "").toLowerCase();
        for (const [abbr, kr] of Object.entries(ABBR_KR)) {
          if ((safeA.startsWith(abbr) && nb.startsWith(kr)) ||
              (safeB.startsWith(abbr) && na.startsWith(kr))) return true;
        }
        return false;
      }
      // 이름→코드 매핑 전용: 정확 일치 or 명확한 포함 관계만 허용 (최소 3자)
      function namesSimilarStrict(a: string, b: string): boolean {
        const na = normName(a);
        const nb = normName(b);
        if (!na || !nb) return false;
        if (na === nb) return true; // 정확 일치 (길이 무관)
        const shorter = na.length <= nb.length ? na : nb;
        const longer  = na.length <= nb.length ? nb : na;
        if (shorter.length < 3) return false; // 2자 이하 짧은 이름은 부분 매칭 불가
        return longer.includes(shorter);
      }

      const toRemove = new Set<string>();
      for (const stock of result.stocks) {
        if (stock.market !== "KR") continue;

        if (!/^\d{6}$/.test(stock.ticker)) {
          // ① 비-6자리: Gemini가 회사명을 ticker에 넣은 경우 → KRX 이름으로 매핑
          // namesSimilarStrict(엄격) → 포함 관계만 허용, 3자 이상
          const geminiName = stock.name || stock.ticker;
          const found = krxCache.find(s => namesSimilarStrict(s.name, geminiName));
          if (found) {
            console.log(`[themes] 이름→코드 매핑: "${geminiName}" → ${found.code}(${found.name})`);
            stock.ticker = found.code;
            stock.name   = found.name;
          } else {
            console.log(`[themes] KRX 미매핑 → 제거: "${geminiName}"`);
            toRemove.add(stock.ticker);
            continue;
          }
        } else {
          // ② 6자리: KRX 실명 조회 후 교체·불일치 필터
          const krxEntry = krxCache.find(s => s.code === stock.ticker);
          if (krxEntry) {
            const geminiName = stock.name;
            stock.name = krxEntry.name; // 항상 KRX 실명으로 교체

            // 검증 A: Gemini 이름 ↔ KRX 실명 유사도
            if (!namesSimilar(geminiName, krxEntry.name)) {
              // 코드가 틀렸지만 이름은 맞을 수 있음 → 이름으로 KRX 재탐색 (엄격한 매칭)
              const byName = krxCache.find(s => namesSimilarStrict(s.name, geminiName));
              if (byName && byName.code !== stock.ticker) {
                console.log(
                  `[themes] 티커 교정: ${stock.ticker}(${geminiName}) → ${byName.code}(${byName.name})`
                );
                stock.ticker = byName.code;
                stock.name = byName.name;
                // 교정 성공 → 계속 진행 (제거 안 함)
              } else {
                console.log(
                  `[themes] 티커 불일치(이름) → 제거: ${stock.ticker}` +
                  ` Gemini="${geminiName}" KRX="${krxEntry.name}"`
                );
                toRemove.add(stock.ticker);
                continue;
              }
            }

            // 검증 B: 라셔널에 실제 회사명(KRX)이 없고 다른 회사명이 주어로 쓰이면 할루시네이션
            // (한미반도체 라셔널에 SK하이닉스가 고객사로 언급되는 경우는 정상 → 제거 안 함)
            const rationaleText = stock.rationale ?? "";
            const hasOwnName = rationaleText.includes(krxEntry.name);
            if (!hasOwnName) {
              const aliasHit = krxCache.find(s =>
                s.name.length >= 4 &&
                s.code !== stock.ticker &&
                rationaleText.includes(s.name) &&
                !namesSimilar(s.name, krxEntry.name)
              );
              if (aliasHit) {
                console.log(
                  `[themes] 티커 불일치(라셔널) → 제거: ${stock.ticker} (${krxEntry.name})` +
                  ` 라셔널에 다른 회사 "${aliasHit.name}"(${aliasHit.code}) 언급, 자사명 없음`
                );
                toRemove.add(stock.ticker);
              }
            }
          }
          // KRX에 없는 티커(상장폐지 등)는 통과 (판단 보류)
        }
      }
      if (toRemove.size) {
        result.stocks = result.stocks.filter(s => !toRemove.has(s.ticker));
      }

      // ── KRX DB 섹터 교정: AI 생성 섹터를 krx_stocks 실제 값으로 덮어쓰기 ──
      // AI가 "위장품 ODM" 같은 엉뚱한 섹터를 붙여도 DB 실제 섹터로 교정됨
      {
        const krCodes = result.stocks
          .filter(s => s.market === "KR" && /^\d{6}$/.test(s.ticker))
          .map(s => s.ticker);
        if (krCodes.length > 0) {
          try {
            const { rows } = await pool.query<{ code: string; sector: string }>(
              `SELECT code, sector FROM krx_stocks WHERE code = ANY($1)`,
              [krCodes]
            );
            const dbSectorMap = new Map(rows.map(r => [r.code, r.sector]));
            for (const stock of result.stocks) {
              if (stock.market !== "KR") continue;
              const dbSector = dbSectorMap.get(stock.ticker);
              if (dbSector) {
                if (stock.sector !== dbSector) {
                  console.log(`[themes] 섹터 교정: ${stock.ticker}(${stock.name}) AI="${stock.sector}" → DB="${dbSector}"`);
                }
                stock.sector = dbSector;
              }
            }
          } catch (e: any) {
            console.warn("[themes] krx_stocks 섹터 조회 실패 (무시):", e?.message);
          }
        }
      }

      // US 종목 유효성 검사: 티커가 비ASCII(한글 등) → 잘못된 KR 반환이므로 제거
      result.stocks = result.stocks.filter(s => {
        if (s.market === "US" && !/^[A-Z]{1,6}(\.[A-Z]{1,2})?$/.test(s.ticker)) {
          console.log(`[themes] US 비유효 ticker 제거: "${s.ticker}" (${s.name})`);
          return false;
        }
        return true;
      });
      // 교정 후 중복 제거: ticker 중복 + US 종목 이름 유사 중복
      const seenTickers = new Set<string>();
      const seenUsNames  = new Set<string>(); // 영문 이름 정규화 키
      result.stocks = result.stocks.filter(s => {
        if (seenTickers.has(s.ticker)) {
          console.log(`[themes] 중복 ticker 제거: ${s.ticker} (${s.name})`);
          return false;
        }
        seenTickers.add(s.ticker);
        if (s.market === "US") {
          const nameKey = s.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (seenUsNames.has(nameKey)) {
            console.log(`[themes] 중복 US 이름 제거: ${s.ticker} (${s.name})`);
            return false;
          }
          seenUsNames.add(nameKey);
        }
        return true;
      });
    }

    // KR 종목: DART 업종코드 조회 (병렬)
    const krStocks = result.stocks.filter(s => s.market === "KR");
    await Promise.allSettled(
      krStocks.map(async stock => {
        const code = await getDartIndutyCode(stock.ticker, codeMap);
        if (code) {
          stock.dartIndustry = indutyLabel(code);
          stock.dartVerified = isIndutyRelevant(code, trimmed);
        }
      })
    );

    // 후처리 0: DART 사업보고서 캐시 키워드 매칭 (DB 전용, 빠름)
    {
      const themeKeywords = extractThemeKeywords(trimmed);
      await Promise.allSettled(
        result.stocks
          .filter(s => s.market === "KR")
          .map(async stock => {
            const corpCode = codeMap.get(stock.ticker);
            if (!corpCode) { stock.dartBizMatch = null; return; }
            stock.dartBizMatch = await checkDartBizCached(corpCode, themeKeywords);
          }),
      );
      // 사업보고서가 캐시됐는데 테마 키워드가 0개 → 제거
      result.stocks = result.stocks.filter(stock => {
        if (stock.market === "US") return true;
        if (stock.dartBizMatch === false) {
          console.log(`[themes] dartBizMatch=false → 제거: ${stock.ticker} ${stock.name}`);
          return false;
        }
        return true;
      });
    }

    // 후처리 1: rationale 품질 필터
    // ① 간접 수혜·기대감 표현 — "기대됩니다" 단독 제거(정상 문장 오필터 방지)
    const INDIRECT_PATTERNS = /간접\s*(적인\s*)?(수혜|영향(?!을\s*받))|장기적\s*(으로\s*)?(영향|수혜)|관련\s*산업\s*성장|(수요|공급)\s*(증가|확대)\s*(가\s*)?기대(?!\s*되는\s*공급)|기대감\s*만|기대\s*수준|잠재적\s*수혜|미래\s*(수혜|기대)/;
    // ② 연관 없음·제외 명시
    const NO_RELATION_PATTERNS = /연관성이\s*(없|낮)|직접적인\s*(연관|관련)\s*(없|낮)|관련(이|성이)\s*없|테마와\s*무관|제외됩니다|제외\s*대상|수혜\s*종목이\s*아니/;
    // ③ 지주회사·자회사 경유 간접 수혜
    const HOLDINGCO_PATTERNS = /지주(회사)?\s*(로서|로\s*서)|(자회사|계열사)의?\s*(실적|매출|영향|성과)\s*(이|이\s*)?(반영|영향)/;
    result.stocks = result.stocks.filter(s => {
      const rat = s.rationale ?? "";
      if (INDIRECT_PATTERNS.test(rat)) {
        console.log(`[themes] 간접수혜·기대감 → 제거: ${s.ticker} ${s.name}`);
        return false;
      }
      if (NO_RELATION_PATTERNS.test(rat)) {
        console.log(`[themes] 연관 없음 명시 → 제거: ${s.ticker} ${s.name}`);
        return false;
      }
      if (HOLDINGCO_PATTERNS.test(rat)) {
        console.log(`[themes] 지주·자회사 경유 → 제거: ${s.ticker} ${s.name}`);
        return false;
      }
      return true;
    });

    // 후처리 2: dartIndustry 텍스트 기반 명백 업종 불일치 제거
    {
      const BIOTECH_KW   = ["바이오", "제약", "치료제", "glp", "mrna", "백신", "임상", "cmo", "위탁생산"];
      const SEMI_KW      = ["반도체", "hbm", "메모리", "파운드리", "웨이퍼", "칩"];
      const SHIP_KW      = ["조선", "선박", "해양"];
      const AUTO_KW      = ["자동차", "전기차", "ev "];
      const BATTERY_KW   = ["배터리", "2차전지", "전고체"];

      // 섹터 → 해당 섹터와 어울리지 않는 테마 키워드
      const GAME_KW = ["소프트웨어", "게임", "인터넷", "정보처리", "it서비스", "플랫폼", "컨텐츠"];

      const BLOCKLIST: Array<{ sectorIncludes: string[]; badThemeKW: string[] }> = [
        { sectorIncludes: ["반도체", "전자부품", "컴퓨터", "통신장비"],  badThemeKW: BIOTECH_KW },
        { sectorIncludes: GAME_KW,                                     badThemeKW: [...BIOTECH_KW, "방산", "k-방산", "조선", "hvdc", "변압기"] },
        { sectorIncludes: ["의약품", "의료기기"],                       badThemeKW: [...SEMI_KW, ...SHIP_KW, ...AUTO_KW, ...BATTERY_KW, "방산", "변압기", "전력", "인프라", "데이터센터", "ai 전력", "우주", "위성", "발사체", "항공우주", "로켓"] },
        { sectorIncludes: ["조선"],                                    badThemeKW: [...BIOTECH_KW, ...SEMI_KW, ...BATTERY_KW] },
        { sectorIncludes: ["자동차", "항공"],                           badThemeKW: [...BIOTECH_KW, "hvdc", "변압기", "전력인프라", "방산", "k-방산", "k방산", "방위산업", "무기", "전차", "함정", "lng선", "조선", "금융", "은행"] },
        { sectorIncludes: ["화학"],                                    badThemeKW: BIOTECH_KW },
        { sectorIncludes: ["전기장비", "전지", "배터리"],                 badThemeKW: [...BIOTECH_KW, "방산", "k-방산", "k방산", "방위산업", "무기", "탄약", "함정", "전차"] },
      ];

      const thm = trimmed.toLowerCase();
      result.stocks = result.stocks.filter(stock => {
        if (stock.market === "US") return true;
        const di = (stock.dartIndustry ?? "").toLowerCase();
        if (!di || di === "기타") return true;
        for (const rule of BLOCKLIST) {
          const sectorHit = rule.sectorIncludes.some(s => di.includes(s));
          const themeHit  = rule.badThemeKW.some(k => thm.includes(k));
          if (sectorHit && themeHit) return false;
        }
        return true;
      });
    }

    // ── KRX 섹터 기반 명백 불일치 제거 (API 없이, krx_stocks DB 값 사용) ─────
    // 예: 운송장비·부품(한국타이어) → 헬스케어 테마 제거
    {
      const thm = trimmed.toLowerCase();

      const isHealthTheme   = ["헬스케어", "헬스 케어", "의약", "바이오", "제약", "의료", "헬스"].some(k => thm.includes(k));
      const isSemiTheme     = ["반도체", "hbm", "메모리", "파운드리"].some(k => thm.includes(k));
      const isShipTheme     = ["조선", "lng선", "컨테이너선"].some(k => thm.includes(k));
      const isDefenseTheme  = ["방산", "k-방산", "방위산업", "k방산"].some(k => thm.includes(k));
      const isFinanceTheme  = ["금융", "은행", "보험", "증권", "핀테크"].some(k => thm.includes(k));
      const isGameTheme     = ["게임", "gaming", "모바일게임"].some(k => thm.includes(k));

      // 헬스케어 테마에서 허용되는 섹터
      const HEALTH_OK = new Set(["제약", "의료·정밀기기", "생활용품", "음식료·담배", "화학"]);
      // 반도체 테마에서 허용되는 섹터
      const SEMI_OK   = new Set(["전기·전자", "IT 서비스", "화학", "기계·장비"]);
      // 조선 테마에서 허용되는 섹터
      const SHIP_OK   = new Set(["운송장비·부품", "기계·장비", "금속", "화학", "전기·전자"]);
      // 방산 테마에서 허용되는 섹터
      const DEF_OK    = new Set(["기계·장비", "운송장비·부품", "전기·전자", "IT 서비스", "항공", "화학"]);
      // 금융 테마에서 허용되는 섹터
      const FIN_OK    = new Set(["금융", "기타금융", "증권", "보험", "은행", "IT 서비스"]);
      // 게임 테마에서 허용되는 섹터
      const GAME_OK   = new Set(["IT 서비스", "전기·전자", "오락·문화"]);

      result.stocks = result.stocks.filter(stock => {
        if (stock.market !== "KR") return true;
        const sector = (stock.sector ?? "").trim();
        if (!sector) return true; // 섹터 없으면 판단 보류

        let blocked = false;
        if (isHealthTheme  && !HEALTH_OK.has(sector)) blocked = true;
        // 헬스케어 테마: 화학 섹터이지만 타이어·자동차 관련 업종은 명시적 차단
        if (isHealthTheme && sector === "화학") {
          const nm = (stock.name ?? "").toLowerCase();
          if (["타이어", "tire", "자동차", "auto", "rubber", "고무"].some(kw => nm.includes(kw))) {
            blocked = true;
          }
        }
        if (isSemiTheme    && !SEMI_OK.has(sector))   blocked = true;
        if (isShipTheme    && !SHIP_OK.has(sector))   blocked = true;
        if (isDefenseTheme && !DEF_OK.has(sector))    blocked = true;
        if (isFinanceTheme && !FIN_OK.has(sector))    blocked = true;
        if (isGameTheme    && !GAME_OK.has(sector))   blocked = true;

        if (blocked) {
          console.log(`[themes] KRX 섹터 불일치 → 제거: ${stock.ticker} ${stock.name} (sector=${sector}, theme="${trimmed}")`);
          return false;
        }
        return true;
      });
    }

    if (!result.stocks.length) throw new Error("no verified stocks");

    // ── STEP 3: AI 최종 관련성 검증 패스 ────────────────────────────────────
    // 발굴·필터를 통과한 종목들을 Gemini가 한 번 더 검토해 확실한 무관 종목 제거
    if (result.stocks.length > 0) {
      try {
        const stockList = result.stocks
          .map(s => `- ${s.ticker} ${s.name} (${s.market}, 업종: ${s.sector ?? "미분류"})`)
          .join("\n");

        const verifyPrompt = `투자 테마: "${trimmed}"

아래 종목들이 이 테마의 실질적 수혜주인지 판단하세요.

【테마 유형별 keep=true 기준】

A) "[사명] 관련주" 형태 (예: "스페이스X 관련주", "엔비디아 협력사"):
   - 해당 사명이 대표하는 산업 생태계 전체가 대상
   - "스페이스X 관련주" → 우주발사체·위성·우주서비스 기업 전체 (RKLB·ASTS·PL·SPCE 등) keep=true
   - "엔비디아 협력사" → 반도체·HBM·AI서버·패키징 기업 keep=true
   - 해당 산업과 완전히 무관한 업종만 keep=false (우주 테마에 바이오, 방산 테마에 제약 등)

B) 일반 테마 (예: "K-방산", "전고체 배터리"):
   - 해당 테마 관련 제품·서비스를 기업이 직접 생산·납품·개발
   - 업종이 테마와 명백히 불일치하는 경우만 keep=false

【항상 keep=false】
- 지주회사 본체 (자회사가 수혜여도 지주 자체 제외)
- 테마 산업과 업종이 완전히 다른 기업 (방산 테마의 순수 바이오/제약사 등)
- 파산·운영중단·사실상 상장폐지 기업 (예: Virgin Galactic SPCE 파산, Astra Space ASTR 발사중단, ABL Space 폐업, Momentus MNTS 파산 등)

종목 목록:
${stockList}

마크다운 없이 JSON 배열만 출력:
[{"ticker":"079550","keep":true},{"ticker":"000660","keep":false}]`;

        const verifyResp = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: verifyPrompt }] }],
          config: { temperature: 0.0, thinkingConfig: { thinkingBudget: 0 } },
        });

        const verdicts = safeParseJson<Array<{ ticker: string; keep: boolean }>>(verifyResp.text ?? "");
        if (verdicts && Array.isArray(verdicts)) {
          const keepSet = new Set(
            verdicts.filter(v => v.keep !== false).map(v => v.ticker)
          );
          const removedSet = new Set(
            verdicts.filter(v => v.keep === false).map(v => v.ticker)
          );
          // 검증 결과에 없는 티커는 통과 (안전)
          result.stocks = result.stocks.filter(s => {
            if (removedSet.has(s.ticker)) {
              console.log(`[themes] AI 검증 탈락 → 제거: ${s.ticker} ${s.name}`);
              return false;
            }
            return true;
          });
          console.log(`[themes] AI 검증 완료 — 유지: ${keepSet.size}, 제거: ${removedSet.size}`);
        }
      } catch (e: any) {
        console.warn("[themes] AI 검증 패스 실패 (건너뜀):", e?.message);
      }
    }

    if (!result.stocks.length) throw new Error("no verified stocks");

    // ── CACHE SAVE (theme_stock_cache 24h + system_cache 폴백) ───────────────
    try {
      const expiresAt = new Date(Date.now() + THEME_CACHE_TTL);
      const dataStr = JSON.stringify(result);
      await pool.query(
        `INSERT INTO theme_stock_cache (theme_key, theme_name, data, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (theme_key) DO UPDATE SET data = $3, expires_at = $4, created_at = NOW()`,
        [themeCacheKey, trimmed, dataStr, expiresAt]
      );
      // system_cache에도 저장 (레거시 호환)
      await pool.query(
        `INSERT INTO system_cache (key, data, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET data = $2, expires_at = $3`,
        [themeCacheKey, dataStr, expiresAt]
      ).catch(() => {});
      console.log(`[themes] 캐시 저장: "${trimmed}" (24시간, ${result.stocks.length}개 종목)`);
    } catch (e: any) {
      console.warn("[themes] 캐시 저장 실패 (무시):", e?.message);
    }

    return res.json(result);
  } catch (e) {
    console.error("[themes/discover]", e);
    return res.status(500).json({ error: "테마 발굴 중 오류가 발생했습니다. 다시 시도해주세요." });
  }
});

export default router;
