/**
 * ETF 분석 모듈
 * - 주요 한국 ETF 목록 및 메타데이터
 * - KRX API를 통한 ETF 구성 종목 조회
 * - 섹터 로테이션 모멘텀 스코어
 * - 타이밍 신호 (기술적 분석)
 * - 개별 종목의 ETF 노출도
 */
import YahooFinance from "yahoo-finance2";
import { getKisAccessToken } from "./kis-client.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const KRX_BASE = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const KIS_BASE = "https://openapi.koreainvestment.com:9443";

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

export interface UnifiedSignal {
  code: string;
  name: string;
  sector: string;
  issuer: string;
  leverage: number;
  price: number;
  change1d: number;
  return5d: number;
  return20d: number;
  rsi14: number;
  ma5: number;
  ma20: number;
  techScore: number;      // 0-100 기술적 점수 (55% 가중)
  sectorRank: number;     // 0-100 섹터 상대강도 (25% 가중)
  aiScore: number;        // 0-100 AI 방향 반영 (20% 가중)
  aiBonus: number;        // -20 ~ +20 AI 보정 포인트
  combinedScore: number;  // 0-100 종합 점수
  signal: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  aiDirection: "up" | "down" | "neutral";
  aiStrength: number;     // 0-1
  reason: string;
}

export interface AiMarketInput {
  kospi: { direction: "up" | "down" | "neutral"; strength: number };
  nasdaq: { direction: "up" | "down" | "neutral"; strength: number };
}

// ─── 주요 ETF 목록 ────────────────────────────────────────────────────────────

export const MAJOR_ETFS: ETFInfo[] = [
  // 코스피200 계열
  { code:"069500", isuCd:"KR7069500006", name:"KODEX 200",              sector:"국내주식", issuer:"삼성자산운용", yahooCode:"069500.KS", leverage:1,  ter:0.15, benchmark:"KOSPI 200" },
  { code:"102110", isuCd:"KR7102110009", name:"TIGER 200",              sector:"국내주식", issuer:"미래에셋",    yahooCode:"102110.KS", leverage:1,  ter:0.05, benchmark:"KOSPI 200" },
  { code:"122630", isuCd:"KR7122630005", name:"KODEX 레버리지",          sector:"국내주식", issuer:"삼성자산운용", yahooCode:"122630.KS", leverage:2,  ter:0.64, benchmark:"KOSPI 200 ×2" },
  { code:"114800", isuCd:"KR7114800001", name:"KODEX 인버스",            sector:"국내주식", issuer:"삼성자산운용", yahooCode:"114800.KS", leverage:-1, ter:0.64, benchmark:"KOSPI 200 ×-1" },
  { code:"252670", isuCd:"KR7252670001", name:"KODEX 200선물인버스2X",   sector:"국내주식", issuer:"삼성자산운용", yahooCode:"252670.KS", leverage:-2, ter:0.64, benchmark:"KOSPI 200 ×-2" },
  // 코스닥
  { code:"229200", isuCd:"KR7229200000", name:"KODEX 코스닥150",         sector:"코스닥",   issuer:"삼성자산운용", yahooCode:"229200.KS", leverage:1,  ter:0.15, benchmark:"KOSDAQ 150" },
  { code:"233740", isuCd:"KR7233740006", name:"KODEX 코스닥150레버리지", sector:"코스닥",   issuer:"삼성자산운용", yahooCode:"233740.KS", leverage:2,  ter:0.64, benchmark:"KOSDAQ 150 ×2" },
  // 반도체
  { code:"091160", isuCd:"KR7091160007", name:"KODEX 반도체",            sector:"반도체",   issuer:"삼성자산운용", yahooCode:"091160.KS", leverage:1,  ter:0.45, benchmark:"KRX 반도체" },
  { code:"381180", isuCd:"KR7381180009", name:"TIGER KRX반도체15",       sector:"반도체",   issuer:"미래에셋",    yahooCode:"381180.KS", leverage:1,  ter:0.40, benchmark:"KRX 반도체15" },
  { code:"395160", isuCd:"KR7395160003", name:"KODEX AI반도체TOP2플러스", sector:"반도체",   issuer:"삼성자산운용", yahooCode:"395160.KS", leverage:1,  ter:0.45, benchmark:"KODEX AI반도체TOP2+" },
  // 2차전지
  { code:"305720", isuCd:"KR7305720003", name:"KODEX 2차전지산업",       sector:"2차전지",  issuer:"삼성자산운용", yahooCode:"305720.KS", leverage:1,  ter:0.45, benchmark:"KRX 2차전지" },
  { code:"305540", isuCd:"KR7305540005", name:"TIGER 2차전지테마",       sector:"2차전지",  issuer:"미래에셋",    yahooCode:"305540.KS", leverage:1,  ter:0.40, benchmark:"KRX 2차전지테마" },
  // 헬스케어 — 266420 = KODEX 헬스케어 (정정: 266410은 KODEX 필수소비재)
  { code:"143460", isuCd:"KR7143460000", name:"TIGER 헬스케어",          sector:"헬스케어", issuer:"미래에셋",    yahooCode:"143460.KS", leverage:1,  ter:0.40, benchmark:"KRX 헬스케어" },
  { code:"266420", isuCd:"KR7266420002", name:"KODEX 헬스케어",          sector:"헬스케어", issuer:"삼성자산운용", yahooCode:"266420.KS", leverage:1,  ter:0.45, benchmark:"KRX 헬스케어" },
  // 금융
  { code:"139270", isuCd:"KR7139270002", name:"TIGER MSCI Korea TR",    sector:"금융",     issuer:"미래에셋",    yahooCode:"139270.KS", leverage:1,  ter:0.09, benchmark:"MSCI Korea TR" },
  // IT — 266370 = KODEX IT (정정: 091220은 폐지)
  { code:"266370", isuCd:"KR7266370001", name:"KODEX IT",               sector:"IT",       issuer:"삼성자산운용", yahooCode:"266370.KS", leverage:1,  ter:0.45, benchmark:"KRX IT" },
  // 삼성그룹
  { code:"102780", isuCd:"KR7102780009", name:"KODEX 삼성그룹",          sector:"국내주식", issuer:"삼성자산운용", yahooCode:"102780.KS", leverage:1,  ter:0.45, benchmark:"FnGuide 삼성그룹" },
  // 코리아밸류업
  { code:"495850", isuCd:"KR7495850001", name:"KODEX 코리아밸류업",      sector:"국내주식", issuer:"삼성자산운용", yahooCode:"495850.KS", leverage:1,  ter:0.15, benchmark:"KRX 코리아밸류업" },
  // 해외
  { code:"133690", isuCd:"KR7133690005", name:"TIGER 미국나스닥100",     sector:"해외주식", issuer:"미래에셋",    yahooCode:"133690.KS", leverage:1,  ter:0.07, benchmark:"NASDAQ 100" },
  { code:"379800", isuCd:"KR7379800005", name:"KODEX 미국S&P500TR",      sector:"해외주식", issuer:"삼성자산운용", yahooCode:"379800.KS", leverage:1,  ter:0.05, benchmark:"S&P 500 TR" },
  { code:"379810", isuCd:"KR7379810004", name:"KODEX 미국나스닥100TR",   sector:"해외주식", issuer:"삼성자산운용", yahooCode:"379810.KS", leverage:1,  ter:0.05, benchmark:"NASDAQ 100 TR" },
  { code:"195930", isuCd:"KR7195930004", name:"TIGER 유로스탁스50",      sector:"해외주식", issuer:"미래에셋",    yahooCode:"195930.KS", leverage:1,  ter:0.40, benchmark:"EURO STOXX 50" },
  // 배당 — 211900 = KODEX 코리아배당성장 (정정: 280930은 KODEX 미국러셀2000)
  { code:"292150", isuCd:"KR7292150002", name:"TIGER KRX고배당",         sector:"배당",     issuer:"미래에셋",    yahooCode:"292150.KS", leverage:1,  ter:0.29, benchmark:"KRX 고배당50" },
  { code:"211900", isuCd:"KR7211900006", name:"KODEX 코리아배당성장",    sector:"배당",     issuer:"삼성자산운용", yahooCode:"211900.KS", leverage:1,  ter:0.30, benchmark:"FnGuide 코리아배당성장" },
  // 원자재 — 금
  { code:"132030", isuCd:"KR7132030006", name:"KODEX 골드선물(H)",       sector:"원자재",   issuer:"삼성자산운용", yahooCode:"132030.KS", leverage:1,  ter:0.68, benchmark:"S&P GSCI Gold" },
  { code:"319640", isuCd:"KR7319640002", name:"TIGER 골드선물(H)",       sector:"원자재",   issuer:"미래에셋",    yahooCode:"319640.KS", leverage:1,  ter:0.39, benchmark:"S&P GSCI Gold" },
  // 원자재 — 원유
  { code:"261220", isuCd:"KR7261220003", name:"KODEX WTI원유선물(H)",    sector:"원자재",   issuer:"삼성자산운용", yahooCode:"261220.KS", leverage:1,  ter:0.35, benchmark:"S&P GSCI Crude Oil" },
  { code:"217700", isuCd:"KR7217700005", name:"TIGER 원유선물Enhanced(H)", sector:"원자재", issuer:"미래에셋",    yahooCode:"217700.KS", leverage:1,  ter:0.49, benchmark:"WTI 원유선물" },
  // 원자재 — 은·기타
  { code:"144600", isuCd:"KR7144600000", name:"KODEX 은선물(H)",         sector:"원자재",   issuer:"삼성자산운용", yahooCode:"144600.KS", leverage:1,  ter:0.68, benchmark:"S&P GSCI Silver" },
  { code:"160480", isuCd:"KR7160480000", name:"KODEX 콩선물(H)",         sector:"원자재",   issuer:"삼성자산운용", yahooCode:"160480.KS", leverage:1,  ter:0.45, benchmark:"S&P GSCI Soybeans" },
  { code:"171018", isuCd:"KR7171018001", name:"KODEX 천연가스선물(H)",   sector:"원자재",   issuer:"삼성자산운용", yahooCode:"171018.KS", leverage:1,  ter:0.35, benchmark:"S&P GSCI Natural Gas" },
];

