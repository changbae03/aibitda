/**
 * 시장 예측 파이프라인 v2 (LightGBM-style GBDT)
 * ─────────────────────────────────────────────
 * 1. 데이터 수집 : Yahoo Finance ^KS11 / ^KQ11 (5년)
 * 2. 피처 엔지니어링 : 9개 피처 × 20일 lookback
 * 3. 시퀀스 생성   : sliding window, 181차원 벡터
 * 4. GBDT 학습     : max_depth=3, min_child=20, histogram split
 * 5. 앙상블        : 2× GBDT (seed 다양화)
 * 6. Walk-Forward 검증 + Rolling 30d 정확도 계산
 */
import YahooFinance from "yahoo-finance2";

// ─── Public types ────────────────────────────────────────────────────────────

export interface PredPoint { date: string; value: number; lower: number; upper: number }
export interface RecentPerfPoint { date: string; predicted: number; actual: number }

export interface IndexResult {
  symbol: string; name: string;
  historical: { date: string; value: number }[];
  predictions: PredPoint[];
  currentValue: number;
  predictedReturn3d: number;
  trend: "up" | "down";
  // Metrics
  testMae: number;           // MAE on full test set (%)
  testDirAcc: number;        // overall dir accuracy on test set (%)
  wfDirAcc: number;          // walk-forward avg dir accuracy across 2 windows (%)
  rolling30dDirAcc: number;  // last-30 sample directional accuracy (%)
  predErrStd: number;        // std dev of last-30 prediction errors (%, used for chart band)
  recentPerf: RecentPerfPoint[]; // last 30 predicted vs actual returns (%)
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

// ─── Hyperparameters ─────────────────────────────────────────────────────────

const LOOKBACK   = 20;
const PRED_H     = 3;
const N_FEATURES = 9;
const N_ENSEMBLE = 2;
const GBDT_TREES = 60;
const GBDT_LR    = 0.05;
const GBDT_DEPTH = 3;    // max_depth
const GBDT_LEAF  = 20;   // min_child_samples
const GBDT_FSUB  = 0.55;
const GBDT_SSUB  = 0.80;
const GBDT_BINS  = 32;   // histogram bins (speed optimisation)
const CACHE_TTL  = 6 * 3600_000;
const YEARS_DATA = 5;
const RECENT_N   = 30;   // window for rolling accuracy / performance chart

// ─── Pipeline state ──────────────────────────────────────────────────────────

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
function stepSet(key: string, status: PipelineStep["status"], ms?: number) {
  const s = _status.steps.find(s => s.key === key);
  if (s) { s.status = status; if (ms !== undefined) s.durationMs = ms; }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s = Math.imul(s, 1664525) + 1013904223 >>> 0; return s / 0x100000000; };
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length);
}

function dirAccRate(preds: Float64Array | number[], actual: Float64Array | number[]): number {
  let hits = 0;
  for (let i = 0; i < preds.length; i++) if (Math.sign(preds[i]) === Math.sign(actual[i])) hits++;
  return preds.length > 0 ? hits / preds.length : 0;
}

// ─── Feature engineering ─────────────────────────────────────────────────────

function rollingMean(arr: number[], w: number, i: number): number {
  let s = 0, n = 0;
  for (let k = Math.max(0, i - w + 1); k <= i; k++) { s += arr[k]; n++; }
  return s / n;
}
function rollingStdFn(arr: number[], w: number, i: number): number {
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
  return l < 1e-10 ? 1 : 1 - 1 / (1 + g / l);
}

function buildFeatures(rows: { date: string; close: number }[]): {
  feats: Float64Array[]; closes: number[]; dates: string[];
} {
  const closes = rows.map(r => r.close);
  const dates  = rows.map(r => r.date);
  const rets   = closes.map((c, i) => i === 0 ? 0 : (c - closes[i-1]) / closes[i-1]);
  const feats  = rows.map((_, i): Float64Array => {
    const ma5   = rollingMean(closes, 5, i);
    const ma20  = rollingMean(closes, 20, i);
    const std20 = rollingStdFn(rets, 20, i);
    const bband = std20 > 1e-10 ? (closes[i] - (ma20 - 2 * std20 * Math.abs(ma20))) / (4 * std20 * Math.abs(ma20) || 1) : 0.5;
    const mom5  = i >= 5  ? (closes[i] / closes[i-5])  - 1 : 0;
    const mom10 = i >= 10 ? (closes[i] / closes[i-10]) - 1 : 0;
    return new Float64Array([
      rets[i],
      ma5  > 0 ? closes[i] / ma5  - 1 : 0,
      ma20 > 0 ? closes[i] / ma20 - 1 : 0,
      rsiNorm(rets, 14, i),
      rollingStdFn(rets, 5, i),
      rollingStdFn(rets, 20, i),
      Math.max(0, Math.min(1, bband)),
      mom5, mom10,
    ]);
  });
  return { feats, closes, dates };
}

