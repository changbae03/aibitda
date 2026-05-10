import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Target, Globe, Loader2, Clock, TrendingUp, TrendingDown, Minus, CalendarDays } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLocation } from "wouter";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { useLanguage } from "@/lib/language-context";

const VERDICT_ORDER = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];
const VERDICT_LABELS_KO: Record<string, string> = {
  "Strong Buy":  "높은 상승여력",
  "Buy":         "상승여력",
  "Hold":        "적정 수준",
  "Sell":        "하락여지",
  "Strong Sell": "높은 하락여지",
};
const VERDICT_LABELS_EN: Record<string, string> = {
  "Strong Buy":  "Strong Buy",
  "Buy":         "Buy",
  "Hold":        "Hold",
  "Sell":        "Sell",
  "Strong Sell": "Strong Sell",
};
const VERDICT_COLOR = ["bg-emerald-500", "bg-green-400", "bg-amber-400", "bg-red-300", "bg-red-500"];
const VERDICT_TEXT  = ["text-emerald-700", "text-green-700", "text-amber-700", "text-red-600", "text-red-700"];
const DONUT_COLORS  = ["#10b981", "#4ade80", "#fbbf24", "#fca5a5", "#ef4444"];

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
  directionAccuracy: number | null;
  directionCorrectCount: number;
  directionTotalCount: number;
  avgReturn: number | null;
}

