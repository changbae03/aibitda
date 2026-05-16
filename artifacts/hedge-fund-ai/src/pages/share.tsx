import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight, TrendingUp, TrendingDown,
  Target, Building2, Loader2, AlertCircle,
  Check, Link2, ShieldCheck, Globe2, PieChart, BarChart2, Zap, Scale,
} from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import StockChart, { type ChartLevels, type ChartEvent } from "@/components/StockChart";

function isUSTicker(ticker: string) {
  if (!ticker) return false;
  return /^[A-Z]{1,5}$/.test(ticker) || ticker.endsWith(".US");
}

function verdictStyle(verdict: string | null) {
  switch (verdict) {
    case "Strong Buy":  return { label: "높은 상승여력", color: "text-emerald-400", bg: "bg-emerald-400/15 border-emerald-400/30" };
    case "Buy":         return { label: "상승여력",      color: "text-green-400",   bg: "bg-green-400/15 border-green-400/30" };
    case "Hold":        return { label: "적정 수준",     color: "text-amber-400",   bg: "bg-amber-400/15 border-amber-400/30" };
    case "Sell":        return { label: "하락여지",      color: "text-red-400",     bg: "bg-red-400/15 border-red-400/30" };
    case "Strong Sell": return { label: "높은 하락여지", color: "text-rose-400",    bg: "bg-rose-400/15 border-rose-400/30" };
    default:            return { label: verdict ?? "—",  color: "text-slate-400",   bg: "bg-slate-400/15 border-slate-400/30" };
  }
}

function upside(target: number | null, entry: number | null) {
  if (!target || !entry) return null;
  return ((target - entry) / entry) * 100;
}

function countTableCols(row: string): number { return row.split("|").length - 2; }
function isSeparatorRow(row: string): boolean {
  if (!/^\s*\|/.test(row)) return false;
  const cells = row.split("|").slice(1, -1);
  return cells.length > 0 && cells.every(c => /^[\s\-:]+$/.test(c)) && cells.some(c => c.includes("-"));
}
function mergeRowsToTarget(rows: string[], targetCols: number): string[] {
  if (rows.length === 0) return rows;
  const out: string[] = [];
  let current = rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (countTableCols(current) < targetCols) {
      current = current.trimEnd().replace(/\|\s*$/, "") + rows[i].trimStart();
    } else { out.push(current); current = rows[i]; }
  }
  out.push(current);
  return out;
}
function fixSplitTableRows(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!/^\s*\|/.test(line)) { out.push(line); i++; continue; }
    const block: string[] = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) { block.push(lines[i]); i++; }
    const sepIdx = block.findIndex(l => isSeparatorRow(l));
    if (sepIdx < 0) { out.push(...block); continue; }
    const targetCols = countTableCols(block[sepIdx]);
    out.push(...mergeRowsToTarget(block.slice(0, sepIdx), targetCols));
    out.push(block[sepIdx]);
    out.push(...mergeRowsToTarget(block.slice(sepIdx + 1), targetCols));
  }
  return out.join("\n");
}

const STEP_META: Record<string, { name: string; role: string; Icon: React.ElementType; accent: string }> = {
  company_intro:       { name: "브리핑",                role: "Lead Portfolio Strategist",     Icon: ShieldCheck, accent: "border-blue-500/30 bg-blue-500/5" },
  industry_analysis:   { name: "매크로 및 산업 분석",   role: "Macro & Industry Analyst",      Icon: Globe2,      accent: "border-sky-500/30 bg-sky-500/5" },
  catalyst_analysis:   { name: "투자 촉매 및 수급 분석",role: "Catalyst & Smart Money Analyst",Icon: Zap,         accent: "border-amber-500/30 bg-amber-500/5" },
  company_analysis:    { name: "실적 전망",             role: "Financial Analyst",             Icon: PieChart,    accent: "border-violet-500/30 bg-violet-500/5" },
  relative_valuation:  { name: "적정주가 산출",         role: "Valuation Analyst",             Icon: Scale,       accent: "border-emerald-500/30 bg-emerald-500/5" },
  market_analysis:     { name: "기술적 분석",           role: "Market & Technical Analyst",    Icon: BarChart2,   accent: "border-rose-500/30 bg-rose-500/5" },
  investment_strategy: { name: "최종 결론",             role: "Lead Portfolio Strategist",     Icon: ShieldCheck, accent: "border-blue-500/30 bg-blue-500/5" },
};

