import { Router } from "express";
import { fetchECOSMacro } from "../lib/ecos-client.js";
import { fetchFREDMacro } from "../lib/fred-client.js";
import YahooFinanceClass from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";
const yahooFinance = new YahooFinanceClass();

const router = Router();

router.get("/macro", async (_req, res) => {
  try {
    const [ecos, fred] = await Promise.all([fetchECOSMacro(), fetchFREDMacro()]);
    res.json({ ecos, fred, fetchedAt: Date.now() });
  } catch {
    res.status(500).json({ error: "거시지표 조회 실패" });
  }
});

/* ── 매크로 뉴스 피드 ─────────────────────────────────────────────────── */

export interface MacroNewsItem {
  title: string;
  source: string;
  pubDate: string; // ISO
  url: string;
  category: "경제" | "증권" | "국제" | "산업" | "부동산" | "기타";
  tags: string[];   // 관련 종목 및 이슈 키워드
}

const macroNewsCache = new Map<string, { ts: number; items: MacroNewsItem[] }>();
const MACRO_NEWS_TTL = 8 * 60 * 1000; // 8분

/* ── RSS 소스 정의 ─────────────────────────────────────────────────────── */
interface RssSource {
  url: string;
  source: string;
  category: MacroNewsItem["category"];
}

const RSS_SOURCES: RssSource[] = [
  // 한국경제
  { url: "https://www.hankyung.com/feed/economy",       source: "한국경제",       category: "경제" },
  { url: "https://www.hankyung.com/feed/finance",       source: "한국경제(증권)", category: "증권" },
  { url: "https://www.hankyung.com/feed/international", source: "한국경제(국제)", category: "국제" },
  { url: "https://www.hankyung.com/feed/realestate",    source: "한국경제(부동산)", category: "부동산" },
  // 매일경제
  { url: "https://www.mk.co.kr/rss/30100041/",          source: "매일경제",       category: "경제" },
  { url: "https://www.mk.co.kr/rss/40300001/",          source: "매일경제(증권)", category: "증권" },
  // 연합뉴스
  { url: "https://www.yna.co.kr/rss/economy.xml",       source: "연합뉴스",       category: "경제" },
  { url: "https://www.yna.co.kr/rss/finance.xml",       source: "연합뉴스(금융)", category: "증권" },
  // 뉴시스
  { url: "https://www.newsis.com/RSS/economy.xml",      source: "뉴시스",         category: "경제" },
  // 서울경제 (URL 수정)
  { url: "https://www.sedaily.com/RSS/Economy",         source: "서울경제",       category: "경제" },
];

/* ── 관련 태그 추출 ────────────────────────────────────────────────────── */
const STOCK_KEYWORDS: string[] = [
  "삼성전자", "SK하이닉스", "LG에너지솔루션", "현대차", "기아",
  "POSCO", "포스코", "카카오", "네이버", "셀트리온", "삼성바이오로직스",
  "현대모비스", "LG화학", "삼성SDI", "SK이노베이션", "한화", "롯데",
  "크래프톤", "넷마블", "두산에너빌리티", "HD현대", "KT", "SK텔레콤", "LG전자",
];

const ISSUE_KEYWORDS: string[] = [
  "금리", "환율", "물가", "인플레이션", "반도체", "AI", "인공지능",
  "배터리", "전기차", "부동산", "수출", "수입", "관세", "무역",
  "석유", "유가", "원자재", "달러", "원달러", "미중", "무역분쟁",
  "중국", "일본", "연준", "Fed", "기준금리", "국고채", "채권",
  "코스피", "코스닥", "나스닥", "S&P", "어닝", "실적", "IPO", "공모",
  "배당", "바이오", "제약", "조선", "철강", "자동차", "반도체", "디스플레이",
  "2차전지", "리튬", "구리", "금", "은", "원자력", "태양광", "수소",
];

