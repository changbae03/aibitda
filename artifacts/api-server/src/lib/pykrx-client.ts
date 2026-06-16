/**
 * pykrx 브리지 — Python 스크립트를 child_process로 호출
 * KRX_ID / KRX_PW 환경변수가 설정돼 있어야 작동
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

// esbuild CJS 번들에서는 import.meta.url이 undefined → fileURLToPath가 throw됨
// try/catch로 안전하게 처리: dev(ESM)에서는 실제 경로, prod(CJS 번들)에서는 cwd 기준 경로 사용
const SCRIPT = (() => {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), "pykrx_fetcher.py");
  } catch {
    return path.resolve(process.cwd(), "artifacts/api-server/src/lib/pykrx_fetcher.py");
  }
})();

export interface InvestorRow {
  date: string;
  /** 외국인 순매수 (백만원) */
  foreign: number;
  /** 기관 순매수 (백만원) */
  institution: number;
  /** 개인 순매수 (백만원) */
  individual: number;
}

export interface ShortRow {
  date: string;
  /** 공매도 비중 (%) */
  ratio: number;
}

/** pykrx Python 스크립트 호출 → JSON 파싱 */
async function callPykrx(
  type: string,
  fromDate: string,
  toDate: string,
  market = "KOSPI",
  timeoutMs = 45000,
): Promise<any[]> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [SCRIPT, type, fromDate, toDate, market], {
      env: { ...process.env },
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (stderr) console.warn(`[pykrx][${type}] stderr:`, stderr.slice(0, 300));
      // pykrx가 stdout에 에러/경고 메시지를 섞어 출력할 수 있으므로
      // 마지막 유효한 JSON 줄(배열/객체로 시작)을 역순 탐색
      const lines = stdout.split("\n").reverse();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            resolve(parsed);
          } else {
            console.warn("[pykrx] non-array result:", parsed);
            resolve([]);
          }
          return;
        } catch {
          // 이 줄은 유효한 JSON이 아님 — 계속 탐색
        }
      }
      console.warn("[pykrx] JSON parse error, stdout:", stdout.slice(0, 200));
      resolve([]);
    });

    proc.on("error", (e) => {
      console.warn("[pykrx] spawn error:", e.message);
      resolve([]);
    });
  });
}

/** YYYYMMDD 형식 변환 */
function toKRXDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 시장별 투자자 순매수 조회
 * @param market "KOSPI" | "KOSDAQ"
 * @param fromDate ISO 날짜 (YYYY-MM-DD)
 * @param toDate   ISO 날짜 (YYYY-MM-DD)
 */
export async function fetchInvestorData(
  market: "KOSPI" | "KOSDAQ",
  fromDate: string,
  toDate: string,
): Promise<InvestorRow[]> {
  if (!process.env.KRX_ID || !process.env.KRX_PW) {
    console.warn("[pykrx] KRX_ID/KRX_PW 미설정 — 투자자 데이터 스킵");
    return [];
  }

  const rows = await callPykrx("investor", toKRXDate(fromDate), toKRXDate(toDate), market);
  if (!rows.length) return [];

  return rows.map((r: any) => {
    // pykrx 컬럼: "외국인합계", "기관합계", "개인" — 단위: 원(KRW)
    // 1억 = 100,000,000 원 → 억원 단위로 변환
    const foreign     = r["외국인합계"] ?? r["외국인"] ?? 0;
    const institution = r["기관합계"]   ?? r["기관"]   ?? 0;
    const individual  = r["개인"]       ?? 0;
    return {
      date:        r.date,
      foreign:     Math.round(foreign     / 100_000_000), // 원→억원
      institution: Math.round(institution / 100_000_000),
      individual:  Math.round(individual  / 100_000_000),
    };
  });
}

/**
 * 시장별 공매도 비중 조회
 * @param market "KOSPI" | "KOSDAQ"
 */
export async function fetchShortRatio(
  market: "KOSPI" | "KOSDAQ",
  fromDate: string,
  toDate: string,
): Promise<ShortRow[]> {
  if (!process.env.KRX_ID || !process.env.KRX_PW) {
    console.warn("[pykrx] KRX_ID/KRX_PW 미설정 — 공매도 데이터 스킵");
    return [];
  }

  const rows = await callPykrx("short_market", toKRXDate(fromDate), toKRXDate(toDate), market);
  if (!rows.length) return [];

  return rows.map((r: any) => ({
    date:  r.date,
    // "합계" = 공매도 총 거래대금(원). 억원으로 변환해 ratio 필드에 담음
    // LSTM 정규화가 스케일을 조정하므로 비율 대신 절대값 사용
    ratio: Math.round(Number(r["합계"] ?? 0) / 100_000_000),
  }));
}

