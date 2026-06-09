/**
 * prediction-tracker.ts  — 3가지 피드백 루프 인프라
 * ──────────────────────────────────────────────────
 * [#2] 앙상블 가중치 실시간 조정 : GBDT / LSTM 개별 예측 저장 → 컴포넌트별 라이브 정확도 → alpha 보정
 * [#1] 오차 컨텍스트 저장        : VIX / 변동성 기록 → 나중에 "어떤 상황에서 틀리나" 분석용
 *      (데이터 2주+ 쌓이면 자동 활성화)
 * [v2] D+1 / D+2 / D+3 별도 저장 지원 (pred_horizon 컬럼)
 *      과거 예측치 불변: ON CONFLICT DO NOTHING (resolved_at 등 결과만 UPDATE)
 */

import { pool } from "@workspace/db";

// ─── 테이블 초기화 ─────────────────────────────────────────────────────────────

export async function initPredictionTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS index_predictions (
      id               SERIAL PRIMARY KEY,
      symbol           VARCHAR(20)  NOT NULL,
      predicted_at     DATE         NOT NULL,
      target_date      DATE         NOT NULL,
      predicted_return FLOAT        NOT NULL,
      predicted_dir    SMALLINT     NOT NULL,
      price_at_pred    FLOAT        NOT NULL,
      actual_return    FLOAT,
      actual_dir       SMALLINT,
      correct          BOOLEAN,
      resolved_at      TIMESTAMPTZ,
      model_version    SMALLINT     NOT NULL DEFAULT 0,
      pred_horizon     SMALLINT     NOT NULL DEFAULT 3,
      gbdt_ret         FLOAT,
      lstm_ret         FLOAT,
      gbdt_correct     BOOLEAN,
      lstm_correct     BOOLEAN,
      vix_at_pred      FLOAT,
      volatility_at_pred FLOAT
    )
  `);

  // 기존 테이블에 컬럼 추가 (없으면 추가, 있으면 무시)
  const cols = [
    ["gbdt_ret",           "FLOAT"],
    ["lstm_ret",           "FLOAT"],
    ["gbdt_correct",       "BOOLEAN"],
    ["lstm_correct",       "BOOLEAN"],
    ["vix_at_pred",        "FLOAT"],
    ["volatility_at_pred", "FLOAT"],
    ["pred_horizon",       "SMALLINT NOT NULL DEFAULT 3"],
  ] as const;
  for (const [col, typ] of cols) {
    await pool.query(
      `ALTER TABLE index_predictions ADD COLUMN IF NOT EXISTS ${col} ${typ}`
    ).catch(() => {});
  }

  // 기존 UNIQUE(symbol, predicted_at) 제약 제거 → (symbol, predicted_at, pred_horizon)으로 교체
  // D+1 / D+2 / D+3 각각 별도 행 저장을 위해 필요
  await pool.query(
    `ALTER TABLE index_predictions DROP CONSTRAINT IF EXISTS index_predictions_symbol_predicted_at_key`
  ).catch(() => {});
  await pool.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_unique_spd
     ON index_predictions(symbol, predicted_at, pred_horizon)`
  ).catch(() => {});

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ip_symbol_predicted
    ON index_predictions(symbol, predicted_at DESC)
  `).catch(() => {});
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ip_unresolved
    ON index_predictions(symbol, target_date)
    WHERE correct IS NULL
  `).catch(() => {});
}

// ─── 시장별 공휴일 목록 (주말 외 평일 공휴일) ─────────────────────────────────
const KRX_HOLIDAYS = new Set([
  // 2025
  "2025-01-01","2025-01-28","2025-01-29","2025-01-30",
  "2025-05-05","2025-05-06","2025-06-06","2025-08-15",
  "2025-10-03","2025-10-06","2025-10-07","2025-10-09",
  "2025-12-25","2025-12-31",
  // 2026
  "2026-01-01","2026-02-16","2026-02-17","2026-02-18",
  "2026-03-02","2026-05-05","2026-05-25","2026-06-03",
  "2026-10-09","2026-12-25","2026-12-31",
  // 2027
  "2027-01-01","2027-02-06","2027-02-07","2027-02-08",
  "2027-03-01","2027-05-05","2027-06-06","2027-08-16",
  "2027-10-04","2027-10-05","2027-10-06","2027-10-11",
  "2027-12-24","2027-12-31",
]);

