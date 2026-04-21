import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";

import {
  BarChart3, Target, Loader2, AlertCircle,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface TickerStat {
  ticker: string;
  companyName: string;
  count: number;
}

interface PopularData {
  items: any[];
  tickerStats: TickerStat[];
}

interface PublicStats {
  totalAnalyses: number;
  reviewedCount: number;
  hitTargetCount: number;
  hitStopCount: number;
  ongoingCount: number;
  winRate: number | null;
  avgReturn: number | null;
  byIndustry: Record<string, { total: number; hitTarget: number; avgReturn: number | null }>;
  recentCases: {
    ticker: string;
    companyName: string;
    verdict: string;
    priceReturn: number | null;
    daysElapsed: number | null;
    outcome: string;
    analysisId: number | null;
  }[];
}

function usePopular() {
  return useQuery<PopularData>({
    queryKey: ["popular-stats"],
    queryFn: async () => {
      const res = await fetch(getApiUrl("/api/analysis/popular"));
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });
}

function usePublicStats() {
  return useQuery<PublicStats>({
    queryKey: ["public-model-stats"],
    queryFn: async () => {
      const res = await fetch(getApiUrl("/api/model-insights/public-stats"));
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
  });
}

export default function Popular() {
  const { data: popular, isLoading: loadingPop } = usePopular();
  const { data: stats, isLoading: loadingSt } = usePublicStats();

  const isLoading = loadingPop || loadingSt;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">AI 통계</h1>
          <p className="text-[12px] text-muted-foreground">애빛다 AI 분석 누적 데이터 · 전체 공개</p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">통계를 불러오는 중...</span>
        </div>
      )}

      {!isLoading && (
        <>
          {/* ── 핵심 지표 4개 ── */}
          {stats && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 gap-3"
            >
              {[
                {
                  label: "누적 분석",
                  value: `${stats.totalAnalyses}건`,
                  sub: "전체 기업 분석 수",
                  icon: BarChart3,
                  color: "text-primary",
                  bg: "bg-primary/10",
                },
                {
                  label: "주가 방향 적중률",
                  value: stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : "—",
                  sub: `${stats.reviewedCount}건 검증 기준`,
                  icon: Target,
                  color: stats.winRate != null && stats.winRate >= 60 ? "text-emerald-600" : "text-amber-500",
                  bg: stats.winRate != null && stats.winRate >= 60 ? "bg-emerald-50" : "bg-amber-50",
                },
              ].map((m, i) => (
                <motion.div
                  key={m.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="rounded-xl border border-border bg-background p-4"
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center mb-3", m.bg)}>
                    <m.icon className={cn("w-4 h-4", m.color)} />
                  </div>
                  <p className={cn("text-[22px] font-black leading-none tabular-nums mb-1", m.color)}>{m.value}</p>
                  <p className="text-[11px] font-semibold text-foreground/80 mb-0.5">{m.label}</p>
                  <p className="text-[10px] text-muted-foreground/60">{m.sub}</p>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* ── 많이 분석된 종목 ── */}
          {popular?.tickerStats && popular.tickerStats.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-xl border border-border bg-background p-5"
            >
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">많이 분석된 종목</p>
              <div className="space-y-2.5">
                {popular.tickerStats.map((t, i) => {
                  const maxCount = popular.tickerStats[0].count;
                  const pct = (t.count / maxCount) * 100;
                  return (
                    <motion.div
                      key={t.ticker}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.05 }}
                      className="flex items-center gap-3"
                    >
                      <span className="w-5 text-[11px] font-bold text-muted-foreground/40 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] font-semibold text-foreground truncate">{t.companyName}</span>
                          <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{t.ticker}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-primary/60"
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ delay: 0.2 + i * 0.05, duration: 0.5, ease: "easeOut" }}
                          />
                        </div>
                      </div>
                      <span className="text-[12px] font-bold tabular-nums text-muted-foreground shrink-0">{t.count}건</span>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* 데이터 없을 때 */}
          {stats && stats.totalAnalyses === 0 && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
              <AlertCircle className="w-8 h-8 opacity-30" />
              <p className="text-sm">아직 누적된 분석 데이터가 없습니다.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
