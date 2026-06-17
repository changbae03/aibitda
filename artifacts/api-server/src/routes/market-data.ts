import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { loadKRXList, getKRXCache, type StockEntry } from "../lib/krx-cache";
import { GoogleGenAI } from "@google/genai";
import { pool } from "@workspace/db";
import { cache } from "../lib/mem-cache";
import { fetchKISStockQuote, fetchKISDailyPriceHistory } from "../lib/kis-client";
import { fetchECOSBaseRateHistory } from "../lib/ecos-client.js";
import { getCorpCodeFromCache } from "../lib/dart-corp-cache";
import { fetchKRXShortData } from "../lib/krx-short-client";
import { fetchAllEconomicActuals, fetchBLSTimeSeries, type BLSReleaseDate, type FOMCDate } from "../lib/bls-client.js";
import { getCachedFredMacro } from "../lib/fred-client.js";

const TTL_BATCH_QUOTES      =  3 * 60 * 1000;  //  3분 — 현재가
const TTL_BATCH_SPARKLINES  =  6 * 60 * 60 * 1000;  //  6시간 — 90일 차트 (장 마감 후 변경)
const TTL_BATCH_PERFORMANCE = 24 * 60 * 60 * 1000;  // 24시간 — 과거 수익률 (불변)

const yahooFinance = new YahooFinance();

async function batchProcess<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize = 10,
  delayMs = 100,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const settled = await Promise.allSettled(chunk.map(fn));
    results.push(...settled);
    if (i + batchSize < items.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

const router: IRouter = Router();

function calculateRSI(closes: number[], window = 14): (number | null)[] {
  const rsi: (number | null)[] = new Array(window).fill(null);
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= window; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / window;
  let avgLoss = losses / window;
  
  for (let i = window; i < closes.length; i++) {
    if (i === window) {
      rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
      continue;
    }
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (window - 1) + gain) / window;
    avgLoss = (avgLoss * (window - 1) + loss) / window;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  
  return rsi;
}

function calculateMA(values: number[], period: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < period - 1) return null;
    const slice = values.slice(i - period + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / period;
  });
}

function calculateBollingerBands(closes: number[], period = 20, multiplier = 2) {
  const upper: (number | null)[] = [];
  const middle: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      middle.push(null);
      lower.push(null);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - avg) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper.push(avg + multiplier * std);
    middle.push(avg);
    lower.push(avg - multiplier * std);
  }
  return { upper, middle, lower };
}

// ── 입력 검증 헬퍼 ────────────────────────────────────────────────────────────

/** 허용된 차트 기간 값 (화이트리스트) */
const ALLOWED_PERIODS = new Set(["3m", "6m", "1y", "2y", "5y"]);

/** 허용된 차트 인터벌 값 (화이트리스트) */
const ALLOWED_INTERVALS = new Set(["1d", "1wk", "1mo"]);

/** 기간 → 일수 매핑 (안전한 객체 — 프로토타입 없음) */
const PERIOD_TO_DAYS = Object.assign(Object.create(null) as Record<string, number>, {
  "3m": 90, "6m": 180, "1y": 365, "2y": 730, "5y": 1825,
});

/**
 * 티커 심볼을 검증하고 정규화합니다.
 * 허용 형식: 영숫자, 점, 하이픈, 숫자(6자리 한국 코드)
 * 최대 20자. 허용되지 않으면 null 반환.
 */
function sanitizeTicker(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  if (t.length === 0 || t.length > 20) return null;
  // 허용: 영문, 숫자, 점, 하이픈, 앰퍼샌드(BRK-B, KT&G 등)
  if (!/^[A-Z0-9.\-&]{1,20}$/.test(t)) return null;
  // 경로 순회 방지
  if (t.includes("..") || t.includes("/") || t.includes("\\")) return null;
  return t;
}

function isValidEquityName(name: string | undefined, symbol: string): boolean {
  if (!name) return false;
  // Invalid if name contains commas (fund/index codes) or is identical to the ticker
  if (name.includes(",")) return false;
  if (name.trim() === symbol.trim()) return false;
  return true;
}

/** Yahoo Finance chart with auto-retry on schema validation failures */
async function safeChart(symbol: string, opts: { period1: string; period2: string; interval: string }) {
  try {
    return await yahooFinance.chart(symbol, { period1: opts.period1, period2: opts.period2, interval: opts.interval as any });
  } catch (e: any) {
    const msg = e?.message ?? "";
    // 스키마 검증 실패지만 데이터는 있을 수 있음 → validateResult: false 재시도
    if (msg.includes("Schema") || msg.includes("validate") || msg.includes("Validation")) {
      try {
        return await (yahooFinance as any).chart(symbol,
          { period1: opts.period1, period2: opts.period2, interval: opts.interval },
          { validateResult: false }
        );
      } catch { return null; }
    }
    return null;
  }
}

async function resolveKoreanTicker(
  ticker: string,
  period1: string,
  period2: string,
  interval: string,
) {
  if (!/^\d{6}$/.test(ticker)) return null;

  const chartOpts = { period1, period2, interval };
  const [ksChart, kqChart, ksQuote, kqQuote] = await Promise.allSettled([
    safeChart(`${ticker}.KS`, chartOpts),
    safeChart(`${ticker}.KQ`, chartOpts),
    yahooFinance.quote(`${ticker}.KS`).catch(() => null),
    yahooFinance.quote(`${ticker}.KQ`).catch(() => null),
  ]);

  const ksData = ksChart.status === "fulfilled" ? ksChart.value : null;
  const kqData = kqChart.status === "fulfilled" ? kqChart.value : null;

  const ksValid = !!ksData?.quotes?.some((q: any) => q.close && q.close > 0);
  const kqValid = !!kqData?.quotes?.some((q: any) => q.close && q.close > 0);

  const ksQuoteVal = ksQuote.status === "fulfilled" ? ksQuote.value : null;
  const kqQuoteVal = kqQuote.status === "fulfilled" ? kqQuote.value : null;

  const ksName = (ksQuoteVal as any)?.longName ?? (ksQuoteVal as any)?.shortName ?? "";
  const kqName = (kqQuoteVal as any)?.longName ?? (kqQuoteVal as any)?.shortName ?? "";

  const ksNameOk = isValidEquityName(ksName, `${ticker}.KS`);
  const kqNameOk = isValidEquityName(kqName, `${ticker}.KQ`);

  // Prefer the exchange whose company name looks like a real stock
  if (kqValid && kqNameOk && !ksNameOk) {
    return { symbol: `${ticker}.KQ`, result: kqData! };
  }
  if (ksValid && ksNameOk && !kqNameOk) {
    return { symbol: `${ticker}.KS`, result: ksData! };
  }
  // Both valid or both invalid — try KS first (most banks/large caps), then KQ
  if (ksValid) return { symbol: `${ticker}.KS`, result: ksData! };
  if (kqValid) return { symbol: `${ticker}.KQ`, result: kqData! };
  return null;
}

const KOREAN_COMPANY_MAP: Array<{ name: string; keywords: string[]; symbol: string; exchange: string }> = [
  // ── KOSPI 대형주 ─────────────────────────────────────────────────────────
  { name: "삼성전자", keywords: ["삼성전자", "삼성"], symbol: "005930.KS", exchange: "KOSPI" },
  { name: "SK하이닉스", keywords: ["sk하이닉스", "하이닉스", "에스케이하이닉스"], symbol: "000660.KS", exchange: "KOSPI" },
  { name: "LG에너지솔루션", keywords: ["lg에너지솔루션", "엘지에너지솔루션", "lges"], symbol: "373220.KS", exchange: "KOSPI" },
  { name: "삼성바이오로직스", keywords: ["삼성바이오로직스", "삼성바이오", "바이오로직스"], symbol: "207940.KS", exchange: "KOSPI" },
  { name: "현대차", keywords: ["현대차", "현대자동차"], symbol: "005380.KS", exchange: "KOSPI" },
  { name: "셀트리온", keywords: ["셀트리온"], symbol: "068270.KS", exchange: "KOSPI" },
  { name: "기아", keywords: ["기아", "기아자동차"], symbol: "000270.KS", exchange: "KOSPI" },
  { name: "NAVER", keywords: ["네이버", "naver"], symbol: "035420.KS", exchange: "KOSPI" },
  { name: "KB금융", keywords: ["kb금융", "kb국민은행", "국민은행"], symbol: "105560.KS", exchange: "KOSPI" },
  { name: "LG화학", keywords: ["lg화학", "엘지화학"], symbol: "051910.KS", exchange: "KOSPI" },
  { name: "신한지주", keywords: ["신한지주", "신한은행", "신한"], symbol: "055550.KS", exchange: "KOSPI" },
  { name: "삼성SDI", keywords: ["삼성sdi", "삼성에스디아이"], symbol: "006400.KS", exchange: "KOSPI" },
  { name: "카카오", keywords: ["카카오"], symbol: "035720.KS", exchange: "KOSPI" },
  { name: "현대모비스", keywords: ["현대모비스", "모비스"], symbol: "012330.KS", exchange: "KOSPI" },
  { name: "POSCO홀딩스", keywords: ["포스코홀딩스", "포스코", "posco"], symbol: "005490.KS", exchange: "KOSPI" },
  { name: "하나금융지주", keywords: ["하나금융지주", "하나금융", "하나은행"], symbol: "086790.KS", exchange: "KOSPI" },
  { name: "LG전자", keywords: ["lg전자", "엘지전자"], symbol: "066570.KS", exchange: "KOSPI" },
  { name: "삼성물산", keywords: ["삼성물산"], symbol: "028260.KS", exchange: "KOSPI" },
  { name: "삼성전기", keywords: ["삼성전기"], symbol: "009150.KS", exchange: "KOSPI" },
  { name: "LG이노텍", keywords: ["lg이노텍", "엘지이노텍", "이노텍"], symbol: "011070.KS", exchange: "KOSPI" },
  { name: "포스코퓨처엠", keywords: ["포스코퓨처엠", "포스코케미칼"], symbol: "003670.KS", exchange: "KOSPI" },
  { name: "우리금융지주", keywords: ["우리금융지주", "우리금융", "우리은행"], symbol: "316140.KS", exchange: "KOSPI" },
  { name: "고려아연", keywords: ["고려아연"], symbol: "010130.KS", exchange: "KOSPI" },
  { name: "기업은행", keywords: ["기업은행", "ibk"], symbol: "024110.KS", exchange: "KOSPI" },
  { name: "SK텔레콤", keywords: ["sk텔레콤", "에스케이텔레콤", "skt"], symbol: "017670.KS", exchange: "KOSPI" },
  { name: "카카오뱅크", keywords: ["카카오뱅크"], symbol: "323410.KS", exchange: "KOSPI" },
  { name: "카카오페이", keywords: ["카카오페이"], symbol: "377300.KS", exchange: "KOSPI" },
  { name: "크래프톤", keywords: ["크래프톤", "배틀그라운드", "pubg"], symbol: "259960.KS", exchange: "KOSPI" },
  { name: "하이브", keywords: ["하이브", "빅히트"], symbol: "352820.KS", exchange: "KOSPI" },
  { name: "KT", keywords: ["kt", "케이티"], symbol: "030200.KS", exchange: "KOSPI" },
  { name: "한화에어로스페이스", keywords: ["한화에어로스페이스", "한화에어로", "한화항공우주"], symbol: "012450.KS", exchange: "KOSPI" },
  { name: "두산에너빌리티", keywords: ["두산에너빌리티", "두산중공업"], symbol: "034020.KS", exchange: "KOSPI" },
  { name: "SK이노베이션", keywords: ["sk이노베이션", "에스케이이노베이션"], symbol: "096770.KS", exchange: "KOSPI" },
  { name: "한국전력", keywords: ["한국전력", "한전", "kepco"], symbol: "015760.KS", exchange: "KOSPI" },
  { name: "현대건설", keywords: ["현대건설"], symbol: "000720.KS", exchange: "KOSPI" },
  { name: "HD현대중공업", keywords: ["hd현대중공업", "현대중공업"], symbol: "329180.KS", exchange: "KOSPI" },
  { name: "현대제철", keywords: ["현대제철"], symbol: "004020.KS", exchange: "KOSPI" },
  { name: "엔씨소프트", keywords: ["엔씨소프트", "엔씨", "nc"], symbol: "036570.KS", exchange: "KOSPI" },
  { name: "넷마블", keywords: ["넷마블"], symbol: "251270.KS", exchange: "KOSPI" },
  { name: "롯데케미칼", keywords: ["롯데케미칼", "롯데화학"], symbol: "011170.KS", exchange: "KOSPI" },
  { name: "한진칼", keywords: ["한진칼", "대한항공"], symbol: "180640.KS", exchange: "KOSPI" },
  { name: "현대글로비스", keywords: ["현대글로비스", "글로비스"], symbol: "086280.KS", exchange: "KOSPI" },
  { name: "SK바이오사이언스", keywords: ["sk바이오사이언스", "에스케이바이오"], symbol: "302440.KS", exchange: "KOSPI" },
  { name: "S-Oil", keywords: ["에쓰오일", "s-oil", "soil"], symbol: "010950.KS", exchange: "KOSPI" },
  { name: "GS", keywords: ["gs칼텍스", "gs홀딩스"], symbol: "078930.KS", exchange: "KOSPI" },
  { name: "LS일렉트릭", keywords: ["ls일렉트릭", "ls전선", "엘에스"], symbol: "010120.KS", exchange: "KOSPI" },
  { name: "삼성중공업", keywords: ["삼성중공업"], symbol: "010140.KS", exchange: "KOSPI" },
  { name: "F&F", keywords: ["f&f", "에프앤에프", "mlb"], symbol: "383220.KS", exchange: "KOSPI" },
  { name: "KT&G", keywords: ["kt&g", "케이티앤지", "담배인삼공사"], symbol: "033780.KS", exchange: "KOSPI" },
  { name: "한화솔루션", keywords: ["한화솔루션", "한화큐셀"], symbol: "009830.KS", exchange: "KOSPI" },
  { name: "HD현대일렉트릭", keywords: ["hd현대일렉트릭", "현대일렉트릭"], symbol: "267260.KS", exchange: "KOSPI" },
  { name: "두산로보틱스", keywords: ["두산로보틱스", "두산로봇"], symbol: "454910.KS", exchange: "KOSPI" },
  // ── KOSDAQ 주요 종목 ──────────────────────────────────────────────────────
  { name: "에코프로비엠", keywords: ["에코프로비엠", "에코프로bm"], symbol: "247540.KQ", exchange: "KOSDAQ" },
  { name: "에코프로", keywords: ["에코프로"], symbol: "086520.KQ", exchange: "KOSDAQ" },
  { name: "HLB", keywords: ["hlb", "에이치엘비"], symbol: "028300.KQ", exchange: "KOSDAQ" },
  { name: "알테오젠", keywords: ["알테오젠"], symbol: "196170.KQ", exchange: "KOSDAQ" },
  { name: "리가켐바이오", keywords: ["리가켐바이오", "리가켐"], symbol: "141080.KQ", exchange: "KOSDAQ" },
  { name: "클래시스", keywords: ["클래시스"], symbol: "214150.KQ", exchange: "KOSDAQ" },
  { name: "파마리서치", keywords: ["파마리서치"], symbol: "214360.KQ", exchange: "KOSDAQ" },
  { name: "카카오게임즈", keywords: ["카카오게임즈", "카카오게임"], symbol: "293490.KQ", exchange: "KOSDAQ" },
  { name: "펄어비스", keywords: ["펄어비스", "검은사막"], symbol: "263750.KQ", exchange: "KOSDAQ" },
  { name: "위메이드", keywords: ["위메이드"], symbol: "112040.KQ", exchange: "KOSDAQ" },
  { name: "레인보우로보틱스", keywords: ["레인보우로보틱스", "레인보우로봇"], symbol: "277810.KQ", exchange: "KOSDAQ" },
  { name: "솔브레인", keywords: ["솔브레인"], symbol: "357780.KQ", exchange: "KOSDAQ" },
  { name: "원익IPS", keywords: ["원익ips", "원익"], symbol: "240810.KQ", exchange: "KOSDAQ" },
  { name: "리노공업", keywords: ["리노공업", "리노"], symbol: "058470.KQ", exchange: "KOSDAQ" },
  { name: "실리콘투", keywords: ["실리콘투"], symbol: "257720.KQ", exchange: "KOSDAQ" },
  { name: "동진쎄미켐", keywords: ["동진쎄미켐", "동진세미켐"], symbol: "005290.KQ", exchange: "KOSDAQ" },
  { name: "셀트리온헬스케어", keywords: ["셀트리온헬스케어", "셀트리온헬스"], symbol: "091990.KQ", exchange: "KOSDAQ" },
  { name: "오스템임플란트", keywords: ["오스템임플란트", "오스템", "임플란트"], symbol: "048260.KQ", exchange: "KOSDAQ" },
  { name: "메디포스트", keywords: ["메디포스트"], symbol: "078160.KQ", exchange: "KOSDAQ" },
  { name: "피에스케이홀딩스", keywords: ["피에스케이홀딩스", "psk홀딩스", "psk"], symbol: "031980.KQ", exchange: "KOSDAQ" },
  { name: "제이엘케이", keywords: ["제이엘케이", "jlk"], symbol: "322510.KQ", exchange: "KOSDAQ" },
  { name: "엘앤에프", keywords: ["엘앤에프", "l&f"], symbol: "066970.KQ", exchange: "KOSDAQ" },
  { name: "휴온스", keywords: ["휴온스"], symbol: "243070.KQ", exchange: "KOSDAQ" },
  { name: "오리온", keywords: ["오리온", "초코파이"], symbol: "271560.KQ", exchange: "KOSDAQ" },
  { name: "에스티팜", keywords: ["에스티팜"], symbol: "237690.KQ", exchange: "KOSDAQ" },
  { name: "유한양행", keywords: ["유한양행"], symbol: "000100.KS", exchange: "KOSPI" },
  { name: "한미약품", keywords: ["한미약품", "한미"], symbol: "128940.KS", exchange: "KOSPI" },
  { name: "대웅제약", keywords: ["대웅제약", "대웅"], symbol: "069620.KQ", exchange: "KOSDAQ" },
  { name: "셀비온", keywords: ["셀비온"], symbol: "308080.KQ", exchange: "KOSDAQ" },
  { name: "이수페타시스", keywords: ["이수페타시스", "이수"], symbol: "007660.KQ", exchange: "KOSDAQ" },
  { name: "나노신소재", keywords: ["나노신소재"], symbol: "121600.KQ", exchange: "KOSDAQ" },
  { name: "코스모화학", keywords: ["코스모화학"], symbol: "005420.KQ", exchange: "KOSDAQ" },
];

