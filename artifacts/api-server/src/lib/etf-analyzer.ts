/**
 * ETF 분석 모듈
 * - 주요 한국 ETF 목록 및 메타데이터
 * - KRX API를 통한 ETF 구성 종목 조회
 * - 섹터 로테이션 모멘텀 스코어
 * - 타이밍 신호 (기술적 분석)
 * - 개별 종목의 ETF 노출도
 */
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const KRX_BASE = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

export interface ETFInfo {
  code: string;          // 6자리 종목코드
  isuCd: string;         // 12자리 KRX ISU 코드
  name: string;
  sector: string;
  issuer: string;        // 운용사
  yahooCode: string;     // Yahoo Finance 심볼
  leverage: number;      // 1=일반, 2=레버리지, -1=인버스
  ter?: number;          // 총보수(%)
  benchmark?: string;
}

export interface ETFHolding {
  rank: number;
  stockCode: string;
  stockName: string;
  weight: number;        // % (소수점 2자리)
  sector?: string;
}

export interface SectorScore {
  sector: string;
  score: number;         // 0~100
  return5d: number;      // %
  return20d: number;     // %
  signal: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  etfCode: string;
  etfName: string;
  price?: number;
  change1d?: number;
}

export interface TimingSignal {
  code: string;
  name: string;
  price: number;
  change1d: number;
  return5d: number;
  return20d: number;
  ma5: number;
  ma20: number;
  rsi14: number;
  signal: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  signalScore: number;   // 0~100
  reason: string;
}

// ─── 주요 ETF 목록 ────────────────────────────────────────────────────────────

