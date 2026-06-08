/**
 * krx-full-harvester.ts
 * KRX 전체 2,719개 종목의 기초 재무 데이터를 krx_stocks 테이블에 구축.
 *
 * 동작 방식:
 * 1. syncKrxList()   — KRX API → krx_stocks INSERT (이미 있는 종목 스킵)
 * 2. fetchPending()  — data_fetched=false 인 종목 Yahoo Finance 호출 → 업데이트
 *    · CONCURRENCY=10, 배치간 200ms 딜레이
 *    · 한 번 실행에 BATCH_LIMIT=300 건만 처리 (서버 부하 분산)
 *    · 서버 시작 시 + 주 1회 자동 실행
 */

import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { loadKRXList } from "./krx-cache.js";
import { classifySector } from "../routes/performance.js";

const yahoo = new YahooFinance();

const CONCURRENCY   = 10;
const DELAY_MS      = 150;   // 배치 간 딜레이
const BATCH_LIMIT   = 9999;  // 전체 수집 (스케줄러가 알아서 증분 처리)
const REFRESH_DAYS  = 7;     // 이 일수 이상 지난 종목은 재수집

// ─── 테이블 초기화 (멱등) ──────────────────────────────────────────────────────
let tableReady = false;
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS krx_stocks (
      code          VARCHAR(10)  PRIMARY KEY,
      name          VARCHAR(100) NOT NULL,
      exchange      VARCHAR(10)  NOT NULL,
      symbol        VARCHAR(15),
      sector        VARCHAR(50),
      industry      VARCHAR(100),
      market_cap    BIGINT,
      current_price REAL,
      per           REAL,
      pbr           REAL,
      roe           REAL,
      opm           REAL,
      rev_growth    REAL,
      revenue       BIGINT,
      net_income    BIGINT,
      shares_out    BIGINT,
      beta          REAL,
      week52_high   REAL,
      week52_low    REAL,
      data_fetched  BOOLEAN      DEFAULT false,
      fetch_error   VARCHAR(50),
      last_updated  TIMESTAMPTZ
    )
  `);
  tableReady = true;
}

// ─── 1단계: KRX 전체 목록 동기화 ─────────────────────────────────────────────
export async function syncKrxList(): Promise<{ inserted: number; total: number }> {
  await ensureTable();
  const list = await loadKRXList();
  if (list.length === 0) return { inserted: 0, total: 0 };

  let inserted = 0;
  for (const stock of list) {
    const res = await pool.query(
      `INSERT INTO krx_stocks (code, name, exchange, symbol)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING`,
      [stock.code, stock.name, stock.exchange, stock.symbol]
    );
    if ((res.rowCount ?? 0) > 0) inserted++;
  }

  console.log(`[krx-full] 종목 목록 동기화: ${inserted}개 신규 추가 (전체 ${list.length}개)`);
  return { inserted, total: list.length };
}

// ─── 2단계: Yahoo Finance 재무 데이터 수집 ────────────────────────────────────
interface StockMetrics {
  sector: string | null;
  industry: string | null;
  market_cap: number | null;
  current_price: number | null;
  per: number | null;
  pbr: number | null;
  roe: number | null;
  opm: number | null;
  rev_growth: number | null;
  revenue: number | null;
  net_income: number | null;
  shares_out: number | null;
  beta: number | null;
  week52_high: number | null;
  week52_low: number | null;
}

async function fetchMetrics(symbol: string): Promise<StockMetrics | null> {
  try {
    const summary = await yahoo.quoteSummary(symbol, {
      modules: ["price", "financialData", "defaultKeyStatistics", "summaryProfile"],
    });

    const p  = summary.price;
    const fd = summary.financialData;
    const ks = summary.defaultKeyStatistics;
    const sp = summary.summaryProfile as any;

    const industry = sp?.industry ?? (fd as any)?.industry ?? null;
    const sector   = industry ? classifySector(industry, "KR") : null;

    return {
      sector,
      industry,
      market_cap:    p?.marketCap              ?? null,
      current_price: p?.regularMarketPrice     ?? null,
      per:           ks?.trailingEps != null && p?.regularMarketPrice != null
                       ? p.regularMarketPrice / ks.trailingEps
                       : null,
      pbr:           ks?.priceToBook           ?? null,
      roe:           fd?.returnOnEquity != null  ? fd.returnOnEquity * 100  : null,
      opm:           fd?.operatingMargins != null ? fd.operatingMargins * 100 : null,
      rev_growth:    fd?.revenueGrowth != null    ? fd.revenueGrowth * 100   : null,
      revenue:       fd?.totalRevenue            ?? null,
      net_income:    fd?.netIncomeToCommon       ?? null,
      shares_out:    ks?.sharesOutstanding       ?? null,
      beta:          ks?.beta                    ?? null,
      week52_high:   p?.fiftyTwoWeekHigh         ?? null,
      week52_low:    p?.fiftyTwoWeekLow          ?? null,
    };
  } catch {
    return null;
  }
}

// ─── 3단계: 미수집 종목 일괄 처리 ────────────────────────────────────────────
export async function fetchPending(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const cutoff = new Date(Date.now() - REFRESH_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { rows: pending } = await pool.query<{ code: string; symbol: string }>(
    `SELECT code, symbol FROM krx_stocks
     WHERE (data_fetched = false OR last_updated < $1)
     ORDER BY last_updated ASC NULLS FIRST
     LIMIT $2`,
    [cutoff, BATCH_LIMIT]
  );

  if (pending.length === 0) {
    console.log("[krx-full] 수집 대기 종목 없음");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  console.log(`[krx-full] Yahoo Finance 수집 시작: ${pending.length}개`);

  let succeeded = 0;
  let failed    = 0;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);

    await Promise.all(
      chunk.map(async ({ code, symbol }) => {
        const metrics = await fetchMetrics(symbol);

        if (metrics) {
          await pool.query(
            `UPDATE krx_stocks SET
               sector        = $2,
               industry      = $3,
               market_cap    = $4,
               current_price = $5,
               per           = $6,
               pbr           = $7,
               roe           = $8,
               opm           = $9,
               rev_growth    = $10,
               revenue       = $11,
               net_income    = $12,
               shares_out    = $13,
               beta          = $14,
               week52_high   = $15,
               week52_low    = $16,
               data_fetched  = true,
               fetch_error   = NULL,
               last_updated  = NOW()
             WHERE code = $1`,
            [
              code,
              metrics.sector,
              metrics.industry,
              metrics.market_cap,
              metrics.current_price,
              metrics.per,
              metrics.pbr,
              metrics.roe,
              metrics.opm,
              metrics.rev_growth,
              metrics.revenue,
              metrics.net_income,
              metrics.shares_out,
              metrics.beta,
              metrics.week52_high,
              metrics.week52_low,
            ]
          );
          succeeded++;
        } else {
          await pool.query(
            `UPDATE krx_stocks SET
               data_fetched = true,
               fetch_error  = 'yahoo_no_data',
               last_updated = NOW()
             WHERE code = $1`,
            [code]
          );
          failed++;
        }
      })
    );

    if (i + CONCURRENCY < pending.length) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    // 50개마다 중간 진행 로그
    if ((i + CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= pending.length) {
      console.log(
        `[krx-full] 진행: ${Math.min(i + CONCURRENCY, pending.length)}/${pending.length} ` +
        `(성공 ${succeeded}, 실패 ${failed})`
      );
    }
  }

  console.log(`[krx-full] 완료 — 성공 ${succeeded}, 실패 ${failed} / 전체 ${pending.length}`);
  return { processed: pending.length, succeeded, failed };
}

// ─── 진행률 조회 ─────────────────────────────────────────────────────────────
export async function getKrxStatsRow(): Promise<{
  total: number;
  fetched: number;
  failed: number;
  kospi: number;
  kosdaq: number;
  withSector: number;
}> {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                        AS total,
      COUNT(*) FILTER (WHERE data_fetched = true)     AS fetched,
      COUNT(*) FILTER (WHERE fetch_error IS NOT NULL) AS failed,
      COUNT(*) FILTER (WHERE exchange = 'KOSPI')      AS kospi,
      COUNT(*) FILTER (WHERE exchange = 'KOSDAQ')     AS kosdaq,
      COUNT(*) FILTER (WHERE sector IS NOT NULL)      AS with_sector
    FROM krx_stocks
  `);
  const r = rows[0];
  return {
    total:      Number(r.total),
    fetched:    Number(r.fetched),
    failed:     Number(r.failed),
    kospi:      Number(r.kospi),
    kosdaq:     Number(r.kosdaq),
    withSector: Number(r.with_sector),
  };
}

// ─── 메인 진입점 ──────────────────────────────────────────────────────────────
export async function runKrxFullHarvest(): Promise<void> {
  try {
    await syncKrxList();
    await fetchPending();
  } catch (e: any) {
    console.error("[krx-full] 오류:", e?.message);
  }
}
