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
import { normalizeTicker, isKoreanTicker } from "@workspace/shared";
import { loadKRXList } from "./krx-cache.js";
import { classifySector } from "../routes/performance.js";
import { getFmpValuation } from "./fmp-client.js";
import { fetchKISStockQuote } from "./kis-client.js";
import { Semaphore } from "./analysis/semaphore.js";

const yahoo = new YahooFinance();

const CONCURRENCY   = 10;
const DELAY_MS      = 150;   // 배치 간 딜레이
const BATCH_LIMIT   = 9999;  // 전체 수집 (스케줄러가 알아서 증분 처리)
const REFRESH_DAYS  = 7;     // 이 일수 이상 지난 종목은 재수집

// KIS는 초당 호출 제한이 있다. 수집기 동시성(10)과 별개로 KIS만 따로 묶어
// 전체 호출량을 제한한다 — 안 그러면 한도 초과로 토큰이 막힌다.
const kisSemaphore = new Semaphore(4);

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
      modules: ["price", "financialData", "defaultKeyStatistics", "summaryProfile", "summaryDetail"],
    });

    const p  = summary.price;
    const fd = summary.financialData;
    const ks = summary.defaultKeyStatistics;
    const sp = summary.summaryProfile as any;
    const sd = (summary as any).summaryDetail;

    const industry = sp?.industry ?? (fd as any)?.industry ?? null;
    const sector   = industry ? classifySector(industry, "KR") : null;

    // PER: summaryDetail.trailingPE 우선 → 직접 계산 → forwardPE 순 fallback
    const perFromSD   = sd?.trailingPE ?? null;
    const perCalc     = ks?.trailingEps != null && p?.regularMarketPrice != null
                          ? p.regularMarketPrice / ks.trailingEps
                          : null;
    let per = perFromSD ?? perCalc;
    let pbr: number | null = (ks?.priceToBook ?? sd?.priceToBook ?? null) as number | null;

    // 야후는 한국 종목의 trailingPE·priceToBook·trailingEps·bookValue를 더 이상 주지 않는다
    // (2026-07 확인: 005930.KS·000660.KS·035720.KS 모두 undefined). 그래서 2,800종목
    // 전부 PER·PBR이 비어 있었다. 한국 종목은 이미 연동된 KIS를 1차 출처로 쓴다.
    //
    // 야후의 forwardPE(예상 PER)는 KIS의 실적 기준 PER과 성격이 다르다. 종목마다
    // 기준이 섞이면 피어 멀티플 비교가 왜곡되므로, 한국 종목은 KIS 값으로 통일하고
    // 야후 forwardPE는 KIS가 실패했을 때만 쓴다.
    if (isKoreanTicker(symbol)) {
      await kisSemaphore.acquire();
      try {
        const kis = await fetchKISStockQuote(normalizeTicker(symbol)).catch(() => null);
        if (kis?.per != null) per = kis.per;
        if (kis?.pbr != null) pbr = kis.pbr;
      } finally {
        kisSemaphore.release();
      }
      per ??= (ks as any)?.forwardPE ?? null;
    } else {
      per ??= (ks as any)?.forwardPE ?? null;
    }

    return {
      sector,
      industry,
      market_cap:    p?.marketCap              ?? null,
      current_price: p?.regularMarketPrice     ?? null,
      per,
      pbr,
      roe:           fd?.returnOnEquity != null  ? fd.returnOnEquity * 100  : null,
      opm:           fd?.operatingMargins != null ? fd.operatingMargins * 100 : null,
      rev_growth:    fd?.revenueGrowth != null    ? fd.revenueGrowth * 100   : null,
      revenue:       fd?.totalRevenue            ?? null,
      net_income:    fd?.netIncomeToCommon       ?? null,
      shares_out:    ks?.sharesOutstanding       ?? null,
      beta:          ks?.beta ?? sd?.beta        ?? null,
      // 52주 고저는 summaryDetail에 있다. price 모듈에서 읽고 있어 2,800종목 전부 비어 있었다.
      week52_high:   sd?.fiftyTwoWeekHigh ?? (p as any)?.fiftyTwoWeekHigh ?? null,
      week52_low:    sd?.fiftyTwoWeekLow  ?? (p as any)?.fiftyTwoWeekLow  ?? null,
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
     WHERE (data_fetched = false OR last_updated < $1 OR per IS NULL)
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
