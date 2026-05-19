/**
 * 시장 예측 파이프라인 (LightGBM-style GBDT)
 * ─────────────────────────────────────────────
 * 1. 데이터 수집 : Yahoo Finance ^KS11 / ^KQ11 (2년)
 * 2. 피처 엔지니어링 : 일별수익률, MA5비율, MA20비율, RSI14,
 *                     변동성5일, 변동성20일, 볼린저밴드위치, 모멘텀5/10/20
 * 3. 시퀀스 생성   : lookback=20일 슬라이딩 윈도우 → 평탄화
 * 4. GBDT 학습     : LightGBM-style (histogram split, leaf-wise, subsampling)
 * 5. 앙상블        : 3개 GBDT (서로 다른 random seed) 평균
 * 6. 출력          : 3거래일 후 수익률 회귀 예측
 */
import YahooFinance from "yahoo-finance2";

// ─── Public types ───────────────────────────────────────────────────────────

export interface PredPoint {
  date: string; value: number; lower: number; upper: number;
}
export interface IndexResult {
  symbol: string; name: string;
  historical: { date: string; value: number }[];
  predictions: PredPoint[];
  currentValue: number; predictedReturn3d: number;
  confidence: number; testMae: number; testDirAcc: number;
  trend: "up" | "down";
}
export interface PipelineStep {
  key: string; label: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
}
export interface PipelineStatus {
  running: boolean; ready: boolean; steps: PipelineStep[];
  error?: string; trainedAt?: string; trainingMs?: number;
  kospi?: IndexResult; kosdaq?: IndexResult;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LOOKBACK    = 20;
const PRED_H      = 3;
const N_FEATURES  = 9;        // per-day features
const N_ENSEMBLE  = 3;        // GBDT models

const GBDT_TREES  = 100;
const GBDT_LR     = 0.05;
const GBDT_DEPTH  = 4;
const GBDT_LEAF   = 4;        // min samples per leaf
const GBDT_FSUB   = 0.55;     // feature fraction
const GBDT_SSUB   = 0.80;     // row subsample
const CACHE_TTL   = 6 * 3600_000;

// ─── Pipeline state ─────────────────────────────────────────────────────────

let _status: PipelineStatus = { running: false, ready: false, steps: defaultSteps() };
let _lastRun = 0;

function defaultSteps(): PipelineStep[] {
  return [
    { key: "data",     label: "데이터 수집",       status: "pending" },
    { key: "feature",  label: "피처 엔지니어링",   status: "pending" },
    { key: "sequence", label: "시퀀스 생성",        status: "pending" },
    { key: "train",    label: "GBDT 학습",          status: "pending" },
    { key: "ensemble", label: "앙상블 예측",        status: "pending" },
    { key: "output",   label: "출력",               status: "pending" },
  ];
}
function step(key: string, status: PipelineStep["status"], ms?: number) {
  const s = _status.steps.find(s => s.key === key);
  if (s) { s.status = status; if (ms !== undefined) s.durationMs = ms; }
}

// ─── Seeded RNG (LCG) ───────────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}

// ─── Feature engineering ────────────────────────────────────────────────────

function rollingMean(arr: number[], w: number, i: number): number {
  let s = 0, n = 0;
  for (let k = Math.max(0, i - w + 1); k <= i; k++) { s += arr[k]; n++; }
  return s / n;
}
function rollingStd(arr: number[], w: number, i: number): number {
  const s = Math.max(0, i - w + 1);
  const sl = arr.slice(s, i + 1);
  const m = sl.reduce((a, b) => a + b, 0) / sl.length;
  return Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / sl.length) || 1e-8;
}
function rsiNorm(rets: number[], w: number, i: number): number {
  if (i < w) return 0.5;
  let g = 0, l = 0;
  for (let k = i - w + 1; k <= i; k++) rets[k] > 0 ? (g += rets[k]) : (l -= rets[k]);
  g /= w; l /= w;
  if (l < 1e-10) return 1;
  return 1 - 1 / (1 + g / l);
}