// ── 미국/글로벌 주요 종목 한글명 매핑 ──────────────────────────────────────
const US_KOREAN_MAP: { symbol: string; name: string; exchange: string; keywords: string[] }[] = [
  // 반도체·AI
  { symbol: "NVDA",  name: "NVIDIA",               exchange: "NASDAQ", keywords: ["엔비디아", "엔비디"] },
  { symbol: "AMD",   name: "AMD",                  exchange: "NASDAQ", keywords: ["AMD", "어드밴스드마이크로", "에이엠디"] },
  { symbol: "INTC",  name: "Intel",                exchange: "NASDAQ", keywords: ["인텔"] },
  { symbol: "QCOM",  name: "Qualcomm",             exchange: "NASDAQ", keywords: ["퀄컴"] },
  { symbol: "AVGO",  name: "Broadcom",             exchange: "NASDAQ", keywords: ["브로드컴"] },
  { symbol: "ARM",   name: "Arm Holdings",         exchange: "NASDAQ", keywords: ["암홀딩스", "ARM홀딩스"] },
  { symbol: "TSM",   name: "TSMC",                 exchange: "NYSE",   keywords: ["TSMC", "티에스엠씨", "타이완반도체"] },
  { symbol: "MU",    name: "Micron Technology",    exchange: "NASDAQ", keywords: ["마이크론"] },
  { symbol: "AMAT",  name: "Applied Materials",    exchange: "NASDAQ", keywords: ["어플라이드머티리얼즈", "어플라이드"] },
  { symbol: "LRCX",  name: "Lam Research",         exchange: "NASDAQ", keywords: ["램리서치"] },
  { symbol: "KLAC",  name: "KLA Corporation",      exchange: "NASDAQ", keywords: ["KLA", "케이엘에이"] },
  { symbol: "ASML",  name: "ASML",                 exchange: "NASDAQ", keywords: ["ASML", "에이에스엠엘"] },
  { symbol: "SMCI",  name: "Super Micro Computer", exchange: "NASDAQ", keywords: ["슈퍼마이크로", "슈퍼마이크로컴퓨터"] },
  { symbol: "MRVL",  name: "Marvell Technology",   exchange: "NASDAQ", keywords: ["마벨", "마블테크놀로지"] },
  // 빅테크
  { symbol: "AAPL",  name: "Apple",                exchange: "NASDAQ", keywords: ["애플", "아이폰", "아이패드", "맥북"] },
  { symbol: "MSFT",  name: "Microsoft",            exchange: "NASDAQ", keywords: ["마이크로소프트", "마소"] },
  { symbol: "GOOGL", name: "Alphabet (Google)",    exchange: "NASDAQ", keywords: ["구글", "알파벳", "알파벳구글"] },
  { symbol: "GOOG",  name: "Alphabet Class C",     exchange: "NASDAQ", keywords: ["구글C", "알파벳C"] },
  { symbol: "AMZN",  name: "Amazon",               exchange: "NASDAQ", keywords: ["아마존"] },
  { symbol: "META",  name: "Meta Platforms",       exchange: "NASDAQ", keywords: ["메타", "페이스북", "인스타그램"] },
  { symbol: "NFLX",  name: "Netflix",              exchange: "NASDAQ", keywords: ["넷플릭스"] },
  { symbol: "TSLA",  name: "Tesla",                exchange: "NASDAQ", keywords: ["테슬라"] },
  { symbol: "ORCL",  name: "Oracle",               exchange: "NYSE",   keywords: ["오라클"] },
  { symbol: "CRM",   name: "Salesforce",           exchange: "NYSE",   keywords: ["세일즈포스"] },
  { symbol: "NOW",   name: "ServiceNow",           exchange: "NYSE",   keywords: ["서비스나우"] },
  { symbol: "ADBE",  name: "Adobe",                exchange: "NASDAQ", keywords: ["어도비"] },
  // AI 특화
  { symbol: "PLTR",  name: "Palantir",             exchange: "NYSE",   keywords: ["팔란티어"] },
  { symbol: "SNOW",  name: "Snowflake",            exchange: "NYSE",   keywords: ["스노우플레이크"] },
  { symbol: "AI",    name: "C3.ai",                exchange: "NYSE",   keywords: ["씨쓰리에이아이", "C3AI"] },
  // 전기차
  { symbol: "RIVN",  name: "Rivian",               exchange: "NASDAQ", keywords: ["리비안"] },
  { symbol: "LCID",  name: "Lucid Motors",         exchange: "NASDAQ", keywords: ["루시드", "루시드모터스"] },
  { symbol: "NIO",   name: "NIO",                  exchange: "NYSE",   keywords: ["니오"] },
  { symbol: "XPEV",  name: "XPeng",                exchange: "NYSE",   keywords: ["샤오펑", "엑스펑"] },
  { symbol: "LI",    name: "Li Auto",              exchange: "NASDAQ", keywords: ["리오토", "리샹"] },
  // 바이오·헬스케어
  { symbol: "LLY",   name: "Eli Lilly",            exchange: "NYSE",   keywords: ["일라이릴리", "릴리"] },
  { symbol: "NVO",   name: "Novo Nordisk",         exchange: "NYSE",   keywords: ["노보노디스크", "노보"] },
  { symbol: "MRNA",  name: "Moderna",              exchange: "NASDAQ", keywords: ["모더나"] },
  { symbol: "BNTX",  name: "BioNTech",             exchange: "NASDAQ", keywords: ["바이오엔텍", "비온텍"] },
  { symbol: "PFE",   name: "Pfizer",               exchange: "NYSE",   keywords: ["화이자"] },
  { symbol: "JNJ",   name: "Johnson & Johnson",    exchange: "NYSE",   keywords: ["존슨앤존슨", "존슨앤드존슨"] },
  { symbol: "UNH",   name: "UnitedHealth",         exchange: "NYSE",   keywords: ["유나이티드헬스", "유나이티드헬스케어"] },
  { symbol: "ABBV",  name: "AbbVie",               exchange: "NYSE",   keywords: ["애브비"] },
  // 금융
  { symbol: "JPM",   name: "JPMorgan Chase",       exchange: "NYSE",   keywords: ["JP모건", "제이피모건"] },
  { symbol: "GS",    name: "Goldman Sachs",        exchange: "NYSE",   keywords: ["골드만삭스"] },
  { symbol: "BAC",   name: "Bank of America",      exchange: "NYSE",   keywords: ["뱅크오브아메리카", "BOA"] },
  { symbol: "V",     name: "Visa",                 exchange: "NYSE",   keywords: ["비자"] },
  { symbol: "MA",    name: "Mastercard",           exchange: "NYSE",   keywords: ["마스터카드"] },
  { symbol: "BRK-B", name: "Berkshire Hathaway",   exchange: "NYSE",   keywords: ["버크셔해서웨이", "버크셔", "워렌버핏"] },
  { symbol: "COIN",  name: "Coinbase",             exchange: "NASDAQ", keywords: ["코인베이스"] },
  { symbol: "HOOD",  name: "Robinhood Markets",    exchange: "NASDAQ", keywords: ["로빈후드"] },
  { symbol: "SOFI",  name: "SoFi Technologies",    exchange: "NASDAQ", keywords: ["소파이", "소파이테크"] },
  { symbol: "AFRM",  name: "Affirm Holdings",      exchange: "NASDAQ", keywords: ["어펌"] },
  { symbol: "SCHW",  name: "Charles Schwab",       exchange: "NYSE",   keywords: ["찰스슈왑", "슈왑"] },
  { symbol: "MS",    name: "Morgan Stanley",       exchange: "NYSE",   keywords: ["모건스탠리"] },
  { symbol: "C",     name: "Citigroup",            exchange: "NYSE",   keywords: ["씨티", "씨티그룹"] },
  { symbol: "WFC",   name: "Wells Fargo",          exchange: "NYSE",   keywords: ["웰스파고"] },
  { symbol: "AXP",   name: "American Express",     exchange: "NYSE",   keywords: ["아멕스", "아메리칸익스프레스"] },
  { symbol: "BLK",   name: "BlackRock",            exchange: "NYSE",   keywords: ["블랙록"] },
  // 소비재·리테일
  { symbol: "AMZN",  name: "Amazon",               exchange: "NASDAQ", keywords: ["아마존"] },
  { symbol: "WMT",   name: "Walmart",              exchange: "NYSE",   keywords: ["월마트"] },
  { symbol: "COST",  name: "Costco",               exchange: "NASDAQ", keywords: ["코스트코"] },
  { symbol: "TGT",   name: "Target",               exchange: "NYSE",   keywords: ["타겟"] },
  { symbol: "NKE",   name: "Nike",                 exchange: "NYSE",   keywords: ["나이키"] },
  { symbol: "SBUX",  name: "Starbucks",            exchange: "NYSE",   keywords: ["스타벅스"] },
  { symbol: "MCD",   name: "McDonald's",           exchange: "NYSE",   keywords: ["맥도날드"] },
  { symbol: "KO",    name: "Coca-Cola",            exchange: "NYSE",   keywords: ["코카콜라"] },
  { symbol: "PEP",   name: "PepsiCo",              exchange: "NASDAQ", keywords: ["펩시", "펩시코"] },
  { symbol: "DIS",   name: "Walt Disney",          exchange: "NYSE",   keywords: ["디즈니", "월트디즈니"] },
  { symbol: "DASH",  name: "DoorDash",             exchange: "NYSE",   keywords: ["도어대시"] },
  { symbol: "BKNG",  name: "Booking Holdings",     exchange: "NASDAQ", keywords: ["부킹닷컴", "부킹홀딩스"] },
  { symbol: "EXPE",  name: "Expedia",              exchange: "NASDAQ", keywords: ["익스피디아"] },
  // 헬스케어
  { symbol: "ISRG",  name: "Intuitive Surgical",   exchange: "NASDAQ", keywords: ["인튜이티브서지컬", "인튜이티브", "다빈치"] },
  { symbol: "TMO",   name: "Thermo Fisher",        exchange: "NYSE",   keywords: ["써모피셔", "써모피셔사이언티픽"] },
  { symbol: "DHR",   name: "Danaher",              exchange: "NYSE",   keywords: ["다나허"] },
  { symbol: "ABT",   name: "Abbott Laboratories",  exchange: "NYSE",   keywords: ["애보트", "애보트래버러토리"] },
  { symbol: "MDT",   name: "Medtronic",            exchange: "NYSE",   keywords: ["메드트로닉"] },
  { symbol: "SYK",   name: "Stryker",              exchange: "NYSE",   keywords: ["스트라이커"] },
  { symbol: "REGN",  name: "Regeneron",            exchange: "NASDAQ", keywords: ["리제네론"] },
  { symbol: "VRTX",  name: "Vertex Pharmaceuticals", exchange: "NASDAQ", keywords: ["버텍스파마", "버텍스"] },
  { symbol: "BIIB",  name: "Biogen",               exchange: "NASDAQ", keywords: ["바이오젠"] },
  { symbol: "GILD",  name: "Gilead Sciences",      exchange: "NASDAQ", keywords: ["길리어드", "길리어드사이언스"] },
  { symbol: "AMGN",  name: "Amgen",                exchange: "NASDAQ", keywords: ["암젠"] },
  { symbol: "UNH",   name: "UnitedHealth",         exchange: "NYSE",   keywords: ["유나이티드헬스", "유나이티드헬스케어"] },
  { symbol: "CI",    name: "Cigna",                exchange: "NYSE",   keywords: ["시그나"] },
  { symbol: "CVS",   name: "CVS Health",           exchange: "NYSE",   keywords: ["CVS헬스", "CVS"] },
  { symbol: "ZTS",   name: "Zoetis",               exchange: "NYSE",   keywords: ["조에티스"] },
  // 사이버보안·클라우드
  { symbol: "PANW",  name: "Palo Alto Networks",   exchange: "NASDAQ", keywords: ["팔로알토", "팔로알토네트웍스"] },
  { symbol: "CRWD",  name: "CrowdStrike",          exchange: "NASDAQ", keywords: ["크라우드스트라이크"] },
  { symbol: "NET",   name: "Cloudflare",           exchange: "NYSE",   keywords: ["클라우드플레어"] },
  { symbol: "DDOG",  name: "Datadog",              exchange: "NASDAQ", keywords: ["데이터독"] },
  { symbol: "ZS",    name: "Zscaler",              exchange: "NASDAQ", keywords: ["지스케일러", "제트스케일러"] },
  { symbol: "OKTA",  name: "Okta",                 exchange: "NASDAQ", keywords: ["옥타"] },
  { symbol: "S",     name: "SentinelOne",          exchange: "NYSE",   keywords: ["센티넬원"] },
  { symbol: "MDB",   name: "MongoDB",              exchange: "NASDAQ", keywords: ["몽고DB", "몽고디비"] },
  { symbol: "INTU",  name: "Intuit",               exchange: "NASDAQ", keywords: ["인튜이트"] },
  { symbol: "WDAY",  name: "Workday",              exchange: "NASDAQ", keywords: ["워크데이"] },
  { symbol: "VEEV",  name: "Veeva Systems",        exchange: "NYSE",   keywords: ["비바시스템즈", "비바"] },
  // 에너지
  { symbol: "XOM",   name: "ExxonMobil",           exchange: "NYSE",   keywords: ["엑슨모빌", "엑손모빌"] },
  { symbol: "CVX",   name: "Chevron",              exchange: "NYSE",   keywords: ["셰브론"] },
  { symbol: "COP",   name: "ConocoPhillips",       exchange: "NYSE",   keywords: ["코노코필립스"] },
  { symbol: "SLB",   name: "Schlumberger",         exchange: "NYSE",   keywords: ["슐룸베르거"] },
  { symbol: "FSLR",  name: "First Solar",          exchange: "NASDAQ", keywords: ["퍼스트솔라"] },
  { symbol: "ENPH",  name: "Enphase Energy",       exchange: "NASDAQ", keywords: ["엔페이즈", "엔페이즈에너지"] },
  { symbol: "NEE",   name: "NextEra Energy",       exchange: "NYSE",   keywords: ["넥스트에라에너지", "넥스트에라"] },
  // 산업·방산
  { symbol: "BA",    name: "Boeing",               exchange: "NYSE",   keywords: ["보잉"] },
  { symbol: "LMT",   name: "Lockheed Martin",      exchange: "NYSE",   keywords: ["록히드마틴"] },
  { symbol: "RTX",   name: "RTX Corporation",      exchange: "NYSE",   keywords: ["레이시온", "RTX"] },
  { symbol: "GE",    name: "GE Aerospace",         exchange: "NYSE",   keywords: ["GE", "GE에어로스페이스", "제너럴일렉트릭"] },
  { symbol: "HON",   name: "Honeywell",            exchange: "NASDAQ", keywords: ["하니웰"] },
  { symbol: "CAT",   name: "Caterpillar",          exchange: "NYSE",   keywords: ["캐터필러"] },
  { symbol: "DE",    name: "Deere & Company",      exchange: "NYSE",   keywords: ["존디어", "존 디어"] },
  // 자동차
  { symbol: "GM",    name: "General Motors",       exchange: "NYSE",   keywords: ["GM", "제너럴모터스"] },
  { symbol: "F",     name: "Ford Motor",           exchange: "NYSE",   keywords: ["포드"] },
  // IT 인프라
  { symbol: "CSCO",  name: "Cisco Systems",        exchange: "NASDAQ", keywords: ["시스코"] },
  { symbol: "IBM",   name: "IBM",                  exchange: "NYSE",   keywords: ["IBM", "아이비엠"] },
  { symbol: "HPQ",   name: "HP Inc.",              exchange: "NYSE",   keywords: ["HP", "에이치피"] },
  { symbol: "DELL",  name: "Dell Technologies",    exchange: "NYSE",   keywords: ["델", "델테크놀로지"] },
  { symbol: "TXN",   name: "Texas Instruments",    exchange: "NASDAQ", keywords: ["TI", "텍사스인스트루먼트"] },
  { symbol: "ANET",  name: "Arista Networks",      exchange: "NYSE",   keywords: ["아리스타네트웍스", "아리스타"] },
  // 미디어·엔터
  { symbol: "NFLX",  name: "Netflix",              exchange: "NASDAQ", keywords: ["넷플릭스"] },
  { symbol: "WBD",   name: "Warner Bros. Discovery", exchange: "NASDAQ", keywords: ["워너브라더스", "HBO"] },
  { symbol: "PARA",  name: "Paramount Global",     exchange: "NASDAQ", keywords: ["파라마운트"] },
  { symbol: "RBLX",  name: "Roblox",               exchange: "NYSE",   keywords: ["로블록스"] },
  { symbol: "EA",    name: "Electronic Arts",      exchange: "NASDAQ", keywords: ["일렉트로닉아츠", "EA"] },
  { symbol: "TTWO",  name: "Take-Two Interactive", exchange: "NASDAQ", keywords: ["테이크투", "GTA"] },
  { symbol: "SNAP",  name: "Snap Inc.",            exchange: "NYSE",   keywords: ["스냅", "스냅챗"] },
  { symbol: "PINS",  name: "Pinterest",            exchange: "NYSE",   keywords: ["핀터레스트"] },
  // 중국
  { symbol: "BABA",  name: "Alibaba",              exchange: "NYSE",   keywords: ["알리바바"] },
  { symbol: "BIDU",  name: "Baidu",                exchange: "NASDAQ", keywords: ["바이두"] },
  { symbol: "PDD",   name: "PDD Holdings (Temu)",  exchange: "NASDAQ", keywords: ["PDD", "테무", "핀둬둬"] },
  { symbol: "JD",    name: "JD.com",               exchange: "NASDAQ", keywords: ["징둥", "JD닷컴"] },
  { symbol: "NTES",  name: "NetEase",              exchange: "NASDAQ", keywords: ["넷이즈"] },
  { symbol: "BILI",  name: "Bilibili",             exchange: "NASDAQ", keywords: ["빌리빌리"] },
  // 기타
  { symbol: "SPOT",  name: "Spotify",              exchange: "NYSE",   keywords: ["스포티파이"] },
  { symbol: "ZM",    name: "Zoom",                 exchange: "NASDAQ", keywords: ["줌"] },
  { symbol: "UBER",  name: "Uber",                 exchange: "NYSE",   keywords: ["우버"] },
  { symbol: "LYFT",  name: "Lyft",                 exchange: "NASDAQ", keywords: ["리프트"] },
  { symbol: "ABNB",  name: "Airbnb",               exchange: "NASDAQ", keywords: ["에어비앤비"] },
  { symbol: "SHOP",  name: "Shopify",              exchange: "NYSE",   keywords: ["쇼피파이"] },
  { symbol: "SQ",    name: "Block (Square)",       exchange: "NYSE",   keywords: ["블록", "스퀘어"] },
  { symbol: "PYPL",  name: "PayPal",               exchange: "NASDAQ", keywords: ["페이팔"] },
  { symbol: "U",     name: "Unity Software",       exchange: "NYSE",   keywords: ["유니티"] },
  { symbol: "COIN",  name: "Coinbase",             exchange: "NASDAQ", keywords: ["코인베이스"] },
  { symbol: "SPGI",  name: "S&P Global",           exchange: "NYSE",   keywords: ["S&P글로벌", "에스앤피글로벌"] },
  { symbol: "ICE",   name: "Intercontinental Exchange", exchange: "NYSE", keywords: ["ICE", "인터컨티넨탈"] },
  // 통신
  { symbol: "T",     name: "AT&T",                 exchange: "NYSE",   keywords: ["AT&T", "에이티앤티"] },
  { symbol: "VZ",    name: "Verizon",              exchange: "NYSE",   keywords: ["버라이즌"] },
  { symbol: "TMUS",  name: "T-Mobile",             exchange: "NASDAQ", keywords: ["T모바일", "티모바일"] },
  { symbol: "CMCSA", name: "Comcast",              exchange: "NASDAQ", keywords: ["컴캐스트"] },
  { symbol: "CHTR",  name: "Charter Communications", exchange: "NASDAQ", keywords: ["차터커뮤니케이션스", "차터"] },
  // 항공·여행
  { symbol: "DAL",   name: "Delta Air Lines",      exchange: "NYSE",   keywords: ["델타항공", "델타"] },
  { symbol: "UAL",   name: "United Airlines",      exchange: "NASDAQ", keywords: ["유나이티드항공", "유나이티드에어"] },
  { symbol: "AAL",   name: "American Airlines",    exchange: "NASDAQ", keywords: ["아메리칸항공"] },
  { symbol: "LUV",   name: "Southwest Airlines",   exchange: "NYSE",   keywords: ["사우스웨스트항공", "사우스웨스트"] },
  { symbol: "MAR",   name: "Marriott International", exchange: "NASDAQ", keywords: ["메리어트"] },
  { symbol: "HLT",   name: "Hilton Worldwide",     exchange: "NYSE",   keywords: ["힐튼"] },
  // 리츠·부동산
  { symbol: "AMT",   name: "American Tower",       exchange: "NYSE",   keywords: ["아메리칸타워"] },
  { symbol: "PLD",   name: "Prologis",             exchange: "NYSE",   keywords: ["프롤로지스"] },
  { symbol: "O",     name: "Realty Income",        exchange: "NYSE",   keywords: ["리얼티인컴"] },
  { symbol: "SPG",   name: "Simon Property Group", exchange: "NYSE",   keywords: ["사이먼프로퍼티"] },
  // 추가 제약·바이오
  { symbol: "MRK",   name: "Merck & Co.",          exchange: "NYSE",   keywords: ["머크", "MSD"] },
  { symbol: "BMY",   name: "Bristol-Myers Squibb", exchange: "NYSE",   keywords: ["브리스톨마이어스", "BMS"] },
  { symbol: "AZN",   name: "AstraZeneca",          exchange: "NASDAQ", keywords: ["아스트라제네카"] },
  { symbol: "GSK",   name: "GSK",                  exchange: "NYSE",   keywords: ["GSK", "글락소스미스클라인"] },
  { symbol: "ILMN",  name: "Illumina",             exchange: "NASDAQ", keywords: ["일루미나"] },
  { symbol: "ALNY",  name: "Alnylam Pharmaceuticals", exchange: "NASDAQ", keywords: ["알닐람"] },
  { symbol: "EXAS",  name: "Exact Sciences",       exchange: "NASDAQ", keywords: ["이그잭트사이언스"] },
  { symbol: "HUM",   name: "Humana",               exchange: "NYSE",   keywords: ["휴마나"] },
  { symbol: "ELV",   name: "Elevance Health",      exchange: "NYSE",   keywords: ["엘레번스헬스", "앤섬"] },
  // 추가 소프트웨어
  { symbol: "TEAM",  name: "Atlassian",            exchange: "NASDAQ", keywords: ["아틀라시안"] },
  { symbol: "HUBS",  name: "HubSpot",              exchange: "NYSE",   keywords: ["허브스팟"] },
  { symbol: "TWLO",  name: "Twilio",               exchange: "NYSE",   keywords: ["트윌리오"] },
  { symbol: "GTLB",  name: "GitLab",               exchange: "NASDAQ", keywords: ["깃랩"] },
  { symbol: "PATH",  name: "UiPath",               exchange: "NYSE",   keywords: ["유아이패스", "UiPath"] },
  { symbol: "DOCN",  name: "DigitalOcean",         exchange: "NYSE",   keywords: ["디지털오션"] },
  { symbol: "APP",   name: "AppLovin",             exchange: "NASDAQ", keywords: ["앱러빈"] },
  { symbol: "TTD",   name: "The Trade Desk",       exchange: "NASDAQ", keywords: ["트레이드데스크"] },
  { symbol: "DKNG",  name: "DraftKings",           exchange: "NASDAQ", keywords: ["드래프트킹스"] },
  // 크립토·블록체인 관련
  { symbol: "MSTR",  name: "MicroStrategy",        exchange: "NASDAQ", keywords: ["마이크로스트래티지", "마이크로스트래터지"] },
  { symbol: "MARA",  name: "MARA Holdings",        exchange: "NASDAQ", keywords: ["마라홀딩스", "마라톤디지털"] },
  { symbol: "RIOT",  name: "Riot Platforms",       exchange: "NASDAQ", keywords: ["라이엇플랫폼스", "라이엇"] },
  { symbol: "IBIT",  name: "iShares Bitcoin ETF",  exchange: "NASDAQ", keywords: ["아이비트", "비트코인ETF"] },
  // ETF
  { symbol: "SPY",   name: "SPDR S&P 500 ETF",    exchange: "NYSE",   keywords: ["SPY", "S&P500ETF", "스파이"] },
  { symbol: "QQQ",   name: "Invesco QQQ (NASDAQ100)", exchange: "NASDAQ", keywords: ["QQQ", "나스닥100ETF", "큐큐큐"] },
  { symbol: "ARKK",  name: "ARK Innovation ETF",  exchange: "NYSE",   keywords: ["아크K", "ARKK", "아크인베스트"] },
  { symbol: "ARKQ",  name: "ARK Autonomous Tech ETF", exchange: "NYSE", keywords: ["아크Q", "ARKQ"] },
  { symbol: "ARKG",  name: "ARK Genomic Revolution ETF", exchange: "NYSE", keywords: ["아크G", "ARKG"] },
  { symbol: "SOXL",  name: "Direxion Semicon Bull 3X", exchange: "NYSE", keywords: ["반도체3배", "SOXL", "솩스엘"] },
  { symbol: "TQQQ",  name: "ProShares UltraPro QQQ 3X", exchange: "NASDAQ", keywords: ["나스닥3배", "TQQQ"] },
  { symbol: "NVDL",  name: "GraniteShares 2X NVDA", exchange: "NASDAQ", keywords: ["엔비디아2배", "NVDL"] },
  { symbol: "TSLL",  name: "Direxion Daily TSLA Bull 2X", exchange: "NASDAQ", keywords: ["테슬라2배", "TSLL"] },
  // 일본 기업 (미국 상장)
  { symbol: "SONY",  name: "Sony Group",           exchange: "NYSE",   keywords: ["소니"] },
  { symbol: "TM",    name: "Toyota Motor",         exchange: "NYSE",   keywords: ["토요타"] },
  { symbol: "HMC",   name: "Honda Motor",          exchange: "NYSE",   keywords: ["혼다"] },
  { symbol: "9984.T", name: "SoftBank Group",      exchange: "TSE",    keywords: ["소프트뱅크"] },
  { symbol: "NTT",   name: "NTT",                  exchange: "NYSE",   keywords: ["NTT", "일본전신전화"] },
  // 추가 반도체
  { symbol: "ON",    name: "ON Semiconductor",     exchange: "NASDAQ", keywords: ["ON세미컨덕터", "온세미"] },
  { symbol: "MCHP",  name: "Microchip Technology", exchange: "NASDAQ", keywords: ["마이크로칩테크놀로지", "마이크로칩"] },
  { symbol: "SWKS",  name: "Skyworks Solutions",   exchange: "NASDAQ", keywords: ["스카이웍스"] },
  { symbol: "QRVO",  name: "Qorvo",                exchange: "NASDAQ", keywords: ["코르보", "쿼보"] },
  { symbol: "MPWR",  name: "Monolithic Power Systems", exchange: "NASDAQ", keywords: ["모놀리식파워", "MPS"] },
  { symbol: "WOLF",  name: "Wolfspeed",            exchange: "NYSE",   keywords: ["울프스피드"] },
  // 추가 소비재
  { symbol: "CMG",   name: "Chipotle Mexican Grill", exchange: "NYSE", keywords: ["치폴레"] },
  { symbol: "YUM",   name: "Yum! Brands",          exchange: "NYSE",   keywords: ["얌브랜즈", "피자헛", "KFC타코벨"] },
  { symbol: "QSR",   name: "Restaurant Brands (BK)", exchange: "NYSE", keywords: ["버거킹", "레스토랑브랜즈"] },
  { symbol: "LULU",  name: "Lululemon",            exchange: "NASDAQ", keywords: ["룰루레몬"] },
  { symbol: "ROST",  name: "Ross Stores",          exchange: "NASDAQ", keywords: ["로스스토어스", "로스"] },
  { symbol: "TJX",   name: "TJX Companies",        exchange: "NYSE",   keywords: ["TJX", "TJ맥스"] },
  { symbol: "AMZN",  name: "Amazon",               exchange: "NASDAQ", keywords: ["아마존"] },
  { symbol: "HD",    name: "Home Depot",           exchange: "NYSE",   keywords: ["홈디포"] },
  { symbol: "LOW",   name: "Lowe's",               exchange: "NYSE",   keywords: ["로우스"] },
  { symbol: "CVS",   name: "CVS Health",           exchange: "NYSE",   keywords: ["CVS헬스", "CVS"] },
  // 원자재·광업
  { symbol: "NEM",   name: "Newmont",              exchange: "NYSE",   keywords: ["뉴몬트", "뉴몬트골드"] },
  { symbol: "FCX",   name: "Freeport-McMoRan",     exchange: "NYSE",   keywords: ["프리포트맥모란", "구리광산"] },
  { symbol: "AA",    name: "Alcoa",                exchange: "NYSE",   keywords: ["알코아"] },
  { symbol: "MP",    name: "MP Materials",         exchange: "NYSE",   keywords: ["MP머티리얼스", "희토류"] },
  // 추가 성장주
  { symbol: "DUOL",  name: "Duolingo",             exchange: "NASDAQ", keywords: ["듀오링고"] },
  { symbol: "CELH",  name: "Celsius Holdings",     exchange: "NASDAQ", keywords: ["셀시우스", "셀시어스"] },
  { symbol: "BROS",  name: "Dutch Bros",           exchange: "NYSE",   keywords: ["더치브로스"] },
  { symbol: "CVNA",  name: "Carvana",              exchange: "NYSE",   keywords: ["카바나"] },
  { symbol: "RDDT",  name: "Reddit",               exchange: "NYSE",   keywords: ["레딧"] },
  { symbol: "ARM",   name: "Arm Holdings",         exchange: "NASDAQ", keywords: ["암홀딩스", "ARM홀딩스"] },
];

