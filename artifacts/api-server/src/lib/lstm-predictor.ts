/**
 * 시장 예측 파이프라인 v3 (LightGBM-style GBDT + 모델 영속성)
 * ─────────────────────────────────────────────────────────────
 * 1. 초기 학습     : 5년 데이터 → krx_<symbol>_model.json + krx_meta.json 저장
 * 2. 서버 재시작   : 저장된 모델 로드 (재학습 없이 30초 내 복구)
 * 3. 일일 증분     : 16:30 KST 평일 → 최근 60일 데이터로 5 트리 추가
 * 4. 월간 완전학습 : 매월 1일 00:00 KST → 5년 완전 재학습
 */
import fs from "node:fs";
import path from "node:path";
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
  testMae: number; testDirAcc: number;
  wfDirAcc: number; rolling30dDirAcc: number;
  predErrStd: number;
  recentPerf: RecentPerfPoint[];
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

const LOOKBACK     = 20;
const PRED_H       = 3;
const N_ENSEMBLE   = 2;
const GBDT_TREES   = 60;
const GBDT_LR      = 0.05;
const GBDT_DEPTH   = 3;
const GBDT_LEAF    = 20;
const GBDT_FSUB    = 0.55;
const GBDT_SSUB    = 0.80;
const GBDT_BINS    = 32;
const N_INCR_TREES = 5;   // trees added per incremental update
const YEARS_DATA   = 5;
const RECENT_N     = 30;
const CACHE_TTL    = 6 * 3600_000;

// ─── Persistence paths ───────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "artifacts", "api-server", "data");
const MODEL_PATH = (sym: string) => path.join(DATA_DIR, `krx_${sym}_model.json`);
const META_PATH  = path.join(DATA_DIR, "krx_meta.json");

function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

// ─── Stored types ────────────────────────────────────────────────────────────

interface GBDTModel { trees: any[]; lr: number; basePred: number }

interface StoredModelFile {
  models: GBDTModel[];
  scaler: { mu: number[]; sigma: number[] };
}
export interface StoredMeta {
  lastTrained: string;  // full retrain timestamp
  lastUpdated: string;  // last update (incremental or full)
  nSamples: Record<string, number>;
  dirAcc:          Record<string, number>;
  wfDirAcc:        Record<string, number>;
  rolling30dDirAcc: Record<string, number>;
  updateCount: number;  // incremental updates since last full retrain
}

function saveModelFile(sym: string, models: GBDTModel[], scaler: { mu: Float64Array; sigma: Float64Array }) {
  ensureDataDir();
  const payload: StoredModelFile = {
    models,
    scaler: { mu: Array.from(scaler.mu), sigma: Array.from(scaler.sigma) },
  };
  fs.writeFileSync(MODEL_PATH(sym), JSON.stringify(payload));
  console.log(`[gbdt] 모델 저장 완료: ${MODEL_PATH(sym)}`);
}

function loadModelFile(sym: string): { models: GBDTModel[]; scaler: { mu: Float64Array; sigma: Float64Array } } | null {
  const p = MODEL_PATH(sym);
  if (!fs.existsSync(p)) return null;
  try {
    const d: StoredModelFile = JSON.parse(fs.readFileSync(p, "utf-8"));
    return {
      models: d.models,
      scaler: { mu: new Float64Array(d.scaler.mu), sigma: new Float64Array(d.scaler.sigma) },
    };
  } catch (e) {
    console.warn(`[gbdt] 모델 파일 로드 실패 (${sym}):`, e);
    return null;
  }
}

export function saveMeta(meta: StoredMeta) {
  ensureDataDir();
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
}

export function loadMeta(): StoredMeta | null {
  if (!fs.existsSync(META_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(META_PATH, "utf-8")); }
  catch { return null; }
}

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
function dirAccRate(preds: ArrayLike<number>, actual: ArrayLike<number>): number {
  let hits = 0;
  for (let i = 0; i < preds.length; i++) if (Math.sign(preds[i]) === Math.sign(actual[i])) hits++;
  return preds.length > 0 ? hits / (preds as any).length : 0;
}