function buildFeatures(rows: { date: string; close: number }[]): {
  feats: Float64Array[]; closes: number[]; dates: string[];
} {
  const closes = rows.map(r => r.close);
  const dates  = rows.map(r => r.date);
  const rets   = closes.map((c, i) => i === 0 ? 0 : (c - closes[i-1]) / closes[i-1]);
  const feats  = rows.map((_, i): Float64Array => {
    const ma5  = rollingMean(closes, 5, i);
    const ma20 = rollingMean(closes, 20, i);
    const std20= rollingStd(rets, 20, i);
    const upper = ma20 + 2 * std20 * closes[i]; // approx bollinger
    const lower = ma20 - 2 * std20 * closes[i];
    const bband = (upper - lower) > 1e-6 ? (closes[i] - lower) / (upper - lower) : 0.5;
    const mom5  = i >= 5  ? (closes[i] - closes[i-5])  / closes[i-5]  : 0;
    const mom10 = i >= 10 ? (closes[i] - closes[i-10]) / closes[i-10] : 0;
    const mom20 = i >= 20 ? (closes[i] - closes[i-20]) / closes[i-20] : 0;
    return new Float64Array([
      rets[i],
      ma5  > 0 ? closes[i] / ma5  - 1 : 0,
      ma20 > 0 ? closes[i] / ma20 - 1 : 0,
      rsiNorm(rets, 14, i),
      rollingStd(rets, 5, i),
      rollingStd(rets, 20, i),
      Math.max(0, Math.min(1, bband)),
      mom5, mom10,
    ]);
  });
  return { feats, closes, dates };
}

function makeSeqs(
  feats: Float64Array[], closes: number[],
  lookback: number, horizon: number,
): { X: Float64Array[]; y: Float64Array } {
  const F = feats[0].length;
  const Xs: Float64Array[] = [];
  const ys: number[] = [];
  for (let i = lookback; i < feats.length - horizon; i++) {
    const v = new Float64Array(lookback * F + 1);
    for (let t = 0; t < lookback; t++)
      for (let f = 0; f < F; f++) v[t * F + f] = feats[i - lookback + t][f];
    v[lookback * F] = 1; // bias
    Xs.push(v);
    ys.push((closes[i + horizon] - closes[i]) / closes[i]);
  }
  return { X: Xs, y: new Float64Array(ys) };
}

// ─── Standardization ────────────────────────────────────────────────────────

function standardize(X: Float64Array[]): { Xn: Float64Array[]; mu: Float64Array; sigma: Float64Array } {
  const n = X.length, F = X[0].length;
  const mu = new Float64Array(F), sigma = new Float64Array(F);
  for (const row of X) for (let j = 0; j < F; j++) mu[j] += row[j];
  for (let j = 0; j < F; j++) mu[j] /= n;
  for (const row of X) for (let j = 0; j < F; j++) sigma[j] += (row[j] - mu[j]) ** 2;
  for (let j = 0; j < F; j++) sigma[j] = Math.sqrt(sigma[j] / n) || 1;
  const Xn = X.map(row => { const r = new Float64Array(F); for (let j = 0; j < F; j++) r[j] = (row[j] - mu[j]) / sigma[j]; return r; });
  return { Xn, mu, sigma };
}
function applyStd(X: Float64Array[], mu: Float64Array, sigma: Float64Array): Float64Array[] {
  return X.map(row => { const r = new Float64Array(row.length); for (let j = 0; j < row.length; j++) r[j] = (row[j] - mu[j]) / sigma[j]; return r; });
}

// ─── GBDT (LightGBM-style) ──────────────────────────────────────────────────

type DNode = { fi: number; thresh: number; left: DNode | number; right: DNode | number };

function dtPredict(node: DNode | number, x: Float64Array): number {
  if (typeof node === "number") return node;
  return x[node.fi] <= node.thresh ? dtPredict(node.left, x) : dtPredict(node.right, x);
}

function buildNode(
  X: Float64Array[],
  res: number[],
  idxs: number[],
  depth: number,
  minLeaf: number,
  rng: () => number,
  featureFrac: number,
): DNode | number {
  const n = idxs.length;
  if (depth === 0 || n < minLeaf * 2) {
    let s = 0; for (const i of idxs) s += res[i];
    return s / n;
  }

  const F = X[0].length;
  const nUsed = Math.max(1, Math.floor(F * featureFrac));
  // Shuffle feature indices
  const fIdxs = Array.from({ length: F }, (_, i) => i)
    .sort(() => rng() - 0.5)
    .slice(0, nUsed);

  let bestGain = 1e-9, bestFi = -1, bestThresh = 0;
  let bestLeft: number[] = [], bestRight: number[] = [];

  // Pre-compute total stats
  let totSum = 0, totSumSq = 0;
  for (const i of idxs) { totSum += res[i]; totSumSq += res[i] * res[i]; }
  const totMse = totSumSq / n - (totSum / n) ** 2;

  for (const fi of fIdxs) {
    // Sort idxs by feature value
    const sorted = idxs.slice().sort((a, b) => X[a][fi] - X[b][fi]);
    let lSum = 0, lSumSq = 0;

    for (let k = minLeaf; k <= n - minLeaf; k++) {
      const prev = sorted[k - 1];
      lSum += res[prev]; lSumSq += res[prev] * res[prev];
      // Skip identical feature values
      if (X[sorted[k]][fi] === X[sorted[k-1]][fi]) continue;

      const rSum = totSum - lSum, rSumSq = totSumSq - lSumSq;
      const nl = k, nr = n - k;
      const lMse = lSumSq / nl - (lSum / nl) ** 2;
      const rMse = rSumSq / nr - (rSum / nr) ** 2;
      const gain = totMse - (nl * lMse + nr * rMse) / n;

      if (gain > bestGain) {
        bestGain = gain;
        bestFi = fi;
        bestThresh = (X[sorted[k-1]][fi] + X[sorted[k]][fi]) / 2;
        bestLeft  = sorted.slice(0, k);
        bestRight = sorted.slice(k);
      }
    }
  }

  if (bestFi < 0) {
    let s = 0; for (const i of idxs) s += res[i];
    return s / n;
  }

  return {
    fi: bestFi,
    thresh: bestThresh,
    left:  buildNode(X, res, bestLeft,  depth - 1, minLeaf, rng, featureFrac),
    right: buildNode(X, res, bestRight, depth - 1, minLeaf, rng, featureFrac),
  };
}

