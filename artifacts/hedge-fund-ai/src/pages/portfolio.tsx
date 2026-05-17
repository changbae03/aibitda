import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Plus, Trash2, TrendingUp,
  ChevronDown, ChevronUp, RefreshCw,
  ShieldAlert, ExternalLink,
  Briefcase, PencilLine, Check, X as XIcon,
  Search, Building2, ArrowUpRight, ArrowDownRight,
  Zap, AlertTriangle, Bell, Brain, PieChart,
  Activity, Target, Lightbulb, ChevronsRight,
  Newspaper, Clock,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

// ── 타입 ────────────────────────────────────────────────────────────────────
interface AnalysisSummary {
  id: number;
  targetPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  verdict: string;
  qaScore: number | null;
  createdAt: string;
  riskRewardRatio: number | null;
  upsidePct: number | null;
  catalysts: string | null;
  risks: string | null;
  strategy: string | null;
  industry: string | null;
}

interface Holding {
  id: number;
  ticker: string;
  companyName: string;
  avgPrice: number | null;
  quantity: number | null;
  currency: string;
  note: string | null;
  addedAt: string;
  currentPrice: number | null;
  change1d: number | null;
  priceCurrency: string;
  returnPct: number | null;
  analysis: AnalysisSummary | null;
}

// ── 판정 헬퍼 ───────────────────────────────────────────────────────────────
const VERDICT_KO: Record<string, string> = {
  "Strong Buy":  "높은 상승여력",
  "Buy":         "상승여력",
  "Hold":        "적정 수준",
  "Sell":        "하락여지",
  "Strong Sell": "높은 하락여지",
};

function verdictColor(v: string) {
  if (v === "Strong Buy")  return "text-emerald-400";
  if (v === "Buy")         return "text-green-400";
  if (v === "Hold")        return "text-amber-400";
  if (v === "Sell")        return "text-red-400";
  if (v === "Strong Sell") return "text-red-500";
  return "text-muted-foreground";
}

function verdictBg(v: string) {
  if (v === "Strong Buy")  return "bg-emerald-500/10 border-emerald-500/20";
  if (v === "Buy")         return "bg-green-500/10 border-green-500/20";
  if (v === "Hold")        return "bg-amber-500/10 border-amber-500/20";
  if (v === "Sell")        return "bg-red-400/10 border-red-400/20";
  if (v === "Strong Sell") return "bg-red-600/10 border-red-600/20";
  return "bg-muted/40 border-border";
}

function isKRTicker(t: string) { return /^\d{5,6}/.test(t.split(".")[0]); }