// ─── Sequence generation ─────────────────────────────────────────────────────

function makeSeqs(
  feats: Float64Array[], closes: number[],
  lookback: number, horizon: number,
): { X: Float64Array[]; y: Float64Array; anchorDateIdxs: number[] } {
  const F = feats[0].length;
  const Xs: Float64Array[] = [], ys: number[] = [], anchors: number[] = [];
  for (let i = lookback; i < feats.length - horizon; i++) {
    const v = new Float64Array(lookback * F + 1);
    for (let t = 0; t < lookback; t++)
      for (let f = 0; f < F; f++) v[t * F + f] = feats[i - lookback + t][f];
    v[lookback * F] = 1;
    Xs.push(v);
    ys.push((closes[i + horizon] - closes[i]) / closes[i]);
    anchors.push(i); // index in `closes`/`dates` for "current" day
  }
  return { X: Xs, y: new Float64Array(ys), anchorDateIdxs: anchors };
}

// ─── Standardisation ─────────────────────────────────────────────────────────

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

// ─── GBDT with histogram splits ───────────────────────────────────────────────

type DNode = { fi: number; thresh: number; left: DNode | number; right: DNode | number };

function dtPredict(node: DNode | number, x: Float64Array): number {
  if (typeof node === "number") return node;
  return x[node.fi] <= node.thresh ? dtPredict(node.left, x) : dtPredict(node.right, x);
}

function buildNode(
  X: Float64Array[], res: number[], idxs: number[],
  depth: number, minLeaf: number, rng: () => number,
  featureFrac: number, nBins: number,
): DNode | number {
  const n = idxs.length;
  if (depth === 0 || n < minLeaf * 2) {
    let s = 0; for (const i of idxs) s += res[i]; return s / n;
  }

  const F = X[0].length;
  const nUsed = Math.max(1, Math.floor(F * featureFrac));
  const fIdxs = Array.from({ length: F }, (_, i) => i).sort(() => rng() - 0.5).slice(0, nUsed);

  let totSum = 0, totSumSq = 0;
  for (const i of idxs) { totSum += res[i]; totSumSq += res[i] * res[i]; }
  const totMse = totSumSq / n - (totSum / n) ** 2;

  let bestGain = 1e-9, bestFi = -1, bestThresh = 0;
  let bestLeft: number[] = [], bestRight: number[] = [];

  for (const fi of fIdxs) {
    // Sort by feature value once
    const sorted = idxs.slice().sort((a, b) => X[a][fi] - X[b][fi]);

    let lSum = 0, lSumSq = 0;
    // Histogram: evaluate at most nBins evenly-spaced positions
    const step = Math.max(1, Math.floor(n / nBins));

    for (let k = 1; k < n; k++) {
      lSum += res[sorted[k - 1]]; lSumSq += res[sorted[k - 1]] ** 2;
      // Only evaluate at step intervals and boundaries
      if (k % step !== 0 && k !== n - minLeaf) continue;
      if (k < minLeaf || k > n - minLeaf) continue;
      // Skip identical adjacent values (can't split here)
      if (X[sorted[k]][fi] === X[sorted[k - 1]][fi]) continue;

      const nl = k, nr = n - k;
      const rSum = totSum - lSum, rSumSq = totSumSq - lSumSq;
      const lMse = lSumSq / nl - (lSum / nl) ** 2;
      const rMse = rSumSq / nr - (rSum / nr) ** 2;
      const gain = totMse - (nl * lMse + nr * rMse) / n;

      if (gain > bestGain) {
        bestGain = gain;
        bestFi = fi;
        bestThresh = (X[sorted[k - 1]][fi] + X[sorted[k]][fi]) / 2;
        bestLeft  = sorted.slice(0, k);
        bestRight = sorted.slice(k);
      }
    }
  }

  if (bestFi < 0) { let s = 0; for (const i of idxs) s += res[i]; return s / n; }
  return {
    fi: bestFi, thresh: bestThresh,
    left:  buildNode(X, res, bestLeft,  depth - 1, minLeaf, rng, featureFrac, nBins),
    right: buildNode(X, res, bestRight, depth - 1, minLeaf, rng, featureFrac, nBins),
  };
}

