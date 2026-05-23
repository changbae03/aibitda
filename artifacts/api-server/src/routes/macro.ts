import { Router } from "express";
import { fetchECOSMacro } from "../lib/ecos-client.js";
import { fetchFREDMacro } from "../lib/fred-client.js";

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
  // 이데일리
  { url: "https://rss.edaily.co.kr/edaily/sec/EDeconomy.xml",      source: "이데일리",       category: "경제" },
  { url: "https://rss.edaily.co.kr/edaily/sec/EDstockMarket.xml",  source: "이데일리(증권)", category: "증권" },
  // 조선비즈
  { url: "https://biz.chosun.com/site/data/rss/rss.xml",           source: "조선비즈",       category: "경제" },
  // 서울경제
  { url: "https://www.sedaily.com/RSSList/Economy",                 source: "서울경제",       category: "경제" },
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
  "반도체", "전기차", "2차전지", "리튬이온", "바이오주", "제약주",
  "은행주", "보험주", "건설주", "부동산투자", "리츠",
  "유가", "원유", "국제유가", "두바이유", "WTI", "브렌트유",
  "원자재", "구리값", "금값", "금시세", "리튬", "희토류",
  "조선업", "철강", "해운주", "해운업", "항공주", "디스플레이",
  "인공지능주", "AI반도체", "AI주", "데이터센터",
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
    const all = results.flat();

    // 중복 제거 (URL 또는 제목 앞 20자 기준)
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    const deduped: MacroNewsItem[] = [];
    for (const item of all) {
      const tk = item.title.slice(0, 24);
      if (item.url && seenUrls.has(item.url)) continue;
      if (seenTitles.has(tk)) continue;
      if (item.url) seenUrls.add(item.url);
      seenTitles.add(tk);
      deduped.push(item);
    }

    // 최신순 정렬
    deduped.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const items = deduped.slice(0, 120);

    macroNewsCache.set("global", { ts: Date.now(), items });
    res.json({ items, cachedAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "매크로 뉴스 조회 실패" });
  }
});

export default router;