function extractTags(title: string): string[] {
  const tags: string[] = [];
  for (const kw of STOCK_KEYWORDS) {
    if (title.includes(kw)) tags.push(kw);
    if (tags.length >= 3) break;
  }
  for (const kw of ISSUE_KEYWORDS) {
    if (title.includes(kw) && !tags.includes(kw)) {
      tags.push(kw);
      if (tags.length >= 5) break;
    }
  }
  return tags;
}

/* ── 금융·경제 관련성 필터 ─────────────────────────────────────────────── */
// 제목에 아래 키워드 중 하나라도 포함돼야 통과
// ※ 단어 경계가 명확한 금융 전용 표현만 사용 (AI, 배터리, 외국인 등 다의어 제외)
const FINANCIAL_KEYWORDS: string[] = [
  // 시장·지수
  "주가", "주식", "증권", "코스피", "코스닥", "나스닥", "S&P500", "다우존스",
  "상장주", "공모주", "IPO", "ETF", "인덱스펀드", "펀드",
  // 거시경제
  "금리", "기준금리", "환율", "원달러", "달러화", "원화가치", "물가", "인플레이션",
  "CPI", "PPI", "GDP", "경제성장률", "수출입", "무역수지", "무역전쟁", "관세",
  "경상수지", "국채", "채권", "국고채", "통안채", "회사채",
  // 정책·기관
  "한국은행", "연준", "Fed", "FOMC", "금통위", "기재부", "금융위", "금감원", "중앙은행",
  "통화정책", "재정정책", "양적완화", "긴축정책", "피벗",
  // 기업·실적
  "실적", "매출액", "영업이익", "순이익", "어닝", "영업손실", "흑자전환", "적자전환",
  "배당금", "자사주", "유상증자", "무상증자", "합병", "인수합병", "M&A", "지분",
  "공시", "사업보고서",
  // 업종·산업 (금융 맥락이 분명한 표현)
  "반도체", "전기차", "2차전지", "리튬이온", "바이오", "바이오주", "제약", "제약주",
  "은행주", "보험주", "건설", "건설주", "부동산투자", "리츠",
  "유가", "원유", "국제유가", "두바이유", "WTI", "브렌트유",
  "원자재", "구리값", "금값", "금시세", "리튬", "희토류",
  "조선업", "철강", "해운주", "해운업", "항공주", "디스플레이",
  "인공지능주", "AI반도체", "AI주", "데이터센터",
  "우주항공", "방산", "머스크", "스페이스X", "테슬라", "엔비디아", "애플", "구글", "메타", "아마존",
  // 주요 기업명 (대형주 직접 언급)
  "삼성전자", "SK하이닉스", "LG에너지솔루션", "현대차", "기아차",
  "포스코", "카카오", "네이버", "셀트리온", "삼성바이오",
  "현대모비스", "LG화학", "삼성SDI", "SK이노베이션",
  "한화에어로", "두산에너빌", "신한금융", "KB금융", "하나금융", "우리금융",
  // 투자·매매 행위
  "순매수", "순매도", "공매도", "선물시장", "옵션시장",
  "개인투자자", "기관투자", "외국인투자", "사모펀드", "헤지펀드",
  "수익률", "변동성", "시가총액",
  // 글로벌 이슈
  "미중갈등", "공급망", "반도체규제", "수출규제",
  // 지정학·국제 이슈 (시장에 직접 영향을 주는 이슈)
  "트럼프", "바이든", "관세전쟁", "무역마찰", "보호무역",
  "이란", "중동", "이스라엘", "하마스", "오일쇼크",
  "러시아", "우크라이나", "전쟁리스크", "지정학",
  "OPEC", "G7", "G20", "IMF", "세계은행", "BIS",
  "달러패권", "기축통화", "디커플링", "리쇼어링", "니어쇼어링",
  "경제제재", "금수조치", "수출통제",
];

const FINANCIAL_KW_RE = new RegExp(FINANCIAL_KEYWORDS.join("|"));

function isFinanciallyRelevant(title: string): boolean {
  return FINANCIAL_KW_RE.test(title);
}

