import { useState, useEffect, useCallback } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
  BarChart, Bar, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, RefreshCw, BrainCircuit,
  CheckCircle2, Circle, Loader2, AlertCircle, BarChart3,
  Cpu, Database, GitMerge, ChevronRight, Zap,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/language-context";

interface PredPoint { date: string; value: number; lower: number; upper: number }
interface RecentPerfPoint { date: string; predicted: number; actual: number }
interface IndexResult {
  symbol: string; name: string;
  historical: { date: string; value: number }[];
  predictions: PredPoint[];
  currentValue: number;
  predictedReturn3d: number;
  trend: "up" | "down";
  testMae: number;
  testDirAcc: number;
  wfDirAcc: number;
  rolling30dDirAcc: number;
  predErrStd: number;
  recentPerf: RecentPerfPoint[];
  lstmDirAcc: number;
  gbdtDirAcc: number;
  ensembleAlpha: number;
}
interface PipelineStep {
  key: string; label: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
}
interface PipelineStatus {
  running: boolean; ready: boolean;
  steps: PipelineStep[];
  error?: string;
  trainedAt?: string;
  trainingMs?: number;
  kospi?: IndexResult;
  kosdaq?: IndexResult;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  data:     Database,
  feature:  Zap,
  sequence: GitMerge,
  lstm:     BrainCircuit,
  gbdt:     Cpu,
  train:    BrainCircuit,
  ensemble: GitMerge,
  output:   BarChart3,
};

const RISE  = "#ef4444";
const FALL  = "#3b82f6";

function StepIcon({ stepKey, status }: { stepKey: string; status: PipelineStep["status"] }) {
  const Icon = STEP_ICONS[stepKey] ?? Circle;
  if (status === "done")    return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (status === "running") return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
  if (status === "error")   return <AlertCircle className="w-4 h-4 text-red-500" />;
  return <Icon className="w-4 h-4 text-muted-foreground/40" />;
}

function PipelineTracker({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1">
          <div className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all",
            step.status === "done"    && "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
            step.status === "running" && "border-primary/40 bg-primary/5 text-primary",
            step.status === "error"   && "border-red-500/30 bg-red-500/5 text-red-400",
            step.status === "pending" && "border-border bg-transparent text-muted-foreground/50",
          )}>
            <StepIcon stepKey={step.key} status={step.status} />
            <span>{step.label}</span>
            {step.durationMs !== undefined && step.status === "done" && (
              <span className="text-[10px] opacity-60">({(step.durationMs / 1000).toFixed(1)}s)</span>
            )}
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className="w-3 h-3 text-muted-foreground/30 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

function IndexBadge({ value, label }: { value: number; label: string }) {
  const up = value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md",
      up
        ? "bg-red-500/10 text-red-400 border border-red-500/20"
        : "bg-blue-500/10 text-blue-400 border border-blue-500/20",
    )}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {label}
    </span>
  );
}