function searchUSKorean(query: string): { symbol: string; shortname: string; exchange: string; quoteType: string }[] {
  const q = query.toLowerCase().replace(/\s/g, "");
  return US_KOREAN_MAP.filter(e =>
    e.keywords.some(k => k.toLowerCase().replace(/\s/g, "").includes(q) || q.includes(k.toLowerCase().replace(/\s/g, "")))
  ).slice(0, 5).map(e => ({ symbol: e.symbol, shortname: `${e.name} (${e.symbol})`, exchange: e.exchange, quoteType: "EQUITY" }));
}

function toResult(e: StockEntry) {
  return { symbol: e.symbol, shortname: e.name, exchange: e.exchange, quoteType: "EQUITY" };
}

// symbol → 표시명 우선 적용 맵 (KOREAN_COMPANY_MAP 기준 Naver 단축명)
const DISPLAY_NAME_OVERRIDE = new Map<string, string>(
  KOREAN_COMPANY_MAP.map(c => [c.symbol, c.name])
);
// symbol → 검색 키워드 확장 맵
const KEYWORD_MAP = new Map<string, string[]>(
  KOREAN_COMPANY_MAP.map(c => [c.symbol, c.keywords])
);

// 우선주 판별: 종목명이 "우", "우B", "우C" 등으로 끝나는 경우
const isPreferredStock = (name: string): boolean => /우[A-Z0-9]?$/.test(name.trim());

function searchKorean(query: string): ReturnType<typeof toResult>[] {
  const q = query.toLowerCase().replace(/\s/g, "");
  const krxCache = getKRXCache();

  // 미국 주식 한글명 먼저 매칭 (정확도 우선)
  const usResults = searchUSKorean(query);

  const krResults: ReturnType<typeof toResult>[] = [];

  if (krxCache.length > 0) {
    const seen = new Set<string>();
    for (const e of krxCache) {
      if (isPreferredStock(e.name)) continue; // 우선주 제외
      const krxName = e.name.toLowerCase().replace(/\s/g, "");
      const keywords = KEYWORD_MAP.get(e.symbol) ?? [];
      const matchName = krxName.includes(q);
      const matchKeyword = keywords.some(k => {
        const kn = k.toLowerCase().replace(/\s/g, "");
        return kn.includes(q) || q.includes(kn);
      });
      if ((matchName || matchKeyword) && !seen.has(e.symbol)) {
        seen.add(e.symbol);
        const displayName = DISPLAY_NAME_OVERRIDE.get(e.symbol) ?? e.name;
        krResults.push({ symbol: e.symbol, shortname: displayName, exchange: e.exchange, quoteType: "EQUITY" });
      }
      if (krResults.length >= 6) break;
    }
  } else {
    const fallback = KOREAN_COMPANY_MAP.filter(c =>
      c.keywords.some(k => k.includes(q) || q.includes(k))
    ).map(c => ({ symbol: c.symbol, shortname: c.name, exchange: c.exchange, quoteType: "EQUITY" }));
    krResults.push(...fallback.slice(0, 6));
  }

  // US 결과가 있으면 상단에, KR 결과는 하단에
  const seenAll = new Set<string>();
  const merged: ReturnType<typeof toResult>[] = [];
  for (const r of [...usResults, ...krResults]) {
    if (!seenAll.has(r.symbol)) { seenAll.add(r.symbol); merged.push(r); }
  }
  return merged.slice(0, 8);
}

function searchEnglishLocal(query: string): ReturnType<typeof toResult>[] {
  const q = query.toLowerCase().replace(/[\s\-\.&]/g, "");
  // 짧은 쿼리(1~3자)는 이름 mid-match 금지 — 예: "sk" → "novonordisk" 오매칭 방지
  const nameMatch = (nameNorm: string) =>
    q.length <= 3 ? nameNorm.startsWith(q) : (nameNorm.includes(q) || q.includes(nameNorm));

  // 미국 종목 우선 검색 (US_KOREAN_MAP): 심볼 정확 매칭 > 이름 포함 > 키워드
  const usResults = US_KOREAN_MAP.filter(c => {
    const symbolNorm = c.symbol.toLowerCase();
    const nameNorm = c.name.toLowerCase().replace(/[\s\-\.&]/g, "");
    if (symbolNorm === q || symbolNorm.startsWith(q)) return true;
    if (nameMatch(nameNorm)) return true;
    return c.keywords.some(k => {
      const kn = k.toLowerCase().replace(/[\s\-\.&]/g, "");
      return kn.includes(q) || q.includes(kn);
    });
  }).slice(0, 8).map(c => ({ symbol: c.symbol, shortname: `${c.name} (${c.symbol})`, exchange: c.exchange, quoteType: "EQUITY" as const }));

  // KRX 캐시에서 이름이 쿼리로 시작하는 종목 (예: "SK" → SK하이닉스·SK텔레콤 등)
  // 스팩(SPAC) 판별: "X호스팩", "스팩", "SPAC" 패턴
  const isSpac = (name: string) => /스팩|spac|\d+호스팩/i.test(name);
  const krxCache = getKRXCache();
  const krxResults: ReturnType<typeof toResult>[] = [];
  if (krxCache.length > 0) {
    const seen = new Set<string>();
    const allMatches: { entry: StockEntry; displayName: string }[] = [];
    for (const e of krxCache) {
      if (isPreferredStock(e.name)) continue;
      if (isSpac(e.name)) continue; // 스팩 제외
      const nameNorm = e.name.toLowerCase().replace(/\s/g, "");
      if (nameNorm.startsWith(q) && !seen.has(e.symbol)) {
        seen.add(e.symbol);
        allMatches.push({ entry: e, displayName: DISPLAY_NAME_OVERRIDE.get(e.symbol) ?? e.name });
      }
    }
    // 정렬: KOSPI 우선 → 종목코드 오름차순 (코드 번호가 낮을수록 오래된 대형 대표 종목)
    allMatches.sort((a, b) => {
      if (a.entry.exchange !== b.entry.exchange) {
        return a.entry.exchange === "KOSPI" ? -1 : 1;
      }
      return Number(a.entry.code) - Number(b.entry.code);
    });
    for (const { entry, displayName } of allMatches.slice(0, 6)) {
      krxResults.push({ symbol: entry.symbol, shortname: displayName, exchange: entry.exchange, quoteType: "EQUITY" });
    }
  }

  // US 심볼 매칭 + KRX 이름 매칭 병합; US 결과가 있어도 KRX 결과를 추가로 포함
  const merged: ReturnType<typeof toResult>[] = [];
  const seenAll = new Set<string>();
  for (const r of [...usResults, ...krxResults]) {
    if (!seenAll.has(r.symbol)) { seenAll.add(r.symbol); merged.push(r); }
  }
  if (merged.length > 0) return merged.slice(0, 8);

  // 한국 종목 폴백 (KOREAN_COMPANY_MAP): 심볼·이름 영문 매칭
  return KOREAN_COMPANY_MAP.filter(c => {
    const nameNorm = c.name.toLowerCase().replace(/[\s\-\.&]/g, "");
    if (nameMatch(nameNorm)) return true;
    return c.keywords.some(k => {
      const kn = k.replace(/[\s\-\.&]/g, "");
      return kn.includes(q) || q.includes(kn);
    });
  }).slice(0, 8).map(c => ({ symbol: c.symbol, shortname: c.name, exchange: c.exchange, quoteType: "EQUITY" as const }));
}

function searchByCode(digits: string): ReturnType<typeof toResult>[] {
  const krxCache = getKRXCache();
  if (krxCache.length > 0) {
    return krxCache
      .filter(e => e.code.startsWith(digits) && !isPreferredStock(e.name))
      .slice(0, 8)
      .map(toResult);
  }
  return KOREAN_COMPANY_MAP
    .filter(c => c.symbol.startsWith(digits) && !isPreferredStock(c.name))
    .slice(0, 8)
    .map(c => ({ symbol: c.symbol, shortname: c.name, exchange: c.exchange, quoteType: "EQUITY" }));
}

router.get("/search/:query", async (req, res) => {
  const query = req.params.query?.trim() ?? "";
  if (!query) { res.json([]); return; }

  // KRX 캐시 로드 보장 (미로드 시 대기)
  await loadKRXList();

  // 한글 회사명 → KRX 전체 종목 검색
  if (/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(query)) {
    res.json(searchKorean(query));
    return;
  }

  // 6자리 숫자 종목코드 → KOSPI/KOSDAQ 직접 조회 (Yahoo Finance)
  if (/^\d{6}$/.test(query)) {
    try {
      const [ksQ, kqQ] = await Promise.allSettled([
        yahooFinance.quote(`${query}.KS`),
        yahooFinance.quote(`${query}.KQ`),
      ]);
      const results: any[] = [];
      const isValidName = (n: string, ticker: string) =>
        n && n !== ticker && !n.includes(",") && !n.match(/^\d/) && n.length > 1;

      if (ksQ.status === "fulfilled") {
        const sym = `${query}.KS`;
        const yahooName = ksQ.value.longName || ksQ.value.shortName || "";
        const name = DISPLAY_NAME_OVERRIDE.get(sym) || yahooName;
        const englishName = (DISPLAY_NAME_OVERRIDE.has(sym) && yahooName && yahooName !== name) ? yahooName : undefined;
        if (isValidName(name, sym)) results.push({ symbol: sym, shortname: name, englishName, exchange: "KOSPI", quoteType: "EQUITY" });
      }
      if (kqQ.status === "fulfilled") {
        const sym = `${query}.KQ`;
        const yahooName = kqQ.value.longName || kqQ.value.shortName || "";
        const name = DISPLAY_NAME_OVERRIDE.get(sym) || yahooName;
        const englishName = (DISPLAY_NAME_OVERRIDE.has(sym) && yahooName && yahooName !== name) ? yahooName : undefined;
        if (isValidName(name, sym)) results.push({ symbol: sym, shortname: name, englishName, exchange: "KOSDAQ", quoteType: "EQUITY" });
      }
      // Fallback: if Yahoo returned nothing, still try local map
      if (results.length === 0) {
        res.json(searchByCode(query));
      } else {
        res.json(results);
      }
    } catch {
      res.json(searchByCode(query));
    }
    return;
  }

  // 부분 숫자 코드(2~5자리) → 로컬 맵 prefix 검색
  if (/^\d{2,5}$/.test(query)) {
    res.json(searchByCode(query));
    return;
  }

  // 영문 텍스트 → 로컬 맵 + Yahoo Finance 병합
  if (/^[A-Za-z0-9\-\. ]+$/.test(query) && query.length >= 2) {
    const local = searchEnglishLocal(query);
    let yahoo: any[] = [];
    try {
      const result = await (yahooFinance as any).search(query, { newsCount: 0, quotesCount: 20 }, { validateResult: false });
      const quotes: any[] = result?.quotes ?? [];
      // 지원 거래소: KOSPI·KOSDAQ (한국), NYSE·NASDAQ·AMEX (미국) 만 허용
      const ALLOWED_EXCHANGES = new Set(["KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "AMEX"]);
      yahoo = quotes
        .filter((q: any) => {
          if (!q.symbol) return false;
          const qt = (q.quoteType ?? "").toString().toUpperCase();
          // quoteType이 파싱 실패로 빈 문자열·undefined인 경우도 EQUITY 계열로 허용
          // ETF·MUTUALFUND·FUTURE·CURRENCY·CRYPTOCURRENCY·INDEX는 명시적으로 제외
          const EXCLUDED = new Set(["ETF", "MUTUALFUND", "FUTURE", "CURRENCY", "CRYPTOCURRENCY", "INDEX"]);
          return !EXCLUDED.has(qt);
        })
        .map((q: any) => {
          let exchange = q.exchange ?? "";
          if (q.symbol.endsWith(".KS")) exchange = "KOSPI";
          else if (q.symbol.endsWith(".KQ")) exchange = "KOSDAQ";
          else if (exchange === "NMS" || exchange === "NGM" || exchange === "NCM") exchange = "NASDAQ";
          else if (exchange === "NYQ" || exchange === "NYS") exchange = "NYSE";
          else if (exchange === "ASE" || exchange === "AMX") exchange = "AMEX";
          return {
            symbol: q.symbol,
            shortname: q.longname || q.shortname || q.symbol,
            exchange,
            quoteType: "EQUITY",
          };
        })
        // 비지원 거래소(도쿄·런던·홍콩 등) 및 exchange 미확인 종목 제거
        .filter((q: any) => ALLOWED_EXCHANGES.has(q.exchange));
    } catch { /* fall through */ }

    // 로컬 결과 우선, Yahoo Finance 결과 추가 (중복 심볼 제거)
    // Yahoo의 영문명을 로컬 결과의 englishName으로 보강
    const seen = new Set(local.map(r => r.symbol));
    const yahooBySymbol = new Map(yahoo.map((r: any) => [r.symbol, r.shortname as string]));
    const mergedWithEn = local.map(r => ({ ...r, englishName: yahooBySymbol.get(r.symbol) }));
    let merged = [...mergedWithEn, ...yahoo.filter((r: any) => !seen.has(r.symbol))].slice(0, 10);

    // Fallback: 결과 없고 쿼리가 티커처럼 보이면(1~5 알파) Yahoo quote 직접 조회
    if (merged.length === 0 && /^[A-Za-z]{1,5}$/.test(query.trim())) {
      const sym = query.trim().toUpperCase();
      try {
        const ALLOWED_EXCHANGES = new Set(["KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "AMEX"]);
        const q = await yahooFinance.quote(sym, {}, { validateResult: false });
        if (q && q.symbol) {
          let exchange = (q as any).exchange ?? "";
          if (exchange === "NMS" || exchange === "NGM" || exchange === "NCM") exchange = "NASDAQ";
          else if (exchange === "NYQ" || exchange === "NYS") exchange = "NYSE";
          else if (exchange === "ASE" || exchange === "AMX") exchange = "AMEX";
          const name = (q as any).longName || (q as any).shortName || sym;
          if (ALLOWED_EXCHANGES.has(exchange) && name) {
            merged = [{ symbol: q.symbol, shortname: `${name} (${q.symbol})`, exchange, quoteType: "EQUITY" }];
          }
        }
      } catch { /* fallthrough */ }
    }

    res.json(merged);
    return;
  }

  res.json([]);
});

// ─── 배치 현재가 조회 (트래커용) ─────────────────────────────────────────────
// 단일 티커 현재가 조회 (KQ/KS 자동 판별)
async function resolveQuote(raw: string): Promise<{ price: number | null; currency: string; change: number | null }> {
  const ticker = raw.trim();
  const sixDigit = ticker.split(".")[0];
  const isKoreanSix = /^\d{6}$/.test(sixDigit) && !ticker.includes(".");

  if (isKoreanSix) {
    // ── 1순위: KIS API 실시간 현재가 (캐시 토큰 재사용 → 가장 빠름) ──────────
    try {
      const kis = await fetchKISStockQuote(sixDigit);
      if (kis && kis.price && kis.price > 0) {
        return { price: kis.price, currency: "KRW", change: kis.changeRate ?? null };
      }
    } catch (e) {
      console.warn(`[resolveQuote] KIS fallback for ${sixDigit}:`, (e as Error).message?.slice(0, 60));
    }

    // ── 2순위: 네이버 금융 실시간가 ─────────────────────────────────────────
    try {
      const naverRes = await fetch(
        `https://m.stock.naver.com/api/stock/${sixDigit}/basic`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Referer": "https://m.stock.naver.com/",
          },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (naverRes.ok) {
        const nb = await naverRes.json() as any;
        // closePrice = 당일 종가 or 현재가 (장 중에는 현재가)
        const rawPrice = nb?.closePrice ?? nb?.stockItemTotalInfos?.find((x: any) => x.code === "closePrice")?.value;
        const naverPrice = rawPrice ? Number(String(rawPrice).replace(/,/g, "")) : null;
        // fluctuationsRatio = 네이버가 직접 제공하는 등락률(%) — previousClosePrice가 응답에 없으므로 이걸 우선 사용
        const naverChange: number | null =
          nb?.fluctuationsRatio != null ? Number(nb.fluctuationsRatio)
          : nb?.compareToPreviousClosePrice != null && nb?.previousClosePrice > 0
            ? (Number(String(nb.compareToPreviousClosePrice).replace(/,/g, "")) / Number(String(nb.previousClosePrice).replace(/,/g, ""))) * 100
            : null;
        if (naverPrice != null && naverPrice > 0) {
          console.log(`[resolveQuote] Naver price for ${sixDigit}: ${naverPrice} change: ${naverChange}`);
          return { price: naverPrice, currency: "KRW", change: naverChange };
        }
      }
    } catch (e) {
      console.warn(`[resolveQuote] Naver fallback failed for ${sixDigit}:`, (e as Error).message?.slice(0, 60));
    }

    // ── 2순위: Yahoo Finance — KQ와 KS 동시 조회 후 네이버 검증 ───────────────
    const [kqRes, ksRes] = await Promise.allSettled([
      yahooFinance.quote(`${sixDigit}.KQ`, { fields: ["regularMarketPrice", "regularMarketChangePercent", "currency", "marketCap"] }),
      yahooFinance.quote(`${sixDigit}.KS`, { fields: ["regularMarketPrice", "regularMarketChangePercent", "currency", "marketCap"] }),
    ]);
    const kqPrice = kqRes.status === "fulfilled" ? (kqRes.value?.regularMarketPrice ?? null) : null;
    const ksPrice = ksRes.status === "fulfilled" ? (ksRes.value?.regularMarketPrice ?? null) : null;

    // 둘 다 유효하면 시가총액이 더 큰 쪽 선택 (대형주가 정분석 대상일 가능성 높음)
    // 시가총액 없으면 KS 우선 (코스피 대형주가 더 흔함)
    let winner: PromiseSettledResult<any> | null = null;
    if (kqPrice != null && ksPrice != null) {
      const kqMcap = kqRes.status === "fulfilled" ? (kqRes.value?.marketCap ?? 0) : 0;
      const ksMcap = ksRes.status === "fulfilled" ? (ksRes.value?.marketCap ?? 0) : 0;
      winner = ksMcap >= kqMcap ? ksRes : kqRes; // KS 우선 (동점이면 KS)
    } else {
      winner = kqPrice != null ? kqRes : ksPrice != null ? ksRes : null;
    }

    if (!winner || winner.status !== "fulfilled" || !winner.value?.regularMarketPrice) {
      return { price: null, currency: "KRW", change: null };
    }
    return {
      price: winner.value.regularMarketPrice,
      currency: winner.value.currency ?? "KRW",
      change: winner.value.regularMarketChangePercent ?? null,
    };
  }

  // ── 미국주식 or 이미 suffix 포함 (.KS/.KQ) ────────────────────────────────
  // suffix가 있는 한국 종목은 네이버에서 직접 가격 우선 조회
  if (ticker.endsWith(".KS") || ticker.endsWith(".KQ")) {
    const code = ticker.split(".")[0];
    try {
      const naverRes = await fetch(
        `https://m.stock.naver.com/api/stock/${code}/basic`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "Referer": "https://m.stock.naver.com/",
          },
          signal: AbortSignal.timeout(4000),
        }
      );
      if (naverRes.ok) {
        const nb = await naverRes.json() as any;
        const rawPrice = nb?.closePrice ?? nb?.stockItemTotalInfos?.find((x: any) => x.code === "closePrice")?.value;
        const naverPrice = rawPrice ? Number(String(rawPrice).replace(/,/g, "")) : null;
        const naverChange: number | null =
          nb?.fluctuationsRatio != null ? Number(nb.fluctuationsRatio)
          : nb?.compareToPreviousClosePrice != null && nb?.previousClosePrice > 0
            ? (Number(String(nb.compareToPreviousClosePrice).replace(/,/g, "")) / Number(String(nb.previousClosePrice).replace(/,/g, ""))) * 100
            : null;
        if (naverPrice != null && naverPrice > 0) {
          console.log(`[resolveQuote] Naver price for ${code} (.KS/.KQ): ${naverPrice} change: ${naverChange}`);
          return { price: naverPrice, currency: "KRW", change: naverChange };
        }
      }
    } catch { /* fall through to Yahoo */ }
  }

  const quote = await yahooFinance.quote(ticker, { fields: ["regularMarketPrice", "regularMarketChangePercent", "currency"] });
  return {
    price: quote?.regularMarketPrice ?? null,
    currency: quote?.currency ?? "USD",
    change: quote?.regularMarketChangePercent ?? null,
  };
}

router.post("/batch-quotes", async (req, res) => {
  const { tickers } = req.body as { tickers: string[] };
  if (!Array.isArray(tickers) || tickers.length === 0) {
    res.status(400).json({ error: "tickers 배열이 필요합니다" });
    return;
  }

  const results: Record<string, { price: number | null; currency: string; change: number | null }> = {};
  const toFetch: string[] = [];

  for (const raw of tickers.slice(0, 40)) {
    const ticker = raw.trim();
    if (!ticker) continue;
    const cached = cache.get<{ price: number | null; currency: string; change: number | null }>(`bq:${ticker}`);
    if (cached) {
      results[ticker] = cached;
    } else {
      toFetch.push(ticker);
    }
  }

  const bqSettled = await batchProcess(toFetch, async (ticker) => {
    const q = await resolveQuote(ticker);
    cache.set(`bq:${ticker}`, q, TTL_BATCH_QUOTES);
    return { ticker, q };
  }, 10, 100);
  for (const r of bqSettled) {
    if (r.status === "fulfilled") {
      results[r.value.ticker] = r.value.q;
    } else {
      const ticker = toFetch[bqSettled.indexOf(r)];
      if (ticker) results[ticker] = { price: null, currency: "KRW", change: null };
    }
  }

  res.json(results);
});

// POST /api/market-data/batch-sparklines — 다수 티커 3개월 종가 일괄 조회
router.post("/batch-sparklines", async (req, res) => {
  const { tickers, days = 90 } = req.body as { tickers: string[]; days?: number };
  if (!Array.isArray(tickers) || tickers.length === 0) {
    res.status(400).json({ error: "tickers 필수" });
    return;
  }

  const result: Record<string, { closes: number[]; change3m: number | null }> = {};
  const toFetch: string[] = [];

  for (const raw of tickers.slice(0, 20)) {
    const ticker = raw.trim();
    if (!ticker) continue;
    const cacheKey = `bsp:${ticker}:${days}`;
    const cached = cache.get<{ closes: number[]; change3m: number | null }>(cacheKey);
    if (cached) {
      result[ticker] = cached;
    } else {
      toFetch.push(ticker);
    }
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Math.min(days, 180));
  const p1 = startDate.toISOString().split("T")[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const p2 = tomorrow.toISOString().split("T")[0];

  await batchProcess(toFetch, async (ticker) => {
      const cacheKey = `bsp:${ticker}:${days}`;
      try {
        const isKoreanSix = /^\d{6}$/.test(ticker.split(".")[0]) && !ticker.includes(".");
        let closes: number[] = [];

        if (isKoreanSix) {
          // KIS 기간별 시세 — 단일 호출, 실시간, .KQ/.KS 이중 시도 불필요
          const history = await fetchKISDailyPriceHistory(ticker.split(".")[0]);
          if (history.length > 0) {
            closes = history.map(d => d.close);
          } else {
            // KIS 실패 시 Yahoo Finance fallback
            const [kqChart, ksChart] = await Promise.allSettled([
              yahooFinance.chart(`${ticker}.KQ`, { period1: p1, period2: p2, interval: "1d" }),
              yahooFinance.chart(`${ticker}.KS`, { period1: p1, period2: p2, interval: "1d" }),
            ]);
            const kqCloses = kqChart.status === "fulfilled"
              ? (kqChart.value?.quotes ?? []).filter((d: any) => d.close != null && d.close > 0).map((d: any) => d.close as number)
              : [];
            const ksCloses = ksChart.status === "fulfilled"
              ? (ksChart.value?.quotes ?? []).filter((d: any) => d.close != null && d.close > 0).map((d: any) => d.close as number)
              : [];
            closes = kqCloses.length > 0 ? kqCloses : ksCloses;
          }
        } else {
          const chart = await yahooFinance.chart(ticker, { period1: p1, period2: p2, interval: "1d" });
          closes = (chart?.quotes ?? []).filter((d: any) => d.close != null && d.close > 0).map((d: any) => d.close as number);
        }

        const change3m = closes.length >= 2
          ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
          : null;
        const val = { closes, change3m };
        cache.set(cacheKey, val, TTL_BATCH_SPARKLINES);
        result[ticker] = val;
      } catch {
        result[ticker] = { closes: [], change3m: null };
      }
  }, 10, 100);

  res.json(result);
});

// POST /api/market-data/batch-performance — 분석일 기준 기간별 수익률 계산
router.post("/batch-performance", async (req, res) => {
  const items = req.body as Array<{ id: number; ticker: string; analysisDate: string }>;
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "items 배열이 필요합니다" });
    return;
  }

  type PerfResult = { w1: number | null; m1: number | null; m3: number | null; entryClose: number | null };
  const results: Record<number, PerfResult> = {};
  const toFetch: typeof items = [];

  for (const item of items) {
    const cacheKey = `bperf:${item.id}`;
    const cached = cache.get<PerfResult>(cacheKey);
    if (cached) {
      results[item.id] = cached;
    } else {
      toFetch.push(item);
    }
  }

  // 특정 날짜 이후 첫 번째 거래일 종가를 찾는 헬퍼
  function findClose(quotes: Array<{ date: Date; close: number | null }>, afterDate: Date, plusDays: number): number | null {
    const target = new Date(afterDate);
    target.setDate(target.getDate() + plusDays);
    // target 이후 첫 번째 유효한 종가
    const sorted = quotes.filter(q => q.close != null && q.close > 0 && new Date(q.date) >= target);
    return sorted.length > 0 ? (sorted[0].close as number) : null;
  }

  async function fetchQuotes(ticker: string, from: Date): Promise<Array<{ date: Date; close: number | null }>> {
    const p1 = from.toISOString().split("T")[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const p2 = tomorrow.toISOString().split("T")[0];

    const isKoreanSix = /^\d{6}(\.(KS|KQ))?$/.test(ticker.split(".")[0]);
    const rawCode = ticker.replace(/\.(KS|KQ)$/, "");
    const isAlreadySuffixed = /\.(KS|KQ)$/i.test(ticker);

    if (isKoreanSix && !isAlreadySuffixed) {
      const [kqR, ksR] = await Promise.allSettled([
        yahooFinance.chart(`${rawCode}.KQ`, { period1: p1, period2: p2, interval: "1d" }),
        yahooFinance.chart(`${rawCode}.KS`, { period1: p1, period2: p2, interval: "1d" }),
      ]);
      const kqQ = kqR.status === "fulfilled" ? (kqR.value?.quotes ?? []) : [];
      const ksQ = ksR.status === "fulfilled" ? (ksR.value?.quotes ?? []) : [];
      const chosen = kqQ.length >= ksQ.length ? kqQ : ksQ;
      return chosen.map((d: any) => ({ date: new Date(d.date), close: d.close ?? null }));
    }

    const chart = await yahooFinance.chart(ticker, { period1: p1, period2: p2, interval: "1d" });
    return (chart?.quotes ?? []).map((d: any) => ({ date: new Date(d.date), close: d.close ?? null }));
  }

  await batchProcess(toFetch.slice(0, 30), async ({ id, ticker, analysisDate }) => {
      try {
        const fromDate = new Date(analysisDate);
        fromDate.setDate(fromDate.getDate() - 1);

        const quotes = await fetchQuotes(ticker, fromDate);
        if (quotes.length === 0) {
          results[id] = { w1: null, m1: null, m3: null, entryClose: null };
          return;
        }

        const analysisTs = new Date(analysisDate);
        const entryQuote = quotes.find(q => q.close != null && q.close > 0 && new Date(q.date) >= new Date(analysisTs.toISOString().split("T")[0]));
        const entryClose = entryQuote?.close ?? null;
        if (!entryClose) {
          results[id] = { w1: null, m1: null, m3: null, entryClose: null };
          return;
        }

        const pct = (close: number | null) =>
          close != null ? ((close - entryClose) / entryClose) * 100 : null;

        const perf = {
          entryClose,
          w1: pct(findClose(quotes, new Date(analysisDate), 7)),
          m1: pct(findClose(quotes, new Date(analysisDate), 30)),
          m3: pct(findClose(quotes, new Date(analysisDate), 90)),
        };
        cache.set(`bperf:${id}`, perf, TTL_BATCH_PERFORMANCE);
        results[id] = perf;
      } catch {
        results[id] = { w1: null, m1: null, m3: null, entryClose: null };
      }
  }, 10, 100);

  res.json(results);
});

// ─── GET /api/market-data/earnings-calendar ───────────────────────────────────
// range=week(7일) | month(30일)  |  tickers=추가종목(쉼표구분, 옵션)
// ── Gemini 기반 한국 종목 실적발표일 조회 (12시간 캐시) ──────────────────────────
const _krEarningsCache = new Map<string, { data: Map<string, string>; expiresAt: number }>();
const _geminiInProgress = new Set<string>(); // 동시 중복 실행 방지
const _yfCache = new Map<string, { data: any[]; expiresAt: number }>(); // Yahoo Finance 인메모리 캐시 (2차)

interface EconomicEvent {
  date: string;
  time?: string;
  title: string;
  country: string;
  category: string;
  importance: "high" | "medium" | "low";
  forecast?: string;
  previous?: string;
  unit?: string;
}
const _economicCalCache = new Map<string, { data: EconomicEvent[]; expiresAt: number }>();
const ECONOMIC_CAL_TTL_MS = 24 * 60 * 60 * 1000;

// ─── DB 영구 캐시 (서버 재시작에도 유지) ─────────────────────────────────────────
/** system_cache 테이블 초기화 (없으면 생성) */
export async function initCalendarCache() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_cache (
      key        TEXT PRIMARY KEY,
      data       JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
}

async function getFromDBCache<T>(key: string): Promise<T | null> {
  try {
    const r = await pool.query<{ data: T }>(
      `SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()`,
      [key]
    );
    return r.rows[0]?.data ?? null;
  } catch { return null; }
}

async function saveToDBCache(key: string, data: unknown, ttlMs: number) {
  try {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(data), expiresAt]
    );
  } catch (e: any) {
    console.error("[system_cache] save error:", e?.message);
  }
}