/* ── RSS 파싱 ──────────────────────────────────────────────────────────── */
function parseRss(xml: string, src: RssSource): MacroNewsItem[] {
  const items: MacroNewsItem[] = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const titleMatch =
      block.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/) ??
      block.match(/<title>([^<]{4,})<\/title>/);
    const title = titleMatch?.[1]
      ?.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, "").trim() ?? "";
    if (!title || title.length < 5) continue;
    if (!isFinanciallyRelevant(title)) continue;

    const linkMatch =
      block.match(/<link>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/link>/) ??
      block.match(/<link>([^<]+)<\/link>/) ??
      block.match(/<guid[^>]*>([^<]+)<\/guid>/);
    const url = linkMatch?.[1]?.trim() ?? "";

    const pubMatch = block.match(/<pubDate>([^<]+)<\/pubDate>/);
    let pubDate = new Date().toISOString();
    if (pubMatch?.[1]) {
      const parsed = new Date(pubMatch[1].trim());
      if (!isNaN(parsed.getTime())) pubDate = parsed.toISOString();
    }

    items.push({
      title,
      source: src.source,
      pubDate,
      url,
      category: src.category,
      tags: extractTags(title),
    });
  }
  return items;
}

async function fetchRss(src: RssSource): Promise<MacroNewsItem[]> {
  try {
    const r = await fetch(src.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const text = await r.text();
    return parseRss(text, src);
  } catch {
    return [];
  }
}

router.get("/macro/news", async (req, res) => {
  const force = req.query.force === "true";
  const cached = macroNewsCache.get("global");
  if (!force && cached && Date.now() - cached.ts < MACRO_NEWS_TTL) {
    res.json({ items: cached.items, cachedAt: new Date(cached.ts).toISOString() });
    return;
  }

  try {
    const results = await Promise.all(RSS_SOURCES.map(s => fetchRss(s)));

    // 소스별 최대 20건 제한 (특정 언론사 독점 방지)
    const SOURCE_MAX = 20;
    const sourceCount = new Map<string, number>();
    const balanced: MacroNewsItem[] = [];
    for (const items of results) {
      // 각 소스 결과를 최신순 정렬 후 상위 SOURCE_MAX건만 취함
      const sorted = [...items].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
      for (const item of sorted) {
        const cnt = sourceCount.get(item.source) ?? 0;
        if (cnt >= SOURCE_MAX) continue;
        sourceCount.set(item.source, cnt + 1);
        balanced.push(item);
      }
    }

    // 중복 제거 (URL 또는 제목 앞 24자 기준)
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const deduped: MacroNewsItem[] = [];
    for (const item of balanced) {
      const tk = item.title.slice(0, 24);
      if (item.url && seenUrls.has(item.url)) continue;
      if (seenTitles.has(tk)) continue;
      if (item.url) seenUrls.add(item.url);
      seenTitles.add(tk);
      deduped.push(item);
    }

    // 최신순 정렬
    deduped.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const items = deduped.slice(0, 150);

    macroNewsCache.set("global", { ts: Date.now(), items });
    res.json({ items, cachedAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "매크로 뉴스 조회 실패" });
  }
});

// ─── GET /api/macro/dashboard ────────────────────────────────────────────────

const MACRO_DASH_TTL = 20 * 60 * 1000; // 20분
let _macroDashCache: { data: any; expiresAt: number } | null = null;

interface DashItem {
  id: string; cat: string; name: string; nameEn: string;
  symbol: string; unit: string; flag: string; isInverse?: boolean;
}

const SYMBOLS: DashItem[] = [
  // 글로벌 시장
  { id: "sp500",    cat: "markets",      name: "S&P 500",      nameEn: "S&P 500",      symbol: "^GSPC",     unit: "pt",  flag: "🇺🇸" },
  { id: "nasdaq",   cat: "markets",      name: "나스닥",         nameEn: "NASDAQ",        symbol: "^IXIC",     unit: "pt",  flag: "🇺🇸" },
  { id: "dow",      cat: "markets",      name: "다우존스",       nameEn: "Dow Jones",     symbol: "^DJI",      unit: "pt",  flag: "🇺🇸" },
  { id: "nikkei",   cat: "markets",      name: "닛케이 225",    nameEn: "Nikkei 225",    symbol: "^N225",     unit: "pt",  flag: "🇯🇵" },
  { id: "shanghai", cat: "markets",      name: "상해종합",       nameEn: "Shanghai",      symbol: "000001.SS", unit: "pt",  flag: "🇨🇳" },
  { id: "hsi",      cat: "markets",      name: "항셍지수",       nameEn: "Hang Seng",     symbol: "^HSI",      unit: "pt",  flag: "🇭🇰" },
  { id: "stoxx",    cat: "markets",      name: "Euro Stoxx 50", nameEn: "Euro Stoxx 50", symbol: "^STOXX50E", unit: "pt",  flag: "🇪🇺" },
  { id: "kospi",    cat: "markets",      name: "코스피",         nameEn: "KOSPI",         symbol: "^KS11",     unit: "pt",  flag: "🇰🇷" },
  // 원자재
  { id: "wti",      cat: "commodities",  name: "WTI 원유",      nameEn: "WTI Crude",     symbol: "CL=F",      unit: "$/bbl", flag: "🛢️" },
  { id: "brent",    cat: "commodities",  name: "Brent 원유",    nameEn: "Brent",         symbol: "BZ=F",      unit: "$/bbl", flag: "🛢️" },
  { id: "gold",     cat: "commodities",  name: "금",            nameEn: "Gold",          symbol: "GC=F",      unit: "$/oz", flag: "🥇" },
  { id: "silver",   cat: "commodities",  name: "은",            nameEn: "Silver",        symbol: "SI=F",      unit: "$/oz", flag: "🥈" },
  { id: "copper",   cat: "commodities",  name: "구리",           nameEn: "Copper",        symbol: "HG=F",      unit: "$/lb", flag: "🔶" },
  { id: "natgas",   cat: "commodities",  name: "천연가스",       nameEn: "Nat Gas",       symbol: "NG=F",      unit: "$/MMBtu", flag: "⛽" },
  { id: "corn",     cat: "commodities",  name: "옥수수",         nameEn: "Corn",          symbol: "ZC=F",      unit: "¢/bu", flag: "🌽" },
  { id: "wheat",    cat: "commodities",  name: "밀",            nameEn: "Wheat",         symbol: "ZW=F",      unit: "¢/bu", flag: "🌾" },
  // 환율
  { id: "dxy",      cat: "currencies",   name: "달러 인덱스",    nameEn: "DXY",           symbol: "DX-Y.NYB",  unit: "",    flag: "💵" },
  { id: "usdkrw",   cat: "currencies",   name: "원/달러",        nameEn: "USD/KRW",       symbol: "KRW=X",     unit: "₩",   flag: "🇰🇷" },
  { id: "eurusd",   cat: "currencies",   name: "EUR/USD",       nameEn: "EUR/USD",       symbol: "EURUSD=X",  unit: "",    flag: "🇪🇺" },
  { id: "usdjpy",   cat: "currencies",   name: "달러/엔",        nameEn: "USD/JPY",       symbol: "JPY=X",     unit: "¥",   flag: "🇯🇵" },
  { id: "usdcnh",   cat: "currencies",   name: "달러/위안",      nameEn: "USD/CNH",       symbol: "CNH=X",     unit: "¥",   flag: "🇨🇳" },
  // 채권/금리
  { id: "us10y",    cat: "rates",        name: "미국 10Y",      nameEn: "US 10Y",        symbol: "^TNX",      unit: "%",   flag: "🇺🇸" },
  { id: "us30y",    cat: "rates",        name: "미국 30Y",      nameEn: "US 30Y",        symbol: "^TYX",      unit: "%",   flag: "🇺🇸" },
  { id: "us5y",     cat: "rates",        name: "미국 5Y",       nameEn: "US 5Y",         symbol: "^FVX",      unit: "%",   flag: "🇺🇸" },
  // 한국 시장 (코스닥)
  { id: "kosdaq",   cat: "korea",        name: "코스닥",         nameEn: "KOSDAQ",        symbol: "^KQ11",     unit: "pt",  flag: "🇰🇷" },
];

async function fetchYFQuote(sym: DashItem): Promise<{ value: number | null; change1d: number | null; prevClose: number | null }> {
  try {
    const q = await (yahooFinance as any).quote(sym.symbol, undefined, { validateResult: false });
    const value = q?.regularMarketPrice ?? null;
    const change1d = q?.regularMarketChangePercent ?? null;
    const prevClose = q?.regularMarketPreviousClose ?? null;
    return { value, change1d, prevClose };
  } catch (e: any) {
    console.warn(`[macro/dashboard] YF quote 실패 (${sym.symbol}): ${e?.message?.slice(0, 60)}`);
    return { value: null, change1d: null, prevClose: null };
  }
}

/** 거시 스냅샷을 Gemini에 보내 인사이트 생성 */
async function generateMacroInsights(snapshot: string): Promise<{ narrative: string; insights: any[] }> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) return { narrative: "", insights: [] };
  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const prompt = `당신은 글로벌 매크로 전략가이자 장기 투자 전문가입니다.
아래 실시간 시장 데이터를 읽고, 현재 거시경제 국면이 어떤 구조적 메가트렌드와 맞닿아 있는지 분석하세요.

=== 실시간 시장 데이터 ===
${snapshot}

=== 분석 원칙 ===

[narrative — 현재 국면 요약]
- 오늘 데이터가 시사하는 거시적 흐름(금리 사이클, 달러 방향, 경기 사이클 위치, 원자재 신호)을 4~5문장으로 서술
- 구체적 수치를 반드시 인용하고, 단기 등락이 아닌 중장기 투자자에게 의미 있는 시사점을 중심으로 작성
- "~합니다" 체 사용

[insights — 메가트렌드 ETF 전략]
아래 메가트렌드 목록 중, 현재 데이터가 뒷받침하거나 도전하는 테마를 3~5개 선별하세요:
  • AI·반도체 혁명: 나스닥/기술주 흐름, 반도체 수요 신호
  • 에너지 전환: 원유 가격, 탄소중립 정책, 재생에너지 수요
  • 탈달러·금 헤지: DXY 방향, 금 가격, 신흥국 통화 흐름
  • 금리 사이클 전환: 미국 10Y·기준금리, 장단기 스프레드 방향
  • 지정학적 분절화: 원자재 공급망 리스크, 중국·EU 시장 분기
  • 인플레이션 지속: CPI·원자재·환율 복합 압력
  • 한국 수출·반도체: 원/달러 환율, 코스피·코스닥 흐름, 삼성·SK하이닉스 연동
  • 고령화·헬스케어: 실업률·GDP와 소비 패턴 변화
  • 신흥시장 부활: 달러 약세·원자재 강세 시 이머징 수혜

각 인사이트는:
- 해당 메가트렌드가 현재 데이터로 어떻게 확인되는지 (수치 인용)
- 어떤 ETF로 포지션을 잡을 수 있는지 (국내+미국 혼합 추천)
- sentiment는 현재 데이터 기준 해당 테마의 투자 매력도 (positive=지금 유리, negative=역풍, neutral=관망, mixed=혼조)

다음 형식의 JSON으로만 응답하세요 (코드블록·설명 없이):
{
  "narrative": "현재 거시 국면과 중장기 시사점을 담은 4~5문장 (수치 포함)",
  "insights": [
    {
      "theme": "메가트렌드명 (한국어, 10자 이내)",
      "themeEn": "Megatrend name (English)",
      "description": "현재 데이터가 이 트렌드를 어떻게 뒷받침하는지 (2문장, 수치 인용)",
      "sentiment": "positive|negative|neutral|mixed",
      "krETFs": [
        { "ticker": "KR ETF 종목코드 (6자리 숫자)", "name": "ETF 정식명칭", "reason": "추천 이유 (15자 이내)" }
      ],
      "usETFs": [
        { "ticker": "US ETF ticker", "name": "ETF 정식명칭", "reason": "추천 이유 (15자 이내)" }
      ],
      "levETFs": [
        { "ticker": "KR 레버리지 ETF 종목코드 (6자리)", "name": "ETF 정식명칭", "reason": "공격적 포지션용" }
      ],
      "invETFs": [
        { "ticker": "KR 인버스 ETF 종목코드 (6자리)", "name": "ETF 정식명칭", "reason": "헤지·역방향용" }
      ]
    }
  ]
}

★★★ 필수 규칙 (반드시 준수) ★★★
1. krETFs: 각 인사이트당 반드시 3~6개 포함
2. usETFs: 각 인사이트당 반드시 1~3개 포함
3. levETFs: sentiment=positive이면 반드시 1~2개 포함 (레버리지 2X 이상 KR ETF). sentiment가 positive가 아니면 빈 배열.
4. invETFs: sentiment=negative이면 반드시 1~2개 포함 (역방향 헤지용 KR 인버스 ETF). sentiment가 negative가 아니면 빈 배열.
   → "인플레이션 완화", "원자재 약세", "주가 하락" 등 부정 테마에서도 반드시 포함할 것.
   → invETFs는 해당 테마의 반대 방향으로 수익을 내는 인버스 ETF여야 함.
   → 예시: 원자재 하락 테마 → TIGER WTI원유선물인버스(H), KODEX 인버스; 주식 하락 → KODEX 200선물인버스2X; 금리 상승 → KODEX 미국채10년선물인버스(H)

KR ETF 실제 코드 참고 (정확한 6자리 사용):
일반:
- AI·반도체: TIGER AI반도체핵심공정(457680), KODEX 반도체(091160), ACE AI반도체포커스(448730), TIGER 미국필라델피아반도체나스닥(381170), KODEX AI반도체핵심장비(432600)
- 나스닥·기술주: TIGER 미국나스닥100(133690), KODEX 미국S&P500TR(379800), ACE 미국빅테크TOP7Plus(457490), TIGER 미국S&P500(360750)
- 원자재·에너지: TIGER 원자재(130680), KODEX 에너지화학(117460), TIGER WTI원유선물(H)(261220), KODEX 배터리(305720)
- 금: KODEX 골드선물(H)(132030), ACE KRX금현물(411060), TIGER 골드은선물(합성H)(280920)
- 채권·금리: KODEX 미국채10년선물(308620), TIGER 미국채30년스트립액티브(합성H)(458730), KODEX 단기채권PLUS(214980), ACE 미국30년국채액티브(합성H)(453870)
- 달러: KODEX 달러선물(261240), TIGER 미국달러단기채권액티브(430900)
- 한국 수출·반도체: TIGER 코스피(102110), KODEX 코스닥150(229200), KODEX 삼성그룹(213630)
- 이머징: TIGER 차이나A300(192090), KODEX 인도Nifty50(453810), ACE 베트남VN30(401180)
- 헬스케어: TIGER 헬스케어(143860), KODEX 바이오(244580)
레버리지 (sentiment=positive 전용):
- KODEX 레버리지(122630), TIGER 코스닥150레버리지(233740), KODEX 나스닥100레버리지(합성)(253150), TIGER 미국나스닥100레버리지(합성)(409820), KODEX 미국S&P500레버리지(합성)(261270), TIGER 반도체레버리지(합성)(396510)
인버스 (sentiment=negative 전용, 테마별 매핑):
- 주식·코스피 하락: KODEX 인버스(114800), KODEX 200선물인버스2X(252670)
- 코스닥·중소형 하락: TIGER 코스닥150인버스(251340)
- 나스닥·미국주식 하락: KODEX 미국나스닥100선물인버스(H)(409810), TIGER 미국S&P500선물인버스(H)(325010)
- 원자재·유가 하락: TIGER WTI원유선물인버스(H)(217770), KODEX 인버스(114800)
- 금리 상승(채권 약세): KODEX 미국채10년선물인버스(H)(308630)
- 달러 하락: KODEX 달러선물인버스(261250)
- 금 하락: TIGER 골드선물인버스(H)(319640)`;

    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const text = resp.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { narrative: "", insights: [] };
    return JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    console.error("[macro/dashboard] AI 인사이트 오류:", e?.message);
    return { narrative: "", insights: [] };
  }
}

