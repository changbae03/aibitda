import { Router, type IRouter } from "express";
import YahooFinance from "yahoo-finance2";
import { loadKRXList, getKRXCache, type StockEntry } from "../lib/krx-cache";
import { GoogleGenAI } from "@google/genai";
import { pool } from "@workspace/db";

const yahooFinance = new YahooFinance();

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

function isValidEquityName(name: string | undefined, symbol: string): boolean {
  if (!name) return false;
  // Invalid if name contains commas (fund/index codes) or is identical to the ticker
  if (name.includes(",")) return false;
  if (name.trim() === symbol.trim()) return false;
  return true;
}

async function resolveKoreanTicker(
  ticker: string,
  period1: string,
  period2: string,
  interval: string,
) {
  if (!/^\d{6}$/.test(ticker)) return null;

  const [ksChart, kqChart, ksQuote, kqQuote] = await Promise.allSettled([
    yahooFinance.chart(`${ticker}.KS`, { period1, period2, interval: interval as any }),
    yahooFinance.chart(`${ticker}.KQ`, { period1, period2, interval: interval as any }),
    yahooFinance.quote(`${ticker}.KS`),
    yahooFinance.quote(`${ticker}.KQ`),
  ]);

  const ksValid = ksChart.status === "fulfilled" && ksChart.value?.quotes?.some((q) => q.close && q.close > 0);
  const kqValid = kqChart.status === "fulfilled" && kqChart.value?.quotes?.some((q) => q.close && q.close > 0);

  const ksName = ksQuote.status === "fulfilled" ? (ksQuote.value?.longName ?? ksQuote.value?.shortName ?? "") : "";
  const kqName = kqQuote.status === "fulfilled" ? (kqQuote.value?.longName ?? kqQuote.value?.shortName ?? "") : "";

  const ksNameOk = isValidEquityName(ksName, `${ticker}.KS`);
  const kqNameOk = isValidEquityName(kqName, `${ticker}.KQ`);

  // Prefer the exchange whose company name looks like a real stock
  if (kqValid && kqNameOk && !ksNameOk) {
    return { symbol: `${ticker}.KQ`, result: kqChart.value! };
  }
  if (ksValid && ksNameOk && !kqNameOk) {
    return { symbol: `${ticker}.KS`, result: ksChart.value! };
  }
  // Both valid or both invalid → prefer KQ (KOSDAQ has more individual stocks)
  if (kqValid) return { symbol: `${ticker}.KQ`, result: kqChart.value! };
  if (ksValid) return { symbol: `${ticker}.KS`, result: ksChart.value! };
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
  // 소비재·리테일
  { symbol: "AMZN",  name: "Amazon",               exchange: "NASDAQ", keywords: ["아마존"] },
  { symbol: "WMT",   name: "Walmart",              exchange: "NYSE",   keywords: ["월마트"] },
  { symbol: "COST",  name: "Costco",               exchange: "NASDAQ", keywords: ["코스트코"] },
  { symbol: "TGT",   name: "Target",               exchange: "NYSE",   keywords: ["타겟"] },
  { symbol: "NKE",   name: "Nike",                 exchange: "NYSE",   keywords: ["나이키"] },
  { symbol: "SBUX",  name: "Starbucks",            exchange: "NYSE",   keywords: ["스타벅스"] },
  { symbol: "MCD",   name: "McDonald's",           exchange: "NYSE",   keywords: ["맥도날드"] },
  { symbol: "KO",    name: "Coca-Cola",            exchange: "NYSE",   keywords: ["코카콜라"] },
  // 에너지
  { symbol: "XOM",   name: "ExxonMobil",           exchange: "NYSE",   keywords: ["엑슨모빌", "엑손모빌"] },
  { symbol: "CVX",   name: "Chevron",              exchange: "NYSE",   keywords: ["셰브론"] },
  // 중국
  { symbol: "BABA",  name: "Alibaba",              exchange: "NYSE",   keywords: ["알리바바"] },
  { symbol: "BIDU",  name: "Baidu",                exchange: "NASDAQ", keywords: ["바이두"] },
  { symbol: "PDD",   name: "PDD Holdings (Temu)",  exchange: "NASDAQ", keywords: ["PDD", "테무", "핀둬둬"] },
  { symbol: "JD",    name: "JD.com",               exchange: "NASDAQ", keywords: ["징둥", "JD닷컴"] },
  // 기타
  { symbol: "SPOT",  name: "Spotify",              exchange: "NYSE",   keywords: ["스포티파이"] },
  { symbol: "ZM",    name: "Zoom",                 exchange: "NASDAQ", keywords: ["줌"] },
  { symbol: "UBER",  name: "Uber",                 exchange: "NYSE",   keywords: ["우버"] },
  { symbol: "LYFT",  name: "Lyft",                 exchange: "NASDAQ", keywords: ["리프트"] },
  { symbol: "ABNB",  name: "Airbnb",               exchange: "NASDAQ", keywords: ["에어비앤비"] },
  { symbol: "SHOP",  name: "Shopify",              exchange: "NYSE",   keywords: ["쇼피파이"] },
  { symbol: "SQ",    name: "Block (Square)",       exchange: "NYSE",   keywords: ["블록", "스퀘어"] },
  { symbol: "PYPL",  name: "PayPal",               exchange: "NASDAQ", keywords: ["페이팔"] },
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

function searchKorean(query: string): ReturnType<typeof toResult>[] {
  const q = query.toLowerCase().replace(/\s/g, "");
  const krxCache = getKRXCache();

  // 미국 주식 한글명 먼저 매칭 (정확도 우선)
  const usResults = searchUSKorean(query);

  const krResults: ReturnType<typeof toResult>[] = [];

  if (krxCache.length > 0) {
    const seen = new Set<string>();
    for (const e of krxCache) {
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
  return KOREAN_COMPANY_MAP.filter(c => {
    const nameNorm = c.name.toLowerCase().replace(/[\s\-\.&]/g, "");
    if (nameNorm.includes(q) || q.includes(nameNorm)) return true;
    return c.keywords.some(k => {
      const kn = k.replace(/[\s\-\.&]/g, "");
      return kn.includes(q) || q.includes(kn);
    });
  }).slice(0, 8).map(c => ({ symbol: c.symbol, shortname: c.name, exchange: c.exchange, quoteType: "EQUITY" }));
}

function searchByCode(digits: string): ReturnType<typeof toResult>[] {
  const krxCache = getKRXCache();
  if (krxCache.length > 0) {
    return krxCache
      .filter(e => e.code.startsWith(digits))
      .slice(0, 8)
      .map(toResult);
  }
  return KOREAN_COMPANY_MAP
    .filter(c => c.symbol.startsWith(digits))
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
        if (isValidName(name, sym)) results.push({ symbol: sym, shortname: name, exchange: "KOSPI", quoteType: "EQUITY" });
      }
      if (kqQ.status === "fulfilled") {
        const sym = `${query}.KQ`;
        const yahooName = kqQ.value.longName || kqQ.value.shortName || "";
        const name = DISPLAY_NAME_OVERRIDE.get(sym) || yahooName;
        if (isValidName(name, sym)) results.push({ symbol: sym, shortname: name, exchange: "KOSDAQ", quoteType: "EQUITY" });
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
      const result = await (yahooFinance as any).search(query, { newsCount: 0, quotesCount: 20 });
      const quotes: any[] = result?.quotes ?? [];
      yahoo = quotes
        .filter((q: any) => q.symbol && q.quoteType === "EQUITY")
        .map((q: any) => {
          let exchange = q.exchange ?? "";
          if (q.symbol.endsWith(".KS")) exchange = "KOSPI";
          else if (q.symbol.endsWith(".KQ")) exchange = "KOSDAQ";
          else if (exchange === "NMS" || exchange === "NGM" || exchange === "NCM") exchange = "NASDAQ";
          else if (exchange === "NYQ" || exchange === "NYS") exchange = "NYSE";
          else if (exchange === "ASE" || exchange === "AMX") exchange = "AMEX";
          else if (!exchange) exchange = "US";
          return {
            symbol: q.symbol,
            shortname: q.longname || q.shortname || q.symbol,
            exchange,
            quoteType: "EQUITY",
          };
        });
    } catch { /* fall through */ }

    // 로컬 결과 우선, Yahoo Finance 결과 추가 (중복 심볼 제거)
    const seen = new Set(local.map(r => r.symbol));
    const merged = [...local, ...yahoo.filter(r => !seen.has(r.symbol))].slice(0, 10);
    res.json(merged);
    return;
  }

  res.json([]);
});

