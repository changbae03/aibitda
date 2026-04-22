import { useListModelInsights, useTriggerInsightReview } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { BrainCircuit, RefreshCw, TrendingUp, TrendingDown, Minus, Loader2, BookOpen } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export default function ModelInsights() {
  const { data: insights, isLoading, refetch } = useListModelInsights();
  const { mutate: triggerReview, isPending: isReviewing } = useTriggerInsightReview();

  const handleReview = () => {
    triggerReview(undefined, {
      onSuccess: () => setTimeout(() => refetch(), 5000),
    });
  };

  const reviewed = insights?.filter((i) => i.outcome !== "pending") ?? [];
  const hitTarget = reviewed.filter((i) => i.outcome === "hit_target");
  const hitStop = reviewed.filter((i) => i.outcome === "hit_stoploss");
  const ongoing = reviewed.filter((i) => i.outcome === "ongoing");
  const winRate = reviewed.length > 0 ? ((hitTarget.length / reviewed.length) * 100).toFixed(1) : "—";
  const avgReturn =
    reviewed.length > 0
      ? (reviewed.reduce((s, i) => s + (i.priceReturn ?? 0), 0) / reviewed.length).toFixed(1)
      : null;

  const outcomeLabel = (o: string) => {
    if (o === "hit_target") return "목표 달성";
    if (o === "hit_stoploss") return "손절 발생";
    if (o === "ongoing") return "진행중";
    return "대기";
  };

  const outcomeStyle = (o: string) => {
    if (o === "hit_target") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (o === "hit_stoploss") return "bg-red-50 text-red-600 border-red-200";
    if (o === "ongoing") return "bg-blue-50 text-blue-600 border-blue-200";
    return "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">AI 모델 고도화</h1>
          <p className="text-sm text-muted-foreground mt-1">
            완료된 분석의 실제 주가 성과를 추적하고, 교훈을 다음 분석에 반영합니다
          </p>
        </div>
        <button
          onClick={handleReview}
          disabled={isReviewing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all disabled:opacity-50"
        >
          {isReviewing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 분석 중...</>
          ) : (
            <><RefreshCw className="w-4 h-4" /> 성과 업데이트</>
          )}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="분석 리뷰" value={reviewed.length.toString()} sub="총 성과 추적" color="text-primary" />
        <StatCard title="방향 일치율" value={`${winRate}%`} sub="예측 방향 일치" color="text-emerald-600" />
        <StatCard title="평균 수익률" value={avgReturn ? `${avgReturn}%` : "—"} sub="진입가 대비" color={Number(avgReturn) >= 0 ? "text-emerald-600" : "text-red-500"} />
        <StatCard title="교훈 추출" value={insights?.filter((i) => i.lesson).length.toString() ?? "0"} sub="모델 학습 완료" color="text-indigo-600" />
      </div>

      {isLoading ? (
        <div className="p-16 text-center">
          <Loader2 className="w-7 h-7 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">성과 데이터 로딩 중...</p>
        </div>
      ) : !insights || insights.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-2xl bg-muted/20">
          <BrainCircuit className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="text-base font-semibold text-foreground mb-2">아직 추적 중인 분석이 없습니다</h3>
          <p className="text-sm text-muted-foreground">
            AI 기업분석을 완료하면 자동으로 성과를 추적하고 교훈을 추출합니다
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {insights.map((insight, idx) => (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="bg-card border border-border rounded-xl overflow-hidden"
              >
                <div className="px-5 py-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/8 flex items-center justify-center shrink-0">
                      <span className="font-mono text-xs font-bold text-primary">{insight.ticker.replace(/\.(KS|KQ)$/, "")}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-foreground">{insight.companyName}</h3>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono mt-0.5">
                        <span>{insight.industry}</span>
                        {insight.analysisDate && (
                          <span>· {format(new Date(insight.analysisDate), "M월 d일", { locale: ko })}</span>
                        )}
                        {insight.daysElapsed != null && (
                          <span>· {insight.daysElapsed}일 경과</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {insight.verdict && (
                      <span className="text-xs font-semibold px-2 py-0.5 bg-primary/10 text-primary rounded border border-primary/20">
                        {insight.verdict}
                      </span>
                    )}
                    <span className={cn("text-xs font-semibold px-2 py-0.5 rounded border", outcomeStyle(insight.outcome))}>
                      {outcomeLabel(insight.outcome)}
                    </span>
                    {insight.priceReturn != null && (
                      <span className={cn(
                        "text-xs font-mono font-bold px-2 py-0.5 rounded border flex items-center gap-1",
                        insight.priceReturn >= 0
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-red-50 text-red-600 border-red-200"
                      )}>
                        {insight.priceReturn >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {insight.priceReturn >= 0 ? "+" : ""}{insight.priceReturn.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>

                <div className="px-5 pb-4 grid grid-cols-3 gap-3">
                  <PriceCell label="진입가" value={formatCurrency(insight.entryPrice)} />
                  <PriceCell label="목표가" value={formatCurrency(insight.targetPrice)} color="text-emerald-600" />
                  <PriceCell label="현재가" value={formatCurrency(insight.priceAtReview)} />
                </div>

                {insight.lesson && (
                  <div className="mx-5 mb-4 p-4 bg-indigo-50/60 border border-indigo-100 rounded-xl flex gap-3">
                    <BookOpen className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider mb-1">AI 교훈</div>
                      <p className="text-sm text-foreground/80 leading-relaxed">{insight.lesson}</p>
                    </div>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, sub, color }: { title: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-2">{title}</div>
      <div className={cn("text-2xl font-display font-bold mb-1", color)}>{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function PriceCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2 text-center">
      <div className="text-[11px] text-muted-foreground font-mono mb-0.5">{label}</div>
      <div className={cn("text-sm font-bold font-mono", color ?? "text-foreground")}>{value}</div>
    </div>
  );
}