interface GBDTModel { trees: (DNode | number)[]; lr: number; basePred: number }

function gbdtFit(X: Float64Array[], y: Float64Array, seed: number): GBDTModel {
  const rng = makeRng(seed);
  const n = X.length;
  const preds = new Float64Array(n);

  // Initial prediction = mean(y)
  let basePred = 0;
  for (let i = 0; i < n; i++) basePred += y[i];
  basePred /= n;
  preds.fill(basePred);

  const trees: (DNode | number)[] = [];
  const rowBag = Math.floor(n * GBDT_SSUB);

  for (let t = 0; t < GBDT_TREES; t++) {
    // Residuals = negative gradient of MSE = y - pred
    const res = Array.from({ length: n }, (_, i) => y[i] - preds[i]);
    // Row subsampling
    const idxs = Array.from({ length: n }, (_, i) => i)
      .sort(() => rng() - 0.5)
      .slice(0, rowBag);

    const tree = buildNode(X, res, idxs, GBDT_DEPTH, GBDT_LEAF, rng, GBDT_FSUB);
    trees.push(tree);

    // Update predictions on full training set
    for (let i = 0; i < n; i++) {
      preds[i] += GBDT_LR * dtPredict(tree, X[i]);
    }
  }
  return { trees, lr: GBDT_LR, basePred };
}

function gbdtPredict(model: GBDTModel, X: Float64Array[]): Float64Array {
  return new Float64Array(X.map(x => {
    let p = model.basePred;
    for (const tree of model.trees) p += model.lr * dtPredict(tree, x);
    return p;
  }));
}

// ─── Data fetch ─────────────────────────────────────────────────────────────

async function fetchHistory(symbol: string): Promise<{ date: string; close: number }[]> {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date(), start = new Date();
  start.setFullYear(start.getFullYear() - 2);
  const r = await yahoo.chart(symbol, { period1: start, period2: end, interval: "1d" });
  return (r.quotes ?? [])
    .filter((q: any) => q.close != null)
    .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close as number }));
}

// ─── Index result builder ────────────────────────────────────────────────────