// NYSE/NASDAQ 공휴일 (New Year, MLK, Presidents, Good Friday, Memorial, Juneteenth, July4, Labor, Thanksgiving, Christmas)
const NYSE_HOLIDAYS = new Set([
  // 2025
  "2025-01-01","2025-01-20","2025-02-17","2025-04-18",
  "2025-05-26","2025-06-19","2025-07-04","2025-09-01",
  "2025-11-27","2025-12-25",
  // 2026
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03",
  "2026-05-25","2026-06-19","2026-07-03","2026-09-07",
  "2026-11-26","2026-12-25",
  // 2027
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26",
  "2027-05-31","2027-06-18","2027-07-05","2027-09-06",
  "2027-11-25","2027-12-24",
]);

function isUSSymbol(symbol: string): boolean {
  return !symbol.endsWith(".KS") && !symbol.endsWith(".KQ") && !/^\d{6}$/.test(symbol);
}

function isTradingDay(ds: string, symbol: string): boolean {
  const dow = new Date(ds + "T12:00:00Z").getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return isUSSymbol(symbol) ? !NYSE_HOLIDAYS.has(ds) : !KRX_HOLIDAYS.has(ds);
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function addTradingDays(dateStr: string, days: number, symbol = ""): string {
  const d = new Date(dateStr + "T12:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ds = d.toISOString().slice(0, 10);
    if (isTradingDay(ds, symbol)) added++;
  }
  return d.toISOString().slice(0, 10);
}

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

// ─── 예측 저장 ─────────────────────────────────────────────────────────────────

export interface PredictionContext {
  gbdtReturn?:    number;
  lstmReturn?:    number;
  vixAtPred?:     number;
  volatilityAtPred?: number;
}

/**
 * 예측 저장.
 * - 같은 (symbol, predicted_at, pred_horizon) 조합이 이미 있으면 DO NOTHING.
 *   → 과거 예측치 불변 보장.
 * - actual_return / correct 결과는 resolveExpiredPredictions 에서 별도 UPDATE.
 */
export async function savePrediction(
  symbol: string,
  predictedReturn: number,
  currentPrice: number,
  modelVersion: number,
  predHorizon = 3,
  ctx: PredictionContext = {},
): Promise<void> {
  const predictedAt = todayKST();
  const targetDate  = addTradingDays(predictedAt, predHorizon, symbol);
  const dir = predictedReturn >= 0 ? 1 : -1;

  await pool.query(
    `INSERT INTO index_predictions
       (symbol, predicted_at, target_date, predicted_return, predicted_dir,
        price_at_pred, model_version, pred_horizon,
        gbdt_ret, lstm_ret, vix_at_pred, volatility_at_pred)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (symbol, predicted_at, pred_horizon)
     DO NOTHING`,
    [
      symbol, predictedAt, targetDate, predictedReturn, dir, currentPrice,
      modelVersion, predHorizon,
      ctx.gbdtReturn ?? null, ctx.lstmReturn ?? null,
      ctx.vixAtPred ?? null, ctx.volatilityAtPred ?? null,
    ],
  );
}

// ─── 만료된 예측 결과 확인 ──────────────────────────────────────────────────────

export async function resolveExpiredPredictions(
  symbol: string,
  rows: { date: string; close: number }[],
): Promise<number> {
  const today = todayKST();

  const { rows: pending } = await pool.query<{
    id: number;
    predicted_at: string;
    target_date: string;
    predicted_dir: number;
    pred_horizon: number;
    gbdt_ret: number | null;
    lstm_ret: number | null;
    price_at_pred: number;
  }>(
    `SELECT id, predicted_at::text, target_date::text,
            predicted_dir, pred_horizon, gbdt_ret, lstm_ret, price_at_pred
     FROM index_predictions
     WHERE symbol = $1
       AND correct IS NULL
       AND target_date <= $2
     ORDER BY target_date`,
    [symbol, today],
  );

  if (pending.length === 0) return 0;

  const priceMap = new Map<string, number>(rows.map(r => [r.date, r.close]));
  let resolved = 0;

  for (const row of pending) {
    let actualPrice: number | null = null;
    const target = new Date(row.target_date + "T12:00:00Z");
    for (let offset = 0; offset <= 5; offset++) {
      const d = new Date(target);
      d.setUTCDate(d.getUTCDate() + offset);
      const ds = d.toISOString().slice(0, 10);
      if (priceMap.has(ds)) { actualPrice = priceMap.get(ds)!; break; }
    }
    if (actualPrice === null) continue;

    const actualReturn = (actualPrice - row.price_at_pred) / row.price_at_pred * 100;
    const actualDir    = actualReturn >= 0 ? 1 : -1;
    const correct      = actualDir === row.predicted_dir;

    const gbdtCorrect = row.gbdt_ret !== null ? (row.gbdt_ret >= 0 ? 1 : -1) === actualDir : null;
    const lstmCorrect = row.lstm_ret !== null ? (row.lstm_ret >= 0 ? 1 : -1) === actualDir : null;

    await pool.query(
      `UPDATE index_predictions
       SET actual_return  = $1,
           actual_dir     = $2,
           correct        = $3,
           gbdt_correct   = $4,
           lstm_correct   = $5,
           resolved_at    = NOW()
       WHERE id = $6`,
      [actualReturn, actualDir, correct, gbdtCorrect, lstmCorrect, row.id],
    );
    resolved++;
  }

  if (resolved > 0) {
    console.log(`[tracker] ${symbol} 예측 결과 확인 ${resolved}건`);
  }
  return resolved;
}

// ─── 라이브 정확도 조회 ────────────────────────────────────────────────────────

export interface LiveAccuracy {
  symbol:   string;
  correct:  number;
  total:    number;
  pending:  number;
  accuracy: number | null;
  /** D+1 / D+2 / D+3 별도 적중률 */
  byHorizon: Record<number, { correct: number; total: number; accuracy: number | null }>;
}

export interface ComponentLiveAccuracy {
  gbdtAcc:  number | null;
  lstmAcc:  number | null;
  nSamples: number;
}

export async function getLiveAccuracy(
  symbol: string,
  n = 30,
): Promise<LiveAccuracy> {
  const { rows: resolved } = await pool.query<{ correct: boolean; pred_horizon: number }>(
    `SELECT correct, pred_horizon
     FROM index_predictions
     WHERE symbol = $1 AND correct IS NOT NULL
     ORDER BY predicted_at DESC
     LIMIT $2`,
    [symbol, n * 3],   // 3개 horizon이므로 더 넓게 조회
  );

  const { rows: pendingRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM index_predictions
     WHERE symbol = $1 AND correct IS NULL`,
    [symbol],
  );

  const pending = parseInt(pendingRows[0]?.cnt ?? "0", 10);

  // 각 horizon별 적중률
  const byHorizon: LiveAccuracy["byHorizon"] = {};
  for (const h of [1, 2, 3]) {
    const hRows = resolved.filter(r => r.pred_horizon === h).slice(0, n);
    const hTotal   = hRows.length;
    const hCorrect = hRows.filter(r => r.correct).length;
    byHorizon[h] = {
      correct: hCorrect,
      total:   hTotal,
      accuracy: hTotal >= 5 ? Math.round((hCorrect / hTotal) * 1000) / 10 : null,
    };
  }

  // D+1·D+2·D+3 전체 합산으로 전체 적중률 계산
  const total   = Object.values(byHorizon).reduce((s, v) => s + v.total, 0);
  const correct = Object.values(byHorizon).reduce((s, v) => s + v.correct, 0);

  return {
    symbol,
    correct,
    total,
    pending,
    accuracy: total >= 5 ? Math.round((correct / total) * 1000) / 10 : null,
    byHorizon,
  };
}

export async function getComponentLiveAccuracy(
  symbol: string,
  n = 20,
): Promise<ComponentLiveAccuracy> {
  const { rows } = await pool.query<{
    gbdt_correct: boolean | null;
    lstm_correct: boolean | null;
  }>(
    `SELECT gbdt_correct, lstm_correct
     FROM index_predictions
     WHERE symbol = $1
       AND correct IS NOT NULL
       AND gbdt_correct IS NOT NULL
       AND lstm_correct IS NOT NULL
       AND pred_horizon = 3
     ORDER BY predicted_at DESC
     LIMIT $2`,
    [symbol, n],
  );

  if (rows.length < 5) {
    return { gbdtAcc: null, lstmAcc: null, nSamples: rows.length };
  }

  const gbdtCorrect = rows.filter(r => r.gbdt_correct).length;
  const lstmCorrect = rows.filter(r => r.lstm_correct).length;
  const total = rows.length;

  return {
    gbdtAcc:  gbdtCorrect / total,
    lstmAcc:  lstmCorrect / total,
    nSamples: total,
  };
}

export async function getAllLiveAccuracy(): Promise<Record<string, LiveAccuracy>> {
  const symbols = ["^KS11", "^KQ11", "^GSPC", "^IXIC"];
  const results = await Promise.all(symbols.map(s => getLiveAccuracy(s)));
  return Object.fromEntries(results.map(r => [r.symbol, r]));
}

// ─── 예측 이력 조회 ────────────────────────────────────────────────────────────

export interface PredictionRecord {
  id:              number;
  predicted_at:    string;
  target_date:     string;
  predicted_return: number;
  predicted_dir:   number;
  price_at_pred:   number;
  actual_return:   number | null;
  actual_dir:      number | null;
  correct:         boolean | null;
  pred_horizon:    number;
  gbdt_ret:        number | null;
  lstm_ret:        number | null;
  gbdt_correct:    boolean | null;
  lstm_correct:    boolean | null;
  vix_at_pred:     number | null;
  volatility_at_pred: number | null;
  model_version:   number;
}

// ─── 오늘 예측값 조회 (화면 고정용) ───────────────────────────────────────────

export interface TodayPrediction {
  d1?: number;
  d2?: number;
  d3?: number;
}

/**
 * 오늘(KST) predicted_at으로 저장된 D+1/D+2/D+3 예측값을 반환.
 * ON CONFLICT DO NOTHING으로 처음 저장된 값이 고정됨 → 화면 예측 값 불변 보장.
 */
export async function getTodayPredictions(
  symbols: string[],
): Promise<Record<string, TodayPrediction>> {
  const today = todayKST();
  const result: Record<string, TodayPrediction> = {};
  for (const sym of symbols) result[sym] = {};

  try {
    const { rows } = await pool.query<{
      symbol: string;
      pred_horizon: number;
      predicted_return: number;
    }>(
      `SELECT symbol, pred_horizon, predicted_return
       FROM index_predictions
       WHERE symbol = ANY($1)
         AND predicted_at = $2
       ORDER BY pred_horizon`,
      [symbols, today],
    );

    for (const row of rows) {
      const entry = result[row.symbol] ?? {};
      if (row.pred_horizon === 1) entry.d1 = row.predicted_return;
      if (row.pred_horizon === 2) entry.d2 = row.predicted_return;
      if (row.pred_horizon === 3) entry.d3 = row.predicted_return;
      result[row.symbol] = entry;
    }
  } catch (e) {
    console.error("[getTodayPredictions] DB 조회 실패:", e);
  }

  return result;
}

export async function getPredictionHistory(
  symbol: string,
  limit = 20,
  horizon?: number,
): Promise<PredictionRecord[]> {
  const { rows } = await pool.query<PredictionRecord>(
    `SELECT id,
            predicted_at::text,
            target_date::text,
            predicted_return,
            predicted_dir,
            price_at_pred,
            actual_return,
            actual_dir,
            correct,
            pred_horizon,
            gbdt_ret,
            lstm_ret,
            gbdt_correct,
            lstm_correct,
            vix_at_pred,
            volatility_at_pred,
            model_version
     FROM index_predictions
     WHERE symbol = $1
       ${horizon ? "AND pred_horizon = $3" : ""}
     ORDER BY predicted_at DESC, pred_horizon
     LIMIT $2`,
    horizon ? [symbol, limit, horizon] : [symbol, limit],
  );
  return rows;
}

// ─── 자동 재학습 판단 ──────────────────────────────────────────────────────────

/**
 * rolling30dDirAcc 기반 자동 재학습 판단 — D+3 예측 기준, 최근 30샘플.
 *
 * rolling30dDirAcc = 최근 30거래일(30샘플) D+3 방향 적중률. 모델 내부 지표와 동일한 기준.
 * KOSDAQ(^KQ11)은 구조적 변동성이 높아 더 민감한 기준 적용:
 *   - KOSDAQ: rolling30d D+3 적중률 55% 미만 → 즉시 재학습
 *   - 기타  : rolling30d D+3 적중률 40% 미만 → 재학습
 */
export async function shouldTriggerRetrain(
  symbol: string,
  rollingWindow = 30,
  retrainThreshold?: number,
): Promise<boolean> {
  // 심볼별 임계값: KOSDAQ은 55%, 나머지는 40%
  const threshold = retrainThreshold ?? (symbol === "^KQ11" ? 0.55 : 0.40);

  // D+3 전용 최근 rollingWindow 샘플 조회
  const { rows } = await pool.query<{ correct: boolean }>(
    `SELECT correct
     FROM index_predictions
     WHERE symbol = $1
       AND correct IS NOT NULL
       AND pred_horizon = 3
     ORDER BY predicted_at DESC
     LIMIT $2`,
    [symbol, rollingWindow],
  );

  const minSamples = 10;
  if (rows.length < minSamples) return false;

  const correctCount = rows.filter(r => r.correct).length;
  const rollingAcc   = correctCount / rows.length;

  const trigger = rollingAcc < threshold;
  const accPct   = (rollingAcc * 100).toFixed(1);
  if (trigger) {
    console.log(
      `[tracker] ${symbol} rolling${rows.length}d D+3 적중률 ${accPct}% — 재학습 트리거 (기준: ${(threshold * 100).toFixed(0)}%)`
    );
  } else {
    console.log(
      `[tracker] ${symbol} rolling${rows.length}d D+3 적중률 ${accPct}% — 재학습 불필요 (기준: ${(threshold * 100).toFixed(0)}%)`
    );
  }
  return trigger;
}

// ─── AI Overlay 이후 실제 vs 예측 방향 비교 로그 ─────────────────────────────

/**
 * AI Overlay 개선 이후 최근 N일치 실제 vs 예측 방향을 콘솔에 기록.
 * symbols 기본값: KOSDAQ·KOSPI (분리 추적 목적)
 */
export async function logRecentDirectionComparison(
  symbols = ["^KQ11", "^KS11"],
  days = 7,
): Promise<void> {
  try {
    const { rows } = await pool.query<{
      symbol: string;
      predicted_at: string;
      predicted_dir: number;
      actual_dir: number | null;
      correct: boolean | null;
    }>(
      `SELECT symbol, predicted_at::text, predicted_dir, actual_dir, correct
       FROM index_predictions
       WHERE symbol = ANY($1)
         AND correct IS NOT NULL
         AND pred_horizon = 3
         AND predicted_at >= (CURRENT_DATE - ($2 || ' days')::interval)::date
       ORDER BY symbol, predicted_at DESC`,
      [symbols, days],
    );

    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      if (!grouped[row.symbol]) grouped[row.symbol] = [];
      grouped[row.symbol]!.push(row);
    }

    for (const [sym, symRows] of Object.entries(grouped)) {
      const correct = symRows.filter(r => r.correct).length;
      const total   = symRows.length;
      const acc     = total > 0 ? ((correct / total) * 100).toFixed(1) : "—";
      console.log(`[dir-log] ${sym} 최근 ${days}일 방향 비교 (D+3): ${correct}/${total} 적중 (${acc}%)`);
      for (const r of symRows) {
        const pred   = r.predicted_dir === 1 ? "↑상승" : "↓하락";
        const actual = r.actual_dir   === 1 ? "↑상승" : r.actual_dir === -1 ? "↓하락" : "—";
        const mark   = r.correct ? "✓" : "✗";
        console.log(`  ${r.predicted_at} | 예측=${pred} 실제=${actual} ${mark}`);
      }
    }
  } catch (e: any) {
    console.warn("[dir-log] 방향 비교 로그 실패:", e?.message);
  }
}

// ─── KOSDAQ/KOSPI 주별 적중률 히스토리 ────────────────────────────────────────

export interface AccuracyHistoryPoint {
  week: string;
  kospiAcc:  number | null;
  kosdaqAcc: number | null;
  kospiN:    number;
  kosdaqN:   number;
}

/**
 * KOSPI·KOSDAQ 주별(월요일 기준) 적중률 히스토리.
 * pred_horizon = 3 (D+3) 기준, 최근 weeksBack 주간 데이터 반환.
 */
export async function getAccuracyHistory(weeksBack = 8): Promise<AccuracyHistoryPoint[]> {
  const { rows } = await pool.query<{
    symbol:        string;
    week_start:    string;
    correct_count: number;
    total_count:   number;
  }>(
    `SELECT
       symbol,
       DATE_TRUNC('week', predicted_at)::date::text AS week_start,
       COUNT(*) FILTER (WHERE correct = true)::int   AS correct_count,
       COUNT(*)::int                                  AS total_count
     FROM index_predictions
     WHERE symbol IN ('^KS11', '^KQ11')
       AND correct IS NOT NULL
       AND pred_horizon = 3
       AND predicted_at >= CURRENT_DATE - ($1 * 7 || ' days')::interval
     GROUP BY symbol, DATE_TRUNC('week', predicted_at)
     ORDER BY week_start`,
    [weeksBack],
  );

  const weeksSet = new Set<string>(rows.map(r => r.week_start));
  const weeks    = [...weeksSet].sort();

  return weeks.map(week => {
    const ki = rows.find(r => r.symbol === "^KS11" && r.week_start === week);
    const qi = rows.find(r => r.symbol === "^KQ11" && r.week_start === week);
    return {
      week,
      kospiAcc:  ki && ki.total_count >= 3
        ? Math.round((ki.correct_count / ki.total_count) * 1000) / 10
        : null,
      kosdaqAcc: qi && qi.total_count >= 3
        ? Math.round((qi.correct_count / qi.total_count) * 1000) / 10
        : null,
      kospiN:  ki?.total_count  ?? 0,
      kosdaqN: qi?.total_count  ?? 0,
    };
  });
}
