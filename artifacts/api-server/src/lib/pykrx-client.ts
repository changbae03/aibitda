/**
 * pykrx 브리지 — Python 스크립트를 child_process로 호출
 * KRX_ID / KRX_PW 환경변수가 설정돼 있어야 작동
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "pykrx_fetcher.py");

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
): Promise<any[]> {
  return new Promise((resolve) => {
    const proc = spawn("python3", [SCRIPT, type, fromDate, toDate, market], {
      env: { ...process.env },
      timeout: 45000,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (stderr) console.warn(`[pykrx][${type}] stderr:`, stderr.slice(0, 300));
      try {
        const parsed = JSON.parse(stdout.trim());
        if (Array.isArray(parsed)) {
          resolve(parsed);
        } else {
          console.warn("[pykrx] non-array result:", parsed);
          resolve([]);
        }
      } catch {
        console.warn("[pykrx] JSON parse error, stdout:", stdout.slice(0, 200));
        resolve([]);
      }
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
    // pykrx 컬럼: "외국인합계", "기관합계", "개인" (순매수 금액, 백만원 단위)
    const foreign     = r["외국인합계"] ?? r["외국인"] ?? 0;
    const institution = r["기관합계"]   ?? r["기관"]   ?? 0;
    const individual  = r["개인"]       ?? 0;
    return {
      date:        r.date,
      foreign:     Math.round(foreign     / 1_000_000), // 백만→조 단위(억)
      institution: Math.round(institution / 1_000_000),
      individual:  Math.round(individual  / 1_000_000),
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
    ratio: Number(r["공매도비중"] ?? r["ratio"] ?? 0),
  }));
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
