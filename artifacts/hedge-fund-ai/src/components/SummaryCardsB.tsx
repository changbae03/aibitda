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
      const t = m[1].trim().replace(/\*\*/g, "").replace(/^\w+[:：]\s*/, "").slice(0, 180);
      if (t.length > 8) out.push(t);
    }
    if (out.length >= max) break;
  }
  return out;
}

// 실적 전망 테이블에서 2026E / 2027E 핵심 지표 파싱
type ForecastRow = { e26: string; e27: string };
interface ForecastTable {
  revenue?: ForecastRow;
  growth?: ForecastRow;
  opMargin?: ForecastRow;
  eps?: ForecastRow;
  revUnit: string;
}

function parseForecastTable(content: string): ForecastTable | null {
  const lines = content.split("\n");
  const headerIdx = lines.findIndex(
    l => l.includes("|") && l.includes("2026E") && l.includes("2027E")
  );
  if (headerIdx === -1) return null;

  const hCells = lines[headerIdx].split("|").map(c => c.trim());
  const c26 = hCells.findIndex(c => c === "2026E");
  const c27 = hCells.findIndex(c => c === "2027E");
  if (c26 === -1 || c27 === -1) return null;

  const result: ForecastTable = { revUnit: "" };

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) break;
    if (line.includes("---")) continue;
    const cells = line.split("|").map(c => c.trim().replace(/\*\*/g, ""));
    if (cells.length <= Math.max(c26, c27)) continue;
    const label = cells[1] ?? "";
    const e26 = cells[c26] ?? "—";
    const e27 = cells[c27] ?? "—";
    const unitM = label.match(/[（(]([^)）]+)[)）]/);
    if (/^매출\s*[（(]/.test(label) && !/성장|률/.test(label)) {
      result.revenue = { e26, e27 };
      result.revUnit = unitM?.[1] ?? "";
    } else if (/성장률/.test(label)) {
      result.growth = { e26, e27 };
    } else if (/영업이익률/.test(label)) {
      result.opMargin = { e26, e27 };
    } else if (/^EPS/.test(label)) {
      result.eps = { e26, e27 };
    }
  }
  return (result.revenue || result.opMargin || result.eps) ? result : null;
}

// 전망 해설에서 촉매 영향 첫 2문장 추출
function extractForecastNarrative(content: string, maxLen = 300): string {
  const lines = content.split("\n");
  const idx = lines.findIndex(l => l.includes("전망 해설") || l.includes("Forecast Commentary"));
  const start = idx !== -1 ? idx + 1 : 0;
  for (let i = start; i < Math.min(start + 15, lines.length); i++) {
    const l = lines[i].trim();
    if (l.length > 20 && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("-")) {
      const sentences = l.split(/(?<=[.。])\s+/);
      const text = sentences.slice(0, 3).join(" ");
      return text.slice(0, maxLen) + (text.length > maxLen ? "…" : "");
    }
  }
  return "";
}

