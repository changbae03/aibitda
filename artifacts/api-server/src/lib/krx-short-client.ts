/**
 * KRX 공매도·대차잔고 클라이언트
 * KRX 정보데이터시스템(data.krx.co.kr) Open API 활용
 *
 * 제공 데이터:
 *   - 종목별 공매도 잔량·잔고금액·잔고비율 (최근 5영업일)
 *   - 대차잔고(주식 대여 잔량) — 공매도 선행지표
 */

import { pool } from "@workspace/db";
import { fetchShortBalance } from "./pykrx-client.js";

const KRX_BASE = "http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";

let _tableReady = false;
async function ensureTable() {
  if (_tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS krx_short_cache (
      id          SERIAL PRIMARY KEY,
      ticker      VARCHAR(10) NOT NULL,
      trade_date  VARCHAR(8)  NOT NULL,
      short_qty   BIGINT,
      short_amt   BIGINT,
      short_ratio NUMERIC(8,4),
      loan_qty    BIGINT,
      loan_ratio  NUMERIC(8,4),
      fetched_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(ticker, trade_date)
    )
  `).catch(() => {});
  _tableReady = true;
}

function prevBizDays(n: number): string[] {
  const dates: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let count = 0;
  while (dates.length < n) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}${m}${dd}`);
    count++;
  }
  return dates;
}

export interface ShortRow {
  tradeDate: string;
  shortQty: number | null;
  shortAmt: number | null;
  shortRatio: number | null;
  loanQty: number | null;
  loanRatio: number | null;
}

