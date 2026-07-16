/**
 * pykrx 브리지 — Python 스크립트를 child_process로 호출
 * KRX_ID / KRX_PW 환경변수가 설정돼 있어야 작동
 */
import { spawn, spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** 실제로 Python X.Y.Z 를 출력하는지 확인 (Go 래퍼는 패닉하므로 제외) */
function isRealPython(bin: string, prefixArgs: string[] = []): boolean {
  try {
    const r = spawnSync(bin, [...prefixArgs, "--version"], { timeout: 5000, encoding: "utf8" });
    const out = (r.stdout ?? "") + (r.stderr ?? "");
    return r.status === 0 && /Python 3\.\d+/.test(out);
  } catch {
    return false;
  }
}

/** uv CPython 설치 경로에서 python3 바이너리를 탐색 */
function findUvPythons(): string[] {
  const bases = [
    "/home/runner/.local/share/uv/python",  // 개발 환경
    "/root/.local/share/uv/python",          // 배포 환경 (root 유저)
    "/home/user/.local/share/uv/python",     // 배포 환경 (user 유저)
  ];
  const results: string[] = [];
  for (const base of bases) {
    try {
      readdirSync(base)
        .filter(d => d.startsWith("cpython-"))
        .map(d => path.join(base, d, "bin", "python3"))
        .filter(existsSync)
        .forEach(p => results.push(p));
    } catch {}
  }
  return results;
}

/** Nix store에서 python3.11 바이너리를 동적 탐색 (배포 환경 대응) */
function findNixStorePythons(): string[] {
  try {
    // /nix/store/*/bin/python3.11 패턴으로 직접 탐색
    const r = spawnSync("find", [
      "/nix/store", "-maxdepth", "4",
      "-name", "python3.11",
      "-type", "f",
      "-not", "-path", "*/wrapper*",
    ], { timeout: 8000, encoding: "utf8" });
    if (r.status === 0) {
      return (r.stdout ?? "").split("\n")
        .map(p => p.trim())
        .filter(p => p && p.includes("/bin/python3.11") && !p.includes("wrapper"));
    }
  } catch {}
  return [];
}

/**
 * Python 실행 커맨드 확정.
 * bin + prefixArgs로 구성 — spawn(bin, [...prefixArgs, SCRIPT, ...scriptArgs]) 형태로 사용.
 * 최우선: uv run --with pykrx python3 (Python 바이너리 + 패키지 자동 관리)
 * 폴백: 직접 Python 바이너리 탐색
 */
const PYTHON_CMD: { bin: string; prefixArgs: string[] } = (() => {
  // ① PYTHON_BIN 환경변수 override (절대경로)
  if (process.env.PYTHON_BIN) {
    if (isRealPython(process.env.PYTHON_BIN)) {
      console.log(`[pykrx] Python 확정 (env override): ${process.env.PYTHON_BIN}`);
      return { bin: process.env.PYTHON_BIN, prefixArgs: [] };
    }
  }

  // ② uv 사용 가능 여부 확인 — uv run --with pykrx python3 으로 실행
  //    uv가 Python 바이너리 + pykrx 패키지를 자동으로 관리
  //    (pykrx 다운로드가 느릴 수 있으므로 uv 존재만 확인하고 신뢰)
  function isUvAvailable(bin: string): boolean {
    try {
      const r = spawnSync(bin, ["--version"], { timeout: 3000, encoding: "utf8" });
      return r.status === 0 && (r.stdout ?? "").includes("uv ");
    } catch { return false; }
  }
  const uvWhich = spawnSync("which", ["uv"], { encoding: "utf8", timeout: 2000 }).stdout?.trim();
  const uvCandidates = [
    uvWhich,
    "/nix/store/6m2322jq0rkfdnv6cm3dq8437djbfv1l-uv-0.9.5/bin/uv",
    "/root/.local/bin/uv",
    "/home/runner/.local/bin/uv",
    "/usr/local/bin/uv",
  ].filter(Boolean) as string[];
  for (const uvBin of uvCandidates) {
    if (existsSync(uvBin) && isUvAvailable(uvBin)) {
      console.log(`[pykrx] Python 확정 (uv run): ${uvBin}`);
      return { bin: uvBin, prefixArgs: ["run", "--with", "pykrx", "python3"] };
    }
  }
  if (isUvAvailable("uv")) {
    console.log("[pykrx] Python 확정 (uv run via PATH)");
    return { bin: "uv", prefixArgs: ["run", "--with", "pykrx", "python3"] };
  }

  // ③ 절대경로 후보: existsSync → isRealPython 순서로 검증
  const fullPathCandidates = [
    "/home/runner/workspace/.pythonlibs/bin/python3.12",
    "/home/runner/workspace/.pythonlibs/bin/python3.11",
    "/home/runner/workspace/.pythonlibs/bin/python3",
    ...findUvPythons(),
    ...findNixStorePythons(),   // 배포 환경: /nix/store에서 실제 python3.11 동적 탐색
    "/nix/var/nix/profiles/default/bin/python3.12",
    "/nix/var/nix/profiles/default/bin/python3.11",
    "/nix/var/nix/profiles/default/bin/python3",
    "/usr/bin/python3.12",
    "/usr/bin/python3.11",
    "/usr/bin/python3",
    "/usr/local/bin/python3.12",
    "/usr/local/bin/python3.11",
    "/usr/local/bin/python3",
  ];
  for (const p of fullPathCandidates) {
    if (existsSync(p) && isRealPython(p)) {
      console.log(`[pykrx] Python 확정 (절대경로): ${p}`);
      return { bin: p, prefixArgs: [] };
    }
  }

  // ④ PATH 명령 후보 (Go 래퍼가 python3만 가로채고 python3.11은 안 가로채는 경우)
  for (const bin of ["python3.13", "python3.12", "python3.11", "python3.10"]) {
    if (isRealPython(bin)) {
      console.log(`[pykrx] Python 확정 (PATH 버전 고정): ${bin}`);
      return { bin, prefixArgs: [] };
    }
  }

  console.warn("[pykrx] 검증된 Python 없음 — 'python3' 폴백 (실패 가능성 높음)");
  return { bin: "python3", prefixArgs: [] };
})();

// esbuild CJS 번들에서는 import.meta.url이 undefined → fileURLToPath가 throw됨
// 여러 후보 경로를 순서대로 시도하여 실제 존재하는 경로를 사용
const SCRIPT = (() => {
  const candidates: string[] = [];
  // 1) ESM 개발 모드: __filename 기준
  try { candidates.push(path.join(path.dirname(fileURLToPath(import.meta.url)), "pykrx_fetcher.py")); } catch {}
  // 2) CJS 번들 모드: __dirname = dist/, 스크립트는 ../src/lib/ 에 있음
  try { candidates.push(path.join(__dirname, "../src/lib/pykrx_fetcher.py")); } catch {}
  // 3) 프로덕션 CWD = artifacts/api-server/
  candidates.push(path.resolve(process.cwd(), "src/lib/pykrx_fetcher.py"));
  // 4) 개발 CWD = 워크스페이스 루트
  candidates.push(path.resolve(process.cwd(), "artifacts/api-server/src/lib/pykrx_fetcher.py"));

  for (const p of candidates) {
    if (existsSync(p)) {
      console.log(`[pykrx] 스크립트 경로 확정: ${p}`);
      return p;
    }
  }
  console.warn("[pykrx] pykrx_fetcher.py를 찾지 못함 — 후보:", candidates);
  return candidates[candidates.length - 1];
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

// ─── 파라미터 화이트리스트 (커맨드 인젝션 방어) ─────────────────────────────
const ALLOWED_PYKRX_TYPES = new Set([
  "investor", "short_market", "ohlcv", "ohlcv_both",
  "naver_trending", "top_volume", "top_gainers",
  "cap", "ohlcv_market", "etf_search", "etf_holdings",
  "short_balance", "investor_stocks", "presurge_scan",
]);
const KRX_DATE_RE = /^\d{8}$/;
const ALLOWED_MARKETS = new Set(["KOSPI", "KOSDAQ", "ALL", "KOSPI200"]);

const TICKER_LIST_TYPES = new Set(["investor_stocks"]); // market 자리에 종목코드 목록을 넘기는 타입
const TICKER_LIST_RE = /^[\d,]+$/; // "005930,000660,..." 형식

function validatePykrxArgs(type: string, fromDate: string, toDate: string, market: string): void {
  if (!ALLOWED_PYKRX_TYPES.has(type))
    throw new Error(`[pykrx] 허용되지 않은 type: ${type}`);
  if (!KRX_DATE_RE.test(fromDate) || !KRX_DATE_RE.test(toDate))
    throw new Error(`[pykrx] 날짜 형식 오류: fromDate=${fromDate} toDate=${toDate}`);
  // investor_stocks는 market 자리에 종목코드 목록을 넘김 → 별도 형식 검사
  if (TICKER_LIST_TYPES.has(type)) {
    if (!TICKER_LIST_RE.test(market))
      throw new Error(`[pykrx] investor_stocks market 형식 오류: ${market}`);
  } else if (!ALLOWED_MARKETS.has(market)) {
    throw new Error(`[pykrx] 허용되지 않은 market: ${market}`);
  }
}

/** pykrx Python 스크립트 호출 → JSON 파싱 */
async function callPykrx(
  type: string,
  fromDate: string,
  toDate: string,
  market = "KOSPI",
  timeoutMs = 45000,
): Promise<any[]> {
  validatePykrxArgs(type, fromDate, toDate, market);
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_CMD.bin, [...PYTHON_CMD.prefixArgs, SCRIPT, type, fromDate, toDate, market], {
      env: { ...process.env },
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (_code) => {
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
            // 배열이 아닌 객체 — 빈 배열로 반환 (callPykrxAny 사용 필요)
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

/** pykrx 호출 — 배열/객체 모두 허용 (presurge_scan 등 객체 반환 타입용) */
async function callPykrxAny(
  type: string,
  fromDate: string,
  toDate: string,
  market = "ALL",
  timeoutMs = 300_000,
): Promise<any> {
  validatePykrxArgs(type, fromDate, toDate, market);
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_CMD.bin, [...PYTHON_CMD.prefixArgs, SCRIPT, type, fromDate, toDate, market], {
      env: { ...process.env },
      timeout: timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (_code) => {
      if (stderr) console.warn(`[pykrx][${type}] stderr:`, stderr.slice(0, 300));
      const lines = stdout.split("\n").reverse();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || (!trimmed.startsWith("[") && !trimmed.startsWith("{"))) continue;
        try {
          resolve(JSON.parse(trimmed));
          return;
        } catch { /* 계속 탐색 */ }
      }
      console.warn(`[pykrx][${type}] JSON parse error, stdout:`, stdout.slice(0, 200));
      resolve(null);
    });
    proc.on("error", (e) => {
      console.warn(`[pykrx][${type}] spawn error:`, e.message);
      resolve(null);
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

// ── 시장 전체 종목별 OHLCV (급등·거래량 신호 탐지용) ──────────────────────────

export interface MarketOHLCVRow {
  ticker: string;
  market?: "KOSPI" | "KOSDAQ";
  close: number;
  volume: number;
  /** 등락률 (%) */
  change: number;
  /** 종목명 — 알파뉴메릭 ETN/ELW 코드는 pykrx에서 직접 조회, 일반 종목은 "" */
  name?: string;
}

/**
 * 특정 날짜(YYYYMMDD) 기준 단일 시장(KOSPI 또는 KOSDAQ) OHLCV 반환.
 * 데이터가 없으면 (휴장일 등) [] 반환.
 */
export async function fetchMarketOHLCV(
  date: string,
  market: "KOSPI" | "KOSDAQ",
): Promise<MarketOHLCVRow[]> {
  const rows = await callPykrx("ohlcv_market", date, date, market, 60000);
  return (rows as any[]).filter(
    (r): r is MarketOHLCVRow =>
      typeof r.ticker === "string" && typeof r.change === "number",
  );
}

/**
 * 특정 날짜(YYYYMMDD) 기준 KOSPI + KOSDAQ 전 종목 OHLCV를 단일 Python 프로세스로 반환.
 * KRX 로그인을 1회만 수행하므로 충돌 없이 안정적.
 */
export async function fetchBothMarketsOHLCV(
  date: string,
): Promise<MarketOHLCVRow[]> {
  const rows = await callPykrx("ohlcv_both", date, date, "ALL", 90000);
  return (rows as any[]).filter(
    (r): r is MarketOHLCVRow =>
      typeof r.ticker === "string" && typeof r.change === "number",
  );
}

// ── 급등 전조 스캔 ─────────────────────────────────────────────────────

export interface PresurgeCandidate {
  ticker:        string;
  market:        "KOSPI" | "KOSDAQ";
  name:          string;
  close:         number;
  change:        number;
  score:         number;
  volExpansion:  number;
  volDryupDays:  number;
  priceRangePct: number;
  nearHighPct:   number;
  maAligned:     boolean;
  momentum3d:    number;
  bbWidthPct:    number;
}

export interface PresurgeScanResult {
  candidates:  PresurgeCandidate[];
  backtest:    {
    totalEvents: number;
    avgSurgePct: number;
    avgT1VolRatio: number;
    avgT1DryupDays: number;
    period: string;
  } | null;
  tradingDays: number;
  scannedAt:   string;
}

/**
 * 최근 N영업일치 KOSPI+KOSDAQ 전 종목 OHLCV를 스캔해
 * 급등 전조(거래량 수축→팽창·박스권·이동평균 정배열) 종목을 점수화해 반환.
 * @param fromDate 시작 영업일 YYYYMMDD (보통 15영업일 전)
 * @param toDate   오늘 YYYYMMDD
 */
export async function fetchPresurgeScan(
  fromDate: string,
  toDate:   string,
): Promise<PresurgeScanResult> {
  // Python 스크립트가 최대 4분 소요 (15일×2시장 병렬)
  // callPykrxAny 사용: presurge_scan은 배열이 아닌 객체를 반환
  const obj = await callPykrxAny("presurge_scan", fromDate, toDate, "ALL", 300_000);
  return {
    candidates:  Array.isArray(obj?.candidates) ? obj.candidates : [],
    backtest:    obj?.backtest ?? null,
    tradingDays: obj?.tradingDays ?? 0,
    scannedAt:   obj?.scannedAt ?? toDate,
  };
}

// ── 종목별 투자자 순매수 (pykrx) ──────────────────────────────────────

export interface StockInvestorFlow {
  ticker: string;
  individual: number;
  institution: number;
  foreign: number;
}

/**
 * 특정 날짜 기준 종목 목록의 투자자별 순매수 (억원) — pykrx KRX 직접 조회.
 * KIS 실시간 API와 달리 장 마감 후에도 정산 데이터를 반환.
 * @param date YYYYMMDD
 * @param tickers 6자리 종목코드 배열
 */
export async function fetchInvestorByStocks(
  date: string,
  tickers: string[],
): Promise<StockInvestorFlow[]> {
  if (!tickers.length) return [];
  const rows = await callPykrx(
    "investor_stocks",
    date,
    date,
    tickers.join(","),
    120_000,
  );
  return (rows as any[]).filter(
    (r): r is StockInvestorFlow => typeof r.ticker === "string",
  );
}
