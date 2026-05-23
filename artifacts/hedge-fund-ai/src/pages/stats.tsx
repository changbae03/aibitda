import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { TrendingUp, TrendingDown, Target, BarChart3, Loader2, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import StockLogo from "@/components/ui/stock-logo";
import { motion } from "framer-motion";
import { useLanguage } from "@/lib/language-context";

type TopTicker = { ticker: string; companyName: string; count: number; winRate: number | null };

interface PublicStats {
  totalAnalyses: number;
  reviewedCount: number;
  hitTargetCount: number;
  hitStopCount: number;
  ongoingCount: number;
  winRate: number | null;
  avgReturn: number | null;
  byIndustry: Record<string, { total: number; hitTarget: number; avgReturn: number | null }>;
  topTickers: TopTicker[];
  topTickersByPeriod: { day: TopTicker[]; week: TopTicker[]; month: TopTicker[]; all: TopTicker[] };
  recentCases: {
    ticker: string;
    companyName: string;
    verdict: string | null;
    priceReturn: number | null;
    daysElapsed: number | null;
    outcome: string;
    analysisId: number | null;
  }[];
}

function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!target) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const progress = Math.min((Date.now() - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(target * eased));
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return val;
}

function StatCard({ label, value, sub, color, rawValue }: { label: string; value: string; sub?: string; color?: string; rawValue?: number }) {
  const animated = useCountUp(rawValue ?? 0);
  const displayValue = rawValue != null
    ? value.replace(/([\d.]+)/, () => {
        const formatted = Number.isInteger(rawValue) ? animated.toString() : animated.toFixed(1);
        return formatted;
      })
    : value;
  return (
    <motion.div
      className="bg-background border border-border rounded-2xl p-5 shadow-sm"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <p className="text-[12px] text-muted-foreground font-medium mb-1">{label}</p>
      <p className={cn("text-3xl font-black tracking-tight leading-none tabular-nums", color ?? "text-foreground")}>{displayValue}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>}
    </motion.div>
  );
}