// ── 전역 상수 (워밍업 함수에서도 사용) ────────────────────────────────────────
const DEFAULT_KR = ["005930.KS","000660.KS","035420.KS","005380.KS","051910.KS","035720.KS","012330.KS","000270.KS"];
const DEFAULT_US = ["AAPL","MSFT","NVDA","META","GOOG","AMZN","TSLA","AVGO"];
const CALENDAR_DEFAULT_TICKERS = [...DEFAULT_KR, ...DEFAULT_US];
const CALENDAR_YF_TTL_MS  = 24 * 60 * 60 * 1000; // 24시간
const CALENDAR_GEM_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

function buildKrNameMap(): Record<string, string> {
  const m: Record<string, string> = {};
  for (const item of KOREAN_COMPANY_MAP) {
    m[item.symbol] = item.name;
    m[item.symbol.replace(/\.(KS|KQ)$/, "")] = item.name;
  }
  return m;
}

/** 서버 시작 시 실적 캘린더 캐시 사전 로딩 */
export async function warmupEarningsCache() {
  console.log("[earnings-calendar] 캐시 워밍업 시작...");
  for (const rangeDays of [7, 30]) {
    const range = rangeDays === 7 ? "week" : "month";
    try {
      // DB에서 최근 분석 종목 조회
      let dbRows: Array<{ ticker: string; company_name: string }> = [];
      try {
        const r = await pool.query<{ ticker: string; company_name: string }>(
          `SELECT DISTINCT ON (ticker) ticker, company_name FROM analyses
           WHERE created_at >= NOW() - INTERVAL '90 days' AND status = 'completed'
           ORDER BY ticker, created_at DESC LIMIT 60`
        );
        dbRows = r.rows;
      } catch { /* DB 오류는 무시하고 기본 종목만 사용 */ }

      const krNameMap = buildKrNameMap();
      const nameMap: Record<string, string> = { ...krNameMap };
      for (const row of dbRows) {
        nameMap[row.ticker] = krNameMap[row.ticker] ?? row.company_name;
      }
      const allTickers = Array.from(new Set([
        ...dbRows.map(r => r.ticker),
        ...CALENDAR_DEFAULT_TICKERS,
      ]));

      const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
      const kstNowMs = Date.now() + KST_OFFSET_MS;
      const kstMidnightUtc = kstNowMs - (kstNowMs % (24 * 60 * 60 * 1000)) - KST_OFFSET_MS;
      const now       = new Date(kstMidnightUtc);
      const pastStart = new Date(kstMidnightUtc - 14 * 86400000); // 최근 14일 발표 완료 포함
      const rangeEnd  = new Date(kstMidnightUtc + (rangeDays + 1) * 86400000);
      const toKSTDateStr = (d: Date) =>
        new Date(d.getTime() + KST_OFFSET_MS).toISOString().split("T")[0];

      // YF 배치 처리 (5개씩, 100ms 딜레이)
      const settled = await batchProcess(allTickers, async t => {
        try {
          const d = await yahooFinance.quoteSummary(t,
            { modules: ["calendarEvents", "price", "earningsTrend", "earningsHistory"] }, { validateResult: false });
          return { ticker: t, data: d as any };
        } catch { return null; }
      }, 5, 100);

      const raw: any[] = [];
      for (const r of settled) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const { ticker, data } = r.value;
        const cal = data?.calendarEvents;
        const pr  = data?.price;
        const dates: any[] = cal?.earnings?.earningsDate ?? [];
        if (!dates.length) continue;

        // earningsTrend: 현재 분기 컨센서스 추출
        const trendArr: any[] = data?.earningsTrend?.trend ?? [];
        const currentQtrW = trendArr.find((tr: any) => tr.period === "0q" || tr.period === "+1q") ?? trendArr[0];
        const analyticCountW: number | null = currentQtrW?.earningsEstimate?.numberOfAnalysts ?? null;
        const fqEndW = currentQtrW?.endDate;
        const fiscalQuarterEndingW: string | null = fqEndW
          ? (() => { const d2 = fqEndW instanceof Date ? fqEndW : new Date(fqEndW); return `${d2.toLocaleDateString("en-US",{month:"short"})} ${d2.getFullYear()}`; })()
          : null;

        // earningsHistory: 가장 최근 분기 실적 (발표 완료 시 당분기 결과, 미발표 시 전분기 참고)
        const histListW: any[] = data?.earningsHistory?.history ?? [];
        const sortedHistW = [...histListW].sort((a, b) => {
          const da = a.quarter instanceof Date ? a.quarter.getTime() : new Date(a.quarter ?? 0).getTime();
          const db = b.quarter instanceof Date ? b.quarter.getTime() : new Date(b.quarter ?? 0).getTime();
          return db - da;
        });
        const lastQtrW = sortedHistW[0];

        // 발표 완료: pastStart~now, 발표 예정: now~rangeEnd (각각 최근 날짜 1건씩)
        const sortedDates = [...dates].sort((a, b) => {
          const ta = typeof a === "number" ? a * 1000 : (a instanceof Date ? a.getTime() : new Date(a).getTime());
          const tb = typeof b === "number" ? b * 1000 : (b instanceof Date ? b.getTime() : new Date(b).getTime());
          return tb - ta; // 최신순
        });
        let pushedCompleted = false;
        let pushedUpcoming  = false;
        for (const rawDate of sortedDates) {
          const ts   = typeof rawDate === "number" ? rawDate * 1000
            : (rawDate instanceof Date ? rawDate.getTime() : new Date(rawDate).getTime());
          const date = new Date(ts);
          const isCompleted = date >= pastStart && date < now;
          const isUpcoming  = date >= now && date <= rangeEnd;
          if (!isCompleted && !isUpcoming) continue;
          if (isCompleted && pushedCompleted) continue;
          if (isUpcoming  && pushedUpcoming)  continue;

          const currency = pr?.currency ?? (ticker.endsWith(".KS") || ticker.endsWith(".KQ") ? "KRW" : "USD");
          const isKorean = currency === "KRW";
          let displayDate = date;
          if (isKorean && date.getUTCHours() >= 4 && date.getUTCHours() <= 8)
            displayDate = new Date(date.getTime() + 86400000);
          raw.push({
            ticker, companyName: nameMap[ticker] ?? pr?.shortName ?? pr?.longName ?? ticker,
            earningsDate: toKSTDateStr(displayDate),
            epsEstimate:     isCompleted ? null : (currentQtrW?.earningsEstimate?.avg ?? cal?.earnings?.earningsAverage ?? null),
            epsLow:          isCompleted ? null : (currentQtrW?.earningsEstimate?.low ?? cal?.earnings?.earningsLow ?? null),
            epsHigh:         isCompleted ? null : (currentQtrW?.earningsEstimate?.high ?? cal?.earnings?.earningsHigh ?? null),
            revenueEstimate: isCompleted ? null : (currentQtrW?.revenueEstimate?.avg ?? cal?.earnings?.revenueAverage ?? null),
            revenueLow:      isCompleted ? null : (currentQtrW?.revenueEstimate?.low ?? null),
            revenueHigh:     isCompleted ? null : (currentQtrW?.revenueEstimate?.high ?? null),
            analyticCount:   analyticCountW,
            fiscalQuarterEnding: fiscalQuarterEndingW,
            epsActualPrev:   lastQtrW?.epsActual ?? null,
            epsEstimatePrev: lastQtrW?.epsEstimate ?? null,
            epsSurprisePct:  lastQtrW?.surprisePercent ?? null,
            currency, isKorean, isCompleted,
          });
          if (isCompleted) pushedCompleted = true;
          else             pushedUpcoming  = true;
          if (pushedCompleted && pushedUpcoming) break;
        }
      }

      const yfCacheKey = `cal-earnings-${range}`;
      _yfCache.set(yfCacheKey, { data: raw, expiresAt: Date.now() + CALENDAR_YF_TTL_MS });
      // DB에도 저장 (재시작 후 즉시 사용)
      await saveToDBCache(yfCacheKey, raw, CALENDAR_YF_TTL_MS);
      console.log(`[earnings-calendar] 워밍업 완료: ${range}, ${raw.length}개 종목`);

      // Gemini 한국 종목도 백그라운드 실행
      const krTickers = allTickers.filter(t => t.endsWith(".KS") || t.endsWith(".KQ") || /^\d{6}$/.test(t));
      if (krTickers.length > 0) triggerGeminiBackground(krTickers, nameMap, rangeDays);
    } catch (e: any) {
      console.error(`[earnings-calendar] 워밍업 실패 (${range}):`, e?.message);
    }
  }

  // ── 경제 캘린더도 백그라운드 사전 로딩 ──────────────────────────────────────
  for (const range of ["week", "month"] as const) {
    const dbCached = await getFromDBCache<EconomicEvent[]>(`cal-economic-${range}`);
    if (dbCached) {
      _economicCalCache.set(range, { data: dbCached, expiresAt: Date.now() + ECONOMIC_CAL_TTL_MS });
      console.log(`[economic-calendar] DB 캐시 로드: ${range} (${dbCached.length}건)`);
    } else {
      console.log(`[economic-calendar] ${range} 캐시 없음 — 첫 요청 시 생성됩니다`);
    }
  }
}

/** 캐시된 Gemini 날짜 즉시 반환 (API 호출 없음). 캐시 없으면 null. */
function getCachedGeminiDates(tickers: string[], rangeDays: number): Map<string, string> | null {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split("T")[0];
  const cacheKey = `${today}-${rangeDays}-${[...tickers].sort().join(",")}`;
  const cached = _krEarningsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  return null;
}

/** 백그라운드에서 Gemini 호출 → 캐시 갱신 (절대 await 하지 말 것) */
function triggerGeminiBackground(tickers: string[], nameMap: Record<string, string>, rangeDays: number) {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split("T")[0];
  const cacheKey = `${today}-${rangeDays}-${[...tickers].sort().join(",")}`;
  if (_geminiInProgress.has(cacheKey)) return; // 이미 실행 중
  _geminiInProgress.add(cacheKey);
  fetchKoreanEarningsDatesViaGemini(tickers, nameMap, rangeDays)
    .catch(() => {})
    .finally(() => _geminiInProgress.delete(cacheKey));
}

async function fetchKoreanEarningsDatesViaGemini(
  tickers: string[],
  nameMap: Record<string, string>,
  rangeDays: number,
): Promise<Map<string, string>> {
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split("T")[0];
  const cacheKey = `${today}-${rangeDays}-${[...tickers].sort().join(",")}`;
  const cached = _krEarningsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return new Map();

  const endDate = new Date(Date.now() + 9 * 3600 * 1000 + rangeDays * 86400000).toISOString().split("T")[0];

  const tickerLines = tickers.map(t => {
    const bare = t.replace(/\.(KS|KQ)$/, "");
    const name = nameMap[t] ?? nameMap[bare] ?? t;
    return `- ${name} (${bare})`;
  }).join("\n");

  const prompt = `오늘은 ${today}입니다. 아래 한국 상장사들의 ${today}~${endDate} 사이 실적발표일(컨퍼런스콜 포함)을 구글 검색으로 찾아주세요.

${tickerLines}

각 종목마다 가장 정확한 실적발표일(또는 잠정실적 공시일)을 찾아 아래 JSON 형식으로만 답하세요. 해당 기간 내 일정이 없으면 포함하지 마세요.
형식: [{"name":"회사명","date":"YYYY-MM-DD","source":"출처 간략 설명"}]
JSON 배열만 출력. 코드블록·설명 불필요.`;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { tools: [{ googleSearch: {} }], temperature: 0.0 },
    });
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed: Array<{ name: string; date: string }> = JSON.parse(clean);

    // 회사명 → 티커 역매핑
    const nameToTicker: Record<string, string> = {};
    for (const t of tickers) {
      const bare = t.replace(/\.(KS|KQ)$/, "");
      const name = nameMap[t] ?? nameMap[bare];
      if (name) nameToTicker[name] = t;
      nameToTicker[bare] = t;
    }

    const resultMap = new Map<string, string>();
    for (const item of parsed) {
      // 이름 또는 코드로 티커 매칭
      const matched = nameToTicker[item.name]
        ?? tickers.find(t => item.name.includes(t.replace(/\.(KS|KQ)$/, "")));
      if (matched && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
        resultMap.set(matched, item.date);
      }
    }

    _krEarningsCache.set(cacheKey, { data: resultMap, expiresAt: Date.now() + CALENDAR_GEM_TTL_MS });
    console.log(`[earnings-calendar] Gemini KR dates: ${[...resultMap.entries()].map(([k,v])=>`${k}=${v}`).join(", ")}`);
    return resultMap;
  } catch (e: any) {
    console.warn("[earnings-calendar] Gemini KR lookup failed:", e?.message);
    return new Map();
  }
}

