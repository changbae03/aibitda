import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Plus, Trash2, TrendingUp,
  ChevronDown, ChevronUp, RefreshCw,
  ShieldAlert, ExternalLink,
  Briefcase, PencilLine, Check, X as XIcon,
  Search, Building2, ArrowUpRight, ArrowDownRight,
  Zap, AlertTriangle, Bell,
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

// ── 보유 종목 카드 ────────────────────────────────────────────────────────────
function HoldingCard({ holding, onDelete, onRefresh }: { holding: Holding; onDelete: (id: number) => void; onRefresh: () => void }) {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changes, setChanges] = useState<ChangesResult | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(false);

  const a = holding.analysis;

  useEffect(() => {
    fetch(getApiUrl(`/api/portfolio/changes/${encodeURIComponent(holding.ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setChanges(d); })
      .catch(() => {});
  }, [holding.ticker]);
  const isKR = isKRTicker(holding.ticker);

  async function handleDelete() {
    if (!confirm(`${holding.ticker}를 포트폴리오에서 제거할까요?`)) return;
    setDeleting(true);
    await fetch(getApiUrl(`/api/portfolio/${holding.id}`), { method: "DELETE", credentials: "include" });
    onDelete(holding.id);
  }

  const returnColor = holding.returnPct == null ? "text-muted-foreground"
    : holding.returnPct > 0 ? "text-emerald-400"
    : holding.returnPct < 0 ? "text-red-400"
    : "text-muted-foreground";

  const changeColor = holding.change1d == null ? "text-muted-foreground"
    : holding.change1d > 0 ? "text-emerald-400"
    : holding.change1d < 0 ? "text-red-400"
    : "text-muted-foreground";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="rounded-2xl border border-border bg-[#141414] overflow-hidden"
    >
      {/* 메인 행 */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* 종목 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground">{holding.ticker}</span>
              <span className="text-sm font-semibold text-foreground truncate">{holding.companyName}</span>
              {a && (
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                  verdictBg(a.verdict), verdictColor(a.verdict)
                )}>
                  {VERDICT_KO[a.verdict] ?? a.verdict}
                </span>
              )}
            </div>
            {holding.note && (
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{holding.note}</p>
            )}
          </div>

          {/* 현재가 */}
          <div className="text-right shrink-0">
            {holding.currentPrice != null ? (
              <>
                <p className="text-sm font-semibold text-foreground tabular-nums">
                  {fmtPrice(holding.currentPrice, holding.priceCurrency)}
                </p>
                {holding.change1d != null && (
                  <p className={cn("text-xs tabular-nums", changeColor)}>
                    {fmtPct(holding.change1d)} (1일)
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">현재가 없음</p>
            )}
          </div>
        </div>

        {/* 지표 행 */}
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* 수익률 */}
          <div className="rounded-lg bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">수익률</p>
            {holding.returnPct != null ? (
              <p className={cn("text-sm font-bold tabular-nums", returnColor)}>
                {fmtPct(holding.returnPct)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
            {holding.avgPrice != null && (
              <p className="text-[10px] text-muted-foreground">매수 {fmtPrice(holding.avgPrice, holding.currency)}</p>
            )}
          </div>

          {/* 목표가 */}
          <div className="rounded-lg bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">AI 목표가</p>
            {a?.targetPrice != null ? (
              <>
                <p className="text-sm font-bold text-foreground tabular-nums">
                  {fmtPrice(a.targetPrice, holding.priceCurrency)}
                </p>
                {a.upsidePct != null && (
                  <p className={cn("text-[10px] tabular-nums", a.upsidePct >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {fmtPct(a.upsidePct)} 여력
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>

          {/* 손절가 */}
          <div className="rounded-lg bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">AI 손절가</p>
            {a?.stopLoss != null ? (
              <p className="text-sm font-bold text-foreground tabular-nums">
                {fmtPrice(a.stopLoss, holding.priceCurrency)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>

          {/* 위험보상비율 */}
          <div className="rounded-lg bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">위험보상비율</p>
            {a?.riskRewardRatio != null ? (
              <p className="text-sm font-bold text-foreground tabular-nums">
                1 : {a.riskRewardRatio.toFixed(1)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
        </div>

        {/* 변화 감지 섹션 */}
        {changes && changes.changes.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setChangesExpanded(v => !v)}
              className="w-full flex items-center gap-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors group"
            >
              <Bell className={cn(
                "w-3 h-3 shrink-0",
                changes.hasChanges ? "text-amber-400" : "text-muted-foreground"
              )} />
              <span className={changes.hasChanges ? "text-amber-400 font-medium" : ""}>
                {changes.hasChanges
                  ? `AI 판정·목표가 변경 감지 (${changes.analysisCount}회 분석)`
                  : `분석 요약 (${changes.analysisCount}회 분석)`
                }
              </span>
              {changes.latestDate && (
                <span className="text-muted-foreground/50">
                  · 최신 {format(new Date(changes.latestDate), "M/d")}
                </span>
              )}
              <span className="ml-auto">
                {changesExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </span>
            </button>

            <AnimatePresence>
              {changesExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <div className="mt-2 space-y-1.5">
                    {changes.changes.map((c, i) => (
                      <div
                        key={i}
                        className={cn(
                          "rounded-lg px-3 py-2 flex gap-2",
                          c.type === "verdict" && c.direction === "up" && "bg-emerald-500/10 border border-emerald-500/20",
                          c.type === "verdict" && c.direction === "down" && "bg-red-500/10 border border-red-500/20",
                          c.type === "verdict" && c.direction === "neutral" && "bg-muted/30 border border-border",
                          c.type === "target_price" && c.direction === "up" && "bg-emerald-500/8 border border-emerald-500/15",
                          c.type === "target_price" && c.direction === "down" && "bg-red-500/8 border border-red-500/15",
                          c.type === "catalyst" && "bg-blue-500/8 border border-blue-500/15",
                          c.type === "risk" && "bg-amber-500/8 border border-amber-500/15",
                        )}
                      >
                        <div className="shrink-0 mt-0.5">
                          {c.type === "verdict" && c.direction === "up" && <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />}
                          {c.type === "verdict" && c.direction === "down" && <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
                          {c.type === "verdict" && c.direction === "neutral" && <Bell className="w-3.5 h-3.5 text-muted-foreground" />}
                          {c.type === "target_price" && c.direction === "up" && <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />}
                          {c.type === "target_price" && c.direction === "down" && <ArrowDownRight className="w-3.5 h-3.5 text-red-400" />}
                          {c.type === "catalyst" && <Zap className="w-3.5 h-3.5 text-blue-400" />}
                          {c.type === "risk" && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                        </div>
                        <div className="min-w-0">
                          <p className={cn(
                            "text-[10px] font-semibold uppercase tracking-wide mb-0.5",
                            c.type === "verdict" && c.direction === "up" && "text-emerald-400",
                            c.type === "verdict" && c.direction === "down" && "text-red-400",
                            c.type === "target_price" && c.direction === "up" && "text-emerald-400",
                            c.type === "target_price" && c.direction === "down" && "text-red-400",
                            c.type === "catalyst" && "text-blue-400",
                            c.type === "risk" && "text-amber-400",
                          )}>
                            {c.label}
                          </p>
                          <p className="text-[11px] text-foreground/80 leading-snug">{c.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 하단 액션 */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <InlineEdit
            holdingId={holding.id}
            avgPrice={holding.avgPrice}
            quantity={holding.quantity}
            note={holding.note}
            onSaved={onRefresh}
          />
          {a && (
            <button
              onClick={() => setLocation(`/analysis/${a.id}`)}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              최신 분석 보기
              <span className="text-muted-foreground ml-0.5">
                ({format(new Date(a.createdAt), "M/d", { locale: ko })})
              </span>
            </button>
          )}
          {!a && (
            <button
              onClick={() => setLocation(`/analysis/new?ticker=${holding.ticker}`)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
            >
              <Plus className="w-3 h-3" /> 분석 요청
            </button>
          )}

          <div className="flex-1" />

          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {expanded ? "접기" : "AI 리서치 요약"}
          </button>

          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 확장: AI 리서치 요약 */}
      <AnimatePresence>
        {expanded && a && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border px-4 py-4 space-y-3 bg-[#111]">
              {a.catalysts && (
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 mb-1">
                    <TrendingUp className="w-3.5 h-3.5" /> 핵심 촉매
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {a.catalysts.replace(/^#{1,4}\s*/gm, "").slice(0, 500)}
                  </p>
                </div>
              )}
              {a.risks && (
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-400 mb-1">
                    <ShieldAlert className="w-3.5 h-3.5" /> 주요 리스크
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {a.risks.replace(/^#{1,4}\s*/gm, "").slice(0, 500)}
                  </p>
                </div>
              )}
              {!a.catalysts && !a.risks && a.strategy && (
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary mb-1">
                    <TrendingUp className="w-3.5 h-3.5" /> 투자 전략 요약
                  </div>
                  <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-5 whitespace-pre-wrap">
                    {a.strategy.replace(/^#{1,4}\s*/gm, "").replace(/\*\*/g, "").slice(0, 600)}
                  </p>
                </div>
              )}
              {!a.catalysts && !a.risks && !a.strategy && (
                <div className="text-center py-3">
                  <p className="text-[12px] text-muted-foreground mb-2">분석 데이터가 없습니다</p>
                  <button
                    onClick={() => setLocation(`/analysis/new?ticker=${holding.ticker}`)}
                    className="text-[11px] text-primary hover:underline"
                  >
                    새 분석 요청하기 →
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── 포트폴리오 요약 ──────────────────────────────────────────────────────────
function PortfolioSummary({ holdings }: { holdings: Holding[] }) {
  const withReturn = holdings.filter(h => h.returnPct != null);
  const withUpside = holdings.filter(h => h.analysis?.upsidePct != null);

  const avgReturn = withReturn.length > 0
    ? withReturn.reduce((s, h) => s + (h.returnPct ?? 0), 0) / withReturn.length
    : null;
  const avgUpside = withUpside.length > 0
    ? withUpside.reduce((s, h) => s + (h.analysis?.upsidePct ?? 0), 0) / withUpside.length
    : null;

  const buyCount = holdings.filter(h => h.analysis?.verdict?.toLowerCase().includes("buy")).length;
  const sellCount = holdings.filter(h => h.analysis?.verdict?.toLowerCase().includes("sell")).length;
  const holdCount = holdings.filter(h => h.analysis?.verdict === "Hold").length;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <div className="rounded-xl bg-muted/30 border border-border px-3 py-3">
        <p className="text-[10px] text-muted-foreground">보유 종목</p>
        <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">{holdings.length}</p>
        <p className="text-[10px] text-muted-foreground">매수 {buyCount} · 홀드 {holdCount} · 매도 {sellCount}</p>
      </div>
      <div className="rounded-xl bg-muted/30 border border-border px-3 py-3">
        <p className="text-[10px] text-muted-foreground">평균 수익률</p>
        {avgReturn != null ? (
          <>
            <p className={cn("text-2xl font-bold tabular-nums mt-0.5", avgReturn >= 0 ? "text-emerald-400" : "text-red-400")}>
              {fmtPct(avgReturn)}
            </p>
            <p className="text-[10px] text-muted-foreground">평단가 입력된 {withReturn.length}종목 기준</p>
          </>
        ) : (
          <p className="text-2xl font-bold text-muted-foreground mt-0.5">—</p>
        )}
      </div>
      <div className="rounded-xl bg-muted/30 border border-border px-3 py-3">
        <p className="text-[10px] text-muted-foreground">평균 AI 상승여력</p>
        {avgUpside != null ? (
          <>
            <p className={cn("text-2xl font-bold tabular-nums mt-0.5", avgUpside >= 0 ? "text-emerald-400" : "text-red-400")}>
              {fmtPct(avgUpside)}
            </p>
            <p className="text-[10px] text-muted-foreground">분석된 {withUpside.length}종목 기준</p>
          </>
        ) : (
          <p className="text-2xl font-bold text-muted-foreground mt-0.5">—</p>
        )}
      </div>
      <div className="rounded-xl bg-muted/30 border border-border px-3 py-3">
        <p className="text-[10px] text-muted-foreground">AI 분석 연결률</p>
        <p className="text-2xl font-bold text-foreground tabular-nums mt-0.5">
          {holdings.length > 0 ? Math.round((holdings.filter(h => h.analysis).length / holdings.length) * 100) : 0}%
        </p>
        <p className="text-[10px] text-muted-foreground">{holdings.filter(h => h.analysis).length}/{holdings.length} 종목 분석 완료</p>
      </div>
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function Portfolio() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<"added" | "return" | "upside">("added");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const r = await fetch(getApiUrl("/api/portfolio"), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setHoldings(d.holdings ?? []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleDelete(id: number) {
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  const sorted = [...holdings].sort((a, b) => {
    if (sortKey === "return") return (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity);
    if (sortKey === "upside") return ((b.analysis?.upsidePct) ?? -Infinity) - ((a.analysis?.upsidePct) ?? -Infinity);
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-primary" /> 내 포트폴리오
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            보유 종목의 AI 목표가, 수익률, 리서치 요약을 한눈에.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
            title="새로고침"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> 종목 추가
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : holdings.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center">
            <Briefcase className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">아직 보유 종목이 없어요</p>
            <p className="text-xs text-muted-foreground mt-1">종목을 추가하면 AI 분석 데이터와 수익률을 한눈에 볼 수 있어요.</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" /> 첫 종목 추가하기
          </button>
        </div>
      ) : (
        <>
          <PortfolioSummary holdings={holdings} />

          {/* 정렬 */}
          <div className="flex items-center gap-1">
            {(["added", "return", "upside"] as const).map(k => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={cn(
                  "px-3 py-1 text-xs rounded-lg transition-colors",
                  sortKey === k
                    ? "bg-primary/20 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {{ added: "최근 추가순", return: "수익률순", upside: "상승여력순" }[k]}
              </button>
            ))}
          </div>

          {/* 보유 종목 목록 */}
          <div className="space-y-3">
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
        </>
      )}

      {/* 종목 추가 다이얼로그 */}
      <AnimatePresence>
        {showAdd && <AddDialog onClose={() => setShowAdd(false)} onAdded={() => load()} />}
      </AnimatePresence>
    </div>
  );
}
