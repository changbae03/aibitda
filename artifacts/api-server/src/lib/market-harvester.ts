/**
 * market-harvester.ts
 * KRX 종목 재무 데이터를 주 1회 수집해 model_calibration.sector_benchmarks를 업데이트.
 * AI 분석 없이 Yahoo Finance 재무지표만 가져오므로 비용은 사실상 0.
 *
 * 동작 방식:
 * - KRX 2719 종목을 200개씩 배치 → 주 번호 기준 로테이션 (~14주에 전체 1회 순환)
 * - 섹터별로 PER·PBR·ROE·OPM 중간값(median) 계산
 * - model_calibration.sector_benchmarks JSONB 컬럼 UPSERT
 */

import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { loadKRXList } from "./krx-cache.js";
import { classifySector } from "../routes/performance.js";

const yahoo = new YahooFinance();

const BATCH_SIZE = 200;
const CONCURRENCY = 5;
const DELAY_MS = 150;

interface SectorSample {
  per: number[];
  pbr: number[];
  roe: number[];
  opm: number[];
  revGrowth: number[];
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pushValid(arr: number[], val: number | null | undefined) {
  if (val != null && isFinite(val) && !isNaN(val)) arr.push(val);
}

async function fetchStockMetrics(symbol: string): Promise<{
  industry: string | null;
  trailingPE: number | null;
  priceToBook: number | null;
  roe: number | null;
  opm: number | null;
  revGrowth: number | null;
} | null> {
  try {
    const summary = await yahoo.quoteSummary(symbol, {
      modules: ["financialData", "defaultKeyStatistics"],
    });
    const fd = summary.financialData;
    const ks = summary.defaultKeyStatistics;
    if (!fd && !ks) return null;

    return {
      industry: (fd as any)?.industry ?? null,
      trailingPE: ks?.trailingEps != null && fd?.currentPrice != null
        ? fd.currentPrice / ks.trailingEps
        : null,
      priceToBook: ks?.priceToBook ?? null,
      roe: fd?.returnOnEquity ?? null,
      opm: fd?.operatingMargins ?? null,
      revGrowth: fd?.revenueGrowth ?? null,
    };
  } catch {
    return null;
  }
}

async function runBatch<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
  delayMs: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(chunk.map(fn));
    for (const r of chunkResults) {
      results.push(r.status === "fulfilled" ? r.value : (null as any));
    }
    if (i + concurrency < items.length) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  return results;
}

export async function harvestMarketData(): Promise<{
  processed: number;
  sectorsUpdated: number;
}> {
  const krxList = await loadKRXList();
  if (krxList.length === 0) {
    console.warn("[market-harvest] KRX 목록 비어있음 — 스킵");
    return { processed: 0, sectorsUpdated: 0 };
  }

  // 주 번호 기준 배치 로테이션
  const weekNumber = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const totalBatches = Math.ceil(krxList.length / BATCH_SIZE);
  const batchIndex = weekNumber % totalBatches;
  const batchStocks = krxList.slice(
    batchIndex * BATCH_SIZE,
    (batchIndex + 1) * BATCH_SIZE
  );

  console.log(
    `[market-harvest] 배치 ${batchIndex + 1}/${totalBatches} (${batchStocks.length}종목) 수집 시작`
  );

  const metrics = await runBatch(
    batchStocks,
    (stock) => fetchStockMetrics(stock.symbol),
    CONCURRENCY,
    DELAY_MS
  );

  // 섹터별 집계
  const sectorSamples = new Map<string, SectorSample>();

  for (let i = 0; i < batchStocks.length; i++) {
    const m = metrics[i];
    if (!m) continue;

    // industry는 Yahoo financialData에서 오거나 KRX 교환 정보 사용
    const exchange = batchStocks[i].exchange;
    const market = exchange === "KOSPI" || exchange === "KOSDAQ" ? "KR" : "US";

    // industry 정보가 없으면 섹터 분류 불가 → KR_OTHER로 묶어도 의미 없으니 스킵
    if (!m.industry) continue;

    const sector = classifySector(m.industry, market);

    if (!sectorSamples.has(sector)) {
      sectorSamples.set(sector, { per: [], pbr: [], roe: [], opm: [], revGrowth: [] });
    }
    const s = sectorSamples.get(sector)!;

    // OPM 음수(적자) 종목은 median 계산에서 제외 (왜곡 방지)
    pushValid(s.per, m.trailingPE && m.trailingPE > 0 ? m.trailingPE : null);
    pushValid(s.pbr, m.priceToBook && m.priceToBook > 0 ? m.priceToBook : null);
    pushValid(s.roe, m.roe != null ? m.roe * 100 : null);
    if (m.opm != null && m.opm > 0) pushValid(s.opm, m.opm * 100);
    pushValid(s.revGrowth, m.revGrowth != null ? m.revGrowth * 100 : null);
  }

  // 섹터별 model_calibration UPSERT
  let sectorsUpdated = 0;
  const now = new Date().toISOString();

  for (const [sector, s] of sectorSamples.entries()) {
    const benchmarks = {
      medianPer: median(s.per),
      medianPbr: median(s.pbr),
      medianRoe: median(s.roe),
      medianOpm: median(s.opm),
      medianRevGrowth: median(s.revGrowth),
      sampleCount: Math.max(s.per.length, s.pbr.length, s.roe.length, s.opm.length),
      updatedAt: now,
    };

    // 샘플 5개 미만은 신뢰성 낮으므로 스킵
    if (benchmarks.sampleCount < 5) continue;

    await pool.query(
      `INSERT INTO model_calibration (sector, market, sample_count, sector_benchmarks, last_recalc_at, created_at)
       VALUES ($1, 'KR', 0, $2, NOW(), NOW())
       ON CONFLICT (sector, market) DO UPDATE SET
         sector_benchmarks = $2,
         last_recalc_at = NOW()`,
      [sector, JSON.stringify(benchmarks)]
    );
    sectorsUpdated++;
  }

  const processed = metrics.filter(Boolean).length;
  console.log(
    `[market-harvest] 완료 — ${processed}/${batchStocks.length}종목 수집, ${sectorsUpdated}개 섹터 업데이트`
  );
  return { processed, sectorsUpdated };
}