export const MAJOR_ETFS: ETFInfo[] = [
  // 코스피200 계열
  { code:"069500", isuCd:"KR7069500006", name:"KODEX 200",            sector:"국내주식", issuer:"삼성자산운용", yahooCode:"069500.KS", leverage:1,  ter:0.15, benchmark:"KOSPI 200" },
  { code:"102110", isuCd:"KR7102110009", name:"TIGER 200",            sector:"국내주식", issuer:"미래에셋",    yahooCode:"102110.KS", leverage:1,  ter:0.05, benchmark:"KOSPI 200" },
  { code:"122630", isuCd:"KR7122630005", name:"KODEX 레버리지",        sector:"국내주식", issuer:"삼성자산운용", yahooCode:"122630.KS", leverage:2,  ter:0.64, benchmark:"KOSPI 200 ×2" },
  { code:"114800", isuCd:"KR7114800001", name:"KODEX 인버스",          sector:"국내주식", issuer:"삼성자산운용", yahooCode:"114800.KS", leverage:-1, ter:0.64, benchmark:"KOSPI 200 ×-1" },
  // 코스닥
  { code:"229200", isuCd:"KR7229200000", name:"KODEX 코스닥150",       sector:"코스닥",   issuer:"삼성자산운용", yahooCode:"229200.KS", leverage:1,  ter:0.15, benchmark:"KOSDAQ 150" },
  { code:"233740", isuCd:"KR7233740006", name:"KODEX 코스닥150레버리지", sector:"코스닥",   issuer:"삼성자산운용", yahooCode:"233740.KS", leverage:2,  ter:0.64, benchmark:"KOSDAQ 150 ×2" },
  // 반도체
  { code:"091160", isuCd:"KR7091160007", name:"KODEX 반도체",          sector:"반도체",   issuer:"삼성자산운용", yahooCode:"091160.KS", leverage:1,  ter:0.45, benchmark:"KRX 반도체" },
  { code:"381180", isuCd:"KR7381180009", name:"TIGER KRX반도체15",     sector:"반도체",   issuer:"미래에셋",    yahooCode:"381180.KS", leverage:1,  ter:0.40, benchmark:"KRX 반도체15" },
  // 2차전지
  { code:"305720", isuCd:"KR7305720003", name:"KODEX 2차전지산업",     sector:"2차전지",  issuer:"삼성자산운용", yahooCode:"305720.KS", leverage:1,  ter:0.45, benchmark:"KRX 2차전지" },
  { code:"305540", isuCd:"KR7305540005", name:"TIGER 2차전지테마",     sector:"2차전지",  issuer:"미래에셋",    yahooCode:"305540.KS", leverage:1,  ter:0.40, benchmark:"KRX 2차전지테마" },
  // 헬스케어
  { code:"143460", isuCd:"KR7143460000", name:"TIGER 헬스케어",        sector:"헬스케어", issuer:"미래에셋",    yahooCode:"143460.KS", leverage:1,  ter:0.40, benchmark:"KRX 헬스케어" },
  { code:"266410", isuCd:"KR7266410003", name:"KODEX 헬스케어",        sector:"헬스케어", issuer:"삼성자산운용", yahooCode:"266410.KS", leverage:1,  ter:0.45, benchmark:"KRX 헬스케어" },
  // 금융
  { code:"139270", isuCd:"KR7139270002", name:"KODEX 금융",            sector:"금융",     issuer:"삼성자산운용", yahooCode:"139270.KS", leverage:1,  ter:0.45, benchmark:"KRX 금융" },
  // IT
  { code:"091220", isuCd:"KR7091220009", name:"KODEX IT",              sector:"IT",       issuer:"삼성자산운용", yahooCode:"091220.KS", leverage:1,  ter:0.45, benchmark:"KRX IT" },
  // 해외
  { code:"133690", isuCd:"KR7133690005", name:"TIGER 미국나스닥100",   sector:"해외주식", issuer:"미래에셋",    yahooCode:"133690.KS", leverage:1,  ter:0.07, benchmark:"NASDAQ 100" },
  { code:"379800", isuCd:"KR7379800005", name:"KODEX 미국S&P500TR",    sector:"해외주식", issuer:"삼성자산운용", yahooCode:"379800.KS", leverage:1,  ter:0.05, benchmark:"S&P 500 TR" },
  { code:"195930", isuCd:"KR7195930004", name:"TIGER 유로스탁스50",    sector:"해외주식", issuer:"미래에셋",    yahooCode:"195930.KS", leverage:1,  ter:0.40, benchmark:"EURO STOXX 50" },
  // 배당
  { code:"292150", isuCd:"KR7292150002", name:"TIGER KRX고배당",       sector:"배당",     issuer:"미래에셋",    yahooCode:"292150.KS", leverage:1,  ter:0.29, benchmark:"KRX 고배당50" },
  { code:"280930", isuCd:"KR7280930004", name:"KODEX 배당성장",        sector:"배당",     issuer:"삼성자산운용", yahooCode:"280930.KS", leverage:1,  ter:0.30, benchmark:"FnGuide 배당성장50" },
];

// ─── 정적 폴백 보유 종목 (KRX API 실패 시) ───────────────────────────────────

