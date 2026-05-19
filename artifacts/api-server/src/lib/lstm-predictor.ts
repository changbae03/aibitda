/**
 * 시장 예측 파이프라인
 * - 데이터 수집: Yahoo Finance (^KS11, ^KQ11)
 * - 피처 엔지니어링: 일별수익률, MA5비율, MA20비율, RSI14, 변동성5일, 변동성20일
 * - 시퀀스 생성: lookback=20일 슬라이딩 윈도우
 * - 앙상블: 3개 Ridge Regression (λ=0.001, 0.01, 0.1)
 * - 예측: 3거래일 후 수익률 회귀
 */
import YahooFinance from "yahoo-finance2";

export interface PredPoint {
  date: string;
  value: number;
  lower: number;
  upper: number;
}

export interface IndexResult {
  symbol: string;
  name: string;
  historical: { date: string; value: number }[];
  predictions: PredPoint[];
  currentValue: number;
  predictedReturn3d: number;
  confidence: number;
  testMae: number;
  testDirAcc: number;
  trend: "up" | "down";
}

export interface PipelineStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
}

export interface PipelineStatus {
  running: boolean;
  ready: boolean;
  steps: PipelineStep[];
  error?: string;
  trainedAt?: string;
  trainingMs?: number;
  kospi?: IndexResult;
  kosdaq?: IndexResult;
}

const LOOKBACK = 20;
const PRED_HORIZON = 3;
const LAMBDAS = [0.001, 0.01, 0.1]; // 앙상블 Ridge λ
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let _status: PipelineStatus = { running: false, ready: false, steps: makeDefaultSteps() };
let _lastRunAt = 0;

function makeDefaultSteps(): PipelineStep[] {
  return [
    { key: "data",     label: "데이터 수집",       status: "pending" },
    { key: "feature",  label: "피처 엔지니어링",   status: "pending" },
    { key: "sequence", label: "시퀀스 생성",        status: "pending" },
    { key: "train",    label: "모델 학습",          status: "pending" },
    { key: "ensemble", label: "앙상블 예측",        status: "pending" },
    { key: "output",   label: "출력",               status: "pending" },
  ];
}

function setStep(key: string, status: PipelineStep["status"], durationMs?: number) {
  const s = _status.steps.find(s => s.key === key);
  if (s) { s.status = status; if (durationMs !== undefined) s.durationMs = durationMs; }
}

// ───────── Matrix math ─────────