function formatDate(dateStr: string, short = false): string {
  const d = new Date(dateStr + "T00:00:00");
  if (short) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── Main line/area chart ───────────────────────────────────────────────── */

function IndexChart({ result }: { result: IndexResult }) {
  const chartData = [
    ...result.historical.map(h => ({
      date: h.date,
      label: formatDate(h.date, true),
      historical: h.value,
      predicted: undefined as number | undefined,
      lower: undefined as number | undefined,
      upper: undefined as number | undefined,
      isPrediction: false,
    })),
    ...result.predictions.map(p => ({
      date: p.date,
      label: formatDate(p.date, true),
      historical: undefined as number | undefined,
      predicted: p.value,
      lower: p.lower,
      upper: p.upper,
      isPrediction: true,
    })),
  ];

  const allValues = [
    ...result.historical.map(h => h.value),
    ...result.predictions.flatMap(p => [p.lower, p.upper]),
  ];
  const minVal = Math.min(...allValues) * 0.998;
  const maxVal = Math.max(...allValues) * 1.002;

  const lastHistDate = result.historical[result.historical.length - 1]?.date;
  const predColor = result.trend === "up" ? RISE : FALL;

  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const val = d?.historical ?? d?.predicted;
    if (val == null) return null;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
        <p className="text-muted-foreground mb-1">{d.date}</p>
        <p className="font-bold text-foreground">{val.toLocaleString()}</p>
        {d.isPrediction && d.lower != null && (
          <p className="text-muted-foreground">
            구간: {d.lower.toLocaleString()} ~ {d.upper.toLocaleString()}
          </p>
        )}
        {d.isPrediction && <p className="text-primary text-[10px] mt-0.5">예측값 (±1σ 구간)</p>}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`confGrad-${result.symbol}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={predColor} stopOpacity={0.18} />
            <stop offset="100%" stopColor={predColor} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }}
          tickLine={false} axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[minVal, maxVal]}
          tickFormatter={v => v.toLocaleString()}
          tick={{ fontSize: 10, fill: "rgba(255,255,255,0.35)" }}
          tickLine={false} axisLine={false} width={60}
        />
        <Tooltip content={customTooltip} />
        {lastHistDate && (
          <ReferenceLine
            x={formatDate(lastHistDate, true)}
            stroke="rgba(255,255,255,0.2)"
            strokeDasharray="4 4"
            label={{ value: "현재", fill: "rgba(255,255,255,0.4)", fontSize: 10, position: "insideTopLeft" }}
          />
        )}
        <Area dataKey="upper" stroke="none" fill={`url(#confGrad-${result.symbol})`}
          isAnimationActive={false} legendType="none" activeDot={false} />
        <Area dataKey="lower" stroke="none" fill="transparent"
          isAnimationActive={false} legendType="none" activeDot={false} />
        <Line
          dataKey="historical"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={1.5} dot={false} name="실제 지수"
          connectNulls={false} isAnimationActive animationDuration={800}
        />
        <Line
          dataKey="predicted"
          stroke={predColor} strokeWidth={2} strokeDasharray="5 3"
          dot={{ r: 3, fill: predColor, stroke: predColor }}
          name="GBDT 예측" connectNulls={false}
          isAnimationActive animationDuration={800} animationBegin={400}
        />
        <Legend iconType="line" wrapperStyle={{ fontSize: 11, paddingTop: 8, color: "rgba(255,255,255,0.5)" }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── Return comparison bar chart (last 30 days: predicted vs actual) ─────── */

function ReturnComparisonChart({ data }: { data: RecentPerfPoint[] }) {
  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as RecentPerfPoint;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg space-y-0.5">
        <p className="text-muted-foreground">{d.date}</p>
        <p style={{ color: d.predicted >= 0 ? RISE : FALL }}>
          예측: {d.predicted >= 0 ? "+" : ""}{d.predicted}%
        </p>
        <p style={{ color: d.actual >= 0 ? RISE : FALL }}>
          실제: {d.actual >= 0 ? "+" : ""}{d.actual}%
        </p>
      </div>
    );
  };

  // Show every 5th date label to avoid crowding
  const tickFormatter = (_: any, index: number) =>
    index % 5 === 0 ? formatDate(data[index]?.date ?? "", true) : "";

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={1} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={tickFormatter}
          tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
          tickLine={false} axisLine={false}
          interval={0}
        />
        <YAxis
          tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
          tickLine={false} axisLine={false} width={52}
        />
        <Tooltip content={customTooltip} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />

        {/* Actual — filled bars */}
        <Bar dataKey="actual" name="실제" radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={`act-${i}`} fill={d.actual >= 0 ? RISE : FALL} fillOpacity={0.65} />
          ))}
        </Bar>

        {/* Predicted — outlined (stroke-only) bars */}
        <Bar dataKey="predicted" name="예측" radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={`pred-${i}`}
              fill="transparent"
              stroke={d.predicted >= 0 ? RISE : FALL}
              strokeWidth={1.5}
            />
          ))}
        </Bar>

        <Legend
          iconType="rect"
          wrapperStyle={{ fontSize: 11, paddingTop: 6, color: "rgba(255,255,255,0.5)" }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.07]">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <span className="text-lg font-bold text-foreground">{value}</span>
      {sub && <span className="text-[10px] text-muted-foreground/50">{sub}</span>}
    </div>
  );
}

const PRED_HORIZON_LABEL = "3일 후";