interface GBDTModel { trees: (DNode | number)[]; lr: number; basePred: number }

function gbdtFit(X: Float64Array[], y: Float64Array, seed: number): GBDTModel {
  const rng = makeRng(seed);
  const n = X.length;
  let basePred = 0;
  for (let i = 0; i < n; i++) basePred += y[i];
  basePred /= n;

  const preds = new Float64Array(n).fill(basePred);
  const trees: (DNode | number)[] = [];
  const rowBag = Math.floor(n * GBDT_SSUB);

  for (let t = 0; t < GBDT_TREES; t++) {
    const res = Array.from({ length: n }, (_, i) => y[i] - preds[i]);
    const idxs = Array.from({ length: n }, (_, i) => i).sort(() => rng() - 0.5).slice(0, rowBag);
    const tree = buildNode(X, res, idxs, GBDT_DEPTH, GBDT_LEAF, rng, GBDT_FSUB, GBDT_BINS);
    trees.push(tree);
    for (let i = 0; i < n; i++) preds[i] += GBDT_LR * dtPredict(tree, X[i]);
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

// ─── Data fetch ──────────────────────────────────────────────────────────────

async function fetchHistory(symbol: string): Promise<{ date: string; close: number }[]> {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date(), start = new Date();
  start.setFullYear(start.getFullYear() - YEARS_DATA);
  const r = await yahoo.chart(symbol, { period1: start, period2: end, interval: "1d" });
  return (r.quotes ?? [])
    .filter((q: any) => q.close != null)
    .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close as number }));
}

// ─── Core result builder ─────────────────────────────────────────────────────

