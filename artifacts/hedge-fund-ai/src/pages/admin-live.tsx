import { useEffect, useState, useCallback } from "react";
import { Loader2, RefreshCw, Activity, CheckCircle2, XCircle, Clock, User, ChevronRight } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLocation } from "wouter";
import { useLanguage } from "@/lib/language-context";

const VERDICT_STYLE: Record<string, string> = {
  "Strong Buy":  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "Buy":         "bg-green-100 text-green-700 border-green-200",
  "Hold":        "bg-amber-100 text-amber-700 border-amber-200",
  "Sell":        "bg-red-100 text-red-700 border-red-200",
  "Strong Sell": "bg-rose-100 text-rose-700 border-rose-200",
};

const STEPS_ORDER = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "relative_valuation",
  "market_analysis",
  "investment_strategy",
];

const STEP_LABELS_KO: Record<string, string> = {
  company_intro:       "기업 브리핑",
  industry_analysis:   "산업 분석",
  catalyst_analysis:   "촉매 분석",
  company_analysis:    "실적 분석",
  relative_valuation:  "적정주가 산출",
  market_analysis:     "기술적 분석",
  investment_strategy: "최종 결론",
};
const STEP_LABELS_EN: Record<string, string> = {
  company_intro:       "Company Overview",
  industry_analysis:   "Industry Analysis",
  catalyst_analysis:   "Catalyst Analysis",
  company_analysis:    "Financial Analysis",
  relative_valuation:  "Valuation",
  market_analysis:     "Technical Analysis",
  investment_strategy: "Final Verdict",
};
function getStepLabel(step: string, isEn: boolean) {
  return (isEn ? STEP_LABELS_EN : STEP_LABELS_KO)[step] ?? step;
}

interface AnalysisRow {
  id: string;
  ticker: string;
  companyName: string;
  currentStep: string | null;
  currentStepLabel: string | null;
  stepsTotal: number;
  investmentVerdict: string | null;
  targetPrice: number | null;
  createdAt: string;
  updatedAt: string;
  user: string;
}

interface LiveData {
  inProgress: AnalysisRow[];
  recentDone: AnalysisRow[];
  recentFailed: AnalysisRow[];
}

function elapsed(iso: string, isEn: boolean) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return isEn ? `${s}s` : `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return isEn ? `${m}m ${s % 60}s` : `${m}분 ${s % 60}초`;
  return isEn ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

function elapsedShort(iso: string, isEn: boolean) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return isEn ? "just now" : "방금";
  if (m < 60) return isEn ? `${m}m ago` : `${m}분 전`;
  return isEn ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 60)}시간 전`;
}