async function fetchKRXShortDay(ticker: string, date: string): Promise<ShortRow | null> {
  try {
    const params = new URLSearchParams({
      bld: "dbms/MDC/STAT/standard/MDCSTAT05901",
      isuCd: ticker,
      trdDd: date,
      share: "1",
      money: "1",
    });
    const res = await fetch(`${KRX_BASE}?${params}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "http://data.krx.co.kr/",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = await res.json() as any;
    const rows: any[] = json?.output ?? json?.OutBlock_1 ?? [];
    if (!rows.length) return null;

    const row = rows.find((r: any) => {
      const code = (r.ISU_SRT_CD ?? r.isuSrtCd ?? "").replace(/[^0-9A-Za-z]/g, "");
      return code === ticker;
    }) ?? rows[0];

    const parseNum = (v: any) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(String(v).replace(/,/g, ""));
      return isNaN(n) ? null : n;
    };

    return {
      tradeDate: date,
      shortQty:   parseNum(row.SMSSQTY  ?? row.smssqty  ?? row.SHT_SELNG_QTY ?? row.BALANCE_QTY),
      shortAmt:   parseNum(row.SMSSAMT  ?? row.smssamt  ?? row.SHT_SELNG_AMT ?? row.BALANCE_AMT),
      shortRatio: parseNum(row.SMSSRATE ?? row.smssrate ?? row.SHT_SELNG_RATIO ?? row.BALANCE_RATE),
      loanQty:    parseNum(row.LBQTY    ?? row.lbqty    ?? row.LOAN_BALANCE_QTY),
      loanRatio:  parseNum(row.LBRATE   ?? row.lbrate   ?? row.LOAN_BALANCE_RATE),
    };
  } catch {
    return null;
  }
}

async function fetchKRXShortFromNaver(ticker: string): Promise<ShortRow[]> {
  try {
    const url = `https://m.stock.naver.com/api/stock/${ticker}/shortSelling`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Referer": "https://m.stock.naver.com/",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = await res.json() as any;
    const list: any[] = json?.shortSellingList ?? json?.list ?? [];
    if (!list.length) return [];

    return list.slice(0, 10).map((item: any) => {
      const parseNum = (v: any) => {
        if (v === undefined || v === null || v === "") return null;
        const n = Number(String(v).replace(/,/g, "").replace(/%/g, ""));
        return isNaN(n) ? null : n;
      };
      const dateRaw = item.localDate ?? item.tradeDate ?? "";
      const date = dateRaw.replace(/-/g, "");
      return {
        tradeDate: date,
        shortQty:   parseNum(item.shortSellingQuantity ?? item.qty),
        shortAmt:   parseNum(item.shortSellingAmount   ?? item.amt),
        shortRatio: parseNum(item.shortSellingRatio    ?? item.ratio),
        loanQty:    parseNum(item.loanBalance          ?? item.loanQty),
        loanRatio:  parseNum(item.loanBalanceRate      ?? item.loanRate),
      };
    }).filter(r => r.tradeDate.length === 8);
  } catch {
    return [];
  }
}

export async function fetchKRXShortData(ticker: string, days = 10): Promise<ShortRow[]> {
  await ensureTable();
  const clean = ticker.replace(/\.(KS|KQ)$/i, "");
  if (!/^\d{6}$/.test(clean)) return [];

  // 1) DB 캐시 확인 — 최근 days일 데이터가 충분하면 반환
  try {
    const cached = await pool.query<ShortRow & { trade_date: string; short_qty: string; short_amt: string; short_ratio: string; loan_qty: string; loan_ratio: string }>(
      `SELECT trade_date, short_qty, short_amt, short_ratio, loan_qty, loan_ratio
       FROM krx_short_cache
       WHERE ticker = $1 AND fetched_at > NOW() - INTERVAL '12 hours'
       ORDER BY trade_date DESC LIMIT $2`,
      [clean, days]
    );
    if (cached.rows.length >= Math.min(days, 5)) {
      return cached.rows.map(r => ({
        tradeDate: r.trade_date,
        shortQty:   r.short_qty   ? Number(r.short_qty)   : null,
        shortAmt:   r.short_amt   ? Number(r.short_amt)   : null,
        shortRatio: r.short_ratio ? Number(r.short_ratio) : null,
        loanQty:    r.loan_qty    ? Number(r.loan_qty)    : null,
        loanRatio:  r.loan_ratio  ? Number(r.loan_ratio)  : null,
      }));
    }
  } catch {}

  // 2) pykrx로 종목별 공매도 잔고 조회 (가장 안정적 — KRX 직접 로그인)
  try {
    const pykrxRows = await fetchShortBalance(clean, days);
    if (pykrxRows.length > 0) {
      const mapped: ShortRow[] = pykrxRows.map(r => ({
        tradeDate: r.date.replace(/-/g, ""),
        shortQty:   r.shortQty   > 0 ? r.shortQty   : null,
        shortAmt:   r.shortAmt   > 0 ? r.shortAmt   : null,
        shortRatio: r.shortRatio != null ? r.shortRatio : null,
        loanQty:    null,
        loanRatio:  null,
      }));
      // DB 저장
      for (const row of mapped) {
        await pool.query(
          `INSERT INTO krx_short_cache (ticker, trade_date, short_qty, short_amt, short_ratio, loan_qty, loan_ratio)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (ticker, trade_date) DO UPDATE SET
             short_qty=EXCLUDED.short_qty, short_amt=EXCLUDED.short_amt,
             short_ratio=EXCLUDED.short_ratio, fetched_at=NOW()`,
          [clean, row.tradeDate, row.shortQty, row.shortAmt, row.shortRatio, row.loanQty, row.loanRatio]
        ).catch(() => {});
      }
      console.log(`[krx-short] ${clean} 공매도 잔고 ${mapped.length}건 (pykrx)`);
      return mapped.slice(0, days);
    }
  } catch (err) {
    console.warn(`[krx-short] pykrx 공매도 잔고 실패 (${clean}):`, err);
  }

  // 3) 네이버 금융에서 공매도 데이터 시도
  const naverRows = await fetchKRXShortFromNaver(clean);
  if (naverRows.length > 0) {
    // DB 저장
    for (const row of naverRows) {
      await pool.query(
        `INSERT INTO krx_short_cache (ticker, trade_date, short_qty, short_amt, short_ratio, loan_qty, loan_ratio)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ticker, trade_date) DO UPDATE SET
           short_qty=EXCLUDED.short_qty, short_amt=EXCLUDED.short_amt,
           short_ratio=EXCLUDED.short_ratio, loan_qty=EXCLUDED.loan_qty,
           loan_ratio=EXCLUDED.loan_ratio, fetched_at=NOW()`,
        [clean, row.tradeDate, row.shortQty, row.shortAmt, row.shortRatio, row.loanQty, row.loanRatio]
      ).catch(() => {});
    }
    console.log(`[krx-short] ${clean} 공매도 데이터 ${naverRows.length}건 (네이버)`);
    return naverRows.slice(0, days);
  }

  // 3) KRX 직접 조회 fallback (최근 5영업일)
  const bizDays = prevBizDays(Math.min(days, 5));
  const results = await Promise.allSettled(bizDays.map(d => fetchKRXShortDay(clean, d)));
  const rows: ShortRow[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      rows.push(r.value);
      await pool.query(
        `INSERT INTO krx_short_cache (ticker, trade_date, short_qty, short_amt, short_ratio, loan_qty, loan_ratio)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ticker, trade_date) DO UPDATE SET
           short_qty=EXCLUDED.short_qty, short_amt=EXCLUDED.short_amt,
           short_ratio=EXCLUDED.short_ratio, loan_qty=EXCLUDED.loan_qty,
           loan_ratio=EXCLUDED.loan_ratio, fetched_at=NOW()`,
        [clean, r.value.tradeDate, r.value.shortQty, r.value.shortAmt, r.value.shortRatio, r.value.loanQty, r.value.loanRatio]
      ).catch(() => {});
    }
  }
  if (rows.length > 0) console.log(`[krx-short] ${clean} 공매도 데이터 ${rows.length}건 (KRX)`);
  return rows.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}