function stripInternalData(content: string): string {
  return content
    // 내부 데이터 블록 제거
    .replace(/\n?---\n[\s\S]*?CHART_DATA:\{[^\n]+\}[\s\S]*$/, "")
    .replace(/\nCHART_DATA:\{[^\n]+\}\s*(\nEVENTS_DATA:\[[^\n]*\])?\s*$/m, "")
    .replace(/\nEVENTS_DATA:\[[^\n]*\]\s*$/m, "")
    .replace(/\nVALUATION_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/\nFINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/^FINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/FINAL_VALUATION_DATA:\{[^}]+\}/g, "")
    .replace(/\nMARKET_SIGNALS_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/^MARKET_SIGNALS_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/MARKET_SIGNALS_DATA:\{[^\n]+\}/g, "")
    .replace(/\nSEGMENT_FORECAST_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/^SEGMENT_FORECAST_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/SEGMENT_FORECAST_DATA:\{[^\n]+\}/g, "")
    .replace(/\nFORWARD_ESTIMATES_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/^FORWARD_ESTIMATES_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/FORWARD_ESTIMATES_DATA:\{[^\n]+\}/g, "")
    // AI 프롬프트 지시문 제거 (공유 페이지에 노출되면 안 되는 내부 지침)
    .replace(/^\[STEP \d+\][^\n]*/gm, "")
    .replace(/^아래 수치를 이전 단계에서[^\n]*/gm, "")
    .replace(/^아래 기준에 따라 전략 유형을[^\n]*/gm, "")
    .replace(/^선택하지 않은 섹션은[^\n]*/gm, "")
    .replace(/^현재 종목의 Base upside[^\n]*/gm, "")
    .replace(/^따라서 \[.+\] 전략을[^\n]*/gm, "")
    // JSON 블록 제거 (investment_strategy 전용)
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/\{[\s\S]*"verdict"[\s\S]*\}/g, "")
    // 연속된 빈 줄 정리
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseChartLevels(content: string): {
  support?: number; resistance?: number;
  entryMin?: number; entryMax?: number;
  stopLoss?: number; target1?: number; target2?: number;
} | null {
  const match = content.match(/CHART_DATA:(\{[^\n]+\})/);
  if (!match) return null;
  try {
    const d = JSON.parse(match[1].replace(/,\s*([}\]])/g, "$1"));
    return d;
  } catch { return null; }
}