function StepBar({ currentStep }: { currentStep: string | null }) {
  const { isEn } = useLanguage();
  const currentIdx = currentStep ? STEPS_ORDER.indexOf(currentStep) : -1;
  return (
    <div className="flex items-center gap-0.5 mt-2">
      {STEPS_ORDER.map((step, idx) => {
        const done = idx < currentIdx;
        const active = idx === currentIdx;
        return (
          <div key={step} className="group relative flex-1">
            <div
              className={cn(
                "h-1.5 rounded-full transition-all",
                done   ? "bg-blue-500" :
                active ? "bg-blue-400 animate-pulse" :
                         "bg-slate-200"
              )}
            />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] bg-slate-800 text-white rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 pointer-events-none z-10">
              {getStepLabel(step, isEn)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InProgressCard({ row, now }: { row: AnalysisRow; now: number }) {
  const [, navigate] = useLocation();
  const { isEn } = useLanguage();
  const t = (ko: string, en: string) => isEn ? en : ko;
  const currentIdx = row.currentStep ? STEPS_ORDER.indexOf(row.currentStep) : -1;
  const progress = currentIdx >= 0 ? Math.round(((currentIdx + 1) / STEPS_ORDER.length) * 100) : 0;
  const elapsedSec = Math.floor((now - new Date(row.createdAt).getTime()) / 1000);
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");

  return (
    <div
      className="bg-white border border-slate-200 rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => navigate(`/analysis/${row.id}`)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
              </span>
              {t("분석 중", "Analyzing")}
            </span>
            <span className="text-xs text-slate-400 font-mono">{mm}:{ss}</span>
          </div>
          <p className="mt-1 font-semibold text-slate-900 truncate">{row.companyName}</p>
          <p className="text-xs text-slate-500">{row.ticker}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-semibold text-blue-600">{progress}%</div>
          <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
            <User className="h-3 w-3" />
            <span className="max-w-[80px] truncate">{row.user}</span>
          </div>
        </div>
      </div>
      <StepBar currentStep={row.currentStep} />
      <p className="mt-1.5 text-xs text-slate-500">
        {row.currentStepLabel ? `${t("현재 단계:", "Step:")} ${row.currentStepLabel}` : t("준비 중...", "Preparing...")}
      </p>
    </div>
  );
}

function DoneCard({ row }: { row: AnalysisRow }) {
  const [, navigate] = useLocation();
  const { isEn } = useLanguage();
  const verdictStyle = VERDICT_STYLE[row.investmentVerdict ?? ""] ?? "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div
      className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3 cursor-pointer hover:shadow-sm transition-shadow"
      onClick={() => navigate(`/analysis/${row.id}`)}
    >
      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-slate-900 truncate">{row.companyName}</span>
          <span className="text-xs text-slate-400">{row.ticker}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <User className="h-3 w-3 text-slate-400" />
          <span className="text-xs text-slate-400 truncate">{row.user}</span>
          <span className="text-slate-300 mx-1">·</span>
          <Clock className="h-3 w-3 text-slate-400" />
          <span className="text-xs text-slate-400">{elapsedShort(row.updatedAt, isEn)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {row.investmentVerdict && (
          <span className={cn("text-xs font-semibold border rounded-full px-2 py-0.5", verdictStyle)}>
            {row.investmentVerdict}
          </span>
        )}
        {row.targetPrice && (
          <span className="text-xs text-slate-500">
            {isEn ? `$${row.targetPrice.toLocaleString()}` : `${row.targetPrice.toLocaleString()}원`}
          </span>
        )}
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
      </div>
    </div>
  );
}

function FailedCard({ row }: { row: AnalysisRow }) {
  const [, navigate] = useLocation();
  const { isEn } = useLanguage();
  return (
    <div
      className="flex items-center gap-3 bg-white border border-red-100 rounded-lg px-4 py-3 cursor-pointer hover:shadow-sm transition-shadow"
      onClick={() => navigate(`/analysis/${row.id}`)}
    >
      <XCircle className="h-4 w-4 text-red-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-slate-900 truncate">{row.companyName}</span>
          <span className="text-xs text-slate-400">{row.ticker}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <User className="h-3 w-3 text-slate-400" />
          <span className="text-xs text-slate-400 truncate">{row.user}</span>
          <span className="text-slate-300 mx-1">·</span>
          <Clock className="h-3 w-3 text-slate-400" />
          <span className="text-xs text-slate-400">{elapsedShort(row.updatedAt, isEn)}</span>
        </div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
    </div>
  );
}

export default function AdminLive() {
  const { isEn } = useLanguage();
  const t = (ko: string, en: string) => isEn ? en : ko;
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch(getApiUrl("api/analysis/admin-live"), { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? `Error ${r.status}`);
        return;
      }
      const j = await r.json();
      setData(j);
      setError(null);
      setLastFetch(new Date());
    } catch {
      setError(t("네트워크 오류", "Network error"));
    } finally {
      setLoading(false);
    }
  }, [isEn]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const id = setInterval(fetchData, 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-500 text-sm">{error}</div>
    );
  }

  const inProgress = data?.inProgress ?? [];
  const recentDone = data?.recentDone ?? [];
  const recentFailed = data?.recentFailed ?? [];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Activity className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{t("실시간 분석 현황", "Live Analysis Monitor")}</h1>
            {lastFetch && (
              <p className="text-xs text-slate-400 mt-0.5">
                {t("마지막 갱신:", "Last update:")} {lastFetch.toLocaleTimeString(isEn ? "en-US" : "ko-KR")} · {t("5초마다 자동 새로고침", "Auto-refresh every 5s")}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t("새로고침", "Refresh")}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{inProgress.length}</div>
          <div className="text-xs text-blue-500 mt-1">{t("진행 중", "In Progress")}</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-emerald-600">{recentDone.length}</div>
          <div className="text-xs text-emerald-500 mt-1">{t("최근 1시간 완료", "Completed (1h)")}</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-red-500">{recentFailed.length}</div>
          <div className="text-xs text-red-400 mt-1">{t("최근 1시간 오류", "Errors (1h)")}</div>
        </div>
      </div>

      {/* In Progress */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
          </span>
          {t("진행 중", "In Progress")} ({inProgress.length})
        </h2>
        {inProgress.length === 0 ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-center text-sm text-slate-400">
            {t("현재 진행 중인 분석이 없습니다", "No analyses in progress")}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {inProgress.map(row => (
              <InProgressCard key={row.id} row={row} now={now} />
            ))}
          </div>
        )}
      </div>

      {/* Recently Completed */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          {t("최근 1시간 완료", "Completed (1h)")} ({recentDone.length})
        </h2>
        {recentDone.length === 0 ? (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-center text-sm text-slate-400">
            {t("최근 1시간 내 완료된 분석이 없습니다", "No analyses completed in the last hour")}
          </div>
        ) : (
          <div className="space-y-2">
            {recentDone.map(row => (
              <DoneCard key={row.id} row={row} />
            ))}
          </div>
        )}
      </div>

      {/* Errors */}
      {recentFailed.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-400" />
            {t("최근 1시간 오류", "Errors (1h)")} ({recentFailed.length})
          </h2>
          <div className="space-y-2">
            {recentFailed.map(row => (
              <FailedCard key={row.id} row={row} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
