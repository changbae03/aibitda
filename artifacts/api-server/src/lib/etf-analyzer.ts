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
import { fetchECOSMacro } from "./ecos-client.js";
import { fetchFREDMacro } from "./fred-client.js";
import { fetchEtfHoldingsPykrx } from "./pykrx-client.js";
import { pool } from "@workspace/db";

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

export interface HoldingChangeItem {
  stockCode: string;
  stockName: string;
  weight: number;         // 현재 비중 (편출 시 이전 비중)
  weightDelta?: number;   // 비중 변화 (편입/편출 없음)
  prevWeight?: number;    // 이전 비중
  prevRank?: number;      // 이전 순위
  rank?: number;          // 현재 순위
}

export interface HoldingsChanges {
  added: HoldingChangeItem[];      // 신규 편입
  removed: HoldingChangeItem[];    // 편출
  increased: HoldingChangeItem[];  // 비중 확대
  decreased: HoldingChangeItem[];  // 비중 축소
  previousDate: string;            // 이전 스냅샷 날짜
  currentDate: string;             // 현재 데이터 날짜
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
  { code:"381180", isuCd:"KR7381180009", name:"TIGER 미국필라델피아반도체나스닥", sector:"해외주식", issuer:"미래에셋",    yahooCode:"381180.KS", leverage:1,  ter:0.49, benchmark:"필라델피아 반도체지수(SOX)" },
  { code:"491830", isuCd:"KR7491830006", name:"TIGER 미국AI반도체팹리스",       sector:"해외주식", issuer:"미래에셋",    yahooCode:"491830.KS", leverage:1,  ter:0.49, benchmark:"Mirae Asset US AI Fabless 지수" },
  { code:"480310", isuCd:"KR7480310002", name:"TIGER 글로벌온디바이스AI",        sector:"테마",     issuer:"미래에셋",    yahooCode:"480310.KS", leverage:1,  ter:0.49, benchmark:"Indxx 글로벌온디바이스AI" },
  { code:"464930", isuCd:"KR7464930007", name:"TIGER 글로벌혁신블루칩TOP10",     sector:"테마",     issuer:"미래에셋",    yahooCode:"464930.KS", leverage:1,  ter:0.49, benchmark:"Solactive 글로벌혁신블루칩TOP10" },
  { code:"466950", isuCd:"KR7466950003", name:"TIGER 글로벌AI액티브",            sector:"테마",     issuer:"미래에셋",    yahooCode:"466950.KS", leverage:1,  ter:0.80, benchmark:"액티브(AI)" },
  { code:"476690", isuCd:"KR7476690003", name:"TIGER 글로벌비만치료제TOP2Plus",   sector:"헬스케어", issuer:"미래에셋",    yahooCode:"476690.KS", leverage:1,  ter:0.49, benchmark:"Solactive 글로벌비만치료제TOP2" },
  { code:"371450", isuCd:"KR7371450008", name:"TIGER 글로벌클라우드컴퓨팅INDXX", sector:"테마",     issuer:"미래에셋",    yahooCode:"371450.KS", leverage:1,  ter:0.49, benchmark:"Indxx 글로벌클라우드컴퓨팅" },
  { code:"491010", isuCd:"KR7491010005", name:"TIGER 글로벌AI전력인프라액티브",   sector:"테마",     issuer:"미래에셋",    yahooCode:"491010.KS", leverage:1,  ter:0.80, benchmark:"액티브(AI전력인프라)" },
  { code:"418670", isuCd:"KR7418670006", name:"TIGER 글로벌AI사이버보안",         sector:"테마",     issuer:"미래에셋",    yahooCode:"418670.KS", leverage:1,  ter:0.49, benchmark:"Indxx 글로벌AI사이버보안" },
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

  // ── TIMEFOLIO (타임폴리오자산운용) ──────────────────────────────────────────
  { code:"426030", isuCd:"KR7426030003", name:"TIME 미국나스닥100액티브",         sector:"해외주식", issuer:"TIMEFOLIO", yahooCode:"426030.KS", leverage:1, ter:0.80, benchmark:"NASDAQ 100 (액티브)" },
  { code:"426020", isuCd:"KR7426020004", name:"TIME 미국S&P500액티브",           sector:"해외주식", issuer:"TIMEFOLIO", yahooCode:"426020.KS", leverage:1, ter:0.80, benchmark:"S&P 500 (액티브)" },
  { code:"456600", isuCd:"KR7456600006", name:"TIME 글로벌AI인공지능액티브",     sector:"테마",     issuer:"TIMEFOLIO", yahooCode:"456600.KS", leverage:1, ter:0.80, benchmark:"글로벌 AI 인공지능 (액티브)" },
  { code:"494180", isuCd:"KR7494180003", name:"TIME 글로벌소비트렌드액티브",     sector:"테마",     issuer:"TIMEFOLIO", yahooCode:"494180.KS", leverage:1, ter:0.80, benchmark:"글로벌 소비트렌드 (액티브)" },
  { code:"485810", isuCd:"KR7485810006", name:"TIME 글로벌바이오액티브",         sector:"헬스케어", issuer:"TIMEFOLIO", yahooCode:"485810.KS", leverage:1, ter:0.80, benchmark:"글로벌 바이오 (액티브)" },
  { code:"478150", isuCd:"KR7478150006", name:"TIME 글로벌우주테크&방산액티브", sector:"테마",     issuer:"TIMEFOLIO", yahooCode:"478150.KS", leverage:1, ter:0.80, benchmark:"글로벌 우주테크&방산 (액티브)" },

  // ── RISE ETF (KB자산운용, 구 KBSTAR) ─────────────────────────────────────
  { code:"148020", isuCd:"KR7148020001", name:"RISE 200",                          sector:"국내주식", issuer:"KB자산운용", yahooCode:"148020.KS", leverage:1,  ter:0.07, benchmark:"KOSPI 200" },
  { code:"361580", isuCd:"KR7361580004", name:"RISE 200TR",                        sector:"국내주식", issuer:"KB자산운용", yahooCode:"361580.KS", leverage:1,  ter:0.07, benchmark:"KOSPI 200 TR" },
  { code:"292050", isuCd:"KR7292050002", name:"RISE KRX300",                       sector:"국내주식", issuer:"KB자산운용", yahooCode:"292050.KS", leverage:1,  ter:0.14, benchmark:"KRX 300" },
  { code:"252400", isuCd:"KR7252400007", name:"RISE 200선물레버리지",              sector:"국내주식", issuer:"KB자산운용", yahooCode:"252400.KS", leverage:2,  ter:0.60, benchmark:"KOSPI 200 ×2" },
  { code:"368590", isuCd:"KR7368590006", name:"RISE 미국나스닥100",                sector:"해외주식", issuer:"KB자산운용", yahooCode:"368590.KS", leverage:1,  ter:0.07, benchmark:"NASDAQ 100" },
  { code:"379780", isuCd:"KR7379780000", name:"RISE 미국S&P500",                   sector:"해외주식", issuer:"KB자산운용", yahooCode:"379780.KS", leverage:1,  ter:0.07, benchmark:"S&P 500" },
  { code:"315960", isuCd:"KR7315960005", name:"RISE 대형고배당10TR",               sector:"배당",     issuer:"KB자산운용", yahooCode:"315960.KS", leverage:1,  ter:0.20, benchmark:"FnGuide 대형고배당10" },
  { code:"388420", isuCd:"KR7388420002", name:"RISE 비메모리반도체액티브",         sector:"반도체",   issuer:"KB자산운용", yahooCode:"388420.KS", leverage:1,  ter:0.50, benchmark:"비메모리반도체 (액티브)" },
  { code:"367760", isuCd:"KR7367760006", name:"RISE 네트워크인프라",               sector:"테마",     issuer:"KB자산운용", yahooCode:"367760.KS", leverage:1,  ter:0.45, benchmark:"FnGuide 네트워크인프라" },
  { code:"417450", isuCd:"KR7417450004", name:"RISE 글로벌수소경제",               sector:"테마",     issuer:"KB자산운용", yahooCode:"417450.KS", leverage:1,  ter:0.45, benchmark:"글로벌 수소경제" },
  { code:"490590", isuCd:"KR7490590007", name:"RISE 미국AI밸류체인데일리고정커버드콜", sector:"테마", issuer:"KB자산운용", yahooCode:"490590.KS", leverage:1, ter:0.50, benchmark:"미국 AI 밸류체인" },
  { code:"475720", isuCd:"KR7475720009", name:"RISE 200위클리커버드콜",            sector:"국내주식", issuer:"KB자산운용", yahooCode:"475720.KS", leverage:1,  ter:0.30, benchmark:"KOSPI 200 위클리 커버드콜" },
  { code:"495050", isuCd:"KR7495050007", name:"RISE 코리아밸류업",                 sector:"국내주식", issuer:"KB자산운용", yahooCode:"495050.KS", leverage:1,  ter:0.15, benchmark:"KRX 코리아밸류업" },
  { code:"290130", isuCd:"KR7290130004", name:"RISE ESG사회책임투자",              sector:"국내주식", issuer:"KB자산운용", yahooCode:"290130.KS", leverage:1,  ter:0.30, benchmark:"KRX ESG 사회책임투자" },
  { code:"105780", isuCd:"KR7105780001", name:"RISE 5대그룹주",                   sector:"국내주식", issuer:"KB자산운용", yahooCode:"105780.KS", leverage:1,  ter:0.40, benchmark:"FnGuide 5대그룹" },

  // ── PLUS ETF (한화자산운용, 구 ARIRANG) ──────────────────────────────────
  { code:"152100", isuCd:"KR7152100004", name:"PLUS 200",                          sector:"국내주식", issuer:"한화자산운용", yahooCode:"152100.KS", leverage:1,  ter:0.04, benchmark:"KOSPI 200" },
  { code:"251350", isuCd:"KR7251350005", name:"PLUS 200TR",                        sector:"국내주식", issuer:"한화자산운용", yahooCode:"251350.KS", leverage:1,  ter:0.04, benchmark:"KOSPI 200 TR" },
  { code:"161510", isuCd:"KR7161510003", name:"PLUS 고배당주",                     sector:"배당",     issuer:"한화자산운용", yahooCode:"161510.KS", leverage:1,  ter:0.23, benchmark:"FnGuide 고배당주" },
  { code:"489030", isuCd:"KR7489030007", name:"PLUS 고배당주위클리커버드콜",       sector:"배당",     issuer:"한화자산운용", yahooCode:"489030.KS", leverage:1,  ter:0.30, benchmark:"고배당주 위클리 커버드콜" },
  { code:"451600", isuCd:"KR7451600001", name:"PLUS 국고채30년액티브",             sector:"채권",     issuer:"한화자산운용", yahooCode:"451600.KS", leverage:1,  ter:0.05, benchmark:"국고채 30년 (액티브)" },
  { code:"453010", isuCd:"KR7453010001", name:"PLUS KOFR금리액티브",               sector:"채권",     issuer:"한화자산운용", yahooCode:"453010.KS", leverage:1,  ter:0.03, benchmark:"KOFR 금리" },
  { code:"449450", isuCd:"KR7449450006", name:"PLUS K방산",                        sector:"테마",     issuer:"한화자산운용", yahooCode:"449450.KS", leverage:1,  ter:0.45, benchmark:"FnGuide K방산" },
  { code:"421320", isuCd:"KR7421320003", name:"PLUS 우주항공&UAM",                 sector:"테마",     issuer:"한화자산운용", yahooCode:"421320.KS", leverage:1,  ter:0.45, benchmark:"글로벌 우주항공&UAM" },

