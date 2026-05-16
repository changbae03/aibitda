import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Loader2, Clock } from "lucide-react";
import { cn, isUSTicker } from "@/lib/utils";
import { ANALYSIS_STEPS_ORDER } from "@/lib/agents";

// ── 파싱 헬퍼 ─────────────────────────────────────────────────────────────────

function parseFinalValuationData(content: string) {
  const mlMatch = content.match(/FINAL_VALUATION_DATA:\s*(\{[\s\S]*?\})/);
  const raw = mlMatch?.[1] ?? content.match(/FINAL_VALUATION_DATA:\s*(\{[^\n]+\})/)?.[1];
  if (!raw) return null;
  try {
    const p = JSON.parse(raw.replace(/[\r\n\t]/g, " "));
    return p.base ? p : null;
  } catch { return null; }
}

function parseStrategyJson(content: string) {
  try {
    let s = content.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
    const start = s.indexOf("{"), end = s.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(s.slice(start, end + 1));
  } catch { return null; }
}

function extractBullets(content: string, max = 3): string[] {
  const clean = content
    .replace(/FINAL_VALUATION_DATA:\{[^\n]+\}/g, "")
    .replace(/VALUATION_DATA:\{[^\n]+\}/g, "")
    .replace(/CHART_DATA:\{[^\n]+\}/g, "")
    .replace(/EVENTS_DATA:\[[^\n]+\]/g, "");
  const lines = clean.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^[-*•]\s+(.+)/);
    if (m) {
      const t = m[1].trim().replace(/\*\*/g, "").replace(/^\w+[:：]\s*/, "").slice(0, 100);
      if (t.length > 8) out.push(t);
    }
    if (out.length >= max) break;
  }
  return out;
}

function extractLeadText(content: string, maxLen = 120): string {
  const clean = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#+\s.+$/gm, "")
    .replace(/FINAL_VALUATION_DATA:\{[^\n]+\}/g, "")
    .replace(/VALUATION_DATA:\{[^\n]+\}/g, "")
    .replace(/\*\*/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const firstPara = clean.split("\n").find(l => l.trim().length > 20) ?? "";
  return firstPara.trim().slice(0, maxLen) + (firstPara.length > maxLen ? "…" : "");
}

// ── 스텝별 설정 ───────────────────────────────────────────────────────────────

const STEP_CFG: Record<string, { emoji: string; label: string; labelEn: string; hex: string; rgb: string }> = {
  company_intro:      { emoji: "🏢", label: "브리핑",        labelEn: "Briefing",    hex: "#94A3FF", rgb: "148,163,255" },
  industry_analysis:  { emoji: "🌐", label: "산업 분석",     labelEn: "Industry",    hex: "#7AE8B4", rgb: "122,232,180" },
  catalyst_analysis:  { emoji: "⚡", label: "촉매 분석",     labelEn: "Catalysts",   hex: "#FFD97A", rgb: "255,217,122" },
  company_analysis:   { emoji: "📊", label: "실적 전망",     labelEn: "Financials",  hex: "#C87AFF", rgb: "200,122,255" },
  relative_valuation: { emoji: "💰", label: "적정주가",      labelEn: "Valuation",   hex: "#7AB8FF", rgb: "122,184,255" },
  market_analysis:    { emoji: "📈", label: "기술적 분석",   labelEn: "Technical",   hex: "#FF9F7A", rgb: "255,159,122" },
  investment_strategy:{ emoji: "🎯", label: "최종 결론",     labelEn: "Conclusion",  hex: "#FF8A7A", rgb: "255,138,122" },
};

function ab(rgb: string, a = 0.1) { return `rgba(${rgb},${a})`; }
function bd(rgb: string, a = 0.2) { return `1px solid rgba(${rgb},${a})`; }

function fmtP(v: number | null | undefined, isUS: boolean) {
  if (v == null) return "—";
  return isUS
    ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₩${Math.round(v).toLocaleString("ko-KR")}`;
}
function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`; }

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  analysis: any;
  isEn?: boolean;
  streamingStepKey?: string | null;
}

// ── 카드 콘텐츠 빌더 ──────────────────────────────────────────────────────────