// ─── Feature engineering ─────────────────────────────────────────────────────

function rollingMean(arr: number[], w: number, i: number): number {
  let s = 0, n = 0;
  for (let k = Math.max(0, i - w + 1); k <= i; k++) { s += arr[k]; n++; }
  return s / n;
}
function rollingStdFn(arr: number[], w: number, i: number): number {
  const sl = arr.slice(Math.max(0, i - w + 1), i + 1);
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
      rsiNorm(rets, 14, i), rollingStdFn(rets, 5, i), rollingStdFn(rets, 20, i),
      Math.max(0, Math.min(1, bband)), mom5, mom10,
    ]);
  });
  return { feats, closes, dates };
}

// ─── Sequence generation ─────────────────────────────────────────────────────

function makeSeqs(feats: Float64Array[], closes: number[], lookback: number, horizon: number) {
  const F = feats[0].length;
  const Xs: Float64Array[] = [], ys: number[] = [], anchors: number[] = [];
  for (let i = lookback; i < feats.length - horizon; i++) {
    const v = new Float64Array(lookback * F + 1);
    for (let t = 0; t < lookback; t++) for (let f = 0; f < F; f++) v[t * F + f] = feats[i - lookback + t][f];
    v[lookback * F] = 1;
    Xs.push(v);
    ys.push((closes[i + horizon] - closes[i]) / closes[i]);
    anchors.push(i);
  }
  return { X: Xs, y: new Float64Array(ys), anchorDateIdxs: anchors };
}

// ─── Standardisation ─────────────────────────────────────────────────────────

function standardize(X: Float64Array[]) {
  const n = X.length, F = X[0].length;
  const mu = new Float64Array(F), sigma = new Float64Array(F);
  for (const row of X) for (let j = 0; j < F; j++) mu[j] += row[j];
  for (let j = 0; j < F; j++) mu[j] /= n;
  for (const row of X) for (let j = 0; j < F; j++) sigma[j] += (row[j] - mu[j]) ** 2;
  for (let j = 0; j < F; j++) sigma[j] = Math.sqrt(sigma[j] / n) || 1;
  const Xn = X.map(row => { const r = new Float64Array(row.length); for (let j = 0; j < row.length; j++) r[j] = (row[j] - mu[j]) / sigma[j]; return r; });
  return { Xn, mu, sigma };
}
function applyStd(X: Float64Array[], mu: Float64Array, sigma: Float64Array): Float64Array[] {
  return X.map(row => { const r = new Float64Array(row.length); for (let j = 0; j < row.length; j++) r[j] = (row[j] - mu[j]) / sigma[j]; return r; });
}

// ─── GBDT ────────────────────────────────────────────────────────────────────

type DNode = { fi: number; thresh: number; left: DNode | number; right: DNode | number };

function dtPredict(node: DNode | number, x: Float64Array): number {
  if (typeof node === "number") return node;
  return x[node.fi] <= node.thresh ? dtPredict(node.left, x) : dtPredict(node.right, x);
}