export function buildKRXShortContext(ticker: string, rows: ShortRow[]): string | null {
  if (!rows.length) return null;

  const latest = rows[0];
  const oldest = rows[rows.length - 1];

  const fmtRatio = (v: number | null) => v != null ? `${v.toFixed(2)}%` : "N/A";
  const fmtQty   = (v: number | null) => v != null ? v.toLocaleString("ko-KR") + "주" : "N/A";
  const fmtAmt   = (v: number | null) => {
    if (v == null) return "N/A";
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조원`;
    if (v >= 1e8)  return `${(v / 1e8).toFixed(0)}억원`;
    return `${v.toLocaleString("ko-KR")}원`;
  };

  const lines: string[] = [
    `\n[📉 KRX 공매도·대차잔고 데이터 — ${ticker}]`,
    `⚠️ 수급 분석 시 공매도 잔고비율을 반드시 참고하세요.`,
    ``,
    `최신 기준일: ${latest.tradeDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}`,
    `공매도 잔량: ${fmtQty(latest.shortQty)}`,
    `공매도 잔고금액: ${fmtAmt(latest.shortAmt)}`,
    `공매도 잔고비율: ${fmtRatio(latest.shortRatio)}  ← 전체 상장주식 대비 비율`,
    `대차잔고: ${fmtQty(latest.loanQty)}  ← 공매도 선행지표 (대차 후 공매도 실행)`,
    `대차잔고비율: ${fmtRatio(latest.loanRatio)}`,
  ];

  // 추세 분석 (2건 이상일 때)
  if (rows.length >= 2 && latest.shortRatio != null && oldest.shortRatio != null) {
    const diff = latest.shortRatio - oldest.shortRatio;
    const trend = diff > 0.5 ? "📈 공매도 증가 추세 — 하방 압력 우려"
      : diff < -0.5 ? "📉 공매도 감소 추세 — 숏 커버링 가능성"
      : "➡️ 공매도 잔고 횡보";
    lines.push(``, `최근 ${rows.length}일 추세: ${trend} (${diff > 0 ? "+" : ""}${diff.toFixed(2)}%p 변화)`);
  }

  // 위험 수준 판정
  if (latest.shortRatio != null) {
    const r = latest.shortRatio;
    const risk = r >= 5 ? "🔴 고위험 — 공매도 비율 5% 이상, 숏 스퀴즈 or 추가 하락 가능"
      : r >= 2 ? "🟡 주의 — 공매도 비율 2~5%, 매도 압력 존재"
      : "🟢 양호 — 공매도 비율 2% 미만";
    lines.push(`공매도 위험 수준: ${risk}`);
  }

  lines.push(``, `⭐ 공매도 잔고비율·대차잔고를 수급 분석의 핵심 지표로 활용하세요. 잔고비율 급증 시 하방 압력, 급감 시 숏 커버링 수혜 가능성을 명시하세요.`);

  return lines.join("\n");
}
