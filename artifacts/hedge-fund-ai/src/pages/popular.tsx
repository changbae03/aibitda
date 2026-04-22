import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Target, Globe, Loader2, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLocation } from "wouter";

const VERDICT_ORDER = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];
const VERDICT_LABELS: Record<string, string> = {
  "Strong Buy":  "높은 상승여력",
  "Buy":         "상승여력",
  "Hold":        "적정 수준",
  "Sell":        "하락여지",
  "Strong Sell": "높은 하락여지",
};
const VERDICT_COLOR = ["bg-emerald-500", "bg-green-400", "bg-amber-400", "bg-red-300", "bg-red-500"];
const VERDICT_TEXT  = ["text-emerald-700", "text-green-700", "text-amber-700", "text-red-600", "text-red-700"];

interface PublicStats {
  total: number;
  verdictMap: Record<string, number>;
  krCount: number;
  usCount: number;
  uniqueTickerCount: number;
  topTickers: { ticker: string; companyName: string; count: number; latestVerdict: string | null; latestId: number }[];
}

interface PeriodBucket {
  key: string;
  label: string;
  minDays: number;
  total: number;
  reviewedCount: number;
  hitTargetCount: number;
  hitStopCount: number;
  ongoingCount: number;
  winRate: number | null;
  avgReturn: number | null;
}