function buildNode(
  X: Float64Array[], res: number[], idxs: number[],
  depth: number, minLeaf: number, rng: () => number, featureFrac: number, nBins: number,
): DNode | number {
  const n = idxs.length;
  if (depth === 0 || n < minLeaf * 2) { let s = 0; for (const i of idxs) s += res[i]; return s / n; }
  const F = X[0].length;
  const nUsed = Math.max(1, Math.floor(F * featureFrac));
  const fIdxs = Array.from({ length: F }, (_, i) => i).sort(() => rng() - 0.5).slice(0, nUsed);
  let totSum = 0, totSumSq = 0;
  for (const i of idxs) { totSum += res[i]; totSumSq += res[i] * res[i]; }
  const totMse = totSumSq / n - (totSum / n) ** 2;
  let bestGain = 1e-9, bestFi = -1, bestThresh = 0;
  let bestLeft: number[] = [], bestRight: number[] = [];
  for (const fi of fIdxs) {
    const sorted = idxs.slice().sort((a, b) => X[a][fi] - X[b][fi]);
    let lSum = 0, lSumSq = 0;
    const step = Math.max(1, Math.floor(n / nBins));
    for (let k = 1; k < n; k++) {
      lSum += res[sorted[k - 1]]; lSumSq += res[sorted[k - 1]] ** 2;
      if (k % step !== 0 && k !== n - minLeaf) continue;
      if (k < minLeaf || k > n - minLeaf) continue;
      if (X[sorted[k]][fi] === X[sorted[k - 1]][fi]) continue;
      const nl = k, nr = n - k;
      const rSum = totSum - lSum, rSumSq = totSumSq - lSumSq;
      const gain = totMse - (nl * (lSumSq/nl - (lSum/nl)**2) + nr * (rSumSq/nr - (rSum/nr)**2)) / n;
      if (gain > bestGain) {
        bestGain = gain; bestFi = fi;
        bestThresh = (X[sorted[k-1]][fi] + X[sorted[k]][fi]) / 2;
        bestLeft = sorted.slice(0, k); bestRight = sorted.slice(k);
      }
    }
  }
  if (bestFi < 0) { let s = 0; for (const i of idxs) s += res[i]; return s / n; }
  return {
    fi: bestFi, thresh: bestThresh,
    left:  buildNode(X, res, bestLeft,  depth-1, minLeaf, rng, featureFrac, nBins),
    right: buildNode(X, res, bestRight, depth-1, minLeaf, rng, featureFrac, nBins),
  };
}

function gbdtFit(X: Float64Array[], y: Float64Array, seed: number): GBDTModel {
  const rng = makeRng(seed);
  const n = X.length;
  let basePred = 0; for (let i = 0; i < n; i++) basePred += y[i]; basePred /= n;
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
    for (const tree of model.trees) p += model.lr * dtPredict(tree as DNode | number, x);
    return p;
  }));
}

/**
 * Incremental boosting: add N new trees to an existing model.
 * Equivalent to lgb.train(init_model=existing, num_boost_round=N).
 */
function incrementalAddTrees(
  model: GBDTModel,
  X: Float64Array[], y: Float64Array,
  nTrees: number, seed: number,
): GBDTModel {
  if (X.length === 0) return model;
  const rng = makeRng(seed);
  const n = X.length;
  const rowBag = Math.max(1, Math.floor(n * GBDT_SSUB));
  // Start from current ensemble predictions
  const preds = gbdtPredict(model, X);
  const newTrees: (DNode | number)[] = [];
  for (let t = 0; t < nTrees; t++) {
    const res = Array.from({ length: n }, (_, i) => y[i] - preds[i]);
    const idxs = Array.from({ length: n }, (_, i) => i).sort(() => rng() - 0.5).slice(0, Math.min(rowBag, n));
    const tree = buildNode(X, res, idxs, GBDT_DEPTH, GBDT_LEAF, rng, GBDT_FSUB, GBDT_BINS);
    newTrees.push(tree);
    for (let i = 0; i < n; i++) preds[i] += model.lr * dtPredict(tree as DNode | number, X[i]);
  }
  return { ...model, trees: [...model.trees, ...newTrees] };
}

// ─── Data fetch ──────────────────────────────────────────────────────────────

async function fetchHistory(symbol: string, years = YEARS_DATA): Promise<{ date: string; close: number }[]> {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date(), start = new Date();
  start.setFullYear(start.getFullYear() - years);
  const r = await yahoo.chart(symbol, { period1: start, period2: end, interval: "1d" });
  return (r.quotes ?? [])
    .filter((q: any) => q.close != null)
    .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0, 10), close: q.close as number }));
}

// ─── Build IndexResult from trained model (no retraining) ────────────────────