function extractLeadText(content: string, maxLen = 280): string {
  const clean = content
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#+\s.+$/gm, "")
    .replace(/FINAL_VALUATION_DATA:\{[^\n]+\}/g, "")
    .replace(/VALUATION_DATA:\{[^\n]+\}/g, "")
    .replace(/\*\*/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
  // 충분히 긴 첫 두 문단을 합침
  const paras = clean.split("\n").filter(l => l.trim().length > 20);
  const text = paras.slice(0, 2).join(" ");
  return text.trim().slice(0, maxLen) + (text.length > maxLen ? "…" : "");
}

// 핵심 이슈 문장 추출 ("핵심 이슈는 X" or "핵심 이슈: X")
function extractKeyIssue(content: string, maxLen = 200): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const m = line.match(/핵심 이슈[는은이]?\s*['"]?([^.。\n]{10,})/);
    if (m) return m[1].replace(/\*\*/g, "").trim().slice(0, maxLen);
  }
  return "";
}

// 굵은 텍스트 (**...**) 추출 — 산업 분석 구조적 트렌드용
function extractBoldPoints(content: string, max = 3): string[] {
  const out: string[] = [];
  const re = /\*\*([^*]{6,80})\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const t = m[1].trim();
    // 헤더성 짧은 라벨(## 포함 줄) 제외
    if (t.length < 6 || /^(분석|개요|현황|요약|결론|Part|Step)/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
// 산업 분석 핵심 포인트 추출 — **레이블:** 뒤의 실제 설명 내용까지 함께 캡처
function extractIndustryPoints(content: string, max = 3): string[] {
  const out: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // 패턴 1: **레이블:** 또는 **레이블** 뒤에 설명이 이어지는 경우
    const m1 = trimmed.match(/\*\*([^*]{2,50})\*\*[\u{FF1A}:\s]+(.{15,})/u);
    if (m1) {
      const label = m1[1].trim();
      if (/^(분析|개요|현황|요약|결론|Part|Step|Industry|Market|구조|경쟁)/.test(label)) continue;
      const desc = m1[2].replace(/\*\*/g, "").trim().slice(0, 180);
      const point = desc.length > 15 ? desc : label + ": " + desc;
      if (!out.includes(point)) out.push(point);
      if (out.length >= max) break;
      continue;
    }

    // 패턴 2: 불릿 라인에 볼드가 포함된 경우 — 전체 라인이 핵심
    const m2 = trimmed.match(/^[-*\u2022]\s+(.{20,})/u);
    if (m2 && trimmed.includes("**")) {
      const text = m2[1].replace(/\*\*/g, "").trim().slice(0, 180);
      if (text.length > 18 && !/^(분析|개요|현황|요약|결론)/.test(text)) {
        if (!out.includes(text)) out.push(text);
        if (out.length >= max) break;
      }
    }
  }

  return out;
}



// 촉매 분석 — 핵심 이슈 상세 + 실현/미실현 시나리오 추출
function parseCatalystCard(content: string) {
  const lines = content.split("\n");

  /** idx 다음 줄부터 실제 내용(헤더/빈줄 아닌 것) 첫 번째 반환 */
  function nextContent(fromIdx: number, limit = 8): string {
    for (let i = fromIdx + 1; i < Math.min(fromIdx + limit, lines.length); i++) {
      const l = lines[i].replace(/\*\*/g, "").trim();
      // 헤더·라벨 줄 제외: # 시작, | 테이블, 이모지 + 짧은 레이블(:로 끝남), 빈줄
      if (!l || l.startsWith("#") || l.startsWith("|")) continue;
      if (l.length < 15) continue;
      if (/^[⚡🎯✅⚠️🐻🐂🔺🔻📈📉]\s/.test(l) && l.endsWith(":")) continue;
      return l.slice(0, 220);
    }
    return "";
  }

  /** 줄이 헤더/라벨인지 판단 */
  function isHeaderLine(s: string): boolean {
    if (s.length < 5) return true;
    if (s.endsWith(":") && s.length < 40) return true;
    if (/^[#]/.test(s)) return true;
    return false;
  }

  // 핵심 이슈 제목
  let issueDesc = "";
  const issueIdx = lines.findIndex(l => l.includes("핵심 이슈"));
  if (issueIdx !== -1) {
    issueDesc = nextContent(issueIdx, 8).slice(0, 220);
  }

  let bullCase = "";
  let bearCase = "";

  // bull: "실현되면" / "실현 시" 줄
  const bullIdx = lines.findIndex(l => l.includes("실현되면") || l.includes("실현 시"));
  if (bullIdx !== -1) {
    const raw = lines[bullIdx].replace(/\*\*/g, "").trim();
    const splitAt = raw.search(/반대로\s/);
    if (splitAt !== -1) {
      bullCase = raw.slice(0, splitAt).trim().slice(0, 220);
      bearCase = raw.slice(splitAt).trim().slice(0, 220);
    } else if (isHeaderLine(raw)) {
      bullCase = nextContent(bullIdx);
    } else {
      bullCase = raw.slice(0, 220);
    }
  }

  // bear: "미실현" / "반대로" 줄 (bull과 다른 줄)
  if (!bearCase) {
    const bearIdx = lines.findIndex((l, i) =>
      i !== bullIdx && (l.includes("미실현") || (l.includes("반대로") && l.length > 20))
    );
    if (bearIdx !== -1) {
      const raw = lines[bearIdx].replace(/\*\*/g, "").trim();
      bearCase = isHeaderLine(raw) ? nextContent(bearIdx) : raw.slice(0, 220);
    }
  }

  // 이슈 단계 (가속/초기/성숙 등)
  let phase = "";
  const phaseIdx = lines.findIndex(l => /본격|가속|초기|성숙|전환|단계에 있/.test(l));
  if (phaseIdx !== -1) {
    const m = lines[phaseIdx].match(/(본격 가속|초기 단계|성숙 단계|전환 단계|가속 단계)/);
    if (m) phase = m[1];
  }

  return { issueDesc, bullCase, bearCase, phase };
}

// 기술적 분석 — 지지/저항 테이블 + 추세 파싱
function parseTechnicalCard(content: string) {
  const lines = content.split("\n");

  // 추세 테이블 (장기/중기/단기)
  const trends: { label: string; value: string }[] = [];
  const trendIdx = lines.findIndex(l => l.includes("추세 요약") || (l.includes("장기 추세") && l.includes("|")));
  if (trendIdx !== -1) {
    for (let i = trendIdx; i < Math.min(trendIdx + 10, lines.length); i++) {
      const l = lines[i];
      if (!l.includes("|")) continue;
      const cells = l.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2 && /장기|중기|단기/.test(cells[0])) {
        const label = cells[0].replace(/장기 추세.*|중기 추세.*|단기 추세.*/, m => m.split(" ")[0]);
        const value = cells[1].replace(/\*\*/g, "").slice(0, 50);
        if (value.length > 4) trends.push({ label, value });
      }
      if (trends.length >= 3) break;
    }
  }

  // 지지/저항 테이블 — 섹션 헤더(지지·저항선 표) 또는 테이블 행에서 감지
  const levels: { label: string; price: string; basis: string }[] = [];
  // 섹션 헤더 또는 테이블 헤더 행 위치 찾기
  const levelSectionIdx = lines.findIndex(l =>
    l.includes("지지·저항") || l.includes("지지/저항") || l.includes("지지선") && l.includes("저항선")
  );
  const levelStartIdx = levelSectionIdx !== -1 ? levelSectionIdx : -1;
  if (levelStartIdx !== -1) {
    for (let i = levelStartIdx; i < Math.min(levelStartIdx + 20, lines.length); i++) {
      const l = lines[i];
      if (!l.includes("|")) continue;
      if (l.includes("---")) continue;
      const cells = l.split("|").map(c => c.trim().replace(/\*\*/g, "")).filter(Boolean);
      if (cells.length >= 2 && /지지|저항/.test(cells[0])) {
        levels.push({ label: cells[0], price: cells[1] ?? "", basis: cells[2] ?? "" });
      }
      if (levels.length >= 4) break;
    }
  }

  // 매매 신호 테이블 (📡 핵심 매매 신호) — 추가된 섹션
  const signals: { emoji: string; type: string; text: string }[] = [];
  const sigIdx = lines.findIndex(l => l.includes("핵심 매매 신호") || l.includes("매매 신호"));
  if (sigIdx !== -1) {
    for (let i = sigIdx; i < Math.min(sigIdx + 15, lines.length); i++) {
      const l = lines[i];
      if (!l.includes("|")) continue;
      const cells = l.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      const raw = cells[0];
      if (raw.includes("🔴") || raw.includes("매도")) {
        signals.push({ emoji: "🔴", type: "매도", text: (cells[1] ?? "").replace(/\*\*/g, "").slice(0, 60) });
      } else if (raw.includes("📈") || raw.includes("재진입")) {
        signals.push({ emoji: "📈", type: "재진입", text: (cells[1] ?? "").replace(/\*\*/g, "").slice(0, 60) });
      } else if (raw.includes("🛑") || raw.includes("손절")) {
        signals.push({ emoji: "🛑", type: "손절", text: (cells[1] ?? "").replace(/\*\*/g, "").slice(0, 60) });
      }
      if (signals.length >= 3) break;
    }
  }

  return { trends, levels, signals };
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

  // 실적 전망 카드: 촉매 → 2026E/2027E 핵심 지표
  if (stepKey === "company_analysis") {
    const cfg = STEP_CFG.company_analysis;
    const fc = parseForecastTable(content);
    const narrative = extractForecastNarrative(content);
    const years = [
      { label: isEn ? "2026E" : "2026E", rev: fc?.revenue?.e26, growth: fc?.growth?.e26, opm: fc?.opMargin?.e26, eps: fc?.eps?.e26 },
      { label: isEn ? "2027E" : "2027E", rev: fc?.revenue?.e27, growth: fc?.growth?.e27, opm: fc?.opMargin?.e27, eps: fc?.eps?.e27 },
    ];
    const hasTable = fc && (fc.revenue || fc.opMargin || fc.eps);
    return (
      <div className="flex flex-col gap-3">
        {narrative && (
          <p className="text-[12px] text-white/60 leading-relaxed">{narrative}</p>
        )}
        {hasTable ? (
          <div className="grid grid-cols-2 gap-2">
            {years.map(({ label, rev, growth, opm, eps }) => (
              <div key={label} className="rounded-xl p-3 flex flex-col gap-1.5"
                style={{ background: ab(cfg.rgb, 0.07), border: bd(cfg.rgb, 0.18) }}>
                <div className="text-[11px] font-bold mb-0.5" style={{ color: cfg.hex }}>{label}</div>
                {rev && (
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[10px] text-white/35 shrink-0">{isEn ? "Rev" : "매출"}</span>
                    <span className="text-xs font-semibold text-white text-right">
                      {rev}
                      {growth && growth !== "—" && (
                        <span className="ml-1 text-[10px] font-normal" style={{ color: cfg.hex }}>
                          {growth.startsWith("-") ? "" : "+"}{growth}%
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {opm && (
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[10px] text-white/35 shrink-0">{isEn ? "OPM" : "영업이익률"}</span>
                    <span className="text-xs font-semibold text-white">{opm}%</span>
                  </div>
                )}
                {eps && (
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-[10px] text-white/35 shrink-0">EPS</span>
                    <span className="text-xs font-semibold text-white">{eps}{isEn ? "" : "원"}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          // 테이블 파싱 실패 시 범용 불릿 fallback
          <div className="flex flex-col gap-2">
            {extractBullets(content, 3).map((b, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl p-3"
                style={{ background: i === 0 ? ab(cfg.rgb, 0.08) : "rgba(255,255,255,0.04)", border: i === 0 ? bd(cfg.rgb, 0.15) : "1px solid transparent" }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5"
                  style={{ background: ab(cfg.rgb, 0.2), color: cfg.hex }}>{i + 1}</div>
                <div className="text-white/80 text-sm leading-snug">{b}</div>
              </div>
            ))}
          </div>
        )}
        {fc?.revUnit && (
          <div className="text-[10px] text-white/25 text-right">단위: {fc.revUnit}</div>
        )}
      </div>
    );
  }

  // ── 브리핑 카드 ─────────────────────────────────────────────────────────────
  if (stepKey === "company_intro") {
    const cfg = STEP_CFG.company_intro;
    // 첫 문단에서 기업 설명 (1~2문장)
    const firstPara = extractLeadText(content, 160);
    // 핵심 이슈 문장
    const keyIssue = extractKeyIssue(content);
    // 불릿 fallback
    const bullets = extractBullets(content, 3);
    return (
      <div className="flex flex-col gap-3">
        {firstPara && (
          <p className="text-[12.5px] text-white/70 leading-relaxed">{firstPara}</p>
        )}
        {keyIssue && (
          <div className="rounded-xl px-3 py-2.5 flex items-start gap-2.5"
            style={{ background: ab(cfg.rgb, 0.1), border: bd(cfg.rgb, 0.25) }}>
            <span className="text-base shrink-0">🎯</span>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: cfg.hex }}>
                {isEn ? "Key Issue" : "핵심 이슈"}
              </div>
              <div className="text-[12px] text-white/85 leading-snug">{keyIssue}</div>
            </div>
          </div>
        )}
        {!keyIssue && bullets.length > 0 && (
          <div className="flex flex-col gap-2">
            {bullets.map((b, i) => (
              <div key={i} className="flex items-start gap-2 rounded-xl p-2.5"
                style={{ background: "rgba(255,255,255,0.04)" }}>
                <div className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
                  style={{ background: ab(cfg.rgb, 0.2), color: cfg.hex }}>{i + 1}</div>
                <div className="text-white/75 text-[12px] leading-snug">{b}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── 산업 분석 카드 ───────────────────────────────────────────────────────────
  if (stepKey === "industry_analysis") {
    const cfg = STEP_CFG.industry_analysis;
    const lead = extractLeadText(content, 200);
    const industryItems = (() => {
      const pts = extractIndustryPoints(content, 3);
      if (pts.length > 0) return pts;
      const bold = extractBoldPoints(content, 3);
      if (bold.length > 0) return bold;
      return extractBullets(content, 3);
    })();
    return (
      <div className="flex flex-col gap-2">
        {/* 리드 텍스트: 항목이 있을 때는 짧게, 없을 때는 길게 */}
        {lead && (
          <p className="text-[12px] text-white/65 leading-relaxed mb-1">
            {industryItems.length > 0 ? lead.slice(0, 160) + (lead.length > 160 ? "…" : "") : lead}
          </p>
        )}
        {industryItems.length > 0 ? (
          industryItems.map((b, i) => (
            <div key={i} className="flex items-start gap-2.5 rounded-xl p-3"
              style={{
                background: i === 0 ? ab(cfg.rgb, 0.08) : "rgba(255,255,255,0.04)",
                border: i === 0 ? bd(cfg.rgb, 0.2) : "1px solid transparent",
              }}>
              <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 mt-0.5"
                style={{ background: ab(cfg.rgb, 0.18), color: cfg.hex }}>{i + 1}</div>
              <div className="text-white/80 text-[12.5px] leading-snug">{b}</div>
            </div>
          ))
        ) : (
          !lead && <div className="text-sm text-white/30 italic">{isEn ? "No summary available." : "요약 내용 없음"}</div>
        )}
      </div>
    );
  }

  // ── 촉매 분석 카드 ───────────────────────────────────────────────────────────
  if (stepKey === "catalyst_analysis") {
    const cfg = STEP_CFG.catalyst_analysis;
    const { issueDesc, bullCase, bearCase, phase } = parseCatalystCard(content);
    const bullets = extractBullets(content, 3);
    return (
      <div className="flex flex-col gap-3">
        {issueDesc ? (
          <>
            <div className="rounded-xl px-3 py-2.5" style={{ background: ab(cfg.rgb, 0.1), border: bd(cfg.rgb, 0.25) }}>
              <div className="flex items-center gap-2 mb-1">
                <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: cfg.hex }}>
                  {isEn ? "Core Issue" : "핵심 이슈"}
                </div>
                {phase && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                    style={{ background: ab(cfg.rgb, 0.2), color: cfg.hex }}>{phase}</span>
                )}
              </div>
              <p className="text-[12px] text-white/85 leading-snug">{issueDesc}</p>
            </div>
            <div className="flex flex-col gap-2">
              {bullCase && (
                <div className="rounded-xl p-2.5" style={{ background: "rgba(122,232,180,0.06)", border: "1px solid rgba(122,232,180,0.15)" }}>
                  <div className="text-[9px] font-bold text-emerald-400 mb-1">✅ {isEn ? "If realized" : "실현 시"}</div>
                  <p className="text-[12px] text-white/70 leading-snug">{bullCase}</p>
                </div>
              )}
              {bearCase && (
                <div className="rounded-xl p-2.5" style={{ background: "rgba(255,138,122,0.06)", border: "1px solid rgba(255,138,122,0.15)" }}>
                  <div className="text-[9px] font-bold text-[#FF8A7A] mb-1">⚠️ {isEn ? "If not realized" : "미실현 시"}</div>
                  <p className="text-[12px] text-white/70 leading-snug">{bearCase}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            {bullets.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl p-3"
                style={{ background: i === 0 ? ab(cfg.rgb, 0.08) : "rgba(255,255,255,0.04)", border: i === 0 ? bd(cfg.rgb, 0.15) : "1px solid transparent" }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
                  style={{ background: ab(cfg.rgb, 0.2), color: cfg.hex }}>{i + 1}</div>
                <div className="text-white/80 text-[12.5px] leading-snug">{b}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── 기술적 분석 카드 ─────────────────────────────────────────────────────────
  if (stepKey === "market_analysis") {
    const cfg = STEP_CFG.market_analysis;
    const { trends, levels, signals } = parseTechnicalCard(content);
    const bullets = (signals.length === 0 && trends.length === 0 && levels.length === 0)
      ? extractBullets(content, 3) : [];

    return (
      <div className="flex flex-col gap-3">
        {/* 📡 매매 신호 테이블 — 우선 표시 */}
        {signals.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-0.5">
              {isEn ? "Key Signals" : "📡 핵심 매매 신호"}
            </div>
            {signals.map(s => (
              <div key={s.type} className="flex items-start gap-2 rounded-lg px-3 py-2"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <span className="text-sm shrink-0">{s.emoji}</span>
                <div>
                  <span className="text-[9px] font-bold text-white/40 mr-1.5">{s.type}</span>
                  <span className="text-[11.5px] text-white/80">{s.text}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 지지/저항 레벨 테이블 */}
        {levels.length > 0 && (
          <div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-white/40 mb-1.5">
              {isEn ? "Key Levels" : "지지 · 저항 레벨"}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {levels.slice(0, 4).map((lv, i) => {
                const isSupport = lv.label.includes("지지");
                const color = isSupport ? "#7AE8B4" : "#FF8A7A";
                return (
                  <div key={i} className="rounded-xl px-2.5 py-2 flex items-center justify-between gap-1"
                    style={{ background: "rgba(255,255,255,0.04)", border: `1px solid rgba(255,255,255,0.07)` }}>
                    <div>
                      <div className="text-[8.5px] text-white/35 mb-0.5">{lv.label}</div>
                      <div className="text-xs font-bold text-white tabular-nums">{lv.price}</div>
                    </div>
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 추세 요약 (신호/레벨 없을 때 또는 보완용) */}
        {trends.length > 0 && signals.length === 0 && (
          <div className="flex flex-col gap-1.5">
            {trends.map(tr => (
              <div key={tr.label} className="flex items-start gap-2.5 text-[11.5px]">
                <span className="text-white/30 shrink-0 w-10 text-right text-[10px]">{tr.label}</span>
                <span className="text-white/75 leading-snug">{tr.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* fallback */}
        {bullets.length > 0 && (
          <div className="flex flex-col gap-2">
            {bullets.map((b, i) => (
              <div key={i} className="flex items-start gap-2.5 rounded-xl p-3"
                style={{ background: i === 0 ? ab(cfg.rgb, 0.08) : "rgba(255,255,255,0.04)", border: i === 0 ? bd(cfg.rgb, 0.15) : "1px solid transparent" }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
                  style={{ background: ab(cfg.rgb, 0.2), color: cfg.hex }}>{i + 1}</div>
                <div className="text-white/80 text-sm leading-snug">{b}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── 범용 카드 (fallback) ──────────────────────────────────────────────────────
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
                  <span className="text-[10px]">{isEn ? c.labelEn : c.label}</span>
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
