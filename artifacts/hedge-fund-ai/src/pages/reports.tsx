import { useListAnalyses, useDeleteAnalysis } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Trash2,
  ChevronRight,
  BarChart2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion } from "framer-motion";

const STATUS_LABEL: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  completed: {
    label: "분석 완료",
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    icon: <BarChart2 className="w-3 h-3" />,
  },
  in_progress: {
    label: "분석 중",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  failed: {
    label: "오류",
    color: "text-red-500 bg-red-50 border-red-200",
    icon: <AlertCircle className="w-3 h-3" />,
  },
  pending: {
    label: "대기 중",
    color: "text-slate-500 bg-slate-50 border-slate-200",
    icon: <Clock className="w-3 h-3" />,
  },
};

function VerdictBadge({ verdict }: { verdict?: string | null }) {
  if (!verdict) return null;
  const v = verdict.toLowerCase();
  if (v.includes("매수") || v.includes("buy") || v.includes("강력매수")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
        <TrendingUp className="w-3 h-3" /> {verdict}
      </span>
    );
  }
  if (v.includes("매도") || v.includes("sell")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600 border border-red-200">
        <TrendingDown className="w-3 h-3" /> {verdict}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
      <Minus className="w-3 h-3" /> {verdict}
    </span>
  );
}

export default function Reports() {
  const [, setLocation] = useLocation();
  const { data: analyses, isLoading, error } = useListAnalyses();
  const { mutate: deleteAnalysis } = useDeleteAnalysis();

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("이 보고서를 삭제하시겠습니까?")) return;
    deleteAnalysis(id);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
            <FileText className="w-4 h-4 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">
            분석 보고서
          </h1>
        </div>
        <p className="text-sm text-muted-foreground pl-[42px]">
          AI가 분석한 기업 보고서 목록입니다
        </p>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">보고서를 불러오는 중...</span>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-24 gap-2 text-red-500">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm">보고서를 불러오지 못했습니다</span>
        </div>
      ) : !analyses || analyses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
            <FileText className="w-7 h-7 text-slate-400" />
          </div>
          <div className="space-y-1">
            <p className="font-semibold text-foreground">아직 분석 보고서가 없습니다</p>
            <p className="text-sm text-muted-foreground">AI 기업분석을 시작하면 보고서가 여기에 저장됩니다</p>
          </div>
          <button
            onClick={() => setLocation("/analysis/new")}
            className="mt-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            첫 번째 분석 시작하기
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex items-center justify-between text-sm text-muted-foreground pb-1">
            <span>총 <strong className="text-foreground">{analyses.length}건</strong>의 보고서</span>
            <span className="text-xs">
              {analyses.filter(a => a.status === "completed").length}건 완료 ·{" "}
              {analyses.filter(a => a.status === "in_progress").length}건 진행 중
            </span>
          </div>

          {analyses.map((analysis, i) => {
            const statusInfo = STATUS_LABEL[analysis.status] ?? STATUS_LABEL.pending;
            const completedSteps = analysis.steps?.filter((s: any) => s.content).length ?? 0;
            const totalSteps = 6;

            return (
              <motion.div
                key={analysis.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => setLocation(`/analysis/${analysis.id}`)}
                className={cn(
                  "group relative bg-white border border-border rounded-xl p-5 cursor-pointer",
                  "hover:border-indigo-300 hover:shadow-md transition-all duration-200"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: Company info */}
                  <div className="flex items-start gap-4 min-w-0">
                    {/* Icon */}
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mt-0.5">
                      <span className="text-xs font-mono font-bold text-indigo-600">
                        {analysis.ticker.slice(0, 3)}
                      </span>
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base text-foreground leading-tight">
                          {analysis.companyName}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground">
                          {analysis.ticker}
                        </span>
                        {analysis.industry && (
                          <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
                            {analysis.industry}
                          </span>
                        )}
                      </div>

                      {/* Verdict + Target Price */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <VerdictBadge verdict={analysis.investmentVerdict} />
                        {analysis.targetPrice && (
                          <span className="text-xs text-muted-foreground">
                            목표가{" "}
                            <strong className="text-foreground font-semibold">
                              {formatCurrency(analysis.targetPrice)}
                            </strong>
                          </span>
                        )}
                      </div>

                      {/* Progress bar for in_progress */}
                      {analysis.status === "in_progress" && (
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{completedSteps}/{totalSteps} 단계</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: status + date + actions */}
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                      statusInfo.color
                    )}>
                      {statusInfo.icon}
                      {statusInfo.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(analysis.createdAt), "yyyy.MM.dd HH:mm", { locale: ko })}
                    </span>
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        onClick={(e) => handleDelete(e, analysis.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        title="삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-indigo-500 transition-colors" />
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
