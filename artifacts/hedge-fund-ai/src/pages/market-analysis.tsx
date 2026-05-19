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
  ChevronDown, HelpCircle, Target, BarChart2, Vote,
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
  const [guideOpen, setGuideOpen] = useState(false);

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

            {/* ── 이 화면 보는 법 ───────────────────────────────────────────── */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
              <button
                onClick={() => setGuideOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <HelpCircle className="w-4 h-4 text-primary/70" />
                  이 화면 보는 법
                </div>
                <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", guideOpen && "rotate-180")} />
              </button>

              {guideOpen && (
                <div className="px-4 pb-5 space-y-5 border-t border-white/[0.06]">

                  {/* 섹션 1: 지수 선택 버튼 */}
                  <div className="pt-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="text-base">📊</span> 코스피 / 코스닥 버튼
                    </div>
                    <p className="text-xs text-muted-foreground/80 leading-relaxed">
                      보고 싶은 지수를 선택합니다. 옆에 붙은 <span className="text-red-400 font-medium">+1.2%</span> 같은 숫자가
                      <span className="font-medium text-foreground"> "AI가 예측한 3거래일 후 변화율"</span>입니다.
                      빨간색이면 상승, 파란색이면 하락 전망입니다.
                    </p>
                  </div>

                  {/* 섹션 2: 메인 차트 */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="text-base">📈</span> 위쪽 꺾은선 차트
                    </div>
                    <p className="text-xs text-muted-foreground/80 leading-relaxed">
                      <span className="font-medium text-foreground">실선</span>은 최근 90거래일(약 4.5개월)의 실제 지수입니다.
                      오른쪽 끝 <span className="font-medium text-foreground">점선 구간</span>이 AI가 예측한 향후 3일입니다.
                      점선 주변의 <span className="font-medium text-foreground">반투명 음영</span>은 "예측이 이 범위 안에서 어긋날 수 있다"는 불확실성 구간입니다.
                      음영이 넓을수록 AI도 확신이 낮다는 뜻입니다.
                    </p>
                  </div>

                  {/* 섹션 3: 지표 카드 4개 */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="text-base">🎯</span> 4개 지표 카드
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {[
                        {
                          title: "3일 예측 수익률",
                          desc: "AI가 3거래일 뒤 지수가 몇 % 오르거나 내릴지 예측한 값입니다. 방향(+/-)이 실제로 맞는지가 핵심이고, 정확한 숫자보다 방향을 참고하세요.",
                        },
                        {
                          title: "Walk-Forward 정확도",
                          desc: "AI를 과거 데이터로 '시험' 봤을 때 상승·하락 방향을 맞힌 비율입니다. 50%는 동전 던지기와 같고, 55% 이상이면 통계적으로 의미 있습니다.",
                        },
                        {
                          title: "예측 오차 (MAE)",
                          desc: "예측 수익률과 실제 수익률의 평균 오차입니다. 작을수록 정밀합니다. 단, 이 수치보다 위의 방향 정확도가 실용적으로 더 중요합니다.",
                        },
                        {
                          title: "최근 30일 정확도",
                          desc: "지난 30거래일(약 6주) 동안 방향을 맞힌 비율입니다. 과거 전체보다 최근 시장에 얼마나 잘 적응했는지 보여줍니다.",
                        },
                      ].map(item => (
                        <div key={item.title} className="bg-white/[0.03] rounded-xl px-3 py-2.5 space-y-1">
                          <p className="text-xs font-semibold text-foreground">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{item.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 섹션 4: 막대 비교 차트 */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="text-base">📋</span> 아래쪽 막대 비교 차트
                    </div>
                    <p className="text-xs text-muted-foreground/80 leading-relaxed">
                      최근 30거래일 동안 AI 예측과 실제 결과를 나란히 보여줍니다.
                      <span className="font-medium text-foreground"> 테두리만 있는 막대</span>가 AI 예측,
                      <span className="font-medium text-foreground"> 속이 채워진 막대</span>가 실제 결과입니다.
                      둘이 같은 색(빨강·파랑)이면 방향을 맞힌 것, 색이 다르면 틀린 것입니다.
                    </p>
                  </div>

                  {/* 섹션 5: AI 작동 원리 */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="text-base">🤖</span> AI가 어떻게 예측하나요?
                    </div>
                    <div className="bg-white/[0.03] rounded-xl px-3 py-3 space-y-3">
                      <div className="flex gap-3 items-start">
                        <div className="shrink-0 w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">1</div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-0.5">패턴 기억형 AI (LSTM)</p>
                          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                            과거 20거래일의 가격 흐름을 순서대로 읽어서 "이런 패턴 다음엔 이렇게 움직이더라"를 학습합니다.
                            사람이 차트를 눈으로 읽는 방식과 유사합니다.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3 items-start">
                        <div className="shrink-0 w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">2</div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-0.5">규칙 발견형 AI (GBDT)</p>
                          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                            5년치 데이터에서 수백 개의 "만약 X이면 Y" 규칙을 찾아냅니다.
                            RSI·이동평균·변동성 등 기술적 지표 9개,{" "}
                            <span className="text-foreground/80">S&P500 등락·환율·국고채 3년</span> 3개,{" "}
                            <span className="text-foreground/80">외국인 순매수·기관 순매수·공매도 비율</span> 3개—{" "}
                            총 15가지 지표를 동시에 고려합니다.
                            날씨 예보가 기온·습도·기압을 종합하는 것과 비슷합니다.
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-3 items-start">
                        <div className="shrink-0 w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">3</div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-0.5">두 AI의 투표 (앙상블)</p>
                          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                            두 AI가 각자 예측값을 내면, 최근 30거래일 동안 더 잘 맞힌 AI에게 투표권을 더 많이 줍니다.
                            {current && (
                              <span className="font-medium text-foreground">
                                {" "}현재: LSTM {(current.ensembleAlpha * 100).toFixed(0)}표 · GBDT {((1 - current.ensembleAlpha) * 100).toFixed(0)}표.
                              </span>
                            )}
                            {" "}이 가중치는 시장 상황에 따라 자동으로 바뀝니다.
                          </p>
                        </div>
                      </div>
                      {current && (
                        <div className="pt-1 border-t border-white/[0.06] flex items-center gap-4 text-[11px] text-muted-foreground/60">
                          <span>최근 30일 방향 정확도</span>
                          <span className="font-medium text-foreground">LSTM {current.lstmDirAcc}%</span>
                          <span className="font-medium text-foreground">GBDT {current.gbdtDirAcc}%</span>
                          <span className="font-medium text-primary">앙상블 {current.rolling30dDirAcc}%</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-[10px] text-muted-foreground/30 border-t border-white/[0.05] pt-3">
                    ※ 이 예측은 AI의 통계적 분석이며 투자 권유가 아닙니다. 실제 시장은 AI가 반영하지 못한 뉴스·정책·외부 충격에 영향받을 수 있습니다.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
