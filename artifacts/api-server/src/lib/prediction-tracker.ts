/**
 * prediction-tracker.ts
 * ─────────────────────
 * 매일 예측값을 DB에 저장하고, 3거래일 후 실제 결과를 비교·기록하는 모듈.
 *
 * 테이블: index_predictions
 *   - 예측 저장  : savePrediction()
 *   - 결과 확인  : resolveExpiredPredictions()
 *   - 라이브 정확도 조회: getLiveAccuracy()
 *   - 자동 재학습 판단: shouldTriggerRetrain()
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
      predicted_dir    SMALLINT     NOT NULL,  -- 1=상승, -1=하락
      price_at_pred    FLOAT        NOT NULL,
      actual_return    FLOAT,
      actual_dir       SMALLINT,
      correct          BOOLEAN,
      resolved_at      TIMESTAMPTZ,
      model_version    SMALLINT     NOT NULL DEFAULT 0,
      UNIQUE(symbol, predicted_at)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ip_symbol_predicted
    ON index_predictions(symbol, predicted_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ip_unresolved
    ON index_predictions(symbol, target_date)
    WHERE correct IS NULL
  `);
}

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────────

function addTradingDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

// ─── 예측 저장 ─────────────────────────────────────────────────────────────────

/**
 * 오늘의 예측을 저장한다. UPSERT — 같은 날 여러 번 호출돼도 최신값으로 갱신.
 * @param symbol     ^KS11 | ^KQ11 | ^GSPC | ^IXIC
 * @param predictedReturn3d  3일 후 예측 수익률 (%)
 * @param currentPrice       오늘 종가
 * @param modelVersion       모델 버전
 * @param predHorizon        예측 기간 (영업일, 기본 3)
 */
export async function savePrediction(
  symbol: string,
  predictedReturn3d: number,
  currentPrice: number,
  modelVersion: number,
  predHorizon = 3,
): Promise<void> {
  const predictedAt = todayKST();
  const targetDate  = addTradingDays(predictedAt, predHorizon);
  const dir = predictedReturn3d >= 0 ? 1 : -1;

  await pool.query(
    `INSERT INTO index_predictions
       (symbol, predicted_at, target_date, predicted_return, predicted_dir,
        price_at_pred, model_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (symbol, predicted_at)
     DO UPDATE SET
       predicted_return = EXCLUDED.predicted_return,
       predicted_dir    = EXCLUDED.predicted_dir,
       price_at_pred    = EXCLUDED.price_at_pred,
       target_date      = EXCLUDED.target_date,
       model_version    = EXCLUDED.model_version`,
    [symbol, predictedAt, targetDate, predictedReturn3d, dir, currentPrice, modelVersion],
  );
}

// ─── 만료된 예측 결과 확인 ──────────────────────────────────────────────────────

/**
 * target_date ≤ 오늘인 미결 예측에 실제 결과를 기록한다.
 * @param symbol  지수 심볼
 * @param rows    fetchHistory 결과 ({ date, close } 배열)
 * @returns       이번에 결과를 기록한 건수
 */
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
    price_at_pred: number;
  }>(
    `SELECT id, predicted_at::text, target_date::text, predicted_dir, price_at_pred
     FROM index_predictions
     WHERE symbol = $1
       AND correct IS NULL
       AND target_date <= $2
     ORDER BY target_date`,
    [symbol, today],
  );

  if (pending.length === 0) return 0;

  // date → close 맵 생성
  const priceMap = new Map<string, number>(rows.map(r => [r.date, r.close]));

  let resolved = 0;
  for (const row of pending) {
    // target_date 이후 최초로 데이터가 있는 날 찾기 (공휴일 보정)
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

    await pool.query(
      `UPDATE index_predictions
       SET actual_return = $1, actual_dir = $2, correct = $3, resolved_at = NOW()
       WHERE id = $4`,
      [actualReturn, actualDir, correct, row.id],
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
  accuracy: number | null;   // null = 샘플 부족
}

/**
 * 최근 n개 resolved 예측의 실제 적중률을 반환한다.
 */
export async function getLiveAccuracy(
  symbol: string,
  n = 30,
): Promise<LiveAccuracy> {
  const { rows: resolved } = await pool.query<{ correct: boolean }>(
    `SELECT correct
     FROM index_predictions
     WHERE symbol = $1 AND correct IS NOT NULL
     ORDER BY predicted_at DESC
     LIMIT $2`,
    [symbol, n],
  );

  const { rows: pendingRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM index_predictions
     WHERE symbol = $1 AND correct IS NULL`,
    [symbol],
  );

  const total   = resolved.length;
  const correct = resolved.filter(r => r.correct).length;
  const pending = parseInt(pendingRows[0]?.cnt ?? "0", 10);

  return {
    symbol,
    correct,
    total,
    pending,
    accuracy: total >= 5 ? Math.round((correct / total) * 1000) / 10 : null,
  };
}

/**
 * 전체 심볼 라이브 정확도 한번에 조회
 */
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
  model_version:   number;
}

export async function getPredictionHistory(
  symbol: string,
  limit = 20,
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
            model_version
     FROM index_predictions
     WHERE symbol = $1
     ORDER BY predicted_at DESC
     LIMIT $2`,
    [symbol, limit],
  );
  return rows;
}

// ─── 자동 재학습 판단 ──────────────────────────────────────────────────────────

/**
 * 최근 10개 이상 resolved 예측 중 정확도가 retrain_threshold 미만이면 true.
 * 정상 상태에서는 항상 false (샘플 부족 시도 false).
 */
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