function buildCardContent(stepKey: string, content: string, analysis: any, isEn: boolean) {
  const isUS = isUSTicker(analysis.ticker ?? "");

  if (stepKey === "investment_strategy") {
    const j = parseStrategyJson(content);
    const verdict  = (analysis.investmentVerdict ?? j?.verdict ?? "").toUpperCase();
    const targetP  = analysis.targetPrice ?? j?.target_price ?? null;
    const entryP   = (analysis as any).entryPrice ?? j?.entry_price ?? null;
    const stopL    = (analysis as any).stopLoss   ?? j?.stop_loss   ?? null;
    const startP   = (analysis as any).startPrice ?? null;
    const upside   = targetP && startP ? (targetP - startP) / startP * 100 : null;
    const rr       = j?.risk_reward_ratio ?? (targetP && entryP && stopL && entryP !== stopL
      ? Math.abs(targetP - entryP) / Math.abs(entryP - stopL) : null);
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-4xl font-black" style={{ color: STEP_CFG.investment_strategy.hex }}>
              {verdict || "—"}
            </div>
            <div className="text-white/40 text-xs mt-0.5">{isEn ? "12M Verdict" : "12개월 투자의견"}</div>
          </div>
          {upside !== null && (
            <div className="text-right">
              <div className="text-2xl font-bold text-white">{fmtP(targetP, isUS)}</div>
              <div className="text-sm font-semibold" style={{ color: STEP_CFG.investment_strategy.hex }}>{fmtPct(upside)}</div>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            [isEn ? "Entry" : "진입가", fmtP(entryP, isUS)],
            [isEn ? "Stop" : "손절가", fmtP(stopL, isUS)],
            [isEn ? "R/R" : "손익비", rr ? `${rr.toFixed(2)}:1` : "—"],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} className="rounded-xl p-2.5" style={{ background: ab(STEP_CFG.investment_strategy.rgb, 0.08) }}>
              <div className="text-[10px] text-white/40 mb-0.5">{l}</div>
              <div className="text-sm font-bold text-white">{v}</div>
            </div>
          ))}
        </div>
        {j?.scenarios?.length > 0 && (
          <div className="flex gap-2">
            {(j.scenarios as any[]).map((s: any) => {
              const isBull = s.case === "Bull", isBear = s.case === "Bear";
              const col = isBull ? "#7AE8B4" : isBear ? "#FF8A7A" : "#7AB8FF";
              return (
                <div key={s.case} className="flex-1 rounded-xl p-2 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <div className="text-[10px] text-white/40">{s.case}</div>
                  <div className="text-xs font-bold mt-0.5" style={{ color: col }}>
                    {s.upside ? (typeof s.upside === "number" ? fmtPct(s.upside) : s.upside) : fmtP(s.target_price, isUS)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (stepKey === "relative_valuation") {
    const fv = parseFinalValuationData(content);
    const bear = fv?.bear ?? null, base = fv?.base ?? null, bull = fv?.bull ?? null;
    const cur  = fv?.current ?? (analysis as any).startPrice ?? null;
    const range = bear && bull ? bull - bear : 0;
    const curPct  = cur  && bear && bull ? Math.max(3, Math.min(97, (cur  - bear) / range * 100)) : 50;
    const basePct = base && bear && bull ? Math.max(3, Math.min(97, (base - bear) / range * 100)) : 65;
    const upside  = base && cur && cur > 0 ? (base - cur) / cur * 100 : null;
    const cfg = STEP_CFG.relative_valuation;
    return (
      <div className="flex flex-col gap-3">
        {base && (
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold text-white">{fmtP(base, isUS)}</div>
              <div className="text-xs text-white/40 mt-0.5">{isEn ? "Base Target" : "목표주가 (Base)"}</div>
            </div>
            {upside !== null && (
              <div className="rounded-xl px-2.5 py-1 text-sm font-bold"
                style={{ background: ab(cfg.rgb, 0.15), color: cfg.hex }}>
                {fmtPct(upside)}
              </div>
            )}
          </div>
        )}
        {bear && bull && (
          <div>
            <div className="flex justify-between text-[10px] text-white/30 mb-1.5">
              <span>Bear {fmtP(bear, isUS)}</span>
              <span>Bull {fmtP(bull, isUS)}</span>
            </div>
            <div className="relative h-2.5 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div className="absolute inset-0 rounded-full"
                style={{ background: "linear-gradient(90deg,#FF5A5A,#FF8A7A 30%,#7AB8FF 70%,#7AE8B4)" }} />
              {cur && <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${curPct}%` }}>
                <div className="w-0.5 h-5 bg-white rounded-full" />
              </div>}
              {base && <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2" style={{ left: `${basePct}%` }}>
                <div className="w-3 h-3 rounded-full border-2 border-white" style={{ background: cfg.hex }} />
              </div>}
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {([["Bear", bear, "#FF8A7A"], ["Base", base, cfg.hex], ["Bull", bull, "#7AE8B4"]] as [string,number|null,string][]).map(([l,v,c]) => (
            <div key={l} className="rounded-xl p-2.5 text-center" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="text-[10px] text-white/40 mb-0.5">{l}</div>
              <div className="text-xs font-bold" style={{ color: c }}>{fmtP(v, isUS)}</div>
            </div>
          ))}
        </div>
        {!base && <div className="text-sm text-white/40">{extractLeadText(content)}</div>}
      </div>
    );
  }

  // 범용 카드: 불릿 + 리드 텍스트
  const cfg = STEP_CFG[stepKey];
  const bullets = extractBullets(content, 4);
  const lead = bullets.length === 0 ? extractLeadText(content, 160) : "";
  return (
    <div className="flex flex-col gap-2.5">
      {lead && <div className="text-sm text-white/70 leading-relaxed">{lead}</div>}
      {bullets.map((b, i) => (
        <div key={i} className="flex items-start gap-2.5 rounded-xl p-3"
          style={{ background: i === 0 ? ab(cfg.rgb, 0.08) : "rgba(255,255,255,0.04)", border: i === 0 ? bd(cfg.rgb, 0.15) : "1px solid transparent" }}>
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5"
            style={{ background: ab(cfg.rgb, 0.2), color: cfg.hex }}>
            {i + 1}
          </div>
          <div className="text-white/80 text-sm leading-snug">{b}</div>
        </div>
      ))}
      {bullets.length === 0 && !lead && <div className="text-sm text-white/30 italic">{isEn ? "No summary available." : "요약 내용 없음"}</div>}
    </div>
  );
}

// ── 단일 카드 래퍼 ────────────────────────────────────────────────────────────

function StepSummaryCard({ stepKey, step, analysis, isEn, isStreaming }: {
  stepKey: string; step: any | null; analysis: any; isEn: boolean; isStreaming: boolean;
}) {
  const cfg = STEP_CFG[stepKey];
  const isDone = !!step;
  const content = isDone ? buildCardContent(stepKey, step.content ?? "", analysis, isEn) : null;

  return (
    <div className="rounded-2xl p-4" style={{
      background: isDone
        ? `linear-gradient(145deg,${ab(cfg.rgb, 0.1)} 0%,rgba(255,255,255,0.02) 100%)`
        : "rgba(255,255,255,0.03)",
      border: isDone ? bd(cfg.rgb, 0.2) : "1px solid rgba(255,255,255,0.07)",
      minHeight: "200px",
    }}>
      {/* 카드 헤더 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{cfg.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-white text-sm leading-tight">
            {isEn ? cfg.labelEn : cfg.label}
          </div>
        </div>
        {isDone && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
        {isStreaming && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: cfg.hex }} />}
        {!isDone && !isStreaming && <Clock className="w-3.5 h-3.5 text-white/20 shrink-0" />}
      </div>

      {/* 카드 본문 */}
      {isDone ? content : (
        <div className="flex flex-col gap-2 mt-2">
          {isStreaming ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: cfg.hex }}>
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{isEn ? "Analyzing…" : "분석 중…"}</span>
            </div>
          ) : (
            <div className="space-y-2 mt-1">
              {[80, 60, 40].map((w, i) => (
                <div key={i} className="h-3 rounded-full" style={{ background: "rgba(255,255,255,0.06)", width: `${w}%` }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function SummaryCardsB({ analysis, isEn = false, streamingStepKey }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);

  const stepMap = useMemo(() => {
    const map: Record<string, any> = {};
    for (const s of (analysis.steps ?? [])) map[s.stepKey] = s;
    return map;
  }, [analysis.steps]);

  const completedCount = useMemo(
    () => ANALYSIS_STEPS_ORDER.filter(k => stepMap[k]).length,
    [stepMap]
  );

  // 아직 어떤 스텝도 완료되지 않았으면 렌더링 안 함
  if (completedCount === 0 && !streamingStepKey) return null;

  const total = ANALYSIS_STEPS_ORDER.length;
  const safe = Math.min(activeIdx, total - 1);
  const currentStepKey = ANALYSIS_STEPS_ORDER[safe];
  const cfg = STEP_CFG[currentStepKey];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="print:hidden"
    >
      {/* 섹션 헤더 */}
      <div className="mb-4">
        <div className="flex items-center gap-2.5 mb-1">
          <span className="text-base font-semibold text-foreground">
            {isEn ? "Key Takeaways" : "바쁜 분들을 위한 핵심 요약"}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full border border-border/50 text-muted-foreground/60 bg-white/[0.03]">
            {completedCount}/{total}
          </span>
        </div>
        <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
          {streamingStepKey
            ? (isEn
                ? "Report is being written. Check the key points of each step so far."
                : "보고서가 작성되는 동안 지금까지 완료된 단계의 핵심을 미리 확인해보세요.")
            : (isEn
                ? "Here are the key takeaways from each step of the analysis."
                : "분석 각 단계의 핵심 내용만 추려 정리했습니다.")}
        </p>
      </div>

      <div className="rounded-2xl overflow-hidden"
        style={{ background: "#111111", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="p-4 sm:p-5">

          {/* 카드 본문 슬라이드 */}
          <AnimatePresence mode="wait">
            <motion.div key={currentStepKey}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18 }}>
              <StepSummaryCard
                stepKey={currentStepKey}
                step={stepMap[currentStepKey] ?? null}
                analysis={analysis}
                isEn={isEn}
                isStreaming={streamingStepKey === currentStepKey}
              />
            </motion.div>
          </AnimatePresence>

          {/* 네비게이션 */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setActiveIdx(i => Math.max(0, i - 1))}
              disabled={safe === 0}
              className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-all",
                safe === 0 ? "bg-white/4 text-white/20 cursor-not-allowed" : "bg-white/10 text-white hover:bg-white/15")}
            ><ChevronLeft className="w-4 h-4" /></button>

            {/* 스텝 도트 */}
            <div className="flex gap-1.5 items-center">
              {ANALYSIS_STEPS_ORDER.map((k, i) => {
                const done = !!stepMap[k];
                const active = i === safe;
                const streaming = streamingStepKey === k;
                return (
                  <button key={k} onClick={() => setActiveIdx(i)}
                    className="rounded-full transition-all"
                    style={{
                      width: active ? "20px" : "7px",
                      height: "7px",
                      background: active
                        ? cfg.hex
                        : done
                        ? "rgba(255,255,255,0.4)"
                        : streaming
                        ? `rgba(${STEP_CFG[k].rgb},0.5)`
                        : "rgba(255,255,255,0.1)",
                    }}
                  />
                );
              })}
            </div>

            <button
              onClick={() => setActiveIdx(i => Math.min(total - 1, i + 1))}
              disabled={safe === total - 1}
              className={cn("w-9 h-9 rounded-full flex items-center justify-center transition-all",
                safe === total - 1 ? "bg-white/4 text-white/20 cursor-not-allowed" : "bg-white/10 text-white hover:bg-white/15")}
            ><ChevronRight className="w-4 h-4" /></button>
          </div>

          {/* 빠른 탭 */}
          <div className="flex gap-1.5 mt-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {ANALYSIS_STEPS_ORDER.map((k, i) => {
              const done = !!stepMap[k];
              const active = i === safe;
              const streaming = streamingStepKey === k;
              const c = STEP_CFG[k];
              return (
                <button key={k} onClick={() => setActiveIdx(i)}
                  className="flex-shrink-0 rounded-full px-2.5 py-1.5 text-xs flex items-center gap-1 transition-all"
                  style={{
                    background: active ? `rgba(${c.rgb},0.15)` : "rgba(255,255,255,0.05)",
                    color: active ? c.hex : done ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.2)",
                    border: `1px solid ${active ? `rgba(${c.rgb},0.3)` : "transparent"}`,
                  }}>
                  {c.emoji}
                  <span className="hidden sm:inline">{isEn ? c.labelEn : c.label}</span>
                  {streaming && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