router.get("/earnings-calendar", async (req, res) => {
  try {
  const rawRange = typeof req.query.range === "string" ? req.query.range : "week";
  const range    = rawRange === "month" ? "month" : "week";
  const rawExtra = typeof req.query.tickers === "string" ? req.query.tickers : "";
  const extra    = rawExtra;
  const days     = range === "month" ? 30 : 7;

  // ── KST(UTC+9) 기준 오늘 자정 ───────────────────────────────────────────
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const kstNowMs = Date.now() + KST_OFFSET_MS;
  // KST 기준 자정 (UTC 타임스탬프로 변환)
  const kstMidnightUtc = kstNowMs - (kstNowMs % (24 * 60 * 60 * 1000)) - KST_OFFSET_MS;
  const now       = new Date(kstMidnightUtc);
  const pastStart = new Date(kstMidnightUtc - 14 * 24 * 60 * 60 * 1000); // 최근 14일 발표 완료 포함
  const rangeEnd  = new Date(kstMidnightUtc + (days + 1) * 24 * 60 * 60 * 1000);

  /** Yahoo Finance 타임스탬프 → KST 날짜 문자열 (YYYY-MM-DD) */
  const toKSTDateStr = (d: Date) =>
    new Date(d.getTime() + KST_OFFSET_MS).toISOString().split("T")[0];

  // ── 1. DB에서 최근 90일 분석 이력 종목 수집 ────────────────────────────────
  let dbRows: Array<{ ticker: string; company_name: string }> = [];
  try {
    const r = await pool.query<{ ticker: string; company_name: string }>(
      `SELECT DISTINCT ON (ticker) ticker, company_name
       FROM analyses
       WHERE created_at >= NOW() - INTERVAL '90 days'
         AND status = 'completed'
       ORDER BY ticker, created_at DESC
       LIMIT 60`
    );
    dbRows = r.rows;
  } catch (e) {
    console.error("[earnings-calendar] DB error:", e);
  }

  // ── 2. 기본 주요 한국/미국 종목 보완 ──────────────────────────────────────
  const defaultTickers = CALENDAR_DEFAULT_TICKERS;
  const extraTickers   = extra
    ? extra.split(",").map(t => sanitizeTicker(t)).filter((t): t is string => t !== null).slice(0, 20)
    : [];

  // 종목 코드 → 한국어 회사명 맵 (KOREAN_COMPANY_MAP 기반, 티커 접미사 정규화)
  const KR_NAME_MAP: Record<string, string> = {};
  for (const item of KOREAN_COMPANY_MAP) {
    KR_NAME_MAP[item.symbol] = item.name;
    // .KS 없이 숫자 코드만으로도 조회되는 경우 대비
    const bare = item.symbol.replace(/\.(KS|KQ)$/, "");
    KR_NAME_MAP[bare] = item.name;
  }

  // 종목 코드 → 회사명 맵 (DB 우선, 그다음 한국어 맵)
  const nameMap: Record<string, string> = { ...KR_NAME_MAP };
  for (const row of dbRows) {
    // DB에 저장된 한국어 이름이 있으면 그걸 우선하되, 한국어 맵에 이미 있으면 그걸 씀
    const krName = KR_NAME_MAP[row.ticker];
    nameMap[row.ticker] = krName ?? row.company_name;
  }

  // 합집합 (중복 제거)
  const allTickers = Array.from(new Set([
    ...dbRows.map(r => r.ticker),
    ...defaultTickers,
    ...extraTickers,
  ]));

  // ── 3. Yahoo Finance 전체 병렬 조회 (배치 없이 한 번에) ─────────────────────
  interface EarningsEntry {
    ticker: string; companyName: string; earningsDate: string;
    epsEstimate: number | null; epsLow: number | null; epsHigh: number | null;
    revenueEstimate: number | null; revenueLow: number | null; revenueHigh: number | null;
    analyticCount: number | null; fiscalQuarterEnding: string | null;
    epsActualPrev: number | null; epsEstimatePrev: number | null; epsSurprisePct: number | null;
    currency: string; isKorean: boolean; isCompleted: boolean;
  }

  // ── 3-A. 캐시 계층: 인메모리 → DB → Yahoo Finance 실시간 ──────────────────
  const yfCacheKey = `cal-earnings-${range}`;
  const yfNow = Date.now();
  const yfCached = _yfCache.get(yfCacheKey);
  let entries: EarningsEntry[];

  if (yfCached && yfCached.expiresAt > yfNow) {
    entries = yfCached.data;
    console.log("[earnings-calendar] 인메모리 캐시 HIT");
  } else {
    // DB 캐시 확인 (서버 재시작 후에도 유효)
    const dbCached = await getFromDBCache<EarningsEntry[]>(yfCacheKey);
    if (dbCached) {
      entries = dbCached;
      _yfCache.set(yfCacheKey, { data: dbCached, expiresAt: yfNow + CALENDAR_YF_TTL_MS });
      console.log("[earnings-calendar] DB 캐시 HIT");
    } else {
      // DB에도 없음 → Yahoo Finance 실시간 조회 (배치 5개씩, 100ms 딜레이)
      console.log("[earnings-calendar] 캐시 없음 — Yahoo Finance 실시간 조회 시작");
      const settled = await batchProcess(allTickers, async t => {
        try {
          const d = await yahooFinance.quoteSummary(t,
            { modules: ["calendarEvents", "price", "earningsTrend", "earningsHistory"] },
            { validateResult: false }
          );
          return { ticker: t, data: d as any };
        } catch { return null; }
      }, 5, 100);

      const raw: EarningsEntry[] = [];
      for (const r of settled) {
        if (r.status !== "fulfilled" || !r.value) continue;
        const { ticker, data } = r.value;
        const cal   = data?.calendarEvents;
        const pr    = data?.price;
        const dates: any[] = cal?.earnings?.earningsDate ?? [];
        if (!dates.length) continue;

        // earningsTrend: 현재 분기 컨센서스
        const trendArr2: any[] = data?.earningsTrend?.trend ?? [];
        const currentQtr2 = trendArr2.find((tr: any) => tr.period === "0q" || tr.period === "+1q") ?? trendArr2[0];
        const analyticCount2: number | null = currentQtr2?.earningsEstimate?.numberOfAnalysts ?? null;
        const fqEnd2 = currentQtr2?.endDate;
        const fiscalQuarterEnding2: string | null = fqEnd2
          ? (() => { const d2 = fqEnd2 instanceof Date ? fqEnd2 : new Date(fqEnd2); return `${d2.toLocaleDateString("en-US",{month:"short"})} ${d2.getFullYear()}`; })()
          : null;

        // earningsHistory: 가장 최근 분기 실적 (발표 완료 시 당분기 결과, 미발표 시 전분기 참고)
        const histList2: any[] = data?.earningsHistory?.history ?? [];
        const sortedHist2 = [...histList2].sort((a, b) => {
          const da = a.quarter instanceof Date ? a.quarter.getTime() : new Date(a.quarter ?? 0).getTime();
          const db = b.quarter instanceof Date ? b.quarter.getTime() : new Date(b.quarter ?? 0).getTime();
          return db - da;
        });
        const lastQtr2 = sortedHist2[0];

        const currency2 = pr?.currency ?? (ticker.endsWith(".KS") || ticker.endsWith(".KQ") ? "KRW" : "USD");
        const isKorean2 = currency2 === "KRW";
        const name2     = nameMap[ticker] ?? pr?.shortName ?? pr?.longName ?? ticker;

        // 발표 완료(pastStart~now)와 발표 예정(now~rangeEnd) 각각 1건씩 수집
        const sortedDates2 = [...dates].sort((a: any, b: any) => {
          const ta = typeof a === "number" ? a * 1000 : (a instanceof Date ? a.getTime() : new Date(a).getTime());
          const tb = typeof b === "number" ? b * 1000 : (b instanceof Date ? b.getTime() : new Date(b).getTime());
          return tb - ta;
        });
        let pushed2Completed = false;
        let pushed2Upcoming  = false;
        for (const rawDate of sortedDates2) {
          const ts   = typeof rawDate === "number" ? rawDate * 1000
            : (rawDate instanceof Date ? rawDate.getTime() : new Date(rawDate).getTime());
          const date = new Date(ts);
          const isCompleted2 = date >= pastStart && date < now;
          const isUpcoming2  = date >= now && date <= rangeEnd;
          if (!isCompleted2 && !isUpcoming2) continue;
          if (isCompleted2 && pushed2Completed) continue;
          if (isUpcoming2  && pushed2Upcoming)  continue;

          let displayDate = date;
          if (isKorean2 && date.getUTCHours() >= 4 && date.getUTCHours() <= 8) {
            displayDate = new Date(date.getTime() + 86400000);
          }

          raw.push({
            ticker, companyName: name2, earningsDate: toKSTDateStr(displayDate),
            epsEstimate:     isCompleted2 ? null : (currentQtr2?.earningsEstimate?.avg ?? cal?.earnings?.earningsAverage ?? null),
            epsLow:          isCompleted2 ? null : (currentQtr2?.earningsEstimate?.low ?? cal?.earnings?.earningsLow ?? null),
            epsHigh:         isCompleted2 ? null : (currentQtr2?.earningsEstimate?.high ?? cal?.earnings?.earningsHigh ?? null),
            revenueEstimate: isCompleted2 ? null : (currentQtr2?.revenueEstimate?.avg ?? cal?.earnings?.revenueAverage ?? null),
            revenueLow:      isCompleted2 ? null : (currentQtr2?.revenueEstimate?.low ?? null),
            revenueHigh:     isCompleted2 ? null : (currentQtr2?.revenueEstimate?.high ?? null),
            analyticCount:   analyticCount2,
            fiscalQuarterEnding: fiscalQuarterEnding2,
            epsActualPrev:   lastQtr2?.epsActual ?? null,
            epsEstimatePrev: lastQtr2?.epsEstimate ?? null,
            epsSurprisePct:  lastQtr2?.surprisePercent ?? null,
            currency: currency2, isKorean: isKorean2, isCompleted: isCompleted2,
          });
          if (isCompleted2) pushed2Completed = true;
          else              pushed2Upcoming  = true;
          if (pushed2Completed && pushed2Upcoming) break;
        }
      }
      entries = raw;
      _yfCache.set(yfCacheKey, { data: raw, expiresAt: yfNow + CALENDAR_YF_TTL_MS });
      // DB에도 저장 (다음 재시작 시 즉시 사용)
      saveToDBCache(yfCacheKey, raw, CALENDAR_YF_TTL_MS);
    }
  }

  // ── 4. Gemini 한국 날짜 오버라이드 (캐시만 사용, 블로킹 없음) ─────────────
  const koreanTickers = allTickers.filter(t => t.endsWith(".KS") || t.endsWith(".KQ") || /^\d{6}$/.test(t));
  const geminiKrDates = getCachedGeminiDates(koreanTickers, days);

  if (geminiKrDates && geminiKrDates.size > 0) {
    const nowStr = toKSTDateStr(now);
    const endStr = toKSTDateStr(rangeEnd);
    for (const entry of entries) {
      if (!entry.isKorean) continue;
      const gDate = geminiKrDates.get(entry.ticker);
      if (gDate && gDate >= nowStr && gDate <= endStr) entry.earningsDate = gDate;
    }
    const existingKrTickers = new Set(entries.filter(e => e.isKorean).map(e => e.ticker));
    for (const [ticker, gDate] of geminiKrDates) {
      if (existingKrTickers.has(ticker)) continue;
      if (gDate < toKSTDateStr(now) || gDate > toKSTDateStr(rangeEnd)) continue;
      const bare = ticker.replace(/\.(KS|KQ)$/, "");
      entries.push({
        ticker, companyName: nameMap[ticker] ?? nameMap[bare] ?? ticker, earningsDate: gDate,
        epsEstimate: null, epsLow: null, epsHigh: null,
        revenueEstimate: null, revenueLow: null, revenueHigh: null,
        analyticCount: null, fiscalQuarterEnding: null,
        epsActualPrev: null, epsEstimatePrev: null, epsSurprisePct: null,
        currency: "KRW", isKorean: true, isCompleted: false,
      });
    }
  } else if (koreanTickers.length > 0) {
    // 캐시 없으면 백그라운드에서 Gemini 갱신 (응답은 즉시 반환)
    triggerGeminiBackground(koreanTickers, nameMap, days);
  }

  // ── 5. 날짜 정렬 후 응답 ─────────────────────────────────────────────────
  const sorted = [...entries].sort((a, b) => a.earningsDate.localeCompare(b.earningsDate));
  res.json(sorted);
  } catch (err: any) {
    console.error("[earnings-calendar] unhandled error:", err?.message);
    res.status(500).json({ error: err?.message ?? "earnings-calendar error" });
  }
});

// ─── GET /api/market-data/dart-recent-earnings ──────────────────────────────
// 최근 N일(기본 14일) DART "잠정실적" 공시 목록 반환
router.get("/dart-recent-earnings", async (req, res) => {
  try {
    const DART_KEY = process.env.DART_API_KEY;
    if (!DART_KEY) return res.json([]);

    const days = Math.min(Math.max(parseInt((req.query.days as string) ?? "14", 10) || 14, 1), 30);
    const todayKST = new Date(Date.now() + 9 * 3600 * 1000);
    const startDate = new Date(todayKST.getTime() - days * 86400000);
    const fmt8 = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

    const todayStr = fmt8(todayKST);
    const cacheKey = `dart-recent-earnings-${todayStr}-${days}`;
    const memHit = (_yfCache as any).get?.(cacheKey);
    if (memHit && memHit.expiresAt > Date.now()) return res.json(memHit.data);

    const dbCached = await getFromDBCache<any[]>(cacheKey);
    if (dbCached) {
      (_yfCache as any).set?.(cacheKey, { data: dbCached, expiresAt: Date.now() + 3 * 60 * 60 * 1000 });
      return res.json(dbCached);
    }

    const url =
      `https://opendart.fss.or.kr/api/list.json` +
      `?crtfc_key=${DART_KEY}` +
      `&bgn_de=${fmt8(startDate)}&end_de=${todayStr}` +
      `&sort=date&sort_mth=desc&page_no=1&page_count=100`;

    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return res.json([]);
    const data = await r.json() as Record<string, any>;
    if (data["status"] !== "000") return res.json([]);

    const list: any[] = data["list"] ?? [];
    const filtered = list
      .filter((item: any) =>
        item.report_nm?.includes("잠정") &&
        item.stock_code && /^\d{6}$/.test(String(item.stock_code))
      )
      .map((item: any) => {
        const dt = String(item.rcept_dt ?? "");
        const dateStr = dt.length === 8
          ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`
          : dt;
        return {
          ticker: `${item.stock_code}.KS`,
          companyName: item.corp_name,
          disclosureDate: dateStr,
          reportName: item.report_nm,
          dartUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
        };
      });

    await saveToDBCache(cacheKey, filtered, 3 * 60 * 60 * 1000); // 3시간 캐시
    console.log(`[dart-recent-earnings] ${days}일 기준 ${filtered.length}건 잠정실적 공시`);
    res.json(filtered);
  } catch (e: any) {
    console.error("[dart-recent-earnings]", e?.message);
    res.json([]);
  }
});

// ─── GET /api/market-data/dart-disclosures ───────────────────────────────────
// 특정 종목의 최근 90일 DART 공시 목록 반환
router.get("/dart-disclosures", async (req, res) => {
  try {
    const DART_KEY = process.env.DART_API_KEY;
    if (!DART_KEY) return res.json([]);

    const ticker = String(req.query.ticker ?? "");
    const stockCodeMatch = ticker.match(/(\d{6})/);
    if (!stockCodeMatch) return res.json([]);
    const stockCode = stockCodeMatch[1];

    const todayKST = new Date(Date.now() + 9 * 3600 * 1000);
    const startDate = new Date(todayKST.getTime() - 90 * 86400000);
    const fmt8 = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

    const cacheKey = `dart-disclosures-${stockCode}-${fmt8(todayKST).slice(0, 6)}`;

    const dbCached = await getFromDBCache<any[]>(cacheKey);
    if (dbCached) return res.json(dbCached);

    const url =
      `https://opendart.fss.or.kr/api/list.json` +
      `?crtfc_key=${DART_KEY}` +
      `&stock_code=${stockCode}` +
      `&bgn_de=${fmt8(startDate)}&end_de=${fmt8(todayKST)}` +
      `&sort=date&sort_mth=desc&page_no=1&page_count=20`;

    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.json([]);
    const data = await r.json() as Record<string, any>;
    if (data["status"] !== "000") return res.json([]);

    const list: any[] = data["list"] ?? [];
    const result = list.slice(0, 15).map((item: any) => {
      const dt = String(item.rcept_dt ?? "");
      const dateStr = dt.length === 8
        ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`
        : dt;
      return {
        date: dateStr,
        reportName: item.report_nm ?? "",
        corpName: item.corp_name ?? "",
        dartUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
      };
    });

    await saveToDBCache(cacheKey, result, 6 * 60 * 60 * 1000);
    console.log(`[dart-disclosures] ${stockCode} ${result.length}건`);
    res.json(result);
  } catch (e: any) {
    console.error("[dart-disclosures]", e?.message);
    res.json([]);
  }
});

// ─── GET /api/market-data/dividend-info ──────────────────────────────────────
// 배당 요약 + 최근 5년 이력 (Yahoo Finance summaryDetail + historical)
router.get("/dividend-info", async (req, res) => {
  try {
    const tickerRaw = String(req.query.ticker ?? "").trim();
    if (!tickerRaw) return res.json(null);

    // 6자리 KRX 코드(suffix 없음)일 때 .KS → .KQ 순서로 시도
    const isBareSixDigit = /^\d{6}$/.test(tickerRaw);
    let ticker = tickerRaw;
    if (isBareSixDigit) ticker = `${tickerRaw}.KS`;

    const todayKST = new Date(Date.now() + 9 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const cacheKey = `dividend-info-v2-${tickerRaw}-${fmt(todayKST).slice(0, 7)}`;

    const dbCached = await getFromDBCache<any>(cacheKey);
    if (dbCached) return res.json(dbCached);

    let qs: any = null;
    try {
      qs = await (yahooFinance as any).quoteSummary(ticker, {
        modules: ["summaryDetail", "defaultKeyStatistics"],
      });
    } catch {
      // .KS 실패 시 .KQ 시도
      if (isBareSixDigit) {
        ticker = `${tickerRaw}.KQ`;
        qs = await (yahooFinance as any).quoteSummary(ticker, {
          modules: ["summaryDetail", "defaultKeyStatistics"],
        });
      } else throw new Error("quoteSummary failed");
    }

    const sd = (qs?.summaryDetail ?? {}) as Record<string, any>;
    const dk = (qs?.defaultKeyStatistics ?? {}) as Record<string, any>;

    const dividendRate: number | null = sd.dividendRate ?? null;
    const dividendYield: number | null = sd.dividendYield ?? null;

    if (!dividendRate && !dividendYield) {
      await saveToDBCache(cacheKey, null, 24 * 60 * 60 * 1000);
      return res.json(null);
    }

    // 최근 5년 배당 이력 — chart 모듈 events.dividends 연도별 합산
    const fiveYearsAgo = new Date(todayKST.getTime() - 5 * 365.25 * 86400000);
    let history: { date: string; amount: number }[] = [];
    try {
      const chartData = await (yahooFinance as any).chart(ticker, {
        period1: fiveYearsAgo,
        interval: "1mo",
      });
      const divEvents = Object.values((chartData?.events?.dividends ?? {}) as Record<string, { amount: number; date: string }>);
      const byYear: Record<string, number> = {};
      for (const item of divEvents) {
        if (!item.date || item.amount == null) continue;
        const yr = new Date(item.date).getFullYear().toString();
        byYear[yr] = (byYear[yr] ?? 0) + item.amount;
      }
      history = Object.entries(byYear)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([year, amount]) => ({ date: year, amount: Math.round(amount * 100) / 100 }));
    } catch { /* 이력 조회 실패 시 빈 배열로 계속 */ }

    const toDateStr = (v: any): string | null => {
      if (!v) return null;
      try { return new Date(v).toISOString().slice(0, 10); } catch { return null; }
    };

    const result = {
      dividendRate,
      dividendYield,
      exDividendDate: toDateStr(sd.exDividendDate),
      payoutRatio: sd.payoutRatio ?? null,
      fiveYearAvgDividendYield: sd.fiveYearAvgDividendYield ?? null,
      lastDividendValue: dk.lastDividendValue ?? null,
      lastDividendDate: toDateStr(dk.lastDividendDate),
      history,
    };

    await saveToDBCache(cacheKey, result, 24 * 60 * 60 * 1000);
    console.log(`[dividend-info] ${ticker} yield=${dividendYield} history=${history.length}년`);
    res.json(result);
  } catch (e: any) {
    console.error("[dividend-info]", e?.message);
    res.json(null);
  }
});

// ─── GET /api/market-data/short-info ─────────────────────────────────────────
// KIS 공매도·대차잔고 현황 (한국 종목 전용)
router.get("/short-info", async (req, res) => {
  try {
    const tickerRaw = String(req.query.ticker ?? "").trim();
    if (!tickerRaw) return res.json(null);

    const sixDigit = tickerRaw.replace(/\.(KS|KQ)$/i, "");
    if (!/^\d{6}$/.test(sixDigit)) return res.json(null); // 미국 종목 제외

    const todayKST = new Date(Date.now() + 9 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const cacheKey = `short-info-v5-${sixDigit}-${fmt(todayKST)}`;

    const dbCached = await getFromDBCache<any>(cacheKey);
    if (dbCached) return res.json(dbCached);

    const kis = await fetchKISStockQuote(sixDigit);
    if (!kis) {
      await saveToDBCache(cacheKey, null, 60 * 60 * 1000);
      return res.json(null);
    }

    // KRX/네이버에서 공매도 잔고금액·잔고비율 병렬 조회
    const krxRows = await fetchKRXShortData(sixDigit, 1).catch(() => []);
    const latestKrx = krxRows[0] ?? null;

    // 대차잔고 금액 계산 (3단계 fallback)
    // 1) KRX/Naver 직접 제공 loanQty × 현재가
    // 2) loanRate × 상장주식수 × 현재가
    // 3) loanRate × 시가총액 (mcap은 억원 단위 → × 1억)
    const loanQty = latestKrx?.loanQty ?? null;
    const loanAmt: number | null = (() => {
      if (loanQty != null && kis.price > 0) return loanQty * kis.price;
      if (kis.loanRate != null && kis.sharesOutstanding != null && kis.sharesOutstanding > 0 && kis.price > 0) {
        return Math.round((kis.sharesOutstanding * kis.loanRate / 100) * kis.price);
      }
      if (kis.loanRate != null && kis.mcap != null && kis.mcap > 0) {
        return Math.round(kis.mcap * 1e8 * kis.loanRate / 100);
      }
      return null;
    })();

    const result = {
      loanRate:      kis.loanRate,      // 대차잔고비율 (%)
      loanQty,                          // 대차잔고 수량 (주)
      loanAmt,                          // 대차잔고 금액 (원) = loanQty × 현재가
      shortOverYn:   kis.shortOverYn,   // 공매도 과열 여부 Y/N
      shortSaleYn:   kis.shortSaleYn,   // 공매도 가능 여부 Y/N
      lastShortQty:  kis.lastShortQty,  // 최근 공매도 체결수량
      shortAmt:      latestKrx?.shortAmt   ?? null,  // 공매도 잔고금액 (원)
      shortRatio:    latestKrx?.shortRatio ?? null,  // 공매도 잔고비율 (%)
      price:         kis.price,
      mcap:          kis.mcap,
    };

    await saveToDBCache(cacheKey, result, 60 * 60 * 1000);
    res.json(result);
  } catch (e: any) {
    console.error("[short-info]", e?.message);
    res.json(null);
  }
});

// ─── GET /api/market-data/analyst-consensus ───────────────────────────────────
// 애널리스트 투자의견 + 목표주가 (Yahoo Finance)
router.get("/analyst-consensus", async (req, res) => {
  try {
    const tickerRaw = String(req.query.ticker ?? "").trim();
    if (!tickerRaw) return res.json(null);

    const isBareSixDigit = /^\d{6}$/.test(tickerRaw);
    let ticker = isBareSixDigit ? `${tickerRaw}.KS` : tickerRaw;

    const todayKST = new Date(Date.now() + 9 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const cacheKey = `analyst-consensus-v4-${tickerRaw}-${fmt(todayKST).slice(0, 7)}`;

    const dbCached = await getFromDBCache<any>(cacheKey);
    if (dbCached) return res.json(dbCached);

    const modules = isBareSixDigit
      ? ["recommendationTrend", "financialData", "earningsTrend"]
      : ["recommendationTrend", "financialData", "earningsTrend", "upgradeDowngradeHistory"];

    let qs: any = null;
    try {
      qs = await (yahooFinance as any).quoteSummary(ticker, { modules });
    } catch {
      if (isBareSixDigit) {
        ticker = `${tickerRaw}.KQ`;
        qs = await (yahooFinance as any).quoteSummary(ticker, { modules });
      } else throw new Error("quoteSummary failed");
    }

    const allTrends = qs?.recommendationTrend?.trend ?? [];
    const trend = allTrends[0] ?? {};
    const fd    = qs?.financialData ?? {};

    const strongBuy  = trend.strongBuy  ?? 0;
    const buy        = trend.buy        ?? 0;
    const hold       = trend.hold       ?? 0;
    const sell       = trend.sell       ?? 0;
    const strongSell = trend.strongSell ?? 0;
    const total = strongBuy + buy + hold + sell + strongSell;

    if (total === 0) {
      await saveToDBCache(cacheKey, null, 24 * 60 * 60 * 1000);
      return res.json(null);
    }

    // 3개월 추이 (0m, -1m, -2m)
    const trendHistory = allTrends.slice(0, 3).map((t: any) => ({
      period:    t.period ?? "0m",
      strongBuy: t.strongBuy  ?? 0,
      buy:       t.buy        ?? 0,
      hold:      t.hold       ?? 0,
      sell:      t.sell       ?? 0,
      strongSell:t.strongSell ?? 0,
    }));

    // ── 기관별 목표주가 (미국: 최근 1년 이내, firm별 최신 1건) ──────────────
    const firmTargets: { firm: string; target: number; grade: string; date: string }[] = [];
    if (!isBareSixDigit) {
      const oneYearAgo = Date.now() - 365 * 24 * 3600 * 1000;
      const firmMap = new Map<string, { firm: string; target: number; grade: string; date: string }>();
      for (const h of (qs?.upgradeDowngradeHistory?.history ?? []) as any[]) {
        if (!h.currentPriceTarget) continue;
        const ts = new Date(h.epochGradeDate).getTime();
        if (ts < oneYearAgo) continue; // 1년 이상 된 것 제외
        if (!firmMap.has(h.firm)) {   // history는 최신순이므로 첫 번째가 최신
          firmMap.set(h.firm, {
            firm:   h.firm ?? "",
            target: h.currentPriceTarget,
            grade:  h.toGrade ?? "",
            date:   new Date(h.epochGradeDate).toISOString().slice(0, 10),
          });
        }
      }
      firmTargets.push(...[...firmMap.values()].sort((a, b) => b.target - a.target));
    }

    // ── 실적 전망 (earningsTrend 0y / +1y) ──────────────────────────────────
    const etRaw = (qs?.earningsTrend?.trend ?? []) as any[];
    const earningsEstimates = ["0y", "+1y"].map(period => {
      const t = etRaw.find((x: any) => x.period === period);
      if (!t) return null;
      return {
        period,
        epsAvg:          t.earningsEstimate?.avg          ?? null,
        epsLow:          t.earningsEstimate?.low          ?? null,
        epsHigh:         t.earningsEstimate?.high         ?? null,
        epsNumAnalysts:  t.earningsEstimate?.numberOfAnalysts ?? null,
        revAvg:          t.revenueEstimate?.avg           ?? null,
        revLow:          t.revenueEstimate?.low           ?? null,
        revHigh:         t.revenueEstimate?.high          ?? null,
        revNumAnalysts:  t.revenueEstimate?.numberOfAnalysts ?? null,
      };
    }).filter(Boolean);

    const result = {
      strongBuy, buy, hold, sell, strongSell, total,
      recommendationKey: fd.recommendationKey ?? null,
      currency: isBareSixDigit ? "KRW" : "USD",
      targetLowPrice:  fd.targetLowPrice  ?? null,
      targetMeanPrice: fd.targetMeanPrice ?? null,
      targetHighPrice: fd.targetHighPrice ?? null,
      trendHistory,
      firmTargets,
      earningsEstimates,
    };

    await saveToDBCache(cacheKey, result, 24 * 60 * 60 * 1000);
    console.log(`[analyst-consensus] ${ticker} total=${total} key=${result.recommendationKey} firms=${firmTargets.length} earnings=${earningsEstimates.length}`);
    res.json(result);
  } catch (e: any) {
    console.error("[analyst-consensus]", e?.message);
    res.json(null);
  }
});

// ─── GET /api/market-data/major-shareholders ──────────────────────────────────
// 주요 주주 현황 (Yahoo Finance majorHoldersBreakdown + institutionOwnership)
router.get("/major-shareholders", async (req, res) => {
  try {
    const tickerRaw = String(req.query.ticker ?? "").trim();
    if (!tickerRaw) return res.json(null);

    const isBareSixDigit = /^\d{6}$/.test(tickerRaw);
    let ticker = isBareSixDigit ? `${tickerRaw}.KS` : tickerRaw;

    const todayKST = new Date(Date.now() + 9 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const cacheKey = `major-shareholders-v3-${tickerRaw}-${fmt(todayKST).slice(0, 7)}`;

    const dbCached = await getFromDBCache<any>(cacheKey);
    if (dbCached) return res.json(dbCached);

    const yfModules = isBareSixDigit
      ? ["majorHoldersBreakdown", "institutionOwnership"]
      : ["majorHoldersBreakdown", "institutionOwnership", "insiderTransactions", "netSharePurchaseActivity"];

    let qs: any = null;
    try {
      qs = await (yahooFinance as any).quoteSummary(ticker, { modules: yfModules });
    } catch {
      if (isBareSixDigit) {
        ticker = `${tickerRaw}.KQ`;
        qs = await (yahooFinance as any).quoteSummary(ticker, { modules: yfModules });
      } else throw new Error("quoteSummary failed");
    }

    const mhb  = qs?.majorHoldersBreakdown ?? {};
    const inst = (qs?.institutionOwnership?.ownershipList ?? []) as any[];

    const insidersPercent      = mhb.insidersPercentHeld ?? null;
    const institutionsPercent  = mhb.institutionsPercentHeld ?? null;
    const institutionsCount    = mhb.institutionsCount ?? null;

    const topInstitutions = inst
      .filter((h: any) => h.pctHeld > 0)
      .sort((a: any, b: any) => b.pctHeld - a.pctHeld)
      .slice(0, 8)
      .map((h: any) => ({
        name:      h.organization,
        pctHeld:   Math.round(h.pctHeld * 10000) / 100,
        pctChange: h.pctChange != null ? Math.round(h.pctChange * 10000) / 100 : null,
        reportDate: h.reportDate ? new Date(h.reportDate).toISOString().slice(0, 10) : null,
      }));

    // ── 미국 주식: 내부자 거래 ─────────────────────────────────────────
    let insiderActivity: any = null;
    let recentInsiderTrades: any[] = [];

    if (!isBareSixDigit) {
      const ns = qs?.netSharePurchaseActivity;
      if (ns) {
        insiderActivity = {
          period:        ns.period ?? "6m",
          buyCount:      ns.buyInfoCount      ?? 0,
          buyShares:     ns.buyInfoShares      ?? 0,
          sellCount:     ns.sellInfoCount      ?? 0,
          sellShares:    ns.sellInfoShares     ?? 0,
          netShares:     ns.netInfoShares      ?? 0,
          totalInsider:  ns.totalInsiderShares ?? 0,
        };
      }
      recentInsiderTrades = (qs?.insiderTransactions?.transactions ?? [])
        .filter((t: any) => t.shares > 0 && t.transactionText)
        .slice(0, 8)
        .map((t: any) => ({
          name:     t.filerName     ?? "",
          relation: t.filerRelation ?? "",
          shares:   t.shares        ?? 0,
          value:    t.value         ?? 0,
          date:     t.startDate ? new Date(t.startDate).toISOString().slice(0, 10) : null,
          text:     t.transactionText ?? "",
        }));
    }

    // ── 한국 주식: DART 임원·주요주주 소유상황 ────────────────────────────
    let dartHolders: any[] = [];

    if (isBareSixDigit) {
      const DART_KEY = process.env.DART_API_KEY;
      const stockCode = tickerRaw.match(/(\d{6})/)?.[1] ?? "";
      if (DART_KEY && stockCode) {
        try {
          const corpCode = getCorpCodeFromCache(stockCode);
          if (corpCode) {
            const year  = todayKST.getFullYear();
            // 최신 사업보고서(11011), 없으면 반기(11012)
            for (const reprt of ["11011", "11012"]) {
              const url = `https://opendart.fss.or.kr/api/hyslrSttus.json?crtfc_key=${DART_KEY}&corp_code=${corpCode}&bsns_year=${year - 1}&reprt_code=${reprt}`;
              const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
              if (!r.ok) continue;
              const d = await r.json() as any;
              if (d.status === "000" && (d.list ?? []).length > 0) {
                // 중복 이름+종류 제거: 같은 사람이 보통주/우선주 따로 나오므로 합산
                const nameMap = new Map<string, { name: string; relate: string; pct: number; shares: number }>();
                for (const it of d.list as any[]) {
                  if (!it.nm || it.nm === "계") continue; // 합계 행 제외
                  const key2 = `${it.nm}|${it.relate}`;
                  const pct  = parseFloat(it.trmend_posesn_stock_qota_rt ?? it.bsis_posesn_stock_qota_rt ?? "0");
                  const shs  = parseInt((it.trmend_posesn_stock_co ?? it.bsis_posesn_stock_co ?? "0").replace(/,/g, ""), 10) || 0;
                  if (nameMap.has(key2)) {
                    const prev = nameMap.get(key2)!;
                    prev.pct    += pct;
                    prev.shares += shs;
                  } else {
                    nameMap.set(key2, { name: it.nm ?? "", relate: it.relate ?? "", pct, shares: shs });
                  }
                }
                dartHolders = [...nameMap.values()]
                  .filter(h => h.pct > 0)
                  .sort((a, b) => b.pct - a.pct)
                  .slice(0, 10);
                break;
              }
            }
          }
        } catch (de: any) {
          console.warn("[major-shareholders DART]", de?.message);
        }
      }
    }

    if (insidersPercent == null && institutionsPercent == null && topInstitutions.length === 0 && dartHolders.length === 0) {
      await saveToDBCache(cacheKey, null, 24 * 60 * 60 * 1000);
      return res.json(null);
    }

    const result = {
      insidersPercent, institutionsPercent, institutionsCount, topInstitutions,
      dartHolders,
      insiderActivity, recentInsiderTrades,
    };
    await saveToDBCache(cacheKey, result, 24 * 60 * 60 * 1000);
    console.log(`[major-shareholders] ${ticker} institutions=${institutionsCount} dart=${dartHolders.length} insiderTrades=${recentInsiderTrades.length}`);
    res.json(result);
  } catch (e: any) {
    console.error("[major-shareholders]", e?.message);
    res.json(null);
  }
});

