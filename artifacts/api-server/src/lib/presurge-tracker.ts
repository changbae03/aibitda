/**
 * presurge-tracker.ts — "내일 급등 예비군"(presurge) 실제 적중률 추적
 * ─────────────────────────────────────────────────────────────────
 * 매 스캔마다 그날의 후보 목록을 DB에 스냅샷 저장하고, 다음 거래일 종가가
 * 확정되면 실제로 급등했는지(익일 등락률)를 확인해 결과를 채워 넣는다.
 *
 * prediction-tracker.ts와 동일한 "예측 저장 → 나중에 결과 확인" 패턴을 따름.
 * 과거 스냅샷(점수·지표)은 불변 — ON CONFLICT DO NOTHING, 결과 컬럼만 UPDATE.
 */
import { pool } from "@workspace/db";
import { fetchStockOHLCV } from "./pykrx-client.js";
import type { PresurgeCandidate } from "./pykrx-client.js";

// ─── 테이블 초기화 ─────────────────────────────────────────────────────────

export async function initPresurgeTrackerTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS presurge_picks (
      id               SERIAL PRIMARY KEY,
      ticker           VARCHAR(20)  NOT NULL,
      name             VARCHAR(100),
      market           VARCHAR(10),
      scan_date        DATE         NOT NULL,
      score            FLOAT        NOT NULL,
      vol_expansion    FLOAT,
      vol_dryup_days   SMALLINT,
      price_range_pct  FLOAT,
      near_high_pct    FLOAT,
      ma_aligned       BOOLEAN,
      momentum3d       FLOAT,
      close_at_scan    FLOAT        NOT NULL,
      next_date        DATE,
      next_close       FLOAT,
      next_day_change_pct FLOAT,
      surged_5pct      BOOLEAN,
      surged_10pct     BOOLEAN,
      resolved_at      TIMESTAMPTZ,
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_presurge_ticker_scandate
     ON presurge_picks(ticker, scan_date)`
  ).catch(() => {});
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_presurge_unresolved
     ON presurge_picks(scan_date)
     WHERE next_day_change_pct IS NULL`
  ).catch(() => {});
}

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────

/** "YYYYMMDD" → "YYYY-MM-DD" */
function toIsoDate(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

// ─── 스냅샷 저장 ──────────────────────────────────────────────────────────

/**
 * 스캔 결과(top 후보)를 그대로 스냅샷 저장. 같은 (ticker, scan_date)는 무시(불변 보장).
 * @param scannedAt "YYYYMMDD" 형식 (pykrx_fetcher.py의 scannedAt)
 */
export async function saveDailyPicks(
  candidates: PresurgeCandidate[],
  scannedAt: string,
): Promise<void> {
  if (candidates.length === 0) return;
  const scanDate = toIsoDate(scannedAt);

  for (const c of candidates) {
    try {
      await pool.query(
        `INSERT INTO presurge_picks
           (ticker, name, market, scan_date, score, vol_expansion, vol_dryup_days,
            price_range_pct, near_high_pct, ma_aligned, momentum3d, close_at_scan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (ticker, scan_date) DO NOTHING`,
        [
          c.ticker, c.name, c.market, scanDate, c.score, c.volExpansion, c.volDryupDays,
          c.priceRangePct, c.nearHighPct, c.maAligned, c.momentum3d, c.close,
        ],
      );
    } catch (e) {
      console.warn("[presurge-tracker] 스냅샷 저장 실패:", c.ticker, e);
    }
  }
  console.log(`[presurge-tracker] ${scanDate} 스냅샷 저장: ${candidates.length}개`);
}

// ─── 결과 확인 (다음 거래일 종가 조회 → 익일 등락률 계산) ──────────────────

/**
 * 아직 결과가 없는(next_day_change_pct IS NULL) 스냅샷 중, scan_date가 오늘보다
 * 이전인 것들을 대상으로 실제 다음 거래일 종가를 조회해 등락률을 채운다.
 * 종목별로 1회씩만 pykrx를 호출(배치)해 과도한 프로세스 스폰을 방지.
 */
export async function resolvePendingPresurgePicks(): Promise<number> {
  const today = todayKST();

  const { rows: pending } = await pool.query<{
    id: number; ticker: string; scan_date: string; close_at_scan: number;
  }>(
    `SELECT id, ticker, scan_date::text, close_at_scan
     FROM presurge_picks
     WHERE next_day_change_pct IS NULL
       AND scan_date < $1
     ORDER BY scan_date`,
    [today],
  );

  if (pending.length === 0) return 0;

  // 종목별로 그룹핑 (한 종목이 여러 날짜에 걸쳐 등장할 수 있음)
  const byTicker = new Map<string, typeof pending>();
  for (const row of pending) {
    if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, []);
    byTicker.get(row.ticker)!.push(row);
  }

  let resolved = 0;
  const tickers = [...byTicker.keys()];
  const CONCURRENCY = 4;

  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const chunk = tickers.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (ticker) => {
      const rowsForTicker = byTicker.get(ticker)!;
      const earliestScanDate = rowsForTicker.reduce(
        (min, r) => (r.scan_date < min ? r.scan_date : min),
        rowsForTicker[0]!.scan_date,
      );
      try {
        const series = await fetchStockOHLCV(ticker, earliestScanDate, today);
        if (!series || series.length === 0) return;
        const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));

        for (const row of rowsForTicker) {
          const next = sorted.find(s => s.date > row.scan_date);
          if (!next) continue; // 아직 다음 거래일 데이터 없음 → 다음 실행에서 재시도

          const changePct = (next.close - row.close_at_scan) / row.close_at_scan * 100;
          await pool.query(
            `UPDATE presurge_picks
             SET next_date = $1, next_close = $2, next_day_change_pct = $3,
                 surged_5pct = $4, surged_10pct = $5, resolved_at = NOW()
             WHERE id = $6`,
            [next.date, next.close, changePct, changePct >= 5, changePct >= 10, row.id],
          );
          resolved++;
        }
      } catch (e) {
        console.warn("[presurge-tracker] 결과 확인 실패:", ticker, e);
      }
    }));
  }

  if (resolved > 0) {
    console.log(`[presurge-tracker] 익일 결과 확인 완료: ${resolved}건`);
  }
  return resolved;
}