const STATIC_HOLDINGS: Record<string, ETFHolding[]> = {
  "069500": [ // KODEX 200
    { rank:1,  stockCode:"005930", stockName:"삼성전자",          weight:30.52 },
    { rank:2,  stockCode:"000660", stockName:"SK하이닉스",         weight:7.18  },
    { rank:3,  stockCode:"373220", stockName:"LG에너지솔루션",     weight:4.21  },
    { rank:4,  stockCode:"207940", stockName:"삼성바이오로직스",   weight:3.62  },
    { rank:5,  stockCode:"005380", stockName:"현대차",             weight:2.98  },
    { rank:6,  stockCode:"068270", stockName:"셀트리온",           weight:2.54  },
    { rank:7,  stockCode:"005490", stockName:"POSCO홀딩스",        weight:2.11  },
    { rank:8,  stockCode:"105560", stockName:"KB금융",             weight:2.05  },
    { rank:9,  stockCode:"055550", stockName:"신한지주",           weight:1.87  },
    { rank:10, stockCode:"035420", stockName:"NAVER",              weight:1.72  },
    { rank:11, stockCode:"000270", stockName:"기아",               weight:1.68  },
    { rank:12, stockCode:"051910", stockName:"LG화학",             weight:1.42  },
    { rank:13, stockCode:"003550", stockName:"LG",                 weight:1.38  },
    { rank:14, stockCode:"028260", stockName:"삼성물산",           weight:1.31  },
    { rank:15, stockCode:"086790", stockName:"하나금융지주",       weight:1.22  },
  ],
  "091160": [ // KODEX 반도체
    { rank:1,  stockCode:"005930", stockName:"삼성전자",           weight:43.20 },
    { rank:2,  stockCode:"000660", stockName:"SK하이닉스",          weight:24.81 },
    { rank:3,  stockCode:"009150", stockName:"삼성전기",            weight:5.12  },
    { rank:4,  stockCode:"058470", stockName:"리노공업",            weight:3.41  },
    { rank:5,  stockCode:"000990", stockName:"DB하이텍",            weight:2.87  },
    { rank:6,  stockCode:"036830", stockName:"솔브레인홀딩스",      weight:2.54  },
    { rank:7,  stockCode:"240810", stockName:"원익IPS",             weight:2.21  },
    { rank:8,  stockCode:"131970", stockName:"두산테스나",          weight:2.18  },
    { rank:9,  stockCode:"018260", stockName:"삼성에스디에스",      weight:1.95  },
    { rank:10, stockCode:"012450", stockName:"한화에어로스페이스",   weight:1.72  },
  ],
  "305720": [ // KODEX 2차전지산업
    { rank:1,  stockCode:"373220", stockName:"LG에너지솔루션",      weight:25.41 },
    { rank:2,  stockCode:"051910", stockName:"LG화학",              weight:14.32 },
    { rank:3,  stockCode:"006400", stockName:"삼성SDI",             weight:12.87 },
    { rank:4,  stockCode:"247540", stockName:"에코프로비엠",        weight:8.54  },
    { rank:5,  stockCode:"086520", stockName:"에코프로",            weight:6.21  },
    { rank:6,  stockCode:"003670", stockName:"포스코퓨처엠",        weight:5.87  },
    { rank:7,  stockCode:"028670", stockName:"팬오션",              weight:3.21  },
    { rank:8,  stockCode:"259960", stockName:"크래프톤",            weight:2.98  },
    { rank:9,  stockCode:"011970", stockName:"STX엔진",             weight:2.41  },
    { rank:10, stockCode:"298040", stockName:"효성중공업",          weight:2.18  },
  ],
  "143460": [ // TIGER 헬스케어
    { rank:1,  stockCode:"207940", stockName:"삼성바이오로직스",    weight:25.41 },
    { rank:2,  stockCode:"068270", stockName:"셀트리온",            weight:22.87 },
    { rank:3,  stockCode:"326030", stockName:"SK바이오팜",          weight:7.54  },
    { rank:4,  stockCode:"145020", stockName:"휴젤",                weight:5.21  },
    { rank:5,  stockCode:"091990", stockName:"셀트리온헬스케어",    weight:4.87  },
    { rank:6,  stockCode:"128940", stockName:"한미약품",            weight:4.32  },
    { rank:7,  stockCode:"000100", stockName:"유한양행",            weight:3.98  },
    { rank:8,  stockCode:"185750", stockName:"종근당",              weight:3.54  },
    { rank:9,  stockCode:"009290", stockName:"광동제약",            weight:2.87  },
    { rank:10, stockCode:"214150", stockName:"클래시스",            weight:2.41  },
  ],
  "133690": [ // TIGER 미국나스닥100
    { rank:1,  stockCode:"MSFT",   stockName:"Microsoft",           weight:12.31 },
    { rank:2,  stockCode:"AAPL",   stockName:"Apple",               weight:11.87 },
    { rank:3,  stockCode:"NVDA",   stockName:"NVIDIA",              weight:8.54  },
    { rank:4,  stockCode:"AMZN",   stockName:"Amazon",              weight:6.21  },
    { rank:5,  stockCode:"META",   stockName:"Meta",                weight:5.87  },
    { rank:6,  stockCode:"GOOGL",  stockName:"Alphabet A",          weight:4.54  },
    { rank:7,  stockCode:"GOOG",   stockName:"Alphabet C",          weight:4.21  },
    { rank:8,  stockCode:"TSLA",   stockName:"Tesla",               weight:3.87  },
    { rank:9,  stockCode:"AVGO",   stockName:"Broadcom",            weight:3.41  },
    { rank:10, stockCode:"COST",   stockName:"Costco",              weight:2.87  },
  ],
  "379800": [ // KODEX 미국S&P500TR
    { rank:1,  stockCode:"MSFT",   stockName:"Microsoft",           weight:7.12  },
    { rank:2,  stockCode:"AAPL",   stockName:"Apple",               weight:6.98  },
    { rank:3,  stockCode:"NVDA",   stockName:"NVIDIA",              weight:5.87  },
    { rank:4,  stockCode:"AMZN",   stockName:"Amazon",              weight:3.54  },
    { rank:5,  stockCode:"META",   stockName:"Meta",                weight:3.21  },
    { rank:6,  stockCode:"GOOGL",  stockName:"Alphabet A",          weight:2.87  },
    { rank:7,  stockCode:"GOOG",   stockName:"Alphabet C",          weight:2.41  },
    { rank:8,  stockCode:"BRK.B",  stockName:"Berkshire Hathaway",  weight:2.18  },
    { rank:9,  stockCode:"AVGO",   stockName:"Broadcom",            weight:2.05  },
    { rank:10, stockCode:"LLY",    stockName:"Eli Lilly",           weight:1.87  },
  ],
};