function buildResultFromModel(
  symbol: string, name: string,
  rows: { date: string; close: number }[],
  models: GBDTModel[],
  scaler: { mu: Float64Array; sigma: Float64Array },
): IndexResult {
  const { feats, closes, dates } = buildFeatures(rows);
  const { X, y, anchorDateIdxs } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
  const n = X.length;
  const trainEnd = Math.floor(n * 0.80);
  const Xte = X.slice(trainEnd), yte = y.slice(trainEnd);
  const XteN = applyStd(Xte, scaler.mu, scaler.sigma);

  const testPreds = new Float64Array(Xte.length);
  for (const m of models) {
    const p = gbdtPredict(m, XteN);
    for (let i = 0; i < p.length; i++) testPreds[i] += p[i] / models.length;
  }

  const nTest = testPreds.length;
  const wfMid = Math.floor(nTest / 2);
  const wf1 = dirAccRate(testPreds.slice(0, wfMid), Array.from(yte).slice(0, wfMid));
  const wf2 = dirAccRate(testPreds.slice(wfMid),    Array.from(yte).slice(wfMid));
  const wfDirAcc = +((wf1 + wf2) / 2 * 100).toFixed(1);

  let mae = 0;
  for (let i = 0; i < nTest; i++) mae += Math.abs(testPreds[i] - yte[i]);
  mae /= nTest || 1;
  const testDirAcc = +(dirAccRate(testPreds, yte) * 100).toFixed(1);

  const lastN = Math.min(RECENT_N, nTest);
  const last30Preds  = Array.from(testPreds).slice(-lastN);
  const last30Actual = Array.from(yte).slice(-lastN);
  const rolling30dDirAcc = +(dirAccRate(last30Preds, last30Actual) * 100).toFixed(1);
  const recentErrors = last30Actual.map((a, i) => a - last30Preds[i]);
  const predErrStd = +(stddev(recentErrors) * 100).toFixed(3);

  const recentPerf: RecentPerfPoint[] = last30Preds.map((pred, m) => {
    const j = nTest - lastN + m;
    const anchorIdx = anchorDateIdxs[trainEnd + j];
    return { date: dates[anchorIdx] ?? `D${m}`, predicted: +(pred * 100).toFixed(2), actual: +(last30Actual[m] * 100).toFixed(2) };
  });

  const lastXn = applyStd([X[n - 1]], scaler.mu, scaler.sigma);
  const forecastReturn = models.map(m => gbdtPredict(m, lastXn)[0]).reduce((a, b) => a + b, 0) / models.length;
  const curVal = closes[closes.length - 1];
  const pred3d = curVal * (1 + forecastReturn);
  const bandPrice = (predErrStd / 100) * curVal;

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

  return {
    symbol, name,
    historical: dates.slice(-90).map((date, i) => ({ date, value: +closes[closes.length - 90 + i].toFixed(2) })),
    predictions,
    currentValue: +curVal.toFixed(2),
    predictedReturn3d: +(forecastReturn * 100).toFixed(2),
    trend: forecastReturn >= 0 ? "up" : "down",
    testMae: +(mae * 100).toFixed(3), testDirAcc, wfDirAcc, rolling30dDirAcc, predErrStd, recentPerf,
  };
}

// ─── Full training ────────────────────────────────────────────────────────────

function trainFull(
  symbol: string, name: string,
  rows: { date: string; close: number }[],
): IndexResult & { _models: GBDTModel[]; _scaler: { mu: Float64Array; sigma: Float64Array } } {
  const { feats, closes, dates } = buildFeatures(rows);
  const { X, y, anchorDateIdxs } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
  const n = X.length;
  const trainEnd = Math.floor(n * 0.80);
  const Xtr = X.slice(0, trainEnd), ytr = y.slice(0, trainEnd);
  const { Xn: XtrN, mu, sigma } = standardize(Xtr);
  const models = Array.from({ length: N_ENSEMBLE }, (_, e) => gbdtFit(XtrN, ytr, e * 37 + 13));
  // Save to disk
  saveModelFile(symbol.replace(/[\^]/g, ""), models, { mu, sigma });
  const result = buildResultFromModel(symbol, name, rows, models, { mu, sigma });
  return { ...result, _models: models, _scaler: { mu, sigma } };
}

// ─── Data fetch ──────────────────────────────────────────────────────────────

export function getStatus(): PipelineStatus {
  return {
    running: _status.running, ready: _status.ready,
    steps: _status.steps.map(s => ({ ...s })),
    error: _status.error, trainedAt: _status.trainedAt,
    trainingMs: _status.trainingMs, kospi: _status.kospi, kosdaq: _status.kosdaq,
  };
}