// ─── 적중률 통계 ──────────────────────────────────────────────────────────

export interface PresurgeBandStat {
  band: string;
  n: number;
  hitRate5: number | null;   // 익일 +5% 이상 비율
  avgChange: number | null;
}

export interface PresurgePickAccuracy {
  totalTracked: number;
  resolved: number;
  pending: number;
  hitRate5: number | null;    // 전체 익일 +5% 이상 비율
  hitRate10: number | null;   // 전체 익일 +10% 이상 비율
  avgNextDayChange: number | null;
  byScoreBand: PresurgeBandStat[];
  byDryupDays: PresurgeBandStat[];
  byNearHighBand: PresurgeBandStat[];
  since: string | null;
}

function bucketStats(
  rows: { bucketKey: string; change: number; surged5: boolean }[],
  bandOrder: string[],
): PresurgeBandStat[] {
  const out: PresurgeBandStat[] = [];
  for (const band of bandOrder) {
    const inBand = rows.filter(r => r.bucketKey === band);
    if (inBand.length === 0) { out.push({ band, n: 0, hitRate5: null, avgChange: null }); continue; }
    const hit = inBand.filter(r => r.surged5).length;
    out.push({
      band,
      n: inBand.length,
      hitRate5: Math.round((hit / inBand.length) * 1000) / 10,
      avgChange: Math.round((inBand.reduce((s, r) => s + r.change, 0) / inBand.length) * 100) / 100,
    });
  }
  return out;
}

function scoreBand(score: number): string {
  if (score >= 70) return "70+";
  if (score >= 50) return "50-69";
  if (score >= 30) return "30-49";
  return "15-29";
}

function dryupBand(days: number): string {
  if (days >= 4) return "4일+";
  if (days === 3) return "3일";
  if (days === 2) return "2일";
  return "0-1일";
}

function nearHighBand(pct: number): string {
  if (pct >= 97) return "97%+";
  if (pct >= 85) return "85-96%";
  if (pct >= 70) return "70-84%";
  return "70% 미만";
}

export async function getPresurgePickAccuracy(limit = 500): Promise<PresurgePickAccuracy> {
  const { rows } = await pool.query<{
    score: number; vol_dryup_days: number; near_high_pct: number;
    next_day_change_pct: number; surged_5pct: boolean; scan_date: string;
  }>(
    `SELECT score, vol_dryup_days, near_high_pct, next_day_change_pct, surged_5pct, scan_date::text
     FROM presurge_picks
     WHERE next_day_change_pct IS NOT NULL
     ORDER BY scan_date DESC
     LIMIT $1`,
    [limit],
  );

  const { rows: totalRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM presurge_picks`,
  );
  const { rows: pendingRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM presurge_picks WHERE next_day_change_pct IS NULL`,
  );

  const totalTracked = parseInt(totalRows[0]?.cnt ?? "0", 10);
  const pending      = parseInt(pendingRows[0]?.cnt ?? "0", 10);
  const resolved     = rows.length;

  if (resolved === 0) {
    return {
      totalTracked, resolved, pending,
      hitRate5: null, hitRate10: null, avgNextDayChange: null,
      byScoreBand: [], byDryupDays: [], byNearHighBand: [],
      since: null,
    };
  }

  const hit5  = rows.filter(r => r.next_day_change_pct >= 5).length;
  const hit10 = rows.filter(r => r.next_day_change_pct >= 10).length;
  const avgChange = rows.reduce((s, r) => s + r.next_day_change_pct, 0) / resolved;

  const scoreRows = rows.map(r => ({
    bucketKey: scoreBand(r.score), change: r.next_day_change_pct, surged5: r.surged_5pct,
  }));
  const dryupRows = rows.map(r => ({
    bucketKey: dryupBand(r.vol_dryup_days ?? 0), change: r.next_day_change_pct, surged5: r.surged_5pct,
  }));
  const nearHighRows = rows.map(r => ({
    bucketKey: nearHighBand(r.near_high_pct ?? 0), change: r.next_day_change_pct, surged5: r.surged_5pct,
  }));

  const since = rows.reduce((min, r) => (r.scan_date < min ? r.scan_date : min), rows[0]!.scan_date);

  return {
    totalTracked, resolved, pending,
    hitRate5:  Math.round((hit5  / resolved) * 1000) / 10,
    hitRate10: Math.round((hit10 / resolved) * 1000) / 10,
    avgNextDayChange: Math.round(avgChange * 100) / 100,
    byScoreBand:    bucketStats(scoreRows,    ["70+", "50-69", "30-49", "15-29"]),
    byDryupDays:    bucketStats(dryupRows,    ["4일+", "3일", "2일", "0-1일"]),
    byNearHighBand: bucketStats(nearHighRows, ["97%+", "85-96%", "70-84%", "70% 미만"]),
    since,
  };
}