// ─── GET /api/market-data/indicator-history ──────────────────────────────────
interface IndicatorPoint { date: string; value: number; }
interface IndicatorSeries {
  id: string;
  name: string;
  nameEn: string;
  country: string;
  unit: string;
  category: string;
  frequency: "monthly" | "quarterly";
  data: IndicatorPoint[];
  targetLine?: number;
  rangeLabel?: string;  // FOMC 기준금리 레인지 (예: "4.25~4.50%")
}

let _indicatorHistoryCache: { data: IndicatorSeries[]; expiresAt: number } | null = null;
const INDICATOR_HISTORY_TTL = 12 * 60 * 60 * 1000; // 12시간

router.get("/indicator-history", async (_req, res) => {
  if (_indicatorHistoryCache && Date.now() < _indicatorHistoryCache.expiresAt) {
    return res.json(_indicatorHistoryCache.data);
  }

  const dbCached = await getFromDBCache<IndicatorSeries[]>("indicator-history-v10");
  if (dbCached) {
    _indicatorHistoryCache = { data: dbCached, expiresAt: Date.now() + INDICATOR_HISTORY_TTL };
    return res.json(dbCached);
  }

  try {
    const FRED_KEY = process.env["FRED_API_KEY"];
    if (!FRED_KEY) throw new Error("FRED_API_KEY 없음");

    // 4년 이력 (YoY 계산에 최소 12개월 필요)
    const start4y = new Date();
    start4y.setFullYear(start4y.getFullYear() - 4);
    const startStr = start4y.toISOString().split("T")[0];

    async function fredGet(series: string): Promise<IndicatorPoint[]> {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${FRED_KEY}&file_type=json&observation_start=${startStr}&sort_order=asc&limit=300`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const d = await r.json();
      if (!r.ok || d.error_code) {
        console.error(`[indicator-history] FRED API 오류 [${series}] HTTP ${r.status}: ${d.error_message ?? JSON.stringify(d).slice(0, 120)}`);
        return [];
      }
      return (d.observations ?? [])
        .filter((o: any) => o.value !== ".")
        .map((o: any) => ({ date: o.date, value: parseFloat(o.value) }));
    }

    // 한국 실업률: World Bank 공개 API (key 불필요)
    async function wbGetKrUnemployment(): Promise<IndicatorPoint[]> {
      const r = await fetch(
        "https://api.worldbank.org/v2/country/KR/indicator/SL.UEM.TOTL.ZS?format=json&mrv=20&date=2019:2026"
      );
      const d = await r.json();
      return ((d[1] ?? []) as any[])
        .filter((x: any) => x.value != null)
        .sort((a: any, b: any) => a.date.localeCompare(b.date))
        .map((x: any) => ({ date: `${x.date}-01-01`, value: parseFloat(x.value.toFixed(2)) }));
    }

    const [
      [fedRate, cpi, corePce, unemployment, gdp, fedTargetUpper, fedTargetLower],
      blsTs,
      [krRate, krCpi, krGdpVol, krUnemployment],
    ] = await Promise.all([
      // FRED — 미국 지표 (rate limit 가능성 있음)
      Promise.all([
        fredGet("FEDFUNDS"),            // 미국 연방기금금리 (월별)
        fredGet("CPIAUCSL"),            // 미국 CPI 지수 (월별) → YoY 계산
        fredGet("PCEPILFE"),            // 미국 근원 PCE (월별) → YoY 계산
        fredGet("UNRATE"),              // 미국 실업률 (월별)
        fredGet("A191RL1Q225SBEA"),     // 미국 GDP 성장률 연율 (분기)
        fredGet("DFEDTARU"),            // FOMC 기준금리 목표 상단 (일별)
        fredGet("DFEDTARL"),            // FOMC 기준금리 목표 하단 (일별)
      ]),
      // BLS — FRED rate limit 시 폴백 (CPI·실업률·PPI 공식 데이터)
      fetchBLSTimeSeries(4),
      // 한국 지표
      Promise.all([
        fetchECOSBaseRateHistory(),
        fredGet("KORCPIALLMINMEI"),
        fredGet("NAEXKP01KRQ657S"),
        wbGetKrUnemployment(),
      ]),
    ]);

    // 전년동월비 계산
    function calcYoY(pts: IndicatorPoint[]): IndicatorPoint[] {
      return pts.slice(12).map((d, i) => ({
        date: d.date,
        value: parseFloat(((d.value / pts[i].value - 1) * 100).toFixed(2)),
      }));
    }
    // 분기 데이터용 전년동분기비 (4분기 전 대비)
    function calcYoYQ(pts: IndicatorPoint[]): IndicatorPoint[] {
      return pts.slice(4).map((d, i) => ({
        date: d.date,
        value: parseFloat(((d.value / pts[i].value - 1) * 100).toFixed(2)),
      }));
    }

    // FRED 실패(빈 배열) 시 BLS 데이터로 폴백
    const usCpiData   = calcYoY(cpi).slice(-24).length > 0  ? calcYoY(cpi).slice(-24)   : blsTs.cpiYoY;
    const usUrData    = unemployment.slice(-24).length > 0   ? unemployment.slice(-24)    : blsTs.unemployment;
    const usPpiData   = blsTs.ppiYoY;   // BLS 항상 사용 (FRED에 없음)
    const usNfpData   = blsTs.nfpMoM;   // BLS 항상 사용 (FRED에 없음)

    const usCpiSource   = calcYoY(cpi).slice(-24).length > 0 ? "FRED" : "BLS";
    const usUrSource    = unemployment.slice(-24).length > 0  ? "FRED" : "BLS";
    console.log(`[indicator-history] US CPI: ${usCpiSource}(${usCpiData.length}건), UR: ${usUrSource}(${usUrData.length}건), BLS PPI: ${usPpiData.length}건, BLS NFP: ${usNfpData.length}건`);

    // FOMC 기준금리 레인지 빌드 (최신값 기준)
    // getCachedFredMacro()는 서버 기동 시 실시간 FRED API 호출로 채워진 최신값 → 우선 사용
    const cachedMacro = getCachedFredMacro();
    const latestFedUpper = cachedMacro?.fedTargetUpper
      ?? (fedTargetUpper.length > 0 ? fedTargetUpper[fedTargetUpper.length - 1].value : null);
    const latestFedLower = cachedMacro?.fedTargetLower
      ?? (fedTargetLower.length > 0 ? fedTargetLower[fedTargetLower.length - 1].value : null);
    const fedRangeLabel  = latestFedUpper != null && latestFedLower != null
      ? `${latestFedLower}~${latestFedUpper}%`
      : null;
    if (fedRangeLabel) console.log(`[indicator-history] FOMC 기준금리 레인지: ${fedRangeLabel} (출처: ${cachedMacro ? "fred-client 캐시" : "시계열 마지막값"})`);

    const result: IndicatorSeries[] = [
      // ── 미국 지표 ──
      ...(fedRate.slice(-24).length > 0 ? [{
        id: "fed-rate",
        name: "연방기금금리",
        nameEn: "Fed Funds Rate",
        country: "US" as const,
        unit: "%",
        category: "금리",
        frequency: "monthly" as const,
        data: fedRate.slice(-24),
        ...(fedRangeLabel ? { rangeLabel: fedRangeLabel } : {}),
      }] : []),
      ...(usCpiData.length > 0 ? [{
        id: "us-cpi",
        name: "미국 CPI",
        nameEn: "US CPI YoY",
        country: "US" as const,
        unit: "%",
        category: "물가",
        frequency: "monthly" as const,
        data: usCpiData,
        targetLine: 2.0,
      }] : []),
      ...(calcYoY(corePce).slice(-24).length > 0 ? [{
        id: "core-pce",
        name: "근원 PCE",
        nameEn: "Core PCE YoY",
        country: "US" as const,
        unit: "%",
        category: "물가",
        frequency: "monthly" as const,
        data: calcYoY(corePce).slice(-24),
        targetLine: 2.0,
      }] : []),
      ...(usUrData.length > 0 ? [{
        id: "unemployment",
        name: "미국 실업률",
        nameEn: "US Unemployment",
        country: "US" as const,
        unit: "%",
        category: "고용",
        frequency: "monthly" as const,
        data: usUrData,
      }] : []),
      ...(gdp.slice(-16).length > 0 ? [{
        id: "us-gdp",
        name: "미국 GDP 성장률",
        nameEn: "US GDP Growth",
        country: "US" as const,
        unit: "%",
        category: "성장",
        frequency: "quarterly" as const,
        data: gdp.slice(-16),
      }] : []),
      ...(usPpiData.length > 0 ? [{
        id: "us-ppi",
        name: "미국 PPI",
        nameEn: "US PPI YoY",
        country: "US" as const,
        unit: "%",
        category: "물가",
        frequency: "monthly" as const,
        data: usPpiData,
      }] : []),
      ...(usNfpData.length > 0 ? [{
        id: "us-nfp",
        name: "비농업 고용",
        nameEn: "Nonfarm Payrolls",
        country: "US" as const,
        unit: "K",
        category: "고용",
        frequency: "monthly" as const,
        data: usNfpData,
      }] : []),
      // ── 한국 지표 ──
      ...(krRate.length > 0 ? [{
        id: "kr-rate",
        name: "한국은행 기준금리",
        nameEn: "BOK Base Rate",
        country: "KR",
        unit: "%",
        category: "금리",
        frequency: "monthly" as const,
        data: krRate.slice(-24),
      }] : []),
      ...(krCpi.length > 4 ? [{
        id: "kr-cpi",
        name: "한국 CPI",
        nameEn: "Korea CPI YoY",
        country: "KR",
        unit: "%",
        category: "물가",
        frequency: "monthly" as const,
        data: calcYoY(krCpi).filter(p => p.value != null),
        targetLine: 2.0,
      }] : []),
      ...(krUnemployment.length > 0 ? [{
        id: "kr-unemployment",
        name: "한국 실업률",
        nameEn: "Korea Unemployment",
        country: "KR",
        unit: "%",
        category: "고용",
        frequency: "quarterly" as const,
        data: krUnemployment.slice(-8),
      }] : []),
      ...(krGdpVol.length > 0 ? [{
        id: "kr-gdp",
        name: "한국 GDP 성장률",
        nameEn: "Korea GDP Growth (QoQ)",
        country: "KR",
        unit: "%",
        category: "성장",
        frequency: "quarterly" as const,
        data: krGdpVol.slice(-12), // 이미 분기별 QoQ % 성장률
      }] : []),
    ];

    // 빈 data 배열인 series 제외 (클라이언트 렌더링 TypeError 방지)
    const validResult = result.filter(s => s.data.length > 0);
    _indicatorHistoryCache = { data: validResult, expiresAt: Date.now() + INDICATOR_HISTORY_TTL };
    saveToDBCache("indicator-history-v10", validResult, INDICATOR_HISTORY_TTL);
    console.log(`[indicator-history] 완료 — 지표 ${validResult.length}개 수집 (미국 5개, 한국 ${validResult.length - 5}개)`);
    return res.json(validResult);
  } catch (err: any) {
    console.error("[indicator-history] error:", err?.message);
    return res.status(500).json({ error: err?.message ?? "지표 이력 조회 실패" });
  }
});

// ─── GET /api/market-data/economic-calendar ─────────────────────────────────
router.get("/economic-calendar", async (req, res) => {
  const range = (req.query.range === "month") ? "month" : "week";
  const cacheKey = range;

  const cached = _economicCalCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return res.json(cached.data);
  }

  // DB 캐시 확인 (서버 재시작 후에도 유효)
  const dbEcoCached = await getFromDBCache<EconomicEvent[]>(`cal-economic-${range}`);
  if (dbEcoCached) {
    _economicCalCache.set(cacheKey, { data: dbEcoCached, expiresAt: Date.now() + ECONOMIC_CAL_TTL_MS });
    console.log(`[economic-calendar] DB 캐시 HIT: ${range}`);
    return res.json(dbEcoCached);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const kstNow = new Date(Date.now() + KST_OFFSET_MS);
    const todayStr = kstNow.toISOString().split("T")[0];
    const endDate = new Date(kstNow.getTime() + (range === "week" ? 7 : 30) * 86400000);
    const endStr = endDate.toISOString().split("T")[0];

    // ── BLS/FOMC 실제 데이터와 Gemini를 병렬 호출 ───────────────────────────
    const [blsResult, geminiResp] = await Promise.allSettled([
      fetchAllEconomicActuals(),
      ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: `오늘은 ${todayStr}(KST)입니다.
${todayStr}부터 ${endStr}까지의 주요 글로벌 경제 이벤트 일정을 JSON 배열로 반환하세요.

포함할 이벤트 유형:
- 미국: FOMC 금리결정, CPI, PPI, PCE, GDP, 비농업 고용(NFP), 실업률, 소매판매, ISM 제조업/서비스업 PMI, 신규실업수당청구
- 한국: 한국은행 기준금리 결정, 소비자물가지수(CPI), GDP 성장률, 무역수지, 산업생산
- 유로존: ECB 금리결정, 유로존 CPI, GDP
- 중국: PMI(제조업/비제조업), CPI, GDP, 무역수지
- 일본: BOJ 금리결정, CPI

각 이벤트를 아래 형식의 JSON으로 반환하세요:
{"date":"YYYY-MM-DD","time":"HH:MM KST","title":"이벤트명(한국어)","country":"US","category":"금리결정","importance":"high","forecast":"예상값 또는 null","previous":"직전값","unit":"단위"}

중요 규칙:
- "previous" 필드: 해당 지표의 가장 최근 발표된 실제 수치를 반드시 기입. "N/A" 절대 금지.
- "forecast" 필드: 시장 컨센서스를 기입. 알 수 없으면 null.
- 날짜/시간은 KST(한국시간) 기준
- JSON 배열만 반환. 다른 텍스트 절대 포함 금지.` }] }],
        config: { temperature: 0.1 },
      }),
    ]);

    // ── Gemini 결과 파싱 ────────────────────────────────────────────────────
    let events: EconomicEvent[] = [];
    if (geminiResp.status === "fulfilled") {
      const raw = geminiResp.value.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      try {
        events = JSON.parse(cleaned);
        if (!Array.isArray(events)) events = [];
      } catch {
        console.error("[economic-calendar] JSON 파싱 실패:", cleaned.slice(0, 200));
        events = [];
      }
    }

    // ── BLS 실제 데이터로 이벤트 보강 ──────────────────────────────────────
    if (blsResult.status === "fulfilled") {
      const { actuals, schedule, fomc } = blsResult.value;

      // 1) BLS 실제값으로 previous 필드 덮어쓰기
      if (actuals) {
        for (const ev of events) {
          const t = ev.title.toLowerCase();
          const c = ev.country;
          if (c === "US") {
            if ((t.includes("cpi") || t.includes("소비자물가")) && actuals.cpiPrevious) {
              ev.previous = actuals.cpiPrevious;
              ev.unit = ev.unit ?? "%";
            } else if ((t.includes("nfp") || t.includes("비농업") || t.includes("고용보고서")) && actuals.nfpPrevious) {
              ev.previous = actuals.nfpPrevious;
              ev.unit = ev.unit ?? "K";
            } else if ((t.includes("실업률") || t.includes("unemployment")) && actuals.unemploymentPrevious) {
              ev.previous = actuals.unemploymentPrevious;
              ev.unit = ev.unit ?? "%";
            } else if (t.includes("ppi") && actuals.ppiPrevious) {
              ev.previous = actuals.ppiPrevious;
              ev.unit = ev.unit ?? "%";
            }
          }
        }
        console.log(`[economic-calendar] BLS 실제값 주입: CPI ${actuals.cpiPrevious}, NFP ${actuals.nfpPrevious}, 실업률 ${actuals.unemploymentPrevious}`);
      }

      // 2) FOMC 날짜 교정 — AI가 틀린 날짜를 사용한 경우 공식 날짜로 교정
      const fomcEvIdxList = events
        .map((ev, i) => ({ ev, i }))
        .filter(({ ev }) => ev.country === "US" && (ev.title.toLowerCase().includes("fomc") || ev.category === "금리결정" || ev.title.includes("기준금리")));

      for (const { ev, i } of fomcEvIdxList) {
        // 가장 가까운 FOMC 날짜 찾기 (±5일 허용)
        const evDate = new Date(ev.date);
        const match = fomc.find(f => {
          const diff = Math.abs(new Date(f.endDate).getTime() - evDate.getTime());
          return diff <= 5 * 86400000;
        });
        if (match && match.endDate !== ev.date) {
          console.log(`[economic-calendar] FOMC 날짜 교정: ${ev.date} → ${match.endDate}`);
          events[i] = { ...ev, date: match.endDate, time: ev.time ?? "03:00 KST" };
        }
      }

      // 3) BLS 공식 릴리즈 날짜로 이벤트 날짜 교정 및 누락 이벤트 추가
      const BLS_INDICATOR_MAP: Record<BLSReleaseDate["indicator"], { titleKw: string[]; titleKo: string; category: string; importance: EconomicEvent["importance"] }> = {
        "CPI":           { titleKw: ["cpi", "소비자물가"],        titleKo: "미국 CPI (소비자물가지수)",        category: "물가",     importance: "high" },
        "NFP":           { titleKw: ["nfp", "비농업", "고용보고"], titleKo: "미국 비농업 고용보고서 (NFP)",     category: "고용",     importance: "high" },
        "PPI":           { titleKw: ["ppi", "생산자물가"],         titleKo: "미국 PPI (생산자물가지수)",        category: "물가",     importance: "medium" },
        "Retail Sales":  { titleKw: ["retail", "소매판매"],        titleKo: "미국 소매판매",                    category: "소비",     importance: "medium" },
        "Jobless Claims":{ titleKw: ["jobless", "실업수당"],        titleKo: "미국 신규실업수당청구건수",        category: "고용",     importance: "medium" },
      };

      for (const rel of schedule) {
        if (rel.date < todayStr || rel.date > endStr) continue;
        const meta = BLS_INDICATOR_MAP[rel.indicator];
        if (!meta) continue;

        // 해당 날짜 ±3일 내에 같은 지표 이벤트 있는지 확인
        const exists = events.some(ev => {
          if (ev.country !== "US") return false;
          const titleLow = ev.title.toLowerCase();
          if (!meta.titleKw.some(kw => titleLow.includes(kw))) return false;
          const diff = Math.abs(new Date(ev.date).getTime() - new Date(rel.date).getTime());
          return diff <= 3 * 86400000;
        });

        if (exists) {
          // 날짜 교정: AI 날짜 → BLS 공식 날짜
          events = events.map(ev => {
            if (ev.country !== "US") return ev;
            const titleLow = ev.title.toLowerCase();
            if (!meta.titleKw.some(kw => titleLow.includes(kw))) return ev;
            const diff = Math.abs(new Date(ev.date).getTime() - new Date(rel.date).getTime());
            if (diff > 0 && diff <= 3 * 86400000) {
              console.log(`[economic-calendar] BLS 날짜 교정 [${rel.indicator}]: ${ev.date} → ${rel.date}`);
              return { ...ev, date: rel.date, time: rel.timeKST };
            }
            return ev;
          });
        } else {
          // 누락 이벤트 추가
          const prevVal = rel.indicator === "CPI"   ? actuals?.cpiPrevious
                        : rel.indicator === "NFP"   ? actuals?.nfpPrevious
                        : rel.indicator === "PPI"   ? actuals?.ppiPrevious
                        : undefined;
          console.log(`[economic-calendar] BLS 이벤트 추가: ${rel.indicator} on ${rel.date}`);
          events.push({
            date: rel.date,
            time: rel.timeKST,
            title: meta.titleKo,
            country: "US",
            category: meta.category,
            importance: meta.importance,
            forecast: undefined,
            previous: prevVal ?? undefined,
            unit: rel.indicator === "NFP" ? "K" : "%",
          });
        }
      }

      // 4) FOMC 날짜 중 이벤트 없는 것 추가
      for (const f of fomc) {
        if (f.endDate < todayStr || f.endDate > endStr) continue;
        const hasFomc = events.some(ev =>
          ev.country === "US" &&
          (ev.title.toLowerCase().includes("fomc") || ev.category === "금리결정") &&
          Math.abs(new Date(ev.date).getTime() - new Date(f.endDate).getTime()) <= 1 * 86400000
        );
        if (!hasFomc) {
          console.log(`[economic-calendar] FOMC 이벤트 추가: ${f.endDate}`);
          events.push({
            date: f.endDate,
            time: "03:00 KST",
            title: "FOMC 금리결정",
            country: "US",
            category: "금리결정",
            importance: "high",
            forecast: undefined,
            previous: actuals?.cpiPrevious ? undefined : undefined,
            unit: "%",
          });
        }
      }
    }

    events = events.filter(e => e.date >= todayStr && e.date <= endStr);
    events.sort((a, b) => a.date.localeCompare(b.date));

    _economicCalCache.set(cacheKey, { data: events, expiresAt: Date.now() + ECONOMIC_CAL_TTL_MS });
    saveToDBCache(`cal-economic-${range}`, events, ECONOMIC_CAL_TTL_MS);
    console.log(`[economic-calendar] ${range}: ${events.length}개 이벤트 생성 (BLS 보강 포함)`);
    return res.json(events);
  } catch (err: any) {
    console.error("[economic-calendar] error:", err?.message);
    return res.status(500).json({ error: err?.message ?? "경제 캘린더 조회 실패" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 비상장 기업 분석 API (DART 기반) — /:ticker 와일드카드보다 앞에 위치해야 함
// ════════════════════════════════════════════════════════════════════════════

router.get("/dart-company-search", async (req, res) => {
  try {
    const q = ((req.query.q as string) || "").trim();
    if (q.length < 1) return res.json([]);

    // 1순위: corpCode.xml 인덱스 (전체 상장+비상장, 백그라운드 다운로드 완료 시)
    const { searchCorpByName, hasCorpInfoList } = await import("../lib/dart-corp-cache.js");
    if (hasCorpInfoList()) {
      const raw = searchCorpByName(q, 20);
      // corpCode.xml에 corp_cls 없음 → KRX 캐시로 보강
      const krx = getKRXCache();
      const krxByCode = new Map(krx.map(s => [s.code, s]));
      const enriched = raw.map(c => {
        if (c.corp_cls) return c; // 이미 있으면 유지
        if (!c.stock_code) return { ...c, corp_cls: "E" }; // 비상장
        const k = krxByCode.get(c.stock_code);
        return { ...c, corp_cls: k ? (k.exchange === "KOSPI" ? "Y" : "K") : "E" };
      });
      return res.json(enriched);
    }

    // 2순위 fallback: KRX 목록(2712개 상장사)에서 이름 부분 검색 + corp_code 매핑
    const krxList = getKRXCache();
    if (krxList.length > 0) {
      const lq = q.toLowerCase();
      const matched = krxList
        .filter(s => s.name.toLowerCase().includes(lq))
        .slice(0, 20);
      const results = matched.map(s => ({
        corp_code: getCorpCodeFromCache(s.code) ?? "",
        corp_name: s.name,
        stock_code: s.code,
        corp_cls: s.exchange === "KOSPI" ? "Y" : "K",
      }));
      return res.json(results);
    }

    // 3순위: KRX도 미준비 시 빈 배열 (서버 기동 직후 매우 짧은 시간만 해당)
    res.json([]);
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

router.get("/dart-company-financials", async (req, res) => {
  try {
    const corp_code = ((req.query.corp_code as string) || "").trim();
    if (!corp_code) return res.status(400).json({ error: "corp_code required" });
    const DART_KEY = process.env.DART_API_KEY;
    if (!DART_KEY) return res.json([]);
    const cacheKey = `dart-co-fin-v2-${corp_code}-${new Date().getFullYear()}`;
    const cached = await getFromDBCache<any[]>(cacheKey);
    if (cached) return res.json(cached);
    const thisYear = new Date().getFullYear();
    const ACNT_MAP: Record<string, string> = {
      "매출액": "revenue", "영업이익": "op_income", "당기순이익": "net_income",
      "자산총계": "total_assets", "부채총계": "total_liabilities", "자본총계": "equity",
    };
    const results: any[] = [];
    for (const year of [thisYear - 1, thisYear - 2, thisYear - 3, thisYear - 4]) {
      try {
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}&corp_code=${corp_code}&bsns_year=${year}&reprt_code=11011&fs_div=CFS`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const d = (await r.json()) as any;
        if (d.status !== "000" || !d.list) continue;
        const row: any = { year };
        for (const item of d.list) {
          const k = ACNT_MAP[item.account_nm];
          if (k && item.thstrm_amount) { const v = parseInt((item.thstrm_amount as string).replace(/,/g, ""), 10); if (!isNaN(v)) row[k] = v; }
        }
        if (Object.keys(row).length > 1) results.push(row);
      } catch {}
    }
    results.sort((a, b) => a.year - b.year);
    if (results.length > 0) await saveToDBCache(cacheKey, results, 30 * 24 * 60);
    res.json(results);
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

router.get("/dart-company-disclosures-by-corp", async (req, res) => {
  try {
    const corp_code = ((req.query.corp_code as string) || "").trim();
    if (!corp_code) return res.status(400).json({ error: "corp_code required" });
    const DART_KEY = process.env.DART_API_KEY;
    if (!DART_KEY) return res.json([]);
    const todayKST = new Date(Date.now() + 9 * 3_600_000);
    const fmt8 = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const cacheKey = `dart-corp-disc-${corp_code}-${fmt8(todayKST).slice(0, 6)}`;
    const cached = await getFromDBCache<any[]>(cacheKey);
    if (cached) return res.json(cached);
    const bgn_de = fmt8(new Date(Date.now() - 365 * 86_400_000));
    const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${DART_KEY}&corp_code=${corp_code}&bgn_de=${bgn_de}&page_count=20&sort=date&sort_mth=desc`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const d = (await r.json()) as any;
    if (d.status !== "000") return res.json([]);
    const result = (d.list ?? []).slice(0, 20).map((item: any) => ({
      rcept_no: item.rcept_no, report_nm: item.report_nm, rcept_dt: item.rcept_dt,
      flr_nm: item.flr_nm, dartUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
    }));
    await saveToDBCache(cacheKey, result, 24 * 60);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e?.message }); }
});

router.post("/dart-unlisted-analysis", async (req, res) => {
  try {
    const { corp_code, corp_name, corp_cls } = req.body as { corp_code: string; corp_name: string; corp_cls?: string };
    if (!corp_code || !corp_name) return res.status(400).json({ error: "corp_code, corp_name required" });
    const DART_KEY = process.env.DART_API_KEY;
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!DART_KEY || !GEMINI_KEY) return res.status(500).json({ error: "API keys missing" });
    const thisYear = new Date().getFullYear();
    const ACNT_MAP: Record<string, string> = {
      "매출액": "revenue", "영업이익": "op_income", "당기순이익": "net_income",
      "자산총계": "total_assets", "부채총계": "total_liabilities", "자본총계": "equity",
    };
    const financials: any[] = [];
    for (const year of [thisYear - 1, thisYear - 2, thisYear - 3]) {
      try {
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${DART_KEY}&corp_code=${corp_code}&bsns_year=${year}&reprt_code=11011&fs_div=CFS`;
        const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const d = (await r.json()) as any;
        if (d.status !== "000" || !d.list) continue;
        const row: any = { year };
        for (const item of d.list) {
          const k = ACNT_MAP[item.account_nm];
          if (k && item.thstrm_amount) { const v = parseInt((item.thstrm_amount as string).replace(/,/g, ""), 10); if (!isNaN(v)) row[k] = v; }
        }
        if (Object.keys(row).length > 1) financials.push(row);
      } catch {}
    }
    const bgn_de = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "");
    let disclosures: string[] = [];
    try {
      const dr = await fetch(`https://opendart.fss.or.kr/api/list.json?crtfc_key=${DART_KEY}&corp_code=${corp_code}&bgn_de=${bgn_de}&page_count=10&sort=date&sort_mth=desc`, { signal: AbortSignal.timeout(10_000) });
      const dd = (await dr.json()) as any;
      disclosures = (dd.list ?? []).slice(0, 8).map((i: any) => `[${i.rcept_dt}] ${i.report_nm}`);
    } catch {}
    const fmtB = (v: number | undefined) => {
      if (v == null || isNaN(v)) return "N/A";
      if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(1)}조원`;
      if (Math.abs(v) >= 1e8) return `${Math.round(v / 1e8)}억원`;
      return `${Math.round(v / 1e6)}백만원`;
    };
    const finText = financials.map(f =>
      `${f.year}년: 매출 ${fmtB(f.revenue)}, 영업이익 ${fmtB(f.op_income)}, 순이익 ${fmtB(f.net_income)}, 총자산 ${fmtB(f.total_assets)}, 부채 ${fmtB(f.total_liabilities)}, 자본 ${fmtB(f.equity)}`
    ).join("\n");
    const clsLbl = corp_cls === "Y" ? "유가증권시장 상장사" : corp_cls === "K" ? "코스닥 상장사" : corp_cls === "N" ? "코넥스 상장사" : "비상장 기업";
    const prompt = `당신은 국내 비상장 기업 투자 전문 애널리스트입니다. 투자 검토 목적의 심층 분석을 제공하세요.

[기업 정보]
회사명: ${corp_name} (${clsLbl})

[재무 현황 (DART 공시 연간 기준)]
${finText || "재무 데이터 조회 불가 (소규모 기업이거나 공시 의무 없을 수 있음)"}

[최근 1년 공시 목록]
${disclosures.length > 0 ? disclosures.join("\n") : "최근 공시 없음"}

위 정보를 바탕으로 **투자 검토 보고서**를 작성해주세요:

## 사업 모델 및 경쟁력
회사의 핵심 사업, 수익 구조, 시장 내 포지셔닝을 2-3문단으로 설명하세요.

## 재무 건전성 분석
- **매출 성장성**: 연도별 매출 증가율 계산 및 평가
- **수익성**: 영업이익률, 순이익률 추이
- **재무 안정성**: 부채비율(부채/자본), 자본 충실도
- **종합 재무 등급**: 우수/양호/보통/취약 중 하나와 근거

## 핵심 리스크 (3가지)
각 리스크를 **리스크명**: 설명 형식으로 작성하세요.

## 성장 잠재력
시장 기회, 업종 트렌드, 사업 확장성을 분석하세요.

## 유사 상장사 기반 밸류에이션 가이드
- 적합한 비교 지표 (PER, PBR, EV/EBITDA, PSR 중 적합한 것)
- 유사 상장 기업명 2-3개 제시
- 합리적 밸류에이션 배수 범위
- 대략적인 기업가치 추정 범위 (재무 데이터 있는 경우)

## 종합 투자 의견
**투자 매력도**: 상/중/하 판정과 핵심 근거 2-3가지`;
    const genAI = new GoogleGenAI({ apiKey: GEMINI_KEY });
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    const stream = await genAI.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { thinkingConfig: { thinkingBudget: 0 } },
    });
    for await (const chunk of stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (text) res.write(text);
    }
    res.end();
  } catch (e: any) {
    if (!res.headersSent) res.status(500).json({ error: e?.message });
    else res.end();
  }
});

// ════════════════════════════════════════════════════════════════════════════

router.get("/:ticker", async (req, res) => {
  const ticker = sanitizeTicker(req.params.ticker ?? "");
  if (!ticker) { res.status(400).json({ error: "Invalid ticker symbol" }); return; }

  const rawPeriod   = typeof req.query.period   === "string" ? req.query.period   : "1y";
  const rawInterval = typeof req.query.interval  === "string" ? req.query.interval  : "1d";
  const period   = ALLOWED_PERIODS.has(rawPeriod)   ? rawPeriod   : "1y";
  const interval = ALLOWED_INTERVALS.has(rawInterval) ? rawInterval : "1d";

  try {
    const days = PERIOD_TO_DAYS[period] ?? 365;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const periodStr = period as string;
    const p1 = startDate.toISOString().split("T")[0];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const p2 = tomorrow.toISOString().split("T")[0];

    const koreanResolved = await resolveKoreanTicker(ticker, p1, p2, interval as string);
    const result = koreanResolved?.result ?? await yahooFinance.chart(ticker, {
      period1: p1,
      period2: p2,
      interval: (interval as any) ?? "1d",
    });

    const rawQuotes = result?.quotes;
    if (!rawQuotes || rawQuotes.length === 0) {
      res.status(404).json({ error: "No data found for ticker" });
      return;
    }

    const quotes = rawQuotes.filter((d) => d.close != null && d.close > 0);
    if (quotes.length === 0) {
      res.status(404).json({ error: "No valid price data for ticker" });
      return;
    }

    const dates = quotes.map((d) => {
      // Yahoo Finance stores timestamps at midnight of the exchange's local timezone.
      // KRX (Seoul, UTC+9): midnight KST = 15:00 UTC previous day → ISO date is wrong.
      // Adding 12 h normalises across all major exchanges (KST +9, ET -5, etc.).
      const adjusted = new Date(new Date(d.date).getTime() + 12 * 3600 * 1000);
      return adjusted.toISOString().split("T")[0];
    });
    const opens = quotes.map((d) => d.open ?? 0);
    const highs = quotes.map((d) => d.high ?? 0);
    const lows = quotes.map((d) => d.low ?? 0);
    const closes = quotes.map((d) => d.close ?? 0);
    const volumes = quotes.map((d) => d.volume ?? 0);
    void periodStr;

    const rsi = calculateRSI(closes);
    const ma20 = calculateMA(closes, 20);
    const ma60 = calculateMA(closes, 60);
    const ma120 = calculateMA(closes, 120);
    const bb = calculateBollingerBands(closes);

    const currentPrice = closes[closes.length - 1];
    const prevPrice = closes[closes.length - 2] ?? currentPrice;
    const changePercent = ((currentPrice - prevPrice) / prevPrice) * 100;
    const yearHigh = Math.max(...highs);
    const yearLow = Math.min(...lows);
    const currentRsi = rsi[rsi.length - 1];

    const resolvedSymbol = koreanResolved?.symbol ?? ticker;

    let quoteInfo = null;
    try {
      const quote = await yahooFinance.quote(resolvedSymbol);
      quoteInfo = {
        longName: quote.longName ?? quote.shortName,
        marketCap: quote.marketCap,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
        fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
        averageVolume: quote.averageDailyVolume10Day,
        currency: quote.currency,
      };
    } catch {
      // quote info optional
    }

    // Fetch Naver real-time data for Korean stocks (NXT price + accurate close + today OHLCV)
    let nxtInfo: { price: number; changePercent: number; compareToPrev: string; at: string; sessionType: string; status: string } | null = null;
    let naverKrxClose: number | null = null;
    let naverTodayCandle: { open: number; high: number; low: number; close: number; volume: number } | null = null;
    const koreanCode = resolvedSymbol.match(/^(\d{6})\.(KS|KQ)$/)?.[1];
    if (koreanCode) {
      try {
        const naverBasicRes = await fetch(
          `https://m.stock.naver.com/api/stock/${koreanCode}/basic`,
          { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Referer": "https://m.stock.naver.com/" } }
        );
        if (naverBasicRes.ok) {
          const naverBasic: any = await naverBasicRes.json();
          const parseNum = (v: any) => v ? Number(String(v).replace(/,/g, "")) : null;
          const naverClose = parseNum(naverBasic.closePrice);
          if (naverClose && naverClose > 0) naverKrxClose = naverClose;

          // Extract today's OHLCV from Naver basic
          const naverOpen   = parseNum(naverBasic.openPrice);
          const naverHigh   = parseNum(naverBasic.highPrice);
          const naverLow    = parseNum(naverBasic.lowPrice);
          const naverVol    = parseNum(naverBasic.accumulatedTradingVolume ?? naverBasic.tradingVolume);
          if (naverClose && naverClose > 0) {
            naverTodayCandle = {
              open:   naverOpen  && naverOpen  > 0 ? naverOpen  : naverClose,
              high:   naverHigh  && naverHigh  > 0 ? naverHigh  : naverClose,
              low:    naverLow   && naverLow   > 0 ? naverLow   : naverClose,
              close:  naverClose,
              volume: naverVol   && naverVol   > 0 ? naverVol   : 0,
            };
          }

          const nxt = naverBasic.overMarketPriceInfo;
          if (nxt?.overPrice) {
            const nxtPriceNum = Number(String(nxt.overPrice).replace(/,/g, ""));
            if (nxtPriceNum > 0) {
              nxtInfo = {
                price: nxtPriceNum,
                changePercent: Number(nxt.fluctuationsRatio ?? 0),
                compareToPrev: nxt.compareToPreviousClosePrice ?? "0",
                at: nxt.localTradedAt ?? "",
                sessionType: nxt.tradingSessionType ?? "AFTER_MARKET",
                status: nxt.overMarketStatus ?? "CLOSE",
              };
            }
          }
        }
      } catch {
        // optional
      }
    }

    // Use Naver close price as authoritative for Korean stocks when available
    const effectiveCurrentPrice = naverKrxClose ?? currentPrice;

    // Inject today's candle if Yahoo Finance hasn't included it yet
    const todayKST = new Date(Date.now() + 9 * 3600 * 1000).toISOString().split("T")[0]; // KST today
    const lastCandleDate = dates[dates.length - 1] ?? "";
    if (naverTodayCandle && lastCandleDate < todayKST) {
      // Add synthetic today candle using Naver data
      const prevClose = closes[closes.length - 1] ?? naverTodayCandle.close;
      dates.push(todayKST);
      opens.push(naverTodayCandle.open);
      highs.push(naverTodayCandle.high);
      lows.push(naverTodayCandle.low);
      closes.push(naverTodayCandle.close);
      volumes.push(naverTodayCandle.volume);
      // Append indicators (repeat last known value or null)
      const todayRsi = rsi.length > 0 ? rsi[rsi.length - 1] : null;
      const todayMa20 = ma20.length > 0 ? ma20[ma20.length - 1] : null;
      const todayMa60 = ma60.length > 0 ? ma60[ma60.length - 1] : null;
      const todayMa120 = ma120.length > 0 ? ma120[ma120.length - 1] : null;
      const todayBbUpper = bb.upper.length > 0 ? bb.upper[bb.upper.length - 1] : null;
      const todayBbMiddle = bb.middle.length > 0 ? bb.middle[bb.middle.length - 1] : null;
      const todayBbLower = bb.lower.length > 0 ? bb.lower[bb.lower.length - 1] : null;
      void prevClose;
      rsi.push(todayRsi as number);
      ma20.push(todayMa20 as number);
      ma60.push(todayMa60 as number);
      ma120.push(todayMa120 as number);
      bb.upper.push(todayBbUpper as number);
      bb.middle.push(todayBbMiddle as number);
      bb.lower.push(todayBbLower as number);
    }

    res.json({
      ticker,
      quoteInfo,
      currentPrice: effectiveCurrentPrice,
      changePercent,
      yearHigh,
      yearLow,
      currentRsi,
      nxtInfo,
      candles: dates.map((date, i) => ({
        date,
        open: opens[i],
        high: highs[i],
        low: lows[i],
        close: closes[i],
        volume: volumes[i],
        rsi: rsi[i],
        ma20: ma20[i],
        ma60: ma60[i],
        ma120: ma120[i],
        bbUpper: bb.upper[i],
        bbMiddle: bb.middle[i],
        bbLower: bb.lower[i],
      })),
    });
  } catch (err: any) {
    console.error("Market data error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to fetch market data" });
  }
});

