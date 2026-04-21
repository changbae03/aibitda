import { motion } from "framer-motion";
import { BarChart3, Target, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const VERDICT_LABELS = ["강력 매수", "매수", "보유", "매도", "강력 매도"];
const VERDICT_COLOR = ["bg-red-500", "bg-red-300", "bg-amber-400", "bg-blue-300", "bg-blue-500"];
const VERDICT_TEXT  = ["text-red-600", "text-red-400", "text-amber-500", "text-blue-400", "text-blue-600"];

export default function Popular() {
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
            value: "0건",
            sub: "전체 기업 분석 수",
            icon: BarChart3,
            color: "text-primary",
            bg: "bg-primary/10",
          },
          {
            label: "주가 방향 정확도",
            value: "—",
            sub: "0건 검증 기준",
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

        {/* 스택 바 — 균등 분할 placeholder */}
        <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-px">
          {VERDICT_COLOR.map((color, i) => (
            <div key={i} className={cn("h-full flex-1", color)} style={{ opacity: 0.25 }} />
          ))}
        </div>

        {/* 레전드 */}
        <div className="space-y-2">
          {VERDICT_LABELS.map((label, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className="flex items-center gap-2.5"
            >
              <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", VERDICT_COLOR[i])} />
              <span className={cn("text-[12px] font-semibold w-16 shrink-0", VERDICT_TEXT[i])}>
                {label}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden" />
              <span className="text-[12px] tabular-nums text-muted-foreground shrink-0 w-10 text-right">0건</span>
              <span className="text-[11px] text-muted-foreground/50 shrink-0 w-10 text-right">0.0%</span>
            </motion.div>
          ))}
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

        <div className="flex h-3 rounded-full overflow-hidden mb-4 gap-px bg-muted" />

        <div className="flex gap-4">
          {["한국", "미국"].map((market, i) => (
            <div key={market} className="flex items-center gap-2">
              <div className={cn("w-2.5 h-2.5 rounded-sm shrink-0", i === 0 ? "bg-blue-500" : "bg-red-400")} />
              <span className="text-[12px] font-semibold text-foreground">{market}</span>
              <span className="text-[12px] tabular-nums text-muted-foreground">0건</span>
              <span className="text-[11px] text-muted-foreground/50">(0%)</span>
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
        <p className="text-[13px] text-muted-foreground/50 text-center py-6">아직 누적된 분석 데이터가 없습니다.</p>
      </motion.div>
    </div>
  );
}