// ─── 배치 현재가 조회 (트래커용) ─────────────────────────────────────────────
// 단일 티커 현재가 조회 (KQ/KS 자동 판별)
async function resolveQuote(raw: string): Promise<{ price: number | null; currency: string; change: number | null }> {
  const ticker = raw.trim();
  const isKoreanSix = /^\d{6}$/.test(ticker.split(".")[0]) && !ticker.includes(".");

  if (isKoreanSix) {
    // KQ(코스닥)와 KS(코스피) 동시 조회 후 유효한 값 선택
    const [kqRes, ksRes] = await Promise.allSettled([
      yahooFinance.quote(`${ticker}.KQ`, { fields: ["regularMarketPrice", "regularMarketChangePercent", "currency"] }),
      yahooFinance.quote(`${ticker}.KS`, { fields: ["regularMarketPrice", "regularMarketChangePercent", "currency"] }),
    ]);
    const kqPrice = kqRes.status === "fulfilled" ? (kqRes.value?.regularMarketPrice ?? null) : null;
    const ksPrice = ksRes.status === "fulfilled" ? (ksRes.value?.regularMarketPrice ?? null) : null;

    // 유효한 가격이 있는 쪽 우선 (둘 다 있으면 KQ 우선)
    const winner = kqPrice != null ? kqRes : ksPrice != null ? ksRes : null;
    if (!winner || winner.status !== "fulfilled" || !winner.value?.regularMarketPrice) {
      return { price: null, currency: "KRW", change: null };
    }
    return {
      price: winner.value.regularMarketPrice,
      currency: winner.value.currency ?? "KRW",
      change: winner.value.regularMarketChangePercent ?? null,
    };
  }

  // 미국주식 or 이미 suffix 포함 (.KS/.KQ)
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

  await Promise.all(
    tickers.slice(0, 40).map(async (raw) => {
      const ticker = raw.trim();
      if (!ticker) return;
      try {
        results[ticker] = await resolveQuote(ticker);
      } catch {
        results[ticker] = { price: null, currency: "KRW", change: null };
      }
    })
  );

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

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - Math.min(days, 180));
  const p1 = startDate.toISOString().split("T")[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const p2 = tomorrow.toISOString().split("T")[0];

  await Promise.allSettled(
    tickers.slice(0, 20).map(async (raw) => {
      const ticker = raw.trim();
      if (!ticker) return;
      try {
        const isKoreanSix = /^\d{6}$/.test(ticker.split(".")[0]) && !ticker.includes(".");
        let closes: number[] = [];

        if (isKoreanSix) {
          // KQ/KS 둘 다 시도, 종가가 있는 쪽 선택 (KQ 우선)
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
        } else {
          const chart = await yahooFinance.chart(ticker, { period1: p1, period2: p2, interval: "1d" });
          closes = (chart?.quotes ?? []).filter((d: any) => d.close != null && d.close > 0).map((d: any) => d.close as number);
        }

        const change3m = closes.length >= 2
          ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
          : null;
        result[ticker] = { closes, change3m };
      } catch {
        result[ticker] = { closes: [], change3m: null };
      }
    })
  );

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

  await Promise.allSettled(
    items.slice(0, 30).map(async ({ id, ticker, analysisDate }) => {
      try {
        const fromDate = new Date(analysisDate);
        // 분석일 하루 전부터 조회 (한국 장 마감 후 분석한 경우 당일 종가 포함)
        fromDate.setDate(fromDate.getDate() - 1);

        const quotes = await fetchQuotes(ticker, fromDate);
        if (quotes.length === 0) {
          results[id] = { w1: null, m1: null, m3: null, entryClose: null };
          return;
        }

        // 분석일 기준 첫 거래일 종가 = 기준가 (entry)
        const analysisTs = new Date(analysisDate);
        const entryQuote = quotes.find(q => q.close != null && q.close > 0 && new Date(q.date) >= new Date(analysisTs.toISOString().split("T")[0]));
        const entryClose = entryQuote?.close ?? null;
        if (!entryClose) {
          results[id] = { w1: null, m1: null, m3: null, entryClose: null };
          return;
        }

        const pct = (close: number | null) =>
          close != null ? ((close - entryClose) / entryClose) * 100 : null;

        results[id] = {
          entryClose,
          w1: pct(findClose(quotes, new Date(analysisDate), 7)),
          m1: pct(findClose(quotes, new Date(analysisDate), 30)),
          m3: pct(findClose(quotes, new Date(analysisDate), 90)),
        };
      } catch {
        results[id] = { w1: null, m1: null, m3: null, entryClose: null };
      }
    })
  );

  res.json(results);
});