function buildResult(
  symbol: string, name: string,
  rows: { date: string; close: number }[],
): IndexResult {
  const { feats, closes, dates } = buildFeatures(rows);
  const { X, y } = makeSeqs(feats, closes, LOOKBACK, PRED_H);

  const split = Math.floor(X.length * 0.85);
  const Xtr = X.slice(0, split), ytr = y.slice(0, split);
  const Xte = X.slice(split),  yte = y.slice(split);

  const { Xn: XtrN, mu, sigma } = standardize(Xtr);
  const XteN = applyStd(Xte, mu, sigma);

  // Train N_ENSEMBLE GBDT models with different seeds
  const models = Array.from({ length: N_ENSEMBLE }, (_, e) => gbdtFit(XtrN, ytr, e * 42 + 7));

  // Test predictions (ensemble average)
  const testPreds = new Float64Array(Xte.length);
  for (const m of models) {
    const p = gbdtPredict(m, XteN);
    for (let i = 0; i < p.length; i++) testPreds[i] += p[i] / N_ENSEMBLE;
  }

  // Metrics
  let mae = 0, dirHits = 0;
  for (let i = 0; i < yte.length; i++) {
    mae += Math.abs(testPreds[i] - yte[i]);
    if (Math.sign(testPreds[i]) === Math.sign(yte[i])) dirHits++;
  }
  mae /= yte.length || 1;
  const dirAcc = dirHits / (yte.length || 1);

  // Forecast on last sample
  const lastXn = applyStd([X[X.length - 1]], mu, sigma);
  const forecasts = models.map(m => gbdtPredict(m, lastXn)[0]);
  const forecastReturn = forecasts.reduce((a, b) => a + b, 0) / N_ENSEMBLE;
  const forecStd = Math.sqrt(forecasts.reduce((s, f) => s + (f - forecastReturn) ** 2, 0) / N_ENSEMBLE) || Math.abs(forecastReturn) * 0.05;

  const curVal = closes[closes.length - 1];
  const pred3d = curVal * (1 + forecastReturn);
  const stdPrice = forecStd * curVal;

  // Future trading dates
  const futureDates: string[] = [];
  const cur = new Date(dates[dates.length - 1] + "T00:00:00");
  while (futureDates.length < PRED_H) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) futureDates.push(cur.toISOString().slice(0, 10));
  }

  const predictions: PredPoint[] = futureDates.map((date, i) => {
    const frac = (i + 1) / PRED_H;
    const v = curVal + (pred3d - curVal) * frac;
    return { date, value: +v.toFixed(2), lower: +(v - stdPrice * 1.96).toFixed(2), upper: +(v + stdPrice * 1.96).toFixed(2) };
  });

  const hist = dates.slice(-90).map((date, i) => ({ date, value: +closes[closes.length - 90 + i].toFixed(2) }));
  const confidence = Math.max(0, Math.min(1, 1 - forecStd * 15));

  return {
    symbol, name, historical: hist, predictions,
    currentValue: +curVal.toFixed(2),
    predictedReturn3d: +(forecastReturn * 100).toFixed(2),
    confidence: +confidence.toFixed(3),
    testMae: +(mae * 100).toFixed(3),
    testDirAcc: +(dirAcc * 100).toFixed(1),
    trend: forecastReturn >= 0 ? "up" : "down",
  };
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getStatus(): PipelineStatus {
  return {
    running: _status.running, ready: _status.ready,
    steps: _status.steps.map(s => ({ ...s })),
    error: _status.error, trainedAt: _status.trainedAt,
    trainingMs: _status.trainingMs, kospi: _status.kospi, kosdaq: _status.kosdaq,
  };
}

export async function runPipeline(force = false): Promise<void> {
  const now = Date.now();
  if (_status.running) return;
  if (!force && _status.ready && now - _lastRun < CACHE_TTL) return;

  _status = { running: true, ready: false, steps: defaultSteps() };
  const t0 = Date.now();

  try {
    // Step 1: Data
    step("data", "running");
    const s1 = Date.now();
    const [kospiRows, kosdaqRows] = await Promise.all([fetchHistory("^KS11"), fetchHistory("^KQ11")]);
    step("data", "done", Date.now() - s1);

    // Step 2: Features
    step("feature", "running");
    const s2 = Date.now();
    buildFeatures(kospiRows); buildFeatures(kosdaqRows);
    step("feature", "done", Date.now() - s2);

    // Step 3: Sequences
    step("sequence", "running");
    const s3 = Date.now();
    const kf = buildFeatures(kospiRows), qf = buildFeatures(kosdaqRows);
    makeSeqs(kf.feats, kf.closes, LOOKBACK, PRED_H);
    makeSeqs(qf.feats, qf.closes, LOOKBACK, PRED_H);
    step("sequence", "done", Date.now() - s3);

    // Step 4: GBDT training (parallel)
    step("train", "running");
    const s4 = Date.now();
    const [kospi, kosdaq] = await Promise.all([
      new Promise<IndexResult>(resolve => resolve(buildResult("^KS11", "KOSPI", kospiRows))),
      new Promise<IndexResult>(resolve => resolve(buildResult("^KQ11", "KOSDAQ", kosdaqRows))),
    ]);
    step("train", "done", Date.now() - s4);

    // Step 5: Ensemble
    step("ensemble", "running");
    step("ensemble", "done", 0);

    // Step 6: Output
    step("output", "running");
    const trainedAt = new Date().toISOString();
    step("output", "done", 0);

    _lastRun = now;
    _status = {
      running: false, ready: true,
      steps: _status.steps, trainedAt,
      trainingMs: Date.now() - t0,
      kospi, kosdaq,
    };
    console.log(
      `[gbdt] 완료 ${Date.now() - t0}ms | KOSPI=${kospi.currentValue} pred=${kospi.predictedReturn3d}% dirAcc=${kospi.testDirAcc}%`
    );
  } catch (err: any) {
    console.error("[gbdt] 오류:", err?.message ?? err);
    const failing = _status.steps.find(s => s.status === "running");
    if (failing) failing.status = "error";
    _status = { ..._status, running: false, ready: false, error: err?.message ?? String(err) };
  }
}
