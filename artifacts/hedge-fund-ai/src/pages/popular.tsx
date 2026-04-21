import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  BarChart3, Target, Loader2, AlertCircle, Globe,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface TickerStat {
  ticker: string;
  companyName: string;
  count: number;
}

interface VerdictStat {
  verdict: string;
  count: number;
}

interface MarketStat {
  market: string;
  count: number;
}

interface PopularData {
  items: any[];
  tickerStats: TickerStat[];
  verdictStats: VerdictStat[];
  marketStats: MarketStat[];
}

interface PublicStats {
  totalAnalyses: number;
  reviewedCount: number;
  winRate: number | null;
  byIndustry: Record<string, { total: number; hitTarget: number; avgReturn: number | null }>;
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

const VERDICT_KO: Record<string, string> = {
  "Strong Buy": "강력 매수",
  "Buy": "매수",
  "Hold": "보유",
  "Sell": "매도",
  "Strong Sell": "강력 매도",
};

const VERDICT_COLOR: Record<string, string> = {
  "Strong Buy": "bg-red-500",
  "Buy": "bg-red-300",
  "Hold": "bg-amber-400",
  "Sell": "bg-blue-300",
  "Strong Sell": "bg-blue-500",
};

const VERDICT_TEXT: Record<string, string> = {
  "Strong Buy": "text-red-600",
  "Buy": "text-red-400",
  "Hold": "text-amber-500",
  "Sell": "text-blue-400",
  "Strong Sell": "text-blue-600",
};

export default function Popular() {
  const { data: popular, isLoading: loadingPop } = usePopular();
  const { data: stats, isLoading: loadingSt } = usePublicStats();

  const isLoading = loadingPop || loadingSt;

  const totalForMarket = popular?.marketStats?.reduce((s, m) => s + m.count, 0) ?? 0;
  const totalAnalyses = popular?.verdictStats?.reduce((s, v) => s + v.count, 0) ?? 0;
  const maxVerdictCount = popular?.verdictStats?.[0]?.count ?? 1;

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
          {/* ── 핵심 지표 2개 ── */}
          {stats && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 gap-3"
            >
              {[
                {
                  label: "누적 분석",
                  value: `${totalAnalyses}건`,
                  sub: "전체 기업 분석 수",
                  icon: BarChart3,
                  color: "text-primary",
                  bg: "bg-primary/10",
                },
                {
                  label: "주가 방향 정확도",
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

          {/* ── 투자 의견 분포 ── */}
          {popular?.verdictStats && popular.verdictStats.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="rounded-xl border border-border bg-background p-5"
            >
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">투자 의견 분포</p>

              {/* 스택 바 */}
              <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-px">
                {popular.verdictStats.map((v) => (
                  <motion.div
                    key={v.verdict}
                    className={cn("h-full", VERDICT_COLOR[v.verdict] ?? "bg-muted")}
                    style={{ width: `${(v.count / totalAnalyses) * 100}%` }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: 0.1, duration: 0.6, ease: "easeOut" }}
                  />
                ))}
              </div>

              {/* 레전드 */}
              <div className="space-y-2">
                {popular.verdictStats.map((v, i) => {
                  const pct = ((v.count / totalAnalyses) * 100).toFixed(1);
                  return (
                    <motion.div
                      key={v.verdict}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.05 }}
                      className="flex items-center gap-2.5"
                    >
                      <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", VERDICT_COLOR[v.verdict] ?? "bg-muted")} />
                      <span className={cn("text-[12px] font-semibold w-16 shrink-0", VERDICT_TEXT[v.verdict] ?? "text-foreground")}>
                        {VERDICT_KO[v.verdict] ?? v.verdict}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <motion.div
                          className={cn("h-full rounded-full", VERDICT_COLOR[v.verdict] ?? "bg-muted")}
                          initial={{ width: 0 }}
                          animate={{ width: `${(v.count / maxVerdictCount) * 100}%` }}
                          transition={{ delay: 0.2 + i * 0.05, duration: 0.5 }}
                        />
                      </div>
                      <span className="text-[12px] tabular-nums text-muted-foreground shrink-0 w-10 text-right">{v.count}건</span>
                      <span className="text-[11px] text-muted-foreground/50 shrink-0 w-10 text-right">{pct}%</span>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ── 시장별 커버리지 ── */}
          {popular?.marketStats && popular.marketStats.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 }}
              className="rounded-xl border border-border bg-background p-5"
            >
              <div className="flex items-center gap-2 mb-4">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">시장별 커버리지</p>
              </div>

              {/* 스택 바 */}
              <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-px">
                {popular.marketStats.map((m) => (
                  <motion.div
                    key={m.market}
                    className={m.market === "한국" ? "h-full bg-blue-500" : "h-full bg-red-400"}
                    style={{ width: `${(m.count / totalForMarket) * 100}%` }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ delay: 0.15, duration: 0.6, ease: "easeOut" }}
                  />
                ))}
              </div>

              <div className="flex gap-4">
                {popular.marketStats.map((m, i) => (
                  <motion.div
                    key={m.market}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.05 }}
                    className="flex items-center gap-2"
                  >
                    <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", m.market === "한국" ? "bg-blue-500" : "bg-red-400")} />
                    <span className="text-[12px] font-semibold text-foreground">{m.market}</span>
                    <span className="text-[12px] tabular-nums text-muted-foreground">{m.count}건</span>
                    <span className="text-[11px] text-muted-foreground/50">
                      ({((m.count / totalForMarket) * 100).toFixed(0)}%)
                    </span>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── 많이 분석된 종목 ── */}
          {popular?.tickerStats && popular.tickerStats.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
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
                      transition={{ delay: 0.25 + i * 0.04 }}
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
                            transition={{ delay: 0.3 + i * 0.04, duration: 0.5, ease: "easeOut" }}
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
          {popular && popular.tickerStats?.length === 0 && (
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
