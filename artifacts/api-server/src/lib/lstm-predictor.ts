/**
 * 시장 예측 파이프라인 v4  — LSTM + GBDT 앙상블
 * ───────────────────────────────────────────────
 * 1. LSTM (TF.js)  : 시계열 패턴 · (20일 × 9피처) 시퀀스
 * 2. GBDT          : 피처 간 비선형 상호작용 (현재 구현)
 * 3. 앙상블        : 최근 30일 방향정확도 비율로 적응형 가중치
 * 4. 영속성        : 가중치 JSON 직렬화 (krx_<sym>_model.json)
 * 5. 일일 증분     : GBDT +5트리 (LSTM 스킵 — 1일 데이터 부족)
 * 6. 월간 완전학습 : LSTM + GBDT 모두 재학습
 */
import fs   from "node:fs";
import path from "node:path";
import * as tf from "@tensorflow/tfjs";
import YahooFinance from "yahoo-finance2";

// ─── Public types ────────────────────────────────────────────────────────────

export interface PredPoint       { date: string; value: number; lower: number; upper: number }
export interface RecentPerfPoint { date: string; predicted: number; actual: number }
export interface IndexResult {
  symbol: string; name: string;
  historical: { date: string; value: number }[];
  predictions: PredPoint[];
  currentValue: number; predictedReturn3d: number; trend: "up" | "down";
  testMae: number; testDirAcc: number;
  wfDirAcc: number; rolling30dDirAcc: number; predErrStd: number;
  recentPerf: RecentPerfPoint[];
  lstmDirAcc: number; gbdtDirAcc: number; ensembleAlpha: number;
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
const N_FEATURES   = 9;
// GBDT
const N_ENSEMBLE   = 2;
const GBDT_TREES   = 60;
const GBDT_LR      = 0.05;
const GBDT_DEPTH   = 3;
const GBDT_LEAF    = 20;
const GBDT_FSUB    = 0.55;
const GBDT_SSUB    = 0.80;
const GBDT_BINS    = 32;
const N_INCR_TREES = 5;
// LSTM
const LSTM_UNITS   = 32;
const LSTM_DENSE   = 16;
const LSTM_EPOCHS  = 20;
const LSTM_BATCH   = 32;
const LSTM_LR      = 0.001;
const LSTM_DROP    = 0.2;
// General
const YEARS_DATA   = 5;
const RECENT_N     = 30;
const CACHE_TTL    = 6 * 3600_000;

// ─── Persistence ─────────────────────────────────────────────────────────────

const DATA_DIR   = path.resolve(process.cwd(), "data");
const MODEL_PATH = (sym: string) => path.join(DATA_DIR, `krx_${sym}_model.json`);
const META_PATH  = path.join(DATA_DIR, "krx_meta.json");

function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

interface GBDTModel { trees: any[]; lr: number; basePred: number }
interface LSTMWeightLayer { shape: number[]; data: number[] }

interface StoredModelFile {
  gbdtModels: GBDTModel[];
  gbdtScaler: { mu: number[]; sigma: number[] };    // flat 181-dim
  lstmWeights: LSTMWeightLayer[][];                  // per-layer weight tensors
  lstmScaler:  { mu: number[]; sigma: number[] };   // per-feature 9-dim
  ensembleAlpha: number;                             // LSTM weight (0-1)
}
export interface StoredMeta {
  lastTrained: string; lastUpdated: string;
  nSamples: Record<string, number>;
  dirAcc:          Record<string, number>;
  wfDirAcc:        Record<string, number>;
  rolling30dDirAcc: Record<string, number>;
  updateCount: number;
}

function saveModelFile(sym: string, payload: StoredModelFile) {
  ensureDataDir();
  fs.writeFileSync(MODEL_PATH(sym), JSON.stringify(payload));
  console.log(`[gbdt] 저장: ${MODEL_PATH(sym)} (GBDT+LSTM)`);
}
function loadModelFile(sym: string): StoredModelFile | null {
  const p = MODEL_PATH(sym);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch (e) { console.warn("[gbdt] 모델 로드 실패:", e); return null; }
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
    { key: "data",    label: "데이터 수집",    status: "pending" },
    { key: "feature", label: "피처 엔지니어링", status: "pending" },
    { key: "lstm",    label: "LSTM 학습",       status: "pending" },
    { key: "gbdt",    label: "GBDT 학습",       status: "pending" },
    { key: "ensemble",label: "앙상블 합성",     status: "pending" },
    { key: "output",  label: "출력",            status: "pending" },
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
  let h = 0;
  for (let i = 0; i < preds.length; i++) if (Math.sign((preds as any)[i]) === Math.sign((actual as any)[i])) h++;
  return (preds as any).length > 0 ? h / (preds as any).length : 0;
}

// ─── Feature engineering ─────────────────────────────────────────────────────

function rollingMean(arr: number[], w: number, i: number) {
  let s = 0, n = 0; for (let k = Math.max(0, i-w+1); k <= i; k++) { s += arr[k]; n++; } return s / n;
}
function rollingStdFn(arr: number[], w: number, i: number) {
  const sl = arr.slice(Math.max(0, i-w+1), i+1);
  const m = sl.reduce((a, b) => a+b, 0) / sl.length;
  return Math.sqrt(sl.reduce((a, b) => a+(b-m)**2, 0) / sl.length) || 1e-8;
}
function rsiNorm(rets: number[], w: number, i: number) {
  if (i < w) return 0.5;
  let g = 0, l = 0;
  for (let k = i-w+1; k <= i; k++) rets[k] > 0 ? (g += rets[k]) : (l -= rets[k]);
  g /= w; l /= w; return l < 1e-10 ? 1 : 1 - 1/(1 + g/l);
}
function buildFeatures(rows: { date: string; close: number }[]): {
  feats: Float64Array[]; closes: number[]; dates: string[];
} {
  const closes = rows.map(r => r.close);
  const dates  = rows.map(r => r.date);
  const rets   = closes.map((c, i) => i === 0 ? 0 : (c - closes[i-1]) / closes[i-1]);
  const feats  = rows.map((_, i): Float64Array => {
    const ma5 = rollingMean(closes,5,i), ma20 = rollingMean(closes,20,i);
    const std20 = rollingStdFn(rets,20,i);
    const bband = std20>1e-10 ? (closes[i]-(ma20-2*std20*Math.abs(ma20)))/(4*std20*Math.abs(ma20)||1) : 0.5;
    const mom5  = i>=5  ? closes[i]/closes[i-5]  - 1 : 0;
    const mom10 = i>=10 ? closes[i]/closes[i-10] - 1 : 0;
    return new Float64Array([
      rets[i], ma5>0?closes[i]/ma5-1:0, ma20>0?closes[i]/ma20-1:0,
      rsiNorm(rets,14,i), rollingStdFn(rets,5,i), rollingStdFn(rets,20,i),
      Math.max(0,Math.min(1,bband)), mom5, mom10,
    ]);
  });
  return { feats, closes, dates };
}

// ─── GBDT sequence generation (flat) ─────────────────────────────────────────

function makeSeqs(feats: Float64Array[], closes: number[], lookback: number, horizon: number) {
  const F = feats[0].length;
  const Xs: Float64Array[] = [], ys: number[] = [], anchors: number[] = [];
  for (let i = lookback; i < feats.length - horizon; i++) {
    const v = new Float64Array(lookback * F + 1);
    for (let t = 0; t < lookback; t++) for (let f = 0; f < F; f++) v[t*F+f] = feats[i-lookback+t][f];
    v[lookback*F] = 1;
    Xs.push(v); ys.push((closes[i+horizon]-closes[i])/closes[i]); anchors.push(i);
  }
  return { X: Xs, y: new Float64Array(ys), anchorDateIdxs: anchors };
}

// ─── GBDT standardisation ────────────────────────────────────────────────────

function standardize(X: Float64Array[]) {
  const n=X.length, F=X[0].length;
  const mu=new Float64Array(F), sigma=new Float64Array(F);
  for (const row of X) for (let j=0;j<F;j++) mu[j]+=row[j];
  for (let j=0;j<F;j++) mu[j]/=n;
  for (const row of X) for (let j=0;j<F;j++) sigma[j]+=(row[j]-mu[j])**2;
  for (let j=0;j<F;j++) sigma[j]=Math.sqrt(sigma[j]/n)||1;
  const Xn=X.map(row=>{const r=new Float64Array(row.length);for(let j=0;j<row.length;j++)r[j]=(row[j]-mu[j])/sigma[j];return r;});
  return {Xn,mu,sigma};
}
function applyStd(X: Float64Array[], mu: Float64Array, sigma: Float64Array): Float64Array[] {
  return X.map(row=>{const r=new Float64Array(row.length);for(let j=0;j<row.length;j++)r[j]=(row[j]-mu[j])/sigma[j];return r;});
}

// ─── GBDT ────────────────────────────────────────────────────────────────────

type DNode = { fi: number; thresh: number; left: DNode | number; right: DNode | number };

function dtPredict(node: DNode|number, x: Float64Array): number {
  if (typeof node==="number") return node;
  return x[node.fi]<=node.thresh ? dtPredict(node.left,x) : dtPredict(node.right,x);
}

function buildNode(X:Float64Array[],res:number[],idxs:number[],depth:number,minLeaf:number,rng:()=>number,ff:number,nBins:number):DNode|number {
  const n=idxs.length;
  if (depth===0||n<minLeaf*2){let s=0;for(const i of idxs)s+=res[i];return s/n;}
  const F=X[0].length, nUsed=Math.max(1,Math.floor(F*ff));
  const fIdxs=Array.from({length:F},(_,i)=>i).sort(()=>rng()-0.5).slice(0,nUsed);
  let totSum=0,totSumSq=0;
  for(const i of idxs){totSum+=res[i];totSumSq+=res[i]*res[i];}
  const totMse=totSumSq/n-(totSum/n)**2;
  let bestGain=1e-9,bestFi=-1,bestThresh=0,bestLeft:number[]=[],bestRight:number[]=[];
  for(const fi of fIdxs){
    const sorted=idxs.slice().sort((a,b)=>X[a][fi]-X[b][fi]);
    let lSum=0,lSumSq=0;
    const step=Math.max(1,Math.floor(n/nBins));
    for(let k=1;k<n;k++){
      lSum+=res[sorted[k-1]];lSumSq+=res[sorted[k-1]]**2;
      if(k%step!==0&&k!==n-minLeaf)continue;
      if(k<minLeaf||k>n-minLeaf)continue;
      if(X[sorted[k]][fi]===X[sorted[k-1]][fi])continue;
      const nl=k,nr=n-k;
      const rSum=totSum-lSum,rSumSq=totSumSq-lSumSq;
      const gain=totMse-(nl*(lSumSq/nl-(lSum/nl)**2)+nr*(rSumSq/nr-(rSum/nr)**2))/n;
      if(gain>bestGain){bestGain=gain;bestFi=fi;bestThresh=(X[sorted[k-1]][fi]+X[sorted[k]][fi])/2;bestLeft=sorted.slice(0,k);bestRight=sorted.slice(k);}
    }
  }
  if(bestFi<0){let s=0;for(const i of idxs)s+=res[i];return s/n;}
  return{fi:bestFi,thresh:bestThresh,
    left:buildNode(X,res,bestLeft,depth-1,minLeaf,rng,ff,nBins),
    right:buildNode(X,res,bestRight,depth-1,minLeaf,rng,ff,nBins)};
}

function gbdtFit(X:Float64Array[],y:Float64Array,seed:number):GBDTModel {
  const rng=makeRng(seed),n=X.length;
  let basePred=0;for(let i=0;i<n;i++)basePred+=y[i];basePred/=n;
  const preds=new Float64Array(n).fill(basePred),trees:any[]=[];
  const rowBag=Math.floor(n*GBDT_SSUB);
  for(let t=0;t<GBDT_TREES;t++){
    const res=Array.from({length:n},(_,i)=>y[i]-preds[i]);
    const idxs=Array.from({length:n},(_,i)=>i).sort(()=>rng()-0.5).slice(0,rowBag);
    const tree=buildNode(X,res,idxs,GBDT_DEPTH,GBDT_LEAF,rng,GBDT_FSUB,GBDT_BINS);
    trees.push(tree);
    for(let i=0;i<n;i++)preds[i]+=GBDT_LR*dtPredict(tree,X[i]);
  }
  return{trees,lr:GBDT_LR,basePred};
}
function gbdtPredict(model:GBDTModel,X:Float64Array[]):Float64Array {
  return new Float64Array(X.map(x=>{let p=model.basePred;for(const t of model.trees)p+=model.lr*dtPredict(t as DNode|number,x);return p;}));
}
function incrementalAddTrees(model:GBDTModel,X:Float64Array[],y:Float64Array,nTrees:number,seed:number):GBDTModel {
  if(X.length===0)return model;
  const rng=makeRng(seed),n=X.length,rowBag=Math.max(1,Math.floor(n*GBDT_SSUB));
  const preds=gbdtPredict(model,X),newTrees:any[]=[];
  for(let t=0;t<nTrees;t++){
    const res=Array.from({length:n},(_,i)=>y[i]-preds[i]);
    const idxs=Array.from({length:n},(_,i)=>i).sort(()=>rng()-0.5).slice(0,Math.min(rowBag,n));
    const tree=buildNode(X,res,idxs,GBDT_DEPTH,GBDT_LEAF,rng,GBDT_FSUB,GBDT_BINS);
    newTrees.push(tree);
    for(let i=0;i<n;i++)preds[i]+=model.lr*dtPredict(tree as DNode|number,X[i]);
  }
  return{...model,trees:[...model.trees,...newTrees]};
}

// ─── LSTM utilities ───────────────────────────────────────────────────────────

/** Per-feature scaler (9-dim) for LSTM 3D input */
function computeLSTMScaler(feats: Float64Array[]) {
  const F=feats[0].length,n=feats.length;
  const mu=new Float64Array(F),sigma=new Float64Array(F);
  for(const f of feats)for(let j=0;j<F;j++)mu[j]+=f[j];
  for(let j=0;j<F;j++)mu[j]/=n;
  for(const f of feats)for(let j=0;j<F;j++)sigma[j]+=(f[j]-mu[j])**2;
  for(let j=0;j<F;j++)sigma[j]=Math.sqrt(sigma[j]/n)||1;
  return{mu,sigma};
}

/** 3D sequences (n, LOOKBACK, N_FEATURES) for LSTM, normalised per-feature */
function makeSeqs3D(
  feats: Float64Array[], closes: number[],
  mu: Float64Array, sigma: Float64Array,
  lookback: number, horizon: number,
): { X3d: number[][][]; y: Float64Array; anchorDateIdxs: number[] } {
  const X3d:number[][][]=[],ys:number[]=[],anchors:number[]=[];
  for(let i=lookback;i<feats.length-horizon;i++){
    const seq:number[][]=[];
    for(let t=0;t<lookback;t++){
      seq.push(Array.from(feats[i-lookback+t]).map((v,j)=>(v-mu[j])/sigma[j]));
    }
    X3d.push(seq); ys.push((closes[i+horizon]-closes[i])/closes[i]); anchors.push(i);
  }
  return{X3d,y:new Float64Array(ys),anchorDateIdxs:anchors};
}

/** Build LSTM architecture (fixed; weights loaded separately) */
function buildLSTMArch(): tf.Sequential {
  const model = tf.sequential();
  model.add(tf.layers.lstm({
    units: LSTM_UNITS, inputShape: [LOOKBACK, N_FEATURES],
    returnSequences: false, dropout: LSTM_DROP, recurrentDropout: 0.1,
  }));
  model.add(tf.layers.dense({ units: LSTM_DENSE, activation: "relu" }));
  model.add(tf.layers.dropout({ rate: 0.1 }));
  model.add(tf.layers.dense({ units: 1 }));
  return model;
}

/** Extract weights as JSON-serializable arrays */
function saveLSTMWeights(model: tf.LayersModel): LSTMWeightLayer[][] {
  return model.layers.map(layer =>
    layer.getWeights().map(w => ({ shape: w.shape, data: Array.from(w.dataSync()) }))
  );
}

/** Reconstruct model from saved weights (sync) */
function loadLSTMFromWeights(weightsData: LSTMWeightLayer[][]): tf.Sequential {
  const model = buildLSTMArch();
  model.layers.forEach((layer, i) => {
    if (weightsData[i]?.length > 0) {
      const tensors = weightsData[i].map(w => tf.tensor(w.data, w.shape));
      try { layer.setWeights(tensors); } finally { tensors.forEach(t => t.dispose()); }
    }
  });
  return model;
}

/** Train LSTM on training sequences */
async function trainLSTM(
  X3d_train: number[][][], y_train: Float64Array,
  X3d_val:   number[][][], y_val:   Float64Array,
): Promise<tf.Sequential> {
  await tf.ready();
  const model = buildLSTMArch();
  model.compile({ optimizer: tf.train.adam(LSTM_LR), loss: "meanSquaredError" });

  const xTrain = tf.tensor3d(X3d_train);
  const yTrain = tf.tensor2d(Array.from(y_train), [y_train.length, 1]);
  const xVal   = tf.tensor3d(X3d_val);
  const yVal   = tf.tensor2d(Array.from(y_val),   [y_val.length,   1]);

  try {
    await model.fit(xTrain, yTrain, {
      epochs: LSTM_EPOCHS, batchSize: LSTM_BATCH,
      validationData: [xVal, yVal],
      verbose: 0,
      callbacks: {
        onEpochEnd: (epoch: number, logs: any) => {
          if (epoch % 5 === 4)
            console.log(`[lstm] epoch ${epoch+1}/${LSTM_EPOCHS} loss=${logs?.loss?.toFixed(4)} val=${logs?.val_loss?.toFixed(4)}`);
        },
      },
    });
  } finally {
    xTrain.dispose(); yTrain.dispose(); xVal.dispose(); yVal.dispose();
  }
  return model;
}

/** Predict using loaded LSTM model (sync) */
function lstmPredict(model: tf.Sequential, X3d: number[][][]): Float64Array {
  if (X3d.length === 0) return new Float64Array(0);
  const input = tf.tensor3d(X3d);
  const output = model.predict(input) as tf.Tensor;
  const data = new Float64Array(output.dataSync());
  input.dispose(); output.dispose();
  return data;
}

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function fetchHistory(symbol: string, years = YEARS_DATA) {
  const yahoo = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
  const end = new Date(), start = new Date();
  start.setFullYear(start.getFullYear() - years);
  const r = await yahoo.chart(symbol, { period1: start, period2: end, interval: "1d" });
  return (r.quotes ?? [])
    .filter((q: any) => q.close != null)
    .map((q: any) => ({ date: new Date(q.date).toISOString().slice(0,10), close: q.close as number }));
}

// ─── Core result builder (uses pre-trained GBDT + LSTM) ──────────────────────

function buildResultFromModel(
  symbol: string, name: string,
  rows: { date: string; close: number }[],
  gbdtModels: GBDTModel[], gbdtScaler: { mu: Float64Array; sigma: Float64Array },
  lstmModel: tf.Sequential, lstmScaler: { mu: Float64Array; sigma: Float64Array },
  storedAlpha: number,
): IndexResult {
  const { feats, closes, dates } = buildFeatures(rows);

  // GBDT sequences
  const { X, y, anchorDateIdxs } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
  const n = X.length;
  const trainEnd = Math.floor(n * 0.80);
  const Xte  = X.slice(trainEnd);  const yte = y.slice(trainEnd);
  const XteN = applyStd(Xte, gbdtScaler.mu, gbdtScaler.sigma);

  const gbdtPreds = new Float64Array(Xte.length);
  for (const m of gbdtModels) {
    const p = gbdtPredict(m, XteN);
    for (let i = 0; i < p.length; i++) gbdtPreds[i] += p[i] / gbdtModels.length;
  }

  // LSTM sequences
  const { X3d, y: y3d, anchorDateIdxs: anchors3d } = makeSeqs3D(feats, closes, lstmScaler.mu, lstmScaler.sigma, LOOKBACK, PRED_H);
  const X3d_test = X3d.slice(trainEnd);
  const lstmPreds = lstmPredict(lstmModel, X3d_test);

  // Adaptive ensemble weights (based on recent N dir accuracy)
  const lastN = Math.min(RECENT_N, gbdtPreds.length);
  const g30 = dirAccRate(gbdtPreds.slice(-lastN), Array.from(yte).slice(-lastN));
  const l30 = dirAccRate(lstmPreds.slice(-lastN),  Array.from(yte).slice(-lastN));
  const alpha = l30 + g30 > 0 ? l30 / (l30 + g30) : 0.5;  // LSTM weight

  const testPreds = new Float64Array(gbdtPreds.length);
  for (let i = 0; i < testPreds.length; i++) testPreds[i] = alpha * lstmPreds[i] + (1-alpha) * gbdtPreds[i];

  // Metrics
  const nTest = testPreds.length;
  const wfMid = Math.floor(nTest / 2);
  const wf1 = dirAccRate(testPreds.slice(0, wfMid), Array.from(yte).slice(0, wfMid));
  const wf2 = dirAccRate(testPreds.slice(wfMid),    Array.from(yte).slice(wfMid));

  let mae = 0;
  for (let i = 0; i < nTest; i++) mae += Math.abs(testPreds[i] - yte[i]);
  mae /= nTest || 1;

  const last30Preds  = Array.from(testPreds).slice(-lastN);
  const last30Actual = Array.from(yte).slice(-lastN);
  const recentErrors = last30Actual.map((a, i) => a - last30Preds[i]);

  const recentPerf: RecentPerfPoint[] = last30Preds.map((pred, m) => {
    const j = nTest - lastN + m;
    const anchorIdx = anchorDateIdxs[trainEnd + j];
    return { date: dates[anchorIdx]??`D${m}`, predicted: +(pred*100).toFixed(2), actual: +(last30Actual[m]*100).toFixed(2) };
  });

  // Final forecast using ensemble
  const lastGBDT_Xn = applyStd([X[n-1]], gbdtScaler.mu, gbdtScaler.sigma);
  const gbdtForecast = gbdtModels.map(m => gbdtPredict(m, lastGBDT_Xn)[0]).reduce((a,b)=>a+b,0) / gbdtModels.length;

  const lastSeq3d: number[][] = [];
  for (let t = 0; t < LOOKBACK; t++) {
    lastSeq3d.push(Array.from(feats[feats.length - LOOKBACK + t]).map((v,j) => (v - lstmScaler.mu[j]) / lstmScaler.sigma[j]));
  }
  const lstmForecast = lstmPredict(lstmModel, [lastSeq3d])[0];
  const forecastReturn = alpha * lstmForecast + (1-alpha) * gbdtForecast;

  const curVal = closes[closes.length-1];
  const pred3d = curVal * (1 + forecastReturn);
  const bandPrice = (stddev(recentErrors) * curVal);

  const futureDates: string[] = [];
  const cur = new Date(dates[dates.length-1] + "T00:00:00");
  while (futureDates.length < PRED_H) {
    cur.setDate(cur.getDate()+1);
    if (cur.getDay()!==0&&cur.getDay()!==6) futureDates.push(cur.toISOString().slice(0,10));
  }

  return {
    symbol, name,
    historical: dates.slice(-90).map((date,i)=>({date,value:+closes[closes.length-90+i].toFixed(2)})),
    predictions: futureDates.map((date,i)=>{
      const frac=(i+1)/PRED_H, v=curVal+(pred3d-curVal)*frac;
      return{date,value:+v.toFixed(2),lower:+(v-bandPrice).toFixed(2),upper:+(v+bandPrice).toFixed(2)};
    }),
    currentValue: +curVal.toFixed(2),
    predictedReturn3d: +(forecastReturn*100).toFixed(2),
    trend: forecastReturn>=0?"up":"down",
    testMae: +(mae*100).toFixed(3),
    testDirAcc: +(dirAccRate(testPreds,yte)*100).toFixed(1),
    wfDirAcc: +((wf1+wf2)/2*100).toFixed(1),
    rolling30dDirAcc: +(dirAccRate(last30Preds,last30Actual)*100).toFixed(1),
    predErrStd: +(stddev(recentErrors)*100).toFixed(3),
    recentPerf,
    lstmDirAcc: +(l30*100).toFixed(1),
    gbdtDirAcc: +(g30*100).toFixed(1),
    ensembleAlpha: +alpha.toFixed(3),
  };
}

// ─── Full training (LSTM + GBDT) ─────────────────────────────────────────────

async function trainFull(symbol: string, name: string, rows: { date: string; close: number }[]) {
  const { feats, closes, dates } = buildFeatures(rows);

  // ── GBDT ──
  const { X, y, anchorDateIdxs } = makeSeqs(feats, closes, LOOKBACK, PRED_H);
  const n = X.length, trainEnd = Math.floor(n*0.80);
  const { Xn: XtrN, mu: gbdtMu, sigma: gbdtSig } = standardize(X.slice(0, trainEnd));
  const gbdtModels = Array.from({length:N_ENSEMBLE},(_,e)=>gbdtFit(XtrN,y.slice(0,trainEnd),e*37+13));

  // ── LSTM ──
  const lstmScaler = computeLSTMScaler(feats.slice(0, trainEnd+LOOKBACK));
  const { X3d, y: y3d } = makeSeqs3D(feats, closes, lstmScaler.mu, lstmScaler.sigma, LOOKBACK, PRED_H);
  const valSplit = Math.floor(trainEnd * 0.9);
  const lstmModel = await trainLSTM(
    X3d.slice(0, valSplit),   y.slice(0, valSplit),
    X3d.slice(valSplit, trainEnd), y.slice(valSplit, trainEnd),
  );

  const gbdtScaler = { mu: gbdtMu, sigma: gbdtSig };

  // ── Save ──
  const symKey = symbol.replace(/[\^]/g,"");
  saveModelFile(symKey, {
    gbdtModels, gbdtScaler: { mu: Array.from(gbdtMu), sigma: Array.from(gbdtSig) },
    lstmWeights: saveLSTMWeights(lstmModel),
    lstmScaler:  { mu: Array.from(lstmScaler.mu), sigma: Array.from(lstmScaler.sigma) },
    ensembleAlpha: 0.5,  // initial; adaptive at runtime
  });

  const result = buildResultFromModel(
    symbol, name, rows,
    gbdtModels, { mu: gbdtMu, sigma: gbdtSig },
    lstmModel, { mu: lstmScaler.mu, sigma: lstmScaler.sigma },
    0.5,
  );

  lstmModel.dispose();
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getStatus(): PipelineStatus {
  return {
    running:_status.running, ready:_status.ready,
    steps:_status.steps.map(s=>({...s})),
    error:_status.error, trainedAt:_status.trainedAt,
    trainingMs:_status.trainingMs, kospi:_status.kospi, kosdaq:_status.kosdaq,
  };
}

export async function tryRestoreFromDisk(): Promise<boolean> {
  const meta       = loadMeta();
  const kospiStore = loadModelFile("KS11");
  const kosdaqStore= loadModelFile("KQ11");
  if (!meta||!kospiStore||!kosdaqStore) return false;
  if (!kospiStore.lstmWeights||!kosdaqStore.lstmWeights) {
    console.log("[gbdt] 구형 모델 파일 감지 (LSTM 없음) — 완전 재학습 필요");
    return false;
  }
  console.log("[gbdt] 디스크에서 GBDT+LSTM 모델 복원 중...");
  try {
    const [kospiRows, kosdaqRows] = await Promise.all([
      fetchHistory("^KS11", 0.35), fetchHistory("^KQ11", 0.35),
    ]);
    const [kospi, kosdaq] = await Promise.all([
      Promise.resolve(buildResultFromModel(
        "^KS11","KOSPI",kospiRows,
        kospiStore.gbdtModels,
        {mu:new Float64Array(kospiStore.gbdtScaler.mu),sigma:new Float64Array(kospiStore.gbdtScaler.sigma)},
        loadLSTMFromWeights(kospiStore.lstmWeights),
        {mu:new Float64Array(kospiStore.lstmScaler.mu),sigma:new Float64Array(kospiStore.lstmScaler.sigma)},
        kospiStore.ensembleAlpha,
      )),
      Promise.resolve(buildResultFromModel(
        "^KQ11","KOSDAQ",kosdaqRows,
        kosdaqStore.gbdtModels,
        {mu:new Float64Array(kosdaqStore.gbdtScaler.mu),sigma:new Float64Array(kosdaqStore.gbdtScaler.sigma)},
        loadLSTMFromWeights(kosdaqStore.lstmWeights),
        {mu:new Float64Array(kosdaqStore.lstmScaler.mu),sigma:new Float64Array(kosdaqStore.lstmScaler.sigma)},
        kosdaqStore.ensembleAlpha,
      )),
    ]);
    _lastRun = Date.now();
    _status = {
      running:false, ready:true,
      steps:defaultSteps().map(s=>({...s,status:"done" as const})),
      trainedAt:meta.lastTrained, trainingMs:0, kospi, kosdaq,
    };
    console.log(`[gbdt] 복원 완료 | KOSPI lstmW=${kospi.ensembleAlpha} gbdtW=${(1-kospi.ensembleAlpha).toFixed(3)}`);
    return true;
  } catch(e:any) { console.warn("[gbdt] 복원 실패:",e?.message); return false; }
}

export async function runPipeline(force=false): Promise<void> {
  const now = Date.now();
  if (_status.running) return;
  if (!force&&_status.ready&&now-_lastRun<CACHE_TTL) return;

  _status = { running:true, ready:false, steps:defaultSteps() };
  const t0 = Date.now();

  try {
    stepSet("data","running");
    const s1=Date.now();
    const [kospiRows,kosdaqRows]=await Promise.all([fetchHistory("^KS11"),fetchHistory("^KQ11")]);
    stepSet("data","done",Date.now()-s1);

    stepSet("feature","running"); stepSet("feature","done",0);

    // Train LSTM for each index sequentially (TF.js single-threaded)
    stepSet("lstm","running");
    const sL=Date.now();
    const kospiResult  = await trainFull("^KS11","KOSPI",kospiRows);
    const kosdaqResult = await trainFull("^KQ11","KOSDAQ",kosdaqRows);
    stepSet("lstm","done",Date.now()-sL);

    stepSet("gbdt","running"); stepSet("gbdt","done",0);
    stepSet("ensemble","running"); stepSet("ensemble","done",0);
    stepSet("output","running"); stepSet("output","done",0);

    const trainedAt = new Date().toISOString();
    saveMeta({
      lastTrained:trainedAt, lastUpdated:trainedAt,
      nSamples:{kospi:kospiRows.length,kosdaq:kosdaqRows.length},
      dirAcc:          {kospi:kospiResult.testDirAcc,       kosdaq:kosdaqResult.testDirAcc},
      wfDirAcc:        {kospi:kospiResult.wfDirAcc,         kosdaq:kosdaqResult.wfDirAcc},
      rolling30dDirAcc:{kospi:kospiResult.rolling30dDirAcc, kosdaq:kosdaqResult.rolling30dDirAcc},
      updateCount:0,
    });

    _lastRun=now;
    _status={
      running:false,ready:true,steps:_status.steps,
      trainedAt, trainingMs:Date.now()-t0,
      kospi:kospiResult, kosdaq:kosdaqResult,
    };
    console.log(`[pipeline] 완료 ${Date.now()-t0}ms | KOSPI lstm=${kospiResult.lstmDirAcc}% gbdt=${kospiResult.gbdtDirAcc}% ens=${kospiResult.testDirAcc}%`);
  } catch(err:any) {
    console.error("[pipeline] 오류:",err?.message??err);
    const f=_status.steps.find(s=>s.status==="running");
    if(f)f.status="error";
    _status={..._status,running:false,ready:false,error:err?.message??String(err)};
  }
}

export async function runDailyIncrementalUpdate(): Promise<void> {
  if (_status.running){console.log("[gbdt] 학습 중 — 증분 스킵");return;}
  const meta=loadMeta(), kospiStore=loadModelFile("KS11"), kosdaqStore=loadModelFile("KQ11");
  if(!kospiStore||!kosdaqStore||!kospiStore.lstmWeights){
    console.log("[gbdt] 저장 모델 없음 → 완전 학습");
    return runPipeline(true);
  }
  console.log("[gbdt] 일일 증분 시작 (GBDT +5트리; LSTM 스킵)");
  const t0=Date.now();
  try {
    const [kospiRows,kosdaqRows]=await Promise.all([fetchHistory("^KS11",0.35),fetchHistory("^KQ11",0.35)]);
    const lastUpdated=meta?.lastUpdated??"2000-01-01";

    function newSamples(rows:{date:string;close:number}[], store:StoredModelFile) {
      const {feats,closes,dates}=buildFeatures(rows);
      const {X,y,anchorDateIdxs}=makeSeqs(feats,closes,LOOKBACK,PRED_H);
      const idxs=X.map((_,k)=>k).filter(k=>(dates[anchorDateIdxs[k]]??"")>lastUpdated);
      if(!idxs.length)return null;
      const gbdtMu=new Float64Array(store.gbdtScaler.mu), gbdtSig=new Float64Array(store.gbdtScaler.sigma);
      const XteN=applyStd(idxs.map(k=>X[k]),gbdtMu,gbdtSig);
      return{XteN,yNew:new Float64Array(idxs.map(k=>y[k]))};
    }
    const kNew=newSamples(kospiRows,kospiStore), qNew=newSamples(kosdaqRows,kosdaqStore);
    if(!kNew&&!qNew){console.log("[gbdt] 신규 데이터 없음");return;}

    const seed=Date.now()%10000;
    const updKospi  = kNew ? kospiStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,kNew.XteN,kNew.yNew,N_INCR_TREES,e*7+seed)) : kospiStore.gbdtModels;
    const updKosdaq = qNew ? kosdaqStore.gbdtModels.map((m,e)=>incrementalAddTrees(m,qNew.XteN,qNew.yNew,N_INCR_TREES,e*7+3+seed)) : kosdaqStore.gbdtModels;

    saveModelFile("KS11",{...kospiStore,  gbdtModels:updKospi});
    saveModelFile("KQ11",{...kosdaqStore, gbdtModels:updKosdaq});

    const [kospi,kosdaq]=await Promise.all([
      Promise.resolve(buildResultFromModel(
        "^KS11","KOSPI",kospiRows,updKospi,
        {mu:new Float64Array(kospiStore.gbdtScaler.mu),sigma:new Float64Array(kospiStore.gbdtScaler.sigma)},
        loadLSTMFromWeights(kospiStore.lstmWeights),
        {mu:new Float64Array(kospiStore.lstmScaler.mu),sigma:new Float64Array(kospiStore.lstmScaler.sigma)},
        kospiStore.ensembleAlpha,
      )),
      Promise.resolve(buildResultFromModel(
        "^KQ11","KOSDAQ",kosdaqRows,updKosdaq,
        {mu:new Float64Array(kosdaqStore.gbdtScaler.mu),sigma:new Float64Array(kosdaqStore.gbdtScaler.sigma)},
        loadLSTMFromWeights(kosdaqStore.lstmWeights),
        {mu:new Float64Array(kosdaqStore.lstmScaler.mu),sigma:new Float64Array(kosdaqStore.lstmScaler.sigma)},
        kosdaqStore.ensembleAlpha,
      )),
    ]);
    const now=new Date().toISOString();
    saveMeta({
      ...(meta??{lastTrained:now,nSamples:{},dirAcc:{},wfDirAcc:{},rolling30dDirAcc:{},updateCount:0}),
      lastUpdated:now,
      dirAcc:          {kospi:kospi.testDirAcc,       kosdaq:kosdaq.testDirAcc},
      wfDirAcc:        {kospi:kospi.wfDirAcc,         kosdaq:kosdaq.wfDirAcc},
      rolling30dDirAcc:{kospi:kospi.rolling30dDirAcc, kosdaq:kosdaq.rolling30dDirAcc},
      updateCount:(meta?.updateCount??0)+1,
    });
    _lastRun=Date.now();
    _status={..._status,ready:true,kospi,kosdaq};
    console.log(`[gbdt] 증분 완료 ${Date.now()-t0}ms | updateCount=${(meta?.updateCount??0)+1}`);
  } catch(e:any){console.error("[gbdt] 증분 실패:",e?.message??e);}
}