router.get("/macro/dashboard", async (req, res) => {
  const force = req.query.force === "true";
  if (!force && _macroDashCache && Date.now() < _macroDashCache.expiresAt) {
    return res.json(_macroDashCache.data);
  }

  try {
    // 1. Yahoo Finance 시장 데이터 (병렬)
    const yfResults = await Promise.allSettled(SYMBOLS.map(s => fetchYFQuote(s)));

    const items = SYMBOLS.map((s, i) => {
      const r = yfResults[i];
      const q = r.status === "fulfilled" ? r.value : { value: null, change1d: null, prevClose: null };
      return { ...s, value: q.value, change1d: q.change1d, prevClose: q.prevClose };
    });

    // 2. FRED 경제 지표 + ECOS 한국 지표 (병렬)
    const [fred, ecos] = await Promise.all([
      fetchFREDMacro().catch(() => null),
      fetchECOSMacro().catch(() => null),
    ]);

    // 3. 스냅샷 텍스트 생성 (Gemini 입력용)
    const snapshotLines: string[] = [];
    for (const it of items) {
      if (it.value != null)
        snapshotLines.push(`${it.name}(${it.nameEn}): ${it.value.toFixed(2)}${it.unit} (${it.change1d != null ? (it.change1d >= 0 ? "+" : "") + it.change1d.toFixed(2) + "%" : "N/A"})`);
    }
    if (fred) {
      if (fred.fedTargetUpper != null) snapshotLines.push(`미국 기준금리(Fed Target Upper): ${fred.fedTargetUpper}%`);
      if (fred.cpiYoY != null)          snapshotLines.push(`미국 CPI YoY: ${fred.cpiYoY}%`);
      if (fred.unemploymentRate != null) snapshotLines.push(`미국 실업률: ${fred.unemploymentRate}%`);
      if (fred.gdpGrowth != null)        snapshotLines.push(`미국 GDP 성장률(연율): ${fred.gdpGrowth}%`);
      if (fred.yieldSpread != null)      snapshotLines.push(`미국 장단기금리차(10Y-2Y): ${fred.yieldSpread.toFixed(2)}%`);
      if (fred.t10y != null)             snapshotLines.push(`미국 10Y 국채: ${fred.t10y}%`);
    }
    if (ecos) {
      if (ecos.baseRate != null)      snapshotLines.push(`한국 기준금리(BOK): ${ecos.baseRate}%`);
      if (ecos.cpiYoY != null)        snapshotLines.push(`한국 CPI YoY: ${ecos.cpiYoY}%`);
      if (ecos.gdpQoQ != null)        snapshotLines.push(`한국 실질GDP 전기대비: ${ecos.gdpQoQ}%`);
      if (ecos.bondYield3Y != null)   snapshotLines.push(`한국 국고채 3년: ${ecos.bondYield3Y}%`);
      if (ecos.bondYield10Y != null)  snapshotLines.push(`한국 국고채 10년: ${ecos.bondYield10Y}%`);
    }

    // 4. Gemini AI 인사이트
    const ai = await generateMacroInsights(snapshotLines.join("\n"));

    // 5. 카테고리별 그루핑
    const catMap: Record<string, any[]> = {};
    for (const it of items) {
      if (!catMap[it.cat]) catMap[it.cat] = [];
      catMap[it.cat].push(it);
    }

    const fredItems = fred ? [
      { id: "fed-rate",   cat: "fred", name: "미국 기준금리", nameEn: "Fed Rate",      flag: "🇺🇸", unit: "%",  value: fred.fedTargetUpper,    change1d: null },
      { id: "cpi-yoy",    cat: "fred", name: "미국 CPI YoY", nameEn: "US CPI YoY",    flag: "🇺🇸", unit: "%",  value: fred.cpiYoY,            change1d: null },
      { id: "unemp",      cat: "fred", name: "실업률",        nameEn: "Unemployment",  flag: "🇺🇸", unit: "%",  value: fred.unemploymentRate,  change1d: null },
      { id: "gdp",        cat: "fred", name: "GDP 성장률",    nameEn: "GDP Growth",    flag: "🇺🇸", unit: "%",  value: fred.gdpGrowth,         change1d: null },
      { id: "yield-spr",  cat: "fred", name: "장단기금리차",  nameEn: "10Y-2Y Spread", flag: "🇺🇸", unit: "%",  value: fred.yieldSpread,       change1d: null },
      { id: "us10y-fred", cat: "fred", name: "미국 10Y",      nameEn: "US 10Y",        flag: "🇺🇸", unit: "%",  value: fred.t10y,              change1d: null },
    ].filter(x => x.value != null) : [];
    if (fredItems.length) catMap["fred"] = fredItems;

    // 한국 경제 지표 (ECOS + Yahoo Finance 코스닥)
    const koreaYFItems = catMap["korea"] ?? [];  // SYMBOLS에서 온 코스닥
    const koreaEcosItems = ecos ? [
      { id: "bok-rate",   cat: "korea", name: "한국 기준금리", nameEn: "BOK Rate",      flag: "🇰🇷", unit: "%",  value: ecos.baseRate,         change1d: null },
      { id: "kr-cpi",     cat: "korea", name: "한국 CPI",      nameEn: "KR CPI YoY",    flag: "🇰🇷", unit: "%",  value: ecos.cpiYoY,           change1d: null },
      { id: "kr-gdp",     cat: "korea", name: "한국 GDP",       nameEn: "KR GDP QoQ",    flag: "🇰🇷", unit: "%",  value: ecos.gdpQoQ,           change1d: null },
      { id: "kr-ktb3y",   cat: "korea", name: "국고채 3년",     nameEn: "KTB 3Y",        flag: "🇰🇷", unit: "%",  value: ecos.bondYield3Y,      change1d: null },
      { id: "kr-ktb10y",  cat: "korea", name: "국고채 10년",    nameEn: "KTB 10Y",       flag: "🇰🇷", unit: "%",  value: ecos.bondYield10Y,     change1d: null },
    ].filter(x => x.value != null) : [];
    catMap["korea"] = [...koreaYFItems, ...koreaEcosItems];

    const CATEGORY_META: Record<string, { name: string; nameEn: string; icon: string }> = {
      markets:     { name: "글로벌 시장",  nameEn: "Global Markets",  icon: "globe" },
      commodities: { name: "원자재",       nameEn: "Commodities",     icon: "package" },
      currencies:  { name: "환율/달러",    nameEn: "FX / Dollar",     icon: "dollar-sign" },
      rates:       { name: "채권/금리",    nameEn: "Bonds / Rates",   icon: "trending-up" },
      fred:        { name: "미국 경제",    nameEn: "US Economy",      icon: "bar-chart-2" },
      korea:       { name: "한국 경제",    nameEn: "KR Economy",      icon: "landmark" },
    };

    const categories = Object.entries(catMap).map(([id, its]) => ({
      id,
      ...CATEGORY_META[id],
      items: its,
    }));

    const result = {
      categories,
      narrative: ai.narrative,
      insights: ai.insights ?? [],
      generatedAt: Date.now(),
    };

    _macroDashCache = { data: result, expiresAt: Date.now() + MACRO_DASH_TTL };
    console.log(`[macro/dashboard] 완료 — 지표 ${items.length}개, 인사이트 ${ai.insights?.length ?? 0}개`);
    return res.json(result);
  } catch (e: any) {
    console.error("[macro/dashboard] error:", e?.message);
    return res.status(500).json({ error: e?.message ?? "거시지표 대시보드 조회 실패" });
  }
});

export default router;
