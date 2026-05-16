import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, isUSTicker } from "@/lib/utils";

// ── 내부 파싱 헬퍼 ────────────────────────────────────────────────────────────

function parseFinalValuationData(content: string): { bear: number; base: number; bull: number; current: number } | null {
  const mlMatch = content.match(/FINAL_VALUATION_DATA:\s*(\{[\s\S]*?\})/);
  const raw = mlMatch?.[1] ?? content.match(/FINAL_VALUATION_DATA:\s*(\{[^\n]+\})/)?.[1];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.replace(/[\r\n\t]/g, " "));
    if (!parsed.base) return null;
    return parsed;
  } catch { return null; }
}

function parseStrategyJson(content: string): any | null {
  try {
    let s = content.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "");
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(s.slice(start, end + 1));
  } catch { return null; }
}

function extractBulletPoints(content: string, maxItems = 3): string[] {
  const lines = content.split("\n");
  const bullets: string[] = [];
  for (const line of lines) {
    const m = line.match(/^[-*•]\s+(.+)/);
    if (m) {
      const text = m[1].trim().replace(/^\*\*(.+)\*\*\s*[:：]?\s*/, "$1 ").replace(/\*\*/g, "");
      if (text.length > 5 && text.length < 120) bullets.push(text);
    }
    if (bullets.length >= maxItems) break;
  }
  return bullets;
}

// ── 색상 팔레트 ───────────────────────────────────────────────────────────────

const ACCENT: Record<string, { hex: string; rgb: string }> = {
  verdict:  { hex: "#FF8A7A", rgb: "255,138,122" },
  valuation:{ hex: "#7AB8FF", rgb: "122,184,255" },
  catalyst: { hex: "#7AE8B4", rgb: "122,232,180" },
  risk:     { hex: "#FFB87A", rgb: "255,184,122" },
};

function accentBg(rgb: string, opacity = 0.1) {
  return `rgba(${rgb},${opacity})`;
}
function accentBorder(rgb: string, opacity = 0.2) {
  return `1px solid rgba(${rgb},${opacity})`;
}

// ── 포맷 헬퍼 ─────────────────────────────────────────────────────────────────

function fmtPrice(val: number | null | undefined, isUS: boolean): string {
  if (val == null) return "—";
  if (isUS) return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `₩${Math.round(val).toLocaleString("ko-KR")}`;
}

