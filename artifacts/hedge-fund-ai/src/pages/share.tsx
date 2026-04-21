import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowRight, TrendingUp, TrendingDown,
  Target, ShieldAlert, Building2, Loader2, AlertCircle,
  Check, Link2, ShieldCheck, Globe2, PieChart, BarChart2, Zap, Scale,
} from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";

function isUSTicker(ticker: string) {
  if (!ticker) return false;
  return /^[A-Z]{1,5}$/.test(ticker) || ticker.endsWith(".US");
}

function verdictStyle(verdict: string | null) {
  switch (verdict) {
    case "Strong Buy": return { label: "높은 상승여력", color: "text-emerald-400", bg: "bg-emerald-400/15 border-emerald-400/30" };
    case "Buy": return { label: "상승여력", color: "text-green-400", bg: "bg-green-400/15 border-green-400/30" };
    case "Hold": return { label: "적정 수준", color: "text-amber-400", bg: "bg-amber-400/15 border-amber-400/30" };
    case "Sell": return { label: "하락여지", color: "text-red-400", bg: "bg-red-400/15 border-red-400/30" };
    case "Strong Sell": return { label: "높은 하락여지", color: "text-rose-400", bg: "bg-rose-400/15 border-rose-400/30" };
    default: return { label: verdict ?? "—", color: "text-slate-400", bg: "bg-slate-400/15 border-slate-400/30" };
  }
}

function upside(target: number | null, entry: number | null) {
  if (!target || !entry) return null;
  return ((target - entry) / entry) * 100;
}

const STEP_META: Record<string, { name: string; role: string; Icon: React.ElementType; accent: string }> = {
  company_intro: { name: "브리핑", role: "Lead Portfolio Strategist", Icon: ShieldCheck, accent: "border-blue-500/30 bg-blue-500/5" },
  industry_analysis: { name: "매크로 및 산업 분석", role: "Macro & Industry Analyst", Icon: Globe2, accent: "border-sky-500/30 bg-sky-500/5" },
  catalyst_analysis: { name: "투자 촉매 및 수급 분석", role: "Catalyst & Smart Money Analyst", Icon: Zap, accent: "border-amber-500/30 bg-amber-500/5" },
  company_analysis: { name: "실적 전망", role: "Financial Analyst", Icon: PieChart, accent: "border-violet-500/30 bg-violet-500/5" },
  relative_valuation: { name: "적정주가 산출", role: "Valuation Analyst", Icon: Scale, accent: "border-emerald-500/30 bg-emerald-500/5" },
  market_analysis: { name: "기술적 분석", role: "Market & Technical Analyst", Icon: BarChart2, accent: "border-rose-500/30 bg-rose-500/5" },
  investment_strategy: { name: "최종 결론", role: "Lead Portfolio Strategist", Icon: ShieldCheck, accent: "border-blue-500/30 bg-blue-500/5" },
};

