/**
 * auto-batch-runner.ts
 * 매일 KR 25 + US 15 = 40개 종목을 자동 AI 분석.
 *
 * 선택 기준:
 *   krx_stocks / us_stocks 테이블에서 가장 오래 분석되지 않은 종목 먼저
 *   (미분석 종목 → NULLS FIRST 정렬 → 기존 분석이 오래된 순)
 *
 * 커버리지:
 *   KR 2,719 + US ~600 = ~3,319 종목 / 40개/일 ≈ 83일 (~2.7개월)에 전체 1회 순환
 *
 * 실행 주기:
 *   서버 시작 3분 후 + 24시간마다. 오늘 이미 실행됐으면 DB 체크 후 자동 스킵.
 */

import { pool } from "@workspace/db";
import { SCHEDULER_TOKEN } from "./schedule-runner.js";

const DAILY_BATCH_KR       = 25;
const DAILY_BATCH_US       = 15;
const INTER_STOCK_DELAY_MS = 5 * 60 * 1000; // 종목간 5분 간격

// ─── 마지막 실행일 체크 ────────────────────────────────────────────────────────
async function getLastBatchDate(): Promise<string | null> {
  try {
    const r = await pool.query(
      `SELECT data FROM system_cache WHERE key = 'auto_batch_last_run'`
    );
    const raw = r.rows[0]?.data;
    if (!raw) return null;
    return typeof raw === "string" ? raw : (raw as any).date ?? null;
  } catch {
    return null;
  }
}

async function setLastBatchDate(dateStr: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    `INSERT INTO system_cache (key, data, expires_at)
     VALUES ('auto_batch_last_run', $1::jsonb, $2)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at`,
    [JSON.stringify({ date: dateStr }), expiresAt]
  );
}

// ─── DB 기반 종목 선택 ────────────────────────────────────────────────────────
interface BatchStock {
  ticker: string;
  name: string;
  industry: string | null;
  last_at: Date | null;
}

/** KRX 전체 종목 중 가장 오래 분석 안 된 top-N 선택 */
async function pickKrStocks(count: number): Promise<BatchStock[]> {
  const { rows } = await pool.query<BatchStock>(
    `SELECT
       k.code          AS ticker,
       k.name,
       COALESCE(k.industry, k.sector) AS industry,
       a.last_at
     FROM krx_stocks k
     LEFT JOIN (
       SELECT ticker, MAX(created_at) AS last_at
       FROM   analyses
       WHERE  status = 'completed'
       GROUP  BY ticker
     ) a ON a.ticker = k.code
     ORDER BY a.last_at ASC NULLS FIRST
     LIMIT $1`,
    [count]
  );
  return rows;
}

/** US 전체 종목 중 가장 오래 분석 안 된 top-N 선택 */
async function pickUsStocks(count: number): Promise<BatchStock[]> {
  const { rows } = await pool.query<BatchStock>(
    `SELECT
       u.ticker,
       u.name,
       COALESCE(u.industry, u.sector) AS industry,
       a.last_at
     FROM us_stocks u
     LEFT JOIN (
       SELECT ticker, MAX(created_at) AS last_at
       FROM   analyses
       WHERE  status = 'completed'
       GROUP  BY ticker
     ) a ON a.ticker = u.ticker
     ORDER BY a.last_at ASC NULLS FIRST
     LIMIT $1`,
    [count]
  );
  return rows;
}

// ─── 메인: 일일 자동 배치 실행 ────────────────────────────────────────────────
export async function runDailyAutoBatch(port: number): Promise<void> {
  // 오늘(KST) 이미 실행했으면 스킵
  const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const lastRun = await getLastBatchDate();
  if (lastRun === todayKST) {
    console.log(`[auto-batch] 오늘(${todayKST}) 이미 실행됨 — 스킵`);
    return;
  }

  console.log(`[auto-batch] 일일 자동 배치 시작 (${todayKST})`);

  // DB에서 종목 선택 (krx_stocks / us_stocks 없으면 빈 배열)
  let krBatch: BatchStock[] = [];
  let usBatch: BatchStock[] = [];

  try {
    krBatch = await pickKrStocks(DAILY_BATCH_KR);
  } catch (e: any) {
    console.warn("[auto-batch] krx_stocks 조회 실패 (테이블 미준비?):", e?.message);
  }
  try {
    usBatch = await pickUsStocks(DAILY_BATCH_US);
  } catch (e: any) {
    console.warn("[auto-batch] us_stocks 조회 실패 (테이블 미준비?):", e?.message);
  }

  const batch = [...krBatch, ...usBatch];

  if (batch.length === 0) {
    console.log("[auto-batch] 선택된 종목 없음 — 스킵");
    await setLastBatchDate(todayKST);
    return;
  }

  // 미분석/최고령 분석일 로그
  const neverKr = krBatch.filter(s => !s.last_at).length;
  const neverUs = usBatch.filter(s => !s.last_at).length;
  console.log(
    `[auto-batch] 대상: KR ${krBatch.length}개 (미분석 ${neverKr}개), ` +
    `US ${usBatch.length}개 (미분석 ${neverUs}개) — 총 ${batch.length}개`
  );
  console.log(
    "[auto-batch] 종목:",
    batch.map(s => `${s.name}(${s.ticker})`).join(", ")
  );

  // 날짜 기록 (중복 실행 방지)
  await setLastBatchDate(todayKST);

  // 5분 간격으로 순차 큐잉 (40개 기준 약 195분에 걸쳐 분산 실행)
  for (let i = 0; i < batch.length; i++) {
    const stock = batch[i];
    const delay = i * INTER_STOCK_DELAY_MS;

    setTimeout(async () => {
      try {
        const resp = await fetch(`http://localhost:${port}/api/analysis/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Scheduler-Token": SCHEDULER_TOKEN,
          },
          body: JSON.stringify({
            ticker:      stock.ticker,
            companyName: stock.name,
            industry:    stock.industry ?? undefined,
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.json().catch(() => ({}));
          console.error(
            `[auto-batch] 분석 생성 실패: ${stock.name}(${stock.ticker})`,
            errBody
          );
          return;
        }

        const data = await resp.json();
        console.log(
          `[auto-batch] 분석 시작: ${stock.name}(${stock.ticker}) → analysis#${data?.id} ` +
          `(${i + 1}/${batch.length}, 마지막분석: ${stock.last_at ? new Date(stock.last_at).toLocaleDateString("ko-KR") : "없음"})`
        );
      } catch (e: any) {
        console.error(
          `[auto-batch] 요청 오류: ${stock.name}(${stock.ticker})`,
          e?.message
        );
      }
    }, delay);
  }

  const totalMinutes = Math.round((batch.length - 1) * INTER_STOCK_DELAY_MS / 60_000);
  console.log(
    `[auto-batch] ${batch.length}개 큐잉 완료 — 약 ${totalMinutes}분에 걸쳐 순차 실행`
  );
}