// ─── 캐시 ─────────────────────────────────────────────────────────────────────

const holdingsCache = new Map<string, { data: ETFHolding[]; ts: number }>();
const priceCache    = new Map<string, { prices: number[]; ts: number }>();
const HOLDINGS_TTL  = 6 * 3600_000;
const PRICE_TTL     = 30 * 60_000;

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function todayKst(): string {
  const d = new Date(Date.now() + 9 * 3600_000);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchPrices(yahooCode: string, days = 60): Promise<number[]> {
  const cached = priceCache.get(yahooCode);
  if (cached && Date.now() - cached.ts < PRICE_TTL) return cached.prices;

  try {
    const period1 = new Date(Date.now() - (days + 10) * 86400_000);
    const chart = await (yf as any).chart(yahooCode, {
      period1: period1.toISOString().slice(0, 10),
      interval: "1d",
    });
    const prices: number[] = (chart?.quotes ?? [])
      .map((q: any) => q?.close)
      .filter((v: any) => typeof v === "number" && v > 0)
      .slice(-days);

    priceCache.set(yahooCode, { prices, ts: Date.now() });
    return prices;
  } catch {
    return [];
  }
}

function calcRsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function toSignal(score: number): TimingSignal["signal"] {
  if (score >= 70) return "strong_buy";
  if (score >= 55) return "buy";
  if (score >= 40) return "hold";
  if (score >= 25) return "sell";
  return "strong_sell";
}

function normalize(val: number, min: number, max: number): number {
  if (max === min) return 50;
  return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
}

// ─── KRX ETF 구성 종목 조회 ───────────────────────────────────────────────────

async function krxFetchHoldings(isuCd: string): Promise<ETFHolding[]> {
  const trdDd = todayKst();
  try {
    const params = new URLSearchParams({
      bld:         "dbms/MDC/STAT/standard/MDCSTAT05401",
      locale:      "ko_KR",
      isuCd,
      trdDd,
      share:       "1",
      money:       "1",
      csvxls_isNo: "false",
    });
    const res = await fetch(`${KRX_BASE}?${params.toString()}`, {
      headers: {
        "User-Agent":        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer":           "http://data.krx.co.kr/contents/MDC/STAT/standard/MDCSTAT05401",
        "Accept":            "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With":  "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    const rows: any[] = json?.output ?? [];
    if (!rows.length) return [];

    return rows.slice(0, 20).map((r: any, i: number) => ({
      rank:      i + 1,
      stockCode: String(r.ISU_CD ?? r.MKT_NM ?? "").replace(/^A/, ""),
      stockName: String(r.ISU_ABBRV ?? r.ISU_NM ?? ""),
      weight:    parseFloat(String(r.COMPST_RTO ?? r.WGTSTKQTY ?? 0)) || 0,
    }));
  } catch {
    return [];
  }
}

// ─── 공개 API ─────────────────────────────────────────────────────────────────

/** ETF 구성 종목 조회 (KRX 우선, 정적 폴백) */
export async function getEtfHoldings(code: string): Promise<ETFHolding[]> {
  const cached = holdingsCache.get(code);
  if (cached && Date.now() - cached.ts < HOLDINGS_TTL) return cached.data;

  const etf = MAJOR_ETFS.find(e => e.code === code);
  if (!etf) return STATIC_HOLDINGS[code] ?? [];

  const live = await krxFetchHoldings(etf.isuCd);
  const data = live.length >= 3 ? live : (STATIC_HOLDINGS[code] ?? live);
  holdingsCache.set(code, { data, ts: Date.now() });
  return data;
}

/** ETF 검색 */
export function searchEtf(query: string): ETFInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return MAJOR_ETFS;
  return MAJOR_ETFS.filter(e =>
    e.code.includes(q) || e.name.toLowerCase().includes(q) ||
    e.sector.toLowerCase().includes(q) || e.issuer.toLowerCase().includes(q)
  );
}

/** 종목 → 포함된 ETF 목록 */
export async function getStockExposure(
  query: string,
): Promise<{ etf: ETFInfo; holding: ETFHolding }[]> {
  const q = query.trim().replace(/^A/, "");
  // 주요 ETF들의 보유 종목 병렬 조회 (캐시 활용)
  const results = await Promise.allSettled(
    MAJOR_ETFS.map(async etf => {
      const holdings = await getEtfHoldings(etf.code);
      return { etf, holdings };
    })
  );

  const found: { etf: ETFInfo; holding: ETFHolding }[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { etf, holdings } = r.value;
    const match = holdings.find(h =>
      h.stockCode.toLowerCase() === q.toLowerCase() ||
      h.stockName.includes(q) ||
      h.stockName.toLowerCase() === q.toLowerCase()
    );
    if (match) found.push({ etf, holding: match });
  }
  return found.sort((a, b) => b.holding.weight - a.holding.weight);
}

/** 섹터 로테이션 스코어 */
export async function getSectorRotation(): Promise<SectorScore[]> {
  const sectorMap: Record<string, string> = {
    "국내주식": "069500", "코스닥": "229200", "반도체": "091160",
    "2차전지": "305720", "헬스케어": "143460", "금융": "139270",
    "IT": "091220",      "해외주식": "133690",  "배당": "292150",
  };

  const rows = await Promise.allSettled(
    Object.entries(sectorMap).map(async ([sector, code]) => {
      const etf = MAJOR_ETFS.find(e => e.code === code)!;
      const prices = await fetchPrices(etf.yahooCode, 30);
      if (prices.length < 6) return null;

      const last     = prices[prices.length - 1];
      const prev1    = prices[prices.length - 2] ?? last;
      const prev5    = prices[prices.length - 6] ?? prices[0];
      const prev20   = prices[prices.length - 21] ?? prices[0];

      const ret5d    = ((last / prev5)  - 1) * 100;
      const ret20d   = ((last / prev20) - 1) * 100;
      const ret1d    = ((last / prev1)  - 1) * 100;

      return { sector, code, etfName: etf.name, ret5d, ret20d, ret1d, price: last };
    })
  );

  const valid = rows
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => (r as any).value);

  if (!valid.length) return [];

  const scores5d  = valid.map((v: any) => v.ret5d);
  const scores20d = valid.map((v: any) => v.ret20d);
  const min5  = Math.min(...scores5d),  max5  = Math.max(...scores5d);
  const min20 = Math.min(...scores20d), max20 = Math.max(...scores20d);

  return valid.map((v: any) => {
    const s5  = normalize(v.ret5d, min5, max5);
    const s20 = normalize(v.ret20d, min20, max20);
    const score = Math.round(s5 * 0.6 + s20 * 0.4);
    return {
      sector:   v.sector,
      score,
      return5d:  Math.round(v.ret5d  * 100) / 100,
      return20d: Math.round(v.ret20d * 100) / 100,
      signal:    toSignal(score),
      etfCode:   v.code,
      etfName:   v.etfName,
      price:     Math.round(v.price),
      change1d:  Math.round(v.ret1d * 100) / 100,
    } as SectorScore;
  }).sort((a, b) => b.score - a.score);
}

/** 주요 ETF 타이밍 신호 */
export async function getTimingSignals(): Promise<TimingSignal[]> {
  const targets = MAJOR_ETFS.filter(e =>
    ["069500","229200","091160","305720","143460","133690","379800","122630","114800"].includes(e.code)
  );

  const rows = await Promise.allSettled(
    targets.map(async etf => {
      const prices = await fetchPrices(etf.yahooCode, 60);
      if (prices.length < 22) return null;

      const n    = prices.length;
      const last = prices[n - 1];
      const p1   = prices[n - 2] ?? last;
      const p5   = prices[n - 6] ?? prices[0];
      const p20  = prices[n - 21] ?? prices[0];

      const ret1d  = ((last / p1)  - 1) * 100;
      const ret5d  = ((last / p5)  - 1) * 100;
      const ret20d = ((last / p20) - 1) * 100;
      const ma5    = prices.slice(-5).reduce((s, v) => s + v, 0) / 5;
      const ma20   = prices.slice(-20).reduce((s, v) => s + v, 0) / 20;
      const rsi    = calcRsi(prices);

      const maDist   = ((last / ma20) - 1) * 100;
      const maCross  = ma5 > ma20 ? 1 : -1;

      // 종합 점수
      const scoreRet  = normalize(ret20d, -20, 20) * 0.35;
      const scoreMom  = normalize(ret5d,  -10, 10) * 0.30;
      const scoreRsi  = normalize(rsi,    20,  80) * 0.20;
      const scoreMa   = (maCross > 0 ? 1 : 0) * 15;
      const signalScore = Math.round(scoreRet + scoreMom + scoreRsi + scoreMa);

      let reason = "";
      if (ret20d > 5)    reason += "20일 강한 상승 모멘텀. ";
      if (ret5d > 3)     reason += "5일 단기 상승세. ";
      if (rsi > 70)      reason += "RSI 과매수 구간. ";
      if (rsi < 30)      reason += "RSI 과매도 — 반등 주목. ";
      if (maCross > 0)   reason += "단기MA > 장기MA 골든크로스. ";
      if (maCross < 0)   reason += "단기MA < 장기MA 데드크로스. ";
      if (maDist < -5)   reason += "20일선 크게 하회, 과매도권. ";
      if (!reason)       reason = "특이 신호 없음. 시장 방향 확인 권장.";

      return {
        code:         etf.code,
        name:         etf.name,
        price:        Math.round(last),
        change1d:     Math.round(ret1d  * 100) / 100,
        return5d:     Math.round(ret5d  * 100) / 100,
        return20d:    Math.round(ret20d * 100) / 100,
        ma5:          Math.round(ma5),
        ma20:         Math.round(ma20),
        rsi14:        rsi,
        signal:       toSignal(signalScore),
        signalScore,
        reason:       reason.trim(),
      } as TimingSignal;
    })
  );

  return rows
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => (r as any).value)
    .sort((a, b) => b.signalScore - a.signalScore);
}
