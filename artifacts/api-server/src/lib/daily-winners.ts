/**
 * daily-winners.ts — 장 마감 후 "오늘 실제 급등 종목" 수집 & 피드백 루프
 * ────────────────────────────────────────────────────────────────────────
 * 매일 16:40 KST (장 마감 10분 후) 자동 실행:
 *
 *  1. 오늘 OHLCV 전체 수집 → 5%+ 종목 추출 (daily_winners 테이블 저장)
 *  2. presurge_picks / tomorrow_picks 예측과 대조 → hit/miss 업데이트
 *  3. winner_feature_stats 테이블에 특징별 급등 상관 누적 통계 갱신
 *
 * 이 데이터가 2~3주 쌓이면 winner-pattern.ts가 자동으로 가중치 인사이트를 도출한다.
 */

import { pool, readJsonb } from "@workspace/db";
import { fetchBothMarketsOHLCV } from "./pykrx-client.js";
import { fetchInvestorByStocks } from "./pykrx-client.js";

// ─── DB 초기화 ──────────────────────────────────────────────────────────────

export async function initDailyWinnersTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS daily_winners (
      id                  SERIAL PRIMARY KEY,
      trade_date          DATE         NOT NULL,
      ticker              VARCHAR(20)  NOT NULL,
      name                VARCHAR(100),
      market              VARCHAR(10),
      close               NUMERIC,
      change_pct          NUMERIC      NOT NULL,   -- 등락률 %
      volume              BIGINT,
      turnover_aek        NUMERIC,                 -- 거래대금 (억원)
      volume_ratio_75th   NUMERIC,                 -- 시장 75th pct 대비 배율
      institution_aek     NUMERIC,                 -- 기관 순매수 (억원)
      foreign_aek         NUMERIC,                 -- 외인 순매수 (억원)
      smart_money_aek     NUMERIC,                 -- 기관+외인
      was_presurge_pick   BOOLEAN      DEFAULT FALSE,  -- 급등 예비군이었나?
      was_tomorrow_pick   BOOLEAN      DEFAULT FALSE,  -- 상승 후보였나?
      presurge_score      NUMERIC,                 -- 예비군 점수 (있었다면)
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (trade_date, ticker)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_daily_winners_date
    ON daily_winners(trade_date DESC)
  `).catch(() => {});

  // 특징별 급등 상관 누적 테이블
  await pool.query(`
    CREATE TABLE IF NOT EXISTS winner_feature_stats (
      feature_key         VARCHAR(80)  PRIMARY KEY,
      feature_label       TEXT,
      total_days          INT          NOT NULL DEFAULT 0,
      hit_days            INT          NOT NULL DEFAULT 0,   -- 해당 특징 있는 날 중 급등 비율
      avg_change_with     NUMERIC,     -- 특징 있을 때 평균 등락률
      avg_change_without  NUMERIC,     -- 특징 없을 때 평균 등락률
      lift                NUMERIC,     -- avg_with / avg_without (1.0 = 무관)
      last_calc_date      DATE,
      updated_at          TIMESTAMPTZ  DEFAULT NOW()
    )
  `).catch(() => {});
}

// ─── 날짜 유틸 ──────────────────────────────────────────────────────────────

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function toYmd(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

// ─── 퍼센타일 계산 ──────────────────────────────────────────────────────────

function pct(arr: number[], q: number): number {
  if (arr.length === 0) return 1;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * q)] ?? 1;
}

// ─── 메인: 오늘 급등 종목 수집 ────────────────────────────────────────────────

export async function collectTodayWinners(dateStr?: string): Promise<{
  date: string;
  winners: number;
  alreadyDone: boolean;
}> {
  await initDailyWinnersTable();

  const today = dateStr ?? todayKST();
  const ymd   = toYmd(today);

  // 이미 오늘 수집했으면 스킵
  const { rows: existing } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM daily_winners WHERE trade_date = $1`,
    [today],
  );
  if ((existing[0]?.cnt ?? 0) > 0) {
    console.log(`[daily-winners] ${today} 이미 수집됨 (${existing[0].cnt}건) — 스킵`);
    return { date: today, winners: existing[0].cnt, alreadyDone: true };
  }

  console.log(`[daily-winners] ${today} OHLCV 수집 중...`);
  const rows = await fetchBothMarketsOHLCV(ymd);

  if (rows.length === 0) {
    console.warn(`[daily-winners] ${today} OHLCV 없음 (휴장일?)`);
    return { date: today, winners: 0, alreadyDone: false };
  }

  // 시장별 75th pct 거래량 계산
  const kospiVols  = rows.filter(r => r.market === "KOSPI"  && r.volume > 0).map(r => r.volume);
  const kosdaqVols = rows.filter(r => r.market === "KOSDAQ" && r.volume > 0).map(r => r.volume);
  const kospiP75   = pct(kospiVols, 0.75);
  const kosdaqP75  = pct(kosdaqVols, 0.75);

  // 5%+ 종목 추출 (상한가 28% 미만, 동전주·우선주 제외)
  const winners = rows.filter(r =>
    r.change >= 5 &&
    r.change < 28 &&
    r.close >= 500 &&
    r.volume > 0 &&
    !(r.ticker.length === 6 && r.ticker[5] !== "0"),
  );

  if (winners.length === 0) {
    console.log(`[daily-winners] ${today} 5%+ 종목 없음`);
    return { date: today, winners: 0, alreadyDone: false };
  }

  // 수급 데이터 조회
  const tickers = winners.map(r => r.ticker);
  console.log(`[daily-winners] 투자자 수급 조회: ${tickers.length}개`);
  const flows = await fetchInvestorByStocks(ymd, tickers).catch(() => []);
  const flowMap = new Map(flows.map(f => [f.ticker, f]));

  // presurge_picks 에서 어제(D-1) 예비군 조회
  // presurge는 "D일에 스캔 → D+1일 급등 예측" 구조이므로
  // D일 실제 급등과 대조하려면 D-1일 스캔 결과를 가져와야 함
  const presurgeScanDate = new Date(new Date(today).getTime() - 86400_000)
    .toISOString().slice(0, 10);
  const { rows: presurgePicks } = await pool.query<{
    ticker: string; score: number;
  }>(
    `SELECT ticker, score FROM presurge_picks WHERE scan_date = $1`,
    [presurgeScanDate],
  ).catch(() => ({ rows: [] as { ticker: string; score: number }[] }));
  const presurgeSet = new Map(presurgePicks.map(p => [p.ticker, p.score]));

  // tomorrow_picks는 DB 테이블 없이 system_cache에 JSON으로 저장됨
  // 만료 여부와 무관하게 가장 최근 캐시를 사용 (어제 생성된 picks가 오늘 수집 시 필요)
  const { rows: cacheRows } = await pool.query<{ data: string }>(
    `SELECT data FROM system_cache WHERE key = 'tomorrow_picks_v2' ORDER BY expires_at DESC LIMIT 1`,
  ).catch(() => ({ rows: [] as { data: string }[] }));
  // system_cache.data는 jsonb다 — JSON.parse를 직접 걸면 예외가 나고 조용히 빈 배열이 된다
  const cachedPicks = readJsonb<{ ticker: string }[]>(cacheRows[0]?.data) ?? [];
  const tomorrowSet = new Set(cachedPicks.map(p => p.ticker));

  // DB 저장
  let saved = 0;
  for (const r of winners) {
    const flow      = flowMap.get(r.ticker);
    const inst      = flow?.institution ?? 0;
    const fore      = flow?.foreign ?? 0;
    const smart     = inst + fore;
    const baseVol   = r.market === "KOSPI" ? kospiP75 : kosdaqP75;
    const volRatio  = r.volume / baseVol;
    const turnover  = Math.round(r.close * r.volume / 100_000_000 * 10) / 10;
    const wasPresurge = presurgeSet.has(r.ticker);
    const wasTomorrow = tomorrowSet.has(r.ticker);

    try {
      await pool.query(
        `INSERT INTO daily_winners
           (trade_date, ticker, name, market, close, change_pct, volume, turnover_aek,
            volume_ratio_75th, institution_aek, foreign_aek, smart_money_aek,
            was_presurge_pick, was_tomorrow_pick, presurge_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (trade_date, ticker) DO NOTHING`,
        [
          today, r.ticker, r.name ?? r.ticker, r.market ?? "KOSDAQ",
          r.close, r.change, r.volume, turnover, Math.round(volRatio * 100) / 100,
          inst, fore, smart,
          wasPresurge, wasTomorrow,
          wasPresurge ? (presurgeSet.get(r.ticker) ?? null) : null,
        ],
      );
      saved++;
    } catch (e) {
      console.warn(`[daily-winners] 저장 실패: ${r.ticker}`, e);
    }
  }

  console.log(`[daily-winners] ${today} 완료: 5%+ 종목 ${saved}개 저장`);
  console.log(`  → 급등 예비군 적중: ${winners.filter(r => presurgeSet.has(r.ticker)).length}개`);
  console.log(`  → 상승 후보 적중:   ${winners.filter(r => tomorrowSet.has(r.ticker)).length}개`);

  return { date: today, winners: saved, alreadyDone: false };
}

