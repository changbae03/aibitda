import { useState, useEffect, useCallback, useRef } from "react";
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
  Shield, Globe, Lock,
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
  predictedReturn1d?: number;
  predictedReturn2d?: number;
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
  gbdtForecastRet?: number;
  lstmForecastRet?: number;
  /** [v22] 두 AI 모델(GBDT·LSTM) 방향 합의 신호 */
  agreementSignal?: "up" | "down" | "neutral";
  /** [v22] 합의 강도: 클수록 두 모델이 강하게 동일 방향 예측 */
  agreementStrength?: number;
}
interface LiveAccuracy {
  symbol:   string;
  correct:  number;
  total:    number;
  pending:  number;
  accuracy: number | null;
  byHorizon?: Record<string, { correct: number; total: number; accuracy: number | null }>;
}

interface PipelineStep {
  key: string; label: string;
  status: "pending" | "running" | "done" | "error";
  durationMs?: number;
}
interface PipelineStatus {
  running: boolean; ready: boolean;
  initializing?: boolean;
  steps: PipelineStep[];
  error?: string;
  trainedAt?: string;
  trainingMs?: number;
  modelVersion?: number;
  kospi?: IndexResult;
  kosdaq?: IndexResult;
  snp500?: IndexResult;
  nasdaq?: IndexResult;
}

interface MarketBrief {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  sessionType?: "morning" | "midday" | "closing";
  leadParagraph?: string;
  storyLine?: string;
  marketEvents?: { title: string; impact: string; direction: "positive" | "negative" | "neutral" }[];
  macroFactors?: { factor: string; status: string; implication: string }[];
  forwardLook?: { point: string; detail: string; watchFor: string }[];
  upcomingMacroEvents?: {
    date: string;
    title: string;
    description: string;
    impact: "high" | "medium" | "low";
    direction: "positive" | "negative" | "neutral";
  }[];
  keyTopics?: {
    keyword: string;
    category: "정치" | "기업" | "경제" | "글로벌" | "산업";
    description: string;
  }[];
  keyRisk?: string;
  recentIssues: string[];
  outlook: string[];
  generatedAt: string;
  kospiCurrent: number | null;
  kosdaqCurrent: number | null;
  kospiChange: number | null;
  kosdaqChange: number | null;
  cached?: boolean;
  stale?: boolean;
  generating?: boolean;
}

/* ── 색상 상수 ───────────────────────────────────────────────────────────── */
const RISE = "#ef4444";
const FALL = "#3b82f6";

/* ── 테마 감지 훅 (차트용) ───────────────────────────────────────────────── */
function useChartColors() {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setIsDark(document.documentElement.classList.contains("dark"))
    );
    obs.observe(document.documentElement, { attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return {
    tickFill:        isDark ? "rgba(255,255,255,0.38)" : "rgba(0,0,0,0.45)",
    gridStroke:      isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)",
    refLineStroke:   isDark ? "rgba(255,255,255,0.2)"  : "rgba(0,0,0,0.18)",
    histLineStroke:  isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.60)",
    legendColor:     isDark ? "rgba(255,255,255,0.5)"  : "rgba(0,0,0,0.45)",
    barCursor:       isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.04)",
  };
}

/* ── 날짜 포매터 ─────────────────────────────────────────────────────────── */
function formatDate(dateStr: string, short = false): string {
  const d = new Date(dateStr + "T00:00:00");
  if (short) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ── 섹션 레이블 (에디토리얼 구분선) ────────────────────────────────────── */
function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-semibold text-foreground/35 tracking-[0.16em] uppercase shrink-0">
        {label}
      </span>
      <div className="flex-1 h-px bg-border/60" />
    </div>
  );
}

