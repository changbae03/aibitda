import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Building2, Search, TrendingUp, TrendingDown,
  FileText, ExternalLink, Loader2, AlertCircle, ChevronRight,
  BarChart3, Shield, Lightbulb, DollarSign, X
} from "lucide-react";
import { getApiUrl, cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface DartCompany {
  corp_code: string;
  corp_name: string;
  stock_code: string | null;
  corp_cls: string;
  bizr_no: string | null;
}

interface FinancialRow {
  year: number;
  revenue?: number;
  op_income?: number;
  net_income?: number;
  total_assets?: number;
  total_liabilities?: number;
  equity?: number;
}

interface Disclosure {
  rcept_no: string;
  report_nm: string;
  rcept_dt: string;
  flr_nm: string;
  dartUrl: string;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function fmtBig(v: number | undefined): string {
  if (v == null || isNaN(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
  if (abs >= 1e8) return `${sign}${Math.round(abs / 1e8)}억`;
  if (abs >= 1e6) return `${sign}${Math.round(abs / 1e6)}백만`;
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

function fmtPct(v: number | undefined): string {
  if (v == null || isNaN(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function clsLabel(cls: string): string {
  return cls === "Y" ? "유가증권" : cls === "K" ? "코스닥" : cls === "N" ? "코넥스" : "비상장";
}

function clsColor(cls: string): string {
  return cls === "Y" || cls === "K" ? "text-blue-400" : cls === "N" ? "text-cyan-400" : "text-purple-400";
}

function dtFmt(dt: string): string {
  if (dt.length !== 8) return dt;
  return `${dt.slice(0, 4)}.${dt.slice(4, 6)}.${dt.slice(6, 8)}`;
}

// ── 마크다운 → JSX 간단 렌더러 ───────────────────────────────────────────────
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;
        if (line.startsWith("## ")) {
          return (
            <h3 key={i} className="text-sm font-bold text-foreground mt-4 mb-1 first:mt-0 border-b border-border/20 pb-1">
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith("### ")) {
          return <h4 key={i} className="text-xs font-semibold text-foreground/80 mt-3 mb-0.5">{line.slice(4)}</h4>;
        }
        if (line.startsWith("- ") || line.startsWith("• ")) {
          const content = line.slice(2);
          return (
            <div key={i} className="flex gap-2 text-xs text-foreground/80">
              <span className="text-muted-foreground/50 mt-0.5 shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
            </div>
          );
        }
        const html = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        return <p key={i} className="text-xs text-foreground/80 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}

// ── 재무 추이 미니 바 차트 ───────────────────────────────────────────────────
function MiniBarChart({ data, field, label, color }: {
  data: FinancialRow[];
  field: keyof FinancialRow;
  label: string;
  color: string;
}) {
  const vals = data.map(d => (d[field] as number) ?? 0);
  const max = Math.max(...vals.map(Math.abs), 1);
  const latest = vals[vals.length - 1];
  const prev = vals[vals.length - 2];
  const growth = prev && prev !== 0 ? ((latest - prev) / Math.abs(prev)) * 100 : null;

  return (
    <div className="rounded-xl bg-muted/10 border border-border/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60">{label}</span>
        {growth != null && (
          <span className={cn("text-[10px] font-semibold flex items-center gap-0.5", growth >= 0 ? "text-emerald-500" : "text-red-400")}>
            {growth >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {fmtPct(growth)}
          </span>
        )}
      </div>
      <div className="text-sm font-bold text-foreground">{fmtBig(latest)}<span className="text-[10px] text-muted-foreground/50 font-normal ml-1">원</span></div>
      <div className="flex items-end gap-1 h-8">
        {data.map((d, i) => {
          const v = (d[field] as number) ?? 0;
          const h = max > 0 ? Math.max(4, (Math.abs(v) / max) * 100) : 4;
          const isNeg = v < 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
              <div
                className={cn("w-full rounded-sm transition-all", isNeg ? "bg-red-400/50" : color)}
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between">
        {data.map(d => (
          <span key={d.year} className="text-[9px] text-muted-foreground/40">{d.year}</span>
        ))}
      </div>
    </div>
  );
}

// ── 검색 페이지 ───────────────────────────────────────────────────────────────
function SearchView({ onSelect }: { onSelect: (c: DartCompany) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DartCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(getApiUrl(`/api/market-data/dart-company-search?q=${encodeURIComponent(q.trim())}`));
        const data: DartCompany[] = await r.json();
        setResults(data);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [q]);

  return (
    <div className="flex flex-col items-center justify-start pt-16 px-4 min-h-screen">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center mx-auto">
            <Building2 size={22} className="text-purple-400" />
          </div>
          <h1 className="text-xl font-bold text-foreground">비상장 기업 분석</h1>
          <p className="text-sm text-muted-foreground/70">DART 공시 기반 재무 분석 · AI 투자 검토 리포트</p>
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
          <input
            autoFocus
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="회사명 입력 (예: 카카오, 쿠팡, 두나무)"
            className="w-full pl-10 pr-10 py-3 rounded-xl bg-muted/20 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-purple-500/40 focus:border-purple-500/40"
          />
          {loading && <Loader2 size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 animate-spin" />}
          {!loading && q && (
            <button onClick={() => { setQ(""); setResults([]); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground">
              <X size={14} />
            </button>
          )}
        </div>

        <AnimatePresence>
          {results.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="rounded-xl border border-border/30 bg-card/60 backdrop-blur-sm overflow-hidden divide-y divide-border/20">
              {results.map(c => (
                <button
                  key={c.corp_code}
                  onClick={() => onSelect(c)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted/20 flex items-center justify-center shrink-0">
                    <Building2 size={14} className="text-muted-foreground/60" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{c.corp_name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn("text-[10px] font-medium", clsColor(c.corp_cls))}>{clsLabel(c.corp_cls)}</span>
                      {c.stock_code && <span className="text-[10px] text-muted-foreground/50">{c.stock_code}</span>}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground/30 shrink-0" />
                </button>
              ))}
            </motion.div>
          )}
          {searched && results.length === 0 && !loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8 text-sm text-muted-foreground/50">
              <AlertCircle size={20} className="mx-auto mb-2 opacity-40" />
              검색 결과가 없습니다
            </motion.div>
          )}
        </AnimatePresence>

        <p className="text-[11px] text-center text-muted-foreground/40">
          DART 공시 의무 법인만 검색됩니다 (외부감사 대상, 자산 120억↑ 등)
        </p>
      </motion.div>
    </div>
  );
}

// ── 분석 뷰 ───────────────────────────────────────────────────────────────────
function AnalysisView({ company, onBack }: { company: DartCompany; onBack: () => void }) {
  const [financials, setFinancials] = useState<FinancialRow[]>([]);
  const [disclosures, setDisclosures] = useState<Disclosure[]>([]);
  const [aiText, setAiText] = useState("");
  const [finLoading, setFinLoading] = useState(true);
  const [discLoading, setDiscLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStarted, setAiStarted] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "disclosures" | "ai">("overview");
  const aiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(getApiUrl(`/api/market-data/dart-company-financials?corp_code=${company.corp_code}`))
      .then(r => r.json()).then(setFinancials).catch(() => setFinancials([]))
      .finally(() => setFinLoading(false));

    fetch(getApiUrl(`/api/market-data/dart-company-disclosures-by-corp?corp_code=${company.corp_code}`))
      .then(r => r.json()).then(setDisclosures).catch(() => setDisclosures([]))
      .finally(() => setDiscLoading(false));
  }, [company.corp_code]);

  const startAi = async () => {
    if (aiStarted) return;
    setAiStarted(true);
    setAiLoading(true);
    setAiText("");
    setActiveTab("ai");
    try {
      const r = await fetch(getApiUrl("/api/market-data/dart-unlisted-analysis"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ corp_code: company.corp_code, corp_name: company.corp_name, corp_cls: company.corp_cls }),
      });
      if (!r.ok || !r.body) { setAiText("분석을 불러오지 못했습니다."); setAiLoading(false); return; }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      setAiLoading(false);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setAiText(prev => prev + dec.decode(value, { stream: true }));
        aiRef.current?.scrollTo({ top: aiRef.current.scrollHeight, behavior: "smooth" });
      }
    } catch {
      setAiText("분석 중 오류가 발생했습니다.");
      setAiLoading(false);
    }
  };

  // 재무 요약 계산
  const latest = financials[financials.length - 1];
  const prev = financials[financials.length - 2];
  const revenueGrowth = latest?.revenue && prev?.revenue
    ? ((latest.revenue - prev.revenue) / Math.abs(prev.revenue)) * 100 : null;
  const opMargin = latest?.revenue && latest?.op_income
    ? (latest.op_income / latest.revenue) * 100 : null;
  const debtRatio = latest?.equity && latest?.total_liabilities
    ? (latest.total_liabilities / latest.equity) * 100 : null;

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border/20 px-4 py-3 flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg hover:bg-muted/30 flex items-center justify-center transition-colors">
          <ArrowLeft size={16} className="text-foreground/70" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-foreground truncate">{company.corp_name}</div>
          <span className={cn("text-[10px] font-medium", clsColor(company.corp_cls))}>{clsLabel(company.corp_cls)}</span>
        </div>
        <button
          onClick={startAi}
          disabled={aiStarted}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
            aiStarted
              ? "bg-muted/20 text-muted-foreground/50 cursor-default"
              : "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30"
          )}
        >
          {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Lightbulb size={12} />}
          {aiStarted ? "분석 완료" : "AI 분석"}
        </button>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-border/20 px-4 gap-1">
        {([
          { id: "overview", label: "재무 개요", icon: BarChart3 },
          { id: "disclosures", label: "공시", icon: FileText },
          { id: "ai", label: "AI 리포트", icon: Lightbulb },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors",
              activeTab === id
                ? "border-purple-500 text-purple-400"
                : "border-transparent text-muted-foreground/60 hover:text-foreground/80"
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-y-auto p-4">
        <AnimatePresence mode="wait">
          {/* ── 재무 개요 탭 ── */}
          {activeTab === "overview" && (
            <motion.div key="overview" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              {finLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={20} className="animate-spin text-muted-foreground/40" />
                </div>
              ) : financials.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                  <AlertCircle size={24} className="text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground/60">DART 공시 재무 데이터 없음</p>
                  <p className="text-xs text-muted-foreground/40">소규모 기업이거나 공시 의무 미해당</p>
                </div>
              ) : (
                <>
                  {/* 핵심 지표 요약 */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        label: "매출 성장", value: revenueGrowth != null ? fmtPct(revenueGrowth) : "—",
                        color: revenueGrowth != null ? (revenueGrowth >= 0 ? "text-emerald-500" : "text-red-400") : "text-muted-foreground"
                      },
                      {
                        label: "영업이익률", value: opMargin != null ? `${opMargin.toFixed(1)}%` : "—",
                        color: opMargin != null ? (opMargin >= 10 ? "text-emerald-500" : opMargin >= 0 ? "text-amber-400" : "text-red-400") : "text-muted-foreground"
                      },
                      {
                        label: "부채비율", value: debtRatio != null ? `${Math.round(debtRatio)}%` : "—",
                        color: debtRatio != null ? (debtRatio <= 100 ? "text-emerald-500" : debtRatio <= 200 ? "text-amber-400" : "text-red-400") : "text-muted-foreground"
                      },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded-xl bg-muted/10 border border-border/20 p-3 text-center">
                        <div className="text-[10px] text-muted-foreground/50 mb-1">{label}</div>
                        <div className={cn("text-sm font-bold tabular-nums", color)}>{value}</div>
                      </div>
                    ))}
                  </div>

                  {/* 바 차트들 */}
                  <MiniBarChart data={financials} field="revenue" label="매출액" color="bg-blue-400/60" />
                  <MiniBarChart data={financials} field="op_income" label="영업이익" color="bg-emerald-400/60" />
                  <MiniBarChart data={financials} field="net_income" label="당기순이익" color="bg-purple-400/60" />

                  {/* 자산/부채/자본 */}
                  {latest && (
                    <div className="rounded-xl bg-muted/10 border border-border/20 p-3 space-y-2">
                      <div className="text-[10px] text-muted-foreground/50">{latest.year}년 재무상태 (DART)</div>
                      {[
                        { label: "총 자산", value: fmtBig(latest.total_assets), sub: "억원" },
                        { label: "총 부채", value: fmtBig(latest.total_liabilities), sub: "억원", red: true },
                        { label: "자 본", value: fmtBig(latest.equity), sub: "억원" },
                      ].map(({ label, value, sub, red }) => (
                        <div key={label} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground/60">{label}</span>
                          <span className={cn("font-semibold tabular-nums", red ? "text-red-400/80" : "text-foreground")}>
                            {value}<span className="text-[10px] text-muted-foreground/40 ml-0.5">{sub}</span>
                          </span>
                        </div>
                      ))}
                      {debtRatio != null && (
                        <div className="pt-1 border-t border-border/20">
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-muted-foreground/60">부채비율</span>
                            <span className={cn("font-semibold", debtRatio <= 100 ? "text-emerald-500" : debtRatio <= 200 ? "text-amber-400" : "text-red-400")}>
                              {Math.round(debtRatio)}%
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", debtRatio <= 100 ? "bg-emerald-500" : debtRatio <= 200 ? "bg-amber-400" : "bg-red-400")}
                              style={{ width: `${Math.min(100, debtRatio / 3)}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground/40 text-right">
                    출처: DART 전자공시 · 연결재무제표 기준
                  </p>
                </>
              )}
            </motion.div>
          )}

          {/* ── 공시 탭 ── */}
          {activeTab === "disclosures" && (
            <motion.div key="disclosures" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-2">
              {discLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={20} className="animate-spin text-muted-foreground/40" />
                </div>
              ) : disclosures.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-2">
                  <FileText size={24} className="text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground/60">최근 1년 공시 없음</p>
                </div>
              ) : (
                <>
                  {disclosures.map(d => (
                    <a
                      key={d.rcept_no}
                      href={d.dartUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 rounded-xl bg-muted/10 border border-border/20 p-3 hover:bg-muted/20 transition-colors"
                    >
                      <FileText size={14} className="text-muted-foreground/50 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground leading-snug line-clamp-2">{d.report_nm}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-muted-foreground/50">{dtFmt(d.rcept_dt)}</span>
                          {d.flr_nm && <span className="text-[10px] text-muted-foreground/40">· {d.flr_nm}</span>}
                        </div>
                      </div>
                      <ExternalLink size={11} className="text-muted-foreground/30 shrink-0 mt-0.5" />
                    </a>
                  ))}
                  <p className="text-[10px] text-muted-foreground/40 text-center pt-1">
                    최근 1년 · DART 전자공시시스템
                  </p>
                </>
              )}
            </motion.div>
          )}

          {/* ── AI 리포트 탭 ── */}
          {activeTab === "ai" && (
            <motion.div key="ai" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              {!aiStarted ? (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                    <Lightbulb size={24} className="text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground mb-1">AI 투자 검토 리포트</p>
                    <p className="text-xs text-muted-foreground/60">사업 모델 · 재무 분석 · 리스크 · 밸류에이션</p>
                  </div>
                  <button
                    onClick={startAi}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 text-sm font-semibold transition-all"
                  >
                    <Lightbulb size={14} />
                    분석 시작
                  </button>
                  <p className="text-[10px] text-muted-foreground/40">Gemini 2.5 Flash · 약 30초 소요</p>
                </div>
              ) : aiLoading ? (
                <div className="flex flex-col items-center justify-center py-16 space-y-3">
                  <Loader2 size={24} className="animate-spin text-purple-400" />
                  <p className="text-sm text-muted-foreground/60">분석 중…</p>
                </div>
              ) : (
                <div ref={aiRef} className="space-y-2 pb-8">
                  <div className="rounded-xl bg-muted/10 border border-border/20 p-4">
                    <MarkdownText text={aiText} />
                  </div>
                  <p className="text-[10px] text-muted-foreground/30 text-right">
                    AI 생성 콘텐츠 · 투자 참고용 · 투자 결정의 최종 책임은 투자자에게 있습니다
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────
export default function UnlistedAnalysis() {
  const params = useParams<{ corpCode?: string }>();
  const [, setLocation] = useLocation();
  const [selected, setSelected] = useState<DartCompany | null>(null);

  const handleSelect = (c: DartCompany) => {
    setSelected(c);
    setLocation(`/unlisted/${c.corp_code}`);
  };

  const handleBack = () => {
    setSelected(null);
    setLocation("/unlisted");
  };

  if (selected) return <AnalysisView company={selected} onBack={handleBack} />;
  return <SearchView onSelect={handleSelect} />;
}
