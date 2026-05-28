import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import AdmZip from "adm-zip";
import { pool } from "@workspace/db";
import { loadKRXList } from "../lib/krx-cache";

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
}

interface DiscoverResult {
  theme: string;
  summary: string;
  stocks: DiscoveredStock[];
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

let trendingCache: { themes: TrendingTheme[]; cachedAt: number } | null = null;
const TRENDING_TTL = 3 * 60 * 60 * 1000;

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
  { id: "shipbuilding_lng",  name: "조선 LNG선",       description: "LNG 운반선 수주잔고 역대 최고",       emoji: "🚢" },
  { id: "value_up_bank",     name: "밸류업 금융주",    description: "자사주 소각·배당 확대 정책 수혜",     emoji: "🏦" },
  { id: "ai_agent_infra",    name: "AI 에이전트 인프라", description: "추론 모델 확산으로 서버·스토리지 수요", emoji: "🤖" },
  { id: "tariff_reroute",    name: "관세 우회 물류",   description: "미중 관세로 공급망 재편·물류 수혜",   emoji: "🌐" },
  { id: "battery_solid",     name: "전고체 배터리",    description: "2027 양산 경쟁·소재·장비주 선반영",   emoji: "🔋" },
];

router.get("/themes/trending", async (_req, res) => {
  try {
    if (trendingCache && Date.now() - trendingCache.cachedAt < TRENDING_TTL) {
      return res.json(trendingCache.themes);
    }

    const today = new Date().toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric",
    });

    const prompt = `${today} 기준으로 최근 1~2주간 한국·글로벌 주식시장에서 기관·외국인 수급이 실제로 몰린 테마와 섹터 8개를 선정해주세요.

조건:
- "AI 반도체", "바이오", "2차전지" 같은 상시 포괄 테마는 피하세요
- 구체적인 드라이버가 있는 테마여야 합니다 (예: 트럼프 관세 → K-방산 수출 수혜, 데이터센터 전력 부족 → HVDC·변압기, 비만치료제 GLP-1 확산 → CMO·원료의약품)
- 최근 실적·수주·정책 이슈로 섹터 로테이션이 일어난 경우 우선
- 한국 코스피·코스닥과 미국 시장을 모두 커버

마크다운 없이 아래 JSON 배열만 출력하세요:
[{"id":"영문_스네이크","name":"한글 테마명(10자 이내)","description":"수급 이유 한 줄(20자 이내)","emoji":"이모지"}]`;

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
    });

    const themes = safeParseJson<TrendingTheme[]>(resp.text ?? "");
    if (!themes || !Array.isArray(themes) || themes.length === 0) throw new Error("parse fail");

    trendingCache = { themes, cachedAt: Date.now() };
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

    const prompt = `투자 테마: "${theme}"

이 테마의 수혜 상장 주식 6~8개를 선정하세요.
한국(코스피·코스닥)과 미국(NYSE·NASDAQ)을 적절히 혼합해 추천. 한국 테마면 KR 종목을 과반 이상 포함.

ticker 규칙 (반드시 준수):
- 한국 주식: 반드시 6자리 숫자 코드 (예: "005930", "079550", "012450"). 회사 이름을 ticker로 쓰지 말 것.
- 미국 주식: NYSE·NASDAQ 심볼 (예: "AAPL", "LMT")

조건:
- 해당 테마가 매출의 핵심 부분을 차지하거나, 테마 관련 제품·기술·파이프라인을 실제로 보유한 기업만 포함
- "공급 가능성", "간접 수혜 예상", "향후 참여 가능" 같은 추측성 연결고리 절대 금지
- 자동차·물류·유통 기업이 핵심 사업과 무관한 이유로 포함되지 않도록 주의

마크다운 없이 아래 JSON만 출력하세요:
{"theme":"${theme}","summary":"테마 한 줄 요약","stocks":[{"ticker":"079550","name":"LIG넥스원","market":"KR","sector":"방산","rationale":"유도무기·레이더 핵심 생산"}]}`;

    const codeMap = getCorpCodeMap();

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
    });

    const result = safeParseJson<DiscoverResult>(resp.text ?? "");
    if (!result?.stocks?.length) throw new Error("parse fail");

    // KR 종목: 6자리 숫자 아닌 ticker는 KRX 이름 검색으로 교정
    const krxList = await loadKRXList().catch(() => []);
    for (const stock of result.stocks) {
      if (stock.market === "KR" && !/^\d{6}$/.test(stock.ticker)) {
        const found = krxList.find(s =>
          s.name.replace(/\s|\(주\)|주식회사\s*/g, "").includes(stock.ticker.replace(/\s/g, "")) ||
          stock.ticker.replace(/\s/g, "").includes(s.name.replace(/\s|\(주\)|주식회사\s*/g, ""))
        );
        if (found) stock.ticker = found.code;
        else stock.market = "US"; // 해결 못하면 US로 변경해 DART 필터 회피
      }
    }

    // KR 종목: DART 업종코드 조회 (병렬)
    const krStocks = result.stocks.filter(s => s.market === "KR");
    await Promise.allSettled(
      krStocks.map(async stock => {
        const code = await getDartIndutyCode(stock.ticker, codeMap);
        if (code) {
          stock.dartIndustry = indutyLabel(code);
          stock.dartVerified = isIndutyRelevant(code, theme);
        }
      })
    );

    // KR 종목: DART 업종 확인된 것만 포함 (업종 조회 실패 시 폴백)
    result.stocks = result.stocks.filter(stock => {
      if (stock.market === "US") return true;
      if (stock.dartIndustry === undefined) return true; // DART 조회 실패 시 폴백
      return stock.dartVerified === true;
    });

    if (!result.stocks.length) throw new Error("no verified stocks");

    return res.json(result);
  } catch (e) {
    console.error("[themes/discover]", e);
    return res.status(500).json({ error: "테마 발굴 중 오류가 발생했습니다. 다시 시도해주세요." });
  }
});

export default router;