function matMulVec(A: Float64Array[], v: Float64Array): Float64Array {
  const out = new Float64Array(A.length);
  for (let i = 0; i < A.length; i++) {
    let s = 0;
    for (let j = 0; j < v.length; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

function matMulAB(A: Float64Array[], B: Float64Array[]): Float64Array[] {
  const rows = A.length, cols = B[0].length, inner = B.length;
  const C = Array.from({ length: rows }, () => new Float64Array(cols));
  for (let i = 0; i < rows; i++)
    for (let k = 0; k < inner; k++)
      if (A[i][k] !== 0)
        for (let j = 0; j < cols; j++) C[i][j] += A[i][k] * B[k][j];
  return C;
}

function transpose(A: Float64Array[]): Float64Array[] {
  const rows = A.length, cols = A[0].length;
  const T = Array.from({ length: cols }, () => new Float64Array(rows));
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) T[j][i] = A[i][j];
  return T;
}

/** Gaussian elimination with partial pivoting: solves Ax = b */
function solve(A: Float64Array[], b: Float64Array): Float64Array {
  const n = A.length;
  const M = A.map((row, i) => { const r = new Float64Array(n + 1); r.set(row); r[n] = b[i]; return r; });
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const pivot = M[col][col];
    if (Math.abs(pivot) < 1e-14) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / pivot;
      if (factor === 0) continue;
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

/** Ridge regression: w = (X^T X + λI)^{-1} X^T y */
function ridgeFit(X: Float64Array[], y: Float64Array, lambda: number): Float64Array {
  const Xt = transpose(X);
  const XtX = matMulAB(Xt, X);
  for (let i = 0; i < XtX.length; i++) XtX[i][i] += lambda;
  const Xty = matMulVec(Xt, y);
  return solve(XtX, Xty);
}

function ridgePredict(X: Float64Array[], w: Float64Array): Float64Array {
  return new Float64Array(X.map(row => {
    let s = 0;
    for (let j = 0; j < w.length; j++) s += row[j] * w[j];
    return s;
  }));
}

// ───────── Feature engineering ─────────

function ma(arr: number[], win: number, i: number): number {
  const s = Math.max(0, i - win + 1);
  let sum = 0;
  for (let k = s; k <= i; k++) sum += arr[k];
  return sum / (i - s + 1);
}

function rsiNorm(rets: number[], win: number, i: number): number {
  if (i < win) return 0.5;
  let gains = 0, losses = 0;
  for (let k = i - win + 1; k <= i; k++) {
    if (rets[k] > 0) gains += rets[k]; else losses -= rets[k];
  }
  gains /= win; losses /= win;
  if (losses < 1e-10) return 1;
  const rs = gains / losses;
  return 1 - 1 / (1 + rs);
}

function rollingStd(rets: number[], win: number, i: number): number {
  const s = Math.max(0, i - win + 1);
  const sl = rets.slice(s, i + 1);
  const m = sl.reduce((a, b) => a + b, 0) / sl.length;
  return Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / sl.length);
}

function buildFeatures(rows: { date: string; close: number }[]): {
  featureMatrix: Float64Array[];
  closes: number[];
  dates: string[];
} {
  const closes = rows.map(r => r.close);
  const dates = rows.map(r => r.date);
  const rets = closes.map((c, i) => i === 0 ? 0 : (c - closes[i - 1]) / closes[i - 1]);
  const featureMatrix: Float64Array[] = rows.map((_, i) => {
    const ma5 = ma(closes, 5, i);
    const ma20 = ma(closes, 20, i);
    return new Float64Array([
      rets[i],
      ma5 > 0 ? closes[i] / ma5 - 1 : 0,
      ma20 > 0 ? closes[i] / ma20 - 1 : 0,
      rsiNorm(rets, 14, i),
      rollingStd(rets, 5, i),
      rollingStd(rets, 20, i),
    ]);
  });
  return { featureMatrix, closes, dates };
}

/** Flatten lookback window into single feature vector, add bias */
function makeSequences(
  featureMatrix: Float64Array[],
  closes: number[],
  lookback: number,
  horizon: number,
): { X: Float64Array[]; y: Float64Array } {
  const nF = featureMatrix[0].length;
  const rows: Float64Array[] = [];
  const ys: number[] = [];
  for (let i = lookback; i < featureMatrix.length - horizon; i++) {
    const vec = new Float64Array(lookback * nF + 1); // +1 for bias
    for (let t = 0; t < lookback; t++)
      for (let f = 0; f < nF; f++) vec[t * nF + f] = featureMatrix[i - lookback + t][f];
    vec[lookback * nF] = 1; // bias
    rows.push(vec);
    ys.push((closes[i + horizon] - closes[i]) / closes[i]);
  }
  return { X: rows, y: new Float64Array(ys) };
}

// ───────── Normalisation ─────────

function standardize(X: Float64Array[]): { Xn: Float64Array[]; means: Float64Array; stds: Float64Array } {
  const n = X.length, f = X[0].length;
  const means = new Float64Array(f);
  const stds = new Float64Array(f);
  for (const row of X) for (let j = 0; j < f; j++) means[j] += row[j];
  for (let j = 0; j < f; j++) means[j] /= n;
  for (const row of X) for (let j = 0; j < f; j++) stds[j] += (row[j] - means[j]) ** 2;
  for (let j = 0; j < f; j++) stds[j] = Math.sqrt(stds[j] / n) || 1;
  const Xn = X.map(row => {
    const r = new Float64Array(f);
    for (let j = 0; j < f; j++) r[j] = (row[j] - means[j]) / stds[j];
    return r;
  });
  return { Xn, means, stds };
}

function applyStd(X: Float64Array[], means: Float64Array, stds: Float64Array): Float64Array[] {
  return X.map(row => {
    const r = new Float64Array(row.length);
    for (let j = 0; j < row.length; j++) r[j] = (row[j] - means[j]) / stds[j];
    return r;
  });
}

// ───────── Data fetch ─────────

async function fetchHistory(symbol: string): Promise<{ date: string; close: number }[]> {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 2);
  const result = await yahoo.chart(symbol, { period1: start, period2: end, interval: "1d" });
  return (result.quotes ?? [])
    .filter((q: any) => q.close != null)
    .map((q: any) => ({
      date: new Date(q.date).toISOString().slice(0, 10),
      close: q.close as number,
    }));
}

// ───────── Build one index result ─────────

function buildIndexResult(
  symbol: string,
  name: string,
  rows: { date: string; close: number }[],
): IndexResult {
  const { featureMatrix, closes, dates } = buildFeatures(rows);
  const { X, y } = makeSequences(featureMatrix, closes, LOOKBACK, PRED_HORIZON);

  const split = Math.floor(X.length * 0.85);
  const Xtrain = X.slice(0, split);
  const ytrain = y.slice(0, split);
  const Xtest = X.slice(split);
  const ytest = y.slice(split);

  const { Xn: XtrainN, means, stds } = standardize(Xtrain);
  const XtestN = applyStd(Xtest, means, stds);

  // Ensemble: 3 Ridge models with different λ
  const weights = LAMBDAS.map(lambda => ridgeFit(XtrainN, ytrain, lambda));
  const ensTestPreds = weights.map(w => ridgePredict(XtestN, w));

  // Average ensemble preds on test set
  const avgTestPreds = new Float64Array(ytest.length);
  for (let i = 0; i < ytest.length; i++) {
    let s = 0;
    for (const p of ensTestPreds) s += p[i];
    avgTestPreds[i] = s / LAMBDAS.length;
  }

  // Metrics
  let mae = 0, dirHits = 0;
  for (let i = 0; i < ytest.length; i++) {
    mae += Math.abs(avgTestPreds[i] - ytest[i]);
    if (Math.sign(avgTestPreds[i]) === Math.sign(ytest[i])) dirHits++;
  }
  mae /= ytest.length || 1;
  const dirAcc = dirHits / (ytest.length || 1);

  // Forecast on last LOOKBACK days
  const lastSeqArr = makeSequences(
    featureMatrix.slice(-LOOKBACK - PRED_HORIZON),
    closes.slice(-LOOKBACK - PRED_HORIZON),
    LOOKBACK,
    PRED_HORIZON,
  );
  // Use the very last sequence (current state)
  const allX = X;
  const { Xn: allXn } = standardize(allX);
  const lastXn = applyStd([X[X.length - 1]], means, stds);

  const forecasts = weights.map(w => ridgePredict(lastXn, w)[0]);
  const forecastReturn = forecasts.reduce((a, b) => a + b, 0) / LAMBDAS.length;
  const forecastStd = Math.sqrt(forecasts.reduce((s, f) => s + (f - forecastReturn) ** 2, 0) / LAMBDAS.length) || Math.abs(forecastReturn) * 0.1;

  const currentValue = closes[closes.length - 1];
  const pred3dValue = currentValue * (1 + forecastReturn);
  const stdPrice = forecastStd * currentValue;

  // Future trading dates
  const futureDates: string[] = [];
  const cur = new Date(dates[dates.length - 1] + "T00:00:00");
  while (futureDates.length < PRED_HORIZON) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) futureDates.push(cur.toISOString().slice(0, 10));
  }

  const predictions: PredPoint[] = futureDates.map((date, i) => {
    const frac = (i + 1) / PRED_HORIZON;
    const v = currentValue + (pred3dValue - currentValue) * frac;
    return {
      date,
      value: +v.toFixed(2),
      lower: +(v - stdPrice * 1.96).toFixed(2),
      upper: +(v + stdPrice * 1.96).toFixed(2),
    };
  });

  const hist90 = dates.slice(-90);
  const c90 = closes.slice(-90);
  const historical = hist90.map((date, i) => ({ date, value: +c90[i].toFixed(2) }));
  const confidence = Math.max(0, Math.min(1, 1 - forecastStd * 20));

  return {
    symbol, name, historical, predictions,
    currentValue: +currentValue.toFixed(2),
    predictedReturn3d: +(forecastReturn * 100).toFixed(2),
    confidence: +confidence.toFixed(3),
    testMae: +(mae * 100).toFixed(3),
    testDirAcc: +(dirAcc * 100).toFixed(1),
    trend: forecastReturn >= 0 ? "up" : "down",
  };
}