const TTL_TICKER_STATS = 30 * 60 * 1000; // 30분

// GET /api/market-data/ticker-stats/:ticker — PER, PBR, 52w high/low, volume, etc.
router.get("/ticker-stats/:ticker", async (req, res) => {
  const ticker = sanitizeTicker(req.params.ticker ?? "");
  if (!ticker) { res.status(400).json({ error: "Invalid ticker" }); return; }

  const cacheKey = `ts:${ticker}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) { res.json(cached); return; }

  const koreanCode = ticker.match(/^(\d{6})\.(KS|KQ)$/)?.[1]
    ?? ticker.match(/^(\d{6})$/)?.[1];

  try {
    let q: any = null;

    if (koreanCode) {
      // Naver integration API — totalInfos 배열에서 PER/PBR/52주고저/거래량/시총 추출
      const NAVER_HEADERS = {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://m.stock.naver.com/",
      };
      try {
        const intRes = await fetch(`https://m.stock.naver.com/api/stock/${koreanCode}/integration`, { headers: NAVER_HEADERS });
        if (intRes.ok) {
          const intData: any = await intRes.json();
          const infos: any[] = intData?.totalInfos ?? [];
          const byCode: Record<string, string> = {};
          for (const item of infos) {
            if (item?.code && item?.value != null) byCode[item.code] = String(item.value);
          }
          // 값 파싱 헬퍼: "24.81배" → 24.81, "330,000" → 330000
          const parseNum = (v: string | undefined) => {
            if (!v) return null;
            const n = parseFloat(v.replace(/[^0-9.]/g, ""));
            return isNaN(n) ? null : n;
          };
          // 시총 파싱: "1,794조 8,075억" → 숫자(원)
          const parseMC = (v: string | undefined): number | null => {
            if (!v) return null;
            const joMatch = v.match(/([\d,]+)조/);
            const eokMatch = v.match(/([\d,]+)억/);
            const jo = joMatch ? Number(joMatch[1].replace(/,/g, "")) : 0;
            const eok = eokMatch ? Number(eokMatch[1].replace(/,/g, "")) : 0;
            const total = jo * 1e12 + eok * 1e8;
            return total > 0 ? total : null;
          };
          const per = parseNum(byCode.per);
          const pbr = parseNum(byCode.pbr);
          const eps = parseNum(byCode.eps);
          const bps = parseNum(byCode.bps);
          const week52High = parseNum(byCode.highPriceOf52Weeks);
          const week52Low = parseNum(byCode.lowPriceOf52Weeks);
          const volume = parseNum(byCode.accumulatedTradingVolume);
          const marketCap = parseMC(byCode.marketValue);
          const divYieldRaw = byCode.dividendYieldRatio ? parseFloat(byCode.dividendYieldRatio) : null;

          const result = { currency: "KRW", marketCap, per, pbr, eps, bps, dividendYield: divYieldRaw, week52High, week52Low, volume, avgVolume: null, beta: null };
          cache.set(cacheKey, result, TTL_TICKER_STATS);
          res.json(result);
          return;
        }
      } catch { /* Naver 실패 시 Yahoo fallback */ }

      // Yahoo Finance fallback for Korean stocks
      for (const suffix of [".KS", ".KQ"]) {
        try {
          q = await yahooFinance.quote(`${koreanCode}${suffix}`);
          if (q?.regularMarketPrice) break;
        } catch { continue; }
      }
    } else {
      // US / global stocks
      try { q = await yahooFinance.quote(ticker); } catch {}
    }

    const result = {
      currency: koreanCode ? "KRW" : (q?.currency ?? "USD"),
      marketCap: q?.marketCap ?? null,
      per: q?.trailingPE ?? null,
      forwardPer: q?.forwardPE ?? null,
      pbr: q?.priceToBook ?? null,
      week52High: q?.fiftyTwoWeekHigh ?? null,
      week52Low: q?.fiftyTwoWeekLow ?? null,
      volume: q?.regularMarketVolume ?? null,
      avgVolume: q?.averageDailyVolume3Month ?? null,
      dividendYield: q?.dividendYield != null ? q.dividendYield * 100 : null,
      beta: q?.beta ?? null,
      eps: q?.epsTrailingTwelveMonths ?? null,
    };
    cache.set(cacheKey, result, TTL_TICKER_STATS);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to fetch ticker stats" });
  }
});