  // ── ACE ETF (한국투자신탁운용) ────────────────────────────────────────────
  { code:"360750", isuCd:"KR7360750004", name:"ACE 미국나스닥100",                 sector:"해외주식", issuer:"한국투자신탁운용", yahooCode:"360750.KS", leverage:1, ter:0.07, benchmark:"NASDAQ 100" },
  { code:"360200", isuCd:"KR7360200000", name:"ACE 미국S&P500",                    sector:"해외주식", issuer:"한국투자신탁운용", yahooCode:"360200.KS", leverage:1, ter:0.07, benchmark:"S&P 500" },
  { code:"396520", isuCd:"KR7396520009", name:"ACE 미국빅테크TOP7Plus",            sector:"해외주식", issuer:"한국투자신탁운용", yahooCode:"396520.KS", leverage:1, ter:0.45, benchmark:"미국 빅테크 TOP7" },
  { code:"448130", isuCd:"KR7448130005", name:"ACE 미국테크TOP10INDXX",            sector:"해외주식", issuer:"한국투자신탁운용", yahooCode:"448130.KS", leverage:1, ter:0.45, benchmark:"Indxx 미국테크 TOP10" },
  { code:"411060", isuCd:"KR7411060007", name:"ACE KRX금현물",                     sector:"원자재",   issuer:"한국투자신탁운용", yahooCode:"411060.KS", leverage:1, ter:0.30, benchmark:"KRX 금현물" },
  { code:"464190", isuCd:"KR7464190008", name:"ACE 미국AI반도체",                  sector:"반도체",   issuer:"한국투자신탁운용", yahooCode:"464190.KS", leverage:1, ter:0.45, benchmark:"미국 AI 반도체" },
  { code:"469070", isuCd:"KR7469070007", name:"ACE 글로벌인공지능산업",            sector:"테마",     issuer:"한국투자신탁운용", yahooCode:"469070.KS", leverage:1, ter:0.45, benchmark:"글로벌 인공지능 산업" },
  { code:"480810", isuCd:"KR7480810001", name:"ACE 글로벌인공지능&로보틱스",      sector:"테마",     issuer:"한국투자신탁운용", yahooCode:"480810.KS", leverage:1, ter:0.45, benchmark:"글로벌 AI & 로보틱스" },
  { code:"491830", isuCd:"KR7491830006", name:"ACE 미국AI반도체팹리스액티브",     sector:"반도체",   issuer:"한국투자신탁운용", yahooCode:"491830.KS", leverage:1, ter:0.80, benchmark:"미국 AI 반도체 팹리스 (액티브)" },
  { code:"498100", isuCd:"KR7498100007", name:"ACE 미국AI반도체&전력인프라TOP10", sector:"테마",     issuer:"한국투자신탁운용", yahooCode:"498100.KS", leverage:1, ter:0.45, benchmark:"미국 AI 반도체 & 전력인프라 TOP10" },
];

// ─── 미국 주요 ETF 목록 ───────────────────────────────────────────────────────
export const US_ETFS: ETFInfo[] = [
  // 시장 전체
  { code:"SPY",  isuCd:"SPY",  name:"SPDR S&P 500 ETF",              sector:"미국시장", issuer:"State Street", yahooCode:"SPY",  leverage:1, ter:0.0945, benchmark:"S&P 500" },
  { code:"VOO",  isuCd:"VOO",  name:"Vanguard S&P 500 ETF",           sector:"미국시장", issuer:"Vanguard",     yahooCode:"VOO",  leverage:1, ter:0.03,   benchmark:"S&P 500" },
  { code:"IVV",  isuCd:"IVV",  name:"iShares Core S&P 500 ETF",       sector:"미국시장", issuer:"BlackRock",    yahooCode:"IVV",  leverage:1, ter:0.03,   benchmark:"S&P 500" },
  { code:"VTI",  isuCd:"VTI",  name:"Vanguard Total Stock Market ETF", sector:"미국시장", issuer:"Vanguard",     yahooCode:"VTI",  leverage:1, ter:0.03,   benchmark:"CRSP US Total Market" },
  // 나스닥
  { code:"QQQ",  isuCd:"QQQ",  name:"Invesco QQQ (Nasdaq-100)",        sector:"미국나스닥", issuer:"Invesco",    yahooCode:"QQQ",  leverage:1, ter:0.20,   benchmark:"Nasdaq-100" },
  { code:"QQQM", isuCd:"QQQM", name:"Invesco Nasdaq-100 ETF",          sector:"미국나스닥", issuer:"Invesco",    yahooCode:"QQQM", leverage:1, ter:0.15,   benchmark:"Nasdaq-100" },
  // 기술·반도체
  { code:"VGT",  isuCd:"VGT",  name:"Vanguard Information Technology", sector:"미국반도체", issuer:"Vanguard",   yahooCode:"VGT",  leverage:1, ter:0.10,   benchmark:"MSCI US IMI Info Tech" },
  { code:"XLK",  isuCd:"XLK",  name:"Technology Select Sector SPDR",   sector:"미국반도체", issuer:"State Street",yahooCode:"XLK",  leverage:1, ter:0.09,   benchmark:"S&P Tech Sector" },
  { code:"SOXX", isuCd:"SOXX", name:"iShares Semiconductor ETF",        sector:"미국반도체", issuer:"BlackRock",  yahooCode:"SOXX", leverage:1, ter:0.35,   benchmark:"ICE Semiconductor" },
  { code:"SMH",  isuCd:"SMH",  name:"VanEck Semiconductor ETF",         sector:"미국반도체", issuer:"VanEck",     yahooCode:"SMH",  leverage:1, ter:0.35,   benchmark:"MVIS US Listed Semiconductor" },
  // 헬스케어
  { code:"XLV",  isuCd:"XLV",  name:"Health Care Select Sector SPDR",   sector:"미국헬스케어", issuer:"State Street",yahooCode:"XLV", leverage:1, ter:0.09,  benchmark:"S&P Healthcare Sector" },
  { code:"IBB",  isuCd:"IBB",  name:"iShares Biotechnology ETF",         sector:"미국헬스케어", issuer:"BlackRock",  yahooCode:"IBB", leverage:1, ter:0.44,  benchmark:"ICE Biotechnology" },
  // 금융
  { code:"XLF",  isuCd:"XLF",  name:"Financial Select Sector SPDR",     sector:"미국금융", issuer:"State Street", yahooCode:"XLF",  leverage:1, ter:0.09,  benchmark:"S&P Financial Sector" },
  // 에너지
  { code:"XLE",  isuCd:"XLE",  name:"Energy Select Sector SPDR",         sector:"미국에너지", issuer:"State Street",yahooCode:"XLE", leverage:1, ter:0.09,  benchmark:"S&P Energy Sector" },
  // 혁신·테마
  { code:"ARKK", isuCd:"ARKK", name:"ARK Innovation ETF",                sector:"미국혁신", issuer:"ARK Invest",  yahooCode:"ARKK", leverage:1, ter:1.26,  benchmark:"ARK Innovation" },
  // 항공우주·방산
  { code:"ITA",  isuCd:"ITA",  name:"iShares U.S. Aerospace & Defense",  sector:"항공우주방산", issuer:"BlackRock",  yahooCode:"ITA",  leverage:1, ter:0.40, benchmark:"Dow Jones U.S. Select Aerospace & Defense" },
  { code:"XAR",  isuCd:"XAR",  name:"SPDR S&P Aerospace & Defense ETF",  sector:"항공우주방산", issuer:"State Street",yahooCode:"XAR",  leverage:1, ter:0.35, benchmark:"S&P Aerospace & Defense Select Industry" },
  // 로보틱스·AI
  { code:"BOTZ", isuCd:"BOTZ", name:"Global X Robotics & AI ETF",        sector:"로보틱스AI",  issuer:"Global X",   yahooCode:"BOTZ", leverage:1, ter:0.68, benchmark:"Indxx Global Robotics & AI Thematic" },
  { code:"IRBO", isuCd:"IRBO", name:"iShares Robotics and AI Multisector",sector:"로보틱스AI",  issuer:"BlackRock",  yahooCode:"IRBO", leverage:1, ter:0.47, benchmark:"NYSE FactSet Global Robotics & AI" },
  { code:"ROBO", isuCd:"ROBO", name:"ROBO Global Robotics & Automation",  sector:"로보틱스AI",  issuer:"ROBO Global", yahooCode:"ROBO", leverage:1, ter:0.95, benchmark:"ROBO Global Robotics & Automation" },
  // 사이버보안
  { code:"CIBR", isuCd:"CIBR", name:"First Trust Cybersecurity ETF",     sector:"사이버보안",  issuer:"First Trust", yahooCode:"CIBR", leverage:1, ter:0.60, benchmark:"Nasdaq CTA Cybersecurity" },
  { code:"HACK", isuCd:"HACK", name:"ETFMG Prime Cyber Security ETF",    sector:"사이버보안",  issuer:"ETFMG",       yahooCode:"HACK", leverage:1, ter:0.60, benchmark:"Prime Cyber Defense" },
  // 양자컴퓨팅 (국내)
  { code:"481180", isuCd:"KR7481180005", name:"KODEX 미국AI반도체",       sector:"양자컴퓨팅",  issuer:"삼성자산운용", yahooCode:"481180.KS", leverage:1, ter:0.45, benchmark:"솔랙티브 미국 AI 반도체" },
  // 양자컴퓨팅 (미국)
  { code:"QTUM", isuCd:"QTUM", name:"Defiance Quantum ETF",              sector:"양자컴퓨팅",  issuer:"Defiance",    yahooCode:"QTUM", leverage:1, ter:0.40, benchmark:"BlueStar Quantum Computing & Machine Learning" },
  // 클린에너지
  { code:"ICLN", isuCd:"ICLN", name:"iShares Global Clean Energy ETF",   sector:"클린에너지",  issuer:"BlackRock",  yahooCode:"ICLN", leverage:1, ter:0.40, benchmark:"S&P Global Clean Energy" },
  { code:"QCLN", isuCd:"QCLN", name:"First Trust NASDAQ Clean Energy",   sector:"클린에너지",  issuer:"First Trust", yahooCode:"QCLN", leverage:1, ter:0.60, benchmark:"NASDAQ Clean Edge Green Energy" },
  // 리츠·부동산
  { code:"VNQ",  isuCd:"VNQ",  name:"Vanguard Real Estate ETF",          sector:"리츠",        issuer:"Vanguard",    yahooCode:"VNQ",  leverage:1, ter:0.13, benchmark:"MSCI US Investable Market Real Estate" },
  { code:"IYR",  isuCd:"IYR",  name:"iShares U.S. Real Estate ETF",      sector:"리츠",        issuer:"BlackRock",   yahooCode:"IYR",  leverage:1, ter:0.39, benchmark:"Dow Jones U.S. Real Estate" },
  // 글로벌 신흥국
  { code:"EWY",  isuCd:"EWY",  name:"iShares MSCI South Korea ETF",      sector:"한국시장", issuer:"BlackRock",   yahooCode:"EWY",  leverage:1, ter:0.57,  benchmark:"MSCI Korea" },
  { code:"EEM",  isuCd:"EEM",  name:"iShares MSCI Emerging Markets ETF",  sector:"신흥국",   issuer:"BlackRock",   yahooCode:"EEM",  leverage:1, ter:0.68,  benchmark:"MSCI Emerging Markets" },

  // ── 레버리지 ETF (미국) ─────────────────────────────────────────────────────
  // 나스닥 레버리지
  { code:"TQQQ", isuCd:"TQQQ", name:"ProShares UltraPro QQQ 3X",          sector:"미국나스닥", issuer:"ProShares",   yahooCode:"TQQQ", leverage:3, ter:0.88, benchmark:"Nasdaq-100 ×3" },
  { code:"QLD",  isuCd:"QLD",  name:"ProShares Ultra QQQ 2X",              sector:"미국나스닥", issuer:"ProShares",   yahooCode:"QLD",  leverage:2, ter:0.95, benchmark:"Nasdaq-100 ×2" },
  // S&P 500 레버리지
  { code:"UPRO", isuCd:"UPRO", name:"ProShares UltraPro S&P500 3X",        sector:"미국시장",  issuer:"ProShares",   yahooCode:"UPRO", leverage:3, ter:0.91, benchmark:"S&P 500 ×3" },
  { code:"SPXL", isuCd:"SPXL", name:"Direxion Daily S&P500 Bull 3X",       sector:"미국시장",  issuer:"Direxion",    yahooCode:"SPXL", leverage:3, ter:1.01, benchmark:"S&P 500 ×3" },
  { code:"SSO",  isuCd:"SSO",  name:"ProShares Ultra S&P500 2X",           sector:"미국시장",  issuer:"ProShares",   yahooCode:"SSO",  leverage:2, ter:0.91, benchmark:"S&P 500 ×2" },
  // 반도체 레버리지
  { code:"SOXL", isuCd:"SOXL", name:"Direxion Daily Semiconductors Bull 3X", sector:"미국반도체", issuer:"Direxion",  yahooCode:"SOXL", leverage:3, ter:0.76, benchmark:"ICE Semiconductor ×3" },
  { code:"NVDL", isuCd:"NVDL", name:"GraniteShares 2X Long NVDA",           sector:"미국반도체", issuer:"GraniteShares",yahooCode:"NVDL", leverage:2, ter:1.15, benchmark:"NVDA ×2" },
  { code:"NVDU", isuCd:"NVDU", name:"Direxion Daily NVDA Bull 2X",          sector:"미국반도체", issuer:"Direxion",   yahooCode:"NVDU", leverage:2, ter:1.07, benchmark:"NVDA ×2" },
  // 기술주 레버리지
  { code:"TECL", isuCd:"TECL", name:"Direxion Daily Technology Bull 3X",    sector:"미국반도체", issuer:"Direxion",   yahooCode:"TECL", leverage:3, ter:0.95, benchmark:"S&P Tech Sector ×3" },
  { code:"ROM",  isuCd:"ROM",  name:"ProShares Ultra Technology 2X",        sector:"미국반도체", issuer:"ProShares",  yahooCode:"ROM",  leverage:2, ter:0.95, benchmark:"S&P Tech Sector ×2" },
  // 금융 레버리지
  { code:"FAS",  isuCd:"FAS",  name:"Direxion Daily Financial Bull 3X",     sector:"미국금융",  issuer:"Direxion",   yahooCode:"FAS",  leverage:3, ter:1.01, benchmark:"Russell 1000 Financial ×3" },
  // 에너지 레버리지
  { code:"ERX",  isuCd:"ERX",  name:"Direxion Daily Energy Bull 2X",        sector:"미국에너지", issuer:"Direxion",  yahooCode:"ERX",  leverage:2, ter:0.97, benchmark:"Energy Select Sector ×2" },
  // 바이오 레버리지
  { code:"LABU", isuCd:"LABU", name:"Direxion Daily S&P Biotech Bull 3X",   sector:"미국헬스케어", issuer:"Direxion", yahooCode:"LABU", leverage:3, ter:1.04, benchmark:"S&P Biotechnology Select Industry ×3" },
  // FANG+ 레버리지
  { code:"FNGU", isuCd:"FNGU", name:"MicroSectors FANG+Index 3X Leveraged", sector:"미국혁신",  issuer:"Bank of Montreal", yahooCode:"FNGU", leverage:3, ter:0.95, benchmark:"NYSE FANG+ ×3" },
  { code:"WEBL", isuCd:"WEBL", name:"Direxion Daily Dow Jones Internet Bull 3X", sector:"미국혁신", issuer:"Direxion", yahooCode:"WEBL", leverage:3, ter:1.07, benchmark:"Dow Jones Internet Composite ×3" },

  // ── 국내 레버리지 ETF (추가) ────────────────────────────────────────────────
  { code:"278530", isuCd:"KR7278530007", name:"KODEX 미국나스닥100레버리지(합성 H)",  sector:"미국나스닥", issuer:"삼성자산운용", yahooCode:"278530.KS", leverage:2, ter:0.58, benchmark:"Nasdaq-100 ×2 (환헤지)" },
  { code:"304940", isuCd:"KR7304940005", name:"TIGER 미국S&P500레버리지(합성 H)",    sector:"미국시장",   issuer:"미래에셋",     yahooCode:"304940.KS", leverage:2, ter:0.58, benchmark:"S&P 500 ×2 (환헤지)" },
  { code:"261270", isuCd:"KR7261270000", name:"KODEX 미국나스닥100선물레버리지",     sector:"미국나스닥", issuer:"삼성자산운용", yahooCode:"261270.KS", leverage:2, ter:0.58, benchmark:"Nasdaq-100 선물 ×2" },

  // ── 인버스 ETF (미국) ──────────────────────────────────────────────────────
  // S&P 500 인버스
  { code:"SH",   isuCd:"SH",   name:"ProShares Short S&P500 -1X",           sector:"미국시장",   issuer:"ProShares",  yahooCode:"SH",   leverage:-1, ter:0.88, benchmark:"S&P 500 ×-1" },
  { code:"SDS",  isuCd:"SDS",  name:"ProShares UltraShort S&P500 -2X",      sector:"미국시장",   issuer:"ProShares",  yahooCode:"SDS",  leverage:-2, ter:0.89, benchmark:"S&P 500 ×-2" },
  { code:"SPXS", isuCd:"SPXS", name:"Direxion Daily S&P500 Bear 3X",        sector:"미국시장",   issuer:"Direxion",   yahooCode:"SPXS", leverage:-3, ter:1.01, benchmark:"S&P 500 ×-3" },
  // 나스닥 인버스
  { code:"PSQ",  isuCd:"PSQ",  name:"ProShares Short QQQ -1X",              sector:"미국나스닥", issuer:"ProShares",  yahooCode:"PSQ",  leverage:-1, ter:0.95, benchmark:"Nasdaq-100 ×-1" },
  { code:"QID",  isuCd:"QID",  name:"ProShares UltraShort QQQ -2X",         sector:"미국나스닥", issuer:"ProShares",  yahooCode:"QID",  leverage:-2, ter:0.95, benchmark:"Nasdaq-100 ×-2" },
  { code:"SQQQ", isuCd:"SQQQ", name:"ProShares UltraPro Short QQQ -3X",     sector:"미국나스닥", issuer:"ProShares",  yahooCode:"SQQQ", leverage:-3, ter:0.95, benchmark:"Nasdaq-100 ×-3" },
  // 반도체 인버스
  { code:"SOXS", isuCd:"SOXS", name:"Direxion Daily Semiconductors Bear 3X",sector:"미국반도체", issuer:"Direxion",   yahooCode:"SOXS", leverage:-3, ter:0.76, benchmark:"ICE Semiconductor ×-3" },
  { code:"TECS", isuCd:"TECS", name:"Direxion Daily Technology Bear 3X",    sector:"미국반도체", issuer:"Direxion",   yahooCode:"TECS", leverage:-3, ter:1.08, benchmark:"S&P Tech Sector ×-3" },
  // 금융 인버스
  { code:"FAZ",  isuCd:"FAZ",  name:"Direxion Daily Financial Bear 3X",     sector:"미국금융",   issuer:"Direxion",   yahooCode:"FAZ",  leverage:-3, ter:1.01, benchmark:"Russell 1000 Financial ×-3" },
  // 에너지 인버스
  { code:"ERY",  isuCd:"ERY",  name:"Direxion Daily Energy Bear 2X",        sector:"미국에너지", issuer:"Direxion",   yahooCode:"ERY",  leverage:-2, ter:1.01, benchmark:"Energy Select Sector ×-2" },
  // 바이오 인버스
  { code:"LABD", isuCd:"LABD", name:"Direxion Daily S&P Biotech Bear 3X",   sector:"미국헬스케어",issuer:"Direxion",  yahooCode:"LABD", leverage:-3, ter:1.02, benchmark:"S&P Biotechnology ×-3" },
  // FANG+ 인버스
  { code:"FNGD", isuCd:"FNGD", name:"MicroSectors FANG+Index -3X Inverse",  sector:"미국혁신",   issuer:"Bank of Montreal",yahooCode:"FNGD",leverage:-3,ter:0.95, benchmark:"NYSE FANG+ ×-3" },

  // ── 인버스 ETF (국내) ──────────────────────────────────────────────────────
  { code:"233740", isuCd:"KR7233740003", name:"KODEX 코스닥150선물인버스",   sector:"코스닥",    issuer:"삼성자산운용", yahooCode:"233740.KS", leverage:-1, ter:0.64, benchmark:"KOSDAQ 150 ×-1" },

  // ── 글로벌 / 신흥국 / 한국 집중 ETF ──────────────────────────────────────
  { code:"EWY",  isuCd:"EWY",  name:"iShares MSCI South Korea ETF",    sector:"한국시장",  issuer:"BlackRock", yahooCode:"EWY",  leverage:1, ter:0.57, benchmark:"MSCI Korea" },
  { code:"EEM",  isuCd:"EEM",  name:"iShares MSCI Emerging Markets",   sector:"신흥국",    issuer:"BlackRock", yahooCode:"EEM",  leverage:1, ter:0.70, benchmark:"MSCI Emerging Markets" },
  { code:"VWO",  isuCd:"VWO",  name:"Vanguard FTSE Emerging Markets",  sector:"신흥국",    issuer:"Vanguard",  yahooCode:"VWO",  leverage:1, ter:0.08, benchmark:"FTSE Emerging Markets" },
  { code:"ACWI", isuCd:"ACWI", name:"iShares MSCI ACWI ETF",           sector:"글로벌주식", issuer:"BlackRock", yahooCode:"ACWI", leverage:1, ter:0.32, benchmark:"MSCI ACWI" },
  { code:"VEA",  isuCd:"VEA",  name:"Vanguard FTSE Developed Markets", sector:"선진국",    issuer:"Vanguard",  yahooCode:"VEA",  leverage:1, ter:0.06, benchmark:"FTSE Developed Markets" },
  { code:"EFA",  isuCd:"EFA",  name:"iShares MSCI EAFE ETF",           sector:"선진국",    issuer:"BlackRock", yahooCode:"EFA",  leverage:1, ter:0.32, benchmark:"MSCI EAFE" },
];