// ─── 피드백: presurge_picks 결과를 daily_winners와 대조 업데이트 ────────────

export async function syncPresurgeHitResults(): Promise<void> {
  const today = todayKST();

  // daily_winners에 있는 5%+ 종목을 presurge_picks에 반영
  await pool.query(`
    UPDATE presurge_picks pp
    SET surged_5pct = TRUE,
        next_day_change_pct = COALESCE(next_day_change_pct, dw.change_pct),
        resolved_at = COALESCE(resolved_at, NOW())
    FROM daily_winners dw
    WHERE pp.ticker = dw.ticker
      AND pp.scan_date = dw.trade_date - INTERVAL '1 day'
      AND pp.surged_5pct IS DISTINCT FROM TRUE
      AND dw.change_pct >= 5
  `).catch(e => console.warn("[daily-winners] presurge 동기화 실패:", e?.message));

  console.log(`[daily-winners] presurge 적중 결과 동기화 완료 (${today})`);
}

// ─── 적중률 요약 조회 ─────────────────────────────────────────────────────────

export interface WinnerHitSummary {
  since: string | null;
  totalWinnerDays: number;
  avgWinnersPerDay: number;
  presurgeHitRate: number | null;    // 급등 예비군 → 실제 5%+ 비율
  tomorrowHitRate: number | null;    // 상승 후보  → 실제 5%+ 비율
  topFeatures: {
    label: string;
    avgChange: number;
    hitRate: number;
    sampleCount: number;
  }[];
}

