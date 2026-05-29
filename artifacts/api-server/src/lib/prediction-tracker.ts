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

// ─── KRX 공휴일 목록 (주말 외 평일 공휴일) ────────────────────────────────────
const KRX_HOLIDAYS = new Set([
  // 2025
  "2025-01-01","2025-01-28","2025-01-29","2025-01-30",
  "2025-05-05","2025-05-06","2025-06-06","2025-08-15",
  "2025-10-03","2025-10-06","2025-10-07","2025-10-09",
  "2025-12-25","2025-12-31",
  // 2026
  "2026-01-01","2026-02-16","2026-02-17","2026-02-18",
  "2026-03-02","2026-05-05","2026-05-25",
  "2026-10-09","2026-12-25","2026-12-31",
  // 2027
  "2027-01-01","2027-02-06","2027-02-07","2027-02-08",
  "2027-03-01","2027-05-05","2027-06-06","2027-08-16",
  "2027-10-04","2027-10-05","2027-10-06","2027-10-11",
  "2027-12-24","2027-12-31",
]);

function isKRXTradingDay(ds: string): boolean {
  const dow = new Date(ds + "T12:00:00Z").getUTCDay();
  return dow !== 0 && dow !== 6 && !KRX_HOLIDAYS.has(ds);
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function addTradingDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ds = d.toISOString().slice(0, 10);
    if (isKRXTradingDay(ds)) added++;
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
  const targetDate  = addTradingDays(predictedAt, predHorizon);
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

  // D+3 기준으로 전체 적중률 계산 (기존 방식 유지)
  const h3rows = resolved.filter(r => r.pred_horizon === 3).slice(0, n);
  const total   = h3rows.length;
  const correct = h3rows.filter(r => r.correct).length;
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

export async function shouldTriggerRetrain(
  symbol: string,
  minSamples = 10,
  retrainThreshold = 0.40,
): Promise<boolean> {
  const acc = await getLiveAccuracy(symbol, minSamples);
  if (acc.total < minSamples || acc.accuracy === null) return false;
  const trigger = acc.accuracy / 100 < retrainThreshold;
  if (trigger) {
    console.log(`[tracker] ${symbol} 라이브 적중률 ${acc.accuracy}% — 재학습 트리거`);
  }
  return trigger;
}