// ─── Samsung Fund fId 매핑 (모바일 API용) ────────────────────────────────────
// m.samsungfund.com/api/v1/kodex/product-pdf/{fId}.do?gijunYMD=YYYY.MM.DD

const SF_FID_MAP: Record<string, string> = {
  "069500": "2ETF01", "091160": "2ETF07", "305720": "2ETFB1",
  "266420": "2ETF78", "266370": "2ETF82", "211900": "2ETF46",
  "229200": "2ETF54", "122630": "2ETF25", "114800": "2ETF20",
  "379800": "2ETFE4", "379810": "2ETFE3", "102780": "2ETF14",
  "132030": "2ETF24", "144600": "2ETF32", "261220": "2ETF72",
  "233740": "2ETF56", "252670": "2ETF70", "495850": "2ETFP2",
  "226490": "2ETF52", "395160": "2ETFE9",
};

// ─── 정적 폴백 보유 종목 — Samsung Fund product-pdf 실시간 수집 (2026-05-22) ──

const STATIC_HOLDINGS: Record<string, ETFHolding[]> = {
  // ── KODEX 200 (069500) — KOSPI 200, 201종목 ────────────────────────────────
  "069500": [
    { rank: 1, stockCode:"005930", stockName:"삼성전자",           weight:34.04 },
    { rank: 2, stockCode:"000660", stockName:"SK하이닉스",          weight:26.19 },
    { rank: 3, stockCode:"402340", stockName:"SK스퀘어",           weight: 2.65 },
    { rank: 4, stockCode:"005380", stockName:"현대차",              weight: 2.21 },
    { rank: 5, stockCode:"009150", stockName:"삼성전기",            weight: 1.64 },
    { rank: 6, stockCode:"105560", stockName:"KB금융",              weight: 1.22 },
    { rank: 7, stockCode:"034020", stockName:"두산에너빌리티",      weight: 1.15 },
    { rank: 8, stockCode:"012330", stockName:"현대모비스",          weight: 1.02 },
    { rank: 9, stockCode:"000270", stockName:"기아",                weight: 1.00 },
    { rank:10, stockCode:"012450", stockName:"한화에어로스페이스",  weight: 0.99 },
    { rank:11, stockCode:"028260", stockName:"삼성물산",            weight: 0.98 },
    { rank:12, stockCode:"055550", stockName:"신한지주",            weight: 0.95 },
    { rank:13, stockCode:"006400", stockName:"삼성SDI",             weight: 0.92 },
    { rank:14, stockCode:"086790", stockName:"하나금융지주",        weight: 0.74 },
    { rank:15, stockCode:"032830", stockName:"삼성생명",            weight: 0.74 },
  ],
  // ── TIGER 200 (102110) — KOSPI 200 추종 (KODEX 200과 동일 지수) ───────────
  "102110": [
    { rank: 1, stockCode:"005930", stockName:"삼성전자",           weight:34.04 },
    { rank: 2, stockCode:"000660", stockName:"SK하이닉스",          weight:26.19 },
    { rank: 3, stockCode:"402340", stockName:"SK스퀘어",           weight: 2.65 },
    { rank: 4, stockCode:"005380", stockName:"현대차",              weight: 2.21 },
    { rank: 5, stockCode:"009150", stockName:"삼성전기",            weight: 1.64 },
    { rank: 6, stockCode:"105560", stockName:"KB금융",              weight: 1.22 },
    { rank: 7, stockCode:"034020", stockName:"두산에너빌리티",      weight: 1.15 },
    { rank: 8, stockCode:"012330", stockName:"현대모비스",          weight: 1.02 },
    { rank: 9, stockCode:"000270", stockName:"기아",                weight: 1.00 },
    { rank:10, stockCode:"012450", stockName:"한화에어로스페이스",  weight: 0.99 },
    { rank:11, stockCode:"028260", stockName:"삼성물산",            weight: 0.98 },
    { rank:12, stockCode:"055550", stockName:"신한지주",            weight: 0.95 },
    { rank:13, stockCode:"006400", stockName:"삼성SDI",             weight: 0.92 },
    { rank:14, stockCode:"086790", stockName:"하나금융지주",        weight: 0.74 },
    { rank:15, stockCode:"032830", stockName:"삼성생명",            weight: 0.74 },
  ],
  // ── KODEX 반도체 (091160) — KRX 반도체, 36종목 ────────────────────────────
  "091160": [
    { rank: 1, stockCode:"000660", stockName:"SK하이닉스",          weight:34.42 },
    { rank: 2, stockCode:"005930", stockName:"삼성전자",            weight:21.77 },
    { rank: 3, stockCode:"042700", stockName:"한미반도체",          weight: 7.54 },
    { rank: 4, stockCode:"036930", stockName:"주성엔지니어링",      weight: 3.12 },
    { rank: 5, stockCode:"000990", stockName:"DB하이텍",            weight: 2.98 },
    { rank: 6, stockCode:"058470", stockName:"리노공업",            weight: 2.79 },
    { rank: 7, stockCode:"039030", stockName:"이오테크닉스",        weight: 2.48 },
    { rank: 8, stockCode:"440110", stockName:"파두",                weight: 2.27 },
    { rank: 9, stockCode:"240810", stockName:"원익IPS",             weight: 2.23 },
    { rank:10, stockCode:"080220", stockName:"제주반도체",          weight: 1.93 },
    { rank:11, stockCode:"222800", stockName:"심텍",                weight: 1.67 },
    { rank:12, stockCode:"067310", stockName:"하나마이크론",        weight: 1.41 },
    { rank:13, stockCode:"403870", stockName:"HPSP",               weight: 1.33 },
    { rank:14, stockCode:"095340", stockName:"ISC",                 weight: 1.21 },
    { rank:15, stockCode:"319660", stockName:"피에스케이",          weight: 1.17 },
  ],
  // ── TIGER KRX반도체15 (381180) — KRX 반도체 TOP15 ─────────────────────────
  "381180": [
    { rank: 1, stockCode:"000660", stockName:"SK하이닉스",          weight:35.10 },
    { rank: 2, stockCode:"005930", stockName:"삼성전자",            weight:22.40 },
    { rank: 3, stockCode:"042700", stockName:"한미반도체",          weight: 8.20 },
    { rank: 4, stockCode:"009150", stockName:"삼성전기",            weight: 5.30 },
    { rank: 5, stockCode:"058470", stockName:"리노공업",            weight: 3.80 },
    { rank: 6, stockCode:"039030", stockName:"이오테크닉스",        weight: 3.20 },
    { rank: 7, stockCode:"000990", stockName:"DB하이텍",            weight: 2.90 },
    { rank: 8, stockCode:"240810", stockName:"원익IPS",             weight: 2.50 },
    { rank: 9, stockCode:"403870", stockName:"HPSP",               weight: 2.30 },
    { rank:10, stockCode:"036930", stockName:"주성엔지니어링",      weight: 2.10 },
    { rank:11, stockCode:"095340", stockName:"ISC",                 weight: 1.90 },
    { rank:12, stockCode:"222800", stockName:"심텍",                weight: 1.60 },
    { rank:13, stockCode:"440110", stockName:"파두",                weight: 1.50 },
    { rank:14, stockCode:"067310", stockName:"하나마이크론",        weight: 1.40 },
    { rank:15, stockCode:"319660", stockName:"피에스케이",          weight: 1.20 },
  ],
  // ── KODEX 2차전지산업 (305720) — KRX 2차전지, 26종목 ──────────────────────
  "305720": [
    { rank: 1, stockCode:"006400", stockName:"삼성SDI",             weight:20.41 },
    { rank: 2, stockCode:"373220", stockName:"LG에너지솔루션",      weight:18.44 },
    { rank: 3, stockCode:"005490", stockName:"POSCO홀딩스",         weight:13.41 },
    { rank: 4, stockCode:"247540", stockName:"에코프로비엠",        weight:10.75 },
    { rank: 5, stockCode:"051910", stockName:"LG화학",              weight: 9.24 },
    { rank: 6, stockCode:"086520", stockName:"에코프로",            weight: 7.01 },
    { rank: 7, stockCode:"003670", stockName:"포스코퓨처엠",        weight: 5.25 },
    { rank: 8, stockCode:"096770", stockName:"SK이노베이션",        weight: 4.14 },
    { rank: 9, stockCode:"066970", stockName:"엘앤에프",            weight: 2.94 },
    { rank:10, stockCode:"011790", stockName:"SKC",                 weight: 1.22 },
    { rank:11, stockCode:"450080", stockName:"에코프로머티",        weight: 1.06 },
    { rank:12, stockCode:"121600", stockName:"나노신소재",          weight: 0.98 },
    { rank:13, stockCode:"348370", stockName:"엔켐",                weight: 0.82 },
    { rank:14, stockCode:"005070", stockName:"코스모신소재",        weight: 0.74 },
    { rank:15, stockCode:"078600", stockName:"대주전자재료",        weight: 0.73 },
  ],
  // ── TIGER 2차전지테마 (305540) — KRX 2차전지테마 ──────────────────────────
  "305540": [
    { rank: 1, stockCode:"247540", stockName:"에코프로비엠",        weight:14.80 },
    { rank: 2, stockCode:"086520", stockName:"에코프로",            weight:13.20 },
    { rank: 3, stockCode:"373220", stockName:"LG에너지솔루션",      weight:12.50 },
    { rank: 4, stockCode:"006400", stockName:"삼성SDI",             weight:11.30 },
    { rank: 5, stockCode:"051910", stockName:"LG화학",              weight: 8.40 },
    { rank: 6, stockCode:"003670", stockName:"포스코퓨처엠",        weight: 6.80 },
    { rank: 7, stockCode:"066970", stockName:"엘앤에프",            weight: 5.20 },
    { rank: 8, stockCode:"096770", stockName:"SK이노베이션",        weight: 4.60 },
    { rank: 9, stockCode:"005490", stockName:"POSCO홀딩스",         weight: 4.20 },
    { rank:10, stockCode:"011790", stockName:"SKC",                 weight: 2.80 },
    { rank:11, stockCode:"450080", stockName:"에코프로머티",        weight: 2.50 },
    { rank:12, stockCode:"121600", stockName:"나노신소재",          weight: 2.20 },
    { rank:13, stockCode:"348370", stockName:"엔켐",                weight: 1.90 },
    { rank:14, stockCode:"005070", stockName:"코스모신소재",        weight: 1.70 },
    { rank:15, stockCode:"078600", stockName:"대주전자재료",        weight: 1.30 },
  ],
  // ── KODEX 헬스케어 (266420) — KRX 헬스케어, 68종목 ───────────────────────
  "266420": [
    { rank: 1, stockCode:"068270", stockName:"셀트리온",            weight:20.52 },
    { rank: 2, stockCode:"196170", stockName:"알테오젠",            weight:10.64 },
    { rank: 3, stockCode:"207940", stockName:"삼성바이오로직스",    weight:10.54 },
    { rank: 4, stockCode:"028300", stockName:"HLB",                weight: 4.08 },
    { rank: 5, stockCode:"087010", stockName:"펩트론",              weight: 3.81 },
    { rank: 6, stockCode:"000100", stockName:"유한양행",            weight: 3.74 },
    { rank: 7, stockCode:"000250", stockName:"삼천당제약",          weight: 3.66 },
    { rank: 8, stockCode:"298380", stockName:"에이비엘바이오",      weight: 3.39 },
    { rank: 9, stockCode:"141080", stockName:"리가켐바이오",        weight: 2.66 },
    { rank:10, stockCode:"128940", stockName:"한미약품",            weight: 2.03 },
    { rank:11, stockCode:"310210", stockName:"보로노이",            weight: 2.02 },
    { rank:12, stockCode:"326030", stockName:"SK바이오팜",          weight: 1.93 },
    { rank:13, stockCode:"226950", stockName:"올릭스",              weight: 1.77 },
    { rank:14, stockCode:"347850", stockName:"디앤디파마텍",        weight: 1.56 },
    { rank:15, stockCode:"145020", stockName:"휴젤",                weight: 1.43 },
  ],
  // ── TIGER 헬스케어 (143460) — KRX 헬스케어 (KODEX 헬스케어와 동일 지수) ──
  "143460": [
    { rank: 1, stockCode:"068270", stockName:"셀트리온",            weight:20.52 },
    { rank: 2, stockCode:"196170", stockName:"알테오젠",            weight:10.64 },
    { rank: 3, stockCode:"207940", stockName:"삼성바이오로직스",    weight:10.54 },
    { rank: 4, stockCode:"028300", stockName:"HLB",                weight: 4.08 },
    { rank: 5, stockCode:"087010", stockName:"펩트론",              weight: 3.81 },
    { rank: 6, stockCode:"000100", stockName:"유한양행",            weight: 3.74 },
    { rank: 7, stockCode:"000250", stockName:"삼천당제약",          weight: 3.66 },
    { rank: 8, stockCode:"298380", stockName:"에이비엘바이오",      weight: 3.39 },
    { rank: 9, stockCode:"141080", stockName:"리가켐바이오",        weight: 2.66 },
    { rank:10, stockCode:"128940", stockName:"한미약품",            weight: 2.03 },
    { rank:11, stockCode:"310210", stockName:"보로노이",            weight: 2.02 },
    { rank:12, stockCode:"326030", stockName:"SK바이오팜",          weight: 1.93 },
    { rank:13, stockCode:"226950", stockName:"올릭스",              weight: 1.77 },
    { rank:14, stockCode:"347850", stockName:"디앤디파마텍",        weight: 1.56 },
    { rank:15, stockCode:"145020", stockName:"휴젤",                weight: 1.43 },
  ],
  // ── KODEX IT (266370) — KRX IT, 47종목 ───────────────────────────────────
  "266370": [
    { rank: 1, stockCode:"000660", stockName:"SK하이닉스",          weight:34.10 },
    { rank: 2, stockCode:"005930", stockName:"삼성전자",            weight:21.56 },
    { rank: 3, stockCode:"009150", stockName:"삼성전기",            weight:13.02 },
    { rank: 4, stockCode:"006400", stockName:"삼성SDI",             weight: 7.29 },
    { rank: 5, stockCode:"042700", stockName:"한미반도체",          weight: 2.73 },
    { rank: 6, stockCode:"011070", stockName:"LG이노텍",            weight: 2.33 },
    { rank: 7, stockCode:"018260", stockName:"삼성에스디에스",      weight: 1.37 },
    { rank: 8, stockCode:"007660", stockName:"이수페타시스",        weight: 1.36 },
    { rank: 9, stockCode:"036930", stockName:"주성엔지니어링",      weight: 1.13 },
    { rank:10, stockCode:"000990", stockName:"DB하이텍",            weight: 1.08 },
    { rank:11, stockCode:"058470", stockName:"리노공업",            weight: 1.01 },
    { rank:12, stockCode:"353200", stockName:"대덕전자",            weight: 0.92 },
    { rank:13, stockCode:"039030", stockName:"이오테크닉스",        weight: 0.90 },
    { rank:14, stockCode:"034220", stockName:"LG디스플레이",        weight: 0.84 },
    { rank:15, stockCode:"240810", stockName:"원익IPS",             weight: 0.81 },
  ],
  // ── KODEX 코리아배당성장 (211900) — FnGuide 코리아배당성장, 51종목 ─────────
  "211900": [
    { rank: 1, stockCode:"005380", stockName:"현대차",              weight: 7.41 },
    { rank: 2, stockCode:"032830", stockName:"삼성생명",            weight: 5.79 },
    { rank: 3, stockCode:"016360", stockName:"삼성증권",            weight: 4.81 },
    { rank: 4, stockCode:"000270", stockName:"기아",                weight: 4.45 },
    { rank: 5, stockCode:"039490", stockName:"키움증권",            weight: 4.27 },
    { rank: 6, stockCode:"005940", stockName:"NH투자증권",          weight: 4.16 },
    { rank: 7, stockCode:"005830", stockName:"DB손해보험",          weight: 3.95 },
    { rank: 8, stockCode:"023590", stockName:"다우기술",            weight: 3.39 },
    { rank: 9, stockCode:"003540", stockName:"대신증권",            weight: 3.38 },
    { rank:10, stockCode:"120110", stockName:"코오롱인더",          weight: 3.25 },
    { rank:11, stockCode:"003550", stockName:"LG",                  weight: 2.89 },
    { rank:12, stockCode:"006800", stockName:"미래에셋증권",        weight: 2.87 },
    { rank:13, stockCode:"161390", stockName:"한국타이어앤테크놀로지", weight: 2.87 },
    { rank:14, stockCode:"033780", stockName:"KT&G",               weight: 2.62 },
    { rank:15, stockCode:"011070", stockName:"LG이노텍",            weight: 2.60 },
  ],
  // ── KODEX 삼성그룹 (102780) — FnGuide 삼성그룹 ────────────────────────────
  "102780": [
    { rank: 1, stockCode:"005930", stockName:"삼성전자",            weight:35.08 },
    { rank: 2, stockCode:"009150", stockName:"삼성전기",            weight:16.61 },
    { rank: 3, stockCode:"000660", stockName:"SK하이닉스",          weight:12.40 },
    { rank: 4, stockCode:"207940", stockName:"삼성바이오로직스",    weight: 8.20 },
    { rank: 5, stockCode:"028260", stockName:"삼성물산",            weight: 7.50 },
    { rank: 6, stockCode:"006400", stockName:"삼성SDI",             weight: 6.30 },
    { rank: 7, stockCode:"032830", stockName:"삼성생명",            weight: 4.80 },
    { rank: 8, stockCode:"018260", stockName:"삼성에스디에스",      weight: 3.20 },
    { rank: 9, stockCode:"016360", stockName:"삼성증권",            weight: 2.70 },
    { rank:10, stockCode:"000810", stockName:"삼성화재",            weight: 2.40 },
  ],
  // ── KODEX 코스닥150 (229200) — KOSDAQ 150, 151종목 ────────────────────────
  "229200": [
    { rank: 1, stockCode:"196170", stockName:"알테오젠",            weight: 6.93 },
    { rank: 2, stockCode:"086520", stockName:"에코프로",            weight: 6.14 },
    { rank: 3, stockCode:"028300", stockName:"HLB",                weight: 5.20 },
    { rank: 4, stockCode:"403870", stockName:"HPSP",               weight: 4.10 },
    { rank: 5, stockCode:"141080", stockName:"리가켐바이오",        weight: 3.80 },
    { rank: 6, stockCode:"247540", stockName:"에코프로비엠",        weight: 3.50 },
    { rank: 7, stockCode:"298380", stockName:"에이비엘바이오",      weight: 3.20 },
    { rank: 8, stockCode:"377300", stockName:"레인보우로보틱스",    weight: 2.90 },
    { rank: 9, stockCode:"145020", stockName:"휴젤",                weight: 2.70 },
    { rank:10, stockCode:"214150", stockName:"클래시스",            weight: 2.50 },
    { rank:11, stockCode:"000250", stockName:"삼천당제약",          weight: 2.30 },
    { rank:12, stockCode:"087010", stockName:"펩트론",              weight: 2.20 },
    { rank:13, stockCode:"348370", stockName:"엔켐",                weight: 2.00 },
    { rank:14, stockCode:"039030", stockName:"이오테크닉스",        weight: 1.80 },
    { rank:15, stockCode:"310210", stockName:"보로노이",            weight: 1.60 },
  ],
  // ── TIGER KRX고배당 (292150) — KRX 고배당50 ──────────────────────────────
  "292150": [
    { rank: 1, stockCode:"005930", stockName:"삼성전자",            weight: 8.20 },
    { rank: 2, stockCode:"105560", stockName:"KB금융",              weight: 6.40 },
    { rank: 3, stockCode:"055550", stockName:"신한지주",            weight: 5.80 },
    { rank: 4, stockCode:"086790", stockName:"하나금융지주",        weight: 4.90 },
    { rank: 5, stockCode:"017670", stockName:"SK텔레콤",            weight: 4.50 },
    { rank: 6, stockCode:"030200", stockName:"KT",                  weight: 3.80 },
    { rank: 7, stockCode:"000810", stockName:"삼성화재",            weight: 3.60 },
    { rank: 8, stockCode:"316140", stockName:"우리금융지주",        weight: 3.40 },
    { rank: 9, stockCode:"005380", stockName:"현대차",              weight: 3.20 },
    { rank:10, stockCode:"032830", stockName:"삼성생명",            weight: 2.90 },
    { rank:11, stockCode:"005830", stockName:"DB손해보험",          weight: 2.70 },
    { rank:12, stockCode:"000270", stockName:"기아",                weight: 2.50 },
    { rank:13, stockCode:"015760", stockName:"한국전력",            weight: 2.30 },
    { rank:14, stockCode:"033780", stockName:"KT&G",               weight: 2.20 },
    { rank:15, stockCode:"071050", stockName:"한국금융지주",        weight: 2.00 },
  ],
  // ── TIGER MSCI Korea TR (139270) — MSCI Korea 지수 ───────────────────────
  "139270": [
    { rank: 1, stockCode:"005930", stockName:"삼성전자",            weight:23.80 },
    { rank: 2, stockCode:"000660", stockName:"SK하이닉스",          weight:10.20 },
    { rank: 3, stockCode:"207940", stockName:"삼성바이오로직스",    weight: 3.40 },
    { rank: 4, stockCode:"005380", stockName:"현대차",              weight: 2.80 },
    { rank: 5, stockCode:"068270", stockName:"셀트리온",            weight: 2.50 },
    { rank: 6, stockCode:"000270", stockName:"기아",                weight: 2.30 },
    { rank: 7, stockCode:"105560", stockName:"KB금융",              weight: 2.10 },
    { rank: 8, stockCode:"055550", stockName:"신한지주",            weight: 1.90 },
    { rank: 9, stockCode:"373220", stockName:"LG에너지솔루션",      weight: 1.70 },
    { rank:10, stockCode:"086790", stockName:"하나금융지주",        weight: 1.60 },
  ],
  // ── TIGER 미국나스닥100 (133690) — NASDAQ 100 ─────────────────────────────
  "133690": [
    { rank: 1, stockCode:"NVDA",   stockName:"NVIDIA",              weight:12.80 },
    { rank: 2, stockCode:"MSFT",   stockName:"Microsoft",           weight: 8.90 },
    { rank: 3, stockCode:"AAPL",   stockName:"Apple",               weight: 8.20 },
    { rank: 4, stockCode:"AMZN",   stockName:"Amazon",              weight: 5.40 },
    { rank: 5, stockCode:"META",   stockName:"Meta Platforms",      weight: 5.10 },
    { rank: 6, stockCode:"TSLA",   stockName:"Tesla",               weight: 4.80 },
    { rank: 7, stockCode:"GOOGL",  stockName:"Alphabet A",          weight: 4.20 },
    { rank: 8, stockCode:"GOOG",   stockName:"Alphabet C",          weight: 3.80 },
    { rank: 9, stockCode:"AVGO",   stockName:"Broadcom",            weight: 3.60 },
    { rank:10, stockCode:"COST",   stockName:"Costco",              weight: 2.90 },
    { rank:11, stockCode:"NFLX",   stockName:"Netflix",             weight: 2.70 },
    { rank:12, stockCode:"ASML",   stockName:"ASML Holding",        weight: 2.40 },
    { rank:13, stockCode:"AMD",    stockName:"AMD",                 weight: 2.10 },
    { rank:14, stockCode:"QCOM",   stockName:"Qualcomm",            weight: 1.80 },
    { rank:15, stockCode:"MRVL",   stockName:"Marvell Technology",  weight: 1.60 },
  ],
  // ── KODEX 미국나스닥100TR (379810) — NASDAQ 100 TR ────────────────────────
  "379810": [
    { rank: 1, stockCode:"NVDA",   stockName:"NVIDIA",              weight:12.80 },
    { rank: 2, stockCode:"MSFT",   stockName:"Microsoft",           weight: 8.90 },
    { rank: 3, stockCode:"AAPL",   stockName:"Apple",               weight: 8.20 },
    { rank: 4, stockCode:"AMZN",   stockName:"Amazon",              weight: 5.40 },
    { rank: 5, stockCode:"META",   stockName:"Meta Platforms",      weight: 5.10 },
    { rank: 6, stockCode:"TSLA",   stockName:"Tesla",               weight: 4.80 },
    { rank: 7, stockCode:"GOOGL",  stockName:"Alphabet A",          weight: 4.20 },
    { rank: 8, stockCode:"GOOG",   stockName:"Alphabet C",          weight: 3.80 },
    { rank: 9, stockCode:"AVGO",   stockName:"Broadcom",            weight: 3.60 },
    { rank:10, stockCode:"COST",   stockName:"Costco",              weight: 2.90 },
  ],
  // ── KODEX 미국S&P500TR (379800) — S&P 500 TR, 505종목 ─────────────────────
  "379800": [
    { rank: 1, stockCode:"NVDA",   stockName:"NVIDIA",              weight: 8.53 },
    { rank: 2, stockCode:"MSFT",   stockName:"Microsoft",           weight: 6.20 },
    { rank: 3, stockCode:"AAPL",   stockName:"Apple",               weight: 5.80 },
    { rank: 4, stockCode:"AMZN",   stockName:"Amazon",              weight: 3.80 },
    { rank: 5, stockCode:"META",   stockName:"Meta Platforms",      weight: 3.40 },
    { rank: 6, stockCode:"GOOGL",  stockName:"Alphabet A",          weight: 3.00 },
    { rank: 7, stockCode:"TSLA",   stockName:"Tesla",               weight: 2.70 },
    { rank: 8, stockCode:"GOOG",   stockName:"Alphabet C",          weight: 2.50 },
    { rank: 9, stockCode:"AVGO",   stockName:"Broadcom",            weight: 2.30 },
    { rank:10, stockCode:"BRK.B",  stockName:"Berkshire Hathaway",  weight: 2.00 },
    { rank:11, stockCode:"LLY",    stockName:"Eli Lilly",           weight: 1.80 },
    { rank:12, stockCode:"JPM",    stockName:"JPMorgan Chase",      weight: 1.70 },
    { rank:13, stockCode:"V",      stockName:"Visa",                weight: 1.50 },
    { rank:14, stockCode:"UNH",    stockName:"UnitedHealth",        weight: 1.40 },
    { rank:15, stockCode:"COST",   stockName:"Costco",              weight: 1.30 },
  ],
  // ── TIGER 유로스탁스50 (195930) — EURO STOXX 50 ───────────────────────────
  "195930": [
    { rank: 1, stockCode:"SAP",    stockName:"SAP SE",              weight: 6.80 },
    { rank: 2, stockCode:"ASML",   stockName:"ASML Holding",        weight: 6.50 },
    { rank: 3, stockCode:"MC",     stockName:"LVMH",                weight: 5.40 },
    { rank: 4, stockCode:"SIE",    stockName:"Siemens",             weight: 4.20 },
    { rank: 5, stockCode:"ALV",    stockName:"Allianz",             weight: 4.00 },
    { rank: 6, stockCode:"SU",     stockName:"Schneider Electric",  weight: 3.80 },
    { rank: 7, stockCode:"TTE",    stockName:"TotalEnergies",       weight: 3.50 },
    { rank: 8, stockCode:"AIR",    stockName:"Airbus",              weight: 3.20 },
    { rank: 9, stockCode:"SAN",    stockName:"Sanofi",              weight: 3.00 },
    { rank:10, stockCode:"OR",     stockName:"L'Oréal",             weight: 2.80 },
    { rank:11, stockCode:"IBE",    stockName:"Iberdrola",           weight: 2.50 },
    { rank:12, stockCode:"DTE",    stockName:"Deutsche Telekom",    weight: 2.30 },
    { rank:13, stockCode:"AI",     stockName:"Air Liquide",         weight: 2.20 },
    { rank:14, stockCode:"BNP",    stockName:"BNP Paribas",         weight: 2.10 },
    { rank:15, stockCode:"ENGI",   stockName:"Engie",               weight: 2.00 },
  ],
  // ── KODEX 코리아밸류업 (495850) ────────────────────────────────────────────
  "495850": [
    { rank: 1, stockCode:"005930", stockName:"삼성전자",            weight:14.20 },
    { rank: 2, stockCode:"000660", stockName:"SK하이닉스",          weight: 8.50 },
    { rank: 3, stockCode:"005380", stockName:"현대차",              weight: 5.30 },
    { rank: 4, stockCode:"000270", stockName:"기아",                weight: 4.80 },
    { rank: 5, stockCode:"105560", stockName:"KB금융",              weight: 4.20 },
    { rank: 6, stockCode:"055550", stockName:"신한지주",            weight: 3.80 },
    { rank: 7, stockCode:"086790", stockName:"하나금융지주",        weight: 3.20 },
    { rank: 8, stockCode:"316140", stockName:"우리금융지주",        weight: 2.90 },
    { rank: 9, stockCode:"032830", stockName:"삼성생명",            weight: 2.70 },
    { rank:10, stockCode:"000810", stockName:"삼성화재",            weight: 2.50 },
  ],
  // ── 원자재 — 선물 기반 단일 항목 ──────────────────────────────────────────
  "132030": [ // KODEX 골드선물(H)
    { rank:1, stockCode:"GC=F", stockName:"금(Gold) 선물",       weight:98.50 },
    { rank:2, stockCode:"CASH", stockName:"현금·파생 증거금",    weight: 1.50 },
  ],
  "319640": [ // TIGER 골드선물(H)
    { rank:1, stockCode:"GC=F", stockName:"금(Gold) 선물",       weight:98.20 },
    { rank:2, stockCode:"CASH", stockName:"현금·파생 증거금",    weight: 1.80 },
  ],
  "261220": [ // KODEX WTI원유선물(H)
    { rank:1, stockCode:"CL=F", stockName:"WTI 원유 선물",       weight:95.10 },
    { rank:2, stockCode:"CASH", stockName:"현금·파생 증거금",    weight: 4.90 },
  ],
  "217700": [ // TIGER 원유선물Enhanced(H)
    { rank:1, stockCode:"CL=F", stockName:"WTI 원유 선물",       weight:93.80 },
    { rank:2, stockCode:"CASH", stockName:"현금·파생 증거금",    weight: 6.20 },
  ],
  "144600": [ // KODEX 은선물(H)
    { rank:1, stockCode:"SI=F", stockName:"은(Silver) 선물",     weight:97.90 },
    { rank:2, stockCode:"CASH", stockName:"현금·파생 증거금",    weight: 2.10 },
  ],
  "160480": [ // KODEX 콩선물(H)
    { rank:1, stockCode:"ZS=F", stockName:"대두(Soybean) 선물",  weight:96.40 },
    { rank:2, stockCode:"CASH", stockName:"현금·파생 증거금",    weight: 3.60 },
  ],
  "171018": [ // KODEX 천연가스선물(H)
    { rank:1, stockCode:"NG=F", stockName:"천연가스 선물",       weight:94.50 },
    { rank:2, stockCode:"CASH", stockName:"현금·파생 증거금",    weight: 5.50 },
  ],
};