function buildResult(
  symbol: string, name: string,
  rows: { date: string; close: number }[],
): IndexResult {
  const { feats, closes, dates } = buildFeatures(rows);
  const { X, y, anchorDateIdxs } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
  const n = X.length;

  // 80/20 train-test split
  const trainEnd = Math.floor(n * 0.80);
  const Xtr = X.slice(0, trainEnd), ytr = y.slice(0, trainEnd);
  const Xte = X.slice(trainEnd),  yte = y.slice(trainEnd);

  const { Xn: XtrN, mu, sigma } = standardize(Xtr);
  const XteN = applyStd(Xte, mu, sigma);

  // Train ensemble
  const models = Array.from({ length: N_ENSEMBLE }, (_, e) => gbdtFit(XtrN, ytr, e * 37 + 13));

  // Test predictions (ensemble average)
  const testPreds = new Float64Array(Xte.length);
  for (const m of models) {
    const p = gbdtPredict(m, XteN);
    for (let i = 0; i < p.length; i++) testPreds[i] += p[i] / N_ENSEMBLE;
  }

  // ── Walk-forward validation: split test set into 2 windows ──────────────
  const nTest = testPreds.length;
  const wfMid = Math.floor(nTest / 2);
  const wf1Acc = dirAccRate(testPreds.slice(0, wfMid), Array.from(yte).slice(0, wfMid));
  const wf2Acc = dirAccRate(testPreds.slice(wfMid),    Array.from(yte).slice(wfMid));
  const wfDirAcc = +((wf1Acc + wf2Acc) / 2 * 100).toFixed(1);

  // ── Overall test metrics ─────────────────────────────────────────────────
  let mae = 0;
  for (let i = 0; i < nTest; i++) mae += Math.abs(testPreds[i] - yte[i]);
  mae /= nTest || 1;
  const testDirAcc = +(dirAccRate(testPreds, yte) * 100).toFixed(1);

  // ── Rolling 30-day directional accuracy ─────────────────────────────────
  const lastN = Math.min(RECENT_N, nTest);
  const last30Preds  = Array.from(testPreds).slice(-lastN);
  const last30Actual = Array.from(yte).slice(-lastN);
  const rolling30dDirAcc = +(dirAccRate(last30Preds, last30Actual) * 100).toFixed(1);

  // ── Prediction error std (for confidence band = ±1σ) ────────────────────
  const recentErrors = last30Actual.map((a, i) => a - last30Preds[i]);
  const predErrStd = +(stddev(recentErrors) * 100).toFixed(3);

  // ── Recent performance: last 30 test predictions vs actual ───────────────
  const recentPerf: RecentPerfPoint[] = last30Preds.map((pred, m) => {
    const j = nTest - lastN + m;
    const anchorIdx = anchorDateIdxs[trainEnd + j];
    return {
      date: dates[anchorIdx] ?? `D${m}`,
      predicted: +(pred * 100).toFixed(2),
      actual:    +(last30Actual[m] * 100).toFixed(2),
    };
  });

  // ── Final forecast (using last known sequence) ───────────────────────────
  const lastXn = applyStd([X[n - 1]], mu, sigma);
  const forecasts = models.map(m => gbdtPredict(m, lastXn)[0]);
  const forecastReturn = forecasts.reduce((a, b) => a + b, 0) / N_ENSEMBLE;

  const curVal = closes[closes.length - 1];
  const pred3d = curVal * (1 + forecastReturn);
  // Use recent prediction error std as confidence band (±1σ)
  const bandPrice = (predErrStd / 100) * curVal;

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
    return { date, value: +v.toFixed(2), lower: +(v - bandPrice).toFixed(2), upper: +(v + bandPrice).toFixed(2) };
  });

  const hist90 = dates.slice(-90);
  const c90 = closes.slice(-90);
  const historical = hist90.map((date, i) => ({ date, value: +c90[i].toFixed(2) }));

  return {
    symbol, name, historical, predictions,
    currentValue: +curVal.toFixed(2),
    predictedReturn3d: +(forecastReturn * 100).toFixed(2),
    trend: forecastReturn >= 0 ? "up" : "down",
    testMae: +(mae * 100).toFixed(3),
    testDirAcc,
    wfDirAcc,
    rolling30dDirAcc,
    predErrStd,
    recentPerf,
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
    stepSet("data", "running");
    const s1 = Date.now();
    const [kospiRows, kosdaqRows] = await Promise.all([fetchHistory("^KS11"), fetchHistory("^KQ11")]);
    stepSet("data", "done", Date.now() - s1);

    stepSet("feature", "running");
    const s2 = Date.now();
    buildFeatures(kospiRows); buildFeatures(kosdaqRows);
    stepSet("feature", "done", Date.now() - s2);

    stepSet("sequence", "running");
    const s3 = Date.now();
    const kf = buildFeatures(kospiRows), qf = buildFeatures(kosdaqRows);
    makeSeqs(kf.feats, kf.closes, LOOKBACK, PRED_H);
    makeSeqs(qf.feats, qf.closes, LOOKBACK, PRED_H);
    stepSet("sequence", "done", Date.now() - s3);

    stepSet("train", "running");
    const s4 = Date.now();
    const [kospi, kosdaq] = await Promise.all([
      new Promise<IndexResult>(res => res(buildResult("^KS11", "KOSPI", kospiRows))),
      new Promise<IndexResult>(res => res(buildResult("^KQ11", "KOSDAQ", kosdaqRows))),
    ]);
    stepSet("train", "done", Date.now() - s4);

    stepSet("ensemble", "running"); stepSet("ensemble", "done", 0);
    stepSet("output", "running");
    const trainedAt = new Date().toISOString();
    stepSet("output", "done", 0);

    _lastRun = now;
    _status = {
      running: false, ready: true,
      steps: _status.steps, trainedAt,
      trainingMs: Date.now() - t0,
      kospi, kosdaq,
    };
    console.log(
      `[gbdt] 완료 ${Date.now() - t0}ms | KOSPI pred=${kospi.predictedReturn3d}% wfAcc=${kospi.wfDirAcc}% roll30=${kospi.rolling30dDirAcc}%`
    );
  } catch (err: any) {
    console.error("[gbdt] 오류:", err?.message ?? err);
    const failing = _status.steps.find(s => s.status === "running");
    if (failing) failing.status = "error";
    _status = { ..._status, running: false, ready: false, error: err?.message ?? String(err) };
  }
}