// GET /api/market-data/financials/:ticker — structured annual + quarterly income statement
router.get("/financials/:ticker", async (req, res) => {
  const ticker = sanitizeTicker(req.params.ticker ?? "");
  if (!ticker) { res.status(400).json({ error: "Invalid ticker symbol" }); return; }
  const NAVER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Referer": "https://m.stock.naver.com/",
  };

  const koreanCode = ticker.match(/^(\d{6})\.(KS|KQ)$/)?.[1]
    ?? ticker.match(/^(\d{6})$/)?.[1];

  if (koreanCode) {
    try {
      const [summaryRes, basicRes] = await Promise.all([
        fetch(`https://m.stock.naver.com/api/stock/${koreanCode}/finance/summary`, { headers: NAVER_HEADERS }),
        fetch(`https://m.stock.naver.com/api/stock/${koreanCode}/basic`, { headers: NAVER_HEADERS }),
      ]);
      if (!summaryRes.ok) { res.status(502).json({ error: "Naver API error" }); return; }
      const summary: any = await summaryRes.json();

      let marketCap: number | null = null;
      if (basicRes.ok) {
        const basic: any = await basicRes.json();
        const rawCap = basic.marketCap ?? basic.marketValue ?? basic.totalMarketValue ?? null;
        if (rawCap != null) marketCap = Number(String(rawCap).replace(/,/g, ""));
      }
      // Fallback: Yahoo Finance
      if (!marketCap) {
        try {
          const yq = await yahooFinance.quote(ticker);
          if (yq.marketCap) marketCap = yq.marketCap;
        } catch { /* optional */ }
      }

      const parseStmt = (stmtObj: any) => {
        if (!stmtObj) return [];
        const cols: string[][] = stmtObj.columns ?? [];
        const titleList: any[] = stmtObj.trTitleList ?? [];
        const periods: string[] = cols[0]?.slice(1) ?? [];
        const revenues = cols.find((c: string[]) => c[0] === "매출액")?.slice(1) ?? [];
        const opIncomes = cols.find((c: string[]) => c[0] === "영업이익")?.slice(1) ?? [];
        const netIncomes = cols.find((c: string[]) => c[0] === "당기순이익")?.slice(1) ?? [];
        // 네이버 분기 포맷 정규화: "2025.06", "2025-06." 등 → "2025-06"
        const normPeriod = (p: string) =>
          p.trim().replace(/\.$/, "").replace(".", "-");
        return periods.map((period: string, i: number) => ({
          period: normPeriod(period),
          isEstimate: titleList[i]?.isConsensus === "Y",
          revenue: revenues[i] ? Number(revenues[i]) * 1e8 : null,
          operatingIncome: opIncomes[i] ? Number(opIncomes[i]) * 1e8 : null,
          netIncome: netIncomes[i] ? Number(netIncomes[i]) * 1e8 : null,
          operatingMargin:
            revenues[i] && opIncomes[i] && Number(revenues[i]) > 0
              ? (Number(opIncomes[i]) / Number(revenues[i])) * 100
              : null,
        }));
      };

      let annual = parseStmt(summary.chartIncomeStatement?.annual);
      let quarterly = parseStmt(summary.chartIncomeStatement?.quarter);

      // 네이버는 최근 3~4분기만 반환 → Yahoo Finance로 과거 분기 보충 (최대 8분기)
      try {
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
        const yahooTicker = ticker.includes(".") ? ticker : `${koreanCode}.KS`;
        const qRaw = await (yahooFinance as any).fundamentalsTimeSeries(yahooTicker, {
          period1: twoYearsAgo,
          type: "quarterly",
          module: "financials",
        });
        if (Array.isArray(qRaw) && qRaw.length > 0) {
          const naverPeriods = new Set(quarterly.map((e: any) => e.period));
          const yahooEntries = qRaw
            .map((e: any) => {
              const rev: number | null = e.totalRevenue ?? null;
              const op: number | null = e.operatingIncome ?? null;
              const ni: number | null = e.netIncome ?? null;
              const dateStr = e.date ? new Date(e.date).toISOString().slice(0, 7) : "";
              return {
                period: dateStr,
                isEstimate: false,
                revenue: rev,
                operatingIncome: op,
                netIncome: ni,
                operatingMargin: rev && op != null && rev > 0 ? (op / rev) * 100 : null,
              };
            })
            .filter((e: any) => e.period && (e.revenue != null || e.operatingIncome != null))
            .filter((e: any) => !naverPeriods.has(e.period)); // 네이버 데이터 우선
          quarterly = [...quarterly, ...yahooEntries]
            .sort((a: any, b: any) => b.period.localeCompare(a.period))
            .slice(0, 10); // 최대 10분기
        }
      } catch { /* Yahoo 보충 실패해도 Naver 데이터로 진행 */ }

      // ── Yahoo Finance earningsTrend 로 미래 전망 보충 (Naver 미포함 연도만) ──
      try {
        const yahooTicker = ticker.includes(".") ? ticker : `${koreanCode}.KS`;
        const qs = await yahooFinance.quoteSummary(yahooTicker, {
          modules: ["earningsTrend" as any],
        });
        const trend: any[] = (qs as any).earningsTrend?.trend ?? [];
        const annualYears = new Set(annual.map((e: any) => String(e.period).slice(0, 4)));
        // 과거 실적 평균 OPM (추정치 제외)
        const histOPMs = annual
          .filter((e: any) => !e.isEstimate && e.operatingMargin != null)
          .map((e: any) => e.operatingMargin as number);
        const avgOPM = histOPMs.length ? histOPMs.reduce((a, b) => a + b, 0) / histOPMs.length : null;

        for (const t of trend) {
          if (!["0y", "+1y", "+2y"].includes(t.period ?? "")) continue;
          const endDate: Date | null = t.endDate ?? null;
          if (!endDate) continue;
          const dateStr = new Date(endDate).toISOString().slice(0, 7); // "2027-12"
          const yearStr = dateStr.slice(0, 4);
          if (annualYears.has(yearStr)) continue; // Naver 데이터 우선
          const rev: number | null = t.revenueEstimate?.avg ?? null;
          if (!rev) continue;
          const op = avgOPM != null ? rev * (avgOPM / 100) : null;
          annual.push({
            period: dateStr,
            isEstimate: true,
            opIncomeFromMargin: op != null,
            revenue: rev,
            operatingIncome: op,
            netIncome: null,
            operatingMargin: avgOPM,
          });
          annualYears.add(yearStr);
        }
        annual = annual.sort((a: any, b: any) => a.period.localeCompare(b.period));
      } catch { /* 전망 보충 실패 시 Naver 데이터만 사용 */ }

      res.json({
        ticker,
        currency: "KRW",
        marketCap,
        annual,
        quarterly,
      });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Failed to fetch Naver financials" });
      return;
    }
  }

  // US stocks — Yahoo Finance fundamentalsTimeSeries (incomeStatementHistory has no data since Nov 2024)
  try {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 6);
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

    const [annualRaw, quarterlyRaw, usQuoteRaw] = await Promise.all([
      (yahooFinance as any).fundamentalsTimeSeries(ticker, {
        period1: fiveYearsAgo,
        type: "annual",
        module: "financials",
      }),
      (yahooFinance as any).fundamentalsTimeSeries(ticker, {
        period1: threeYearsAgo,
        type: "quarterly",
        module: "financials",
      }),
      yahooFinance.quote(ticker, { fields: ["marketCap"] }).catch(() => null),
    ]);
    const usMarketCap: number | null = (usQuoteRaw as any)?.marketCap ?? null;

    const toEntry = (e: any) => {
      const rev: number | null = e.totalRevenue ?? null;
      const opIncome: number | null = e.operatingIncome ?? null;
      const netIncome: number | null = e.netIncome ?? null;
      const dateStr = e.date ? new Date(e.date).toISOString().slice(0, 7) : "";
      return {
        period: dateStr,
        isEstimate: false,
        opIncomeFromMargin: false,
        revenue: rev,
        operatingIncome: opIncome,
        netIncome,
        operatingMargin: rev && opIncome != null && rev > 0 ? (opIncome / rev) * 100 : null,
      };
    };

    let annual = (Array.isArray(annualRaw) ? annualRaw : [])
      .map(toEntry)
      .filter((e: any) => e.revenue != null)
      .sort((a: any, b: any) => b.period.localeCompare(a.period));

    const quarterly = (Array.isArray(quarterlyRaw) ? quarterlyRaw : [])
      .map(toEntry)
      .filter((e: any) => e.revenue != null)
      .sort((a: any, b: any) => b.period.localeCompare(a.period))
      .slice(0, 10); // 최대 10분기

    // ── Yahoo earningsTrend 로 미래 전망 추가 (0y / +1y / +2y) ───────────────
    try {
      const qs = await yahooFinance.quoteSummary(ticker, {
        modules: ["earningsTrend" as any],
      });
      const trend: any[] = (qs as any).earningsTrend?.trend ?? [];
      const annualYears = new Set(annual.map((e: any) => String(e.period).slice(0, 4)));
      // 과거 실적 평균 OPM (추정치 제외)
      const histOPMs = annual
        .filter((e: any) => !e.isEstimate && e.operatingMargin != null)
        .map((e: any) => e.operatingMargin as number);
      const avgOPM = histOPMs.length ? histOPMs.reduce((a, b) => a + b, 0) / histOPMs.length : null;

      for (const t of trend) {
        if (!["0y", "+1y", "+2y"].includes(t.period ?? "")) continue;
        const endDate: Date | null = t.endDate ?? null;
        if (!endDate) continue;
        const dateStr = new Date(endDate).toISOString().slice(0, 7);
        const yearStr = dateStr.slice(0, 4);
        if (annualYears.has(yearStr)) continue;
        const rev: number | null = t.revenueEstimate?.avg ?? null;
        if (!rev) continue;
        const op = avgOPM != null ? rev * (avgOPM / 100) : null;
        annual.push({
          period: dateStr,
          isEstimate: true,
          opIncomeFromMargin: op != null,
          revenue: rev,
          operatingIncome: op,
          netIncome: null,
          operatingMargin: avgOPM,
        });
        annualYears.add(yearStr);
      }
      annual = annual.sort((a: any, b: any) => a.period.localeCompare(b.period));
    } catch { /* 전망 보충 실패 시 역사 데이터만 사용 */ }

    res.json({ ticker, currency: "USD", marketCap: usMarketCap, annual, quarterly });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to fetch Yahoo financials" });
  }
});

// ─── 주가 급변 이슈 분석 (Gemini + Google Search grounding) ─────────────────
router.post("/price-events", async (req, res) => {
  const { ticker, companyName, events, isEn } = req.body as {
    ticker: string;
    companyName?: string;
    events: { date: string; changePercent: number }[];
    isEn?: boolean;
  };
  if (!ticker || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "ticker and events required" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No Gemini key" });

  const genAI = new GoogleGenAI({ apiKey });

  const stockId = companyName ? `${companyName}(${ticker})` : ticker;
  const eventList = events
    .map((e, i) => `${i + 1}. ${e.date.slice(0, 10)} (${e.changePercent > 0 ? "+" : ""}${e.changePercent.toFixed(1)}%)`)
    .join("\n");

  const todayStr = new Date().toISOString().slice(0, 10);

  const prompt = isEn
    ? `Today's date: ${todayStr}. All dates below are in the past.

IMPORTANT: You MUST respond entirely in English. All summary text must be in English only — no Korean characters allowed anywhere in the output.

The stock "${stockId}" experienced significant price swings on the following dates.
Search Google for real news, disclosures, or events that directly caused each price move for "${companyName ?? ticker}". Summarize concisely in English.

${eventList}

Rules:
- Focus on news/disclosures/earnings directly related to "${companyName ?? ticker}" itself.
- Do NOT write about sector-wide trends unrelated to the company.
- Search for news within 3 days before/after each date.
- Only if no company-specific event found, write: "No specific catalyst. Likely broad market influence."
- ALL summaries must be written in English, even if the source news is in Korean.

Respond with a JSON array for each date:
[
  {"date": "YYYY-MM-DD", "changePercent": number, "summary": "Event summary in English (max 80 chars)"},
  ...
]

Output JSON only. No code blocks.`
    : `오늘 날짜: ${todayStr}. 아래 날짜들은 모두 과거 날짜입니다.

한국 주식 종목 "${stockId}"의 주가가 아래 날짜에 크게 변동했습니다.
각 날짜에 이 종목(${companyName ?? ticker})에 직접 영향을 미친 실제 뉴스·공시·이벤트를 Google에서 검색하여 한국어로 간결하게 요약하세요.

${eventList}

중요 규칙:
- 반드시 "${companyName ?? ticker}" 기업 자체의 뉴스/공시/실적을 우선 조사하세요.
- 방산주·반도체·바이오 섹터 전반의 시장 흐름 등 회사와 무관한 내용은 쓰지 마세요.
- 해당 날짜 전후 3일 내 뉴스를 검색하세요.
- 회사 관련 직접적인 이슈가 없을 때만 "특정 이슈 없음. 일반 시장 동향 영향 가능성."이라고 쓰세요.

각 날짜마다 다음 JSON 배열 형식으로 답변하세요:
[
  {"date": "YYYY-MM-DD", "changePercent": 숫자, "summary": "이슈 요약 (60자 이내)"},
  ...
]

JSON만 출력하세요. 코드블록 없이.`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }],
        temperature: 0.1,
      },
    });

    const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
    const clean = text.replace(/```json|```/g, "").trim();
    try {
      const parsed = JSON.parse(clean);
      return res.json(parsed);
    } catch {
      // 파싱 실패시 빈 배열 반환
      return res.json([]);
    }
  } catch (err: any) {
    console.error("price-events error:", err?.message);
    return res.status(500).json({ error: err?.message ?? "Gemini error" });
  }
});

// GET /api/market-data/en-name/:code — KIS API 영어 종목명 조회 (캐시 적용)
router.get("/en-name/:code", async (req, res) => {
  const { code } = req.params;
  const normalized = code.replace(/\.(KS|KQ)$/i, "");
  if (!/^\d{6}$/.test(normalized)) return res.json({ engName: null });

  try {
    const { fetchKISEngName } = await import("../lib/kis-client");
    const engName = await fetchKISEngName(normalized);
    return res.json({ engName });
  } catch {
    return res.json({ engName: null });
  }
});

// GET /api/market-data/debug-price/:ticker — 진단용 (개발 환경 전용)
router.get("/debug-price/:ticker", async (req, res) => {
  if (process.env["NODE_ENV"] === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ticker = sanitizeTicker(req.params.ticker ?? "");
  if (!ticker) { res.status(400).json({ error: "Invalid ticker symbol" }); return; }

  const result: any = {};
  try {
    const q = await yahooFinance.quote(ticker);
    result.quote_regularMarketPrice = q?.regularMarketPrice ?? null;
  } catch (e: any) { result.quote_error = e.message?.slice(0, 100); }

  try {
    const s = await (yahooFinance as any).quoteSummary(ticker, { modules: ["financialData"] });
    result.financialData_currentPrice = s?.financialData?.currentPrice ?? null;
  } catch (e: any) { result.quoteSummary_error = e.message?.slice(0, 100); }

  const koreanCode = ticker.match(/^(\d{6})\.(KS|KQ)$/i)?.[1];
  if (koreanCode) {
    try {
      const nr = await fetch(`https://m.stock.naver.com/api/stock/${koreanCode}/basic`, {
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15", "Referer": "https://m.stock.naver.com/" },
        signal: AbortSignal.timeout(8000),
      });
      if (nr.ok) {
        const nd = await nr.json() as any;
        result.naver_closePrice_raw = nd.closePrice;
        result.naver_closePrice_num = nd.closePrice ? Number(String(nd.closePrice).replace(/,/g, "")) : null;
      } else {
        result.naver_status = nr.status;
      }
    } catch (e: any) { result.naver_error = e.message?.slice(0, 100); }
  }

  res.json(result);
});

// ─── GET /api/market-data/us-stocks/stats ────────────────────────────────────
router.get("/us-stocks/stats", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE data_fetched = true)     AS fetched,
        COUNT(*) FILTER (WHERE fetch_error IS NOT NULL AND fetch_error != 'yahoo_no_data') AS errors,
        COUNT(*) FILTER (WHERE fetch_error = 'yahoo_no_data') AS no_data,
        COUNT(*) FILTER (WHERE exchange = 'NASDAQ')     AS nasdaq,
        COUNT(*) FILTER (WHERE exchange = 'NYSE')       AS nyse,
        COUNT(*) FILTER (WHERE sector IS NOT NULL)      AS with_sector,
        COUNT(*) FILTER (WHERE market_cap IS NOT NULL)  AS with_mcap,
        MIN(last_updated)                               AS oldest_update,
        MAX(last_updated)                               AS latest_update
      FROM us_stocks
    `);
    const r = rows[0];
    const total   = Number(r.total);
    const fetched = Number(r.fetched);
    res.json({
      total,
      fetched,
      pending:     total - fetched,
      errors:      Number(r.errors),
      no_data:     Number(r.no_data),
      nasdaq:      Number(r.nasdaq),
      nyse:        Number(r.nyse),
      with_sector: Number(r.with_sector),
      with_mcap:   Number(r.with_mcap),
      progress_pct: total > 0 ? Math.round((fetched / total) * 100) : 0,
      oldest_update: r.oldest_update,
      latest_update: r.latest_update,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ─── GET /api/market-data/us-stocks ──────────────────────────────────────────
router.get("/us-stocks", async (req, res) => {
  try {
    const {
      exchange, sector, search,
      limit = "50", offset = "0",
      sort = "market_cap", order = "desc",
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: any[] = [];

    if (exchange) {
      params.push(exchange.toUpperCase());
      conditions.push(`exchange = $${params.length}`);
    }
    if (sector) {
      params.push(sector);
      conditions.push(`sector = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR ticker ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const allowedSort  = ["market_cap", "per", "pbr", "roe", "opm", "name", "ticker", "last_updated"];
    const allowedOrder = ["asc", "desc"];
    const safeSort  = allowedSort.includes(sort)  ? sort  : "market_cap";
    const safeOrder = allowedOrder.includes(order) ? order : "desc";

    const limitN  = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offsetN = Math.max(Number(offset) || 0, 0);

    params.push(limitN, offsetN);

    const { rows } = await pool.query(
      `SELECT ticker, name, exchange, sector, industry,
              market_cap, current_price, per, pbr, roe, opm, rev_growth,
              beta, week52_high, week52_low, last_updated
       FROM us_stocks
       ${where}
       ORDER BY ${safeSort} ${safeOrder} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM us_stocks ${where}`,
      params.slice(0, -2)
    );

    res.json({
      stocks: rows,
      total: Number(countRows[0].cnt),
      limit: limitN,
      offset: offsetN,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ─── GET /api/market-data/krx-stocks/stats ────────────────────────────────────
// KRX 전체 종목 DB 구축 진행률
router.get("/krx-stocks/stats", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE data_fetched = true)     AS fetched,
        COUNT(*) FILTER (WHERE fetch_error IS NOT NULL AND fetch_error != 'yahoo_no_data') AS errors,
        COUNT(*) FILTER (WHERE fetch_error = 'yahoo_no_data') AS no_data,
        COUNT(*) FILTER (WHERE exchange = 'KOSPI')      AS kospi,
        COUNT(*) FILTER (WHERE exchange = 'KOSDAQ')     AS kosdaq,
        COUNT(*) FILTER (WHERE sector IS NOT NULL)      AS with_sector,
        COUNT(*) FILTER (WHERE market_cap IS NOT NULL)  AS with_mcap,
        MIN(last_updated)                               AS oldest_update,
        MAX(last_updated)                               AS latest_update
      FROM krx_stocks
    `);
    const r = rows[0];
    const total   = Number(r.total);
    const fetched = Number(r.fetched);
    res.json({
      total,
      fetched,
      pending:     total - fetched,
      errors:      Number(r.errors),
      no_data:     Number(r.no_data),
      kospi:       Number(r.kospi),
      kosdaq:      Number(r.kosdaq),
      with_sector: Number(r.with_sector),
      with_mcap:   Number(r.with_mcap),
      progress_pct: total > 0 ? Math.round((fetched / total) * 100) : 0,
      oldest_update: r.oldest_update,
      latest_update: r.latest_update,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});

// ─── GET /api/market-data/krx-stocks ──────────────────────────────────────────
// KRX 종목 목록 조회 (필터: exchange, sector, search, limit, offset)
router.get("/krx-stocks", async (req, res) => {
  try {
    const {
      exchange, sector, search,
      limit = "50", offset = "0",
      sort = "market_cap", order = "desc",
    } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const params: any[] = [];

    if (exchange) {
      params.push(exchange.toUpperCase());
      conditions.push(`exchange = $${params.length}`);
    }
    if (sector) {
      params.push(sector);
      conditions.push(`sector = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(name ILIKE $${params.length} OR code ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const allowedSort  = ["market_cap", "per", "pbr", "roe", "opm", "name", "code", "last_updated"];
    const allowedOrder = ["asc", "desc"];
    const safeSort  = allowedSort.includes(sort)  ? sort  : "market_cap";
    const safeOrder = allowedOrder.includes(order) ? order : "desc";

    const limitN  = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offsetN = Math.max(Number(offset) || 0, 0);

    params.push(limitN, offsetN);

    const { rows } = await pool.query(
      `SELECT code, name, exchange, symbol, sector, industry,
              market_cap, current_price, per, pbr, roe, opm, rev_growth,
              beta, week52_high, week52_low, last_updated
       FROM krx_stocks
       ${where}
       ORDER BY ${safeSort} ${safeOrder} NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM krx_stocks ${where}`,
      params.slice(0, -2)
    );

    res.json({
      stocks: rows,
      total: Number(countRows[0].cnt),
      limit: limitN,
      offset: offsetN,
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message });
  }
});


export default router;