function stripInternalData(content: string): string {
  return content
    .replace(/\nFINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/^FINAL_VALUATION_DATA:\{[^\n]+\}\s*$/m, "")
    .replace(/FINAL_VALUATION_DATA:\{[^}]+\}/g, "")
    .trim();
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { /* */ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { /* */ }
  try { return JSON.parse(s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")); } catch { return null; }
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
    if (verdictStr.includes("strong buy")) return { label: "높은 상승여력", color: "text-emerald-400" };
    if (verdictStr.includes("buy")) return { label: "상승여력", color: "text-emerald-400" };
    if (verdictStr.includes("strong sell")) return { label: "높은 하락여지", color: "text-red-400" };
    if (verdictStr.includes("sell")) return { label: "하락여지", color: "text-red-400" };
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
    <div className="space-y-4">
      {/* 판정 + 메타 */}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className={cn("text-[24px] font-black leading-none", vm.color)}>{vm.label}</span>
        {json.confidence && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            신뢰도 {json.confidence}
          </span>
        )}
        {json.investment_period && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            {json.investment_period}
          </span>
        )}
        {json.risk_reward && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
            R/R {json.risk_reward}
          </span>
        )}
      </div>

      {/* 핵심 이슈 */}
      {json.key_issue && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-widest mb-1">핵심 이슈</p>
          <p className="text-[13px] text-slate-200 leading-relaxed font-medium">{json.key_issue}</p>
        </div>
      )}

      {/* 투자 논거 요약 */}
      {json.summary && (
        <p className="text-[13px] text-slate-300 leading-relaxed">{json.summary}</p>
      )}

      {/* 가격 3박스 */}
      {(ep || tp || sl) && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
            <p className="text-[10px] text-slate-500 mb-1.5">{isSell ? "재관심 기준가" : "진입가"}</p>
            <p className="text-[14px] font-bold text-slate-200 font-mono leading-none">{fmtPrice(json.entry_price, currency)}</p>
            {entryVsCurrent !== null && (
              <p className={cn("text-[10px] font-bold mt-1", parseFloat(entryVsCurrent) < 0 ? "text-rose-400" : "text-emerald-400")}>
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
            <p className={cn("text-[10px] mb-1.5", upsideFromCurrent !== null && upsideFromCurrent < 0 ? "text-red-400" : "text-emerald-400")}>
              적정주가
            </p>
            <p className={cn("text-[14px] font-bold font-mono leading-none", upsideFromCurrent !== null && upsideFromCurrent < 0 ? "text-red-400" : "text-emerald-400")}>
              {fmtPrice(json.target_price, currency)}
            </p>
            {upsideFromCurrent !== null && (
              <p className={cn("text-[10px] font-bold mt-1", upsideFromCurrent < 0 ? "text-red-400" : "text-emerald-400")}>
                {upsideFromCurrent >= 0 ? "+" : ""}{upsideFromCurrent.toFixed(1)}%
              </p>
            )}
          </div>
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-[10px] text-red-400 mb-1.5">{isSell ? "청산 우선 구간" : "손절가"}</p>
            <p className="text-[14px] font-bold text-red-400 font-mono leading-none">{fmtPrice(json.stop_loss, currency)}</p>
            {slPct !== null && (
              <p className="text-[10px] font-bold text-red-400 mt-1">-{slPct}%</p>
            )}
          </div>
        </div>
      )}

      {/* 시나리오 */}
      {json.scenarios?.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2">시나리오 분석</p>
          <div className="space-y-2">
            {json.scenarios.map((s: any, i: number) => {
              const isBear = s.case === "Bear";
              const isBull = s.case === "Bull";
              const uStr = String(s.upside ?? "");
              const uNum = parseFloat(uStr.replace(/[^0-9.\-]/g, ""));
              const uDisplay = !isNaN(uNum) ? (uNum >= 0 ? "+" : "") + uNum.toFixed(1) + "%" : uStr;
              const pNum = parseFloat(String(s.probability ?? "").replace(/[^0-9.]/g, ""));
              return (
                <div key={i} className={cn(
                  "rounded-xl border p-3 flex items-center gap-3",
                  isBear ? "border-red-500/25 bg-red-500/8" : isBull ? "border-emerald-500/25 bg-emerald-500/8" : "border-slate-700 bg-slate-800/40"
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn("text-[11px] font-bold", isBear ? "text-red-400" : isBull ? "text-emerald-400" : "text-slate-300")}>
                        {s.case === "Bear" ? "약세" : s.case === "Bull" ? "강세" : "기본"}
                      </span>
                      <span className={cn("text-[12px] font-bold font-mono", isBear ? "text-red-400" : isBull ? "text-emerald-400" : "text-slate-200")}>
                        {uDisplay}
                      </span>
                    </div>
                    {s.description && (
                      <p className="text-[11px] text-slate-400 truncate">{s.description}</p>
                    )}
                  </div>
                  {!isNaN(pNum) && (
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] text-slate-500 mb-0.5">확률</p>
                      <p className="text-[14px] font-bold text-slate-300 font-mono">{pNum}%</p>
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
  const vs = verdictStyle(analysis.investmentVerdict);
  const targetStr = analysis.targetPrice ? formatCurrency(analysis.targetPrice, currency) : null;
  const entryStr = analysis.entryPrice ? formatCurrency(analysis.entryPrice, currency) : null;
  const stopStr = analysis.stopLoss ? formatCurrency(analysis.stopLoss, currency) : null;
  const up = upside(analysis.targetPrice, analysis.entryPrice);
  const createdAt = analysis.createdAt
    ? new Date(analysis.createdAt).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
    : null;

  const isPositive = analysis.investmentVerdict === "Strong Buy" || analysis.investmentVerdict === "Buy";
  const isNegative = analysis.investmentVerdict === "Strong Sell" || analysis.investmentVerdict === "Sell";
  const isSellVerdict = isNegative;

  const sortedSteps = [...(analysis.steps ?? [])].sort(
    (a: any, b: any) => STEP_ORDER.indexOf(a.stepKey) - STEP_ORDER.indexOf(b.stepKey)
  );

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800/50">
        <div className="flex items-center gap-2">
          <span className="text-white font-black text-lg tracking-tight">애빛다</span>
          <span className="text-slate-500 text-[11px] font-medium">AI 기업 가치 분석</span>
        </div>
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

      {/* ── Hero ── */}
      <div className="flex flex-col items-center px-5 pt-8 pb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-2xl"
        >
          {/* 메인 카드 */}
          <div className="relative rounded-3xl overflow-hidden border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800">
            <div className={cn(
              "absolute top-0 right-0 w-48 h-48 rounded-full blur-3xl opacity-20 pointer-events-none",
              isPositive ? "bg-emerald-500" : isNegative ? "bg-red-500" : "bg-amber-500"
            )} />

            <div className="relative px-6 pt-7 pb-5">
              <span className={cn(
                "inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full border mb-4",
                vs.bg, vs.color
              )}>
                {vs.label}
              </span>

              <h1 className="text-white text-[26px] font-black leading-tight mb-1">
                {analysis.companyName}
              </h1>
              <div className="flex items-center gap-2 mb-6">
                <span className="text-slate-400 text-[13px] font-mono">{analysis.ticker}</span>
                {analysis.industry && (
                  <>
                    <span className="text-slate-700">·</span>
                    <span className="text-slate-500 text-[12px] flex items-center gap-1">
                      <Building2 className="w-3 h-3" />{analysis.industry}
                    </span>
                  </>
                )}
              </div>

              {targetStr && (
                <div className="flex items-end justify-between pb-5 border-b border-slate-800">
                  <div>
                    <p className="text-slate-400 text-[11px] font-medium mb-1 flex items-center gap-1">
                      <Target className="w-3 h-3" />적정주가
                    </p>
                    <p className="text-white text-[32px] font-black leading-none tabular-nums">
                      {targetStr}
                    </p>
                  </div>
                  {up != null && (
                    <div className={cn("text-right", up >= 0 ? "text-emerald-400" : "text-red-400")}>
                      <div className="flex items-center justify-end gap-1 mb-0.5">
                        {up >= 0
                          ? <TrendingUp className="w-4 h-4" />
                          : <TrendingDown className="w-4 h-4" />
                        }
                        <span className="text-[22px] font-black tabular-nums">
                          {up >= 0 ? "+" : ""}{up.toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-slate-500 text-[10px]">분석 당시 대비 상승여력</p>
                    </div>
                  )}
                </div>
              )}

              {(entryStr || stopStr) && (
                <div className="flex gap-4 pt-5">
                  {entryStr && (
                    <div>
                      <p className="text-slate-500 text-[10px] mb-0.5">{isSellVerdict ? "재관심 기준가" : "진입가"}</p>
                      <p className="text-slate-200 text-[14px] font-bold tabular-nums">{entryStr}</p>
                    </div>
                  )}
                  {stopStr && (
                    <div>
                      <p className="text-slate-500 text-[10px] mb-0.5 flex items-center gap-1">
                        <ShieldAlert className="w-2.5 h-2.5" />{isSellVerdict ? "청산 우선 구간" : "손절가"}
                      </p>
                      <p className="text-red-400 text-[14px] font-bold tabular-nums">{stopStr}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-3 bg-slate-800/50 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-5 rounded bg-white/10 flex items-center justify-center">
                  <span className="text-white text-[8px] font-black">AI</span>
                </span>
                <span className="text-slate-400 text-[11px]">애빛다 7단계 AI 분석</span>
              </div>
              {createdAt && <span className="text-slate-600 text-[10px]">{createdAt}</span>}
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── Full Report ── */}
      {sortedSteps.length > 0 && (
        <div className="flex flex-col items-center px-5 pb-10 gap-4">
          <div className="w-full max-w-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-slate-800" />
              <span className="text-slate-500 text-[11px] font-medium tracking-widest uppercase">전체 분석 리포트</span>
              <div className="flex-1 h-px bg-slate-800" />
            </div>

            <div className="flex flex-col gap-4">
              {sortedSteps.map((step: any, i: number) => {
                const meta = STEP_META[step.stepKey];
                if (!meta || !step.content) return null;
                const { Icon, name, role, accent } = meta;
                return (
                  <motion.div
                    key={step.stepKey}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05 * i }}
                    className={cn(
                      "rounded-2xl border p-5",
                      accent
                    )}
                  >
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-8 h-8 rounded-xl bg-slate-800 flex items-center justify-center flex-shrink-0">
                        <Icon className="w-4 h-4 text-slate-300" />
                      </div>
                      <div>
                        <p className="text-white font-bold text-[14px] leading-tight">{name}</p>
                        <p className="text-slate-500 text-[11px]">{role}</p>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        <span className="text-slate-600 text-[10px] font-mono">
                          {String(i + 1).padStart(2, "0")} / {sortedSteps.length}
                        </span>
                      </div>
                    </div>

                    {step.stepKey === "investment_strategy" ? (
                      <ShareInvestmentCard
                        content={step.content}
                        currency={isUSTicker(analysis.ticker) ? "USD" : "KRW"}
                      />
                    ) : (
                    <div className="
                      text-[13px] leading-relaxed text-slate-300
                      [&_h1]:text-[16px] [&_h1]:font-bold [&_h1]:text-slate-200 [&_h1]:mt-4 [&_h1]:mb-2
                      [&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:text-slate-200 [&_h2]:mt-4 [&_h2]:mb-2
                      [&_h3]:text-[14px] [&_h3]:font-bold [&_h3]:text-slate-200 [&_h3]:mt-3 [&_h3]:mb-1.5
                      [&_h4]:text-[13px] [&_h4]:font-semibold [&_h4]:text-slate-200 [&_h4]:mt-3 [&_h4]:mb-1
                      [&_p]:text-slate-300 [&_p]:leading-relaxed [&_p]:my-2
                      [&_strong]:text-slate-100 [&_strong]:font-semibold
                      [&_em]:text-slate-400 [&_em]:not-italic
                      [&_ul]:my-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ul]:text-slate-300
                      [&_ol]:my-2 [&_ol]:pl-5 [&_ol]:list-decimal [&_ol]:text-slate-300
                      [&_li]:my-0.5 [&_li]:text-slate-300
                      [&_table]:w-full [&_table]:text-[12px] [&_table]:border-collapse [&_table]:my-3
                      [&_th]:text-slate-200 [&_th]:font-semibold [&_th]:border [&_th]:border-slate-700 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:bg-slate-800/60
                      [&_td]:text-slate-300 [&_td]:border [&_td]:border-slate-800 [&_td]:px-2 [&_td]:py-1.5
                      [&_tr:hover]:bg-slate-800/30
                      [&_hr]:border-slate-700 [&_hr]:my-4
                      [&_blockquote]:border-l-2 [&_blockquote]:border-slate-600 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_blockquote]:my-3
                      [&_code]:text-slate-300 [&_code]:bg-slate-800 [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px]
                      [&_pre]:bg-slate-800 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:my-3
                      [&_a]:text-blue-400 [&_a]:underline [&_a:hover]:text-blue-300
                    ">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {stripInternalData(step.content)}
                      </ReactMarkdown>
                    </div>
                    )}
                  </motion.div>
                );
              })}
            </div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="mt-8 rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center"
            >
              <p className="text-white font-bold text-[16px] mb-1">나도 AI 분석 받아보기</p>
              <p className="text-slate-400 text-[13px] mb-4">코스피·코스닥·NYSE·NASDAQ 전 종목, 하루 3회 무료</p>
              <button
                onClick={() => setLocation("/")}
                className="inline-flex items-center gap-2 bg-white text-slate-900 font-bold text-[14px] px-6 py-3 rounded-xl hover:bg-slate-100 transition-colors"
              >
                애빛다 시작하기
                <ArrowRight className="w-4 h-4" />
              </button>
            </motion.div>
          </div>
        </div>
      )}

      {/* Steps 없을 때 CTA */}
      {sortedSteps.length === 0 && (
        <div className="flex flex-col items-center px-5 pb-10">
          <div className="w-full max-w-md">
            <motion.button
              onClick={() => setLocation("/")}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.4 }}
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
      <div className="px-5 py-4 text-center border-t border-slate-800/50">
        <p className="text-slate-700 text-[11px]">
          애빛다 · AI로 기업가치를 밝히다 · CBST
        </p>
        <p className="text-slate-800 text-[10px] mt-1">
          본 분석은 AI가 자동 생성한 참고 정보입니다. 투자 판단의 최종 책임은 본인에게 있습니다.
        </p>
      </div>
    </div>
  );
}