export default function Popular() {
  const { isEn } = useLanguage();
  const t = (ko: string, en: string) => isEn ? en : ko;

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

  const VERDICT_LABELS = isEn ? VERDICT_LABELS_EN : VERDICT_LABELS_KO;

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
          <h1 className="text-lg font-bold text-foreground">{t("애빛다 통계", "CBST Statistics")}</h1>
          <p className="text-[12px] text-muted-foreground">{t("애빛다 AI 분석 누적 데이터 · 전체 공개", "Cumulative AI analysis data · Public")}</p>
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
            label: t("누적 분석 리포트", "Total Reports"),
            value: `${total.toLocaleString()}${t("건", "")}`,
            sub: t("AI 7단계 파이프라인으로 완료된 전체 분석 건수", "Analyses completed via 7-stage AI pipeline"),
            icon: BarChart3,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: t("종목 커버리지", "Stock Coverage"),
            value: `${stats?.uniqueTickerCount ?? 0}${t("종목", " stocks")}`,
            sub: t(`분석된 고유 종목 수 · 한국 ${krCount}건 · 미국 ${usCount}건`,
                   `Unique stocks analyzed · KR ${krCount} · US ${usCount}`),
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

      {/* 데이터 시작일 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-1.5 px-1"
      >
        <CalendarDays className="w-3.5 h-3.5 text-muted-foreground/50" />
        <p className="text-[11px] text-muted-foreground/60">
          {t("데이터 시작일", "Data since")}{" "}
          <span className="font-semibold text-muted-foreground/80">2026.04.23</span> ~
        </p>
      </motion.div>

      {/* 투자 의견 분포 */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08 }}
        className="rounded-xl border border-border bg-background p-5"
      >
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">
          {t("투자 의견 분포", "Verdict Distribution")}
        </p>

        {verdictSum > 0 ? (
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* 도넛 차트 */}
            <div className="w-44 h-44 shrink-0 relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={VERDICT_ORDER.map((key, i) => ({
                      name: VERDICT_LABELS[key],
                      value: verdictMap[key] ?? 0,
                      color: DONUT_COLORS[i],
                    })).filter(d => d.value > 0)}
                    cx="50%"
                    cy="50%"
                    innerRadius="62%"
                    outerRadius="88%"
                    paddingAngle={2}
                    dataKey="value"
                    startAngle={90}
                    endAngle={-270}
                  >
                    {VERDICT_ORDER.map((key, i) => (
                      (verdictMap[key] ?? 0) > 0 && (
                        <Cell key={key} fill={DONUT_COLORS[i]} strokeWidth={0} />
                      )
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value}${t("건", "")} (${verdictSum > 0 ? ((value/verdictSum)*100).toFixed(1) : 0}%)`,
                      name,
                    ]}
                    contentStyle={{ fontSize: 11, borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* 중앙 텍스트 */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-[22px] font-black text-foreground tabular-nums">{verdictSum}</span>
                <span className="text-[10px] text-muted-foreground font-medium">{t("건", "total")}</span>
              </div>
            </div>

            {/* 레전드 */}
            <div className="flex-1 space-y-2 w-full">
              {VERDICT_ORDER.map((key, i) => {
                const cnt = verdictMap[key] ?? 0;
                const pct = verdictSum > 0 ? (cnt / verdictSum) * 100 : 0;
                if (cnt === 0) return null;
                return (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.05 }}
                    className="flex items-center gap-2.5"
                  >
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: DONUT_COLORS[i] }} />
                    <span className={cn("text-[12px] font-semibold w-20 shrink-0", VERDICT_TEXT[i])}>
                      {VERDICT_LABELS[key]}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: DONUT_COLORS[i] }}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7, ease: "easeOut", delay: 0.2 + i * 0.05 }}
                      />
                    </div>
                    <span className="text-[12px] tabular-nums text-muted-foreground shrink-0 w-8 text-right">
                      {cnt}{t("건", "")}
                    </span>
                    <span className="text-[11px] text-muted-foreground/50 shrink-0 w-10 text-right">{pct.toFixed(0)}%</span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground/50 text-center py-6">
            {t("아직 분석 데이터가 없습니다.", "No analysis data yet.")}
          </p>
        )}
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
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
            {t("시장별 커버리지", "Coverage by Market")}
          </p>
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
            { ko: "한국", en: "Korea", count: krCount, color: "bg-blue-500" },
            { ko: "미국", en: "US",    count: usCount, color: "bg-red-400" },
          ].map(({ ko: koLabel, en: enLabel, count, color }) => (
            <div key={koLabel} className="flex items-center gap-2">
              <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", color)} />
              <span className="text-[12px] font-semibold text-foreground">{isEn ? enLabel : koLabel}</span>
              <span className="text-[12px] tabular-nums text-muted-foreground">{count}{t("건", "")}</span>
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
        <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-4">
          {t("많이 분석된 종목", "Most Analyzed Stocks")}
        </p>

        {topTickers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground/50 text-center py-6">
            {t("아직 누적된 분석 데이터가 없습니다.", "No accumulated analysis data yet.")}
          </p>
        ) : (
          <div className="space-y-2">
            {topTickers.map((t2, i) => {
              return (
                <motion.div
                  key={t2.ticker}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + i * 0.04 }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border transition-colors"
                >
                  <span className="text-[12px] font-bold text-muted-foreground/40 w-5 tabular-nums">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-foreground truncate">{t2.companyName}</span>
                      <span className="text-[11px] font-mono text-muted-foreground">{t2.ticker}</span>
                    </div>
                  </div>
                  <span className="text-[12px] tabular-nums text-muted-foreground shrink-0">
                    {t2.count}{isEn ? "x" : "회"}
                  </span>
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
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">
            {t("기간별 성과 트래킹", "Performance by Period")}
          </p>
        </div>

        {periods.every(p => p.total === 0) ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[13px] text-muted-foreground/50">
              {t("아직 기간별 성과를 집계할 데이터가 없습니다.", "No performance data available yet.")}
            </p>
            <p className="text-[11px] text-muted-foreground/30 mt-1">
              {t("분석 후 1개월 이상 경과한 보고서가 생기면 표시됩니다.", "Appears when reports are at least 1 month old.")}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {periods.map((p, i) => {
              const hasData = p.total > 0;
              const hasDirection = p.directionTotalCount > 0;
              const dirColor = p.directionAccuracy != null
                ? p.directionAccuracy >= 60 ? "text-emerald-600" : p.directionAccuracy >= 50 ? "text-amber-600" : "text-red-500"
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
                      <span className="text-[11px] text-muted-foreground">{t("경과 보고서", "reports")}</span>
                    </div>
                    <span className={cn("text-[12px] font-semibold tabular-nums", hasData ? "text-foreground" : "text-muted-foreground/40")}>
                      {p.total}{t("건", "")}
                    </span>
                  </div>

                  {hasData && (
                    <div className="grid grid-cols-3 gap-3">
                      {/* 방향 정확도 */}
                      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
                        <p className="text-[10px] text-muted-foreground mb-1">{t("방향 정확도", "Direction Accuracy")}</p>
                        <p className={cn("text-[18px] font-black tabular-nums leading-none", dirColor)}>
                          {hasDirection && p.directionAccuracy != null ? `${p.directionAccuracy.toFixed(0)}%` : "—"}
                        </p>
                        {hasDirection && (
                          <p className="text-[9px] text-muted-foreground/50 mt-1">
                            {p.directionCorrectCount}/{p.directionTotalCount}{t("건 정확", " correct")}
                          </p>
                        )}
                      </div>

                      {/* 평균 수익률 */}
                      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
                        <p className="text-[10px] text-muted-foreground mb-1">{t("평균 수익률", "Avg Return")}</p>
                        <div className={cn("flex items-center gap-0.5", returnColor)}>
                          <ReturnIcon className="w-3.5 h-3.5 shrink-0" />
                          <p className="text-[18px] font-black tabular-nums leading-none">
                            {p.avgReturn != null
                              ? `${p.avgReturn >= 0 ? "+" : ""}${p.avgReturn.toFixed(1)}%`
                              : "—"}
                          </p>
                        </div>
                        <p className="text-[9px] text-muted-foreground/50 mt-1">{t("진입가 기준", "From entry")}</p>
                      </div>

                      {/* 분석 건수 */}
                      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
                        <p className="text-[10px] text-muted-foreground mb-1">{t("분석 건수", "Reports")}</p>
                        <p className="text-[18px] font-black tabular-nums leading-none text-foreground">
                          {p.total}<span className="text-[11px] font-normal text-muted-foreground ml-0.5">{t("건", "")}</span>
                        </p>
                        <p className="text-[9px] text-muted-foreground/50 mt-1">
                          {t("매수·매도 판정", "Buy/Sell verdicts")} {p.directionTotalCount}{t("건", "")}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 방향 정확/부정확 바 */}
                  {hasDirection && (
                    <div className="mt-3 flex h-1.5 rounded-full overflow-hidden gap-px bg-muted">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${(p.directionCorrectCount / p.directionTotalCount) * 100}%` }}
                      />
                      <div
                        className="h-full bg-red-400 rounded-full"
                        style={{ width: `${((p.directionTotalCount - p.directionCorrectCount) / p.directionTotalCount) * 100}%` }}
                      />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        <div className="px-5 py-3 bg-muted/10 border-t border-border">
          <p className="text-[10px] text-muted-foreground/50">
            {t(
              "※ 방향 정확도는 매수·매도 판정 보고서에서 실제 주가 방향(상승/하락)이 일치한 비율입니다. Hold 판정은 제외됩니다.",
              "※ Direction Accuracy is the rate at which Buy/Sell verdicts correctly predicted the actual price direction. Hold verdicts are excluded."
            )}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