function fmtPct(val: number): string {
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SummaryCardsBProps {
  analysis: any;
  isEn?: boolean;
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function SummaryCardsB({ analysis, isEn = false }: SummaryCardsBProps) {
  const [activeIdx, setActiveIdx] = useState(0);

  const isUS = isUSTicker(analysis.ticker ?? "");

  // ① investment_strategy JSON 파싱
  const stratJson = useMemo(() => {
    const step = (analysis.steps ?? []).find((s: any) => s.stepKey === "investment_strategy");
    return step?.content ? parseStrategyJson(step.content) : null;
  }, [analysis.steps]);

  // ② relative_valuation → Bear/Base/Bull
  const finalVal = useMemo(() => {
    const step = (analysis.steps ?? []).find((s: any) => s.stepKey === "relative_valuation");
    return step?.content ? parseFinalValuationData(step.content) : null;
  }, [analysis.steps]);

  // ③ 핵심 데이터 추출
  const verdict    = (analysis.investmentVerdict ?? stratJson?.verdict ?? "").toUpperCase();
  const targetP    = analysis.targetPrice ?? stratJson?.target_price ?? null;
  const entryP     = (analysis as any).entryPrice ?? stratJson?.entry_price ?? null;
  const stopL      = (analysis as any).stopLoss ?? stratJson?.stop_loss ?? null;
  const startP     = (analysis as any).startPrice ?? null;
  const currentP   = startP;

  const upsidePct  = targetP && startP && startP > 0 ? (targetP - startP) / startP * 100 : null;

  // R/R Ratio: (target - entry) / (entry - stop)
  const rrRatio = (() => {
    if (!targetP || !entryP || !stopL) return stratJson?.risk_reward_ratio ?? null;
    const gain = Math.abs(targetP - entryP);
    const risk = Math.abs(entryP - stopL);
    return risk > 0 ? gain / risk : null;
  })();

  // Bear/Base/Bull
  const scenarios = stratJson?.scenarios ?? [];
  const bear = finalVal?.bear ?? scenarios.find((s: any) => s.case === "Bear")?.target_price ?? null;
  const base = finalVal?.base ?? targetP;
  const bull = finalVal?.bull ?? scenarios.find((s: any) => s.case === "Bull")?.target_price ?? null;

  // 현재가 포지션 (Bear~Bull 사이 퍼센트)
  const range = bear && bull ? bull - bear : 0;
  const currentPct = bear && bull && currentP ? Math.max(2, Math.min(98, ((currentP - bear) / range) * 100)) : 50;
  const basePct    = bear && bull && base    ? Math.max(2, Math.min(98, ((base - bear) / range) * 100)) : 65;

  // 촉매
  const catalysts: string[] = useMemo(() => {
    if (stratJson?.catalysts?.length) return stratJson.catalysts.slice(0, 3);
    const catStep = (analysis.steps ?? []).find((s: any) => s.stepKey === "catalyst_analysis");
    if (catStep?.content) {
      const bullets = extractBulletPoints(catStep.content, 3);
      if (bullets.length) return bullets;
    }
    // Bull 시나리오 설명 fallback
    const bull = scenarios.find((s: any) => s.case === "Bull");
    if (bull?.description) return [bull.description];
    return [];
  }, [stratJson, analysis.steps, scenarios]);

  // 리스크
  const risks: string[] = useMemo(() => {
    if (stratJson?.risks?.length) return stratJson.risks.slice(0, 3);
    return [];
  }, [stratJson]);

  // ── 카드 정의 ─────────────────────────────────────────────────────────────

  const CARDS = useMemo(() => {
    const acc = ACCENT;
    const cards = [];

    // 카드 1: 투자 의견
    cards.push({
      id: "verdict",
      emoji: "🎯",
      title: isEn ? "Investment Verdict" : "투자 의견",
      subtitle: "Investment Verdict",
      accent: acc.verdict,
      content: (
        <div className="flex flex-col gap-4">
          <div className="flex items-end gap-4">
            <div>
              <div className="text-5xl sm:text-6xl font-black" style={{ color: acc.verdict.hex }}>
                {verdict || "—"}
              </div>
              <div className="text-white/50 text-sm mt-1">
                {isEn ? "12M Investment Verdict" : "12개월 투자의견"}
              </div>
            </div>
            <div className="text-right ml-auto">
              <div className="text-2xl sm:text-3xl font-bold text-white">
                {fmtPrice(targetP, isUS)}
              </div>
              {upsidePct !== null && (
                <div className="text-sm mt-1" style={{ color: acc.verdict.hex }}>
                  {isEn ? "Target" : "목표주가"} {fmtPct(upsidePct)}
                </div>
              )}
              {currentP && (
                <div className="text-xs text-white/40 mt-0.5">
                  {isEn ? "At analysis" : "분석 시점"} {fmtPrice(currentP, isUS)}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: isEn ? "Entry Price" : "진입가", value: fmtPrice(entryP, isUS) },
              { label: isEn ? "Stop Loss" : "손절선", value: fmtPrice(stopL, isUS) },
              { label: isEn ? "R/R Ratio" : "손익비", value: rrRatio ? `${rrRatio.toFixed(2)}:1` : "—" },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl p-3" style={{ background: accentBg(acc.verdict.rgb, 0.06) }}>
                <div className="text-xs text-white/40 mb-1">{item.label}</div>
                <div className="text-sm font-bold text-white">{item.value}</div>
              </div>
            ))}
          </div>

          {rrRatio && (
            <div className="rounded-2xl p-4 flex items-center justify-between"
              style={{ background: accentBg(acc.verdict.rgb, 0.1), border: accentBorder(acc.verdict.rgb, 0.2) }}>
              <div>
                <div className="text-xs text-white/50">{isEn ? "R/R Ratio" : "손익비 (R/R)"}</div>
                <div className="text-2xl font-black" style={{ color: acc.verdict.hex }}>
                  {rrRatio.toFixed(2)}:1
                </div>
              </div>
              <div className="text-xs text-white/40 text-right">
                {isEn ? `Upside is ${rrRatio.toFixed(1)}x` : `상방이 하방의`}<br/>
                {isEn ? "vs downside" : `${rrRatio.toFixed(1)}배`}
              </div>
            </div>
          )}
        </div>
      ),
    });

    // 카드 2: 밸류에이션 밴드
    if (bear && bull) {
      cards.push({
        id: "valuation",
        emoji: "💰",
        title: isEn ? "Valuation Band" : "밸류에이션",
        subtitle: "Valuation Band",
        accent: acc.valuation,
        content: (
          <div className="flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="text-2xl sm:text-3xl font-bold text-white">
                  {fmtPrice(base, isUS)}
                </div>
                <div className="text-sm text-white/50 mt-1">
                  {isEn ? "12M Target (Base)" : "12개월 목표주가 (Base)"}
                </div>
              </div>
              {upsidePct !== null && (
                <div className="rounded-xl px-3 py-1.5 text-sm font-bold"
                  style={{ background: accentBg(acc.valuation.rgb, 0.15), color: acc.valuation.hex }}>
                  {fmtPct(upsidePct)}
                </div>
              )}
            </div>

            {/* Bear~Bull 게이지 */}
            <div>
              <div className="flex justify-between text-xs text-white/40 mb-2">
                <span>Bear {fmtPrice(bear, isUS)}</span>
                {currentP && <span>{isEn ? "Now" : "현재가"} {fmtPrice(currentP, isUS)}</span>}
                <span>Bull {fmtPrice(bull, isUS)}</span>
              </div>
              <div className="relative h-3 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                <div className="absolute inset-0 rounded-full"
                  style={{ background: "linear-gradient(90deg,#FF5A5A 0%,#FF8A7A 30%,#7AB8FF 70%,#7AE8B4 100%)" }} />
                {/* 현재가 마커 */}
                {currentP && (
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                    style={{ left: `${currentPct}%` }}>
                    <div className="w-1 h-6 rounded-full bg-white shadow-md" />
                    <div className="text-[10px] text-white font-bold mt-1 whitespace-nowrap -translate-x-1/2">
                      {isEn ? "Now" : "현재"}
                    </div>
                  </div>
                )}
                {/* Base 마커 */}
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
                  style={{ left: `${basePct}%` }}>
                  <div className="w-3 h-3 rounded-full" style={{ background: acc.valuation.hex, border: "2px solid white" }} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: isEn ? "Bear" : "비관", value: fmtPrice(bear, isUS), color: "#FF8A7A" },
                { label: isEn ? "Base" : "기본", value: fmtPrice(base, isUS), color: acc.valuation.hex },
                { label: isEn ? "Bull" : "낙관", value: fmtPrice(bull, isUS), color: "#7AE8B4" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="text-xs text-white/40 mb-1">{item.label}</div>
                  <div className="text-sm font-bold" style={{ color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        ),
      });
    }

    // 카드 3: 핵심 촉매
    if (catalysts.length > 0) {
      cards.push({
        id: "catalyst",
        emoji: "🚀",
        title: isEn ? "Key Catalysts" : "핵심 촉매",
        subtitle: "Key Catalysts",
        accent: acc.catalyst,
        content: (
          <div className="flex flex-col gap-3">
            <div className="text-white/50 text-sm">
              {isEn ? "Key events driving the bull scenario" : "상승 시나리오를 견인하는 핵심 이벤트"}
            </div>
            {catalysts.map((c, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl p-4"
                style={{
                  background: i === 0 ? accentBg(acc.catalyst.rgb, 0.10) : "rgba(255,255,255,0.05)",
                  border: i === 0 ? accentBorder(acc.catalyst.rgb, 0.2) : "1px solid transparent",
                }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                  style={{ background: accentBg(acc.catalyst.rgb, 0.2), color: acc.catalyst.hex }}>
                  {i + 1}
                </div>
                <div>
                  <div className="text-white text-sm font-medium leading-snug">{c}</div>
                  {i === 0 && (
                    <div className="text-xs mt-1" style={{ color: acc.catalyst.hex }}>
                      ★ {isEn ? "Key monitoring indicator" : "핵심 모니터링 지표"}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ),
      });
    }

    // 카드 4: 주요 리스크
    if (risks.length > 0) {
      cards.push({
        id: "risk",
        emoji: "⚠️",
        title: isEn ? "Key Risks" : "주요 리스크",
        subtitle: "Key Risks",
        accent: acc.risk,
        content: (
          <div className="flex flex-col gap-3">
            <div className="text-white/50 text-sm">
              {isEn ? "Downside risks to monitor before investing" : "투자 전 반드시 확인해야 할 하방 리스크"}
            </div>
            {risks.map((r, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl p-4"
                style={{
                  background: i === 0 ? accentBg(acc.risk.rgb, 0.10) : "rgba(255,255,255,0.05)",
                  border: i === 0 ? accentBorder(acc.risk.rgb, 0.2) : "1px solid transparent",
                }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
                  style={{ background: accentBg(acc.risk.rgb, 0.2), color: acc.risk.hex }}>
                  !
                </div>
                <div className="text-white text-sm font-medium leading-snug">{r}</div>
              </div>
            ))}
          </div>
        ),
      });
    }

    return cards;
  }, [isEn, verdict, targetP, entryP, stopL, currentP, upsidePct, rrRatio, bear, base, bull, currentPct, basePct, catalysts, risks, isUS]);

  // 카드가 없으면 렌더링 안 함
  if (CARDS.length === 0) return null;

  const card = CARDS[Math.min(activeIdx, CARDS.length - 1)];
  const safeIdx = Math.min(activeIdx, CARDS.length - 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="print:hidden"
    >
      {/* 섹션 라벨 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-border/50" />
        <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest px-2">
          {isEn ? "Quick Summary" : "빠른 요약"}
        </span>
        <div className="h-px flex-1 bg-border/50" />
      </div>

      <div className="rounded-2xl overflow-hidden"
        style={{
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
        <div className="p-4 sm:p-5">
          {/* 카드 본문 */}
          <AnimatePresence mode="wait">
            <motion.div
              key={card.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div className="rounded-2xl p-4 sm:p-5"
                style={{
                  background: `linear-gradient(145deg, ${accentBg(card.accent.rgb, 0.1)} 0%, rgba(255,255,255,0.02) 100%)`,
                  border: accentBorder(card.accent.rgb, 0.2),
                  minHeight: "220px",
                }}>
                {/* 카드 헤더 */}
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">{card.emoji}</span>
                  <div>
                    <div className="font-bold text-white text-sm">{card.title}</div>
                    <div className="text-xs text-white/40">{card.subtitle}</div>
                  </div>
                  <div className="ml-auto rounded-full px-2.5 py-1 text-xs font-bold"
                    style={{ background: accentBg(card.accent.rgb, 0.15), color: card.accent.hex }}>
                    {safeIdx + 1}/{CARDS.length}
                  </div>
                </div>
                {card.content}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* 네비게이션 */}
          <div className="flex items-center justify-between mt-4">
            <button
              onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
              disabled={safeIdx === 0}
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center transition-all",
                safeIdx === 0
                  ? "bg-white/4 text-white/20 cursor-not-allowed"
                  : "bg-white/10 text-white hover:bg-white/15"
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* 도트 인디케이터 */}
            <div className="flex gap-1.5 items-center">
              {CARDS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  className="rounded-full transition-all"
                  style={{
                    width: i === safeIdx ? "20px" : "6px",
                    height: "6px",
                    background: i === safeIdx ? "#FF8A7A" : "rgba(255,255,255,0.2)",
                  }}
                />
              ))}
            </div>

            <button
              onClick={() => setActiveIdx((i) => Math.min(CARDS.length - 1, i + 1))}
              disabled={safeIdx === CARDS.length - 1}
              className={cn(
                "w-9 h-9 rounded-full flex items-center justify-center transition-all",
                safeIdx === CARDS.length - 1
                  ? "bg-white/4 text-white/20 cursor-not-allowed"
                  : "bg-white/10 text-white hover:bg-white/15"
              )}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* 빠른 탭 점프 */}
          <div className="flex gap-1.5 mt-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {CARDS.map((c, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className="flex-shrink-0 rounded-full px-3 py-1.5 text-xs flex items-center gap-1 transition-all"
                style={{
                  background: i === safeIdx ? "rgba(255,138,122,0.15)" : "rgba(255,255,255,0.05)",
                  color: i === safeIdx ? "#FF8A7A" : "rgba(255,255,255,0.4)",
                  border: `1px solid ${i === safeIdx ? "rgba(255,138,122,0.3)" : "transparent"}`,
                }}
              >
                {c.emoji} {c.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