export default function Popular() {
  const [, setLocation] = useLocation();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [periods, setPeriods] = useState<PeriodBucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(getApiUrl("api/analysis/public-stats")).then(r => r.json()),
      fetch(getApiUrl("api/analysis/period-stats")).then(r => r.json()),
    ]).then(([s, p]) => {
      setStats(s);
      setPeriods(p.periods ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  const total = stats?.total ?? 0;
  const verdictMap = stats?.verdictMap ?? {};
  const krCount = stats?.krCount ?? 0;
  const usCount = stats?.usCount ?? 0;
  const topTickers = stats?.topTickers ?? [];
  const marketTotal = krCount + usCount;

  // 판정 분포용 수치
  const verdictCounts = VERDICT_ORDER.map(k => verdictMap[k] ?? 0);
  const verdictSum = verdictCounts.reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">애빛다 통계</h1>
          <p className="text-[12px] text-muted-foreground">애빛다 AI 분석 누적 데이터 · 전체 공개</p>
        </div>
      </div>

      {/* 핵심 지표 2개 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 gap-3"
      >
        {[
          {
            label: "누적 분석 리포트",
            value: `${total.toLocaleString()}건`,
            sub: "AI 7단계 파이프라인으로 완료된 전체 분석 건수",
            icon: BarChart3,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "종목 커버리지",
            value: `${stats?.uniqueTickerCount ?? 0}종목`,
            sub: `분석된 고유 종목 수 · 한국 ${krCount}건 · 미국 ${usCount}건`,
            icon: Target,
            color: "text-amber-500",
            bg: "bg-amber-50",
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

      {/* 투자 의견 분포 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="rounded-xl border border-border bg-background p-5"
      >
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">투자 의견 분포</p>

        {/* 스택 바 */}
        <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-px">
          {verdictSum > 0 ? (
            verdictCounts.map((cnt, i) => (
              cnt > 0 && (
                <div
                  key={i}
                  className={cn("h-full transition-all", VERDICT_COLOR[i])}
                  style={{ width: `${(cnt / verdictSum) * 100}%` }}
                />
              )
            ))
          ) : (
            VERDICT_COLOR.map((color, i) => (
              <div key={i} className={cn("h-full flex-1", color)} style={{ opacity: 0.18 }} />
            ))
          )}
        </div>

        {/* 레전드 */}
        <div className="space-y-2">
          {VERDICT_ORDER.map((key, i) => {
            const cnt = verdictMap[key] ?? 0;
            const pct = verdictSum > 0 ? (cnt / verdictSum) * 100 : 0;
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.05 }}
                className="flex items-center gap-2.5"
              >
                <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", VERDICT_COLOR[i])} />
                <span className={cn("text-[12px] font-semibold w-24 shrink-0", VERDICT_TEXT[i])}>
                  {VERDICT_LABELS[key]}
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  {pct > 0 && (
                    <motion.div
                      className={cn("h-full rounded-full", VERDICT_COLOR[i])}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 + i * 0.05 }}
                    />
                  )}
                </div>
                <span className="text-[12px] tabular-nums text-muted-foreground shrink-0 w-10 text-right">
                  {cnt}건
                </span>
                <span className="text-[11px] text-muted-foreground/50 shrink-0 w-10 text-right">
                  {pct.toFixed(1)}%
                </span>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {/* 시장별 커버리지 */}
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

        <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-px bg-muted">
          {marketTotal > 0 && (
            <>
              <motion.div
                className="h-full bg-blue-500 rounded-l-full"
                initial={{ width: 0 }}
                animate={{ width: `${(krCount / marketTotal) * 100}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
              <motion.div
                className="h-full bg-red-400 rounded-r-full"
                initial={{ width: 0 }}
                animate={{ width: `${(usCount / marketTotal) * 100}%` }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            </>
          )}
        </div>

        <div className="flex gap-4">
          {[
            { label: "한국", count: krCount, color: "bg-blue-500" },
            { label: "미국", count: usCount, color: "bg-red-400" },
          ].map(({ label, count, color }) => (
            <div key={label} className="flex items-center gap-2">
              <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", color)} />
              <span className="text-[12px] font-semibold text-foreground">{label}</span>
              <span className="text-[12px] tabular-nums text-muted-foreground">{count}건</span>
              <span className="text-[11px] text-muted-foreground/50">
                ({marketTotal > 0 ? ((count / marketTotal) * 100).toFixed(0) : 0}%)
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* 많이 분석된 종목 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl border border-border bg-background p-5"
      >
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">많이 분석된 종목</p>

        {topTickers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground/50 text-center py-6">아직 누적된 분석 데이터가 없습니다.</p>
        ) : (
          <div className="space-y-2">
            {topTickers.map((t, i) => {
              const verdictIdx = VERDICT_ORDER.indexOf(t.latestVerdict ?? "");
              const verdictLabel = t.latestVerdict ? VERDICT_LABELS[t.latestVerdict] : null;
              const verdictColor = verdictIdx >= 0 ? VERDICT_TEXT[verdictIdx] : "text-muted-foreground";
              const verdictBg = verdictIdx >= 0
                ? ["bg-emerald-50 border-emerald-200", "bg-green-50 border-green-200", "bg-amber-50 border-amber-200", "bg-red-50 border-red-100", "bg-red-50 border-red-200"][verdictIdx]
                : "bg-muted border-border";

              return (
                <motion.div
                  key={t.ticker}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.04 }}
                  onClick={() => setLocation(`/analysis/${t.latestId}`)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  <span className="text-[12px] font-bold text-muted-foreground/40 w-5 tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-foreground truncate">{t.companyName}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{t.ticker}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {verdictLabel && (
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", verdictColor, verdictBg)}>
                        {verdictLabel}
                      </span>
                    )}
                    <span className="text-[12px] tabular-nums text-muted-foreground">{t.count}회</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* 기간별 성과 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.26 }}
        className="rounded-xl border border-border bg-background overflow-hidden"
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/20">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">기간별 성과 트래킹</p>
        </div>

        {periods.every(p => p.total === 0) ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[13px] text-muted-foreground/50">아직 기간별 성과를 집계할 데이터가 없습니다.</p>
            <p className="text-[11px] text-muted-foreground/30 mt-1">분석 후 1개월 이상 경과한 보고서가 생기면 표시됩니다.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {periods.map((p, i) => {
              const hasData = p.total > 0;
              const hasReview = p.reviewedCount > 0;
              const winRateColor = p.winRate != null
                ? p.winRate >= 60 ? "text-emerald-600" : p.winRate >= 40 ? "text-amber-600" : "text-red-500"
                : "text-muted-foreground/40";
              const returnColor = p.avgReturn != null
                ? p.avgReturn > 0 ? "text-emerald-600" : p.avgReturn < 0 ? "text-red-500" : "text-muted-foreground"
                : "text-muted-foreground/40";
              const ReturnIcon = p.avgReturn != null
                ? p.avgReturn > 0 ? TrendingUp : p.avgReturn < 0 ? TrendingDown : Minus
                : Minus;

              return (
                <motion.div
                  key={p.key}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.05 }}
                  className={cn("px-5 py-4", !hasData && "opacity-40")}
                >
                  {/* 기간 라벨 + 총 분석 수 */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-foreground">{p.label}</span>
                      <span className="text-[11px] text-muted-foreground">경과 보고서</span>
                    </div>
                    <span className={cn("text-[12px] font-semibold tabular-nums", hasData ? "text-foreground" : "text-muted-foreground/40")}>
                      {p.total}건
                    </span>
                  </div>

                  {hasData && (
                    <div className="grid grid-cols-3 gap-3">
                      {/* 목표가 달성률 */}
                      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
                        <p className="text-[10px] text-muted-foreground mb-1">목표가 달성률</p>
                        <p className={cn("text-[18px] font-black tabular-nums leading-none", winRateColor)}>
                          {hasReview && p.winRate != null ? `${p.winRate.toFixed(0)}%` : "—"}
                        </p>
                        {hasReview && (
                          <p className="text-[9px] text-muted-foreground/50 mt-1">
                            {p.hitTargetCount}/{p.reviewedCount}건 달성
                          </p>
                        )}
                      </div>

                      {/* 평균 수익률 */}
                      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
                        <p className="text-[10px] text-muted-foreground mb-1">평균 수익률</p>
                        <div className={cn("flex items-center gap-0.5", returnColor)}>
                          <ReturnIcon className="w-3.5 h-3.5 shrink-0" />
                          <p className="text-[18px] font-black tabular-nums leading-none">
                            {p.avgReturn != null
                              ? `${p.avgReturn >= 0 ? "+" : ""}${p.avgReturn.toFixed(1)}%`
                              : "—"}
                          </p>
                        </div>
                        <p className="text-[9px] text-muted-foreground/50 mt-1">진입가 기준</p>
                      </div>

                      {/* 검증 현황 */}
                      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
                        <p className="text-[10px] text-muted-foreground mb-1">검증 현황</p>
                        <p className="text-[18px] font-black tabular-nums leading-none text-foreground">
                          {p.reviewedCount}<span className="text-[11px] font-normal text-muted-foreground ml-0.5">/{p.total}</span>
                        </p>
                        <div className="flex gap-1.5 mt-1">
                          {p.hitTargetCount > 0 && (
                            <span className="text-[9px] text-emerald-600 font-medium">▲{p.hitTargetCount}</span>
                          )}
                          {p.hitStopCount > 0 && (
                            <span className="text-[9px] text-red-500 font-medium">▼{p.hitStopCount}</span>
                          )}
                          {p.ongoingCount > 0 && (
                            <span className="text-[9px] text-blue-500 font-medium">→{p.ongoingCount}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 달성/손절/추적 바 */}
                  {hasReview && (
                    <div className="mt-3 flex h-1.5 rounded-full overflow-hidden gap-px bg-muted">
                      {p.hitTargetCount > 0 && (
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${(p.hitTargetCount / p.reviewedCount) * 100}%` }}
                        />
                      )}
                      {p.ongoingCount > 0 && (
                        <div
                          className="h-full bg-blue-400"
                          style={{ width: `${(p.ongoingCount / p.reviewedCount) * 100}%` }}
                        />
                      )}
                      {p.hitStopCount > 0 && (
                        <div
                          className="h-full bg-red-400 rounded-full"
                          style={{ width: `${(p.hitStopCount / p.reviewedCount) * 100}%` }}
                        />
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        <div className="px-5 py-3 bg-muted/10 border-t border-border">
          <p className="text-[10px] text-muted-foreground/50">
            ※ 목표가 달성·손절가 도달 시 자동 기록됩니다. 검증되지 않은 보고서는 집계에서 제외됩니다.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
