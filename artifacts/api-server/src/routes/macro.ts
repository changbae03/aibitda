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
    const prompt = `당신은 글로벌 매크로 전략가입니다. 아래 실시간 시장 데이터를 바탕으로 현재 시장 상황을 날카롭게 분석하세요.

=== 실시간 시장 데이터 ===
${snapshot}

=== 분석 지침 ===
narrative 작성 규칙:
1. 위 데이터에서 얻을 수 있는 핵심 시사점을 구체적 수치와 함께 서술하세요.
2. 반드시 다음 항목을 모두 포함해야 합니다:
   - 강세 자산/시장: 오늘 상승폭이 크거나 추세적으로 강한 것 (구체적 수치 인용)
   - 약세 자산/시장: 오늘 하락폭이 크거나 부진한 것 (구체적 수치 인용)
   - 달러/금리 환경: DXY 방향, 미국 10Y 금리 수준이 위험자산에 주는 영향
   - 원자재 흐름: 원유/금/구리 등 경기 신호
   - 한국 시장 시사점: 원/달러 환율, 코스피/코스닥 흐름이 국내 투자에 주는 의미
3. 4~6문장으로 작성하세요. 단순 나열이 아닌 인과관계 중심으로 서술하세요.
4. "~합니다" 체로 작성하세요.

다음 형식의 JSON으로만 응답하세요 (코드블록·설명 없이):
{
  "narrative": "강세/약세 분석과 시사점을 담은 4~6문장 (한국어, 구체적 수치 포함)",
  "insights": [
    {
      "theme": "테마명 (한국어, 10자 이내)",
      "themeEn": "Theme name (English, short)",
      "description": "이 테마의 시장 시사점 (한국어, 2문장, 수치 인용)",
      "sentiment": "positive|negative|neutral|mixed",
      "krETFs": [
        { "ticker": "KR ETF 종목코드 (6자리)", "name": "ETF명", "reason": "추천 이유 (한국어, 15자 이내)" }
      ],
      "usETFs": [
        { "ticker": "US ETF ticker", "name": "ETF명", "reason": "추천 이유 (한국어, 15자 이내)" }
      ]
    }
  ]
}

인사이트는 3~5개로 작성하세요. 현재 시장 상황에서 실제로 중요한 테마만 포함하세요.
KR ETF는 KODEX/TIGER/KBSTAR/ACE 계열 실제 상품 코드를 사용하세요.
예: KODEX 미국S&P500TR(379800), TIGER 원자재(130680), KODEX 골드선물(H)(132030), TIGER WTI원유선물(H)(261220), KODEX 달러선물(261240), KODEX 미국채10년선물(308620), KODEX 인버스(114800), TIGER 미국나스닥100(133690), TIGER 차이나A300(192090), KODEX 일본TOPIX100(213630)`;

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