function fmtPrice(price: number, currency: string) {
  if (currency === "KRW") return `${price.toLocaleString("ko-KR")}원`;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(pct: number | null, showPlus = true) {
  if (pct == null) return null;
  const sign = pct > 0 && showPlus ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

// ── 검색 결과 타입 ────────────────────────────────────────────────────────────
interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
  quoteType: string;
}

function isKorean(t: string) { return /[ㄱ-ㅎ가-힣]/.test(t); }

// ── 종목 추가 다이얼로그 — 검색 자동완성 ────────────────────────────────────
interface AddDialogProps { onClose: () => void; onAdded: () => void; }

function AddDialog({ onClose, onAdded }: AddDialogProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);

  // 자동완성 검색
  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) { setSuggestions([]); return; }
    setIsSearching(true);
    try {
      const r = await fetch(getApiUrl(`/api/market-data/search/${encodeURIComponent(q)}`));
      const data: SearchResult[] = await r.json();
      setSuggestions(data);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = query.trim();
    const isKo = isKorean(t);
    const isDigit = /^\d{2,}$/.test(t);
    const isEn = /^[A-Za-z0-9\-\. ]{2,}$/.test(t);
    if (!isKo && !isDigit && !isEn) { setSuggestions([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(t), isDigit ? 150 : 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, fetchSuggestions]);

  // 종목 선택 → 즉시 추가
  async function addTicker(symbol: string, name: string) {
    // 한국 종목: .KS/.KQ 제거
    const cleanTicker = /^\d{6}\.(KS|KQ)$/.test(symbol.toUpperCase())
      ? symbol.split(".")[0]
      : symbol.toUpperCase();
    const currency = /^\d{5,6}$/.test(cleanTicker) ? "KRW" : "USD";

    setAdding(true); setError(null);
    try {
      const r = await fetch(getApiUrl("/api/portfolio"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: cleanTicker, companyName: name, currency }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "추가 실패"); }
      onAdded();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? "추가 실패");
      setAdding(false);
    }
  }

  // 키보드 내비게이션
  function handleKeyDown(e: React.KeyboardEvent) {
    if (isComposing.current) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        const s = suggestions[selectedIndex];
        addTicker(s.symbol, s.shortname);
      }
    }
    else if (e.key === "Escape") onClose();
  }

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-md rounded-2xl bg-[#1a1a1a] border border-border shadow-2xl overflow-hidden"
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
          <Briefcase className="w-4 h-4 text-primary shrink-0" />
          <p className="text-sm font-semibold text-foreground flex-1">포트폴리오에 종목 추가</p>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* 검색 입력 */}
        <div className="px-4 pt-4 pb-2">
          <div className="relative flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
            {isSearching
              ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
              : <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            }
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
              placeholder="종목명 또는 코드 검색 (예: 삼성전자, AAPL)"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposing.current = true; }}
              onCompositionEnd={() => { isComposing.current = false; }}
              autoComplete="off"
            />
            {query && (
              <button onClick={() => { setQuery(""); setSuggestions([]); inputRef.current?.focus(); }} className="text-muted-foreground hover:text-foreground">
                <XIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* 오류 */}
        {error && (
          <p className="mx-4 mb-2 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>
        )}

        {/* 검색 결과 목록 */}
        <div ref={dropdownRef} className="max-h-72 overflow-y-auto pb-2">
          {adding ? (
            <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> 추가 중...
            </div>
          ) : suggestions.length > 0 ? (
            suggestions.map((s, i) => {
              const isKrStock = /\.(KS|KQ)$/.test(s.symbol);
              const code = isKrStock ? s.symbol.replace(/\.(KS|KQ)$/, "") : s.symbol;
              const ex = s.exchange;
              const badgeStyle =
                ex === "KOSPI"  ? "bg-blue-500/15 text-blue-400" :
                ex === "KOSDAQ" ? "bg-emerald-500/15 text-emerald-400" :
                ex === "NASDAQ" ? "bg-violet-500/15 text-violet-400" :
                ex === "NYSE"   ? "bg-orange-500/15 text-orange-400" :
                "bg-muted/60 text-muted-foreground";
              const badgeLabel =
                ex === "KOSPI" ? "코스피" :
                ex === "KOSDAQ" ? "코스닥" :
                ex || "US";
              const isHighlighted = i === selectedIndex;
              return (
                <button
                  key={s.symbol}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(i)}
                  onMouseDown={e => { e.preventDefault(); addTicker(s.symbol, s.shortname); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/40 last:border-0",
                    isHighlighted ? "bg-muted/60" : "hover:bg-muted/30"
                  )}
                >
                  <div className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors",
                    isHighlighted ? "bg-primary/15" : "bg-muted/60"
                  )}>
                    <Building2 className={cn("w-4 h-4 transition-colors", isHighlighted ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-foreground truncate">{s.shortname}</span>
                      <span className={cn("shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full", badgeStyle)}>
                        {badgeLabel}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{code}</span>
                  </div>
                  <Plus className="w-4 h-4 text-primary shrink-0 opacity-0 group-hover:opacity-100" />
                </button>
              );
            })
          ) : query.trim().length >= 2 && !isSearching ? (
            <div className="text-center py-10 text-sm text-muted-foreground">검색 결과가 없어요</div>
          ) : query.trim().length < 2 ? (
            <div className="text-center py-10 text-[13px] text-muted-foreground">
              종목명이나 코드를 입력하세요
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
}

// ── 인라인 편집 (평단가/수량) ─────────────────────────────────────────────────
function InlineEdit({
  holdingId, avgPrice, quantity, note, onSaved,
}: { holdingId: number; avgPrice: number | null; quantity: number | null; note: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [ap, setAp] = useState(avgPrice?.toString() ?? "");
  const [qty, setQty] = useState(quantity?.toString() ?? "");
  const [nt, setNt] = useState(note ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await fetch(getApiUrl(`/api/portfolio/${holdingId}`), {
        method: "PUT", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          avgPrice: ap ? parseFloat(ap) : null,
          quantity: qty ? parseFloat(qty) : null,
          note: nt || null,
        }),
      });
      onSaved();
      setEditing(false);
    } finally { setSaving(false); }
  }

  if (!editing) return (
    <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="수정">
      <PencilLine className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input type="number" placeholder="평단가" className="w-24 px-2 py-1 text-xs rounded bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground" value={ap} onChange={e => setAp(e.target.value)} />
      <input type="number" placeholder="수량" className="w-16 px-2 py-1 text-xs rounded bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground" value={qty} onChange={e => setQty(e.target.value)} />
      <input placeholder="메모" className="w-32 px-2 py-1 text-xs rounded bg-muted border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground" value={nt} onChange={e => setNt(e.target.value)} />
      <button onClick={save} disabled={saving} className="p-1 rounded hover:bg-muted text-green-400">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
      </button>
      <button onClick={() => setEditing(false)} className="p-1 rounded hover:bg-muted text-muted-foreground"><XIcon className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// ── 섹터 색상 팔레트 ──────────────────────────────────────────────────────────
const SECTOR_COLORS = [
  "#FF8A7A", "#60A5FA", "#34D399", "#FBBF24", "#A78BFA",
  "#F472B6", "#38BDF8", "#FB923C", "#4ADE80", "#E879F9",
];

// ── 섹터 도넛 차트 ────────────────────────────────────────────────────────────
function SectorDonut({ holdings }: { holdings: Holding[] }) {
  const sectorMap = new Map<string, number>();
  for (const h of holdings) {
    const sec = h.analysis?.industry ?? "미분류";
    sectorMap.set(sec, (sectorMap.get(sec) ?? 0) + 1);
  }
  const sectors = Array.from(sectorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, count], i) => ({ name, count, color: SECTOR_COLORS[i % SECTOR_COLORS.length] }));

  if (sectors.length === 0) return null;

  const total = holdings.length;
  const R = 44, r = 28, CX = 56, CY = 56;
  let angle = -Math.PI / 2;

  function arcPath(start: number, end: number): string {
    const x1 = CX + R * Math.cos(start), y1 = CY + R * Math.sin(start);
    const x2 = CX + R * Math.cos(end),   y2 = CY + R * Math.sin(end);
    const ix1 = CX + r * Math.cos(start), iy1 = CY + r * Math.sin(start);
    const ix2 = CX + r * Math.cos(end),   iy2 = CY + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} L${ix2.toFixed(2)},${iy2.toFixed(2)} A${r},${r} 0 ${large} 0 ${ix1.toFixed(2)},${iy1.toFixed(2)} Z`;
  }

  const slices = sectors.map((s) => {
    const sweep = (s.count / total) * 2 * Math.PI;
    const path = total === 1
      ? `M${CX},${CY - R} A${R},${R} 0 1 1 ${CX - 0.01},${CY - R} Z M${CX},${CY - r} A${r},${r} 0 1 0 ${CX - 0.01},${CY - r} Z`
      : arcPath(angle, angle + sweep);
    angle += sweep;
    return { ...s, path };
  });

  return (
    <div className="rounded-2xl border border-border bg-[#141414] px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <PieChart className="w-4 h-4 text-primary" />
        <span className="text-[12px] font-semibold text-foreground">섹터 분포</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{sectors.length}개 업종</span>
      </div>
      <div className="flex items-center gap-4">
        <svg width={112} height={112} viewBox="0 0 112 112" className="shrink-0">
          {slices.map((s, i) => (
            <path key={i} d={s.path} fill={s.color} opacity={0.9} />
          ))}
          <text x={CX} y={CY + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
            {total}
          </text>
          <text x={CX} y={CY + 16} textAnchor="middle" fontSize="7" fill="#9ca3af">종목</text>
        </svg>
        <div className="flex-1 min-w-0 space-y-1.5">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="text-[11px] text-foreground/80 truncate flex-1">{s.name}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {s.count}종목 ({Math.round((s.count / total) * 100)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── AI 포트폴리오 진단 ────────────────────────────────────────────────────────
interface DiagnosisResult {
  sections: { overall: string; risk: string; opportunity: string; action: string };
  stats: { total: number; buyCount: number; holdCount: number; sellCount: number };
}

function AIDiagnosis({ holdings }: { holdings: Holding[] }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [expanded, setExpanded] = useState(true);

  async function runDiagnosis() {
    setStatus("loading");
    try {
      const r = await fetch(getApiUrl("/api/portfolio/diagnose"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (r.ok) {
        const d = await r.json();
        setResult(d);
        setStatus("done");
      } else { setStatus("error"); }
    } catch { setStatus("error"); }
  }

  const sections = [
    { key: "overall",     icon: Activity,   label: "종합 진단",    color: "text-primary" },
    { key: "risk",        icon: AlertTriangle, label: "리스크 집중도", color: "text-amber-400" },
    { key: "opportunity", icon: Target,      label: "기회 요인",   color: "text-emerald-400" },
    { key: "action",      icon: ChevronsRight, label: "실행 권고",  color: "text-blue-400" },
  ] as const;

  return (
    <div className="rounded-2xl border border-border bg-[#141414] overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4">
        <Brain className="w-4 h-4 text-primary" />
        <span className="text-[12px] font-semibold text-foreground">AI 포트폴리오 진단</span>
        {status === "done" && result && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? "접기" : "펼치기"}
          </button>
        )}
        {status !== "done" && (
          <button
            onClick={runDiagnosis}
            disabled={status === "loading" || holdings.length === 0}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/30 hover:bg-primary/25 text-primary text-[12px] font-medium transition-all disabled:opacity-50"
          >
            {status === "loading"
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 분석 중…</>
              : <><Brain className="w-3.5 h-3.5" /> 진단 시작</>
            }
          </button>
        )}
        {status === "done" && (
          <button
            onClick={runDiagnosis}
            className="ml-1 p-1 rounded text-muted-foreground/50 hover:text-muted-foreground"
            title="재진단"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      {status === "error" && (
        <div className="px-5 pb-4 text-[12px] text-red-400">진단 중 오류가 발생했습니다. 다시 시도해주세요.</div>
      )}

      <AnimatePresence>
        {status === "done" && result && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-5 py-4 space-y-4">
              {sections.map(({ key, icon: Icon, label, color }) => {
                const text = result.sections[key];
                if (!text) return null;
                return (
                  <div key={key}>
                    <div className={cn("flex items-center gap-1.5 text-[11px] font-semibold mb-1.5", color)}>
                      <Icon className="w-3.5 h-3.5" /> {label}
                    </div>
                    <p className="text-[12px] text-foreground/80 leading-relaxed">{text}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 변화 감지 타입 ────────────────────────────────────────────────────────────
interface ChangeItem {
  type: "verdict" | "target_price" | "catalyst" | "risk";
  label: string;
  detail: string;
  direction: "up" | "down" | "neutral";
}
interface ChangesResult {
  hasChanges: boolean;
  analysisCount: number;
  latestDate?: string;
  prevDate?: string;
  changes: ChangeItem[];
}

interface DailyBrief {
  summary: string;
  date: string;
  cached: boolean;
}

function parseBrief(summary: string) {
  const sections: { label: string; icon: "core" | "risk" | "catalyst"; text: string }[] = [];
  const coreMatch = summary.match(/\[오늘의핵심\]\s*([\s\S]*?)(?=\[리스크\]|\[촉매\]|$)/);
  const riskMatch  = summary.match(/\[리스크\]\s*([\s\S]*?)(?=\[오늘의핵심\]|\[촉매\]|$)/);
  const catalMatch = summary.match(/\[촉매\]\s*([\s\S]*?)(?=\[오늘의핵심\]|\[리스크\]|$)/);
  if (coreMatch?.[1]?.trim()) sections.push({ label: "오늘의 핵심", icon: "core",     text: coreMatch[1].trim() });
  if (riskMatch?.[1]?.trim())  sections.push({ label: "리스크",     icon: "risk",     text: riskMatch[1].trim() });
  if (catalMatch?.[1]?.trim()) sections.push({ label: "촉매",       icon: "catalyst", text: catalMatch[1].trim() });
  return sections.length > 0 ? sections : [{ label: "브리핑", icon: "core" as const, text: summary }];
}

// ── 보유 종목 카드 ────────────────────────────────────────────────────────────
function HoldingCard({ holding, onDelete, onRefresh }: { holding: Holding; onDelete: (id: number) => void; onRefresh: () => void }) {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changes, setChanges] = useState<ChangesResult | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [briefLoading, setBriefLoading] = useState(false);

  const a = holding.analysis;

  useEffect(() => {
    fetch(getApiUrl(`/api/portfolio/changes/${encodeURIComponent(holding.ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setChanges(d); })
      .catch(() => {});
  }, [holding.ticker]);

  // 마운트 시 브리핑 자동 로드
  useEffect(() => {
    setBriefLoading(true);
    fetch(getApiUrl(`/api/portfolio/brief/${encodeURIComponent(holding.ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.summary) setBrief(d); })
      .catch(() => {})
      .finally(() => setBriefLoading(false));
  }, [holding.ticker]);

  async function refreshBrief() {
    setBriefLoading(true);
    setBrief(null);
    try {
      const r = await fetch(getApiUrl(`/api/portfolio/brief/${encodeURIComponent(holding.ticker)}?force=true`), { credentials: "include" });
      const d = r.ok ? await r.json() : null;
      if (d?.summary) setBrief(d);
    } catch {}
    setBriefLoading(false);
  }

  async function handleDelete() {
    if (!confirm(`${holding.ticker}를 포트폴리오에서 제거할까요?`)) return;
    setDeleting(true);
    await fetch(getApiUrl(`/api/portfolio/${holding.id}`), { method: "DELETE", credentials: "include" });
    onDelete(holding.id);
  }

  const changeColor = holding.change1d == null ? "text-muted-foreground"
    : holding.change1d > 0 ? "text-emerald-400"
    : holding.change1d < 0 ? "text-red-400"
    : "text-muted-foreground";

  // 현재가 vs 목표가 진행 바 (0~200% 범위에서 100% = 목표가)
  const priceBarPct = (() => {
    if (!holding.currentPrice || !a?.targetPrice) return null;
    const lo = Math.min(holding.currentPrice, a.targetPrice) * 0.85;
    const hi = Math.max(holding.currentPrice, a.targetPrice) * 1.05;
    return Math.round(((holding.currentPrice - lo) / (hi - lo)) * 100);
  })();
  const targetBarPct = (() => {
    if (!holding.currentPrice || !a?.targetPrice) return null;
    const lo = Math.min(holding.currentPrice, a.targetPrice) * 0.85;
    const hi = Math.max(holding.currentPrice, a.targetPrice) * 1.05;
    return Math.round(((a.targetPrice - lo) / (hi - lo)) * 100);
  })();

  // 종목 이니셜 배지 색상 — 회사명 첫 글자 기준으로 고정 색상
  const BADGE_COLORS = [
    "bg-rose-500/20 text-rose-300",
    "bg-orange-500/20 text-orange-300",
    "bg-amber-500/20 text-amber-300",
    "bg-emerald-500/20 text-emerald-300",
    "bg-cyan-500/20 text-cyan-300",
    "bg-blue-500/20 text-blue-300",
    "bg-violet-500/20 text-violet-300",
    "bg-pink-500/20 text-pink-300",
  ];
  const badgeColorClass = BADGE_COLORS[(holding.companyName.charCodeAt(0) ?? 0) % BADGE_COLORS.length];
  const initial = holding.companyName.charAt(0) || holding.ticker.charAt(0);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border border-border/70 bg-[#161616] overflow-hidden"
    >
      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          {/* 이니셜 배지 */}
          <div className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center text-[18px] font-bold shrink-0",
            badgeColorClass
          )}>
            {initial}
          </div>

          {/* 종목 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground leading-tight truncate">
                  {holding.companyName}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="font-mono text-[11px] text-muted-foreground/60">{holding.ticker}</span>
                  {a?.industry && (
                    <span className="text-[10px] text-muted-foreground/50">· {a.industry}</span>
                  )}
                </div>
              </div>
              {/* 편집 · 삭제 */}
              <div className="flex items-center gap-0.5 shrink-0">
                <InlineEdit
                  holdingId={holding.id}
                  avgPrice={holding.avgPrice}
                  quantity={holding.quantity}
                  note={holding.note}
                  onSaved={onRefresh}
                />
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            {/* 판정 배지 */}
            {a && (
              <div className="mt-1.5">
                <span className={cn(
                  "inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-semibold",
                  verdictBg(a.verdict), verdictColor(a.verdict)
                )}>
                  {VERDICT_KO[a.verdict] ?? a.verdict}
                </span>
                {holding.note && (
                  <span className="ml-2 text-[11px] text-muted-foreground/50 truncate">{holding.note}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 현재가 · 적정주가 ───────────────────────────────── */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {/* 현재가 */}
          <div className="rounded-xl bg-muted/20 border border-border/60 px-3 py-2.5">
            <p className="text-[10px] text-muted-foreground mb-1">현재가</p>
            {holding.currentPrice != null ? (
              <>
                <p className="text-[18px] font-bold text-foreground tabular-nums leading-none">
                  {fmtPrice(holding.currentPrice, holding.priceCurrency)}
                </p>
                {holding.change1d != null && (
                  <p className={cn("text-[11px] tabular-nums mt-1 font-medium", changeColor)}>
                    {holding.change1d > 0 ? "▲" : holding.change1d < 0 ? "▼" : ""} {fmtPct(Math.abs(holding.change1d))} 오늘
                  </p>
                )}
              </>
            ) : (
              <p className="text-[15px] text-muted-foreground/40 mt-1">—</p>
            )}
          </div>

          {/* AI 적정주가 */}
          <div className={cn(
            "rounded-xl border px-3 py-2.5",
            a?.upsidePct != null && a.upsidePct > 0
              ? "bg-emerald-500/5 border-emerald-500/20"
              : a?.upsidePct != null && a.upsidePct < 0
              ? "bg-red-500/5 border-red-500/20"
              : "bg-muted/20 border-border/60"
          )}>
            <p className="text-[10px] text-muted-foreground mb-1">AI 적정주가</p>
            {a?.targetPrice != null ? (
              <>
                <p className="text-[18px] font-bold text-foreground tabular-nums leading-none">
                  {fmtPrice(a.targetPrice, holding.priceCurrency)}
                </p>
                {a.upsidePct != null && (
                  <p className={cn(
                    "text-[11px] tabular-nums mt-1 font-semibold",
                    a.upsidePct >= 0 ? "text-emerald-400" : "text-red-400"
                  )}>
                    {a.upsidePct >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(a.upsidePct))} 여력
                  </p>
                )}
              </>
            ) : (
              <p className="text-[15px] text-muted-foreground/40 mt-1">—</p>
            )}
          </div>
        </div>

        {/* 현재가 vs 목표가 바 */}
        {priceBarPct != null && targetBarPct != null && (
          <div className="mt-2.5 px-0.5">
            <div className="relative h-1.5 bg-muted/40 rounded-full overflow-visible">
              {/* 목표가 위치 마커 */}
              <div
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border-2 border-background z-10",
                  a?.upsidePct != null && a.upsidePct >= 0 ? "bg-emerald-400" : "bg-red-400"
                )}
                style={{ left: `clamp(0%, ${targetBarPct}%, 98%)` }}
              />
              {/* 현재가 위치 */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground border-2 border-background z-20"
                style={{ left: `clamp(0%, ${priceBarPct}%, 98%)` }}
              />
              {/* 채워진 구간 */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/30"
                style={{ width: `${priceBarPct}%` }}
              />
            </div>
            <div className="flex justify-between mt-0.5">
              <span className="text-[9px] text-muted-foreground/50">현재가</span>
              <span className="text-[9px] text-muted-foreground/50">적정주가</span>
            </div>
          </div>
        )}
      </div>

      {/* ── AI 데일리 이슈 브리핑 ─────────────────────────────── */}
      {(brief || briefLoading) && (
        <div className="mx-3 mb-3 rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
          <div className="w-full flex items-center gap-2 px-3 py-2">
            {briefLoading
              ? <Loader2 className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-spin" />
              : <Newspaper className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            }
            <button
              onClick={() => setBriefExpanded(v => !v)}
              className="flex items-center gap-1.5 flex-1 text-left"
            >
              <span className="text-[11px] font-semibold text-amber-300">오늘의 핵심</span>
              {brief && !briefLoading && (
                <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />{brief.date}
                </span>
              )}
              {briefLoading && (
                <span className="text-[10px] text-muted-foreground/40">생성 중…</span>
              )}
            </button>
            {brief && !briefLoading && (
              <button
                onClick={refreshBrief}
                className="p-1 rounded hover:bg-amber-500/10 text-muted-foreground/40 hover:text-amber-400 transition-colors"
                title="브리핑 새로고침"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
            {brief && !briefLoading && (
              <button onClick={() => setBriefExpanded(v => !v)} className="text-muted-foreground/40">
                {briefExpanded
                  ? <ChevronUp className="w-3.5 h-3.5" />
                  : <ChevronDown className="w-3.5 h-3.5" />
                }
              </button>
            )}
          </div>
          <AnimatePresence initial={false}>
            {briefExpanded && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-3 space-y-2.5 border-t border-amber-500/15">
                  {parseBrief(brief.summary).map((sec, i) => (
                    <div key={i} className="flex gap-2 pt-2">
                      <div className="shrink-0 mt-0.5">
                        {sec.icon === "core"     && <Activity      className="w-3.5 h-3.5 text-amber-400" />}
                        {sec.icon === "risk"     && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
                        {sec.icon === "catalyst" && <Zap           className="w-3.5 h-3.5 text-emerald-400" />}
                      </div>
                      <div>
                        <p className={cn(
                          "text-[10px] font-bold uppercase tracking-wider mb-0.5",
                          sec.icon === "core"     && "text-amber-400/80",
                          sec.icon === "risk"     && "text-red-400/80",
                          sec.icon === "catalyst" && "text-emerald-400/80",
                        )}>{sec.label}</p>
                        <p className="text-[12px] text-foreground/75 leading-relaxed">{sec.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ── 하단 액션 바 ──────────────────────────────────────── */}
      <div className="border-t border-border/60 px-4 py-2.5 flex items-center gap-3">
        {a ? (
          <button
            onClick={() => setLocation(`/analysis/${a.id}`)}
            className="flex items-center gap-1.5 text-[11px] text-primary/80 hover:text-primary font-medium transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            리서치 보고서
            <span className="text-muted-foreground/50 font-normal">
              {format(new Date(a.createdAt), "M/d", { locale: ko })}
            </span>
          </button>
        ) : (
          <button
            onClick={() => setLocation(`/analysis/new?ticker=${holding.ticker}`)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary transition-colors"
          >
            <Brain className="w-3 h-3" /> AI 분석 요청
          </button>
        )}

        <div className="flex-1" />

        {/* AI 리서치 요약 토글 */}
        {a && (
          <button
            onClick={() => setExpanded(v => !v)}
            className={cn(
              "flex items-center gap-1 text-[11px] transition-colors",
              expanded ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            요약 {expanded ? "접기" : "보기"}
          </button>
        )}
      </div>

      {/* ── 확장: AI 리서치 요약 ─────────────────────────────── */}
      <AnimatePresence initial={false}>
        {expanded && a && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/60 bg-[#0f0f0f] divide-y divide-border/40">
              {/* 분석 메타 */}
              <div className="px-4 py-3 flex items-center gap-3">
                <Brain className="w-4 h-4 text-primary shrink-0" />
                <div>
                  <p className="text-[11px] font-semibold text-foreground">AI 리서치 요약</p>
                  <p className="text-[10px] text-muted-foreground">
                    {format(new Date(a.createdAt), "yyyy년 M월 d일", { locale: ko })} 분석
                    {a.qaScore != null && ` · 신뢰도 ${a.qaScore}점`}
                  </p>
                </div>
                <button
                  onClick={() => setLocation(`/analysis/${a.id}`)}
                  className="ml-auto text-[10px] text-primary hover:underline flex items-center gap-0.5"
                >
                  전체 보기 <ExternalLink className="w-2.5 h-2.5" />
                </button>
              </div>

              {/* 핵심 촉매 */}
              {a.catalysts && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">핵심 촉매</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {a.catalysts.replace(/^#{1,4}\s*/gm, "").replace(/\*\*/g, "").slice(0, 400)}
                  </p>
                </div>
              )}

              {/* 주요 리스크 */}
              {a.risks && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">주요 리스크</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {a.risks.replace(/^#{1,4}\s*/gm, "").replace(/\*\*/g, "").slice(0, 400)}
                  </p>
                </div>
              )}

              {/* 전략 요약 (촉매·리스크 없을 때) */}
              {!a.catalysts && !a.risks && a.strategy && (
                <div className="px-4 py-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Target className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[10px] font-bold text-primary/80 uppercase tracking-wider">투자 전략</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {a.strategy.replace(/^#{1,4}\s*/gm, "").replace(/\*\*/g, "").slice(0, 500)}
                  </p>
                </div>
              )}

              {/* 분석 없을 때 */}
              {!a.catalysts && !a.risks && !a.strategy && (
                <div className="px-4 py-6 text-center">
                  <p className="text-[12px] text-muted-foreground mb-2">세부 분석 데이터가 없습니다</p>
                  <button
                    onClick={() => setLocation(`/analysis/new?ticker=${holding.ticker}`)}
                    className="text-[11px] text-primary hover:underline"
                  >새 분석 요청하기 →</button>
                </div>
              )}

              {/* 손절가 · 위험보상 - 작게 표시 */}
              {(a.stopLoss != null || a.riskRewardRatio != null) && (
                <div className="px-4 py-2.5 flex gap-4">
                  {a.stopLoss != null && (
                    <div>
                      <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">손절가</p>
                      <p className="text-[12px] font-medium text-foreground/70 tabular-nums">
                        {fmtPrice(a.stopLoss, holding.priceCurrency)}
                      </p>
                    </div>
                  )}
                  {a.riskRewardRatio != null && (
                    <div>
                      <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">위험보상</p>
                      <p className="text-[12px] font-medium text-foreground/70 tabular-nums">
                        1 : {a.riskRewardRatio.toFixed(1)}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── 분석 도구 패널 (섹터 도넛 + AI 진단 — 접힘 기본) ─────────────────────────
function AnalyticsPanel({ holdings }: { holdings: Holding[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border/60 bg-[#161616] overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/10 transition-colors"
      >
        <Brain className="w-4 h-4 text-primary/70" />
        <span className="text-[13px] font-semibold text-foreground/80">포트폴리오 분석 도구</span>
        <span className="ml-auto text-[11px] text-muted-foreground">섹터 분포 · AI 진단</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SectorDonut holdings={holdings} />
              <AIDiagnosis holdings={holdings} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 포트폴리오 히어로 배너 (삼쩜삼 스타일) ────────────────────────────────────
function PortfolioHero({
  holdings, lastPriceUpdate, priceUpdating, onAdd,
}: {
  holdings: Holding[];
  lastPriceUpdate: Date | null;
  priceUpdating: boolean;
  onAdd: () => void;
}) {
  const withUpside   = holdings.filter(h => h.analysis?.upsidePct != null);
  const avgUpside    = withUpside.length > 0
    ? withUpside.reduce((s, h) => s + (h.analysis!.upsidePct!), 0) / withUpside.length
    : null;
  const buyCount     = holdings.filter(h => h.analysis?.verdict?.toLowerCase().includes("buy")).length;
  const analysedCount = holdings.filter(h => h.analysis).length;
  const hasPositive  = avgUpside != null && avgUpside > 0;

  return (
    <div className="rounded-2xl bg-[#1c1c1c] border border-border/60 overflow-hidden">
      {/* 상단: 주요 수치 */}
      <div className="px-5 pt-5 pb-4">
        <p className="text-[12px] text-muted-foreground mb-1">내 포트폴리오</p>
        <div className="flex items-end gap-3">
          <div>
            <span className="text-[40px] font-bold text-foreground tabular-nums leading-none">
              {holdings.length}
            </span>
            <span className="text-[16px] text-muted-foreground ml-1.5">개 종목</span>
          </div>
          {avgUpside != null && (
            <div className={cn(
              "mb-1.5 flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-semibold",
              hasPositive
                ? "bg-emerald-500/15 text-emerald-400"
                : "bg-red-500/15 text-red-400"
            )}>
              {hasPositive ? "▲" : "▼"} 평균 {Math.abs(avgUpside).toFixed(1)}% 여력
            </div>
          )}
        </div>

        {/* 구분선 */}
        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-3 gap-0">
          <div className="pr-4">
            <p className="text-[11px] text-muted-foreground">AI 매수 의견</p>
            <p className="text-[20px] font-bold text-foreground tabular-nums mt-0.5">{buyCount}종목</p>
          </div>
          <div className="px-4 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground">AI 분석 완료</p>
            <p className="text-[20px] font-bold text-foreground tabular-nums mt-0.5">{analysedCount}/{holdings.length}</p>
          </div>
          <div className="pl-4 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground">가격 업데이트</p>
            <p className="text-[13px] font-medium text-muted-foreground mt-1 flex items-center gap-1">
              {priceUpdating
                ? <><Loader2 className="w-3 h-3 animate-spin" /> 갱신 중</>
                : lastPriceUpdate
                ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />{format(lastPriceUpdate, "HH:mm")}</>
                : "—"
              }
            </p>
          </div>
        </div>
      </div>

      {/* 하단 CTA */}
      <button
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-2 py-3 bg-primary/10 hover:bg-primary/15 transition-colors border-t border-primary/20 text-primary text-[13px] font-semibold"
      >
        <Plus className="w-4 h-4" /> 종목 추가하기
      </button>
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function Portfolio() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<"added" | "upside">("added");
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceUpdating, setPriceUpdating] = useState(false);
  const holdingsRef = useRef<Holding[]>([]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const r = await fetch(getApiUrl("/api/portfolio"), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        const h = d.holdings ?? [];
        setHoldings(h);
        holdingsRef.current = h;
        setLastPriceUpdate(new Date());
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 30초마다 현재가만 갱신 (batch-quotes)
  const refreshPrices = useCallback(async () => {
    const current = holdingsRef.current;
    if (current.length === 0) return;
    setPriceUpdating(true);
    try {
      const tickers = current.map(h => {
        const t = h.ticker.trim();
        return /^\d{5,6}$/.test(t.split(".")[0]) ? `${t}.KS` : t;
      });
      const r = await fetch(getApiUrl("/api/market-data/batch-quotes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tickers }),
      });
      if (!r.ok) return;
      const quotes: Record<string, { price: number | null; currency: string; change: number | null }> = await r.json();

      setHoldings(prev => {
        const next = prev.map(h => {
          const yticker = /^\d{5,6}$/.test(h.ticker.split(".")[0]) ? `${h.ticker}.KS` : h.ticker;
          const q = quotes[yticker] ?? quotes[h.ticker];
          if (!q || q.price == null) return h;
          const returnPct = h.avgPrice && h.avgPrice > 0
            ? ((q.price - h.avgPrice) / h.avgPrice) * 100
            : h.returnPct;
          return { ...h, currentPrice: q.price, change1d: q.change, priceCurrency: q.currency, returnPct };
        });
        holdingsRef.current = next;
        return next;
      });
      setLastPriceUpdate(new Date());
    } catch { /* silently ignore */ }
    finally { setPriceUpdating(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 30초마다 가격 자동 갱신
  useEffect(() => {
    const id = setInterval(refreshPrices, 30_000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  function handleDelete(id: number) {
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  const sorted = [...holdings].sort((a, b) => {
    if (sortKey === "upside") return ((b.analysis?.upsidePct) ?? -Infinity) - ((a.analysis?.upsidePct) ?? -Infinity);
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* 상단 헤더: 새로고침만 */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground/60 hover:text-muted-foreground"
          title="새로고침"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-36">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary/60" />
            <p className="text-[13px] text-muted-foreground">포트폴리오 불러오는 중…</p>
          </div>
        </div>
      ) : holdings.length === 0 ? (
        /* ── 빈 상태 ── */
        <div className="flex flex-col items-center justify-center py-32 space-y-5 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Briefcase className="w-8 h-8 text-primary/60" />
          </div>
          <div>
            <p className="text-[16px] font-bold text-foreground">보유 종목이 없어요</p>
            <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
              종목을 추가하면 AI가 현재가, 적정주가,<br/>오늘의 이슈를 한눈에 보여드려요.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> 첫 종목 추가하기
          </button>
        </div>
      ) : (
        <>
          {/* ── 히어로 배너 ── */}
          <PortfolioHero
            holdings={holdings}
            lastPriceUpdate={lastPriceUpdate}
            priceUpdating={priceUpdating}
            onAdd={() => setShowAdd(true)}
          />

          {/* ── 정렬 탭 ── */}
          <div className="flex items-center gap-1 pt-1">
            <span className="text-[11px] text-muted-foreground mr-1">정렬</span>
            {(["added", "upside"] as const).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={cn(
                  "px-3 py-1.5 text-[11px] rounded-full transition-colors",
                  sortKey === k
                    ? "bg-foreground/10 text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {{ added: "최근 추가순", upside: "상승여력순" }[k]}
              </button>
            ))}
          </div>

          {/* ── 보유 종목 목록 ── */}
          <div className="space-y-2.5">
            <AnimatePresence mode="popLayout">
              {sorted.map(h => (
                <HoldingCard
                  key={h.id}
                  holding={h}
                  onDelete={handleDelete}
                  onRefresh={() => load(true)}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* ── 분석 도구 (접힌 상태) ── */}
          <AnalyticsPanel holdings={holdings} />
        </>
      )}

      {/* 종목 추가 다이얼로그 */}
      <AnimatePresence>
        {showAdd && <AddDialog onClose={() => setShowAdd(false)} onAdded={() => load()} />}
      </AnimatePresence>
    </div>
  );
}
