import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BarChart3, Target, Globe, Loader2 } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLocation } from "wouter";

const VERDICT_ORDER = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];
const VERDICT_LABELS: Record<string, string> = {
  "Strong Buy":  "강력 매수",
  "Buy":         "매수",
  "Hold":        "보유",
  "Sell":        "매도",
  "Strong Sell": "강력 매도",
};
const VERDICT_COLOR = ["bg-red-500", "bg-red-300", "bg-amber-400", "bg-blue-300", "bg-blue-500"];
const VERDICT_TEXT  = ["text-red-600", "text-red-400", "text-amber-500", "text-blue-400", "text-blue-600"];

interface PublicStats {
  total: number;
  verdictMap: Record<string, number>;
  krCount: number;
  usCount: number;
  topTickers: { ticker: string; companyName: string; count: number; latestVerdict: string | null; latestId: number }[];
}

export default function Popular() {
  const [, setLocation] = useLocation();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(getApiUrl("api/analysis/public-stats"))
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
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
            label: "누적 분석",
            value: `${total.toLocaleString()}건`,
            sub: "전체 기업 분석 수",
            icon: BarChart3,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "종목 커버리지",
            value: `${Object.keys(stats?.verdictMap ?? {}).length > 0 || topTickers.length > 0 ? topTickers.length : 0}종목`,
            sub: `한국 ${krCount}건 · 미국 ${usCount}건`,
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
                <span className={cn("text-[12px] font-semibold w-16 shrink-0", VERDICT_TEXT[i])}>
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
                ? ["bg-red-50 border-red-200", "bg-red-50 border-red-100", "bg-amber-50 border-amber-200", "bg-blue-50 border-blue-100", "bg-blue-50 border-blue-200"][verdictIdx]
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
    </div>
  );
}