// ─── Try to restore from saved model files ────────────────────────────────────

export async function tryRestoreFromDisk(): Promise<boolean> {
  const meta = loadMeta();
  const kospiStored  = loadModelFile("KS11");
  const kosdaqStored = loadModelFile("KQ11");
  if (!meta || !kospiStored || !kosdaqStored) return false;

  console.log("[gbdt] 저장된 모델 복원 중... (last:", meta.lastUpdated, ")");
  try {
    // Fetch only 60 days (lightweight) for fresh predictions
    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchHistory("^KS11", 0.25),   // ~90 days
      fetchHistory("^KQ11", 0.25),
    ]);
    const kospi  = buildResultFromModel("^KS11", "KOSPI",  kospiRows,  kospiStored.models,  kospiStored.scaler);
    const kosdaq = buildResultFromModel("^KQ11", "KOSDAQ", kosdaqRows, kosdaqStored.models, kosdaqStored.scaler);
    _lastRun = Date.now();
    _status = {
      running: false, ready: true,
      steps: defaultSteps().map(s => ({ ...s, status: "done" as const })),
      trainedAt: meta.lastTrained, trainingMs: 0, kospi, kosdaq,
    };
    console.log("[gbdt] 디스크 복원 완료 (재학습 없음)");
    return true;
  } catch (e: any) {
    console.warn("[gbdt] 디스크 복원 실패:", e?.message);
    return false;
  }
}

// ─── Full pipeline (initial / monthly retrain) ────────────────────────────────

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

    stepSet("feature", "running"); stepSet("feature", "done", 0);
    stepSet("sequence", "running"); stepSet("sequence", "done", 0);

    stepSet("train", "running");
    const s4 = Date.now();
    const [kospiResult, kosdaqResult] = await Promise.all([
      new Promise<ReturnType<typeof trainFull>>(res => res(trainFull("^KS11", "KOSPI",  kospiRows))),
      new Promise<ReturnType<typeof trainFull>>(res => res(trainFull("^KQ11", "KOSDAQ", kosdaqRows))),
    ]);
    stepSet("train", "done", Date.now() - s4);
    stepSet("ensemble", "running"); stepSet("ensemble", "done", 0);
    stepSet("output", "running"); stepSet("output", "done", 0);

    const trainedAt = new Date().toISOString();
    // Save metadata
    const existingMeta = loadMeta();
    saveMeta({
      lastTrained: trainedAt, lastUpdated: trainedAt,
      nSamples: { kospi: kospiRows.length, kosdaq: kosdaqRows.length },
      dirAcc:           { kospi: kospiResult.testDirAcc,        kosdaq: kosdaqResult.testDirAcc },
      wfDirAcc:         { kospi: kospiResult.wfDirAcc,          kosdaq: kosdaqResult.wfDirAcc },
      rolling30dDirAcc: { kospi: kospiResult.rolling30dDirAcc,  kosdaq: kosdaqResult.rolling30dDirAcc },
      updateCount: 0,
    });

    _lastRun = now;
    _status = {
      running: false, ready: true, steps: _status.steps,
      trainedAt, trainingMs: Date.now() - t0,
      kospi: kospiResult, kosdaq: kosdaqResult,
    };
    console.log(
      `[gbdt] 완전학습 완료 ${Date.now() - t0}ms | KOSPI wfAcc=${kospiResult.wfDirAcc}% roll30=${kospiResult.rolling30dDirAcc}%`
    );
  } catch (err: any) {
    console.error("[gbdt] 파이프라인 오류:", err?.message ?? err);
    const failing = _status.steps.find(s => s.status === "running");
    if (failing) failing.status = "error";
    _status = { ..._status, running: false, ready: false, error: err?.message ?? String(err) };
  }
}

// ─── Daily incremental update ─────────────────────────────────────────────────

