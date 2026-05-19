import { useState, useEffect, useCallback } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
  Bar, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, RefreshCw, BrainCircuit,
  CheckCircle2, Circle, Loader2, AlertCircle, BarChart3,
  Cpu, Database, GitMerge, ChevronRight, Zap,
  ChevronDown, Newspaper, Sparkles, CalendarDays, Info,
  Shield,
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

interface MarketBrief {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  recentIssues: string[];
  outlook: string[];
  generatedAt: string;
  kospiCurrent: number | null;
  kosdaqCurrent: number | null;
  kospiChange: number | null;
  kosdaqChange: number | null;
  cached?: boolean;
  stale?: boolean;
}

/* ── 색상 상수 ───────────────────────────────────────────────────────────── */
const RISE = "#ef4444";
const FALL = "#3b82f6";

/* ── 날짜 포매터 ─────────────────────────────────────────────────────────── */
function formatDate(dateStr: string, short = false): string {
  const d = new Date(dateStr + "T00:00:00");
  if (short) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── AI 브리핑 카드 ──────────────────────────────────────────────────────── */
function MarketBriefSection({
  brief, loading, onRefresh,
}: {
  brief: MarketBrief | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const sentimentConfig = brief?.sentiment === "bullish"
    ? { color: "text-red-400 bg-red-500/10 border-red-500/20", label: "상승 우세", emoji: "📈" }
    : brief?.sentiment === "bearish"
    ? { color: "text-blue-400 bg-blue-500/10 border-blue-500/20", label: "하락 우세", emoji: "📉" }
    : { color: "text-amber-400 bg-amber-500/10 border-amber-500/20", label: "방향 불확실", emoji: "↔️" };

  const genTime = brief?.generatedAt
    ? new Date(brief.generatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">AI 오늘의 한마디</span>
          {brief && !loading && (
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", sentimentConfig.color)}>
              {sentimentConfig.emoji} {sentimentConfig.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {genTime && (
            <span className="text-[10px] text-muted-foreground/40">{genTime} 분석</span>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[11px] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-all disabled:opacity-40"
          >
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
            {loading ? "분석 중..." : "다시 분석"}
          </button>
        </div>
      </div>

      <div className="p-4">
        {loading && !brief && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
            <span className="text-sm text-muted-foreground">시장 데이터를 읽어보는 중이에요...</span>
          </div>
        )}

        {!loading && !brief && (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground/40">
            <Newspaper className="w-6 h-6" />
            <span className="text-xs">브리핑을 불러올 수 없습니다</span>
          </div>
        )}

        {brief && (
          <div className="space-y-4">
            {brief.summary && (
              <p className="text-sm font-medium text-foreground/90 leading-relaxed">
                {brief.summary}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {brief.recentIssues.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <Newspaper className="w-3.5 h-3.5" />
                    요즘 시장에서 일어나는 일
                  </div>
                  <ul className="space-y-2">
                    {brief.recentIssues.map((issue, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground/80 leading-relaxed">
                        <span className="shrink-0 w-4 h-4 rounded-full bg-white/[0.06] border border-white/[0.10] flex items-center justify-center text-[9px] font-bold text-muted-foreground mt-0.5">
                          {i + 1}
                        </span>
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {brief.outlook.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <CalendarDays className="w-3.5 h-3.5" />
                    앞으로 3일은 어떨까?
                  </div>
                  <ul className="space-y-2">
                    {brief.outlook.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-foreground/80 leading-relaxed">
                        <span className={cn(
                          "shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5",
                          i === 0
                            ? "bg-primary/15 border border-primary/30 text-primary text-[9px] font-bold"
                            : "bg-white/[0.06] border border-white/[0.10] text-muted-foreground text-[9px] font-bold",
                        )}>
                          {i + 1}
                        </span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {brief.stale && (
              <p className="text-[10px] text-amber-500/60 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> 이전 분석입니다 (새로고침 실패)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 파이프라인 단계 아이콘 (내부 전용) ──────────────────────────────────── */
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

function StepIcon({ stepKey, status }: { stepKey: string; status: PipelineStep["status"] }) {
  const Icon = STEP_ICONS[stepKey] ?? Circle;
  if (status === "done")    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />;
  if (status === "error")   return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
  return <Icon className="w-3.5 h-3.5 text-muted-foreground/30" />;
}

function PipelineTracker({ steps }: { steps: PipelineStep[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {steps.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1">
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-medium transition-all",
            step.status === "done"    && "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
            step.status === "running" && "border-primary/40 bg-primary/5 text-primary",
            step.status === "error"   && "border-red-500/30 bg-red-500/5 text-red-400",
            step.status === "pending" && "border-border bg-transparent text-muted-foreground/40",
          )}>
            <StepIcon stepKey={step.key} status={step.status} />
            <span>{step.label}</span>
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className="w-3 h-3 text-muted-foreground/20 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── 지수 뱃지 ───────────────────────────────────────────────────────────── */
function TrendBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full",
      up ? "bg-red-500/15 text-red-400 border border-red-500/25"
         : "bg-blue-500/15 text-blue-400 border border-blue-500/25",
    )}>
      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {up ? "상승" : "하락"} 전망 {Math.abs(value)}%
    </span>
  );
}

/* ── 메인 차트 ───────────────────────────────────────────────────────────── */
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
            범위: {d.lower.toLocaleString()} ~ {d.upper.toLocaleString()}
          </p>
        )}
        {d.isPrediction && <p className="text-primary text-[10px] mt-0.5">AI 예측값 (오차 범위 포함)</p>}
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
            label={{ value: "오늘", fill: "rgba(255,255,255,0.4)", fontSize: 10, position: "insideTopLeft" }}
          />
        )}
        <Area dataKey="upper" stroke="none" fill={`url(#confGrad-${result.symbol})`}
          isAnimationActive={false} legendType="none" activeDot={false} />
        <Area dataKey="lower" stroke="none" fill="transparent"
          isAnimationActive={false} legendType="none" activeDot={false} />
        <Line
          dataKey="historical"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={1.5} dot={false} name="실제 흐름"
          connectNulls={false} isAnimationActive animationDuration={800}
        />
        <Line
          dataKey="predicted"
          stroke={predColor} strokeWidth={2} strokeDasharray="5 3"
          dot={{ r: 3, fill: predColor, stroke: predColor }}
          name="AI 예측" connectNulls={false}
          isAnimationActive animationDuration={800} animationBegin={400}
        />
        <Legend iconType="line" wrapperStyle={{ fontSize: 11, paddingTop: 8, color: "rgba(255,255,255,0.5)" }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── 예측 vs 실제 비교 차트 ──────────────────────────────────────────────── */
function ReturnComparisonChart({ data }: { data: RecentPerfPoint[] }) {
  const allVals  = data.flatMap(d => [d.actual, d.predicted]);
  const dataMin  = Math.min(...allVals);
  const dataMax  = Math.max(...allVals);
  const pad      = Math.max(Math.abs(dataMin), Math.abs(dataMax)) * 0.15;
  const yDomain: [number, number] = [
    Math.floor((dataMin - pad) * 10) / 10,
    Math.ceil ((dataMax + pad) * 10) / 10,
  ];

  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as RecentPerfPoint;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
        <p className="text-muted-foreground font-medium">{d.date}</p>
        <p style={{ color: "#a78bfa" }}>
          AI 예측: {d.predicted >= 0 ? "+" : ""}{d.predicted}%
        </p>
        <p style={{ color: d.actual >= 0 ? RISE : FALL }}>
          실제 결과: {d.actual >= 0 ? "+" : ""}{d.actual}%
        </p>
        <p className="text-muted-foreground/50 text-[10px]">
          {(d.predicted >= 0) === (d.actual >= 0) ? "✅ 방향 맞힘" : "❌ 방향 틀림"}
        </p>
      </div>
    );
  };

  const tickFormatter = (_: any, index: number) =>
    index % 5 === 0 ? formatDate(data[index]?.date ?? "", true) : "";

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={tickFormatter}
          tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
          tickLine={false} axisLine={false}
          interval={0}
        />
        <YAxis
          domain={yDomain}
          tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
          tickLine={false} axisLine={false} width={52}
        />
        <Tooltip content={customTooltip} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 2" />

        <Bar dataKey="actual" name="실제 등락" radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={`act-${i}`} fill={d.actual >= 0 ? RISE : FALL} fillOpacity={0.7} />
          ))}
        </Bar>

        <Line
          dataKey="predicted"
          name="AI 예측 방향"
          type="monotone"
          stroke="#a78bfa"
          strokeWidth={1.5}
          dot={{ r: 3, fill: "#a78bfa", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />

        <Legend
          iconSize={10}
          wrapperStyle={{ fontSize: 10, paddingTop: 8, color: "rgba(255,255,255,0.5)" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ── 수치 카드 ───────────────────────────────────────────────────────────── */
function StatCard({
  emoji, label, value, desc, highlight,
}: {
  emoji: string; label: string; value: string; desc: string; highlight?: boolean;
}) {
  return (
    <div className={cn(
      "flex flex-col gap-1 px-4 py-3.5 rounded-2xl border",
      highlight
        ? "border-primary/25 bg-primary/5"
        : "border-white/[0.07] bg-white/[0.02]",
    )}>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <span>{emoji}</span>
        <span className="font-medium">{label}</span>
      </div>
      <span className={cn("text-2xl font-bold", highlight ? "text-primary" : "text-foreground")}>
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground/55 leading-snug">{desc}</span>
    </div>
  );
}

/* ── 메인 페이지 ─────────────────────────────────────────────────────────── */
export default function MarketAnalysis() {
  const { isEn } = useLanguage();
  const [status, setStatus]           = useState<PipelineStatus | null>(null);
  const [activeIdx, setActiveIdx]     = useState<"kospi" | "kosdaq">("kospi");
  const [isStarting, setIsStarting]   = useState(false);
  const [techOpen, setTechOpen]       = useState(false);
  const [brief, setBrief]             = useState<MarketBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  const fetchBrief = useCallback(async (force = false) => {
    setBriefLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/market-analysis/brief${force ? "?force=true" : ""}`), { credentials: "include" });
      if (r.ok) setBrief(await r.json());
    } catch {} finally {
      setBriefLoading(false);
    }
  }, []);

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
  useEffect(() => { fetchBrief(); }, [fetchBrief]);

  useEffect(() => {
    if (!status) return undefined;
    if (status.running) {
      const t = setInterval(fetchStatus, 2000);
      return () => clearInterval(t);
    }
    if (!status.ready && !status.running && !status.error) {
      triggerRun(false);
    }
    return undefined;
  }, [status, fetchStatus, triggerRun]);

  const current = activeIdx === "kospi" ? status?.kospi : status?.kosdaq;

  return (
    <div className="space-y-5 pb-20">

      {/* ── 헤더 ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            오늘의 AI 시장 분석
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            코스피·코스닥의 3일 앞을 AI가 예측합니다
          </p>
        </div>
        <button
          onClick={() => triggerRun(true)}
          disabled={status?.running || isStarting}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] border border-white/[0.10] text-sm font-medium hover:bg-white/[0.10] transition-all disabled:opacity-40 shrink-0"
        >
          {status?.running || isStarting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중...</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> AI 다시 분석</>
          )}
        </button>
      </div>

      {/* ── AI 브리핑 ───────────────────────────────────────────────────── */}
      <MarketBriefSection
        brief={brief}
        loading={briefLoading}
        onRefresh={() => fetchBrief(true)}
      />

      {/* ── 로딩 상태 ───────────────────────────────────────────────────── */}
      {!status?.ready && status?.running && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">AI가 시장 데이터를 분석하고 있어요 ☕</p>
            <p className="text-xs text-muted-foreground mt-1">처음 실행 시 약 90초 정도 걸립니다. 잠시 기다려 주세요!</p>
          </div>
        </div>
      )}

      {!status?.ready && !status?.running && !status?.error && (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] flex flex-col items-center justify-center gap-3 py-16">
          <BrainCircuit className="w-8 h-8 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">AI를 준비하는 중이에요...</p>
            <p className="text-xs text-muted-foreground mt-1">잠시 후 자동으로 시작됩니다</p>
          </div>
        </div>
      )}

      {/* ── 결과 영역 ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {status?.ready && status.kospi && status.kosdaq && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-5"
          >

            {/* ── 지수 선택 ────────────────────────────────────────────── */}
            <div>
              <p className="text-xs text-muted-foreground/60 mb-2 font-medium">어떤 지수를 볼까요?</p>
              <div className="flex items-stretch gap-3 flex-wrap">
                {(["kospi", "kosdaq"] as const).map(idx => {
                  const data = idx === "kospi" ? status.kospi! : status.kosdaq!;
                  const isActive = activeIdx === idx;
                  const up = data.predictedReturn3d >= 0;
                  return (
                    <button
                      key={idx}
                      onClick={() => setActiveIdx(idx)}
                      className={cn(
                        "flex-1 min-w-[140px] flex flex-col gap-2 px-4 py-4 rounded-2xl border transition-all text-left",
                        isActive
                          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                          : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">{data.name}</span>
                        {isActive && <span className="text-[10px] text-primary font-medium">선택됨</span>}
                      </div>
                      <div className="text-xl font-bold text-foreground">
                        {data.currentValue.toLocaleString()}
                      </div>
                      <div className={cn(
                        "flex items-center gap-1 text-xs font-semibold",
                        up ? "text-red-400" : "text-blue-400",
                      )}>
                        {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                        3일 후 {up ? "오를 것 같아요" : "내릴 것 같아요"} ({up ? "+" : ""}{data.predictedReturn3d}%)
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── 메인 차트 ────────────────────────────────────────────── */}
            {current && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-foreground">
                      {current.name} — 최근 흐름과 AI 예측
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      흰 실선 = 실제 지수 흐름 · 점선 = AI가 예측한 3일 · 반투명 영역 = 오차 범위
                    </p>
                  </div>
                  <TrendBadge value={current.predictedReturn3d} />
                </div>
                <IndexChart result={current} />
              </div>
            )}

            {/* ── AI 적중률 카드 ────────────────────────────────────────── */}
            {current && (
              <div>
                <p className="text-xs text-muted-foreground/60 mb-2 font-medium flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" /> AI 예측 성능 — 이 정도로 믿을 수 있어요
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard
                    emoji="🎯"
                    label="3일 후 예측"
                    value={`${current.predictedReturn3d >= 0 ? "+" : ""}${current.predictedReturn3d}%`}
                    desc={current.trend === "up" ? "상승 방향 전망" : "하락 방향 전망"}
                    highlight
                  />
                  <StatCard
                    emoji="✅"
                    label="최근 6주 적중률"
                    value={`${current.rolling30dDirAcc}%`}
                    desc="오르면 오른다 / 내리면 내린다고 맞힌 비율"
                  />
                  <StatCard
                    emoji="📊"
                    label="전체 검증 적중률"
                    value={`${current.wfDirAcc}%`}
                    desc="50%면 동전 던지기 수준 · 60% 이상이면 의미 있음"
                  />
                  <StatCard
                    emoji="📏"
                    label="평균 예측 오차"
                    value={`±${current.testMae}%`}
                    desc="방향보다 정확한 숫자는 이만큼 차이날 수 있어요"
                  />
                </div>
              </div>
            )}

            {/* ── 예측 vs 실제 비교 ─────────────────────────────────────── */}
            {current && current.recentPerf && current.recentPerf.length > 0 && (
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    AI가 실제로 얼마나 맞혔나요?
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    막대 = 실제 등락 (빨강=오름·파랑=내림) · 보라 선 = AI가 예측한 방향 · 막대에 마우스를 올리면 상세 정보가 나와요
                  </p>
                </div>
                <ReturnComparisonChart data={current.recentPerf} />
              </div>
            )}

            {/* ── 이 화면 보는 법 (항상 펼쳐진 안내) ─────────────────────── */}
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
                <Info className="w-4 h-4 text-primary/70" />
                <span className="text-sm font-semibold text-foreground">이 화면 보는 법</span>
              </div>

              <div className="px-4 py-5 space-y-6">

                {/* 1. 지수 버튼 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">📊</span> 코스피 / 코스닥이 뭔가요?
                  </p>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    <span className="font-medium text-foreground">코스피</span>는 삼성전자·현대차·SK하이닉스처럼 우리나라 대표 대기업들의 주가를 모아서 하나의 숫자로 표현한 것입니다.
                    <span className="font-medium text-foreground"> 코스닥</span>은 IT·바이오·게임 같은 중소·성장 기업들을 모은 지수예요.
                    두 버튼을 눌러 원하는 시장을 골라서 보시면 됩니다.
                  </p>
                </div>

                {/* 2. AI 예측 숫자 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">🔮</span> "3일 후 +0.8%" 이게 무슨 말이에요?
                  </p>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    AI가 <span className="font-medium text-foreground">3거래일(영업일 기준)</span> 후 지수가 지금보다 몇 % 움직일지 예측한 값입니다.
                    <span className="text-red-400 font-medium"> 빨간색 숫자·화살표</span>는 오를 것 같다, <span className="text-blue-400 font-medium">파란색은 내릴 것 같다</span>는 뜻이에요.
                    정확한 숫자보다 <span className="font-medium text-foreground">방향(오를지 내릴지)</span>을 참고하는 데 쓰세요.
                  </p>
                </div>

                {/* 3. 차트 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">📈</span> 차트 읽는 법
                  </p>
                  <div className="bg-white/[0.03] rounded-xl px-4 py-3 space-y-2.5">
                    {[
                      { mark: "——", color: "text-white/70", desc: "흰색 실선 — 최근 약 4개월간의 실제 지수 흐름입니다." },
                      { mark: "- -", color: "text-red-400", desc: "점선 — 오늘 이후 AI가 예측하는 3일 구간입니다." },
                      { mark: "░░░", color: "text-muted-foreground", desc: "반투명 영역 — 예측의 오차 범위예요. 이 안에서 실제 값이 움직일 가능성이 높습니다. 넓을수록 AI도 확신이 낮다는 뜻이에요." },
                      { mark: "│", color: "text-white/40", desc: "세로 점선 — 오늘(현재)을 나타내는 기준선입니다." },
                    ].map(item => (
                      <div key={item.mark} className="flex items-start gap-3">
                        <span className={cn("text-sm font-bold shrink-0 w-6", item.color)}>{item.mark}</span>
                        <p className="text-xs text-muted-foreground/75 leading-relaxed">{item.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. 적중률 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">🎯</span> 적중률이 몇 %면 좋은 건가요?
                  </p>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    <span className="font-medium text-foreground">50%</span>는 동전 던지기와 똑같습니다. AI라도 딱 50%면 의미가 없어요.
                    <span className="font-medium text-foreground"> 60% 이상</span>이면 "통계적으로 의미 있다"고 보고,
                    <span className="font-medium text-foreground"> 70% 이상</span>이면 꽤 잘 맞히는 편입니다.
                    현재 AI는 <span className="font-medium text-primary">최근 6주 기준 {current?.rolling30dDirAcc}%</span>를 기록하고 있어요.
                  </p>
                </div>

                {/* 5. 비교 차트 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">📋</span> "AI가 실제로 얼마나 맞혔나요?" 차트
                  </p>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    최근 30거래일(약 6주)의 기록입니다.
                    <span className="text-red-400 font-medium"> 빨간 막대</span>는 실제로 오른 날,
                    <span className="text-blue-400 font-medium"> 파란 막대</span>는 실제로 내린 날이에요.
                    <span className="text-purple-400 font-medium"> 보라색 선</span>이 AI의 예측인데, 이 선이 막대와 같은 방향(위·아래)을 가리키고 있으면 AI가 맞힌 것입니다.
                    <br /><br />
                    한 가지 주의할 점: AI는 정확한 숫자보다는 <span className="font-medium text-foreground">방향(오를지 내릴지)</span>에 집중합니다.
                    그래서 실제 막대는 크게 움직여도 AI 선은 작게 움직이는 게 정상이에요.
                  </p>
                </div>

                {/* 6. AI 원리 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">🤖</span> AI는 어떻게 예측하나요?
                  </p>
                  <div className="bg-white/[0.03] rounded-xl px-4 py-3 space-y-4">
                    {[
                      {
                        num: "1",
                        title: "흐름을 기억하는 AI",
                        desc: "최근 20거래일의 지수 흐름을 순서대로 읽어서, 이런 패턴 다음엔 이렇게 움직이더라를 학습합니다. 사람이 차트를 눈으로 보고 이거 예전에 이랬는데 라고 느끼는 것과 비슷해요.",
                      },
                      {
                        num: "2",
                        title: "규칙을 찾는 AI",
                        desc: `5년치 데이터에서 수백 개의 규칙을 찾아냅니다. 기술적 지표 9개, 미국 증시·환율·금리 3개, 외국인·기관·공매도 3개 — 총 15가지를 동시에 고려해요. 날씨 앱이 기온·습도·기압을 종합해서 "오늘 비 올 확률 70%"를 알려주는 것과 비슷합니다.`,
                      },
                      {
                        num: "3",
                        title: "두 AI의 의견을 합칩니다",
                        desc: `두 AI가 각자 예측하면, 최근에 더 잘 맞힌 쪽에 가중치를 더 줍니다.${current ? ` 지금은 흐름 기억 AI ${(current.ensembleAlpha * 100).toFixed(0)}% + 규칙 발견 AI ${((1 - current.ensembleAlpha) * 100).toFixed(0)}% 비율로 합산하고 있어요.` : ""} 이 비율은 시장 상황에 따라 자동으로 바뀝니다.`,
                      },
                    ].map(item => (
                      <div key={item.num} className="flex gap-3 items-start">
                        <div className="shrink-0 w-6 h-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                          {item.num}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-foreground mb-0.5">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{item.desc}</p>
                        </div>
                      </div>
                    ))}

                    {current && (
                      <div className="pt-2 border-t border-white/[0.06] grid grid-cols-3 gap-2 text-center text-[11px]">
                        <div>
                          <p className="text-muted-foreground/50">흐름 기억 AI</p>
                          <p className="font-bold text-foreground mt-0.5">{current.lstmDirAcc}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground/50">규칙 발견 AI</p>
                          <p className="font-bold text-foreground mt-0.5">{current.gbdtDirAcc}%</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground/50">합산 결과</p>
                          <p className="font-bold text-primary mt-0.5">{current.rolling30dDirAcc}%</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 면책 */}
                <p className="text-[10px] text-muted-foreground/30 border-t border-white/[0.05] pt-4 leading-relaxed">
                  ※ 이 예측은 AI의 통계적 분석이며, 투자를 권유하는 것이 아닙니다.
                  실제 시장은 AI가 반영하지 못하는 갑작스러운 뉴스·정책·글로벌 이슈에 크게 영향받을 수 있습니다.
                  투자 결정은 반드시 전문가와 상담하시거나 본인이 직접 판단하세요.
                </p>
              </div>
            </div>

            {/* ── 기술 정보 (개발자용, 접어두기) ──────────────────────── */}
            <div className="rounded-2xl border border-white/[0.05] bg-transparent overflow-hidden">
              <button
                onClick={() => setTechOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
              >
                <div className="flex items-center gap-2 text-xs text-muted-foreground/40 font-medium">
                  <BrainCircuit className="w-3.5 h-3.5" />
                  기술 정보 (분석 파이프라인)
                  {status?.trainingMs && (
                    <span className="text-muted-foreground/25">총 {(status.trainingMs / 1000).toFixed(1)}s</span>
                  )}
                  {status?.trainedAt && (
                    <span className="text-muted-foreground/25">
                      · 학습 완료 {new Date(status.trainedAt).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/30 transition-transform", techOpen && "rotate-180")} />
              </button>

              {techOpen && (
                <div className="px-4 pb-4 border-t border-white/[0.05] pt-3 space-y-2">
                  <PipelineTracker steps={status?.steps ?? [
                    { key: "data",     label: "데이터 수집",    status: "pending" },
                    { key: "feature",  label: "피처 엔지니어링", status: "pending" },
                    { key: "lstm",     label: "LSTM 학습",       status: "pending" },
                    { key: "gbdt",     label: "GBDT 학습",       status: "pending" },
                    { key: "ensemble", label: "앙상블 합성",     status: "pending" },
                    { key: "output",   label: "출력",            status: "pending" },
                  ]} />
                  {status?.error && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 mt-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{status.error}</span>
                    </div>
                  )}
                  {current && (
                    <div className="text-[11px] text-muted-foreground/40 space-y-0.5 mt-2">
                      <p>LSTM dirAcc: {current.lstmDirAcc}% · GBDT dirAcc: {current.gbdtDirAcc}% · α={current.ensembleAlpha.toFixed(3)}</p>
                      <p>testDirAcc: {current.testDirAcc}% · wfDirAcc: {current.wfDirAcc}% · MAE: {current.testMae}% · predErrStd: {current.predErrStd}%</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