// ───────── Public API ─────────

export function getStatus(): PipelineStatus {
  return {
    running: _status.running,
    ready: _status.ready,
    steps: _status.steps.map(s => ({ ...s })),
    error: _status.error,
    trainedAt: _status.trainedAt,
    trainingMs: _status.trainingMs,
    kospi: _status.kospi,
    kosdaq: _status.kosdaq,
  };
}

export async function runPipeline(force = false): Promise<void> {
  const now = Date.now();
  if (_status.running) return;
  if (!force && _status.ready && now - _lastRunAt < CACHE_TTL_MS) return;

  _status = { running: true, ready: false, steps: makeDefaultSteps() };
  const t0 = Date.now();

  try {
    // Step 1: Data
    setStep("data", "running");
    const s1 = Date.now();
    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchHistory("^KS11"),
      fetchHistory("^KQ11"),
    ]);
    setStep("data", "done", Date.now() - s1);

    // Step 2: Feature engineering
    setStep("feature", "running");
    const s2 = Date.now();
    const kospiFeats = buildFeatures(kospiRows);
    const kosdaqFeats = buildFeatures(kosdaqRows);
    setStep("feature", "done", Date.now() - s2);

    // Step 3: Sequence generation
    setStep("sequence", "running");
    const s3 = Date.now();
    makeSequences(kospiFeats.featureMatrix, kospiFeats.closes, LOOKBACK, PRED_HORIZON);
    makeSequences(kosdaqFeats.featureMatrix, kosdaqFeats.closes, LOOKBACK, PRED_HORIZON);
    setStep("sequence", "done", Date.now() - s3);

    // Step 4: Model training (Ridge Regression ensemble)
    setStep("train", "running");
    const s4 = Date.now();
    const kospi = buildIndexResult("^KS11", "KOSPI", kospiRows);
    const kosdaq = buildIndexResult("^KQ11", "KOSDAQ", kosdaqRows);
    setStep("train", "done", Date.now() - s4);

    // Step 5: Ensemble outputs
    setStep("ensemble", "running");
    const s5 = Date.now();
    setStep("ensemble", "done", Date.now() - s5);

    // Step 6: Output
    setStep("output", "running");
    const s6 = Date.now();
    const trainedAt = new Date().toISOString();
    setStep("output", "done", Date.now() - s6);

    _lastRunAt = now;
    _status = {
      running: false,
      ready: true,
      steps: _status.steps,
      trainedAt,
      trainingMs: Date.now() - t0,
      kospi,
      kosdaq,
    };
    console.log(`[lstm-predictor] 파이프라인 완료 ${Date.now() - t0}ms KOSPI=${kospi.currentValue} pred=${kospi.predictedReturn3d}%`);
  } catch (err: any) {
    console.error("[lstm-predictor] Pipeline error:", err?.message ?? err);
    const failingStep = _status.steps.find(s => s.status === "running");
    if (failingStep) failingStep.status = "error";
    _status = {
      ..._status,
      running: false,
      ready: false,
      error: err?.message ?? String(err),
    };
  }
}