export default function MarketAnalysis() {
  const { isEn } = useLanguage();
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [activeIdx, setActiveIdx] = useState<"kospi" | "kosdaq">("kospi");
  const [isStarting, setIsStarting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(getApiUrl("/api/market-analysis/status"), { credentials: "include" });
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  const triggerRun = useCallback(async (force = false) => {
    setIsStarting(true);
    try {
      await fetch(getApiUrl(`/api/market-analysis/run${force ? "?force=true" : ""}`), {
        method: "POST", credentials: "include",
      });
      setTimeout(fetchStatus, 500);
    } finally {
      setIsStarting(false);
    }
  }, [fetchStatus]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!status) return;
    if (status.running) {
      const t = setInterval(fetchStatus, 2000);
      return () => clearInterval(t);
    }
    if (!status.ready && !status.running && !status.error) {
      triggerRun(false);
    }
  }, [status, fetchStatus, triggerRun]);

  const current = activeIdx === "kospi" ? status?.kospi : status?.kosdaq;

  return (
    <div className="space-y-5 pb-20">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            {isEn ? "Market Analysis" : "시장분석"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEn
              ? "LSTM + GBDT ensemble · 3-day return prediction for KOSPI/KOSDAQ"
              : "LSTM + GBDT 앙상블 · KOSPI/KOSDAQ 3일 후 수익률 예측 파이프라인"}
          </p>
        </div>
        <button
          onClick={() => triggerRun(true)}
          disabled={status?.running || isStarting}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] border border-white/[0.10] text-sm font-medium hover:bg-white/[0.10] transition-all disabled:opacity-40 shrink-0"
        >
          {status?.running || isStarting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 학습 중...</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> {isEn ? "Retrain" : "재학습"}</>
          )}
        </button>
      </div>

      {/* Pipeline tracker */}
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 space-y-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-medium">
          <BrainCircuit className="w-3.5 h-3.5" />
          <span>{isEn ? "Pipeline" : "파이프라인"}</span>
          {status?.trainingMs && (
            <span className="ml-auto text-muted-foreground/40">
              총 {(status.trainingMs / 1000).toFixed(1)}s
            </span>
          )}
          {status?.trainedAt && (
            <span className="text-muted-foreground/40 text-[10px]">
              {isEn ? "trained" : "학습 완료"} {new Date(status.trainedAt).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
        <PipelineTracker steps={status?.steps ?? [
          { key: "data",     label: "데이터 수집",     status: "pending" },
          { key: "feature",  label: "피처 엔지니어링", status: "pending" },
          { key: "lstm",     label: "LSTM 학습",        status: "pending" },
          { key: "gbdt",     label: "GBDT 학습",        status: "pending" },
          { key: "ensemble", label: "앙상블 합성",      status: "pending" },
          { key: "output",   label: "출력",             status: "pending" },
        ]} />
        {status?.error && (
          <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{status.error}</span>
          </div>
        )}
      </div>

      {/* Loading state */}
      {!status?.ready && status?.running && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">LSTM + GBDT 앙상블 학습 중...</p>
            <p className="text-xs text-muted-foreground mt-1">
              {isEn
                ? "Training LSTM + GBDT ensemble on 5-year data. First run may take ~90s."
                : "5년치 데이터로 LSTM + GBDT 앙상블 학습 중. 첫 실행 시 약 90초 소요됩니다."}
            </p>
          </div>
        </div>
      )}

      {/* Initial state */}
      {!status?.ready && !status?.running && !status?.error && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] flex flex-col items-center justify-center gap-3 py-16">
          <BrainCircuit className="w-8 h-8 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">파이프라인 초기화 중...</p>
            <p className="text-xs text-muted-foreground mt-1">잠시 후 학습이 시작됩니다</p>
          </div>
        </div>
      )}

      {/* Results */}
      <AnimatePresence>
        {status?.ready && status.kospi && status.kosdaq && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-4"
          >
            {/* Index selector */}
            <div className="flex items-center gap-3 flex-wrap">
              {(["kospi", "kosdaq"] as const).map(idx => {
                const data = idx === "kospi" ? status.kospi! : status.kosdaq!;
                const isActive = activeIdx === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setActiveIdx(idx)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left",
                      isActive
                        ? "border-primary/40 bg-primary/5"
                        : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                  >
                    <div>
                      <div className="text-xs text-muted-foreground font-medium">{data.name}</div>
                      <div className="text-lg font-bold text-foreground mt-0.5">
                        {data.currentValue.toLocaleString()}
                      </div>
                    </div>
                    <IndexBadge
                      value={data.predictedReturn3d}
                      label={`${data.predictedReturn3d >= 0 ? "+" : ""}${data.predictedReturn3d}% (3일)`}
                    />
                  </button>
                );
              })}
            </div>

            {/* ── Main line chart ─────────────────────────────────────────── */}
            {current && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-4">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {current.name} — LSTM+GBDT 앙상블 예측 ({PRED_HORIZON_LABEL})
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      최근 90거래일 + 3일 예측 · 음영: ±1σ 예측 오차 신뢰구간
                    </p>
                  </div>
                  <IndexBadge
                    value={current.predictedReturn3d}
                    label={`${current.trend === "up" ? "상승" : "하락"} 전망 ${Math.abs(current.predictedReturn3d)}%`}
                  />
                </div>
                <IndexChart result={current} />
              </div>
            )}

            {/* ── Metrics ─────────────────────────────────────────────────── */}
            {current && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard
                  label={isEn ? "3-Day Prediction" : "3일 예측 수익률"}
                  value={`${current.predictedReturn3d >= 0 ? "+" : ""}${current.predictedReturn3d}%`}
                  sub={current.trend === "up" ? "상승 전망" : "하락 전망"}
                />
                <MetricCard
                  label={isEn ? "Walk-Forward Acc." : "Walk-Forward 정확도"}
                  value={`${current.wfDirAcc}%`}
                  sub="2 구간 평균"
                />
                <MetricCard
                  label={isEn ? "Test MAE" : "예측 오차 (MAE)"}
                  value={`${current.testMae}%`}
                  sub="수익률 기준"
                />
                <MetricCard
                  label={isEn ? "30-Day Dir. Acc." : "최근 30일 정확도"}
                  value={`${current.rolling30dDirAcc}%`}
                  sub="방향 정확도 (롤링)"
                />
              </div>
            )}

            {/* ── Predicted vs Actual return chart (last 30 days) ─────────── */}
            {current && current.recentPerf && current.recentPerf.length > 0 && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    {isEn ? "Prediction vs Actual (Last 30 Days)" : "예측 vs 실제 수익률 — 최근 30거래일"}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isEn
                      ? "Outlined bar = predicted 3-day return · Filled bar = actual 3-day return"
                      : "테두리 막대 = 예측 3일 수익률 · 채운 막대 = 실제 3일 수익률 · 상승=빨강, 하락=파랑"}
                  </p>
                </div>
                <ReturnComparisonChart data={current.recentPerf} />
              </div>
            )}

            {/* ── Model info ──────────────────────────────────────────────── */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-xs text-muted-foreground/60 space-y-1.5">
              <div className="flex items-center gap-2 font-medium text-muted-foreground mb-2">
                <BrainCircuit className="w-3.5 h-3.5" />
                {isEn ? "Model Architecture" : "모델 구조"}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
                {[
                  ["LSTM", `32 유닛 · lookback 20일 · dropout 0.2 · epochs ${20} · Adam lr=0.001`],
                  ["GBDT", "60 트리 · depth 3 · min_child 20 · lr=0.05 · feature/row sub 55%/80%"],
                  ["피처", "수익률, MA5/20비율, RSI14, 변동성5/20일, 볼린저밴드, 모멘텀5/10일"],
                  ["앙상블 가중치", current
                    ? `LSTM ${(current.ensembleAlpha * 100).toFixed(0)}% · GBDT ${((1 - current.ensembleAlpha) * 100).toFixed(0)}% (최근 30일 방향정확도 비율)`
                    : "최근 30일 방향정확도 비율로 적응형 산출"],
                  ["모델 정확도", current
                    ? `LSTM ${current.lstmDirAcc}% · GBDT ${current.gbdtDirAcc}% · 앙상블 ${current.testDirAcc}%`
                    : "—"],
                  ["학습 데이터", "최근 5년 일별 종가 (Yahoo Finance) · 80:20 분할"],
                  ["검증", "Walk-Forward (테스트셋 2구간 분리) + 롤링 30일 정확도"],
                  ["예측 목표", "3거래일 후 수익률 (회귀) · 신뢰구간 ±1σ · 캐시 TTL 6h"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="shrink-0 text-muted-foreground/50">{k}:</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground/30 border-t border-white/[0.05] pt-2">
                ※ 본 예측은 AI 모델의 통계적 분석이며 투자 권유가 아닙니다. 실제 시장은 모델이 반영하지 못한 외부 변수에 영향받을 수 있습니다.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