export const ALL_ETFS: ETFInfo[] = [...MAJOR_ETFS, ...US_ETFS];

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
  // ── TIGER 미국필라델피아반도체나스닥 (381180) — 필라델피아 SOX 추종 ───────
  "381180": [
    { rank: 1, stockCode:"NVDA",  stockName:"NVIDIA Corp",            weight:26.50 },
    { rank: 2, stockCode:"AVGO",  stockName:"Broadcom Inc",           weight: 9.30 },
    { rank: 3, stockCode:"TSM",   stockName:"Taiwan Semiconductor",   weight: 7.20 },
    { rank: 4, stockCode:"QCOM",  stockName:"Qualcomm Inc",           weight: 6.10 },
    { rank: 5, stockCode:"AMD",   stockName:"Advanced Micro Devices", weight: 5.80 },
    { rank: 6, stockCode:"TXN",   stockName:"Texas Instruments",      weight: 5.10 },
    { rank: 7, stockCode:"AMAT",  stockName:"Applied Materials",      weight: 4.70 },
    { rank: 8, stockCode:"LRCX",  stockName:"Lam Research",           weight: 4.20 },
    { rank: 9, stockCode:"KLAC",  stockName:"KLA Corp",               weight: 3.60 },
    { rank:10, stockCode:"MU",    stockName:"Micron Technology",      weight: 3.30 },
    { rank:11, stockCode:"ON",    stockName:"ON Semiconductor",       weight: 2.80 },
    { rank:12, stockCode:"ADI",   stockName:"Analog Devices",         weight: 2.60 },
    { rank:13, stockCode:"MRVL",  stockName:"Marvell Technology",     weight: 2.40 },
    { rank:14, stockCode:"MPWR",  stockName:"Monolithic Power",       weight: 2.10 },
    { rank:15, stockCode:"INTC",  stockName:"Intel Corp",             weight: 1.80 },
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
  // ── ACE 미국빅테크TOP7Plus (396520) — 미국 빅테크 7개 + 알파 (한국투자신탁운용) ──
  "396520": [
    { rank: 1, stockCode:"AAPL",  stockName:"Apple Inc",                weight:15.20 },
    { rank: 2, stockCode:"MSFT",  stockName:"Microsoft Corp",           weight:14.80 },
    { rank: 3, stockCode:"NVDA",  stockName:"NVIDIA Corp",              weight:14.30 },
    { rank: 4, stockCode:"AMZN",  stockName:"Amazon.com Inc",           weight:12.10 },
    { rank: 5, stockCode:"META",  stockName:"Meta Platforms Inc",       weight:11.50 },
    { rank: 6, stockCode:"GOOGL", stockName:"Alphabet Inc Cl A",        weight: 9.80 },
    { rank: 7, stockCode:"TSLA",  stockName:"Tesla Inc",                weight: 8.40 },
    { rank: 8, stockCode:"AVGO",  stockName:"Broadcom Inc",             weight: 5.20 },
    { rank: 9, stockCode:"ORCL",  stockName:"Oracle Corp",              weight: 4.10 },
    { rank:10, stockCode:"CASH",  stockName:"현금·기타",                weight: 4.60 },
  ],
  // ── ACE 미국AI반도체&전력인프라TOP10 (498100) — AI 반도체 + 전력인프라 (한국투자신탁운용) ──
  "498100": [
    { rank: 1, stockCode:"NVDA",  stockName:"NVIDIA Corp",              weight:20.50 },
    { rank: 2, stockCode:"AVGO",  stockName:"Broadcom Inc",             weight:12.30 },
    { rank: 3, stockCode:"AMD",   stockName:"Advanced Micro Devices",   weight:10.20 },
    { rank: 4, stockCode:"TSM",   stockName:"Taiwan Semiconductor ADR", weight: 9.80 },
    { rank: 5, stockCode:"ETN",   stockName:"Eaton Corp",               weight: 9.10 },
    { rank: 6, stockCode:"GEV",   stockName:"GE Vernova Inc",           weight: 8.70 },
    { rank: 7, stockCode:"PWR",   stockName:"Quanta Services Inc",      weight: 8.20 },
    { rank: 8, stockCode:"CEG",   stockName:"Constellation Energy",     weight: 7.90 },
    { rank: 9, stockCode:"VST",   stockName:"Vistra Corp",              weight: 7.30 },
    { rank:10, stockCode:"INTC",  stockName:"Intel Corp",               weight: 6.00 },
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

/** YYYYMMDD → "YYYY년 MM월 DD일" */
function yyyymmddToKorean(d: string): string {
  return `${d.slice(0, 4)}년 ${d.slice(4, 6)}월 ${d.slice(6, 8)}일`;
}

/** KRX 데이터가 실제로 존재하는 가장 최근 영업일 (장마감 후 15:30 KST 기준) */
function lastKrxTradingDay(): string {
  const nowKst = Date.now() + 9 * 3600_000;
  const d = new Date(nowKst);
  const hourKst = d.getUTCHours() + d.getUTCMinutes() / 60;

  // 15:30 KST 이전이면 당일 데이터 미게재 → 하루 전으로
  if (hourKst < 15.5) d.setUTCDate(d.getUTCDate() - 1);

  // 주말 건너뜀 (토 → 금, 일 → 금)
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() - 1);
  else if (dow === 0) d.setUTCDate(d.getUTCDate() - 2);

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

async function samsungFundFetchHoldings(code: string): Promise<{ holdings: ETFHolding[]; dataDate: string }> {
  const fid = SF_FID_MAP[code];
  if (!fid) return { holdings: [], dataDate: "" };

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
    if (!res.ok) return { holdings: [], dataDate: "" };
    const json = await res.json() as any;
    const pdf = json?.pdf;
    const list: any[] = pdf?.list ?? [];
    if (!list.length) return { holdings: [], dataDate: "" };

    // 삼성펀드 API 응답의 실제 공시 기준일 ("20260522" → "2026년 05월 22일")
    const rawDate: string = String(pdf?.gijunYMD ?? "");
    const dataDate = rawDate.length === 8
      ? yyyymmddToKorean(rawDate)
      : tsToKstDateStr(Date.now());

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

    return { holdings, dataDate };
  } catch {
    return { holdings: [], dataDate: "" };
  }
}

// ─── TIMEFOLIO ETF 구성종목 크롤러 ──────────────────────────────────────────────
// timeetf.co.kr/past_pdf_json.php?idx={idx}&cate=001&period=latest
// 응답: {"today":[{"prodNm":"NVIDIA Corp","wei":"8.91","increaseWei":"신규"}, ...]}

const TIMEFOLIO_IDX_MAP: Record<string, number> = {
  "426030": 2,   // TIME 미국나스닥100액티브
  "426020": 5,   // TIME 미국S&P500액티브
  "456600": 6,   // TIME 글로벌AI인공지능액티브
  "494180": 8,   // TIME 글로벌소비트렌드액티브
  "485810": 9,   // TIME 글로벌바이오액티브
  "478150": 20,  // TIME 글로벌우주테크&방산액티브
};

async function timefolioFetchHoldings(code: string): Promise<{ holdings: ETFHolding[]; dataDate: string }> {
  const idx = TIMEFOLIO_IDX_MAP[code];
  if (!idx) return { holdings: [], dataDate: "" };

  const url = `https://timeetf.co.kr/past_pdf_json.php?idx=${idx}&cate=001&period=latest`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":     "application/json",
        "Referer":    "https://timeetf.co.kr/",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { holdings: [], dataDate: "" };
    const json = await res.json() as any;
    const today: any[] = json?.today ?? [];
    if (!today.length) return { holdings: [], dataDate: "" };

    const holdings: ETFHolding[] = today
      .filter((item: any) => item.prodNm && parseFloat(item.wei) > 0)
      .map((item: any, i: number) => ({
        rank:      i + 1,
        stockCode: "",               // TIMEFOLIO API는 종목코드 미제공
        stockName: String(item.prodNm ?? ""),
        weight:    parseFloat(String(item.wei)) || 0,
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 20)
      .map((h, i) => ({ ...h, rank: i + 1 }));

    const dataDate = tsToKstDateStr(Date.now());
    return { holdings, dataDate };
  } catch {
    return { holdings: [], dataDate: "" };
  }
}

// ─── 미래에셋 TIGER ETF 구성종목 크롤러 ────────────────────────────────────────
// investments.miraeasset.com/tigeretf  →  pdfListAjax.ajax
// 세션 1개를 공유해서 모든 ETF holdings 조회 (ETF마다 새 세션 불필요)

const MIRAE_BASE        = "https://investments.miraeasset.com/tigeretf/ko/product/search/detail";
const MIRAE_UA          = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const MIRAE_SESSION_TTL = 25 * 60 * 1000; // 25분 (서블릿 기본 세션 30분보다 짧게)

let _miraeSession: { cookieStr: string; jsessionid: string; ts: number } | null = null;
let _miraeSessionFlight: Promise<{ cookieStr: string; jsessionid: string } | null> | null = null;

/** 미래에셋 세션 획득 (캐시된 세션 재사용, 만료 시 재발급) */
async function ensureMiraeSession(): Promise<{ cookieStr: string; jsessionid: string } | null> {
  if (_miraeSession && Date.now() - _miraeSession.ts < MIRAE_SESSION_TTL) {
    return _miraeSession;
  }
  if (_miraeSessionFlight) return _miraeSessionFlight;

  _miraeSessionFlight = (async () => {
    try {
      const res = await fetch(`${MIRAE_BASE}/index.do?ksdFund=KR7491830006`, {
        headers: { "User-Agent": MIRAE_UA, "Accept": "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) return null;
      const rawCookies: string[] = (res.headers as any).getSetCookie?.() ?? [];
      const cookieStr = rawCookies.map((c: string) => c.split(";")[0]).join("; ");
      if (!cookieStr) return null;
      const html = await res.text();
      const jsMatch = html.match(/;jsessionid=([^"';/\s]+)/);
      const jsessionid = jsMatch?.[1] ?? "";
      _miraeSession = { cookieStr, jsessionid, ts: Date.now() };
      return _miraeSession;
    } catch {
      return null;
    } finally {
      _miraeSessionFlight = null;
    }
  })();
  return _miraeSessionFlight;
}

/** HTML에서 ETFHolding 배열 파싱 (국내 6자리 + 해외 US 티커 모두 지원) */
function parseMiraeHoldingsHtml(html: string): ETFHolding[] {
  const holdings: ETFHolding[] = [];
  let rank = 1;
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(td => td[1].replace(/<[^>]+>/g, "").trim().replace(/\s+/g, " "));
    if (tds.length < 3) continue;
    const stockName = tds[0];
    const weightStr = tds[1].replace("%", "").trim();
    const rawCode   = tds[2].trim();
    // "AMD US EQUITY" → "AMD"  |  "005930 KS EQUITY" → "005930"  |  "005930" → "005930"
    const usMatch   = rawCode.match(/^([A-Z]{1,6})\s+US\s+EQUITY/i);
    const ksMatch   = rawCode.match(/^(\d{6})\s+KS?\s+EQUITY/i);
    const stockCode = usMatch?.[1]?.toUpperCase() ?? ksMatch?.[1] ?? rawCode.replace(/\s/g, "");
    const weight    = parseFloat(weightStr);
    if (!stockCode || (!/^\d{6}$/.test(stockCode) && !/^[A-Z]{1,6}$/.test(stockCode)) || isNaN(weight) || weight <= 0) continue;
    holdings.push({ rank: rank++, stockCode, stockName, weight });
  }
  return holdings;
}

/** 공유 세션으로 단일 ETF의 holdings + 기준일 조회 */
async function miraeHoldingsWithSession(
  isuCd: string,
  session: { cookieStr: string; jsessionid: string },
): Promise<{ holdings: ETFHolding[]; dataDate: string }> {
  const ajaxUrl = (path: string) =>
    `${MIRAE_BASE}/${path}` + (session.jsessionid ? `;jsessionid=${session.jsessionid}` : "");

  const commonHeaders = {
    "User-Agent":       MIRAE_UA,
    "Cookie":           session.cookieStr,
    "X-Requested-With": "XMLHttpRequest",
    "Referer":          `${MIRAE_BASE}/index.do?ksdFund=${isuCd}`,
    "Content-Type":     "application/x-www-form-urlencoded",
  };

  let dataDate = "";
  try {
    const pdRes = await fetch(ajaxUrl("pdf.ajax"), {
      method: "POST",
      headers: commonHeaders,
      body: `ksdFund=${isuCd}&pageIndex=1&firstIndex=0&listCnt=10`,
      signal: AbortSignal.timeout(10000),
    });
    if (pdRes.ok) {
      const pdHtml = await pdRes.text();
      const dm = pdHtml.match(/name="fixDate"[^>]*value="(\d{4}\.\d{2}\.\d{2})"/);
      if (dm) dataDate = yyyymmddToKorean(dm[1].replace(/\./g, ""));
    }
  } catch { /* 기준일 없으면 생략 */ }

  const listRes = await fetch(ajaxUrl("pdfListAjax.ajax"), {
    method: "POST",
    headers: commonHeaders,
    body: `ksdFund=${isuCd}&pageIndex=1&firstIndex=0&listCnt=50&order=SRD`,
    signal: AbortSignal.timeout(12000),
  });
  if (!listRes.ok) return { holdings: [], dataDate };

  const html = await listRes.text();
  const holdings = parseMiraeHoldingsHtml(html);
  return { holdings, dataDate: dataDate || tsToKstDateStr(Date.now()) };
}

/** 단일 ETF holdings 조회 (세션 자동 관리, 만료 시 재시도) */
async function miraeFundFetchHoldings(isuCd: string): Promise<{ holdings: ETFHolding[]; dataDate: string }> {
  try {
    const session = await ensureMiraeSession();
    if (!session) return { holdings: [], dataDate: "" };
    const result = await miraeHoldingsWithSession(isuCd, session);
    // 빈 결과 = 세션 만료 가능성 → 세션 초기화 후 1회 재시도
    if (result.holdings.length === 0 && _miraeSession) {
      _miraeSession = null;
      const fresh = await ensureMiraeSession();
      if (fresh) return miraeHoldingsWithSession(isuCd, fresh);
    }
    return result;
  } catch {
    return { holdings: [], dataDate: "" };
  }
}

/** TIGER ETF 전체 holdings 일괄 사전로딩
 *  세션 1개로 모든 isuCd를 순차 조회 → holdingsCache에 저장
 *  @returns { fetched, skipped } — 캐시 히트는 skipped로 카운트 */
export async function miraePreFetchAllHoldings(
  isuCds: string[],
): Promise<{ fetched: number; skipped: number; errors: number }> {
  let session = await ensureMiraeSession();
  if (!session) return { fetched: 0, skipped: 0, errors: isuCds.length };

  let fetched = 0, skipped = 0, errors = 0;
  for (const isuCd of isuCds) {
    const code = isuCd.substring(3, 9); // KR7XXXXXXY → XXXXXX
    const hit  = holdingsCache.get(code);
    if (hit && Date.now() - hit.ts < HOLDINGS_TTL) { skipped++; continue; }

    try {
      const { holdings, dataDate } = await miraeHoldingsWithSession(isuCd, session!);
      if (holdings.length > 0) {
        holdingsCache.set(code, { data: holdings, ts: Date.now(), source: "mirae" });
        fetched++;
      } else {
        errors++;
      }
    } catch {
      // 세션 만료 → 갱신 후 재시도
      _miraeSession = null;
      session = await ensureMiraeSession();
      if (!session) { errors++; continue; }
      try {
        const { holdings } = await miraeHoldingsWithSession(isuCd, session);
        if (holdings.length > 0) {
          holdingsCache.set(code, { data: holdings, ts: Date.now(), source: "mirae" });
          fetched++;
        } else errors++;
      } catch { errors++; }
    }

    await new Promise(r => setTimeout(r, 80)); // 서버 부하 방지 (80ms 간격)
  }
  return { fetched, skipped, errors };
}

// ─── KRX ETF 구성 종목 조회 ───────────────────────────────────────────────────

async function krxFetchHoldings(isuCd: string): Promise<ETFHolding[]> {
  const trdDd = lastKrxTradingDay();
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

export type DataSource = "kis" | "samsung" | "mirae" | "krx" | "yahoo" | "reference" | "timefolio";
export type HoldingsResult = { holdings: ETFHolding[]; source: DataSource; dataDate: string; changes?: HoldingsChanges | null };

// ─── ETF 리밸런싱 추적 ────────────────────────────────────────────────────────

const SNAPSHOT_TTL_DAYS = 90;
const WEIGHT_THRESHOLD  = 0.15; // 비중 변화 최소 임계값 (%)

interface SnapshotData {
  holdings: ETFHolding[];
  date: string;
}

async function loadHoldingsSnapshot(code: string): Promise<SnapshotData | null> {
  try {
    const res = await pool.query<{ data: SnapshotData }>(
      "SELECT data FROM system_cache WHERE key = $1 AND expires_at > NOW()",
      [`etf_snapshot:${code}`]
    );
    return res.rows[0]?.data ?? null;
  } catch {
    return null;
  }
}

async function saveHoldingsSnapshot(code: string, holdings: ETFHolding[], date: string): Promise<void> {
  try {
    const expiry = new Date(Date.now() + SNAPSHOT_TTL_DAYS * 86_400_000);
    const data: SnapshotData = { holdings, date };
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
      [`etf_snapshot:${code}`, JSON.stringify(data), expiry]
    );
  } catch {
    // 스냅샷 저장 실패는 조용히 무시 (메인 기능에 영향 없음)
  }
}

function computeHoldingsDiff(
  prev: ETFHolding[],
  curr: ETFHolding[],
  previousDate: string,
  currentDate: string,
): HoldingsChanges {
  const prevMap = new Map(prev.map(h => [h.stockCode, h]));
  const currMap = new Map(curr.map(h => [h.stockCode, h]));

  const added:     HoldingChangeItem[] = [];
  const removed:   HoldingChangeItem[] = [];
  const increased: HoldingChangeItem[] = [];
  const decreased: HoldingChangeItem[] = [];

  for (const [code, ch] of currMap) {
    if (!code) continue;
    const ph = prevMap.get(code);
    if (!ph) {
      added.push({ stockCode: ch.stockCode, stockName: ch.stockName, weight: ch.weight, rank: ch.rank });
    } else {
      const delta = ch.weight - ph.weight;
      if (Math.abs(delta) >= WEIGHT_THRESHOLD) {
        const item: HoldingChangeItem = {
          stockCode: ch.stockCode, stockName: ch.stockName,
          weight: ch.weight, weightDelta: delta,
          prevWeight: ph.weight, prevRank: ph.rank, rank: ch.rank,
        };
        if (delta > 0) increased.push(item);
        else           decreased.push(item);
      }
    }
  }

  for (const [code, ph] of prevMap) {
    if (!code) continue;
    if (!currMap.has(code)) {
      removed.push({ stockCode: ph.stockCode, stockName: ph.stockName, weight: ph.weight, prevRank: ph.rank });
    }
  }

  increased.sort((a, b) => (b.weightDelta ?? 0) - (a.weightDelta ?? 0));
  decreased.sort((a, b) => (a.weightDelta ?? 0) - (b.weightDelta ?? 0));

  return { added, removed, increased, decreased, previousDate, currentDate };
}

export async function trackHoldingsChanges(
  code: string,
  holdings: ETFHolding[],
  dataDate: string,
): Promise<HoldingsChanges | null> {
  if (holdings.length < 3) return null;
  const snapshot = await loadHoldingsSnapshot(code);

  if (!snapshot || snapshot.date === dataDate) {
    if (!snapshot) {
      saveHoldingsSnapshot(code, holdings, dataDate).catch(() => {});
    }
    return null;
  }

  const changes = computeHoldingsDiff(snapshot.holdings, holdings, snapshot.date, dataDate);
  const hasAny = changes.added.length + changes.removed.length + changes.increased.length + changes.decreased.length > 0;

  saveHoldingsSnapshot(code, holdings, dataDate).catch(() => {});
  return hasAny ? changes : null;
}

function tsToKstDateStr(ts: number): string {
  const d = new Date(ts + 9 * 3600_000);
  const y = d.toISOString().slice(0, 10);
  const [year, month, day] = y.split("-");
  return `${year}년 ${month}월 ${day}일`;
}

/** ETF 구성 종목 조회
 *  우선순위: KIS → TIMEFOLIO(TIME ETF) → 삼성펀드(KODEX) → 미래에셋(TIGER) → KRX → 정적 폴백
 *  미국 ETF는 Yahoo Finance 별도 경로.
 *  @param isuCd  MAJOR_ETFS에 없는 ETF도 KRX 폴백이 가능하도록 ISIN을 외부에서 주입 */
export async function getEtfHoldings(code: string, isuCd?: string): Promise<HoldingsResult> {
  // 미국 ETF 분기 (알파벳 코드)
  if (US_ETFS.find(e => e.code === code)) {
    return getUsEtfHoldings(code);
  }

  const cached = holdingsCache.get(code);
  if (cached && Date.now() - cached.ts < HOLDINGS_TTL) {
    return {
      holdings: cached.data,
      source: cached.source as DataSource,
      dataDate: tsToKstDateStr(cached.ts),
    };
  }

  const etf = MAJOR_ETFS.find(e => e.code === code);
  const resolvedIsuCd = etf?.isuCd ?? isuCd;
  const now = Date.now();

  // 1) KIS API (실시간) — 6자리 종목코드만으로 모든 상장 ETF 조회 가능
  const kisData = await kisGetEtfHoldings(code);
  if (kisData.length >= 3) {
    holdingsCache.set(code, { data: kisData, ts: now, source: "kis" });
    return { holdings: kisData, source: "kis", dataDate: tsToKstDateStr(now) };
  }

  // 2) TIMEFOLIO 전용 API (TIME ETF — prodNm·wei 형태로 직접 반환)
  if (TIMEFOLIO_IDX_MAP[code]) {
    const { holdings: tfData, dataDate: tfDate } = await timefolioFetchHoldings(code);
    if (tfData.length >= 3) {
      holdingsCache.set(code, { data: tfData, ts: now, source: "timefolio" as DataSource });
      return { holdings: tfData, source: "timefolio" as DataSource, dataDate: tfDate || tsToKstDateStr(now) };
    }
  }

  // 3) Samsung Fund 모바일 API (KODEX ETF 전용)
  if (etf) {
    const { holdings: sfData, dataDate: sfDate } = await samsungFundFetchHoldings(code);
    if (sfData.length >= 3) {
      holdingsCache.set(code, { data: sfData, ts: now, source: "samsung" });
      return { holdings: sfData, source: "samsung", dataDate: sfDate || tsToKstDateStr(now) };
    }
  }

  // 4) 미래에셋 TIGER ETF 구성종목 API (ISIN 필요)
  if (resolvedIsuCd) {
    const miraeIsuCd = isuCd || resolvedIsuCd;
    const { holdings: maData, dataDate: maDate } = await miraeFundFetchHoldings(miraeIsuCd);
    if (maData.length >= 3) {
      holdingsCache.set(code, { data: maData, ts: now, source: "mirae" });
      return { holdings: maData, source: "mirae", dataDate: maDate || tsToKstDateStr(now) };
    }
  }

  // 5) KRX 스크래핑 (ISIN 필요)
  if (resolvedIsuCd) {
    const krxTrdDd = lastKrxTradingDay();
    const krxData  = await krxFetchHoldings(resolvedIsuCd);
    if (krxData.length >= 3) {
      holdingsCache.set(code, { data: krxData, ts: now, source: "krx" });
      return { holdings: krxData, source: "krx", dataDate: yyyymmddToKorean(krxTrdDd) };
    }
  }

  // 6) 정적 데이터 우선 확인 — pykrx(30초+)보다 먼저 반환하여 빠른 응답 보장
  const staticEarly = STATIC_HOLDINGS[code];
  if (staticEarly && staticEarly.length > 0) {
    holdingsCache.set(code, { data: staticEarly, ts: now, source: "reference" });
    return { holdings: staticEarly, source: "reference", dataDate: tsToKstDateStr(now) };
  }

  // 7) pykrx fallback — KRX 로그인으로 6자리 코드 직접 조회 (RISE/PLUS/ACE 등 isuCd 부정확한 ETF 구제)
  const pykrxData = await fetchEtfHoldingsPykrx(code);
  if (pykrxData.length >= 3) {
    holdingsCache.set(code, { data: pykrxData, ts: now, source: "krx" });
    return { holdings: pykrxData, source: "krx", dataDate: tsToKstDateStr(now) };
  }

  // 8) 최종 폴백 (모든 API 실패 시)
  holdingsCache.set(code, { data: [], ts: now, source: "reference" });
  return { holdings: [], source: "reference", dataDate: tsToKstDateStr(now) };
}

/** 미국 ETF 구성 종목 조회 (Yahoo Finance topHoldings) */
async function getUsEtfHoldings(code: string): Promise<HoldingsResult> {
  const cached = holdingsCache.get(code);
  if (cached && Date.now() - cached.ts < HOLDINGS_TTL) {
    return {
      holdings: cached.data,
      source: cached.source as DataSource,
      dataDate: tsToKstDateStr(cached.ts),
    };
  }
  try {
    const summary = await yf.quoteSummary(code, { modules: ["topHoldings"] as any });
    const raw: Array<{ symbol?: string; holdingName?: string; holdingPercent?: number }> =
      (summary as any).topHoldings?.holdings ?? [];
    if (raw.length === 0) return { holdings: [], source: "reference", dataDate: "" };
    const holdings: ETFHolding[] = raw.slice(0, 25).map((h, i) => ({
      rank:      i + 1,
      stockCode: h.symbol ?? "",
      stockName: h.holdingName ?? h.symbol ?? "",
      weight:    Math.round((h.holdingPercent ?? 0) * 10000) / 100,
    }));
    const now = Date.now();
    holdingsCache.set(code, { data: holdings, ts: now, source: "yahoo" });
    return { holdings, source: "yahoo", dataDate: tsToKstDateStr(now) };
  } catch {
    return { holdings: [], source: "reference", dataDate: "" };
  }
}

/** ETF 검색 (국내 + 미국) */
export function searchEtf(query: string, extraEtfs: ETFInfo[] = []): ETFInfo[] {
  const q = query.trim().toLowerCase();
  // extraEtfs는 tiger-etf-scraper 등에서 주입 (순환 의존 방지)
  const existingCodes = new Set(ALL_ETFS.map(e => e.code));
  const merged = [...ALL_ETFS, ...extraEtfs.filter(e => !existingCodes.has(e.code))];
  if (!q) return merged;
  return merged.filter(e =>
    e.code.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) ||
    e.sector.toLowerCase().includes(q) || e.issuer.toLowerCase().includes(q)
  );
}

/** 종목 → 포함된 ETF 목록 */
export async function getStockExposure(
  query: string,
): Promise<{ etf: ETFInfo; holding: ETFHolding }[]> {
  const raw = query.trim();
  // 한국 종목 코드의 "A" 접두어만 제거 (AAPL 같은 미국 티커는 그대로)
  const q = /^A\d{6}$/.test(raw) ? raw.slice(1) : raw;
  const qLow = q.toLowerCase();

  // 국내 ETF는 즉시 (캐시 기반), US ETF는 병렬 조회
  const results = await Promise.allSettled(
    ALL_ETFS.map(async etf => {
      const { holdings } = await getEtfHoldings(etf.code);
      return { etf, holdings };
    })
  );

  const found: { etf: ETFInfo; holding: ETFHolding }[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { etf, holdings } = r.value;
    const match = holdings.find(h => {
      // Yahoo Finance 코드는 "005930.KS" 형태 → 접미사 제거 후 비교
      const normalizedCode = h.stockCode.toLowerCase().replace(/\.(ks|kq|ko|t|hk|l|de|pa|as)$/i, "");
      return (
        normalizedCode === qLow ||
        h.stockCode.toLowerCase() === qLow ||
        h.stockName.toLowerCase() === qLow ||
        h.stockName.toLowerCase().includes(qLow)
      );
    });
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

// ─── ETF 모멘텀 분석 (매크로 기반) ───────────────────────────────────────────

export interface MacroSnapshot {
  krRate: number;
  usRate: number;
  krCpi: number;
  usCpi: number;
  krwUsd: number;
  wti: number;
  gdpQoQ: number;
  yieldSpread: number;
}

export interface MacroEnvironment {
  rateLevel: "high" | "moderate" | "low";
  inflation: "elevated" | "moderate" | "low";
  fxKrw: "weak" | "neutral" | "strong";
  growth: "strong" | "moderate" | "weak";
  oilPrice: "high" | "moderate" | "low";
  theme: string;
}

export interface SectorMomentum {
  id: string;
  name: string;
  icon: string;
  score: number;
  outlook: "bullish" | "neutral" | "cautious";
  horizon: string;
  reason: string;
  catalysts: string[];
  risks: string[];
  sectorTags: string[];
}

export interface MarketSignal {
  id: string;
  category: "수급" | "심리" | "기술적" | "매크로" | "테마";
  label: string;
  description: string;
  impact: "positive" | "negative" | "neutral";
  strength: "strong" | "moderate" | "weak";
  icon: string;
  sectorTags: string[];
}

export interface ThemeKeyword {
  label: string;
  description: string;
  sentiment: "hot" | "warm" | "cool";
  relatedSectors: string[];
}

export interface InstitutionalFlow {
  sector: string;
  direction: "in" | "out" | "watch";
  reason: string;
  strength: number;
}

export interface MarketPulse {
  fearGreedScore: number;
  fearGreedLabel: string;
  overallSentiment: "bullish" | "neutral" | "bearish";
  signals: MarketSignal[];
  themes: ThemeKeyword[];
  institutionalFocus: string[];
  institutionalFlow: InstitutionalFlow[];
  retailWarning: string[];
  marketNarrative: string;
}

export interface MomentumAnalysis {
  macro: MacroSnapshot;
  environment: MacroEnvironment;
  nowSectors: SectorMomentum[];
  futureSectors: SectorMomentum[];
  marketPulse: MarketPulse;
  updatedAt: number;
}

function buildEnvironment(m: MacroSnapshot): MacroEnvironment {
  const rateLevel: "high" | "moderate" | "low" =
    m.usRate > 3.5 ? "high" : m.usRate > 2.0 ? "moderate" : "low";
  const inflation: "elevated" | "moderate" | "low" =
    m.usCpi > 3.5 ? "elevated" : m.usCpi > 2.0 ? "moderate" : "low";
  const fxKrw: "weak" | "neutral" | "strong" =
    m.krwUsd > 1400 ? "weak" : m.krwUsd > 1200 ? "neutral" : "strong";
  const growth: "strong" | "moderate" | "weak" =
    m.gdpQoQ > 2.0 ? "strong" : m.gdpQoQ > 0.5 ? "moderate" : "weak";
  const oilPrice: "high" | "moderate" | "low" =
    m.wti > 90 ? "high" : m.wti > 60 ? "moderate" : "low";

  const themes: string[] = [];
  if (rateLevel === "high") themes.push("고금리 지속");
  if (inflation === "elevated") themes.push("인플레이션 상승");
  if (fxKrw === "weak") themes.push("원화 약세");
  if (oilPrice === "high") themes.push("유가 강세");
  themes.push("AI 투자 사이클 진행 중");

  return { rateLevel, inflation, fxKrw, growth, oilPrice, theme: themes.slice(0, 4).join(" · ") };
}

function buildSectors(env: MacroEnvironment, m: MacroSnapshot): {
  now: SectorMomentum[];
  future: SectorMomentum[];
} {
  const { rateLevel, inflation, fxKrw, growth, oilPrice } = env;

  // ── 지금 유망 섹터 ──────────────────────────────────────────────────
  const now: SectorMomentum[] = [];

  // 반도체: AI cycle 주도
  {
    let s = 65;
    s += 20;                                // AI 인프라 수요
    if (rateLevel === "high") s -= 8;       // 고금리 밸류에이션 부담
    if (growth !== "weak") s += 5;
    now.push({
      id: "semi", name: "반도체", icon: "🔬",
      score: Math.min(100, Math.round(s)),
      outlook: "bullish", horizon: "단기~중기",
      reason: `AI 데이터센터 투자 사이클이 반도체 수요를 강력히 견인 중. HBM·고사양 메모리 공급 부족 지속으로 가격 우위 유지.`,
      catalysts: ["AI 서버 투자 확대", "HBM 가격 상승 지속", "글로벌 반도체 재고 정상화"],
      risks: ["고금리로 인한 성장주 밸류에이션 부담", "중국 반도체 규제 불확실성"],
      sectorTags: ["반도체", "미국반도체"],
    });
  }

  // 미국시장: 약원화 = 환차익
  {
    let s = 60;
    if (fxKrw === "weak") s += 20;
    if (rateLevel === "high") s -= 5;
    if (growth !== "weak") s += 8;
    now.push({
      id: "us-market", name: "미국시장", icon: "🇺🇸",
      score: Math.min(100, Math.round(s)),
      outlook: "bullish", horizon: "단기",
      reason: `원/달러 ${m.krwUsd.toLocaleString()}원 수준의 원화 약세로 해외 투자 시 환차익 효과 극대화. 미국 경제의 상대적 강세 유지.`,
      catalysts: ["원화 약세 → 환차익 기대", "S&P500 실적 견조", "미국 경제 연착륙 기대"],
      risks: ["환율 반전 시 수익 감소", "미국 소비 둔화 가능성"],
      sectorTags: ["미국시장", "미국나스닥", "해외주식"],
    });
  }

  // 원자재/에너지: 고유가 + 인플레이션
  {
    let s = 55;
    if (oilPrice === "high") s += 18;
    if (inflation === "elevated") s += 12;
    if (fxKrw === "weak") s -= 5;
    now.push({
      id: "commodity", name: "원자재·에너지", icon: "🛢️",
      score: Math.min(100, Math.round(s)),
      outlook: s >= 70 ? "bullish" : "neutral", horizon: "단기",
      reason: `WTI $${m.wti.toFixed(0)} 수준의 고유가와 물가 상승 압력이 원자재·에너지 섹터를 지지. 인플레이션 헷지 수요 유입 중.`,
      catalysts: ["유가 강세 지속", "인플레이션 헷지 수요", "OPEC+ 감산 기조 유지"],
      risks: ["경기 침체 시 에너지 수요 급감", "신재생에너지 전환 가속"],
      sectorTags: ["원자재", "미국에너지"],
    });
  }

  // 금융: 고금리 수혜
  {
    let s = 55;
    if (rateLevel === "high") s += 18;
    if (m.yieldSpread > 0.3) s += 10;
    if (growth !== "weak") s += 5;
    now.push({
      id: "financial", name: "금융", icon: "🏦",
      score: Math.min(100, Math.round(s)),
      outlook: s >= 70 ? "bullish" : "neutral", horizon: "단기~중기",
      reason: `미국 기준금리 ${m.usRate}%, 한국 ${m.krRate}% 고점 유지로 은행 순이자마진(NIM) 극대화. 장단기 금리차 정상 유지(+${m.yieldSpread.toFixed(2)}%).`,
      catalysts: ["NIM 확대 수혜", "장단기 금리차 정상화", "주주환원 배당 확대"],
      risks: ["대출 연체율 상승 우려", "금리 인하 시 NIM 축소 전환"],
      sectorTags: ["금융", "미국금융"],
    });
  }

  // 항공우주·방산: 고유가·지정학 리스크
  {
    let s = 52;
    if (oilPrice === "high") s += 15;    // 고유가 = 지정학 긴장 프록시
    if (growth !== "weak") s += 8;
    if (fxKrw === "weak") s += 5;        // 달러 강세 = 방산 수출 유리
    now.push({
      id: "aerospace", name: "항공우주·방산", icon: "🛸",
      score: Math.min(100, Math.round(s)),
      outlook: s >= 68 ? "bullish" : "neutral", horizon: "단기~중기",
      reason: `유가 $${m.wti.toFixed(0)} 고공행진이 지정학 리스크 고조 신호. 글로벌 방위비 증가 기조와 우주·위성 인프라 투자 확대가 ITA·XAR 모멘텀을 지지.`,
      catalysts: ["글로벌 방위비 지출 확대", "우주 경제 인프라 투자", "달러 강세 방산 수출 유리"],
      risks: ["지정학 완화 시 방산주 조정", "금리 부담으로 장기 프로젝트 비용 증가"],
      sectorTags: ["항공우주방산"],
    });
  }

  // 로보틱스·AI: AI 인프라 사이클
  {
    let s = 60;
    s += 12;                              // AI 인프라 수요 항상 플러스
    if (rateLevel === "high") s -= 5;    // 고금리 밸류에이션 부담
    if (growth !== "weak") s += 5;
    now.push({
      id: "robotics-ai", name: "로보틱스·AI", icon: "🤖",
      score: Math.min(100, Math.round(s)),
      outlook: s >= 68 ? "bullish" : "neutral", horizon: "단기~중기",
      reason: "산업용 로봇 도입 가속 + AI 소프트웨어 수익화 본격화로 BOTZ·IRBO 수혜. 제조업 자동화 투자는 금리와 무관한 구조적 수요.",
      catalysts: ["제조업 자동화 투자 사이클", "AI 추론·에지 컴퓨팅 수요", "인건비 상승 → 로봇 대체 가속"],
      risks: ["고금리로 초기 도입 비용 부담", "AI 기대 밸류에이션 거품 우려"],
      sectorTags: ["로보틱스AI"],
    });
  }

  // 사이버보안: 방어적 + 구조적 성장
  {
    let s = 58;
    s += 8;                               // 디지털 전환 지속
    if (rateLevel === "high") s -= 3;
    if (inflation === "elevated") s += 3; // 불확실성 = 보안 수요 증가
    now.push({
      id: "cybersecurity", name: "사이버보안", icon: "🔐",
      score: Math.min(100, Math.round(s)),
      outlook: "neutral", horizon: "단기~중기",
      reason: "AI·클라우드 확산에 비례해 사이버 위협도 급증. 기업·정부의 보안 예산은 경기와 무관한 필수 지출로 CIBR·HACK 방어주 특성 부각.",
      catalysts: ["AI 기반 사이버 공격 증가", "클라우드 보안 의무화", "정부·방산 사이버 예산 확대"],
      risks: ["빅테크 보안 내재화로 전문 업체 위협", "M&A 프리미엄 소멸 리스크"],
      sectorTags: ["사이버보안"],
    });
  }

  // 점수 내림차순 정렬 (전체 반환)
  const nowTop = now.sort((a, b) => b.score - a.score);

  // ── 향후 유망 섹터 ──────────────────────────────────────────────────
  const future: SectorMomentum[] = [];

  // 기술/성장주: 금리·인플레이션 조건에 따라 다른 내러티브
  {
    let s = 65;
    // 고금리+고인플레이션: 단기 밸류에이션 부담, 인하 기대 없음
    if (rateLevel === "high" && inflation === "elevated") {
      s -= 5;
      future.push({
        id: "growth-tech", name: "기술·성장주", icon: "🚀",
        score: Math.min(100, Math.round(s)),
        outlook: "neutral", horizon: "중기 (3~6개월)",
        reason: `고금리(Fed ${m.usRate}%) + 인플레이션(CPI ${m.usCpi.toFixed(1)}%) 환경에서 성장주 밸류에이션 부담 지속. 단기 금리 인하는 기대하기 어려운 상황이나, AI 실적 모멘텀이 하방을 지지 중.`,
        catalysts: ["AI 인프라 투자 사이클 지속", "빅테크 자사주 매입 확대", "인플레이션 점진적 둔화 신호"],
        risks: [`CPI ${m.usCpi.toFixed(1)}% 고착화 시 고금리 장기화`, "성장주 밸류에이션 추가 조정 가능성", "빅테크 규제 리스크"],
        sectorTags: ["미국나스닥", "IT", "미국반도체"],
      });
    } else if (rateLevel === "high" && inflation === "moderate") {
      // 고금리이지만 인플레이션이 잦아들고 있는 국면
      s += 3;
      future.push({
        id: "growth-tech", name: "기술·성장주", icon: "🚀",
        score: Math.min(100, Math.round(s)),
        outlook: "bullish", horizon: "중기 (3~6개월)",
        reason: `인플레이션이 ${m.usCpi.toFixed(1)}%로 둔화 조짐. 금리 고점 인식이 퍼지면서 성장주 밸류에이션 재평가 기대감이 형성 중. AI 수익화 본격화가 추가 상승 동력.`,
        catalysts: ["CPI 둔화 → 금리 고점 인식", "AI 수익화 가속", "빅테크 실적 호조"],
        risks: ["CPI 재반등 시 고금리 장기화", "빅테크 규제 리스크"],
        sectorTags: ["미국나스닥", "IT", "미국반도체"],
      });
    } else {
      // 금리 인하 사이클 진입 구간 (moderate/low rate)
      s += 8;
      future.push({
        id: "growth-tech", name: "기술·성장주", icon: "🚀",
        score: Math.min(100, Math.round(s)),
        outlook: "bullish", horizon: "중기 (3~6개월)",
        reason: "금리 인하 사이클에서 성장주 밸류에이션 디스카운트 해소. AI 수익화 본격화와 맞물려 나스닥 중심 랠리 기대.",
        catalysts: ["금리 인하 → 할인율 하락", "AI 수익화 가속", "빅테크 실적 호조 지속"],
        risks: ["경기 침체 전환 시 실적 쇼크", "빅테크 규제 리스크"],
        sectorTags: ["미국나스닥", "IT", "미국반도체"],
      });
    }
  }

  // 2차전지: 구조적 반등
  {
    let s = 60;
    if (rateLevel === "high") s -= 5;
    s += 10; // 중국 EV 회복
    future.push({
      id: "ev-battery", name: "2차전지·EV", icon: "🔋",
      score: Math.min(100, Math.round(s)),
      outlook: "neutral", horizon: "중기 (3~6개월)",
      reason: rateLevel === "high"
        ? `고금리(${m.usRate}%) 부담으로 단기 자본 조달 비용 증가 중이나, 현재 저평가 구간 형성 중. 중국 EV 회복·ESS 수요 확대가 구조적 반등 근거.`
        : "금리 부담 완화와 함께 중국 EV 시장 회복·글로벌 ESS 수요 확대가 구조적 반등 근거.",
      catalysts: ["중국 EV 보조금 확대", "ESS 수요 급증", "리튬·양극재 가격 반등"],
      risks: [
        rateLevel === "high" ? "고금리 장기화 시 자본 조달 부담" : "금리 반등 리스크",
        "미국 IRA 수혜 불확실성", "완성차 업체 EV 전략 조정",
      ],
      sectorTags: ["2차전지"],
    });
  }

  // 헬스케어: 방어 + 구조적 성장
  {
    let s = 62;
    if (rateLevel === "high" && inflation === "elevated") s += 3; // 방어주 수요
    future.push({
      id: "healthcare", name: "헬스케어·바이오", icon: "💊",
      score: Math.min(100, Math.round(s)),
      outlook: "neutral", horizon: "장기 (6개월+)",
      reason: rateLevel === "high"
        ? `고금리·고물가 환경에서 경기 방어적 특성이 돋보이는 섹터. GLP-1 비만치료제 · AI 신약 발굴 테마가 금리와 무관한 장기 성장 동력.`
        : "글로벌 고령화 + GLP-1 비만치료제 · AI 신약 발굴 테마가 장기 성장 동력.",
      catalysts: ["GLP-1 비만치료제 시장 확대", "AI 기반 신약 개발 단축", "노인 인구 구조적 증가"],
      risks: ["임상 실패 리스크", "미국 약가 규제 강화"],
      sectorTags: ["헬스케어", "미국헬스케어"],
    });
  }

  // 배당·인컴: 금리 환경에 따라 내러티브 분기
  {
    let s = 58;
    if (rateLevel === "high" && inflation === "elevated") {
      // 고금리·고인플레이션: 금리 인하 기대 없음 → 방어 관점 강조
      s += 3;
      future.push({
        id: "dividend", name: "배당·인컴", icon: "💰",
        score: Math.min(100, Math.round(s)),
        outlook: "neutral", horizon: "중기 (3~6개월)",
        reason: `고금리(${m.usRate}%) 환경에서 예금·채권과 배당주의 경쟁이 심화되지만, 주주환원 확대 기업의 안정적 현금흐름은 방어 자산으로서 매력 유지.`,
        catalysts: ["주주환원 확대 기업 증가", "불확실성 속 방어 자산 수요", "고배당 섹터 수익 안정성"],
        risks: [`금리 ${m.usRate}% 유지 시 예금 대비 배당 매력 약화`, "기업 실적 둔화 시 배당 삭감"],
        sectorTags: ["배당"],
      });
    } else {
      // 금리 인하 가시권 국면
      s += 8;
      future.push({
        id: "dividend", name: "배당·인컴", icon: "💰",
        score: Math.min(100, Math.round(s)),
        outlook: "neutral", horizon: "중기 (3~6개월)",
        reason: "금리 인하 국면에서 고정 수익 대비 배당주 매력 부각. 안정적 현금흐름 + 자본 차익 동시 기대.",
        catalysts: ["금리 인하 → 배당 매력 복원", "주주환원 확대 기업 증가", "방어 자산 수요"],
        risks: ["금리 인하 지연 리스크", "기업 실적 둔화 시 배당 삭감"],
        sectorTags: ["배당"],
      });
    }
  }

  // 양자컴퓨팅: 장기 구조적 테마
  {
    let s = 55;
    s += 10;                              // 구조적 성장 기본값
    if (rateLevel === "high") s -= 8;    // 고금리 = 초기 단계 기업 할인율 부담
    if (growth !== "weak") s += 5;
    future.push({
      id: "quantum", name: "양자컴퓨팅", icon: "⚛️",
      score: Math.min(100, Math.round(s)),
      outlook: rateLevel !== "high" ? "bullish" : "neutral", horizon: "장기 (1년+)",
      reason: rateLevel === "high"
        ? `고금리(${m.usRate}%) 환경에서 수익화 초기 단계인 양자컴퓨팅 기업들의 밸류에이션 부담 존재. 그러나 Google·IBM·MS의 실용 양자 칩 경쟁이 장기 모멘텀 유지.`
        : "금리 부담 완화 시 미래 기술 밸류에이션 재평가. 구글·IBM 양자 우위 경쟁, 방산·암호화·신약 분야 적용 가속.",
      catalysts: ["Google·IBM 양자 우위 발표", "방산·암호화 분야 조기 적용", "빅테크 양자 R&D 투자 확대"],
      risks: ["상용화 일정 지연 리스크", rateLevel === "high" ? "고금리로 성장주 밸류에이션 압박" : "기술 표준화 불확실성"],
      sectorTags: ["양자컴퓨팅"],
    });
  }

  // 클린에너지: 금리 인하 + 고유가 역설
  {
    let s = 52;
    if (rateLevel !== "high") s += 12;   // 저금리 = 자본 집약적 재생에너지 유리
    if (oilPrice === "high") s += 8;     // 고유가 = 대체에너지 경쟁력 증가
    if (growth === "strong") s += 5;
    future.push({
      id: "clean-energy", name: "클린에너지", icon: "🌱",
      score: Math.min(100, Math.round(s)),
      outlook: rateLevel === "high" ? "cautious" : "neutral", horizon: "중기~장기 (6개월+)",
      reason: rateLevel === "high"
        ? `고금리(${m.usRate}%)는 대규모 자본이 필요한 재생에너지 프로젝트에 직접 타격. 유가 $${m.wti.toFixed(0)} 고공행진은 장기 대체에너지 수요를 자극하지만, 금리 인하 전까지 투자 지연.`
        : `유가 $${m.wti.toFixed(0)} 고공행진이 클린에너지 경쟁력을 부각. 금리 완화 + IRA 보조금 + 글로벌 탄소 중립 목표가 맞물려 구조적 성장.`,
      catalysts: ["IRA·탄소세 정책 강화", `유가 $${m.wti.toFixed(0)} 고공행진 → 대체에너지 수요`, "전력망 현대화 투자"],
      risks: [rateLevel === "high" ? "고금리 장기화 시 프로젝트 경제성 악화" : "보조금 정책 변동 리스크", "원자재 공급망 불안"],
      sectorTags: ["클린에너지"],
    });
  }

  // 리츠: 금리 인하 가시권
  {
    let s = 48;
    if (rateLevel === "high") s -= 8;    // 고금리 = 리츠 부채 비용 증가
    if (rateLevel === "moderate") s += 10;
    if (rateLevel === "low") s += 18;
    if (growth !== "weak") s += 5;
    future.push({
      id: "reit", name: "리츠·부동산", icon: "🏢",
      score: Math.min(100, Math.round(s)),
      outlook: rateLevel === "high" ? "cautious" : "neutral", horizon: "중기 (3~6개월)",
      reason: rateLevel === "high"
        ? `기준금리 ${m.usRate}% 고점에서 리츠의 부채 조달 비용 부담 극대화. 금리 인하 전환 시점이 리츠 투자 적기로, 현재는 선제 포지셔닝을 고려하는 국면.`
        : "금리 인하 사이클에서 리츠 부채 비용 완화 + 자산 가치 재평가. 데이터센터·물류 리츠는 AI 수요와 맞물려 추가 모멘텀.",
      catalysts: ["금리 인하 기대 → 자산 재평가", "데이터센터·물류 리츠 AI 수요", "임대료 인상 가격 결정력"],
      risks: [rateLevel === "high" ? `금리 ${m.usRate}% 장기 유지 시 분배금 압박` : "경기 침체 시 공실률 상승", "상업용 부동산 구조적 약세"],
      sectorTags: ["리츠"],
    });
  }

  const futureTop = future.sort((a, b) => b.score - a.score);

  return { now: nowTop, future: futureTop };
}

// ─── 시장 심리·수급 펄스 ──────────────────────────────────────────────────────

function buildMarketNarrative(env: MacroEnvironment, m: MacroSnapshot, fg: number): string {
  const parts: string[] = [];
  if (fg < 25) parts.push("시장 심리가 '극단적 공포' 국면으로, 투자자 대부분이 현금 보유를 선호하며 위험자산을 회피하고 있습니다");
  else if (fg < 40) parts.push("'공포' 구간으로 대부분의 투자자가 관망 중이지만, 역발상 매수 기회가 모색되는 구간입니다");
  else if (fg < 60) parts.push("시장 심리는 중립 구간으로 방향성 없이 등락을 반복하고 있습니다");
  else if (fg < 80) parts.push("투자 심리가 '탐욕' 구간에 진입해 위험자산 선호도가 높아졌습니다");
  else parts.push("'극단적 탐욕' 국면으로 과열 신호가 감지됩니다. 단기 조정 가능성에 유의가 필요합니다");

  if (env.rateLevel === "high" && env.inflation === "elevated") {
    parts.push(`연준(Fed)이 ${m.usRate}% 고금리를 유지하는 가운데 물가(CPI ${m.usCpi.toFixed(1)}%)도 여전히 높아, 실적이 뒷받침되는 AI·반도체·금융주로 자금이 집중되고 있습니다`);
  } else if (env.rateLevel === "moderate") {
    parts.push(`Fed 금리(${m.usRate}%)가 중립 수준으로 전환되면서 성장주와 리츠 등 금리 민감 자산이 다시 주목받고 있습니다`);
  }
  if (env.fxKrw === "weak") {
    parts.push(`달러당 ${m.krwUsd.toLocaleString()}원의 원화 약세는 해외 ETF 투자자에게 환차익이라는 추가 수익을 제공하며 달러 자산 수요를 높이고 있습니다`);
  }
  if (env.oilPrice === "high") {
    parts.push(`WTI 유가 $${m.wti.toFixed(0)}의 고공행진은 지정학적 리스크 고조 신호로 읽히며 방산·에너지 섹터에 기관 관심이 집중되고 있습니다`);
  }
  return parts.join(". ") + ".";
}

function buildMarketPulse(env: MacroEnvironment, m: MacroSnapshot): MarketPulse {
  const { rateLevel, inflation, fxKrw, growth, oilPrice } = env;

  // ── 공포·탐욕 지수 계산 ──────────────────────────────────────────────
  let fg = 50;
  if (rateLevel === "high")     fg -= 15;
  else if (rateLevel === "low") fg += 10;
  if (inflation === "elevated") fg -= 10;
  else if (inflation === "low") fg += 8;
  if (m.yieldSpread > 0.5)      fg += 10;
  else if (m.yieldSpread > 0)   fg += 5;
  else if (m.yieldSpread < -0.5) fg -= 15;
  else if (m.yieldSpread < 0)   fg -= 8;
  if (oilPrice === "high")      fg -= 8;
  else if (oilPrice === "low")  fg += 5;
  if (growth === "strong")      fg += 15;
  else if (growth === "weak")   fg -= 10;
  fg = Math.max(5, Math.min(95, Math.round(fg)));

  const fearGreedLabel =
    fg >= 80 ? "극단적 탐욕" : fg >= 60 ? "탐욕" :
    fg >= 45 ? "중립" : fg >= 25 ? "공포" : "극단적 공포";

  const overallSentiment: "bullish" | "neutral" | "bearish" =
    fg >= 60 ? "bullish" : fg >= 40 ? "neutral" : "bearish";

  // ── 수급·심리 시그널 ───────────────────────────────────────────────
  const signals: MarketSignal[] = [];

  // AI 사이클 (상수)
  signals.push({
    id: "ai-flow", category: "수급", label: "AI 인프라 기관 매집",
    description: "빅테크 데이터센터 투자 확대에 따라 반도체·서버·전력 섹터로 기관 자금이 꾸준히 유입 중. NVIDIA 수주 모멘텀이 관련 ETF 거래량을 끌어올리는 중.",
    impact: "positive", strength: "strong", icon: "🤖",
    sectorTags: ["반도체", "미국반도체", "로보틱스AI"],
  });

  if (rateLevel === "high") {
    signals.push({
      id: "inst-fin", category: "수급", label: "기관 금융주 비중 확대",
      description: `고금리(${m.usRate}%) 환경에서 기관투자자들이 NIM 확대 수혜를 노리고 은행·보험주 비중을 늘리는 중. 장단기 금리차 +${m.yieldSpread.toFixed(2)}% 정상화가 신뢰를 더함.`,
      impact: "positive", strength: "strong", icon: "🏦",
      sectorTags: ["금융", "미국금융"],
    });
    signals.push({
      id: "retail-caution", category: "심리", label: "개인투자자 관망 심화",
      description: `고금리+고물가 압박으로 개인 투자 심리 위축. 은행 예금·MMF 잔고 증가 추세로 주식 시장 유입 속도 둔화. 저가 매수 기회 탐색 국면.`,
      impact: "negative", strength: "moderate", icon: "😰",
      sectorTags: ["배당", "리츠"],
    });
  }

  if (fxKrw === "weak") {
    signals.push({
      id: "fx-usd", category: "수급", label: "달러 자산·환헤지 수요 급증",
      description: `원달러 ${m.krwUsd.toLocaleString()}원 돌파 이후 달러 ETF·환헤지 상품 검색량 폭발적 증가. 외화 자산 비중 확대를 위한 해외 ETF 매수세 지속.`,
      impact: "positive", strength: "strong", icon: "💵",
      sectorTags: ["미국시장", "미국나스닥", "해외주식"],
    });
  }

  if (oilPrice === "high") {
    signals.push({
      id: "energy-inst", category: "수급", label: "에너지·방산 기관 헷지 매수",
      description: `WTI $${m.wti.toFixed(0)} 고유가 지속으로 에너지·방산 ETF에 인플레이션 헷지 목적의 기관 매수세 유입. 지정학 리스크 프리미엄 확대.`,
      impact: "positive", strength: "moderate", icon: "🛢️",
      sectorTags: ["원자재", "미국에너지", "항공우주방산"],
    });
    signals.push({
      id: "gold-hedge", category: "수급", label: "금·원자재 헷지 수요",
      description: "물가·유가 동반 상승으로 금 ETF(GLD·IAU) 및 원자재 ETF에 포트폴리오 헷지 자금 유입. 리테일·기관 동시 관심.",
      impact: "positive", strength: "moderate", icon: "🥇",
      sectorTags: ["원자재"],
    });
  }

  if (m.yieldSpread > 0.3) {
    signals.push({
      id: "yield-normal", category: "기술적", label: "경기침체 우려 해소",
      description: `장단기 금리차 +${m.yieldSpread.toFixed(2)}% 양전환으로 경기침체 신호 해제. 위험자산 선호 심리 회복 → 주식 ETF 자금 유입 환경 개선.`,
      impact: "positive", strength: "moderate", icon: "📈",
      sectorTags: ["미국시장", "국내주식", "코스닥"],
    });
  } else if (m.yieldSpread < 0) {
    signals.push({
      id: "yield-inv", category: "기술적", label: "장단기 금리 역전 경고",
      description: `10Y-2Y ${m.yieldSpread.toFixed(2)}% 역전 — 과거 평균 12~18개월 후 경기침체 선행 지표. 방어주·배당주 비중 확대 고려.`,
      impact: "negative", strength: "strong", icon: "⚠️",
      sectorTags: ["배당", "리츠", "헬스케어"],
    });
  }

  if (growth === "strong") {
    signals.push({
      id: "growth-momentum", category: "매크로", label: "경제 성장 모멘텀 강세",
      description: `GDP 성장률 ${m.gdpQoQ.toFixed(1)}%로 견조. 기업 실적 개선 기대가 주식 시장 전반의 상승 동력을 제공 중.`,
      impact: "positive", strength: "strong", icon: "📊",
      sectorTags: ["미국시장", "미국나스닥", "국내주식"],
    });
  }

  // ── 테마 키워드 ───────────────────────────────────────────────────
  const themes: ThemeKeyword[] = [];

  themes.push({
    label: "AI·반도체", description: "엔비디아·TSMC 중심 AI 인프라 투자 사이클 지속. 데이터센터·HBM 수요 관심 집중. 반도체 ETF 거래량 급증.",
    sentiment: "hot", relatedSectors: ["반도체", "로보틱스AI", "미국반도체"],
  });

  if (oilPrice === "high") {
    themes.push({
      label: "에너지 안보", description: `WTI $${m.wti.toFixed(0)} 고공행진. 방산·에너지 독립 키워드가 언론·소셜 트렌드 상위권 점유. 방산 ETF 검색량 3개월 연속 상승.`,
      sentiment: "hot", relatedSectors: ["항공우주방산", "원자재", "클린에너지"],
    });
  }

  if (inflation === "elevated") {
    themes.push({
      label: "인플레이션 방어", description: `CPI ${m.usCpi.toFixed(1)}% 고공행진 속 실물 자산·배당주 관심 증가. 금·원자재·리츠 ETF 검색량 급상승.`,
      sentiment: "hot", relatedSectors: ["원자재", "배당", "금융"],
    });
  }

  if (fxKrw === "weak") {
    themes.push({
      label: "달러 강세·환헤지", description: `원달러 ${m.krwUsd.toLocaleString()}원 돌파 이후 달러 ETF·환헤지 상품 검색 폭발적 증가. SNS 재테크 채널에서 '달러 투자' 키워드 트렌딩.`,
      sentiment: "hot", relatedSectors: ["미국시장", "해외주식"],
    });
  }

  themes.push({
    label: "방산·우주 경제", description: "글로벌 방위비 확대·위성 인터넷 경쟁 격화. ITA·XAR 방산 ETF 미디어 노출 증가. 각국 GDP 대비 국방비 상향 조정 뉴스 지속.",
    sentiment: "warm", relatedSectors: ["항공우주방산"],
  });

  themes.push({
    label: "사이버보안", description: "AI 기반 사이버 공격 급증으로 기업·정부 보안 예산 필수화. CIBR·HACK 등 사이버보안 ETF 기관 보고서 빈도 상승.",
    sentiment: "warm", relatedSectors: ["사이버보안"],
  });

  themes.push({
    label: "로보틱스·자동화", description: "인건비 상승 + AI 소프트웨어 융합으로 산업용 로봇 도입 가속. 글로벌 제조업 자동화 뉴스 증가, BOTZ·IRBO 거래량 상승세.",
    sentiment: "warm", relatedSectors: ["로보틱스AI"],
  });

  // 바이오·헬스케어: 금리와 무관한 구조적 성장 테마
  {
    const bioSentiment: ThemeKeyword["sentiment"] =
      rateLevel !== "high" ? "hot"   // 금리 인하 국면 → 성장주 리레이팅 수혜
      : inflation === "elevated" ? "warm"  // 고금리·고물가 → 방어주 성격 부각
      : "warm";
    const bioDesc = rateLevel !== "high"
      ? "금리 인하 기대로 성장주 밸류에이션 리레이팅 수혜. GLP-1 비만치료제·AI 신약 개발 테마에 글로벌 자금 집중."
      : "고금리 환경에서도 GLP-1 비만치료제·AI 기반 신약 발굴이 구조적 성장 동력으로 주목. 경기 방어적 특성과 혁신 성장성이 공존.";
    themes.push({
      label: "바이오·헬스케어",
      description: bioDesc,
      sentiment: bioSentiment,
      relatedSectors: ["헬스케어", "미국헬스케어"],
    });
  }

  if (rateLevel !== "high") {
    themes.push({
      label: "금리 인하 수혜주", description: "Fed 금리 인하 기대가 리츠·성장주·바이오 섹터 관심 폭발적 증가 유도. 금리 민감도 높은 자산군으로 선제 자금 이동.",
      sentiment: "hot", relatedSectors: ["리츠", "2차전지", "헬스케어"],
    });
  }

  // ── 기관 관심 섹터 ─────────────────────────────────────────────────
  const institutionalFocus: string[] = ["AI·반도체"];
  if (rateLevel === "high") institutionalFocus.push("금융·은행");
  if (oilPrice === "high") institutionalFocus.push("에너지·방산");
  if (fxKrw === "weak") institutionalFocus.push("미국 달러 자산");
  institutionalFocus.push("사이버보안");

  // ── 기관 수급 흐름 (방향 + 강도 + 이유) ────────────────────────────
  const institutionalFlow: InstitutionalFlow[] = [];

  // 항상 유입: AI·반도체
  institutionalFlow.push({
    sector: "AI·반도체",
    direction: "in",
    strength: rateLevel === "high" ? 82 : 90,
    reason: "AI 인프라 투자 사이클 지속, 글로벌 빅테크 설비투자 확대",
  });

  // 고금리 → 금융 유입
  if (rateLevel === "high") {
    institutionalFlow.push({
      sector: "금융·은행",
      direction: "in",
      strength: 75,
      reason: `기준금리 ${m.usRate}% 고점 유지 → 순이자마진(NIM) 극대화, 배당 확대`,
    });
  }

  // 고유가 → 에너지·방산 유입
  if (oilPrice === "high") {
    institutionalFlow.push({
      sector: "에너지·방산",
      direction: "in",
      strength: 72,
      reason: `WTI $${m.wti.toFixed(0)} 고공행진, 지정학 리스크 고조로 방산 수요 동반 증가`,
    });
  }

  // 원화약세 → 달러 자산 유입
  if (fxKrw === "weak") {
    institutionalFlow.push({
      sector: "미국 달러 자산",
      direction: "in",
      strength: 68,
      reason: `원/달러 ${m.krwUsd.toFixed(0)}원 — 해외 ETF 환차익 기대, 달러 헷지 수요`,
    });
  }

  // 항상: 사이버보안 유입
  institutionalFlow.push({
    sector: "사이버보안",
    direction: "in",
    strength: 60,
    reason: "AI 인프라 확장에 따른 보안 수요 구조적 증가",
  });

  // 고금리 → 리츠 유출
  if (rateLevel === "high") {
    institutionalFlow.push({
      sector: "리츠(REITs)",
      direction: "out",
      strength: 65,
      reason: `고금리(${m.usRate}%) 지속 → 자본비용 부담, 금리 인하 시그널 전까지 관망`,
    });
  }

  // 고금리 또는 고유가 → 클린에너지 유출/관망
  if (rateLevel === "high" && oilPrice === "high") {
    institutionalFlow.push({
      sector: "클린에너지",
      direction: "out",
      strength: 55,
      reason: "고금리 프로젝트 파이낸싱 부담 + 화석연료 경쟁력 유지로 단기 역풍",
    });
  } else if (rateLevel === "normal" || oilPrice === "normal") {
    institutionalFlow.push({
      sector: "클린에너지",
      direction: "watch",
      strength: 45,
      reason: "금리 방향 전환 여부 확인 후 본격 유입 예상",
    });
  }

  // 2차전지 — 중국 EV 수요 회복 대기
  institutionalFlow.push({
    sector: "2차전지",
    direction: fxKrw === "weak" ? "watch" : "in",
    strength: fxKrw === "weak" ? 40 : 58,
    reason: fxKrw === "weak"
      ? "원화약세로 수출 경쟁력은 양호하나 중국 EV 수요 회복 속도 불확실"
      : "중국 EV 보조금 확대 + ESS 수요 증가로 저점 매집 구간",
  });

  // ── 개인투자자 주의 ───────────────────────────────────────────────
  const retailWarning: string[] = [];
  if (rateLevel === "high") retailWarning.push("고금리 환경에서 레버리지 ETF 손실 위험 확대");
  if (oilPrice === "high") retailWarning.push("클린에너지 ETF — 금리 인하 전 단기 조정 가능");
  retailWarning.push("리츠·채권 ETF — 금리 방향 전환 시 가격 변동 큼");
  if (fg > 75) retailWarning.push("탐욕 지수 과열 — 분할 매수 전략 권장");

  return {
    fearGreedScore: fg, fearGreedLabel, overallSentiment,
    signals, themes, institutionalFocus, institutionalFlow, retailWarning,
    marketNarrative: buildMarketNarrative(env, m, fg),
  };
}

const momentumCache = new Map<string, { data: MomentumAnalysis; ts: number }>();
const MOMENTUM_TTL = 30 * 60_000;

export async function getMomentumAnalysis(): Promise<MomentumAnalysis> {
  const cacheKey = "momentum";
  const hit = momentumCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < MOMENTUM_TTL) return hit.data;

  const [ecos, fred] = await Promise.all([fetchECOSMacro(), fetchFREDMacro()]);

  const macro: MacroSnapshot = {
    krRate:      ecos.baseRate       ?? 2.5,
    usRate:      fred.fedTargetUpper ?? 3.75,
    krCpi:       ecos.cpiYoY        ?? 2.5,
    usCpi:       fred.cpiYoY        ?? 3.5,
    krwUsd:      ecos.usdKrw        ?? 1350,
    wti:         fred.wtiOil        ?? 75,
    gdpQoQ:      ecos.gdpQoQ        ?? 1.0,
    yieldSpread: fred.yieldSpread   ?? 0,
  };

  const environment = buildEnvironment(macro);
  const { now: nowSectors, future: futureSectors } = buildSectors(environment, macro);

  const marketPulse = buildMarketPulse(environment, macro);

  const result: MomentumAnalysis = {
    macro, environment, nowSectors, futureSectors, marketPulse, updatedAt: Date.now(),
  };

  momentumCache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}