export async function getWinnerHitSummary(): Promise<WinnerHitSummary> {
  await initDailyWinnersTable();

  const { rows } = await pool.query<{
    trade_date: string;
    cnt: number;
    presurge_hits: number;
    tomorrow_hits: number;
    total_presurge: number;
    total_tomorrow: number;
  }>(`
    SELECT
      trade_date::text,
      COUNT(*)::int                                        AS cnt,
      SUM(CASE WHEN was_presurge_pick THEN 1 ELSE 0 END)  AS presurge_hits,
      SUM(CASE WHEN was_tomorrow_pick THEN 1 ELSE 0 END)  AS tomorrow_hits,
      (SELECT COUNT(*)::int FROM presurge_picks
        WHERE scan_date = dw.trade_date - INTERVAL '1 day') AS total_presurge,
      0 AS total_tomorrow
    FROM daily_winners dw
    GROUP BY trade_date
    ORDER BY trade_date DESC
    LIMIT 30
  `).catch(() => ({ rows: [] }));

  if (rows.length === 0) {
    return {
      since: null,
      totalWinnerDays: 0,
      avgWinnersPerDay: 0,
      presurgeHitRate: null,
      tomorrowHitRate: null,
      topFeatures: [],
    };
  }

  const totalDays    = rows.length;
  const totalWinners = rows.reduce((s, r) => s + r.cnt, 0);
  const totalPresurgeHits   = rows.reduce((s, r) => s + (r.presurge_hits ?? 0), 0);
  const totalTomorrowHits   = rows.reduce((s, r) => s + (r.tomorrow_hits ?? 0), 0);
  const totalPresurgePicks  = rows.reduce((s, r) => s + (r.total_presurge ?? 0), 0);
  const totalTomorrowPicks  = rows.reduce((s, r) => s + (r.total_tomorrow ?? 0), 0);

  // 특징별 평균 등락률 분석
  const { rows: featureRows } = await pool.query<{
    label: string; avg_change: number; hit_rate: number; n: number;
  }>(`
    SELECT
      CASE
        WHEN volume_ratio_75th >= 5 THEN '거래량폭발 5배+'
        WHEN volume_ratio_75th >= 3 THEN '거래량급증 3-5배'
        WHEN volume_ratio_75th >= 2 THEN '거래량증가 2-3배'
        ELSE '거래량보통'
      END AS label,
      ROUND(AVG(change_pct)::numeric, 2) AS avg_change,
      ROUND((SUM(CASE WHEN change_pct >= 10 THEN 1 ELSE 0 END)::numeric
             / NULLIF(COUNT(*), 0) * 100), 1) AS hit_rate,
      COUNT(*)::int AS n
    FROM daily_winners
    WHERE trade_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY avg_change DESC
  `).catch(() => ({ rows: [] }));

  const since = rows.length > 0
    ? rows.reduce((min, r) => r.trade_date < min ? r.trade_date : min, rows[0]!.trade_date)
    : null;

  return {
    since,
    totalWinnerDays: totalDays,
    avgWinnersPerDay: Math.round((totalWinners / totalDays) * 10) / 10,
    presurgeHitRate: totalPresurgePicks > 0
      ? Math.round((totalPresurgeHits / totalPresurgePicks) * 1000) / 10
      : null,
    tomorrowHitRate: totalTomorrowPicks > 0
      ? Math.round((totalTomorrowHits / totalTomorrowPicks) * 1000) / 10
      : null,
    topFeatures: featureRows.map(r => ({
      label:       r.label,
      avgChange:   r.avg_change,
      hitRate:     r.hit_rate,
      sampleCount: r.n,
    })),
  };
}