// ─── GET /api/market-data/earnings-calendar ───────────────────────────────────
// range=week(7일) | month(30일)  |  tickers=추가종목(쉼표구분, 옵션)
router.get("/earnings-calendar", async (req, res) => {
  try {
  const range   = (req.query.range   as string) ?? "week";
  const extra   = (req.query.tickers as string) ?? "";
  const days    = range === "month" ? 30 : 7;
  const now     = new Date();
  const rangeEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // ── 1. DB에서 최근 90일 분석 이력 종목 수집 ────────────────────────────────
  let dbRows: Array<{ ticker: string; company_name: string }> = [];
  try {
    const r = await pool.query<{ ticker: string; company_name: string }>(
      `SELECT DISTINCT ON (ticker) ticker, company_name
       FROM analyses
       WHERE created_at >= NOW() - INTERVAL '90 days'
         AND status = 'done'
       ORDER BY ticker, created_at DESC
       LIMIT 60`
    );
    dbRows = r.rows;
  } catch (e) {
    console.error("[earnings-calendar] DB error:", e);
  }

  // ── 2. 기본 주요 한국/미국 종목 보완 ──────────────────────────────────────
  const DEFAULT_KR = ["005930.KS","000660.KS","035420.KS","005380.KS","051910.KS","035720.KS","012330.KS","000270.KS"];
  const DEFAULT_US = ["AAPL","MSFT","NVDA","META","GOOG","AMZN","TSLA","AVGO"];
  const defaultTickers = [...DEFAULT_KR, ...DEFAULT_US];
  const extraTickers   = extra ? extra.split(",").map(t => t.trim()).filter(Boolean) : [];

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

  // ── 3. Yahoo Finance calendarEvents 병렬 조회 ──────────────────────────────
  interface EarningsEntry {
    ticker: string;
    companyName: string;
    earningsDate: string;
    epsEstimate: number | null;
    epsLow: number | null;
    epsHigh: number | null;
    revenueEstimate: number | null;
    currency: string;
    isKorean: boolean;
  }
  const entries: EarningsEntry[] = [];

  // 5개씩 배치 처리 (오류 격리)
  const BATCH = 5;
  for (let i = 0; i < allTickers.length; i += BATCH) {
    const batch = allTickers.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async t => {
        try {
          return await yahooFinance.quoteSummary(t, {
            modules: ["calendarEvents", "price"],
          }, { validateResult: false });
        } catch {
          return null;
        }
      })
    );

    for (let j = 0; j < batch.length; j++) {
      const ticker = batch[j];
      const r = settled[j];
      if (r.status !== "fulfilled" || !r.value) continue;
      const data = r.value as any;

      const cal   = data?.calendarEvents;
      const pr    = data?.price;
      const dates: any[] = cal?.earnings?.earningsDate ?? [];
      if (!dates.length) continue;

      // 범위 내 가장 가까운 날짜 선택
      for (const raw of dates) {
        const ts   = typeof raw === "number" ? raw * 1000 : (raw instanceof Date ? raw.getTime() : new Date(raw).getTime());
        const date = new Date(ts);
        if (date < now || date > rangeEnd) continue;

        const currency  = pr?.currency ?? (ticker.endsWith(".KS") || ticker.endsWith(".KQ") ? "KRW" : "USD");
        const isKorean  = currency === "KRW";
        const name      = nameMap[ticker] ?? pr?.shortName ?? pr?.longName ?? ticker;

        entries.push({
          ticker,
          companyName: name,
          earningsDate: date.toISOString().split("T")[0],
          epsEstimate:      cal?.earnings?.earningsAverage     ?? null,
          epsLow:           cal?.earnings?.earningsLow         ?? null,
          epsHigh:          cal?.earnings?.earningsHigh        ?? null,
          revenueEstimate:  cal?.earnings?.revenueAverage      ?? null,
          currency,
          isKorean,
        });
        break; // 첫 번째 유효 날짜만 사용
      }
    }
  }

  // ── 4. 날짜 정렬 후 응답 ─────────────────────────────────────────────────
  entries.sort((a, b) => a.earningsDate.localeCompare(b.earningsDate));
  res.json(entries);
  } catch (err: any) {
    console.error("[earnings-calendar] unhandled error:", err?.message);
    res.status(500).json({ error: err?.message ?? "earnings-calendar error" });
  }
});