export default function Stats() {
  const { isEn } = useLanguage();
  const t = (ko: string, en: string) => isEn ? en : ko;

  const [, setLocation] = useLocation();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [topPeriod, setTopPeriod] = useState<"day" | "week" | "month" | "all">("all");

  useEffect(() => {
    fetch(getApiUrl("api/model-insights/public-stats"))
      .then((r) => r.json())
      .then((d) => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-8 w-36 bg-muted rounded-lg" />
          <div className="h-6 w-20 bg-muted rounded-full" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="h-3 w-20 bg-muted rounded" />
              <div className="h-8 w-14 bg-muted rounded" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 w-24 bg-muted rounded" />
              <div className="flex-1 h-3 bg-muted/40 rounded-full" />
              <div className="h-3 w-10 bg-muted rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center py-32 text-muted-foreground text-sm">
        {t("데이터를 불러올 수 없습니다", "Could not load data")}
      </div>
    );
  }

  const winRateStr = stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : "—";
  const avgReturnStr = stats.avgReturn != null
    ? `${stats.avgReturn >= 0 ? "+" : ""}${stats.avgReturn.toFixed(1)}%`
    : "—";
  const winRateColor = stats.winRate != null
    ? stats.winRate >= 60 ? "text-emerald-600" : stats.winRate >= 40 ? "text-amber-600" : "text-red-500"
    : "text-muted-foreground";
  const avgReturnColor = stats.avgReturn != null
    ? stats.avgReturn > 0 ? "text-red-500" : stats.avgReturn < 0 ? "text-blue-500" : "text-foreground"
    : "text-muted-foreground";

  const topIndustries = Object.entries(stats.byIndustry)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6);

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div>
        <h1
          className="text-[22px] font-black tracking-tight text-foreground mb-1"
          style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif" }}
        >
          {t("AI 분석 정확도", "AI Analysis Accuracy")}
        </h1>
        <p className="text-[13px] text-muted-foreground">
          {t("애빛다 AI가 분석한 종목의 실제 주가 성과를 공개합니다", "Actual price performance of stocks analyzed by CBST AI")}
        </p>
      </div>

      {/* 핵심 지표 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={t("총 분석 수", "Total Analyses")}
          value={stats.totalAnalyses.toLocaleString()}
          sub={t("누적 AI 분석 보고서", "Cumulative AI reports")}
          rawValue={stats.totalAnalyses}
        />
        <StatCard
          label={t("목표가 달성률", "Target Hit Rate")}
          value={winRateStr}
          sub={`${stats.hitTargetCount}${t("건 달성", " hits")} / ${stats.reviewedCount}${t("건 검토", " reviewed")}`}
          color={winRateColor}
          rawValue={stats.winRate ?? undefined}
        />
        <StatCard
          label={t("평균 수익률", "Avg Return")}
          value={avgReturnStr}
          sub={t("진입가 기준 평균", "Avg from entry price")}
          color={avgReturnColor}
          rawValue={stats.avgReturn != null ? Math.abs(stats.avgReturn) : undefined}
        />
        <StatCard
          label={t("추적 중", "Tracking")}
          value={stats.ongoingCount.toLocaleString()}
          sub={t("현재 진행중인 포지션", "Active positions")}
          color="text-blue-600"
          rawValue={stats.ongoingCount}
        />
      </div>

      {/* 많이 분석된 종목 */}
      {stats.topTickers.length > 0 && (() => {
        const PERIODS = [
          { key: "day"   as const, ko: "일간",  en: "Today"   },
          { key: "week"  as const, ko: "주간",  en: "Weekly"  },
          { key: "month" as const, ko: "월간",  en: "Monthly" },
          { key: "all"   as const, ko: "전체",  en: "All"     },
        ];
        const tickers = (stats.topTickersByPeriod?.[topPeriod] ?? stats.topTickers);
        const maxCount = tickers[0]?.count ?? 1;
        const MEDAL = ["🥇", "🥈", "🥉"];
        const TOP3_BG = [
          "from-amber-500/10 to-amber-500/5 border-amber-500/20",
          "from-neutral-400/10 to-neutral-400/5 border-neutral-400/20",
          "from-orange-700/10 to-orange-700/5 border-orange-700/20",
        ];
        return (
          <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
            {/* 헤더 + 기간 탭 */}
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-[14px] font-bold text-foreground/90">
                {t("많이 분석된 종목", "Most Analyzed")}
              </h2>
              <div className="flex items-center gap-1 bg-muted/60 rounded-xl p-0.5">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setTopPeriod(p.key)}
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all",
                      topPeriod === p.key
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isEn ? p.en : p.ko}
                  </button>
                ))}
              </div>
            </div>

            {tickers.length === 0 ? (
              <div className="py-8 text-center text-[13px] text-muted-foreground">
                {t("해당 기간에 분석된 종목이 없습니다", "No analyses in this period")}
              </div>
            ) : (
              <>
                {/* Top 3 카드 */}
                {tickers.length >= 3 && (
                  <div className="grid grid-cols-3 gap-2 mb-5">
                    {tickers.slice(0, 3).map((tk, idx) => (
                      <motion.div
                        key={`${topPeriod}-${tk.ticker}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.06 }}
                        className={cn(
                          "relative rounded-2xl border bg-gradient-to-b p-3 flex flex-col items-center gap-2 text-center overflow-hidden",
                          TOP3_BG[idx]
                        )}
                      >
                        <span className="text-[18px] leading-none">{MEDAL[idx]}</span>
                        <StockLogo ticker={tk.ticker} companyName={tk.companyName} size="md" />
                        <div className="w-full min-w-0">
                          <p className="text-[11px] font-bold text-foreground truncate">{tk.companyName}</p>
                          <p className="text-[10px] text-muted-foreground font-mono">{tk.ticker}</p>
                        </div>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[15px] font-black text-foreground tabular-nums leading-none">
                            {tk.count}<span className="text-[10px] font-semibold text-muted-foreground ml-0.5">{t("회", "x")}</span>
                          </span>
                          {tk.winRate != null && (
                            <span className={cn(
                              "text-[10px] font-semibold tabular-nums",
                              tk.winRate >= 60 ? "text-emerald-600 dark:text-emerald-500" : tk.winRate >= 40 ? "text-amber-600 dark:text-amber-500" : "text-red-500 dark:text-red-400"
                            )}>
                              달성률 {tk.winRate.toFixed(0)}%
                            </span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {/* 나머지 목록 + 바 */}
                {tickers.length > 3 && (
                  <div className="space-y-2">
                    {tickers.slice(3).map((tk, i) => {
                      const barPct = (tk.count / maxCount) * 100;
                      return (
                        <motion.div
                          key={`${topPeriod}-${tk.ticker}`}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.18 + i * 0.04 }}
                          className="flex items-center gap-3"
                        >
                          <span className="w-4 text-center text-[11px] text-muted-foreground/40 font-bold tabular-nums shrink-0">
                            {i + 4}
                          </span>
                          <StockLogo ticker={tk.ticker} companyName={tk.companyName} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[12px] font-semibold text-foreground truncate">{tk.companyName}</span>
                              <span className="text-[10px] text-muted-foreground font-mono shrink-0">{tk.ticker}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <motion.div
                                className="h-full rounded-full bg-primary/50"
                                initial={{ width: 0 }}
                                animate={{ width: `${barPct}%` }}
                                transition={{ duration: 0.6, delay: 0.2 + i * 0.04, ease: "easeOut" }}
                              />
                            </div>
                          </div>
                          <div className="shrink-0 text-right w-12">
                            <span className="text-[12px] font-bold text-foreground tabular-nums">{tk.count}{t("회", "x")}</span>
                            {tk.winRate != null && (
                              <p className={cn(
                                "text-[10px] tabular-nums",
                                tk.winRate >= 60 ? "text-emerald-600 dark:text-emerald-500" : tk.winRate >= 40 ? "text-amber-600 dark:text-amber-500" : "text-red-500 dark:text-red-400"
                              )}>
                                {tk.winRate.toFixed(0)}%
                              </p>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}

                {/* 3개 이하일 때 단순 리스트 */}
                {tickers.length <= 3 && tickers.length < 3 && (
                  <div className="space-y-2 mt-1">
                    {tickers.map((tk, i) => {
                      const barPct = (tk.count / maxCount) * 100;
                      return (
                        <motion.div
                          key={`${topPeriod}-${tk.ticker}`}
                          initial={{ opacity: 0, x: -6 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          className="flex items-center gap-3"
                        >
                          <span className={cn(
                            "w-5 text-center text-[11px] font-bold tabular-nums shrink-0",
                            i === 0 ? "text-amber-500" : i === 1 ? "text-neutral-400" : "text-orange-700"
                          )}>{i + 1}</span>
                          <StockLogo ticker={tk.ticker} companyName={tk.companyName} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className="text-[12px] font-semibold text-foreground truncate">{tk.companyName}</span>
                              <span className="text-[10px] text-muted-foreground font-mono shrink-0">{tk.ticker}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <motion.div className="h-full rounded-full bg-primary/50" initial={{ width: 0 }} animate={{ width: `${barPct}%` }} transition={{ duration: 0.5 }} />
                            </div>
                          </div>
                          <span className="text-[12px] font-bold text-foreground tabular-nums shrink-0">{tk.count}{t("회", "x")}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* 결과 분포 */}
      {stats.reviewedCount > 0 && (
        <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-bold text-foreground/90">{t("결과 분포", "Outcome Distribution")}</h2>
            <span className="text-[11px] text-muted-foreground">
              {t(`총 ${stats.reviewedCount}건 중 진행중 ${stats.ongoingCount}건`,
                 `${stats.ongoingCount} ongoing of ${stats.reviewedCount} total`)}
            </span>
          </div>

          {/* 완결 케이스 분포 */}
          {(stats.hitTargetCount + stats.hitStopCount) > 0 && (
            <div className="mb-4">
              <p className="text-[11px] text-muted-foreground mb-2">
                {t(`완결 케이스 ${stats.hitTargetCount + stats.hitStopCount}건 기준`,
                   `${stats.hitTargetCount + stats.hitStopCount} concluded cases`)}
              </p>
              {[
                { ko: "목표 달성", en: "Target Hit", count: stats.hitTargetCount, color: "bg-emerald-500", textColor: "text-emerald-700 dark:text-emerald-400" },
                { ko: "손절 발생", en: "Stop Loss",  count: stats.hitStopCount,   color: "bg-red-400",     textColor: "text-red-600 dark:text-red-400" },
              ].map(({ ko: koLabel, en: enLabel, count, color, textColor }) => {
                const concluded = stats.hitTargetCount + stats.hitStopCount;
                const pct = concluded > 0 ? (count / concluded) * 100 : 0;
                const label = isEn ? enLabel : koLabel;
                return (
                  <div key={label} className="flex items-center gap-3 mb-2">
                    <span className="w-16 text-[12px] text-muted-foreground shrink-0">{label}</span>
                    <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                      <motion.div
                        className={cn("h-2.5 rounded-full", color)}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                      />
                    </div>
                    <span className={cn("w-20 text-right text-[12px] font-semibold tabular-nums", textColor)}>
                      {count}{t("건", "")} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* 전체 분포 */}
          <div className="pt-3 border-t border-border">
            <p className="text-[11px] text-muted-foreground mb-2">{t("전체 현황", "Overall")}</p>
            {[
              { ko: "목표 달성", en: "Target Hit", count: stats.hitTargetCount, color: "bg-emerald-500", textColor: "text-emerald-700 dark:text-emerald-400" },
              { ko: "진행중",   en: "Ongoing",    count: stats.ongoingCount,    color: "bg-blue-400",    textColor: "text-blue-700 dark:text-blue-400" },
              { ko: "손절 발생", en: "Stop Loss",  count: stats.hitStopCount,   color: "bg-red-400",     textColor: "text-red-600 dark:text-red-400" },
            ].map(({ ko: koLabel, en: enLabel, count, color, textColor }) => {
              const pct = stats.reviewedCount > 0 ? (count / stats.reviewedCount) * 100 : 0;
              const label = isEn ? enLabel : koLabel;
              return (
                <div key={label} className="flex items-center gap-3 mb-1.5">
                  <span className="w-16 text-[11px] text-muted-foreground shrink-0">{label}</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <motion.div
                      className={cn("h-1.5 rounded-full", color)}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: "easeOut", delay: 0.3 }}
                    />
                  </div>
                  <span className={cn("w-20 text-right text-[11px] tabular-nums", textColor)}>
                    {count}{t("건", "")} ({pct.toFixed(0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 최근 사례 */}
      {stats.recentCases.length > 0 && (
        <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-[14px] font-bold text-foreground/90 mb-4">{t("최근 결과 사례", "Recent Cases")}</h2>
          <div className="space-y-2">
            {stats.recentCases.map((c, idx) => {
                      const isHit = c.outcome === "hit_target";
              const isStop = c.outcome === "hit_stop";
              const ret = c.priceReturn;
              const retStr = ret != null ? `${ret >= 0 ? "+" : ""}${ret.toFixed(1)}%` : "—";
              const retColor = isStop
                ? "text-blue-500"
                : ret != null ? (ret >= 0 ? "text-red-500" : "text-blue-500") : "text-muted-foreground";
              const stopButPositive = isStop && ret != null && ret > 0;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl border transition-all",
                    c.analysisId ? "cursor-pointer hover:border-border hover:bg-muted/50 border-border" : "border-border"
                  )}
                  onClick={() => c.analysisId && setLocation(`/analysis/${c.analysisId}`)}
                >
                  <div className="relative shrink-0">
                    <StockLogo ticker={c.ticker} companyName={c.companyName} size="sm" />
                    <span className={cn(
                      "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
                      isHit ? "bg-emerald-500" : "bg-red-400"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-foreground truncate">{c.companyName}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">{c.ticker}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {c.daysElapsed != null ? (isEn ? `After ${c.daysElapsed}d` : `${c.daysElapsed}일 후`) : ""} ·{" "}
                      {isHit ? t("목표 달성", "Target Hit") : t("손절 발생", "Stop Loss")}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={cn("text-[14px] font-bold tabular-nums", retColor)}>{retStr}</span>
                    {stopButPositive && (
                      <p className="text-[10px] text-amber-500 mt-0.5">{t("손절 후 반등", "Bounced after stop")}</p>
                    )}
                  </div>
                  {c.analysisId && (
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* 업종별 현황 */}
      {topIndustries.length > 0 && (
        <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
          <h2 className="text-[14px] font-bold text-foreground/90 mb-4">{t("업종별 현황", "By Industry")}</h2>
          <div className="divide-y divide-neutral-50">
            {topIndustries.map(([industry, data]) => {
              const rate = data.total > 0 ? (data.hitTarget / data.total) * 100 : 0;
              return (
                <div key={industry} className="flex items-center justify-between py-2.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] text-foreground/80 truncate">{industry}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">{data.total}{t("건", "")}</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={cn("text-[13px] font-semibold",
                      rate >= 60 ? "text-emerald-600" : rate >= 40 ? "text-amber-600" : "text-red-500"
                    )}>
                      {t("달성률", "Hit")} {rate.toFixed(0)}%
                    </span>
                    {data.avgReturn != null && (
                      <span className={cn("ml-2 text-[11px]",
                        data.avgReturn > 0 ? "text-red-500" : "text-blue-500"
                      )}>
                        ({data.avgReturn >= 0 ? "+" : ""}{data.avgReturn.toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 데이터 부족 시 안내 */}
      {stats.reviewedCount === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <BarChart3 className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-[14px] font-medium">{t("아직 검토된 분석 결과가 없습니다", "No reviewed results yet")}</p>
          <p className="text-[12px] mt-1">{t("분석 완료 후 일정 기간이 지나면 성과 데이터가 여기에 표시됩니다", "Performance data will appear here after analyses are reviewed")}</p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/50 text-center">
        {t("※ 과거 성과는 미래 수익률을 보장하지 않습니다. 투자 판단은 본인 책임입니다.",
           "※ Past performance does not guarantee future returns. Invest at your own risk.")}
      </p>
    </div>
  );
}