export interface ShortBalanceRow {
  date: string;
  /** 공매도 잔고 수량 (주) */
  shortQty: number;
  /** 공매도 잔고 금액 (원) */
  shortAmt: number;
  /** 공매도 잔고 비중 (%) */
  shortRatio: number;
}

/**
 * 종목별 공매도 잔고 조회 (잔량·금액·비중)
 * pykrx get_shorting_balance 사용 — KRX_ID/KRX_PW 필요
 */
export async function fetchShortBalance(
  ticker: string,
  days = 5,
): Promise<ShortBalanceRow[]> {
  if (!process.env.KRX_ID || !process.env.KRX_PW) {
    console.warn("[pykrx] KRX_ID/KRX_PW 미설정 — 공매도 잔고 스킵");
    return [];
  }
  const clean = ticker.replace(/\.(KS|KQ)$/i, "");
  if (!/^\d{6}$/.test(clean)) return [];

  const toDate = toKRXDate(new Date());
  // 조회 기간: 최근 2주 (휴장일 감안)
  const from = new Date();
  from.setDate(from.getDate() - 14);
  const fromDate = toKRXDate(from);

  const rows = await callPykrx("short_balance", fromDate, toDate, clean, 45000);
  return (rows as any[])
    .filter((r): r is ShortBalanceRow => r && typeof r.date === "string")
    .slice(0, days);
}

/**
 * 개별 종목 OHLCV (KRX_ID 없이도 작동)
 */
export async function fetchStockOHLCV(
  ticker: string,
  fromDate: string,
  toDate: string,
): Promise<{ date: string; open: number; high: number; low: number; close: number; volume: number }[]> {
  return callPykrx("ohlcv", toKRXDate(fromDate), toKRXDate(toDate), ticker);
}

/** pykrx 사용 가능 여부 확인 */
export function isPykrxEnabled(): boolean {
  return !!(process.env.KRX_ID && process.env.KRX_PW);
}

export interface PykrxEtfHolding {
  rank: number;
  stockCode: string;
  stockName: string;
  weight: number;
}

/**
 * pykrx로 ETF 구성종목(PDF) 조회 — RISE/PLUS/ACE 등 isuCd 없는 ETF에서도 동작
 * KRX_ID/KRX_PW가 설정돼 있어야 작동 (KRX 로그인 필요)
 */
export async function fetchEtfHoldingsPykrx(
  etfCode: string,
): Promise<PykrxEtfHolding[]> {
  if (!process.env.KRX_ID || !process.env.KRX_PW) return [];
  const today = toKRXDate(new Date());
  const rows = await callPykrx("etf_holdings", today, today, etfCode, 30000);
  return (rows as any[]).filter(
    (r): r is PykrxEtfHolding =>
      typeof r.stockCode === "string" && typeof r.weight === "number" && r.weight > 0,
  );
}

export interface EtfHolding {
  etfCode: string;
  etfName: string;
  manager: string;
  category: string;
  /** ETF 내 편입 비중 (%) */
  weight: number;
}

/** 6자리 종목코드가 편입된 주요 국내 ETF 목록 조회 (캐시 6시간) */
export async function fetchETFsForStock(
  stockCode: string,
): Promise<EtfHolding[]> {
  if (!process.env.KRX_ID || !process.env.KRX_PW) {
    console.warn("[pykrx] KRX_ID/KRX_PW 미설정 — ETF 검색 스킵");
    return [];
  }
  // 날짜 인자는 사용되지 않지만 callPykrx 시그니처 맞추기 위해 오늘 날짜 전달
  // ETF 병렬 스캔은 ~25초 소요 → 타임아웃 60초로 설정
  const today = toKRXDate(new Date());
  const rows = await callPykrx("etf_search", today, today, stockCode, 60000);
  return (rows as any[]).filter(
    (r): r is EtfHolding =>
      typeof r.etfCode === "string" && typeof r.weight === "number",
  );
}