router.get("/:ticker", async (req, res) => {
  const { ticker } = req.params;
  const { period = "1y", interval = "1d" } = req.query as {
    period?: string;
    interval?: string;
  };

  try {
    const periodMap: Record<string, number> = {
      "3m": 90,
      "6m": 180,
      "1y": 365,
      "2y": 730,
      "5y": 1825,
    };
    const days = periodMap[period] ?? 365;
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

    // Fetch Naver real-time data for Korean stocks (NXT price + accurate close)
    let nxtInfo: { price: number; changePercent: number; compareToPrev: string; at: string; sessionType: string; status: string } | null = null;
    let naverKrxClose: number | null = null;
    const koreanCode = resolvedSymbol.match(/^(\d{6})\.(KS|KQ)$/)?.[1];
    if (koreanCode) {
      try {
        const naverBasicRes = await fetch(
          `https://m.stock.naver.com/api/stock/${koreanCode}/basic`,
          { headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", "Referer": "https://m.stock.naver.com/" } }
        );
        if (naverBasicRes.ok) {
          const naverBasic: any = await naverBasicRes.json();
          const naverClose = naverBasic.closePrice ? Number(String(naverBasic.closePrice).replace(/,/g, "")) : null;
          if (naverClose && naverClose > 0) naverKrxClose = naverClose;
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

// GET /api/market-data/financials/:ticker — structured annual + quarterly income statement
router.get("/financials/:ticker", async (req, res) => {
  const ticker = (req.params.ticker as string).toUpperCase();
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

    const [annualRaw, quarterlyRaw] = await Promise.all([
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
    ]);

    // fundamentalsTimeSeries processResponse strips the type prefix:
    // annualTotalRevenue → totalRevenue, annualOperatingIncome → operatingIncome, etc.
    // Both annual and quarterly entries share the same field names after stripping.
    const toEntry = (e: any) => {
      const rev: number | null = e.totalRevenue ?? null;
      const opIncome: number | null = e.operatingIncome ?? null;
      const netIncome: number | null = e.netIncome ?? null;
      // date is a Unix timestamp in milliseconds in fundamentalsTimeSeries response
      const dateStr = e.date
        ? new Date(e.date).toISOString().slice(0, 7)
        : "";
      return {
        period: dateStr,
        isEstimate: false,
        revenue: rev,
        operatingIncome: opIncome,
        netIncome,
        operatingMargin: rev && opIncome != null && rev > 0 ? (opIncome / rev) * 100 : null,
      };
    };

    const annual = (Array.isArray(annualRaw) ? annualRaw : [])
      .map(toEntry)
      .filter((e: any) => e.revenue != null)
      .sort((a: any, b: any) => b.period.localeCompare(a.period));

    const quarterly = (Array.isArray(quarterlyRaw) ? quarterlyRaw : [])
      .map(toEntry)
      .filter((e: any) => e.revenue != null)
      .sort((a: any, b: any) => b.period.localeCompare(a.period))
      .slice(0, 10); // 최대 10분기

    res.json({ ticker, currency: "USD", annual, quarterly });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Failed to fetch Yahoo financials" });
  }
});

// ─── 주가 급변 이슈 분석 (Gemini + Google Search grounding) ─────────────────
router.post("/price-events", async (req, res) => {
  const { ticker, companyName, events } = req.body as {
    ticker: string;
    companyName?: string;
    events: { date: string; changePercent: number }[];
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

  const prompt = `한국 주식 종목 "${stockId}"의 주가가 아래 날짜에 크게 변동했습니다.
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

export default router;
