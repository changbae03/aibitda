import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { TrendingUp, TrendingDown, Target, BarChart3, Loader2, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import StockLogo from "@/components/ui/stock-logo";
import { motion } from "framer-motion";
import { useLanguage } from "@/lib/language-context";

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

  useEffect(() => {
    fetch(getApiUrl("api/model-insights/public-stats"))
      .then((r) => r.json())
      .then((d) => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/50" />
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
    ? stats.avgReturn > 0 ? "text-emerald-600" : stats.avgReturn < 0 ? "text-red-500" : "text-foreground"
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
                ? "text-red-500"
                : ret != null ? (ret >= 0 ? "text-emerald-600" : "text-red-500") : "text-muted-foreground";
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
                        data.avgReturn > 0 ? "text-emerald-500" : "text-red-400"
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