// ─── 캐시 ─────────────────────────────────────────────────────────────────────

const holdingsCache = new Map<string, { data: ETFHolding[]; ts: number; source: string }>();
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

// ─── KIS ETF 구성 종목 조회 (실시간 우선) ────────────────────────────────────

async function kisGetEtfHoldings(code: string): Promise<ETFHolding[]> {
  try {
    const token = await getKisAccessToken();
    const url = new URL(`${KIS_BASE}/uapi/domestic-stock/v1/quotations/inquire-etf-component`);
    url.searchParams.set("FID_INPUT_ISCD", code);

    const res = await fetch(url.toString(), {
      headers: {
        authorization: `Bearer ${token}`,
        appkey:        process.env.KIS_APP_KEY!,
        appsecret:     process.env.KIS_APP_SECRET!,
        tr_id:         "FHKST132400C0",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // 404는 KIS가 미지원 — 조용히 폴백
      if (res.status !== 404) {
        console.warn(`[kis-etf] ${code} 구성종목 조회 실패: ${res.status}`);
      }
      return [];
    }

    const json = await res.json();
    if (json?.rt_cd !== "0") {
      console.warn(`[kis-etf] ${code} rt_cd=${json?.rt_cd} msg=${json?.msg1}`);
      return [];
    }

    const rows: any[] = json?.output1 ?? [];
    return rows
      .map((r: any, i: number) => ({
        rank:      i + 1,
        stockCode: String(r.stck_shrn_iscd ?? "").replace(/^A/, ""),
        stockName: String(r.hts_kor_isnm ?? ""),
        weight:    parseFloat(String(r.bprc_wt ?? r.evlu_prc_wt ?? 0)) || 0,
      }))
      .filter(h => h.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((h, i) => ({ ...h, rank: i + 1 }));
  } catch (e: any) {
    console.warn("[kis-etf] holdings 조회 예외:", e?.message);
    return [];
  }
}

// ─── Samsung Fund 모바일 API 실시간 크롤러 ──────────────────────────────────────
// m.samsungfund.com/api/v1/kodex/product-pdf/{fId}.do?gijunYMD=YYYY.MM.DD

function sfKstDate(): string {
  const d = new Date(Date.now() + 9 * 3600_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${dd}`;
}

async function samsungFundFetchHoldings(code: string): Promise<ETFHolding[]> {
  const fid = SF_FID_MAP[code];
  if (!fid) return [];

  const date = sfKstDate();
  const url = `https://m.samsungfund.com/api/v1/kodex/product-pdf/${fid}.do?gijunYMD=${date}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept":            "application/json",
        "X-Requested-With":  "XMLHttpRequest",
        "Referer":           `https://m.samsungfund.com/etf/product/view.do?id=${fid}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    const list: any[] = json?.pdf?.list ?? [];
    if (!list.length) return [];

    const holdings: ETFHolding[] = list
      .filter((item: any) => item.ratio && parseFloat(item.ratio) > 0)
      .map((item: any, i: number) => ({
        rank:      i + 1,
        stockCode: String(item.itmNo ?? ""),
        stockName: String(item.secNm ?? ""),
        weight:    parseFloat(String(item.ratio)) || 0,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 20)
      .map((h, i) => ({ ...h, rank: i + 1 }));

    return holdings;
  } catch {
    return [];
  }
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

export type HoldingsResult = { holdings: ETFHolding[]; source: "live" | "reference"; dataDate: string };

function tsToKstDateStr(ts: number): string {
  const d = new Date(ts + 9 * 3600_000);
  const y = d.toISOString().slice(0, 10);
  const [year, month, day] = y.split("-");
  return `${year}년 ${month}월 ${day}일`;
}

/** ETF 구성 종목 조회 (KIS 실시간 → KRX → 정적 폴백) */
export async function getEtfHoldings(code: string): Promise<HoldingsResult> {
  const cached = holdingsCache.get(code);
  if (cached && Date.now() - cached.ts < HOLDINGS_TTL) {
    return {
      holdings: cached.data,
      source: cached.source as "live" | "reference",
      dataDate: tsToKstDateStr(cached.ts),
    };
  }

  const etf = MAJOR_ETFS.find(e => e.code === code);
  if (!etf) {
    const st = STATIC_HOLDINGS[code] ?? [];
    return { holdings: st, source: "reference", dataDate: "2026년 05월 22일" };
  }

  const now = Date.now();

  // 1) KIS API (실시간)
  const kisData = await kisGetEtfHoldings(code);
  if (kisData.length >= 3) {
    holdingsCache.set(code, { data: kisData, ts: now, source: "live" });
    return { holdings: kisData, source: "live", dataDate: tsToKstDateStr(now) };
  }

  // 2) Samsung Fund 모바일 API (KODEX ETF 전용 실시간)
  const sfData = await samsungFundFetchHoldings(code);
  if (sfData.length >= 3) {
    holdingsCache.set(code, { data: sfData, ts: now, source: "live" });
    return { holdings: sfData, source: "live", dataDate: tsToKstDateStr(now) };
  }

  // 3) KRX 스크래핑
  const krxData = await krxFetchHoldings(etf.isuCd);
  if (krxData.length >= 3) {
    holdingsCache.set(code, { data: krxData, ts: now, source: "live" });
    return { holdings: krxData, source: "live", dataDate: tsToKstDateStr(now) };
  }

  // 4) 정적 폴백
  const st = STATIC_HOLDINGS[code] ?? [];
  holdingsCache.set(code, { data: st, ts: now, source: "reference" });
  return { holdings: st, source: "reference", dataDate: "2026년 05월 22일" };
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
      const { holdings } = await getEtfHoldings(etf.code);
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
    "2차전지": "305720", "헬스케어": "266420", "금융": "139270",
    "IT": "266370",      "해외주식": "133690",  "배당": "211900",
    "원자재": "132030",
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
    ["069500","229200","091160","305720","266420","266370","211900","133690","379800","122630","114800"].includes(e.code)
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

// ─── AI 통합 신호 ─────────────────────────────────────────────────────────────

const KOREAN_SECTORS = new Set(["국내주식","코스닥","반도체","2차전지","헬스케어","금융","IT","배당"]);
const FOREIGN_SECTORS = new Set(["해외주식"]);

function calcAiBonus(
  dir: "up" | "down" | "neutral",
  strength: number,
  leverage: number,
): number {
  if (dir === "neutral") return 0;
  const base   = dir === "up" ? 1 : -1;
  const mag    = strength > 0.7 ? 20 : strength > 0.4 ? 13 : 7;
  const raw    = base * mag;
  if (leverage === 2)  return Math.max(-40, Math.min(40, raw * 2));
  if (leverage === -1) return -raw;
  if (leverage === -2) return Math.max(-40, Math.min(40, -raw * 2));
  return raw;
}

/** 섹터 로테이션 + 기술적 신호 + AI 예측 방향을 통합한 ETF 종합 점수 */
export async function getUnifiedSignals(ai?: AiMarketInput): Promise<UnifiedSignal[]> {
  const TARGETS = [
    "069500","229200","091160","305720","266420","266370","211900",
    "133690","379800","132030","122630","114800",
  ];
  const etfs = MAJOR_ETFS.filter(e => TARGETS.includes(e.code));

  const rows = await Promise.allSettled(
    etfs.map(async etf => {
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
      const maCross = ma5 > ma20 ? 1 : 0;
      const maDist  = ((last / ma20) - 1) * 100;

      const techScore = Math.round(
        normalize(ret20d, -20, 20) * 0.35 +
        normalize(ret5d,  -10, 10) * 0.30 +
        normalize(rsi,    20,  80) * 0.20 +
        maCross * 15,
      );

      let reason = "";
      if (ret20d > 5)    reason += "20일 강한 상승 모멘텀. ";
      if (ret5d  > 3)    reason += "5일 단기 상승세. ";
      if (rsi    > 70)   reason += "RSI 과매수 구간. ";
      if (rsi    < 30)   reason += "RSI 과매도 — 반등 주목. ";
      if (maCross > 0)   reason += "골든크로스. ";
      else               reason += "데드크로스. ";
      if (maDist < -5)   reason += "20일선 크게 하회. ";
      if (!reason.trim()) reason = "특이 신호 없음.";

      return { etf, last, ret1d, ret5d, ret20d, ma5: Math.round(ma5), ma20: Math.round(ma20), rsi, techScore, reason: reason.trim() };
    })
  );

  const valid = rows
    .filter(r => r.status === "fulfilled" && r.value)
    .map(r => (r as any).value);

  if (!valid.length) return [];

  // 상대 섹터 강도: 모든 ETF 대비 5d/20d 수익 퍼센타일
  const all5d  = valid.map((v: any) => v.ret5d);
  const all20d = valid.map((v: any) => v.ret20d);
  const min5  = Math.min(...all5d),  max5  = Math.max(...all5d);
  const min20 = Math.min(...all20d), max20 = Math.max(...all20d);

  return valid.map((v: any) => {
    const sectorRank = Math.round(
      normalize(v.ret5d, min5, max5) * 0.6 +
      normalize(v.ret20d, min20, max20) * 0.4
    );

    // AI 방향 보정
    const isKorean  = KOREAN_SECTORS.has(v.etf.sector);
    const isForeign = FOREIGN_SECTORS.has(v.etf.sector);
    const aiSig = ai
      ? (isKorean ? ai.kospi : isForeign ? ai.nasdaq : null)
      : null;

    const aiBonus = aiSig
      ? calcAiBonus(aiSig.direction, aiSig.strength, v.etf.leverage)
      : 0;
    const aiDirection  = aiSig?.direction ?? "neutral";
    const aiStrength   = aiSig?.strength  ?? 0;

    // AI 점수 (0-100 스케일): 50 + aiBonus(±20~40 범위)
    const aiScore = Math.max(0, Math.min(100, 50 + aiBonus));

    const combinedScore = Math.max(0, Math.min(100, Math.round(
      v.techScore * 0.55 + sectorRank * 0.25 + aiScore * 0.20
    )));

    return {
      code:          v.etf.code,
      name:          v.etf.name,
      sector:        v.etf.sector,
      issuer:        v.etf.issuer,
      leverage:      v.etf.leverage,
      price:         Math.round(v.last),
      change1d:      Math.round(v.ret1d  * 100) / 100,
      return5d:      Math.round(v.ret5d  * 100) / 100,
      return20d:     Math.round(v.ret20d * 100) / 100,
      rsi14:         v.rsi,
      ma5:           v.ma5,
      ma20:          v.ma20,
      techScore:     v.techScore,
      sectorRank,
      aiScore,
      aiBonus,
      combinedScore,
      signal:        toSignal(combinedScore),
      aiDirection,
      aiStrength,
      reason:        v.reason,
    } as UnifiedSignal;
  }).sort((a, b) => b.combinedScore - a.combinedScore);
}