function ShareChartLevels({ content, currency }: { content: string; currency: "KRW" | "USD" }) {
  const levels = parseChartLevels(content);
  if (!levels) return null;

  const rows = [
    levels.target2 != null && { label: "2차 목표가", value: levels.target2, color: "text-emerald-300", dot: "bg-emerald-400" },
    levels.target1 != null && { label: "1차 목표가", value: levels.target1, color: "text-emerald-400", dot: "bg-emerald-500" },
    levels.resistance != null && { label: "저항선", value: levels.resistance, color: "text-amber-400", dot: "bg-amber-400" },
    levels.entryMax != null && levels.entryMin != null && {
      label: "진입 구간",
      value: `${formatCurrency(levels.entryMin, currency)} ~ ${formatCurrency(levels.entryMax, currency)}`,
      isRange: true,
      color: "text-blue-300", dot: "bg-blue-400"
    },
    levels.support != null && { label: "지지선", value: levels.support, color: "text-slate-300", dot: "bg-slate-400" },
    levels.stopLoss != null && { label: "손절 기준", value: levels.stopLoss, color: "text-red-400", dot: "bg-red-400" },
  ].filter(Boolean) as { label: string; value: number | string; isRange?: boolean; color: string; dot: string }[];

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3.5 mb-4">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">주요 가격 레벨</p>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.dot}`} />
              <span className="text-[11px] text-slate-400">{row.label}</span>
            </div>
            <span className={`text-[13px] font-bold font-mono tabular-nums ${row.color}`}>
              {row.isRange ? row.value : formatCurrency(row.value as number, currency)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function parseChartEvents(content: string): ChartEvent[] {
  const match = content.match(/EVENTS_DATA:(\[[^\n]*\])/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]) as ChartEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(e => e.date && e.label && /^\d{4}-\d{2}$/.test(e.date)).slice(0, 6);
  } catch { return []; }
}

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="
      text-[15px] leading-[1.95] text-slate-300 break-keep
      [&_h1]:text-[18px] [&_h1]:font-bold [&_h1]:text-white [&_h1]:mt-9 [&_h1]:mb-3 [&_h1]:pb-3 [&_h1]:border-b [&_h1]:border-slate-700/60
      [&_h2]:text-[16px] [&_h2]:font-bold [&_h2]:text-white [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:pb-2 [&_h2]:border-b [&_h2]:border-slate-700/40
      [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-slate-100 [&_h3]:mt-6 [&_h3]:mb-2
      [&_h4]:text-[14px] [&_h4]:font-semibold [&_h4]:text-slate-200 [&_h4]:mt-5 [&_h4]:mb-2
      [&_p]:text-slate-300 [&_p]:leading-[1.95] [&_p]:my-4
      [&_strong]:text-slate-100 [&_strong]:font-semibold
      [&_em]:text-slate-400 [&_em]:not-italic
      [&_ul]:my-4 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:text-slate-300
      [&_ol]:my-4 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol]:text-slate-300
      [&_li]:my-2 [&_li]:text-slate-300 [&_li]:leading-[1.85]
      [&_hr]:border-slate-700 [&_hr]:my-6
      [&_blockquote]:border-l-2 [&_blockquote]:border-slate-600 [&_blockquote]:pl-4 [&_blockquote]:text-slate-400 [&_blockquote]:my-5 [&_blockquote]:italic
      [&_code]:text-slate-300 [&_code]:bg-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px]
      [&_pre]:bg-slate-800 [&_pre]:p-4 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-4
      [&_a]:text-blue-400 [&_a]:underline [&_a:hover]:text-blue-300
    ">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="overflow-x-auto -mx-1 my-5">
              <table className="w-full text-[14px] border-collapse">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="text-slate-200 font-semibold border border-slate-700 px-3 py-2.5 text-left bg-slate-800/60 text-[12px] break-keep leading-snug">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="text-slate-300 border border-slate-800 px-3 py-2.5 text-[13px] break-keep leading-relaxed">
              {children}
            </td>
          ),
          del: () => null,
        }}
      >
        {fixSplitTableRows(stripInternalData(content))}
      </ReactMarkdown>
    </div>
  );
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();

  // 0) FINAL_VALUATION_DATA 제거 — lastIndexOf("}")가 이 블록 끝을 잡아 파싱 실패 유발
  s = s.replace(/FINAL_VALUATION_DATA:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/g, "").trim();

  // 1) 마크다운 코드블록 제거
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  // 2) 첫 { 부터 매칭되는 } 까지만 추출 — 중괄호 카운팅 방식
  const startIdx = s.indexOf("{");
  if (startIdx === -1) return null;
  let depth = 0, endIdx = -1, inString = false, escaped = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return null;
  s = s.slice(startIdx, endIdx + 1);

  try { return JSON.parse(s); } catch { /* */ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { /* */ }
  try { return JSON.parse(s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")); } catch { /* */ }
  try {
    const fixedNl = s.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner) =>
      `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`);
    return JSON.parse(fixedNl);
  } catch { /* */ }
  try {
    const fixedNlComma = s
      .replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner) =>
        `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`)
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fixedNlComma);
  } catch { return null; }
}

function fmtPrice(v: any, currency: "KRW" | "USD"): string {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n === 0) return "—";
  return formatCurrency(n, currency);
}

function ShareInvestmentCard({ content, currency }: { content: string; currency: "KRW" | "USD" }) {
  const json = extractJson(content);
  if (!json) return null;

  const verdictStr = String(json.verdict ?? "").toLowerCase();
  const isSell = verdictStr.includes("sell");

  const verdictLabel = () => {
    if (verdictStr.includes("strong buy"))  return { label: "높은 상승여력", color: "text-emerald-400" };
    if (verdictStr.includes("buy"))         return { label: "상승여력",      color: "text-emerald-400" };
    if (verdictStr.includes("strong sell")) return { label: "높은 하락여지", color: "text-red-400" };
    if (verdictStr.includes("sell"))        return { label: "하락여지",      color: "text-red-400" };
    return { label: "적정 수준", color: "text-amber-400" };
  };
  const vm = verdictLabel();

  const tp = parseFloat(String(json.target_price ?? "").replace(/[^0-9.]/g, "")) || null;
  const cp = parseFloat(String(json.current_price ?? "").replace(/[^0-9.]/g, "")) || null;
  const ep = parseFloat(String(json.entry_price ?? "").replace(/[^0-9.]/g, "")) || null;
  const sl = parseFloat(String(json.stop_loss ?? "").replace(/[^0-9.]/g, "")) || null;

  const baseScenario = json.scenarios?.find((s: any) => s.case === "Base");
  const upsideNum = parseFloat(String(baseScenario?.upside ?? ""));
  const upsideFromCurrent = !isNaN(upsideNum) ? upsideNum : (cp && tp && cp > 0) ? (tp - cp) / cp * 100 : null;

  const entryVsCurrent = cp && ep && cp > 0 ? ((ep - cp) / cp * 100).toFixed(1) : null;
  const slPct = !isSell && ep && sl && ep > 0
    ? Math.abs((sl - ep) / ep * 100).toFixed(1)
    : cp && sl && cp > 0 ? Math.abs((sl - cp) / cp * 100).toFixed(1) : null;

  return (
    <div className="space-y-5">
      {/* 판정 + 메타 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={cn("text-[22px] font-black leading-none", vm.color)}>{vm.label}</span>
        {json.confidence && (
          <span className="text-[12px] px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            신뢰도 {json.confidence}
          </span>
        )}
        {json.investment_period && (
          <span className="text-[12px] px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            {json.investment_period}
          </span>
        )}
        {json.risk_reward && (
          <span className="text-[12px] font-mono px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            손익비(R/R) {json.risk_reward}
          </span>
        )}
      </div>

      {/* 핵심 이슈 */}
      {json.key_issue && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3.5">
          <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-widest mb-1.5">핵심 이슈</p>
          <p className="text-[13px] text-slate-200 leading-[1.75] font-medium break-keep">{json.key_issue}</p>
        </div>
      )}

      {/* 투자 논거 요약 */}
      {json.summary && (
        <p className="text-[13px] text-slate-300 leading-[1.8] break-keep">{json.summary}</p>
      )}

      {/* 가격 3박스 */}
      {(ep || tp || sl) && (
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
            <p className="text-[11px] text-slate-500 mb-1.5 leading-tight">{isSell ? "재관심 기준가" : "진입가"}</p>
            <p className="text-[14px] font-bold text-slate-200 font-mono leading-none">{fmtPrice(json.entry_price, currency)}</p>
            {entryVsCurrent !== null && (
              <p className={cn("text-[11px] font-bold mt-1.5", parseFloat(entryVsCurrent) < 0 ? "text-rose-400" : "text-emerald-400")}>
                {parseFloat(entryVsCurrent) >= 0 ? "+" : ""}{entryVsCurrent}%
              </p>
            )}
          </div>
          <div className={cn(
            "rounded-xl border p-3",
            upsideFromCurrent !== null && upsideFromCurrent < 0
              ? "border-red-500/30 bg-red-500/10"
              : "border-emerald-500/30 bg-emerald-500/10"
          )}>
            <p className={cn("text-[11px] mb-1.5 leading-tight", upsideFromCurrent !== null && upsideFromCurrent < 0 ? "text-red-400" : "text-emerald-400")}>
              적정주가
            </p>
            <p className={cn("text-[14px] font-bold font-mono leading-none", upsideFromCurrent !== null && upsideFromCurrent < 0 ? "text-red-400" : "text-emerald-400")}>
              {fmtPrice(json.target_price, currency)}
            </p>
            {upsideFromCurrent !== null && (
              <p className={cn("text-[11px] font-bold mt-1.5", upsideFromCurrent < 0 ? "text-red-400" : "text-emerald-400")}>
                {upsideFromCurrent >= 0 ? "+" : ""}{upsideFromCurrent.toFixed(1)}%
              </p>
            )}
          </div>
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-[11px] text-red-400 mb-1.5 leading-tight">{isSell ? "청산 우선 구간" : "손절가"}</p>
            <p className="text-[14px] font-bold text-red-400 font-mono leading-none">{fmtPrice(json.stop_loss, currency)}</p>
            {slPct !== null && (
              <p className="text-[11px] font-bold text-red-400 mt-1.5">-{slPct}%</p>
            )}
          </div>
        </div>
      )}

      {/* 시나리오 */}
      {json.scenarios?.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-3">시나리오 분석</p>
          <div className="space-y-2.5">
            {json.scenarios.map((s: any, i: number) => {
              const isBear = s.case === "Bear";
              const isBull = s.case === "Bull";
              const uStr = String(s.upside ?? "");
              const uNum = parseFloat(uStr.replace(/[^0-9.\-]/g, ""));
              const uDisplay = !isNaN(uNum) ? (uNum >= 0 ? "+" : "") + uNum.toFixed(1) + "%" : uStr;
              const pNum = parseFloat(String(s.probability ?? "").replace(/[^0-9.]/g, ""));
              const tpStr = fmtPrice(s.target_price, currency);
              return (
                <div key={i} className={cn(
                  "rounded-xl border p-3.5 flex items-center gap-3",
                  isBear ? "border-red-500/25 bg-red-500/8" : isBull ? "border-emerald-500/25 bg-emerald-500/8" : "border-blue-500/20 bg-blue-500/5"
                )}>
                  <div className="w-14 shrink-0">
                    <p className={cn("text-[12px] font-bold", isBear ? "text-red-400" : isBull ? "text-emerald-400" : "text-blue-400")}>
                      {isBear ? "▼ 약세" : isBull ? "▲ 강세" : "— 기본"}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      {isBear ? "비관" : isBull ? "낙관" : "기본"}
                    </p>
                  </div>
                  <div className="flex-1 min-w-0">
                    {tpStr !== "—" && (
                      <p className={cn("text-[15px] font-bold font-mono leading-none mb-0.5",
                        isBear ? "text-red-300" : isBull ? "text-emerald-300" : "text-slate-200"
                      )}>{tpStr}</p>
                    )}
                    <p className={cn("text-[13px] font-semibold",
                      uNum > 0 ? "text-emerald-400" : uNum < 0 ? "text-red-400" : "text-slate-400"
                    )}>{uDisplay}</p>
                  </div>
                  {!isNaN(pNum) && (
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-slate-500 mb-0.5">확률</p>
                      <p className="text-[15px] font-bold text-slate-200 font-mono">{pNum}%</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const STEP_ORDER = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "relative_valuation",
  "market_analysis",
  "investment_strategy",
];

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(getApiUrl(`/api/analysis/share/${id}`))
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => { setAnalysis(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [id]);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(window.location.href); } catch {}
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };


  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        <p className="text-slate-400 text-sm">리포트를 불러오는 중...</p>
      </div>
    </div>
  );

  if (error || !analysis) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <AlertCircle className="w-8 h-8 text-slate-500" />
        <p className="text-slate-400 text-sm">리포트를 찾을 수 없습니다.</p>
      </div>
    </div>
  );

  const currency = isUSTicker(analysis.ticker) ? "USD" : "KRW";

  // investment_strategy 스텝 JSON을 1차 소스로 사용해 verdict 불일치 방지
  const stratJson = (() => {
    const stratStep = (analysis.steps ?? []).find((s: any) => s.stepKey === "investment_strategy");
    if (!stratStep?.content) return null;
    return extractJson(stratStep.content);
  })();
  const effectiveVerdict: string | null =
    (stratJson?.verdict as string | null) ?? analysis.investmentVerdict ?? null;

  const vs = verdictStyle(effectiveVerdict);
  const targetStr = analysis.targetPrice ? formatCurrency(analysis.targetPrice, currency) : null;
  const startPriceStr = analysis.startPrice ? formatCurrency(analysis.startPrice, currency) : null;
  const up = upside(analysis.targetPrice, analysis.startPrice ?? analysis.entryPrice);
  const createdAt = analysis.createdAt
    ? new Date(analysis.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const isPositive = effectiveVerdict === "Strong Buy" || effectiveVerdict === "Buy";
  const isNegative = effectiveVerdict === "Strong Sell" || effectiveVerdict === "Sell";
  const isSellVerdict = isNegative;

  const sortedSteps = [...(analysis.steps ?? [])].sort(
    (a: any, b: any) => STEP_ORDER.indexOf(a.stepKey) - STEP_ORDER.indexOf(b.stepKey)
  );

  const keyIssue = (stratJson?.key_issue as string | undefined) ?? null;

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/50">
        <div className="flex items-center gap-1.5">
          <span className="text-white font-black text-base tracking-tight">애빛다</span>
          <span className="hidden sm:inline text-slate-500 text-[11px] font-medium">AI 기업 가치 분석</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg border transition-all",
              copied
                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                : "border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500"
            )}
          >
            {copied ? <><Check className="w-3.5 h-3.5" />복사됨</> : <><Link2 className="w-3.5 h-3.5" />링크 복사</>}
          </button>
        </div>
      </div>

      {/* ── Hero ── */}
      <div className="flex flex-col items-center px-4 pt-5 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-2xl"
        >
          <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800">
            <div className={cn(
              "absolute top-0 right-0 w-40 h-40 rounded-full blur-3xl opacity-15 pointer-events-none",
              isPositive ? "bg-emerald-500" : isNegative ? "bg-red-500" : "bg-amber-500"
            )} />

            <div className="relative px-5 sm:px-7 pt-6 pb-5">
              <span className={cn(
                "inline-flex items-center text-[13px] font-bold px-3 py-1.5 rounded-full border mb-4",
                vs.bg, vs.color
              )}>
                {vs.label}
              </span>

              <h1 className="text-white text-[22px] sm:text-[26px] font-black leading-tight mb-1.5">
                {analysis.companyName}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <span className="text-slate-400 text-[14px] font-mono">{analysis.ticker}</span>
                {analysis.industry && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className="text-slate-500 text-[13px] flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate max-w-[180px]">{analysis.industry}</span>
                    </span>
                  </>
                )}
              </div>

              {keyIssue && (
                <div className={cn(
                  "rounded-xl px-4 py-3.5 mb-5 border-l-2",
                  isPositive
                    ? "bg-emerald-500/8 border-emerald-500/50"
                    : isNegative
                    ? "bg-red-500/8 border-red-500/50"
                    : "bg-amber-500/8 border-amber-500/50"
                )}>
                  <p className={cn(
                    "text-[13px] font-medium leading-[1.7] break-keep",
                    isPositive ? "text-emerald-200" : isNegative ? "text-red-200" : "text-amber-200"
                  )}>
                    {keyIssue}
                  </p>
                </div>
              )}

              {targetStr && (
                <div className="flex items-end justify-between gap-3 pb-5 border-b border-slate-800">
                  <div>
                    <p className="text-slate-400 text-[13px] font-medium mb-1.5 flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5" />적정주가
                    </p>
                    <p className="text-white text-[26px] sm:text-[30px] font-black leading-none tabular-nums">
                      {targetStr}
                    </p>
                  </div>
                  {up != null && (
                    <div className={cn("text-right shrink-0", up >= 0 ? "text-emerald-400" : "text-red-400")}>
                      <div className="flex items-center justify-end gap-1 mb-1">
                        {up >= 0
                          ? <TrendingUp className="w-5 h-5 shrink-0" />
                          : <TrendingDown className="w-5 h-5 shrink-0" />
                        }
                        <span className="text-[20px] sm:text-[22px] font-black tabular-nums">
                          {up >= 0 ? "+" : ""}{up.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-slate-500 text-[12px]">분석 당시 대비</p>
                    </div>
                  )}
                </div>
              )}

              {startPriceStr && (
                <div className="flex gap-4 pt-4">
                  <div>
                    <p className="text-slate-500 text-[12px] mb-1">분석 당시 현재가</p>
                    <p className="text-slate-200 text-[14px] font-bold tabular-nums">{startPriceStr}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 sm:px-7 py-3.5 bg-slate-800/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded bg-white/10 flex items-center justify-center shrink-0">
                  <span className="text-white text-[9px] font-black">AI</span>
                </span>
                <span className="text-slate-400 text-[13px]">애빛다 7단계 AI 분석</span>
              </div>
              {createdAt && <span className="text-slate-500 text-[12px]">{createdAt}</span>}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Full Report ── */}
      {sortedSteps.length > 0 && (
        <div className="flex flex-col items-center px-4 pb-10 gap-3">
          <div className="w-full max-w-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-slate-500 text-[11px] font-medium tracking-widest uppercase">전체 분석 리포트</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>

            <div className="flex flex-col gap-5">
              {sortedSteps.map((step: any, i: number) => {
                const meta = STEP_META[step.stepKey];
                if (!meta || !step.content) return null;
                const { Icon, name, role, accent } = meta;
                return (
                  <motion.div
                    key={step.stepKey}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: 0.04 * i }}
                    className={cn("rounded-2xl border overflow-hidden", accent)}
                  >
                    {/* 스텝 헤더 */}
                    <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5">
                      <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-slate-300" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-bold text-[13px] leading-tight">{name}</p>
                        <p className="text-slate-500 text-[11px] truncate mt-0.5">{role}</p>
                      </div>
                      <span className="text-slate-600 text-[11px] font-mono shrink-0">
                        {String(i + 1).padStart(2, "0")} / {sortedSteps.length}
                      </span>
                    </div>

                    {/* 스텝 본문 */}
                    <div className="px-5 py-7">
                      {step.stepKey === "investment_strategy" ? (
                        (() => {
                          const card = <ShareInvestmentCard content={step.content} currency={isUSTicker(analysis.ticker) ? "USD" : "KRW"} />;
                          if (card.props.content && extractJson(step.content)) return card;
                          return <MarkdownBody content={step.content} />;
                        })()
                      ) : step.stepKey === "market_analysis" ? (
                        <>
                          <ShareChartLevels
                            content={step.content}
                            currency={isUSTicker(analysis.ticker) ? "USD" : "KRW"}
                          />
                          <MarkdownBody content={step.content} />
                          <div className="mt-4 pt-4 border-t border-slate-700/60">
                            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">주가 차트</p>
                            <StockChart
                              ticker={analysis.ticker}
                              companyName={analysis.companyName ?? undefined}
                              chartLevels={parseChartLevels(step.content) ?? undefined}
                              events={parseChartEvents(step.content)}
                              currency={isUSTicker(analysis.ticker) ? "USD" : "KRW"}
                            />
                          </div>
                        </>
                      ) : (
                        <MarkdownBody content={step.content} />
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="mt-6 rounded-2xl overflow-hidden"
              style={{ background: "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 50%, #2563eb 100%)" }}
            >
              {/* 상단 배지 */}
              <div className="px-5 pt-5 pb-3">
                <div className="flex items-center justify-center gap-1.5 mb-3">
                  <span className="text-[10px] font-bold text-blue-200 uppercase tracking-[0.12em] bg-white/10 px-2.5 py-1 rounded-full">AI 기업가치 분석 플랫폼</span>
                </div>
                <p className="text-white font-black text-[20px] text-center leading-tight mb-1">
                  내 종목도 AI로 분석해보세요
                </p>
                <p className="text-blue-200 text-[12px] text-center leading-relaxed">
                  7단계 AI 파이프라인 · 코스피·코스닥·NYSE·NASDAQ
                </p>
              </div>

              {/* 기능 하이라이트 */}
              <div className="px-4 pb-4">
                <div className="grid grid-cols-3 gap-2 my-3">
                  {[
                    { icon: Target, label: "DCF 적정주가" },
                    { icon: ShieldCheck, label: "QC 자동검증" },
                    { icon: BarChart2, label: "기술적 분석" },
                  ].map(({ icon: Icon, label }) => (
                    <div key={label} className="flex flex-col items-center gap-1.5 bg-white/10 rounded-xl py-2.5 px-1">
                      <Icon className="w-4 h-4 text-blue-200" />
                      <span className="text-[10px] font-semibold text-white text-center leading-tight">{label}</span>
                    </div>
                  ))}
                </div>

                <motion.button
                  onClick={() => setLocation("/")}
                  whileTap={{ scale: 0.97 }}
                  className="w-full flex items-center justify-center gap-2 bg-white text-blue-700 font-black text-[15px] py-3.5 rounded-xl hover:bg-blue-50 transition-colors shadow-lg"
                >
                  지금 시작하기
                  <ArrowRight className="w-4.5 h-4.5" />
                </motion.button>
                <p className="text-[10px] text-blue-300/80 text-center mt-2">하루 3회 · 카카오 로그인</p>
              </div>
            </motion.div>

            {/* 면책 고지 */}
            <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-4">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-2">투자 위험 고지</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                본 보고서는 애빛다 AI가 공개 정보를 기반으로 자동 생성한 참고 자료이며, 투자 권유 또는 매매 추천이 아닙니다.
                제시된 적정주가·진입가·손절가·시나리오 등은 분석 시점의 데이터를 바탕으로 한 추정치이며, 실제 주가와 다를 수 있습니다.
                모든 투자 판단과 그에 따른 결과의 책임은 투자자 본인에게 있으며, CBST 및 애빛다는 어떠한 투자 손실에 대해서도 법적 책임을 지지 않습니다.
                과거 수익률이 미래 성과를 보장하지 않습니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Steps 없을 때 CTA */}
      {sortedSteps.length === 0 && (
        <div className="flex flex-col items-center px-4 pb-10">
          <div className="w-full max-w-md">
            <motion.button
              onClick={() => setLocation("/")}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.35 }}
              whileTap={{ scale: 0.97 }}
              className="mt-4 w-full flex items-center justify-center gap-2.5 bg-white text-slate-900 font-bold text-[15px] py-4 rounded-2xl hover:bg-slate-100 transition-colors"
            >
              애빛다로 내 종목 분석하기
              <ArrowRight className="w-4.5 h-4.5" />
            </motion.button>
          </div>
        </div>
      )}

      {/* ── Bottom brand ── */}
      <div className="px-4 py-4 text-center border-t border-slate-800/50 mt-auto">
        <p className="text-slate-600 text-[11px]">애빛다 · AI로 기업가치를 밝히다 · CBST</p>
      </div>
    </div>
  );
}