/* ── AI 브리핑 카드 ──────────────────────────────────────────────────────── */
function MarketBriefSection({
  brief, loading, onRefresh, showRefresh = true,
}: {
  brief: MarketBrief | null;
  loading: boolean;
  onRefresh: () => void;
  showRefresh?: boolean;
}) {
  const sentimentConfig = brief?.sentiment === "bullish"
    ? { color: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/20", label: "상승 우세", bar: "bg-red-500 dark:bg-red-400" }
    : brief?.sentiment === "bearish"
    ? { color: "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-500/10 dark:border-blue-500/20", label: "하락 우세", bar: "bg-blue-500 dark:bg-blue-400" }
    : { color: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20", label: "방향 불확실", bar: "bg-amber-500 dark:bg-amber-400" };

  const dirCfg = (d: "positive" | "negative" | "neutral") =>
    d === "positive"
      ? { dot: "bg-red-500", badge: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/20", label: "긍정" }
      : d === "negative"
      ? { dot: "bg-blue-500", badge: "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-500/10 dark:border-blue-500/20", label: "부정" }
      : { dot: "bg-stone-400 dark:bg-muted-foreground/30", badge: "text-stone-600 bg-stone-100 border-stone-300 dark:text-muted-foreground/50 dark:bg-muted/60 dark:border-border", label: "중립" };

  const genTime = brief?.generatedAt
    ? new Date(brief.generatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const hasRich = !!(brief?.marketEvents?.length || brief?.macroFactors?.length || brief?.forwardLook?.length || brief?.upcomingMacroEvents?.length);

  const impactCfg = (impact: "high" | "medium" | "low") =>
    impact === "high"
      ? { label: "HIGH", cls: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/25" }
      : impact === "medium"
      ? { label: "MED",  cls: "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/25" }
      : { label: "LOW",  cls: "text-stone-500 bg-stone-100 border-stone-200 dark:text-muted-foreground/50 dark:bg-muted/50 dark:border-border" };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">AI 시장 브리핑</span>
          {/* 세션 뱃지 */}
          {brief && !loading && brief.sessionType && (
            <span className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-full border tracking-wide",
              brief.sessionType === "morning"
                ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/20"
                : brief.sessionType === "midday"
                ? "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/20"
                : brief.sessionType === "weekend"
                ? "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-500/10 dark:border-violet-500/20"
                : "text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-400 dark:bg-sky-500/10 dark:border-sky-500/20",
            )}>
              {brief.sessionType === "morning"
                ? "🌅 장전 브리핑"
                : brief.sessionType === "midday"
                ? "☀️ 장중 브리핑"
                : brief.sessionType === "weekend"
                ? "📅 주말 브리핑"
                : "🌆 장마감 브리핑"}
            </span>
          )}
          {brief && !loading && (
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", sentimentConfig.color)}>
              {sentimentConfig.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {genTime && (
            <span className="text-[10px] text-muted-foreground/40">{genTime} 분석</span>
          )}
          {showRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50 border border-border text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-40"
            >
              <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
              {loading ? "분석 중..." : "다시 분석"}
            </button>
          )}
        </div>
      </div>

      <div className="p-4 space-y-5">
        {/* 로딩 — 컴팩트 스켈레톤 */}
        {loading && !brief && (
          <div className="space-y-2 py-3 animate-pulse">
            <div className="h-4 bg-muted/60 rounded-md w-3/4" />
            <div className="h-3 bg-muted/40 rounded-md w-full" />
            <div className="h-3 bg-muted/40 rounded-md w-5/6" />
          </div>
        )}

        {/* 서버 브리핑 생성 중 (generating: true) */}
        {!loading && brief?.generating && (
          <div className="flex items-center gap-2.5 py-3 text-muted-foreground/60">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span className="text-xs">AI 분석 준비 중입니다. 잠시 후 자동으로 표시됩니다.</span>
          </div>
        )}

        {/* 에러 */}
        {!loading && !brief && (
          <div className="flex items-center gap-2 py-3 text-muted-foreground/40">
            <Newspaper className="w-4 h-4" />
            <span className="text-xs">브리핑을 불러올 수 없습니다</span>
          </div>
        )}

        {brief && !brief.generating && (
          <>
            {/* 헤드라인 + 리드 */}
            <div className="space-y-2.5">
              <h3 className="text-[16px] font-bold text-foreground leading-snug tracking-tight">
                {brief.summary}
              </h3>
              {brief.leadParagraph && (
                <p className="text-[13.5px] text-foreground/70 leading-[1.8] border-l-[2.5px] border-foreground/20 pl-3.5">
                  {brief.leadParagraph}
                </p>
              )}
            </div>

            {/* AI 해설 — 과거→현재→미래 내러티브 */}
            {brief.storyLine && (() => {
              const cleaned = brief.storyLine
                .replace(/^(안녕하세요[^。！!?\n]*[。！!?\n]?\s*)/i, "")
                .replace(/^(개인\s*투자자\s*여러분[^。！!?\n]*[。！!?\n]?\s*)/i, "")
                .replace(/^(\d{4}년\s*\d{1,2}월\s*\d{1,2}일[^。！!?]\s*)/i, "")
                .replace(/^(오늘도[^。！!?\n]*[。！!?\n]?\s*)/i, "")
                .replace(/^(주말\s*잘\s*보내[^。！!?\n]*[。！!?\n]?\s*)/i, "")
                .replace(/^(반갑습니다[^。！!?\n]*[。！!?\n]?\s*)/i, "")
                .trim();
              const paras = cleaned.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
              return (
                <div className="space-y-1 pt-1">
                  <SectionLabel label="시장 해설" />
                  <div className="space-y-3 pt-2">
                    {paras.map((para, i) => (
                      <p
                        key={i}
                        className={cn(
                          "leading-[1.8]",
                          i === 0
                            ? "text-[13px] text-foreground/80 font-medium"
                            : "text-[12.5px] text-foreground/65"
                        )}
                      >
                        {para}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* 풍부한 섹션이 있을 때만 표시 */}
            {hasRich && (
              <>
                {/* 최근 시장 이슈 */}
                {(brief.marketEvents?.length ?? 0) > 0 && (
                  <div className="space-y-3 pt-1">
                    <SectionLabel label="이번 주 무슨 일이" />
                    <div className="divide-y divide-border/50">
                      {brief.marketEvents!.map((ev, i) => {
                        const dc = dirCfg(ev.direction);
                        return (
                          <div key={i} className="flex gap-3 items-start py-3 first:pt-0">
                            <span className={cn("mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full", dc.dot)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <p className="text-[13px] font-semibold text-foreground leading-snug">{ev.title}</p>
                                <span className={cn("shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border", dc.badge)}>
                                  {dc.label}
                                </span>
                              </div>
                              <p className="text-[12px] text-foreground/55 leading-relaxed line-clamp-2">{ev.impact}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}


                {/* 향후 전망 */}
                {(brief.forwardLook?.length ?? 0) > 0 && (
                  <div className="space-y-3 pt-1">
                    <SectionLabel label="앞으로 3거래일" />
                    <div className="space-y-4">
                      {brief.forwardLook!.map((fw, i) => (
                        <div key={i} className="flex gap-4 items-start">
                          <span className="shrink-0 text-[12px] font-black text-foreground/18 tabular-nums leading-none mt-[3px]">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <div className="flex-1 space-y-1">
                            <p className="text-[13.5px] font-semibold text-foreground leading-snug">{fw.point}</p>
                            <p className="text-[12px] text-foreground/58 leading-relaxed line-clamp-2">{fw.detail}</p>
                            <p className="text-[11px] text-foreground/35 flex items-center gap-1 pt-0.5 line-clamp-1">
                              체크 <ChevronRight className="w-2.5 h-2.5 inline shrink-0" /> {fw.watchFor}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 향후 3~5거래일 주목 매크로 이벤트 */}
                {(brief.upcomingMacroEvents?.length ?? 0) > 0 && (
                  <div className="space-y-3 pt-1">
                    <SectionLabel label="글로벌 이벤트" />
                    <div className="divide-y divide-border/50">
                      {brief.upcomingMacroEvents!.map((ev, i) => {
                        const dc = dirCfg(ev.direction);
                        const ic = impactCfg(ev.impact);
                        return (
                          <div key={i} className="flex gap-3 items-start py-3 first:pt-0">
                            <span className={cn("mt-[7px] shrink-0 w-1.5 h-1.5 rounded-full", dc.dot)} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-[11px] font-semibold text-foreground/35 shrink-0">{ev.date}</span>
                                <p className="text-[13px] font-semibold text-foreground leading-snug">{ev.title}</p>
                                <span className={cn("shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border", ic.cls)}>
                                  {ic.label}
                                </span>
                              </div>
                              <p className="text-[12px] text-foreground/55 leading-relaxed line-clamp-2">{ev.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 오늘 시장 핵심 키워드 */}
                {(brief.keyTopics?.length ?? 0) > 0 && (
                  <div className="space-y-3 pt-1">
                    <SectionLabel label="핵심 키워드" />
                    <div className="space-y-2.5">
                      {brief.keyTopics!.map((topic, i) => {
                        const catColor: Record<string, string> = {
                          "정치": "bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-500/10 dark:border-purple-500/25 dark:text-purple-400",
                          "기업": "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-500/10 dark:border-blue-500/25 dark:text-blue-400",
                          "경제": "bg-green-50 border-green-200 text-green-700 dark:bg-green-500/10 dark:border-green-500/25 dark:text-green-400",
                          "글로벌": "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-500/10 dark:border-orange-500/25 dark:text-orange-400",
                          "산업": "bg-cyan-50 border-cyan-200 text-cyan-700 dark:bg-cyan-500/10 dark:border-cyan-500/25 dark:text-cyan-400",
                        };
                        const cls = catColor[topic.category] ?? "bg-stone-100 border-stone-300 text-stone-600 dark:bg-muted/40 dark:border-border dark:text-muted-foreground";
                        return (
                          <div key={i} className="flex items-start gap-2.5 py-2 border-b border-border/40 last:border-0">
                            <span className={cn("shrink-0 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border leading-tight", cls)}>
                              {topic.category}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-foreground leading-snug">{topic.keyword}</p>
                              <p className="text-[11.5px] text-foreground/50 leading-relaxed line-clamp-1 mt-0.5">{topic.description}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 핵심 리스크 */}
                {brief.keyRisk && (
                  <div className="border-l-[2.5px] border-amber-400/60 dark:border-amber-500/40 pl-3.5 py-0.5">
                    <p className="text-[10px] font-bold text-amber-600/70 dark:text-amber-400/50 mb-1.5 tracking-[0.12em] uppercase">주의</p>
                    <p className="text-[12.5px] text-foreground/65 leading-relaxed">{brief.keyRisk}</p>
                  </div>
                )}
              </>
            )}

            {/* 풍부한 데이터 없을 때 폴백 */}
            {!hasRich && (brief.recentIssues.length > 0 || brief.outlook.length > 0) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {brief.recentIssues.length > 0 && (
                  <div className="space-y-2">
                    <SectionLabel label="최근 이슈" />
                    <ul className="space-y-2.5 pt-1">
                      {brief.recentIssues.map((issue, i) => (
                        <li key={i} className="flex items-start gap-3 text-[12.5px] text-foreground/70 leading-relaxed">
                          <span className="shrink-0 text-[10px] font-black text-foreground/20 tabular-nums mt-[2px]">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {issue}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {brief.outlook.length > 0 && (
                  <div className="space-y-2">
                    <SectionLabel label="전망" />
                    <ul className="space-y-2.5 pt-1">
                      {brief.outlook.map((item, i) => (
                        <li key={i} className="flex items-start gap-3 text-[12.5px] text-foreground/70 leading-relaxed">
                          <span className="shrink-0 text-[10px] font-black text-foreground/20 tabular-nums mt-[2px]">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {brief.stale && (
              <p className="text-[10px] text-amber-500/60 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> 이전 분석입니다 (새로고침 실패)
              </p>
            )}
          </>
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
      up ? "bg-red-50 text-red-600 border border-red-200 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/25"
         : "bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25",
    )}>
      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {up ? "상승" : "하락"} 전망 {Math.abs(value)}%
    </span>
  );
}

/* ── 메인 차트 ───────────────────────────────────────────────────────────── */
function IndexChart({ result, predHistory = [] }: { result: IndexResult; predHistory?: PredictionRecord[] }) {
  const cc = useChartColors();

  // 과거 예측 이력을 target_date → {price, correct} 맵으로 변환
  const predMap = new Map<string, { price: number; correct: boolean | null }>();
  for (const rec of predHistory) {
    const price = rec.price_at_pred * (1 + rec.predicted_return / 100);
    predMap.set(rec.target_date, { price: Math.round(price), correct: rec.correct });
  }

  const chartData = [
    ...result.historical.map(h => ({
      date: h.date,
      label: formatDate(h.date, true),
      historical: h.value,
      predicted: undefined as number | undefined,
      lower: undefined as number | undefined,
      upper: undefined as number | undefined,
      isPrediction: false,
      pastPred: predMap.get(h.date)?.price,
      pastPredCorrect: predMap.get(h.date)?.correct ?? null,
    })),
    ...result.predictions.map(p => ({
      date: p.date,
      label: formatDate(p.date, true),
      historical: undefined as number | undefined,
      predicted: p.value,
      lower: p.lower,
      upper: p.upper,
      isPrediction: true,
      pastPred: predMap.get(p.date)?.price,
      pastPredCorrect: predMap.get(p.date)?.correct ?? null,
    })),
  ];

  const allValues = [
    ...result.historical.map(h => h.value),
    ...result.predictions.flatMap(p => [p.lower, p.upper]),
    ...Array.from(predMap.values()).map(v => v.price),
  ].filter(v => v != null) as number[];
  const minVal = Math.min(...allValues) * 0.997;
  const maxVal = Math.max(...allValues) * 1.003;

  const lastHistDate = result.historical[result.historical.length - 1]?.date;
  const predColor = result.trend === "up" ? RISE : FALL;

  // 과거 예측 점 커스텀 렌더러
  const PastPredDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (payload?.pastPred == null || cx == null || cy == null) return null;
    const c = payload.pastPredCorrect === true ? "#22c55e"
            : payload.pastPredCorrect === false ? "#ef4444"
            : "#94a3b8";
    return (
      <g key={`ppd-${payload.date}`}>
        <circle cx={cx} cy={cy} r={5} fill={c} stroke="white" strokeWidth={1.5} opacity={0.9} />
      </g>
    );
  };

  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    const val = d?.historical ?? d?.predicted;
    if (val == null && d?.pastPred == null) return null;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
        <p className="text-muted-foreground">{d.date}</p>
        {val != null && <p className="font-bold text-foreground">{val.toLocaleString()}</p>}
        {d.isPrediction && d.lower != null && (
          <p className="text-muted-foreground">범위: {d.lower.toLocaleString()} ~ {d.upper.toLocaleString()}</p>
        )}
        {d.isPrediction && <p className="text-primary text-[10px]">AI 예측값 (오차 범위 포함)</p>}
        {d.pastPred != null && (
          <div className="border-t border-border/50 pt-1 mt-1">
            <p className="text-[10px] text-muted-foreground">
              과거 예측 {d.pastPred.toLocaleString()}
              {d.pastPredCorrect === true && " ✅ 방향 적중"}
              {d.pastPredCorrect === false && " ❌ 방향 불일치"}
              {d.pastPredCorrect === null && " ⏳ 검증 대기"}
            </p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`confGrad-${result.symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={predColor} stopOpacity={0.18} />
              <stop offset="100%" stopColor={predColor} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={cc.gridStroke} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: cc.tickFill }}
            tickLine={false} axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minVal, maxVal]}
            tickFormatter={v => v.toLocaleString()}
            tick={{ fontSize: 10, fill: cc.tickFill }}
            tickLine={false} axisLine={false} width={58}
          />
          <Tooltip content={customTooltip} />
          {lastHistDate && (
            <ReferenceLine
              x={formatDate(lastHistDate, true)}
              stroke={cc.refLineStroke}
              strokeDasharray="4 4"
              label={{ value: "오늘", fill: cc.tickFill, fontSize: 10, position: "insideTopLeft" }}
            />
          )}
          <Area dataKey="upper" stroke="none" fill={`url(#confGrad-${result.symbol})`}
            isAnimationActive={false} legendType="none" activeDot={false} />
          <Area dataKey="lower" stroke="none" fill="transparent"
            isAnimationActive={false} legendType="none" activeDot={false} />
          <Line
            dataKey="historical"
            stroke={cc.histLineStroke}
            strokeWidth={1.5} dot={false} name="실제 흐름"
            connectNulls={false} isAnimationActive animationDuration={800}
          />
          <Line
            dataKey="predicted"
            stroke={predColor} strokeWidth={2} strokeDasharray="5 3"
            dot={{ r: 3, fill: predColor, stroke: predColor }}
            name="AI 예측 (D+3)" connectNulls={false}
            isAnimationActive animationDuration={800} animationBegin={400}
          />
          {/* 연속 예측 리본 — 과거 예측 점 (선 없이 점만 표시) */}
          <Line
            dataKey="pastPred"
            stroke="transparent" strokeWidth={0}
            dot={<PastPredDot />}
            activeDot={false}
            name="연속 예측"
            connectNulls={false}
            isAnimationActive={false}
            legendType="none"
          />
          <Legend iconType="line" wrapperStyle={{ fontSize: 11, paddingTop: 8, color: cc.legendColor }} />
        </ComposedChart>
      </ResponsiveContainer>
      {/* 예측 리본 범례 */}
      {predHistory.length > 0 && (
        <div className="flex items-center gap-3 px-1 text-[10px] text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> 예측 적중
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 inline-block" /> 방향 불일치
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" /> 검증 대기
          </span>
        </div>
      )}
    </div>
  );
}

/* ── 예측 vs 실제 비교 차트 ──────────────────────────────────────────────── */
const KRX_H_FE = new Set(["2025-01-01","2025-01-28","2025-01-29","2025-01-30","2025-05-05","2025-05-06","2025-06-06","2025-08-15","2025-10-03","2025-10-06","2025-10-07","2025-10-09","2025-12-25","2025-12-31","2026-01-01","2026-02-16","2026-02-17","2026-02-18","2026-03-02","2026-05-05","2026-05-25","2026-06-03","2026-10-09","2026-12-25","2026-12-31","2027-01-01","2027-02-06","2027-02-07","2027-02-08","2027-03-01","2027-05-05","2027-06-06","2027-08-16","2027-10-04","2027-10-05","2027-10-06","2027-10-11","2027-12-24","2027-12-31"]);
const NYSE_H_FE = new Set(["2025-01-01","2025-01-20","2025-02-17","2025-04-18","2025-05-26","2025-06-19","2025-07-04","2025-09-01","2025-11-27","2025-12-25","2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25","2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31","2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24"]);

function todayKST(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

function formatMD(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function nextTradingDays(fromDateStr: string, count: number, symbol = ""): string[] {
  const isUS = symbol && !symbol.endsWith(".KS") && !symbol.endsWith(".KQ") && !/^\d{6}$/.test(symbol);
  const holidays = isUS ? NYSE_H_FE : KRX_H_FE;
  const result: string[] = [];
  const d = new Date(fromDateStr);
  while (result.length < count) {
    d.setDate(d.getDate() + 1);
    const ds = d.toISOString().slice(0, 10);
    if (d.getDay() !== 0 && d.getDay() !== 6 && !holidays.has(ds)) {
      result.push(ds);
    }
  }
  return result;
}

function ReturnComparisonChart({
  data,
  future,
  symbol = "",
  predDates,
}: {
  data: RecentPerfPoint[];
  future?: { d1: number; d2: number; d3: number };
  symbol?: string;
  predDates?: string[];
}) {
  const cc = useChartColors();

  // predDates(서버 predictions 날짜) 우선 사용 → 카드와 동일 기준
  const lastDate = data[data.length - 1]?.date ?? "";
  const futureDates = (predDates && predDates.length === 3)
    ? predDates
    : (future && lastDate ? nextTradingDays(lastDate, 3, symbol) : []);

  // 차트 데이터: 과거 + 오늘 브릿지 + 미래 3포인트
  type ChartRow = {
    date: string; label: string;
    actual: number | null;
    predicted: number | null;    // 실선 (과거 + 브릿지)
    futurePredict: number | null; // 점선 (브릿지 + 미래)
    isFuture: boolean;
    futureLabel?: string;
  };

  const allRows: ChartRow[] = data.map((d, i) => ({
    date: d.date,
    label: i % 5 === 0 ? formatDate(d.date, true) : "",
    actual: d.actual,
    predicted: d.predicted,
    futurePredict: null,
    isFuture: false,
  }));

  // 마지막 역사 포인트에 브릿지값 설정
  if (future && allRows.length > 0) {
    const last = allRows[allRows.length - 1];
    last.futurePredict = last.predicted; // 연결점
    // 미래 3포인트 추가
    const labels = ["D+1", "D+2", "D+3"];
    const vals = [future.d1, future.d2, future.d3];
    futureDates.forEach((date, i) => {
      allRows.push({
        date,
        label: labels[i],
        actual: null,
        predicted: null,
        futurePredict: vals[i],
        isFuture: true,
        futureLabel: labels[i],
      });
    });
  }

  const allVals = data.flatMap(d => [d.actual, d.predicted]);
  if (future) allVals.push(future.d1, future.d2, future.d3);
  const dataMin = Math.min(...allVals);
  const dataMax = Math.max(...allVals);
  const pad     = Math.max(Math.abs(dataMin), Math.abs(dataMax)) * 0.15;
  const yDomain: [number, number] = [
    Math.floor((dataMin - pad) * 10) / 10,
    Math.ceil ((dataMax + pad) * 10) / 10,
  ];

  const customTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as ChartRow;
    const predVal = d.predicted ?? d.futurePredict;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg space-y-1">
        <p className="text-muted-foreground font-medium">
          {d.isFuture ? `${d.futureLabel} 예측 (${d.date})` : d.date}
        </p>
        {predVal != null && (
          <p style={{ color: "#a78bfa" }}>
            {d.isFuture ? "AI D+3 예측" : "AI 예측"}: {predVal >= 0 ? "+" : ""}{predVal}%
          </p>
        )}
        {d.actual != null && (
          <p style={{ color: d.actual >= 0 ? RISE : FALL }}>
            실제 결과: {d.actual >= 0 ? "+" : ""}{d.actual}%
          </p>
        )}
        {d.actual != null && predVal != null && (
          <p className="text-muted-foreground/50 text-[10px]">
            {(predVal >= 0) === (d.actual >= 0) ? "✅ 방향 맞힘" : "❌ 방향 틀림"}
          </p>
        )}
        {d.isFuture && (
          <p className="text-muted-foreground/50 text-[10px]">⏳ 예측 (결과 미확정)</p>
        )}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={210}>
      <ComposedChart data={allRows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid strokeDasharray="3 3" stroke={cc.gridStroke} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: cc.tickFill }}
          tickLine={false} axisLine={false}
          interval={0}
        />
        <YAxis
          domain={yDomain}
          tickFormatter={v => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          tick={{ fontSize: 9, fill: cc.tickFill }}
          tickLine={false} axisLine={false} width={48}
        />
        <Tooltip content={customTooltip} cursor={{ fill: cc.barCursor }} />
        <ReferenceLine y={0} stroke={cc.refLineStroke} strokeDasharray="4 2" />
        {future && lastDate && (
          <ReferenceLine
            x="D+1"
            stroke={cc.refLineStroke}
            strokeDasharray="3 3"
            label={{ value: "예측", fill: cc.tickFill, fontSize: 9, position: "insideTopLeft" }}
          />
        )}

        <Bar dataKey="actual" name="실제 등락" radius={[2, 2, 0, 0]}>
          {allRows.map((d, i) => (
            <Cell
              key={`act-${i}`}
              fill={d.actual != null ? (d.actual >= 0 ? RISE : FALL) : "transparent"}
              fillOpacity={d.actual != null ? 0.7 : 0}
            />
          ))}
        </Bar>

        {/* 과거 실선 */}
        <Line
          dataKey="predicted"
          name="AI 예측 방향"
          type="monotone"
          stroke="#a78bfa"
          strokeWidth={1.5}
          dot={{ r: 3, fill: "#a78bfa", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />

        {/* 미래 점선 (D+1~D+3) */}
        {future && (
          <Line
            dataKey="futurePredict"
            name="D+3 예측 (미래)"
            type="monotone"
            stroke="#a78bfa"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              if (!payload?.isFuture) return <g key={`fp-${payload.date}`} />;
              const c = (payload.futurePredict ?? 0) >= 0 ? "#a78bfa" : "#f87171";
              return <circle key={`fp-${payload.date}`} cx={cx} cy={cy} r={4} fill={c} stroke="white" strokeWidth={1.5} />;
            }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            legendType="none"
          />
        )}

        <Legend
          iconSize={10}
          wrapperStyle={{ fontSize: 10, paddingTop: 8, color: cc.legendColor }}
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
        : "border-border bg-muted/20",
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
  const [activeIdx, setActiveIdx]     = useState<"kospi" | "kosdaq" | "snp500" | "nasdaq">("kospi");
  const [isStarting, setIsStarting]   = useState(false);
  const [techOpen, setTechOpen]       = useState(false);
  const [guideOpen, setGuideOpen]     = useState(false);
  const [brief, setBrief]             = useState<MarketBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [liveAcc, setLiveAcc]         = useState<Record<string, LiveAccuracy> | null>(null);
  const [predHistory, setPredHistory] = useState<Record<string, PredictionRecord[]>>({});

  // 라이브 적중률 폴링
  useEffect(() => {
    const load = () =>
      fetch(getApiUrl("/api/market-analysis/live-accuracy"), { credentials: "include" })
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setLiveAcc(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  // 예측 이력 fetch (지수 전환 시마다)
  useEffect(() => {
    const symMap: Record<string, string> = { kospi:"^KS11", kosdaq:"^KQ11", snp500:"^GSPC", nasdaq:"^IXIC" };
    const sym = symMap[activeIdx];
    if (!sym) return;
    fetch(getApiUrl(`/api/market-analysis/prediction-history/${encodeURIComponent(sym)}?limit=20`), { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((d: PredictionRecord[]) => setPredHistory(prev => ({ ...prev, [sym]: Array.isArray(d) ? d : [] })))
      .catch(() => {});
  }, [activeIdx]);

  // 관리자 권한 확인
  const [isAdmin, setIsAdmin]         = useState<boolean | null>(null);
  useEffect(() => {
    fetch(getApiUrl("/api/admin/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setIsAdmin(d?.isAdmin === true))
      .catch(() => setIsAdmin(false));
  }, []);

  const briefPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchBrief = useCallback(async (force = false) => {
    if (!force) setBriefLoading(true);
    try {
      const r = await fetch(getApiUrl(`/api/market-analysis/brief${force ? "?force=true" : ""}`), { credentials: "include" });
      if (r.ok) {
        const data = await r.json();
        setBrief(data);
        // 아직 생성 중이면 5초 뒤 재시도
        if (data.generating) {
          briefPollRef.current = setTimeout(() => fetchBrief(), 5000);
        } else {
          if (briefPollRef.current) clearTimeout(briefPollRef.current);
        }
      }
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

  const current = activeIdx === "kospi" ? status?.kospi
    : activeIdx === "snp500" ? status?.snp500
    : activeIdx === "nasdaq" ? status?.nasdaq
    : status?.kosdaq;

  return (
    <div className="space-y-5 pb-20">

      {/* ── 헤더 ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">
            AI 시장 예측
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            코스피·코스닥의 3일 앞을 AI가 예측합니다
            {status?.running && status?.kospi && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                업데이트 중
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => triggerRun(true)}
            disabled={status?.running || isStarting}
            className="self-start flex items-center gap-2 px-4 py-2.5 rounded-xl bg-muted/50 border border-border text-sm font-medium hover:bg-muted transition-all disabled:opacity-40 shrink-0 min-h-[44px]"
          >
            {status?.running || isStarting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중...</>
            ) : (
              <><RefreshCw className="w-4 h-4" /> AI 다시 분석</>
            )}
          </button>
        )}
      </div>

      {/* ── AI 브리핑 ───────────────────────────────────────────────────── */}
      <MarketBriefSection
        brief={brief}
        loading={briefLoading}
        onRefresh={() => fetchBrief(true)}
        showRefresh={!!isAdmin}
      />

      {/* ── 로딩 상태: 데이터가 전혀 없을 때만 전체 스피너 ───────────────── */}
      {status?.running && !status?.kospi && !status?.kosdaq && (
        <div className="rounded-2xl border border-border bg-card flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <div className="text-center">
            {status.initializing ? (
              <>
                <p className="text-sm font-medium text-foreground">저장된 AI 모델을 불러오는 중이에요</p>
                <p className="text-xs text-muted-foreground mt-1">잠시만 기다려 주세요 (보통 10초 이내)</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">AI가 시장 데이터를 분석하고 있어요 ☕</p>
                <p className="text-xs text-muted-foreground mt-1">약 60~90초 정도 걸려요. 잠시 기다려 주세요!</p>
              </>
            )}
          </div>
        </div>
      )}

      {!status?.ready && !status?.running && !status?.error && !status?.kospi && (
        <div className="rounded-2xl border border-border bg-card flex flex-col items-center justify-center gap-3 py-16">
          <BrainCircuit className="w-8 h-8 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">AI를 준비하는 중이에요...</p>
            <p className="text-xs text-muted-foreground mt-1">잠시 후 자동으로 시작됩니다</p>
          </div>
        </div>
      )}

      {/* ── 결과 영역: 데이터가 있으면 즉시 표시 (업데이트 중이어도) ────── */}
      <AnimatePresence>
        {(status?.kospi || status?.ready) && status?.kospi && status?.kosdaq && (
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
                {([
                  { id: "kospi",  data: status.kospi!  },
                  { id: "kosdaq", data: status.kosdaq! },
                  ...(status.snp500  ? [{ id: "snp500",  data: status.snp500  }] : []),
                  ...(status.nasdaq  ? [{ id: "nasdaq",  data: status.nasdaq  }] : []),
                ] as { id: "kospi" | "kosdaq" | "snp500" | "nasdaq"; data: IndexResult }[]).map(({ id, data }) => {
                  const isActive = activeIdx === id;
                  const d1 = data.predictedReturn1d ?? +(data.predictedReturn3d / 3).toFixed(2);
                  const d2 = data.predictedReturn2d ?? +(data.predictedReturn3d * 2 / 3).toFixed(2);
                  const d3 = data.predictedReturn3d;
                  const up3 = d3 >= 0;
                  const tradingDates = data.predictions.slice(0, 3).map(p => p.date);
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveIdx(id)}
                      className={cn(
                        "flex-1 min-w-[130px] flex flex-col gap-2 px-4 py-4 rounded-2xl border transition-all text-left min-h-[100px]",
                        isActive
                          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                          : "border-border bg-card hover:bg-muted/30",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground">{data.name}</span>
                        {isActive && <span className="text-[10px] text-primary font-medium">선택됨</span>}
                      </div>
                      <div className="text-xl font-bold text-foreground">
                        {data.currentValue.toLocaleString()}
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        {([["D+1", d1, 0], ["D+2", d2, 1], ["D+3", d3, 2]] as [string, number, number][]).map(([label, val, i]) => (
                          <span key={label} className={cn("font-semibold", val >= 0 ? "text-red-400" : "text-blue-400")}>
                            <span className="text-muted-foreground/50 font-normal">{formatMD(tradingDates[i])} </span>{val >= 0 ? "+" : ""}{val}%
                          </span>
                        ))}
                      </div>
                      <div className={cn("flex items-center gap-1 text-[11px] font-medium text-muted-foreground/70")}>
                        {up3 ? <TrendingUp className="w-3 h-3 text-red-400" /> : <TrendingDown className="w-3 h-3 text-blue-400" />}
                        3일 후 {up3 ? "상승" : "하락"} 전망
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── 메인 차트 ────────────────────────────────────────────── */}
            {current && (
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-base font-bold text-foreground">
                      {current.name} — 최근 흐름과 AI 예측
                    </h2>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      실선 = 실제 흐름 · 점선 = D+3 예측 · 점(●) = 연속 예측 기록
                    </p>
                  </div>
                  <TrendBadge value={current.predictedReturn3d} />
                </div>
                <IndexChart
                  result={current}
                  predHistory={predHistory[{ kospi:"^KS11", kosdaq:"^KQ11", snp500:"^GSPC", nasdaq:"^IXIC" }[activeIdx] ?? "^KS11"] ?? []}
                />
              </div>
            )}

            {/* ── AI 적중률 카드 ────────────────────────────────────────── */}
            {current && (
              <div className="space-y-3">
                {/* ── 합의 신호 배너 ─────────────────────────────────────── */}
                {current.agreementSignal && current.agreementSignal !== "neutral" ? (
                  <div className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-3",
                    current.agreementSignal === "up"
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-red-500/40 bg-red-500/10",
                  )}>
                    <span className="text-2xl">{current.agreementSignal === "up" ? "🤝📈" : "🤝📉"}</span>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-bold", current.agreementSignal === "up" ? "text-emerald-400" : "text-red-400")}>
                        {current.agreementSignal === "up" ? "두 AI 모델 모두 상승 예측" : "두 AI 모델 모두 하락 예측"}
                        {current.agreementStrength != null && (
                          <span className="ml-2 text-xs font-normal opacity-70">
                            (합의 강도 {current.agreementStrength.toFixed(2)}%)
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        GBDT·LSTM이 같은 방향 → <span className="font-medium text-foreground">고신뢰 신호</span>.
                        역사적으로 합의 시 적중률이 단독 신호보다 높습니다.
                      </p>
                    </div>
                  </div>
                ) : current.agreementSignal === "neutral" ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-2.5">
                    <span className="text-xl">🤔</span>
                    <p className="text-xs text-muted-foreground">
                      두 AI 모델 방향 불일치 — <span className="font-medium text-foreground">저신뢰 구간</span>.
                      GBDT·LSTM이 서로 다른 방향을 가리켜 신호 신뢰도가 낮습니다.
                    </p>
                  </div>
                ) : null}

                <p className="text-xs text-muted-foreground/60 mb-1 font-medium flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" /> AI 예측 성능 — 이 정도로 믿을 수 있어요
                </p>
                {/* D+1 / D+2 / D+3 예측 */}
                <div className="rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 font-medium">
                    <span>🔮</span>
                    <span>AI 단기 예측 (D+1 · D+2 · D+3)</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {(() => {
                      const predDates = current.predictions.slice(0, 3).map(p => p.date);
                      return ([
                        { label: "D+1", date: predDates[0] ?? "", val: current.predictedReturn1d ?? +(current.predictedReturn3d / 3).toFixed(2) },
                        { label: "D+2", date: predDates[1] ?? "", val: current.predictedReturn2d ?? +(current.predictedReturn3d * 2 / 3).toFixed(2) },
                        { label: "D+3", date: predDates[2] ?? "", val: current.predictedReturn3d },
                      ]).map(({ label, date, val }) => (
                        <div key={label} className="flex flex-col items-center gap-0.5 py-2 rounded-xl bg-background/60 border border-border/60">
                          <span className="text-[10px] text-muted-foreground/60 font-medium">{label}</span>
                          <span className="text-[10px] text-muted-foreground/40 font-medium -mt-0.5">{formatMD(date)}</span>
                        <span className={cn(
                          "text-xl font-bold",
                          val >= 0 ? "text-red-400" : "text-blue-400",
                        )}>
                          {val >= 0 ? "+" : ""}{val}%
                        </span>
                        <span className={cn("text-[10px] font-semibold", val >= 0 ? "text-red-400/70" : "text-blue-400/70")}>
                          {val >= 0 ? "▲ 상승" : "▼ 하락"}
                        </span>
                      </div>
                      ));
                    })()}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
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
                    desc="50%면 동전 던지기 · 60%↑ 의미 있음"
                  />
                  <StatCard
                    emoji="📏"
                    label="평균 예측 오차"
                    value={`±${current.testMae}%`}
                    desc="정확한 숫자는 이만큼 차이날 수 있어요"
                  />
                </div>
              </div>
            )}

            {/* ── 라이브 적중률 (실제 기록) ────────────────────────────── */}
            {current && (() => {
              const symMap: Record<string, string> = { kospi:"^KS11", kosdaq:"^KQ11", snp500:"^GSPC", nasdaq:"^IXIC" };
              const la = liveAcc?.[symMap[activeIdx]];
              if (!la) return null;
              const hasData = la.total >= 5;
              const pctColor = la.accuracy === null ? "text-muted-foreground"
                : la.accuracy >= 60 ? "text-emerald-400"
                : la.accuracy >= 50 ? "text-yellow-400"
                : "text-red-400";
              return (
                <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" />
                    <h2 className="text-base font-bold text-foreground">실제 예측 성과 기록</h2>
                    <span className="text-[10px] text-muted-foreground/50 ml-auto">오늘부터 매일 기록됩니다</span>
                  </div>
                  {!hasData ? (
                    <div className="flex items-center gap-3 py-2">
                      <div className="w-2 h-2 rounded-full bg-yellow-400/60 animate-pulse" />
                      <p className="text-sm text-muted-foreground">
                        아직 데이터 수집 중 —{" "}
                        {la.pending > 0 ? `${la.pending}건 대기 중` : "오늘부터 예측을 기록하기 시작했어요"}.
                        {" "}5건 이상 쌓이면 실제 적중률이 표시됩니다.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1 px-4 py-3 rounded-xl border border-border bg-muted/20">
                          <span className="text-[11px] text-muted-foreground/70 font-medium">🎯 전체 적중률</span>
                          <span className={cn("text-2xl font-bold", pctColor)}>
                            {la.accuracy !== null ? `${la.accuracy}%` : "—"}
                          </span>
                          <span className="text-[11px] text-muted-foreground/55">실제 맞힌 비율</span>
                        </div>
                        <div className="flex flex-col gap-1 px-4 py-3 rounded-xl border border-border bg-muted/20">
                          <span className="text-[11px] text-muted-foreground/70 font-medium">📋 누적 기록</span>
                          <span className="text-2xl font-bold text-foreground">
                            {la.correct}/{la.total}
                          </span>
                          <span className="text-[11px] text-muted-foreground/55">맞힌 수 / 전체</span>
                        </div>
                        <div className="flex flex-col gap-1 px-4 py-3 rounded-xl border border-border bg-muted/20">
                          <span className="text-[11px] text-muted-foreground/70 font-medium">⏳ 결과 대기</span>
                          <span className="text-2xl font-bold text-foreground">{la.pending}</span>
                          <span className="text-[11px] text-muted-foreground/55">결과 확인 대기 중</span>
                        </div>
                      </div>
                      {la.byHorizon && (la.byHorizon["1"] || la.byHorizon["2"] || la.byHorizon["3"]) && (
                        <div className="space-y-1.5">
                          <p className="text-[11px] text-muted-foreground/55 font-medium">예측 구간별 적중률</p>
                          <div className="grid grid-cols-3 gap-2">
                            {([
                              { key: "1", label: "D+1 (내일)" },
                              { key: "2", label: "D+2 (모레)" },
                              { key: "3", label: "D+3 (3일 후)" },
                            ]).map(({ key, label }) => {
                              const h = la.byHorizon?.[key];
                              if (!h || h.total < 3) return (
                                <div key={key} className="flex flex-col items-center gap-0.5 py-2 rounded-lg border border-border/50 bg-muted/10">
                                  <span className="text-[10px] text-muted-foreground/50">{label}</span>
                                  <span className="text-sm font-bold text-muted-foreground/40">—</span>
                                </div>
                              );
                              const acc = h.accuracy;
                              const color = acc === null ? "text-muted-foreground"
                                : acc >= 60 ? "text-emerald-400"
                                : acc >= 50 ? "text-yellow-400"
                                : "text-red-400";
                              return (
                                <div key={key} className="flex flex-col items-center gap-0.5 py-2 rounded-lg border border-border/50 bg-muted/10">
                                  <span className="text-[10px] text-muted-foreground/55 font-medium">{label}</span>
                                  <span className={cn("text-base font-bold", color)}>
                                    {acc !== null ? `${acc}%` : "—"}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground/40">{h.correct}/{h.total}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── 예측 vs 실제 비교 ─────────────────────────────────────── */}
            {current && current.recentPerf && current.recentPerf.length > 0 && (
              <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    AI가 실제로 얼마나 맞혔나요?
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    막대 = 실제 등락 (빨강=오름·파랑=내림) · 보라 선 = AI가 예측한 방향 · 터치하면 상세 정보가 나와요
                  </p>
                </div>
                <ReturnComparisonChart
                  data={current.recentPerf}
                  symbol={current.symbol}
                  predDates={current.predictions.slice(0, 3).map(p => p.date)}
                  future={{
                    d1: current.predictedReturn1d ?? +(current.predictedReturn3d / 3).toFixed(2),
                    d2: current.predictedReturn2d ?? +(current.predictedReturn3d * 2 / 3).toFixed(2),
                    d3: current.predictedReturn3d,
                  }}
                />
              </div>
            )}

            {/* ── 이 화면 보는 법 (토글) ───────────────────────────────────── */}
            <div className="rounded-2xl border border-border bg-transparent overflow-hidden">
              <button
                onClick={() => setGuideOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors min-h-[48px]"
              >
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary/50" />
                  <span className="text-sm font-semibold text-muted-foreground/60">이 화면 보는 법</span>
                </div>
                <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/30 transition-transform", guideOpen && "rotate-180")} />
              </button>

              {guideOpen && (
              <div className="px-4 pb-5 pt-2 space-y-6 border-t border-border">

                {/* 1. AI 예측 숫자 */}
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">🔮</span> "D+1 +0.3% / D+2 +0.5% / D+3 +0.8%" 이게 무슨 말이에요?
                  </p>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    AI가 <span className="font-medium text-foreground">내일(D+1)·모레(D+2)·3거래일 후(D+3)</span>로 나눠 지수가 지금보다 몇 % 움직일지 예측한 값입니다.
                    <span className="text-red-400 font-medium"> 빨간색 숫자</span>는 오를 것 같다, <span className="text-blue-400 font-medium">파란색은 내릴 것 같다</span>는 뜻이에요.
                    정확한 숫자보다 <span className="font-medium text-foreground">방향(오를지 내릴지)</span>을 참고하는 데 쓰세요.
                    D+3 예측이 기준 예측이며, D+1·D+2는 그 선행 신호입니다.
                  </p>
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

                {/* 6. 방법론 */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <span className="text-base">🤖</span> 어떤 모델을 쓰고, 어떻게 작동하나요?
                  </p>

                  {/* LSTM */}
                  <div className="bg-muted/30 rounded-xl px-4 py-4 space-y-2">
                    <p className="text-xs font-bold text-primary tracking-wide">① LSTM — 시계열 패턴 학습</p>
                    <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                      <span className="font-semibold text-foreground">Long Short-Term Memory</span>는 순환신경망(RNN)의 한 종류로,
                      데이터의 <span className="font-semibold text-foreground">순서와 흐름</span>을 이해하도록 설계된 딥러닝 모델입니다.
                      일반 신경망과 달리 "이전에 어떤 일이 있었는지"를 내부 메모리에 누적하면서 학습하기 때문에
                      주가처럼 시간 순서가 중요한 데이터에 강점이 있습니다.
                    </p>
                    <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                      여기서는 <span className="font-semibold text-foreground">직전 20거래일(약 한 달)의 지수 흐름</span>을
                      입력으로 받아 3일 후의 수익률 방향을 예측합니다.
                      LSTM 내부의 forget gate·input gate·output gate가 어떤 과거 정보를 기억하고 버릴지를 스스로 결정합니다.
                    </p>
                    {current && (
                      <p className="text-[11px] text-primary/80 font-medium">
                        현재 방향 적중률: {current.lstmDirAcc}%
                      </p>
                    )}
                  </div>

                  {/* GBDT */}
                  <div className="bg-muted/30 rounded-xl px-4 py-4 space-y-2">
                    <p className="text-xs font-bold text-purple-400 tracking-wide">② GBDT — 15개 피처 기반 규칙 학습</p>
                    <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                      <span className="font-semibold text-foreground">Gradient Boosted Decision Trees</span>는
                      수백 개의 결정 트리를 순차적으로 쌓아올리는 앙상블 모델입니다.
                      앞 트리가 틀린 오차를 다음 트리가 보정하는 방식으로 점진적으로 정확도를 높입니다.
                      XGBoost·LightGBM 계열과 같은 원리입니다.
                    </p>
                    <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                      입력 피처는 총 <span className="font-semibold text-foreground">15개</span>입니다:
                    </p>
                    <div className="grid grid-cols-1 gap-1 text-[11px]">
                      {[
                        { label: "기술적 지표 9개", desc: "수익률·변동성·RSI·MACD·볼린저밴드·거래량 변화율 등" },
                        { label: "글로벌 거시 3개", desc: "S&P 500 수익률 · 달러/원 환율(USD/KRW) · 미국 기준금리(Fed Funds Rate)" },
                        { label: "수급 3개", desc: "외국인 순매수 · 기관 순매수 · 공매도 비율 (데이터 공백 시 전일값 forward-fill)" },
                      ].map(f => (
                        <div key={f.label} className="flex gap-2 items-start">
                          <span className="text-purple-400/80 font-semibold shrink-0">·</span>
                          <p className="text-muted-foreground/70 leading-relaxed">
                            <span className="font-semibold text-foreground">{f.label}</span> — {f.desc}
                          </p>
                        </div>
                      ))}
                    </div>
                    {current && (
                      <p className="text-[11px] text-purple-400/80 font-medium">
                        현재 방향 적중률: {current.gbdtDirAcc}%
                      </p>
                    )}
                  </div>

                  {/* 앙상블 */}
                  <div className="bg-muted/30 rounded-xl px-4 py-4 space-y-2">
                    <p className="text-xs font-bold text-emerald-400 tracking-wide">③ 동적 앙상블 — 성능 기반 가중치 합산</p>
                    <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                      두 모델의 예측값을 단순 평균하지 않고,
                      <span className="font-semibold text-foreground"> 최근 30거래일의 방향 적중률</span>을 실시간으로 계산해
                      더 잘 맞힌 모델에 더 높은 가중치(α)를 부여합니다.
                    </p>
                    <div className="bg-black/10 dark:bg-black/20 rounded-lg px-3 py-2 font-mono text-[11px] text-emerald-700 dark:text-emerald-400/80">
                      최종 예측 = α × LSTM + (1 − α) × GBDT
                    </div>
                    {current ? (
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                        현재 α = <span className="font-semibold text-foreground">{current.ensembleAlpha.toFixed(3)}</span>으로,
                        LSTM {(current.ensembleAlpha * 100).toFixed(0)}% + GBDT {((1 - current.ensembleAlpha) * 100).toFixed(0)}% 비율로 합산되고 있습니다.
                        이 값은 매번 분석 실행 시 자동으로 재계산됩니다.
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                        α 값은 매번 분석 실행 시 최근 성능을 기반으로 자동 재계산됩니다.
                      </p>
                    )}
                  </div>

                  {/* Walk-Forward */}
                  <div className="bg-muted/30 rounded-xl px-4 py-4 space-y-2">
                    <p className="text-xs font-bold text-amber-400 tracking-wide">④ Walk-Forward 검증 — 미래 데이터 없이 테스트</p>
                    <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                      일반적인 백테스트는 미래 데이터를 훈련에 포함할 위험이 있어 실제보다 성능이 과대평가됩니다.
                      이를 막기 위해 <span className="font-semibold text-foreground">Walk-Forward Validation</span>을 사용합니다.
                    </p>
                    <p className="text-[11px] text-muted-foreground/75 leading-relaxed">
                      과거 데이터를 시간 순서대로 슬라이딩 윈도우로 분할해,
                      훈련 구간 이후의 데이터만을 테스트에 씁니다.
                      이 과정을 여러 구간에 걸쳐 반복해 얻은 평균 정확도가
                      화면에 표시되는 <span className="font-semibold text-foreground">전체 검증 적중률(wfDirAcc)</span>입니다.
                      실전과 가장 가까운 방식으로 평가한 수치입니다.
                    </p>
                    {current && (
                      <p className="text-[11px] text-amber-400/80 font-medium">
                        Walk-Forward 적중률: {current.wfDirAcc}% · 테스트셋 적중률: {current.testDirAcc}%
                      </p>
                    )}
                  </div>

                  {/* 종합 성능 */}
                  {current && (
                    <div className="pt-1 grid grid-cols-4 gap-2 text-center text-[11px]">
                      {[
                        { label: "LSTM", val: `${current.lstmDirAcc}%`, color: "text-primary" },
                        { label: "GBDT", val: `${current.gbdtDirAcc}%`, color: "text-purple-500 dark:text-purple-400" },
                        { label: "앙상블", val: `${current.rolling30dDirAcc}%`, color: "text-emerald-600 dark:text-emerald-400" },
                        { label: "MAE", val: `${current.testMae}%`, color: "text-amber-600 dark:text-amber-400" },
                      ].map(s => (
                        <div key={s.label} className="bg-muted/30 rounded-lg py-2">
                          <p className="text-muted-foreground/50 mb-0.5">{s.label}</p>
                          <p className={cn("font-bold", s.color)}>{s.val}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 면책 */}
                <p className="text-[10px] text-muted-foreground/40 border-t border-border pt-4 leading-relaxed">
                  ※ 이 예측은 AI의 통계적 분석이며, 투자를 권유하는 것이 아닙니다.
                  실제 시장은 AI가 반영하지 못하는 갑작스러운 뉴스·정책·글로벌 이슈에 크게 영향받을 수 있습니다.
                  투자 결정은 반드시 전문가와 상담하시거나 본인이 직접 판단하세요.
                </p>
              </div>
              )}
            </div>

            {/* ── 기술 정보 (개발자용, 접어두기) ──────────────────────── */}
            <div className="rounded-2xl border border-border bg-transparent overflow-hidden">
              <button
                onClick={() => setTechOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-muted/30 transition-colors min-h-[48px]"
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
                <div className="px-4 pb-4 border-t border-border pt-3 space-y-2">
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

      {/* 면책 고지 */}
      <div className="max-w-2xl mx-auto px-4 pb-4">
        <div className="flex items-start gap-2.5 rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground/50" />
          <p className="text-[11px] leading-relaxed text-muted-foreground/50">
            본 페이지의 시장 예측 수치(3일 예상 수익률, 방향성 등)는 LSTM·GBDT 앙상블 모델이 산출한{" "}
            <strong className="font-medium text-muted-foreground/60">참고용 예측치</strong>이며,
            실제 시장 결과와 다를 수 있습니다. 투자 결정의 유일한 근거로 사용하지 마시고,
            전문 금융 자문과 함께 활용하시기 바랍니다.
            애빛다는 본 예측 정보에 기반한 투자 손실에 대해 책임을 지지 않습니다.
          </p>
        </div>
      </div>

      {/* 모델 버전 정보 */}
      <div className="max-w-2xl mx-auto px-4 pb-10">
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {status?.modelVersion && (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/35 font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />
              Model v{status.modelVersion}
            </span>
          )}
          {status?.trainedAt && (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/35 font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />
              학습 완료 {new Date(status.trainedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {status?.trainingMs && status.trainingMs > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/35 font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />
              {(status.trainingMs / 1000).toFixed(0)}s
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground/35 font-mono">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />
            LSTM + GBDT Ensemble
          </span>
        </div>
      </div>
    </div>
  );
}
