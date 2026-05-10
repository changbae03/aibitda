import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { TrendingUp, TrendingDown, Target, BarChart3, Loader2, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import { motion } from "framer-motion";

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

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
      <p className="text-[12px] text-muted-foreground font-medium mb-1">{label}</p>
      <p className={cn("text-3xl font-black tracking-tight leading-none", color ?? "text-foreground")}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>}
    </div>
  );
}

export default function Stats() {
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
        데이터를 불러올 수 없습니다
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
          AI 분석 정확도
        </h1>
        <p className="text-[13px] text-muted-foreground">
          애빛다 AI가 분석한 종목의 실제 주가 성과를 공개합니다
        </p>
      </div>

      {/* 핵심 지표 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="총 분석 수"
          value={stats.totalAnalyses.toLocaleString()}
          sub="누적 AI 분석 보고서"
        />
        <StatCard
          label="목표가 달성률"
          value={winRateStr}
          sub={`${stats.hitTargetCount}건 달성 / ${stats.reviewedCount}건 검토`}
          color={winRateColor}
        />
        <StatCard
          label="평균 수익률"
          value={avgReturnStr}
          sub="진입가 기준 평균"
          color={avgReturnColor}
        />
        <StatCard
          label="추적 중"
          value={stats.ongoingCount.toLocaleString()}
          sub="현재 진행중인 포지션"
          color="text-blue-600"
        />
      </div>

      {/* 결과 분포 */}
      {stats.reviewedCount > 0 && (
        <div className="bg-background border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-bold text-foreground/90">결과 분포</h2>
            <span className="text-[11px] text-muted-foreground">
              총 {stats.reviewedCount}건 중 진행중 {stats.ongoingCount}건
            </span>
          </div>

          {/* 완결 케이스 분포 (목표달성 vs 손절) */}
          {(stats.hitTargetCount + stats.hitStopCount) > 0 && (
            <div className="mb-4">
              <p className="text-[11px] text-muted-foreground mb-2">
                완결 케이스 {stats.hitTargetCount + stats.hitStopCount}건 기준
              </p>
              {[
                { label: "목표 달성", count: stats.hitTargetCount, color: "bg-emerald-500", textColor: "text-emerald-700 dark:text-emerald-400" },
                { label: "손절 발생", count: stats.hitStopCount, color: "bg-red-400", textColor: "text-red-600 dark:text-red-400" },
              ].map(({ label, count, color, textColor }) => {
                const concluded = stats.hitTargetCount + stats.hitStopCount;
                const pct = concluded > 0 ? (count / concluded) * 100 : 0;
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
                      {count}건 ({pct.toFixed(0)}%)
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* 전체 분포 (진행중 포함) */}
          <div className="pt-3 border-t border-border">
            <p className="text-[11px] text-muted-foreground mb-2">전체 현황</p>
            {[
              { label: "목표 달성", count: stats.hitTargetCount, color: "bg-emerald-500", textColor: "text-emerald-700 dark:text-emerald-400" },
              { label: "진행중", count: stats.ongoingCount, color: "bg-blue-400", textColor: "text-blue-700 dark:text-blue-400" },
              { label: "손절 발생", count: stats.hitStopCount, color: "bg-red-400", textColor: "text-red-600 dark:text-red-400" },
            ].map(({ label, count, color, textColor }) => {
              const pct = stats.reviewedCount > 0 ? (count / stats.reviewedCount) * 100 : 0;
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
                    {count}건 ({pct.toFixed(0)}%)
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
          <h2 className="text-[14px] font-bold text-foreground/90 mb-4">최근 결과 사례</h2>
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
                  <div className="shrink-0">
                    {isHit
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      : <XCircle className="w-4 h-4 text-red-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-foreground truncate">{c.companyName}</span>
                      <span className="text-[11px] text-muted-foreground font-mono">{c.ticker}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {c.daysElapsed != null ? `${c.daysElapsed}일 후` : ""} ·{" "}
                      {isHit ? "목표 달성" : "손절 발생"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={cn("text-[14px] font-bold tabular-nums", retColor)}>{retStr}</span>
                    {stopButPositive && (
                      <p className="text-[10px] text-amber-500 mt-0.5">손절 후 반등</p>
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
          <h2 className="text-[14px] font-bold text-foreground/90 mb-4">업종별 현황</h2>
          <div className="divide-y divide-neutral-50">
            {topIndustries.map(([industry, data]) => {
              const rate = data.total > 0 ? (data.hitTarget / data.total) * 100 : 0;
              return (
                <div key={industry} className="flex items-center justify-between py-2.5">
                  <div className="flex-1 min-w-0">
                    <span className="text-[13px] text-foreground/80 truncate">{industry}</span>
                    <span className="ml-2 text-[11px] text-muted-foreground">{data.total}건</span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={cn("text-[13px] font-semibold",
                      rate >= 60 ? "text-emerald-600" : rate >= 40 ? "text-amber-600" : "text-red-500"
                    )}>
                      달성률 {rate.toFixed(0)}%
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
          <p className="text-[14px] font-medium">아직 검토된 분석 결과가 없습니다</p>
          <p className="text-[12px] mt-1">분석 완료 후 일정 기간이 지나면 성과 데이터가 여기에 표시됩니다</p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/50 text-center">
        ※ 과거 성과는 미래 수익률을 보장하지 않습니다. 투자 판단은 본인 책임입니다.
      </p>
    </div>
  );
}