export async function runDailyIncrementalUpdate(): Promise<void> {
  if (_status.running) { console.log("[gbdt] 학습 중이라 증분 업데이트 건너뜀"); return; }

  const meta = loadMeta();
  const kospiStored  = loadModelFile("KS11");
  const kosdaqStored = loadModelFile("KQ11");

  if (!kospiStored || !kosdaqStored) {
    console.log("[gbdt] 저장된 모델 없음 → 완전 학습으로 전환");
    return runPipeline(true);
  }

  console.log("[gbdt] 일일 증분 업데이트 시작");
  const t0 = Date.now();

  try {
    // Fetch 90 days for feature computation context
    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchHistory("^KS11", 0.35),
      fetchHistory("^KQ11", 0.35),
    ]);

    // Identify new data since last update
    const lastUpdated = meta?.lastUpdated ?? "2000-01-01";

    function getNewSamples(rows: { date: string; close: number }[], stored: typeof kospiStored) {
      const { feats, closes, dates } = buildFeatures(rows);
      const { X, y, anchorDateIdxs } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
      // New = anchor date strictly after lastUpdated
      const newIdxs = X.map((_, k) => k).filter(k => (dates[anchorDateIdxs[k]] ?? "") > lastUpdated);
      if (newIdxs.length === 0) return null;
      const XteN = applyStd(newIdxs.map(k => X[k]), stored.scaler.mu, stored.scaler.sigma);
      const yNew = new Float64Array(newIdxs.map(k => y[k]));
      return { XteN, yNew };
    }

    const kospiNew  = getNewSamples(kospiRows,  kospiStored);
    const kosdaqNew = getNewSamples(kosdaqRows, kosdaqStored);

    if (!kospiNew && !kosdaqNew) {
      console.log("[gbdt] 새로운 데이터 없음 — 증분 업데이트 건너뜀");
      return;
    }

    // Add N_INCR_TREES trees to each model in each ensemble
    const updatedKospiModels = kospiNew
      ? kospiStored.models.map((m, e) => incrementalAddTrees(m, kospiNew.XteN, kospiNew.yNew, N_INCR_TREES, e * 7 + Date.now() % 1000))
      : kospiStored.models;
    const updatedKosdaqModels = kosdaqNew
      ? kosdaqStored.models.map((m, e) => incrementalAddTrees(m, kosdaqNew.XteN, kosdaqNew.yNew, N_INCR_TREES, e * 7 + 3 + Date.now() % 1000))
      : kosdaqStored.models;

    // Save updated models
    saveModelFile("KS11", updatedKospiModels,  kospiStored.scaler);
    saveModelFile("KQ11", updatedKosdaqModels, kosdaqStored.scaler);

    // Rebuild IndexResult with updated models
    const [kospi, kosdaq] = await Promise.all([
      Promise.resolve(buildResultFromModel("^KS11", "KOSPI",  kospiRows,  updatedKospiModels,  kospiStored.scaler)),
      Promise.resolve(buildResultFromModel("^KQ11", "KOSDAQ", kosdaqRows, updatedKosdaqModels, kosdaqStored.scaler)),
    ]);

    const now = new Date().toISOString();
    saveMeta({
      ...(meta ?? { lastTrained: now, nSamples: {}, dirAcc: {}, wfDirAcc: {}, rolling30dDirAcc: {}, updateCount: 0 }),
      lastUpdated: now,
      dirAcc:           { kospi: kospi.testDirAcc,        kosdaq: kosdaq.testDirAcc },
      wfDirAcc:         { kospi: kospi.wfDirAcc,          kosdaq: kosdaq.wfDirAcc },
      rolling30dDirAcc: { kospi: kospi.rolling30dDirAcc,  kosdaq: kosdaq.rolling30dDirAcc },
      updateCount: (meta?.updateCount ?? 0) + 1,
    });

    _lastRun = Date.now();
    _status = { ..._status, ready: true, kospi, kosdaq };
    console.log(`[gbdt] 증분 업데이트 완료 ${Date.now() - t0}ms | +${N_INCR_TREES} 트리/모델 | updateCount=${(meta?.updateCount ?? 0) + 1}`);
  } catch (e: any) {
    console.error("[gbdt] 증분 업데이트 실패:", e?.message ?? e);
  }
}
