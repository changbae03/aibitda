import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useListAnalyses, useListModelInsights, useStartAnalysis } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { 
  ArrowRight, 
  BrainCircuit, 
  Target, 
  TrendingUp, 
  Activity,
  BookOpen,
  ChevronRight,
  Search,
  Loader2,
  TrendingDown
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion } from "framer-motion";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: analyses, isLoading: loadingAnalyses } = useListAnalyses();
  const { data: insights } = useListModelInsights();
  const { mutateAsync: startAnalysis, isPending: isStarting } = useStartAnalysis();
  const [quickTicker, setQuickTicker] = useState("");

  const completedAnalyses = analyses?.filter(a => a.status === 'completed') || [];
  const inProgressAnalyses = analyses?.filter(a => a.status === 'in_progress') || [];
  
  const reviewedInsights = insights?.filter(i => i.outcome !== "pending") ?? [];
  const hitTarget = reviewedInsights.filter(i => i.outcome === "hit_target");
  const winRate = reviewedInsights.length > 0
    ? (hitTarget.length / reviewedInsights.length * 100).toFixed(1)
    : "0.0";

  const lessonsCount = insights?.filter(i => i.lesson).length ?? 0;

  const handleQuickAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = quickTicker.trim().toUpperCase();
    if (!t) return;
    const result = await startAnalysis({ data: { ticker: t } });
    setLocation(`/analysis/${result.id}`);
  };

  return (
    <div className="space-y-7">
      {/* Quick Search */}
      <form onSubmit={handleQuickAnalysis}>
        <div className="flex items-center gap-3 bg-white border-2 border-border rounded-2xl px-5 py-3 shadow-sm focus-within:border-primary focus-within:shadow-md focus-within:shadow-primary/10 transition-all">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={quickTicker}
            onChange={e => setQuickTicker(e.target.value.toUpperCase())}
            placeholder="종목코드를 입력하고 Enter  예) 005930, NVDA, 078160.KS"
            className="flex-1 bg-transparent outline-none border-none text-foreground text-base font-mono placeholder:font-sans placeholder:text-muted-foreground/60 placeholder:text-sm"
            disabled={isStarting}
          />
          <button
            type="submit"
            disabled={isStarting || !quickTicker.trim()}
            className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all disabled:opacity-50"
          >
            {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <><BrainCircuit className="w-4 h-4" /> 분석 시작</>}
          </button>
        </div>
      </form>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="진행중 분석" 
          value={inProgressAnalyses.length.toString()} 
          icon={Activity} 
          sub="현재 실행중"
          delay={0.05}
        />
        <StatCard 
          title="완료 리포트" 
          value={completedAnalyses.length.toString()} 
          icon={Target} 
          sub="누적 데이터베이스"
          delay={0.1}
        />
        <StatCard 
          title="추출 교훈" 
          value={lessonsCount.toString()} 
          icon={BookOpen} 
          sub="모델 학습 완료"
          delay={0.15}
        />
        <StatCard 
          title="AI 적중률" 
          value={`${winRate}%`} 
          icon={TrendingUp} 
          sub="목표가 달성 기준"
          highlight
          delay={0.2}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Analyses */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-foreground">최근 분석 내역</h2>
            <Link href="/analysis/new" className="text-xs text-primary hover:underline flex items-center gap-1">
              전체 보기 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {loadingAnalyses ? (
              <div className="p-8 text-center text-muted-foreground text-sm animate-pulse">불러오는 중...</div>
            ) : !analyses?.length ? (
              <div className="p-12 text-center">
                <BrainCircuit className="w-10 h-10 text-muted mx-auto mb-3" />
                <h3 className="text-base font-medium text-foreground mb-1">분석 내역 없음</h3>
                <p className="text-muted-foreground text-sm">AI 분석을 시작하면 결과가 여기에 표시됩니다.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {analyses.slice(0, 6).map((analysis, i) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i }}
                    key={analysis.id}
                  >
                    <Link 
                      href={`/analysis/${analysis.id}`}
                      className="flex items-center justify-between px-4 py-3.5 hover:bg-muted/40 transition-colors group cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center font-mono font-bold text-primary text-xs shrink-0">
                          {analysis.ticker.substring(0, 4)}
                        </div>
                        <div>
                          <h4 className="font-semibold text-foreground text-sm group-hover:text-primary transition-colors">
                            {analysis.companyName}
                          </h4>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span className="bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded text-[11px] font-mono">{analysis.ticker}</span>
                            <span>{format(new Date(analysis.createdAt), 'M월 d일', { locale: ko })}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {analysis.status === 'in_progress' ? (
                          <div className="flex items-center gap-1.5 text-warning text-xs font-medium">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-warning"></span>
                            </span>
                            분석중 ({analysis.steps.length}/{6})
                          </div>
                        ) : (
                          <div className="text-right">
                            <span className="text-xs font-medium text-success block">완료</span>
                            {analysis.targetPrice ? (
                              <span className="text-[11px] text-muted-foreground font-mono">
                                목표: {formatCurrency(analysis.targetPrice)}
                              </span>
                            ) : null}
                          </div>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* AI 모델 교훈 */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-display font-semibold text-foreground">AI 모델 교훈</h2>
            <Link href="/model-insights" className="text-xs text-primary hover:underline">
              전체 보기
            </Link>
          </div>

          <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 min-h-[200px]">
            {!insights || insights.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center py-10 text-center gap-2">
                <BookOpen className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  분석이 완료되면 AI가 자동으로<br />교훈을 추출합니다
                </p>
              </div>
            ) : (
              insights
                .filter(i => i.lesson)
                .slice(-4)
                .reverse()
                .map((insight, i) => (
                  <motion.div
                    key={insight.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06 * i }}
                    className="p-3 rounded-lg bg-indigo-50/60 border border-indigo-100"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-mono font-bold text-primary text-xs">{insight.ticker.replace(/\.(KS|KQ)$/, "")}</span>
                      <span className={cn(
                        "text-[11px] font-bold flex items-center gap-0.5",
                        (insight.priceReturn ?? 0) >= 0 ? "text-emerald-600" : "text-red-500"
                      )}>
                        {(insight.priceReturn ?? 0) >= 0
                          ? <TrendingUp className="w-3 h-3" />
                          : <TrendingDown className="w-3 h-3" />}
                        {(insight.priceReturn ?? 0) >= 0 ? "+" : ""}{insight.priceReturn?.toFixed(1) ?? "—"}%
                      </span>
                    </div>
                    <p className="text-xs text-foreground/75 leading-relaxed line-clamp-3">
                      {insight.lesson}
                    </p>
                  </motion.div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon: Icon, sub, highlight = false, delay }: {
  title: string;
  value: string;
  icon: any;
  sub: string;
  highlight?: boolean;
  delay: number;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={cn(
        "p-5 rounded-xl border",
        highlight 
          ? "bg-primary/5 border-primary/20" 
          : "bg-card border-border"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <div className={cn("p-1.5 rounded-md", highlight ? "bg-primary/10" : "bg-muted")}>
          <Icon className={cn("w-4 h-4", highlight ? "text-primary" : "text-muted-foreground")} />
        </div>
      </div>
      <div className={cn("text-2xl font-display font-bold mb-0.5", highlight ? "text-primary" : "text-foreground")}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </motion.div>
  );
}
