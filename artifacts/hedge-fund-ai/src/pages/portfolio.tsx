import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Plus, Trash2, TrendingUp,
  ChevronDown, ChevronUp, ChevronRight, RefreshCw,
  ShieldAlert, ExternalLink,
  Briefcase, PencilLine, Check, X as XIcon,
  Search, Building2, ArrowUpRight, ArrowDownRight,
  Zap, AlertTriangle, Bell, Brain, PieChart,
  Activity, Target, Lightbulb, ChevronsRight,
  Newspaper, Clock, Compass, Users,
  Sparkles, TrendingDown, CheckCircle2, MoveRight, ArrowRight,
  BarChart3, Wallet, Scale, SlidersHorizontal, Star,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { cn, getApiUrl, formatCurrency, isUSTicker } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

// ── 타입 ────────────────────────────────────────────────────────────────────
interface AnalysisSummary {
  id: number;
  targetPrice: number | null;
  collectiveTargetPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  verdict: string;
  qaScore: number | null;
  createdAt: string;
  riskRewardRatio: number | null;
  upsidePct: number | null;
  collectiveUpsidePct: number | null;
  catalysts: string | null;
  risks: string | null;
  strategy: string | null;
  industry: string | null;
}

interface Holding {
  id: number;
  ticker: string;
  companyName: string;
  englishName: string | null;
  avgPrice: number | null;
  quantity: number | null;
  currency: string;
  note: string | null;
  addedAt: string;
  holdingType: "portfolio" | "watchlist";
  currentPrice: number | null;
  change1d: number | null;
  priceCurrency: string;
  returnPct: number | null;
  analysis: AnalysisSummary | null;
}

// ── 포트폴리오 전체 리뷰 결과 타입 ─────────────────────────────────────────
interface StockUpdate {
  ticker: string;
  companyName: string;
  sentiment: "bullish" | "neutral" | "bearish";
  thesisStatus: "유효" | "일부변화" | "훼손";
  keyEvent: string;
  update: string;
  action: "매도검토" | "홀드" | "추가매수";
  thesisChangeNote: string;
}
interface SectorRecommendation {
  sector: string;
  reason: string;
  exampleTickers: string[];
}
interface RiskScore {
  grade: "A" | "B" | "C" | "D";
  sectorConcentration: string;
  correlationRisk: string;
}
interface PortfolioReviewResult {
  stockUpdates: StockUpdate[];
  riskScore: RiskScore | null;
  portfolioView: string;
  concentration: string;
  rebalancing: string;
  sectorRecommendations: SectorRecommendation[];
  generatedAt: string;
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
  if (v === "Strong Buy")  return "text-emerald-600 dark:text-emerald-400";
  if (v === "Buy")         return "text-green-600 dark:text-green-400";
  if (v === "Hold")        return "text-amber-600 dark:text-amber-400";
  if (v === "Sell")        return "text-red-500 dark:text-red-400";
  if (v === "Strong Sell") return "text-red-600 dark:text-red-500";
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

function fmtPrice(price: number, currency: string, isEn = false) {
  if (currency === "KRW") {
    return isEn
      ? `KRW ${price.toLocaleString("en-US")}`
      : `${price.toLocaleString("ko-KR")}원`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(pct: number | null, showPlus = true) {
  if (pct == null) return null;
  const sign = pct > 0 && showPlus ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

// ── 성과 추적 타입 ─────────────────────────────────────────────────────────
interface HoldingDetail {
  ticker: string; name: string;
  avgPrice: number | null; quantity: number | null;
  currentPrice: number | null; currency: string;
  invested: number | null; value: number | null;
  returnPct: number | null; plAmount: number | null;
  change1d: number | null;
}
interface PerformanceSnapshot {
  date: string;
  investedKrw: number; valueKrw: number;
  investedUsd: number; valueUsd: number;
  returnPct: number | null;
}
interface PerformanceData {
  today: {
    investedKrw: number; valueKrw: number;
    investedUsd: number; valueUsd: number;
    returnPct: number | null; returnPctUsd: number | null;
    holdingsDetail: HoldingDetail[];
  } | null;
  snapshots: PerformanceSnapshot[];
}

// ── 검색 결과 타입 ────────────────────────────────────────────────────────────
interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
  quoteType: string;
}

function isKorean(t: string) { return /[ㄱ-ㅎ가-힣]/.test(t); }

// ── 종목 추가 다이얼로그 — 2단계: ①검색 → ②평단가/수량 입력 ──────────────
interface AddDialogProps { onClose: () => void; onAdded: () => void; defaultType?: "portfolio" | "watchlist"; }

function AddDialog({ onClose, onAdded, defaultType = "portfolio" }: AddDialogProps) {
  const { isEn } = useLanguage();

  // Step 1: search
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);

  // Step 2: detail input
  const [step, setStep] = useState<"search" | "detail">("search");
  const [selectedStock, setSelectedStock] = useState<{ symbol: string; name: string; currency: string } | null>(null);
  const [avgPriceInput, setAvgPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [holdingType, setHoldingType] = useState<"portfolio" | "watchlist">(defaultType);

  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avgPriceRef = useRef<HTMLInputElement>(null);

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

  // 종목 선택 → Step 2로 이동
  function selectStock(symbol: string, name: string) {
    const cleanTicker = /^\d{6}\.(KS|KQ)$/i.test(symbol)
      ? symbol.split(".")[0] : symbol.toUpperCase();
    const currency = /^\d{5,6}$/.test(cleanTicker) ? "KRW" : "USD";
    setSelectedStock({ symbol: cleanTicker, name, currency });
    setStep("detail");
    setTimeout(() => avgPriceRef.current?.focus(), 100);
  }

  // Step 2: 최종 추가 (평단+수량 포함)
  async function addWithDetail(skipDetail = false) {
    if (!selectedStock) return;
    setAdding(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        ticker: selectedStock.symbol,
        companyName: selectedStock.name,
        currency: selectedStock.currency,
        holdingType,
      };
      if (!skipDetail && holdingType === "portfolio") {
        if (avgPriceInput) body.avgPrice = parseFloat(avgPriceInput);
        if (quantityInput) body.quantity = parseFloat(quantityInput);
        if (noteInput) body.note = noteInput;
      } else if (!skipDetail && holdingType === "watchlist") {
        if (noteInput) body.note = noteInput;
      }
      const r = await fetch(getApiUrl("/api/portfolio"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? (isEn ? "Failed to add" : "추가 실패")); }
      onAdded(); onClose();
    } catch (e: any) {
      setError(e?.message ?? (isEn ? "Failed to add" : "추가 실패"));
      setAdding(false);
    }
  }

  // 키보드 내비게이션 (Step 1)
  function handleKeyDown(e: React.KeyboardEvent) {
    if (isComposing.current) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, -1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        const s = suggestions[selectedIndex];
        selectStock(s.symbol, s.shortname);
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
        className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl overflow-hidden"
      >
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {step === "detail" && (
            <button onClick={() => { setStep("search"); setError(null); }} className="p-1 rounded hover:bg-muted text-muted-foreground" title="뒤로">
              <ChevronRight className="w-4 h-4 rotate-180" />
            </button>
          )}
          {/* 보유종목 / 관심종목 탭 토글 */}
          <div className="flex-1 flex items-center bg-muted/50 rounded-lg p-0.5 gap-0.5">
            <button
              onClick={() => setHoldingType("portfolio")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] font-semibold rounded-md transition-all",
                holdingType === "portfolio"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Briefcase className="w-3 h-3" />
              {isEn ? "Holdings" : "보유종목"}
            </button>
            <button
              onClick={() => setHoldingType("watchlist")}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[12px] font-semibold rounded-md transition-all",
                holdingType === "watchlist"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Star className="w-3 h-3" />
              {isEn ? "Watchlist" : "관심종목"}
            </button>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {/* STEP 1: 검색 */}
        {step === "search" && (
          <>
            <div className="px-4 pt-4 pb-2">
              <div className="relative flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5 focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
                {isSearching
                  ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin shrink-0" />
                  : <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                }
                <input
                  ref={inputRef}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
                  placeholder={isEn ? "Search by name or ticker (e.g., Samsung, AAPL)" : "종목명 또는 코드 검색 (예: 삼성전자, AAPL)"}
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

            <div ref={dropdownRef} className="max-h-72 overflow-y-auto pb-2">
              {suggestions.length > 0 ? (
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
                    ex === "KOSPI" ? "코스피" : ex === "KOSDAQ" ? "코스닥" : ex || "US";
                  const isHighlighted = i === selectedIndex;
                  return (
                    <button
                      key={s.symbol} type="button"
                      onMouseEnter={() => setSelectedIndex(i)}
                      onMouseDown={e => { e.preventDefault(); selectStock(s.symbol, s.shortname); }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-border/40 last:border-0",
                        isHighlighted ? "bg-muted/60" : "hover:bg-muted/30"
                      )}
                    >
                      <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", isHighlighted ? "bg-primary/15" : "bg-muted/60")}>
                        <Building2 className={cn("w-4 h-4", isHighlighted ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-foreground truncate">{s.shortname}</span>
                          <span className={cn("shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full", badgeStyle)}>{badgeLabel}</span>
                        </div>
                        <span className="text-xs text-muted-foreground font-mono">{code}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                    </button>
                  );
                })
              ) : query.trim().length >= 2 && !isSearching ? (
                <div className="text-center py-10 text-sm text-muted-foreground">{isEn ? "No results" : "검색 결과가 없어요"}</div>
              ) : (
                <div className="text-center py-10 text-[13px] text-muted-foreground">
                  {isEn ? "Enter a name or ticker symbol" : "종목명이나 코드를 입력하세요"}
                </div>
              )}
            </div>
          </>
        )}

        {/* STEP 2: 정보 입력 */}
        {step === "detail" && selectedStock && (
          <div className="px-4 py-5 space-y-4">
            {/* 선택된 종목 요약 */}
            <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/40 border border-border">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                {holdingType === "watchlist"
                  ? <Star className="w-4 h-4 text-amber-400" />
                  : <Building2 className="w-4 h-4 text-primary/60" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{selectedStock.name}</p>
                <p className="text-[11px] text-muted-foreground font-mono">{selectedStock.symbol} · {selectedStock.currency}</p>
              </div>
              <span className={cn(
                "text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                holdingType === "watchlist"
                  ? "bg-amber-400/10 text-amber-500"
                  : "bg-primary/10 text-primary/70"
              )}>
                {holdingType === "watchlist" ? (isEn ? "Watchlist" : "관심종목") : (isEn ? "Holdings" : "보유종목")}
              </span>
            </div>

            {/* 평단가 + 수량 — 보유종목만 */}
            {holdingType === "portfolio" && (
              <>
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                    {isEn ? "Average cost" : "평균 매수단가 (평단가)"} <span className="text-muted-foreground/40">{isEn ? "optional" : "선택"}</span>
                  </label>
                  <div className="relative">
                    <input
                      ref={avgPriceRef}
                      type="number" inputMode="decimal"
                      placeholder={selectedStock.currency === "KRW" ? "예: 85000" : "e.g. 182.50"}
                      className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
                      value={avgPriceInput}
                      onChange={e => setAvgPriceInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addWithDetail(); }}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/40">
                      {selectedStock.currency === "KRW" ? "원" : "USD"}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                    {isEn ? "Quantity (shares)" : "보유 수량 (주)"} <span className="text-muted-foreground/40">{isEn ? "optional" : "선택"}</span>
                  </label>
                  <input
                    type="number" inputMode="decimal"
                    placeholder={isEn ? "e.g. 10" : "예: 10"}
                    className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
                    value={quantityInput}
                    onChange={e => setQuantityInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addWithDetail(); }}
                  />
                </div>
                {/* 투자금 미리보기 */}
                {avgPriceInput && quantityInput && parseFloat(avgPriceInput) > 0 && parseFloat(quantityInput) > 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/10">
                    <Wallet className="w-3.5 h-3.5 text-primary/50 shrink-0" />
                    <span className="text-[12px] text-foreground/60">
                      {isEn ? "Total invested:" : "총 투자금:"}{" "}
                      <span className="font-semibold text-foreground">
                        {selectedStock.currency === "KRW"
                          ? `${Math.round(parseFloat(avgPriceInput) * parseFloat(quantityInput)).toLocaleString("ko-KR")}원`
                          : `$${(parseFloat(avgPriceInput) * parseFloat(quantityInput)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
                      </span>
                    </span>
                  </div>
                )}
              </>
            )}

            {/* 메모 (공통) */}
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                {isEn ? "Memo" : "메모"} <span className="text-muted-foreground/40">{isEn ? "optional" : "선택"}</span>
              </label>
              <input
                ref={holdingType === "watchlist" ? avgPriceRef : undefined}
                type="text"
                placeholder={holdingType === "watchlist"
                  ? (isEn ? "Why watching? Target price, etc." : "관심 이유, 목표 주가 등")
                  : (isEn ? "Investment thesis, target, etc." : "매수 이유, 목표 등")
                }
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-muted/40 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50"
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addWithDetail(); }}
              />
            </div>

            {error && <p className="text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

            {/* 버튼 */}
            <div className="flex gap-2 pt-1">
              {holdingType === "portfolio" && (
                <button
                  onClick={() => addWithDetail(true)}
                  disabled={adding}
                  className="flex-1 py-2.5 text-sm text-muted-foreground border border-border rounded-xl hover:bg-muted/40 transition-colors"
                >
                  {isEn ? "Skip & Add" : "건너뛰고 추가"}
                </button>
              )}
              <button
                onClick={() => addWithDetail(false)}
                disabled={adding}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors"
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {holdingType === "watchlist"
                  ? (isEn ? "Add to Watchlist" : "관심종목에 추가")
                  : (isEn ? "Add to Portfolio" : "포트폴리오에 추가")}
              </button>
            </div>
          </div>
        )}
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

interface DailyBrief {
  summary: string;
  date: string;
  cached: boolean;
  source?: "analysis" | "ai";
  contributorCount?: number;
  analysisDate?: string | null;
}

/** investment_strategy JSON 파싱 헬퍼 */
function parseStrategyJson(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  // 코드펜스/따옴표 제거 후 첫 { ~ 마지막 } 블록만 추출
  let s = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").replace(/"+\s*$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  s = s.slice(start, end + 1);
  try { return JSON.parse(s); } catch { /* 계속 */ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { return null; }
}

/** investment_strategy JSON의 risks 필드에서 리스크 불릿 추출 */
function parseStrategyRisks(raw: string | null | undefined, max = 3): string[] {
  const obj = parseStrategyJson(raw);
  if (obj) {
    const risks = obj.risks;
    if (Array.isArray(risks)) {
      return risks.slice(0, max).map((r: any) => String(r).replace(/\*\*/g, "").replace(/^[-—·]\s*/, "").trim()).filter(r => r.length > 5);
    }
    if (typeof risks === "string" && risks.length > 5) {
      return risks.split(/\n+/)
        .map(l => l.replace(/^[-—·•\d\.\)]+\s*/, "").replace(/\*\*/g, "").trim())
        .filter(l => l.length > 5)
        .slice(0, max);
    }
  }
  return parseBullets(raw, max);
}

/** 긴 문장을 ~60자 안에서 자연스럽게 잘라내기 */
function trimToOneLiner(text: string, maxLen = 62): string {
  const s = text.replace(/\*\*/g, "").trim();
  if (s.length <= maxLen) return s;
  // 쉼표·세미콜론·대시 등 자연 구분점에서 자르기
  const breakAt = s.slice(0, maxLen).search(/[,;—–\s]\s*\S*$/);
  const cut = breakAt > 20 ? s.slice(0, breakAt).trimEnd() : s.slice(0, maxLen).trimEnd();
  return cut + " …";
}

/** investment_strategy JSON에서 개조체 핵심 투자포인트 추출 */
function parseStrategyThesis(raw: string | null | undefined, max = 3): string[] {
  const obj = parseStrategyJson(raw);
  if (obj) {
    // 1순위: monitoring_indicators 배열 — 이미 짧고 개조체에 가까움
    if (Array.isArray(obj.monitoring_indicators) && obj.monitoring_indicators.length > 0) {
      return obj.monitoring_indicators
        .slice(0, max)
        .map((t: any) => String(t).replace(/\*\*/g, "").replace(/\.$/, "").trim())
        .filter(t => t.length > 5);
    }
    // 2순위: thesis_points 배열
    if (Array.isArray(obj.thesis_points) && obj.thesis_points.length > 0) {
      return obj.thesis_points.slice(0, max)
        .map((t: any) => String(t).replace(/\*\*/g, "").replace(/\.$/, "").trim())
        .filter(t => t.length > 5);
    }
    // 3순위: summary 문장 분할 (마침표 기준)
    const text = String(obj.summary ?? obj.key_issue ?? "");
    if (text.length > 10) {
      const sentences = text
        .split(/(?<=[.!。])\s+/)
        .map(s => s.replace(/\*\*/g, "").replace(/\.$/, "").trim())
        .filter(s => s.length > 15);
      if (sentences.length > 0) return sentences.slice(0, max);
    }
  }
  return parseBullets(raw, max);
}

/** investment_strategy JSON의 key_issue에서 Catalyst 한 줄 추출 */
function parseKeyCatalyst(strategyRaw: string | null | undefined, catalystRaw: string | null | undefined): string {
  // 1순위: investment_strategy.key_issue (한 줄 핵심)
  const obj = parseStrategyJson(strategyRaw);
  if (obj) {
    const ki = obj.key_issue ?? obj.monitoring_indicators?.[0] ?? "";
    const kiStr = String(ki).replace(/\*\*/g, "").trim();
    if (kiStr.length > 10) return kiStr.length > 120 ? kiStr.slice(0, 117) + "…" : kiStr;
  }
  // 2순위: catalyst_analysis markdown
  const catText = cleanStepText(catalystRaw);
  if (catText) {
    const m = catText.match(/(?:Catalyst|카탈리스트|핵심 모니터링|Monitor)[:\s]+([^\n]+)/i);
    if (m) return m[1].replace(/\*\*/g, "").trim();
    // 첫 단락 한 줄
    const firstPara = catText.split(/\n\n+/)[0]?.replace(/^#+\s*/gm, "").replace(/\*\*/g, "").trim();
    if (firstPara && firstPara.length > 10) return firstPara.length > 120 ? firstPara.slice(0, 117) + "…" : firstPara;
  }
  return "";
}

/** 텍스트에서 불릿 포인트 추출 — em-dash, 하이픈, 번호 시작 줄 (fallback) */
function parseBullets(raw: string | null | undefined, max = 4): string[] {
  const text = cleanStepText(raw);
  if (!text) return [];
  const lines = text.split(/\n/)
    .map(l => l.trim())
    .filter(l => l.length > 6)
    .filter(l => /^[—\-·•!\✓※▶▷→]/.test(l) || /^\d+[\.\)]\s/.test(l))
    .filter(l => !l.startsWith("#"))
    .map(l => l.replace(/^[—\-·•!\✓※▶▷→\d\.\)]+\s*/, "").replace(/\*\*/g, "").trim())
    .filter(l => l.length > 6);
  return lines.slice(0, max);
}

/** 텍스트에서 Catalyst 한 줄 추출 */
function extractCatalystLine(raw: string | null | undefined): string {
  const text = cleanStepText(raw);
  if (!text) return "";
  const m = text.match(/(?:Catalyst|카탈리스트|핵심 모니터링|모니터링 포인트|Monitor)[:\s]+([^\n]+)/i);
  if (m) return m[1].trim().replace(/\*\*/g, "");
  return "";
}

/** analysis_steps content가 JSON 문자열일 수 있어 파싱 후 읽기 좋은 텍스트 추출 */
function cleanStepText(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();

  // 코드 펜스 제거: ```json ... ``` 또는 ``` ... ```
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) s = fenceMatch[1].trim();

  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object") {
        // summary > key_issue > description 순서로 가장 의미 있는 텍스트 추출
        for (const key of ["summary", "key_issue", "description", "content", "text", "analysis"]) {
          if (typeof obj[key] === "string" && obj[key].length > 20)
            return obj[key].replace(/\*\*/g, "").replace(/\\n/g, "\n");
        }
        // 그래도 없으면 긴 문자열 값들을 이어붙임
        const parts = Object.values(obj)
          .filter((v): v is string => typeof v === "string" && v.length > 20)
          .join("\n");
        if (parts) return parts.replace(/\*\*/g, "");
      }
    } catch { /* JSON 파싱 실패 — 아래 일반 처리로 */ }
  }
  return s.replace(/^#{1,4}\s*/gm, "").replace(/\*\*/g, "");
}

/** 섹션 텍스트에 JSON/코드펜스가 섞여 있을 때 읽기 좋은 텍스트로 정제 */
function cleanSectionText(raw: string): string {
  if (!raw) return raw;
  // 코드펜스 제거
  let s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // FINAL_VALUATION_DATA / VALUATION_DATA 메타 블록 제거 (JSON 파싱 방해 요소)
  s = s
    .replace(/FINAL_VALUATION_DATA:\s*\{[^\n]*\}/g, "")
    .replace(/VALUATION_DATA:\s*\{[^\n]*\}/g, "")
    .replace(/CHART_DATA:\s*\[[^\n]*\]/g, "")
    .replace(/EVENTS_DATA:\s*\[[^\n]*\]/g, "")
    .trim();

  // 첫 번째 { 위치에서 중괄호 카운팅으로 매칭되는 } 까지 JSON 블록 추출
  const start = s.indexOf("{");
  if (start !== -1) {
    let depth = 0, end = -1;
    for (let i = start; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end !== -1) {
      try {
        const obj = JSON.parse(s.slice(start, end + 1));
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const key of ["summary", "key_issue", "description", "content", "text", "analysis"]) {
            if (typeof obj[key] === "string" && obj[key].length > 20)
              return (obj[key] as string).replace(/\\n/g, "\n");
          }
          const parts = Object.values(obj)
            .filter((v): v is string => typeof v === "string" && v.length > 20)
            .join("\n");
          if (parts) return parts;
        }
      } catch { /* JSON 파싱 실패 → 정규식 fallback */ }
    }

    // 정규식으로 summary / key_issue 필드 직접 추출
    const mSummary = s.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mSummary) return mSummary[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    const mIssue = s.match(/"key_issue"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (mIssue) return mIssue[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }

  return s;
}

function parseBrief(summary: string) {
  type Icon = "core" | "risk" | "catalyst";
  const sections: { label: string; icon: Icon; text: string }[] = [];

  // 태그 기반 분할 — [오늘의핵심] [리스크] [투자포인트] (구: 투자아이디어, 촉매)
  const tagRe = /\[(오늘의핵심|리스크|투자포인트|투자아이디어|촉매)\]/g;
  const parts: { tag: string; text: string }[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(summary)) !== null) {
    if (parts.length > 0) parts[parts.length - 1].text = summary.slice(lastIdx, m.index).trim();
    parts.push({ tag: m[1], text: "" });
    lastIdx = m.index + m[0].length;
  }
  if (parts.length > 0) parts[parts.length - 1].text = summary.slice(lastIdx).trim();

  for (const { tag, text } of parts) {
    const clean = cleanSectionText(text);
    if (!clean) continue;
    if (tag === "오늘의핵심")  sections.push({ label: "Today's Key", icon: "core",     text: clean });
    else if (tag === "리스크") sections.push({ label: "Risk",        icon: "risk",     text: clean });
    else                       sections.push({ label: "Key Points",  icon: "catalyst", text: clean });
  }

  return sections.length > 0 ? sections : [{ label: "Briefing", icon: "core" as const, text: cleanSectionText(summary) }];
}

// ── 포트폴리오 뉴스 피드 ──────────────────────────────────────────────────────
interface PortfolioNewsItem {
  ticker: string;
  companyName: string;
  title: string;
  source: string;
  pubDate: string;
  url: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 2)   return "방금";
  if (mins < 60)  return `${mins}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7)   return `${days}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}

const TICKER_COLORS = [
  "bg-blue-500/15 text-blue-400 border-blue-500/20",
  "bg-violet-500/15 text-violet-400 border-violet-500/20",
  "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  "bg-amber-500/15 text-amber-400 border-amber-500/20",
  "bg-rose-500/15 text-rose-400 border-rose-500/20",
  "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  "bg-orange-500/15 text-orange-400 border-orange-500/20",
  "bg-pink-500/15 text-pink-400 border-pink-500/20",
];

function PortfolioNewsFeed({ tickers }: { tickers: string[] }) {
  const { isEn } = useLanguage();
  const [items, setItems]           = useState<PortfolioNewsItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [cachedAt, setCachedAt]     = useState<string | null>(null);
  const [expanded, setExpanded]     = useState(true);
  const [showAll, setShowAll]       = useState(false);
  const [filter, setFilter]         = useState<string>("all");

  const tickerColorMap = useRef<Map<string, string>>(new Map());
  const getColor = (ticker: string) => {
    if (!tickerColorMap.current.has(ticker)) {
      const idx = tickerColorMap.current.size % TICKER_COLORS.length;
      tickerColorMap.current.set(ticker, TICKER_COLORS[idx]);
    }
    return tickerColorMap.current.get(ticker)!;
  };

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const url = force
        ? getApiUrl("/api/portfolio/news?force=true")
        : getApiUrl("/api/portfolio/news");
      const r = await fetch(url, { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        setItems(d.items ?? []);
        setCachedAt(d.cachedAt ?? null);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uniqueTickers = Array.from(new Set(items.map(i => i.ticker)));
  const tickerNameMap = new Map(items.map(i => [i.ticker, i.companyName || i.ticker]));
  const filtered = filter === "all" ? items : items.filter(i => i.ticker === filter);
  const visible  = showAll ? filtered : filtered.slice(0, 8);

  if (!loading && items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center gap-2.5 px-4 py-3 hover:bg-muted/30 transition-colors">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex flex-1 items-center gap-2.5 min-w-0"
        >
          <Newspaper className="w-3.5 h-3.5 text-primary/60 shrink-0" />
          <span className="flex-1 text-[12px] font-semibold text-foreground/70 text-left">
            {isEn ? "Holdings News Feed" : "보유종목 뉴스"}
          </span>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/40 shrink-0" />}
          {!loading && items.length > 0 && (
            <span className="text-[10px] text-muted-foreground/40 shrink-0">
              {items.length}{isEn ? " articles" : "건"}
            </span>
          )}
          {cachedAt && !loading && (
            <span className="text-[10px] text-muted-foreground/30 shrink-0 hidden sm:inline">
              {relativeTime(cachedAt)} {isEn ? "updated" : "업데이트"}
            </span>
          )}
        </button>
        <button
          onClick={() => load(true)}
          className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
          title="새로고침"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
        <button onClick={() => setExpanded(v => !v)} className="shrink-0">
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/40 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            {/* 종목 필터 탭 */}
            {uniqueTickers.length > 1 && (
              <div className="border-t border-border px-3 py-2 flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
                <button
                  onClick={() => setFilter("all")}
                  className={cn(
                    "shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors",
                    filter === "all"
                      ? "bg-stone-200 text-stone-900 dark:bg-foreground/10 dark:text-foreground"
                      : "text-stone-500 hover:text-stone-900 dark:text-muted-foreground/50 dark:hover:text-foreground"
                  )}
                >
                  {isEn ? "All" : "전체"}
                </button>
                {uniqueTickers.map(t => (
                  <button
                    key={t}
                    onClick={() => setFilter(t)}
                    className={cn(
                      "shrink-0 px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors",
                      filter === t
                        ? getColor(t)
                        : "border-stone-300 text-stone-500 hover:text-stone-900 hover:border-stone-400 dark:border-border dark:text-muted-foreground/50 dark:hover:text-foreground"
                    )}
                  >
                    {/^\d+$/.test(t) ? (tickerNameMap.get(t) || t) : t}
                  </button>
                ))}
              </div>
            )}

            {/* 뉴스 목록 */}
            <div className="border-t border-border divide-y divide-border/50">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground/40">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-[12px]">{isEn ? "Fetching news..." : "뉴스 가져오는 중…"}</span>
                </div>
              ) : visible.length === 0 ? (
                <p className="text-center text-[12px] text-muted-foreground/30 py-6">
                  {isEn ? "No news found" : "뉴스가 없어요"}
                </p>
              ) : (
                visible.map((item, i) => (
                  <a
                    key={i}
                    href={item.url || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2.5 px-4 py-3 hover:bg-muted/20 transition-colors group"
                    onClick={e => !item.url && e.preventDefault()}
                  >
                    {/* 종목 뱃지 */}
                    <span className={cn(
                      "shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border",
                      getColor(item.ticker)
                    )}>
                      {/^\d+$/.test(item.ticker) ? (item.companyName || item.ticker) : item.ticker}
                    </span>
                    {/* 제목 + 메타 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-foreground/80 leading-snug line-clamp-2 group-hover:text-foreground transition-colors">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground/40">
                        {item.source && <span>{item.source}</span>}
                        {item.source && <span>·</span>}
                        <span>{relativeTime(item.pubDate)}</span>
                      </div>
                    </div>
                    {item.url && (
                      <ExternalLink className="w-3 h-3 text-muted-foreground/20 group-hover:text-muted-foreground/50 shrink-0 mt-1 transition-colors" />
                    )}
                  </a>
                ))
              )}
            </div>

            {/* 더보기 */}
            {!loading && filtered.length > 8 && (
              <div className="border-t border-border px-4 py-2.5">
                <button
                  onClick={() => setShowAll(v => !v)}
                  className="w-full text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center justify-center gap-1"
                >
                  {showAll
                    ? (isEn ? "Show less" : "접기")
                    : (isEn ? `Show all ${filtered.length} articles` : `전체 ${filtered.length}건 보기`)}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", showAll && "rotate-180")} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 보유 종목 카드 ────────────────────────────────────────────────────────────
function HoldingCard({ holding, onDelete, onRefresh, watchlistMode = false, hasBadgeAbove = false }: {
  holding: Holding; onDelete: (id: number) => void; onRefresh: () => void;
  watchlistMode?: boolean; hasBadgeAbove?: boolean;
}) {
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  const [deleting, setDeleting] = useState(false);
  const [confirmNewReport, setConfirmNewReport] = useState(false);
  const [changes, setChanges] = useState<ChangesResult | null>(null);
  const [changesExpanded, setChangesExpanded] = useState(false);
  const a = holding.analysis;

  useEffect(() => {
    fetch(getApiUrl(`/api/portfolio/changes/${encodeURIComponent(holding.ticker)}`), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setChanges(d); })
      .catch(() => {});
  }, [holding.ticker]);

  async function handleDelete() {
    if (!confirm(isEn ? `Remove ${holding.ticker} from portfolio?` : `${holding.ticker}를 포트폴리오에서 제거할까요?`)) return;
    setDeleting(true);
    await fetch(getApiUrl(`/api/portfolio/${holding.id}`), { method: "DELETE", credentials: "include" });
    onDelete(holding.id);
  }

  const changeColor = holding.change1d == null ? "text-muted-foreground"
    : holding.change1d > 0 ? "text-red-500"
    : holding.change1d < 0 ? "text-blue-500"
    : "text-muted-foreground";

  // 진행 바에 쓸 "대표" 목표가 — 내 분석 우선, 없으면 집단지성
  const barTarget = a?.targetPrice ?? a?.collectiveTargetPrice ?? null;
  // 현재가 vs 목표가 진행 바 (0~200% 범위에서 100% = 목표가)
  const priceBarPct = (() => {
    if (!holding.currentPrice || !barTarget) return null;
    const lo = Math.min(holding.currentPrice, barTarget) * 0.85;
    const hi = Math.max(holding.currentPrice, barTarget) * 1.05;
    return Math.round(((holding.currentPrice - lo) / (hi - lo)) * 100);
  })();
  const targetBarPct = (() => {
    if (!holding.currentPrice || !barTarget) return null;
    const lo = Math.min(holding.currentPrice, barTarget) * 0.85;
    const hi = Math.max(holding.currentPrice, barTarget) * 1.05;
    return Math.round(((barTarget - lo) / (hi - lo)) * 100);
  })();

  // ── 리서치 패널 데이터 (항상 표시) ─────────────────────────────────────────
  const thesisBullets = parseStrategyThesis(a?.strategy, 3);
  const riskBullets   = parseStrategyRisks(a?.strategy, 3);
  const catalystLine  = parseKeyCatalyst(a?.strategy, a?.catalysts);
  const hasResearch   = thesisBullets.length > 0 || riskBullets.length > 0 || !!catalystLine;

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
  const [logoErr, setLogoErr] = useState(false);
  const rawTicker = holding.ticker.replace(/\.(KS|KQ|KN)$/i, "");
  const logoUrl = isUSTicker(holding.ticker)
    ? `https://file.alphasquare.co.kr/media/images/stock_logo/us/${rawTicker}.png`
    : `https://file.alphasquare.co.kr/media/images/stock_logo/kr/${rawTicker.padStart(6, "0")}.png`;

  return (
    <>
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={cn(
        "border border-border bg-card overflow-hidden",
        hasBadgeAbove ? "rounded-b-2xl rounded-t-none" : "rounded-2xl"
      )}
    >
      {/* ── 헤더 ──────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3">
          {/* 회사 로고 */}
          <div className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center text-[18px] font-bold shrink-0 overflow-hidden",
            logoErr ? badgeColorClass : "bg-muted/60 border border-border"
          )}>
            {!logoErr ? (
              <img
                src={logoUrl}
                alt={holding.companyName}
                className="w-full h-full object-contain p-1"
                onError={() => setLogoErr(true)}
              />
            ) : initial}
          </div>

          {/* 종목 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold text-foreground leading-tight truncate">
                  {isEn && holding.englishName ? holding.englishName : holding.companyName}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="font-mono text-[11px] text-muted-foreground/60">{holding.ticker}</span>
                  {a?.verdict && (
                    <span className={cn(
                      "text-[10px] px-1.5 py-0 rounded font-bold border",
                      verdictBg(a.verdict), verdictColor(a.verdict)
                    )}>
                      {a.verdict === "Strong Buy" ? "BUY+" : a.verdict === "Buy" ? "BUY" : a.verdict === "Hold" ? "HOLD" : a.verdict === "Sell" ? "SELL" : a.verdict === "Strong Sell" ? "SELL-" : a.verdict}
                    </span>
                  )}
                  {a?.industry && (
                    <span className="text-[10px] text-muted-foreground/40">· {a.industry}</span>
                  )}
                </div>
              </div>
              {/* TP + 편집·삭제 */}
              <div className="flex items-start gap-1 shrink-0">
                {/* TP 우측 표시 */}
                {a?.targetPrice != null && (
                  <div className="text-right mr-1">
                    <p className="text-[13px] font-bold text-foreground leading-none tabular-nums">
                      TP {fmtPrice(a.targetPrice, holding.priceCurrency, isEn)}
                    </p>
                    {a.upsidePct != null && (
                      <p className={cn(
                        "text-[11px] tabular-nums mt-0.5 font-semibold",
                        a.upsidePct >= 0 ? "text-emerald-500" : "text-red-400"
                      )}>
                        {a.upsidePct >= 0 ? "+" : ""}{a.upsidePct.toFixed(1)}% {isEn ? "upside" : "여력"}
                      </p>
                    )}
                  </div>
                )}
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
            {holding.note && (
              <p className="mt-1 text-[11px] text-muted-foreground/50 truncate">{holding.note}</p>
            )}
          </div>
        </div>

        {/* ── 현재가 컴팩트 행 ─────────────────────────────────── */}
        <div className="mt-2 flex items-center gap-3">
          {holding.currentPrice != null ? (
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] text-muted-foreground/60">{isEn ? "Price" : "현재가"}</span>
              <span className="text-[14px] font-bold text-foreground tabular-nums">
                {fmtPrice(holding.currentPrice, holding.priceCurrency, isEn)}
              </span>
              {holding.change1d != null && (
                <span className={cn("text-[11px] tabular-nums font-medium", changeColor)}>
                  {holding.change1d > 0 ? "▲" : holding.change1d < 0 ? "▼" : ""}{fmtPct(Math.abs(holding.change1d))}
                </span>
              )}
            </div>
          ) : null}
          {/* 멀티뷰 TP */}
          {a?.collectiveTargetPrice != null && (
            <div className="flex items-baseline gap-1 ml-auto">
              <Users className="w-2.5 h-2.5 text-muted-foreground/40" />
              <span className="text-[10px] text-muted-foreground/50">{isEn ? "Multi" : "멀티뷰"}</span>
              <span className="text-[12px] font-semibold text-foreground/70 tabular-nums">
                {fmtPrice(a.collectiveTargetPrice, holding.priceCurrency, isEn)}
              </span>
              {a.collectiveUpsidePct != null && (
                <span className={cn("text-[10px] tabular-nums font-medium",
                  a.collectiveUpsidePct >= 0 ? "text-emerald-500" : "text-red-400")}>
                  {a.collectiveUpsidePct >= 0 ? "+" : ""}{a.collectiveUpsidePct.toFixed(1)}%
                </span>
              )}
            </div>
          )}
        </div>

        {/* 현재가 vs 목표가 바 */}
        {priceBarPct != null && targetBarPct != null && (
          <div className="mt-2 px-0.5">
            <div className="relative h-1 bg-muted/40 rounded-full overflow-visible">
              <div
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full border border-background z-10",
                  a?.upsidePct != null && a.upsidePct >= 0 ? "bg-emerald-400" : "bg-red-400"
                )}
                style={{ left: `clamp(0%, ${targetBarPct}%, 98%)` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-foreground border border-background z-20"
                style={{ left: `clamp(0%, ${priceBarPct}%, 98%)` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary/30"
                style={{ width: `${priceBarPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── 리서치 패널: THESIS + KEY RISK (항상 표시) ──────────────────────── */}
      {a && hasResearch && (
        <div className="border-t border-border/50">
          <div className="px-4 pt-3 pb-2 space-y-3">
            {/* THESIS — 전체 너비 */}
            {thesisBullets.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-wider mb-1.5">THESIS</p>
                <div className="space-y-1">
                  {thesisBullets.map((b, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-muted-foreground/35 select-none shrink-0 text-[11px] mt-px">—</span>
                      <span className="text-[12px] text-foreground/75 leading-snug line-clamp-2">{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* KEY RISK — 전체 너비 */}
            {riskBullets.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-red-400/60 uppercase tracking-wider mb-1.5">KEY RISK</p>
                <div className="space-y-1">
                  {riskBullets.map((b, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      <span className="text-red-400/50 select-none shrink-0 text-[11px] mt-px">!</span>
                      <span className="text-[12px] text-foreground/70 leading-snug line-clamp-2">{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Catalyst 한 줄 */}
          {catalystLine && (
            <div className="px-4 pb-3 flex items-start gap-2 border-t border-border/30">
              <span className="text-[10px] font-semibold text-muted-foreground/50 shrink-0 mt-0.5 pt-2">Catalyst</span>
              <span className="text-[12px] text-foreground/60 leading-snug line-clamp-2 pt-2">{catalystLine}</span>
            </div>
          )}
        </div>
      )}

      {/* ── 분석 없음 → 분석 유도 배너 ─────────────────────────── */}
      {!a && (
        <button
          onClick={() => setLocation(`/analysis/new?ticker=${holding.ticker}`)}
          className="mx-3 mb-3 w-[calc(100%-1.5rem)] flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
        >
          <Brain className="w-3.5 h-3.5 text-primary/60 shrink-0" />
          <span className="flex-1 text-[12px] text-primary/60">{isEn ? "Request AI analysis to see fair value and today's key issues" : "AI 분석을 요청하면 적정주가와 오늘의 이슈를 확인할 수 있어요"}</span>
          <ChevronRight className="w-3.5 h-3.5 text-primary/40 shrink-0" />
        </button>
      )}


      {/* ── 하단 액션 바 ──────────────────────────────────────── */}
      <div className="border-t border-border/60 px-3 py-2 flex items-center gap-2">
        {/* 보고서 보기 */}
        {a && (
          <button
            onClick={() => setLocation(`/analysis/${a.id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            <span>{isEn ? "View Report" : "보고서 보기"}</span>
          </button>
        )}

        <div className="flex-1" />

        {/* 새 보고서 작성하기 */}
        <button
          onClick={() => setConfirmNewReport(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-primary/80 hover:text-primary hover:bg-primary/8 border border-primary/20 hover:border-primary/40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5 shrink-0" />
          <span>{isEn ? "New Report" : "새 보고서 작성하기"}</span>
        </button>
      </div>


    </motion.div>

    {/* ── 새 보고서 확인 모달 ── */}
    <AnimatePresence>
      {confirmNewReport && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmNewReport(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6"
          >
            {/* 헤더 */}
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">{isEn ? "AI Stock Analysis" : "AI 기업분석"}</p>
                <h3 className="text-[18px] font-black text-foreground leading-tight truncate">{isEn && holding.englishName ? holding.englishName : holding.companyName}</h3>
                <p className="font-mono text-[11px] text-muted-foreground/50">{holding.ticker}</p>
              </div>
            </div>

            {/* 설명 */}
            <div className="rounded-xl bg-muted/60 px-4 py-3.5 mb-5 space-y-1">
              <p className="text-[13.5px] text-foreground/85 leading-relaxed">
                {isEn
                  ? <><span className="font-bold" style={{ color: "#FF8A7A" }}>AiBITDA's AI analyst team</span> begins a 7-step deep analysis.</>
                  : <><span className="font-bold" style={{ color: "#FF8A7A" }}>애빛다의 AI 애널리스트 팀</span>이<br />7단계 심층 분석을 시작합니다.</>
                }
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                {isEn ? "Avg. 3 min · Auto-selects DCF, rNPV & more" : "평균 3분 소요 · DCF·rNPV 등 밸류에이션 자동 선정"}
              </p>
            </div>

            {/* 버튼 */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmNewReport(false)}
                className="flex-1 py-3 rounded-xl border border-border text-[14px] font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                {isEn ? "Cancel" : "취소"}
              </button>
              <button
                onClick={() => { setConfirmNewReport(false); setLocation(`/analysis/new?ticker=${holding.ticker}`); }}
                className="flex-1 py-3 rounded-xl text-[14px] font-bold text-white transition-colors flex items-center justify-center gap-2"
                style={{ backgroundColor: "#FF8A7A" }}
              >
                {isEn ? "Start Analysis" : "분석 시작"} <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}


// ── 포트폴리오 전체 리뷰 컴포넌트 ──────────────────────────────────────────
function PortfolioReview({ holdings }: { holdings: Holding[] }) {
  const { isEn } = useLanguage();
  const [review, setReview] = useState<PortfolioReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function runReview() {
    setLoading(true);
    setError(null);
    setOpen(true);
    setReview(null);
    try {
      const r = await fetch(getApiUrl("/api/portfolio/review"), {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        setError((err as any).error ?? (isEn ? "Review generation failed" : "리뷰 생성 실패"));
        setLoading(false);
        return;
      }
      const d = await r.json() as PortfolioReviewResult;
      setReview(d);
    } catch {
      setError(isEn ? "Network error occurred" : "네트워크 오류가 발생했습니다");
    }
    setLoading(false);
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* 헤더 */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{isEn ? "AI Portfolio Review" : "AI 포트폴리오 전체 리뷰"}</p>
          <p className="text-[11px] text-muted-foreground">
            {isEn ? "News collection → thesis check → portfolio assessment" : "종목별 최신 뉴스 수집 → thesis 점검 → 포트폴리오 종합 판단"}
          </p>
        </div>
        <button
          onClick={runReview}
          disabled={loading}
          className={cn(
            "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors",
            loading
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          )}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {loading ? (isEn ? "Analyzing..." : "분석 중…") : (isEn ? "Start Review" : "리뷰 시작")}
          {!loading && <span className="text-[10px] text-amber-400/60 font-normal">{isEn ? "1 credit" : "크레딧 1"}</span>}
        </button>
      </div>

      {/* 결과 패널 */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="overflow-hidden"
          >
            <div className="border-t border-amber-500/15 bg-amber-500/[0.03]">
              {/* 로딩 */}
              {loading && (
                <div className="px-4 py-5 space-y-1.5">
                  <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground/60">
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
                    {isEn ? "Collecting latest news & checking thesis..." : "종목별 최신 뉴스 수집 & thesis 점검 중…"}
                  </div>
                  <p className="text-[11px] text-muted-foreground/40 pl-6">
                    {isEn ? `Fetching news for ${holdings.length} holdings. Please wait.` : `보유 ${holdings.length}개 종목 뉴스를 가져오고 있습니다. 잠시 기다려 주세요.`}
                  </p>
                </div>
              )}

              {/* 에러 */}
              {error && !loading && (
                <div className="px-4 py-4 flex items-center gap-2 text-[12px] text-red-400/80">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </div>
              )}

              {/* 결과 */}
              {review && !loading && (() => {
                // ── 비중 계산 (currentPrice × quantity) ─────────────────────
                const weightMap: Record<string, { pct: number; returnPct: number | null; value: number }> = {};
                const holdingsWithValue = holdings.map(h => ({
                  ticker: h.ticker,
                  companyName: h.companyName,
                  value: (h.currentPrice ?? h.avgPrice ?? 0) * (h.quantity ?? 0),
                  returnPct: h.returnPct ?? null,
                }));
                const totalValue = holdingsWithValue.reduce((s, h) => s + h.value, 0);
                if (totalValue > 0) {
                  for (const h of holdingsWithValue) {
                    weightMap[h.ticker] = {
                      pct: (h.value / totalValue) * 100,
                      returnPct: h.returnPct,
                      value: h.value,
                    };
                  }
                }
                const hasWeights = totalValue > 0;

                // ── 행동별 그룹 ──────────────────────────────────────────────
                const sellGroup   = review.stockUpdates.filter(s => s.action === "매도검토");
                const buyGroup    = review.stockUpdates.filter(s => s.action === "추가매수");
                const holdGroup   = review.stockUpdates.filter(s => s.action === "홀드");

                // ── 리스크 등급 색상 ─────────────────────────────────────────
                const gradeCfg: Record<string, { label: string; cls: string; bar: string }> = {
                  A: { label: "A — 우수", cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", bar: "bg-emerald-500" },
                  B: { label: "B — 양호", cls: "text-sky-400 border-sky-500/30 bg-sky-500/10", bar: "bg-sky-500" },
                  C: { label: "C — 주의", cls: "text-amber-400 border-amber-500/30 bg-amber-500/10", bar: "bg-amber-500" },
                  D: { label: "D — 위험", cls: "text-red-400 border-red-500/30 bg-red-500/10", bar: "bg-red-500" },
                };
                const grade = review.riskScore?.grade ?? "B";
                const gc = gradeCfg[grade] ?? gradeCfg["B"];

                // ── 섹션 레이블 헬퍼 ─────────────────────────────────────
                const SectionLabel = ({ children }: { children: React.ReactNode }) => (
                  <p className="text-[10.5px] font-medium text-foreground/35 mb-2.5 tracking-wide">{children}</p>
                );

                return (
                  <div className="divide-y divide-border/10">

                    {/* ① 행동 요약 */}
                    <div className="px-5 pt-4 pb-4">
                      <SectionLabel>{isEn ? "Today's action" : "지금 할 일"}</SectionLabel>
                      <div className="space-y-1.5">
                        {sellGroup.length > 0 && (
                          <div className="flex items-baseline gap-3">
                            <span className="text-[10.5px] text-red-400/80 font-medium shrink-0 w-[52px]">
                              {isEn ? "Sell" : "매도검토"}
                            </span>
                            <span className="text-[13px] text-foreground/80 leading-snug font-medium">
                              {sellGroup.map(s => s.companyName).join("  ·  ")}
                            </span>
                          </div>
                        )}
                        {buyGroup.length > 0 && (
                          <div className="flex items-baseline gap-3">
                            <span className="text-[10.5px] text-emerald-400/80 font-medium shrink-0 w-[52px]">
                              {isEn ? "Add" : "추가매수"}
                            </span>
                            <span className="text-[13px] text-foreground/80 leading-snug font-medium">
                              {buyGroup.map(s => s.companyName).join("  ·  ")}
                            </span>
                          </div>
                        )}
                        {holdGroup.length > 0 && (
                          <div className="flex items-baseline gap-3">
                            <span className="text-[10.5px] text-foreground/25 font-medium shrink-0 w-[52px]">
                              {isEn ? "Hold" : "홀드"}
                            </span>
                            <span className="text-[12px] text-foreground/40 leading-snug">
                              {holdGroup.map(s => s.companyName).join("  ·  ")}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ② 비중 & 수익률 기여도 */}
                    {hasWeights && (
                      <div className="px-5 py-4">
                        <SectionLabel>{isEn ? "Weight & return" : "비중 & 수익률"}</SectionLabel>
                        <div className="space-y-2">
                          {[...holdingsWithValue]
                            .sort((a, b) => (weightMap[b.ticker]?.pct ?? 0) - (weightMap[a.ticker]?.pct ?? 0))
                            .map(h => {
                              const w = weightMap[h.ticker];
                              if (!w) return null;
                              const ret = w.returnPct;
                              const contribution = ret != null ? (w.pct / 100) * ret : null;
                              const retColor = ret == null ? "text-foreground/30"
                                : ret > 0 ? "text-red-400" : ret < 0 ? "text-blue-400" : "text-foreground/30";
                              return (
                                <div key={h.ticker} className="flex items-center gap-2.5">
                                  <span className="text-[11.5px] text-foreground/60 w-[88px] truncate shrink-0">{h.companyName}</span>
                                  <div className="flex-1 h-[3px] bg-foreground/[0.06] rounded-full overflow-hidden">
                                    <div
                                      className={cn("h-full rounded-full", ret == null ? "bg-foreground/15" : ret > 0 ? "bg-red-400/50" : ret < 0 ? "bg-blue-400/50" : "bg-foreground/15")}
                                      style={{ width: `${Math.min(w.pct, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-[10.5px] text-foreground/35 w-7 text-right shrink-0 tabular-nums">{w.pct.toFixed(0)}%</span>
                                  {ret != null && (
                                    <span className={cn("text-[10.5px] font-medium w-16 text-right shrink-0 tabular-nums", retColor)}>
                                      {ret >= 0 ? "+" : ""}{ret.toFixed(1)}%
                                      {contribution != null && (
                                        <span className="text-[9px] text-foreground/25 font-normal"> ({contribution >= 0 ? "+" : ""}{contribution.toFixed(1)}p)</span>
                                      )}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}

                    {/* ③ 종목별 점검 */}
                    <div className="px-5 pt-4 pb-3">
                      <SectionLabel>{isEn ? "Stock updates" : "종목별 점검"}</SectionLabel>
                      <div className="space-y-4">
                        {review.stockUpdates.map(s => {
                          const borderColor = s.action === "매도검토" ? "border-red-400/35"
                            : s.action === "추가매수" ? "border-emerald-400/35"
                            : "border-border/20";
                          const sentimentText = s.sentiment === "bullish"
                            ? (isEn ? "bullish" : "강세")
                            : s.sentiment === "bearish"
                            ? (isEn ? "bearish" : "약세")
                            : (isEn ? "neutral" : "중립");
                          const sentimentColor = s.sentiment === "bullish" ? "text-red-400/70"
                            : s.sentiment === "bearish" ? "text-blue-400/70"
                            : "text-foreground/30";
                          const thesisText = s.thesisStatus === "훼손" ? (isEn ? "thesis impaired" : "thesis 훼손")
                            : s.thesisStatus === "일부변화" ? (isEn ? "thesis shifting" : "thesis 변화")
                            : null;
                          return (
                            <div key={s.ticker} className={cn("pl-3.5 border-l-[2px]", borderColor)}>
                              {/* 종목명 + 메타 */}
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[13px] font-semibold text-foreground/85">{s.companyName}</span>
                                <span className="text-[10px] text-foreground/25 font-mono">{s.ticker}</span>
                                <span className={cn("text-[10px] ml-auto shrink-0", sentimentColor)}>{sentimentText}</span>
                                {thesisText && (
                                  <span className="text-[10px] text-amber-400/60 shrink-0">{thesisText}</span>
                                )}
                              </div>
                              {/* thesis 변화 노트 */}
                              {s.thesisChangeNote && s.thesisChangeNote !== "주요 thesis 변화 없음" && (
                                <p className="text-[11px] text-foreground/45 italic mb-1.5 leading-snug">{s.thesisChangeNote}</p>
                              )}
                              {/* 핵심 이벤트 */}
                              {s.keyEvent && (
                                <p className="text-[11px] text-foreground/40 mb-1.5 leading-snug">
                                  <span className="text-foreground/20 mr-1">—</span>{s.keyEvent}
                                </p>
                              )}
                              {/* 분석 */}
                              <p className="text-[12px] text-foreground/65 leading-relaxed">{s.update}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ④ 리스크 */}
                    {review.riskScore && (
                      <div className="px-5 py-4">
                        <SectionLabel>{isEn ? "Risk" : "리스크"}</SectionLabel>
                        <p className="text-[12.5px] text-foreground/70 leading-relaxed">
                          <span className={cn("font-semibold", gc.cls.split(" ")[0])}>
                            {grade}{isEn ? "-grade" : "등급"} ({gc.label.split(" — ")[1]})
                          </span>
                          {" — "}{review.riskScore.sectorConcentration}
                        </p>
                        {review.riskScore.correlationRisk && (
                          <p className="text-[12px] text-foreground/45 leading-relaxed mt-1">{review.riskScore.correlationRisk}</p>
                        )}
                      </div>
                    )}

                    {/* ⑤ 종합 평가 */}
                    <div className="px-5 py-4">
                      <SectionLabel>{isEn ? "Overall view" : "종합 평가"}</SectionLabel>
                      <p className="text-[12.5px] text-foreground/70 leading-relaxed">{review.portfolioView}</p>
                    </div>

                    {/* ⑥ 리밸런싱 제안 */}
                    <div className="px-5 py-4">
                      <SectionLabel>{isEn ? "Rebalancing" : "리밸런싱 제안"}</SectionLabel>
                      <p className="text-[12.5px] text-foreground/70 leading-relaxed">{review.rebalancing}</p>
                    </div>

                    {/* ⑦ 섹터 보완 추천 */}
                    {review.sectorRecommendations.length > 0 && (
                      <div className="px-5 py-4">
                        <SectionLabel>{isEn ? "Sectors to consider" : "고려할 섹터"}</SectionLabel>
                        <div className="space-y-3">
                          {review.sectorRecommendations.map((rec, i) => (
                            <div key={i}>
                              <div className="flex items-baseline gap-2 mb-0.5">
                                <span className="text-[12.5px] font-semibold text-foreground/75">{rec.sector}</span>
                                {rec.exampleTickers.length > 0 && (
                                  <span className="text-[10px] text-foreground/30 font-mono">
                                    {rec.exampleTickers.join(" · ")}
                                  </span>
                                )}
                              </div>
                              <p className="text-[12px] text-foreground/55 leading-relaxed">{rec.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 푸터 */}
                    <div className="px-5 py-2.5 flex items-center justify-between">
                      <span className="text-[10px] text-foreground/25">
                        {isEn
                          ? `Gemini AI · ${new Date(review.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                          : `Gemini AI · ${new Date(review.generatedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
                      </span>
                      <button
                        onClick={runReview}
                        disabled={loading}
                        className="flex items-center gap-1 text-[10px] text-foreground/20 hover:text-foreground/50 transition-colors"
                      >
                        <RefreshCw className="w-2.5 h-2.5" />
                        {isEn ? "Rerun" : "다시 실행"}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 관심종목 섹션 ─────────────────────────────────────────────────────────────
function WatchlistSection({
  holdings, onAdd, onDelete, onRefresh,
}: {
  holdings: Holding[];
  onAdd: () => void;
  onDelete: (id: number) => void;
  onRefresh: () => void;
}) {
  const { isEn } = useLanguage();

  // 주목 뱃지 결정
  function getAlertBadge(h: Holding): { label: string; color: string } | null {
    const ch = h.change1d;
    if (ch == null) return null;
    if (ch >= 5) return { label: isEn ? `🔥 Surge +${ch.toFixed(1)}%` : `🔥 급등 +${ch.toFixed(1)}%`, color: "bg-red-500/10 border-red-400/30 text-red-400" };
    if (ch >= 3) return { label: isEn ? `📈 Up +${ch.toFixed(1)}%` : `📈 상승 +${ch.toFixed(1)}%`, color: "bg-red-400/8 border-red-400/20 text-red-400/80" };
    if (ch <= -5) return { label: isEn ? `📉 Drop ${ch.toFixed(1)}%` : `📉 급락 ${ch.toFixed(1)}%`, color: "bg-blue-500/10 border-blue-400/30 text-blue-400" };
    if (ch <= -3) return { label: isEn ? `⬇️ Down ${ch.toFixed(1)}%` : `⬇️ 하락 ${ch.toFixed(1)}%`, color: "bg-blue-400/8 border-blue-400/20 text-blue-400/80" };
    // 상승여력 높으면 매수 시그널
    const upside = h.analysis?.upsidePct;
    if (upside != null && upside >= 20) return { label: isEn ? `⭐ Upside +${upside.toFixed(0)}%` : `⭐ 상승여력 +${upside.toFixed(0)}%`, color: "bg-amber-400/10 border-amber-400/25 text-amber-500" };
    return null;
  }

  const hasAlert = holdings.some(h => getAlertBadge(h) != null);

  return (
    <div className="space-y-3">
      {/* 섹션 헤더 */}
      <div className="flex items-center gap-2 pt-2">
        <div className="flex items-center gap-1.5">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[13px] font-bold text-foreground/70">{isEn ? "Watchlist" : "관심종목"}</span>
          {holdings.length > 0 && (
            <span className="text-[10px] font-bold text-amber-500 bg-amber-400/10 px-1.5 py-0.5 rounded-full">{holdings.length}</span>
          )}
        </div>
        {hasAlert && (
          <span className="text-[10px] font-semibold text-red-400/70 bg-red-400/8 px-2 py-0.5 rounded-full border border-red-400/15">
            {isEn ? "Notable moves" : "주목 종목 있음"}
          </span>
        )}
        <div className="flex-1 h-px bg-border/40" />
        <button
          onClick={onAdd}
          className="flex items-center gap-1 text-[11px] font-semibold text-amber-500 hover:text-amber-600 transition-colors"
        >
          <Plus className="w-3 h-3" /> {isEn ? "Add" : "추가"}
        </button>
      </div>

      {holdings.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-dashed border-border/50 text-muted-foreground/40">
          <Star className="w-4 h-4 shrink-0" />
          <p className="text-[12px]">
            {isEn ? "Add stocks you're watching — we'll highlight surges and issues." : "사고 싶은 종목을 추가하면 급등·이슈를 챙겨드려요."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence mode="popLayout">
            {holdings.map(h => {
              const badge = getAlertBadge(h);
              return (
                <motion.div key={h.id} layout>
                  {badge && (
                    <div className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-t-xl border border-b-0 text-[11px] font-semibold -mb-1",
                      badge.color
                    )}>
                      <span>{badge.label}</span>
                      <span className="text-current/40 font-normal">
                        — {isEn ? "check this one" : "지금 확인해보세요"}
                      </span>
                    </div>
                  )}
                  <HoldingCard
                    holding={h}
                    onDelete={onDelete}
                    onRefresh={onRefresh}
                    watchlistMode
                    hasBadgeAbove={!!badge}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ── 포트폴리오 총수익 요약 카드 ──────────────────────────────────────────────
function PortfolioSummaryCard({ perf }: { perf: PerformanceData | null }) {
  const { isEn } = useLanguage();
  if (!perf?.today) return null;
  const { investedKrw, valueKrw, returnPct } = perf.today;
  if (investedKrw <= 0) return null;

  const plKrw = valueKrw - investedKrw;
  const isPositive = plKrw >= 0;
  const returnColor = returnPct == null ? "text-foreground"
    : returnPct > 0 ? "text-red-500 dark:text-red-400"
    : returnPct < 0 ? "text-blue-500 dark:text-blue-400"
    : "text-foreground";

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-5 pt-4 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-3.5 h-3.5 text-primary/50" />
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            {isEn ? "Portfolio P&L (KRW)" : "포트폴리오 손익 (원화)"}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-0">
          {/* 총 투자금 */}
          <div>
            <p className="text-[11px] text-muted-foreground mb-1">{isEn ? "Invested" : "투자금"}</p>
            <p className="text-[15px] font-bold text-foreground tabular-nums">
              {Math.round(investedKrw).toLocaleString("ko-KR")}
              <span className="text-[11px] font-normal text-muted-foreground ml-0.5">원</span>
            </p>
          </div>
          {/* 평가금액 */}
          <div className="px-3 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground mb-1">{isEn ? "Value" : "평가금액"}</p>
            <p className="text-[15px] font-bold text-foreground tabular-nums">
              {Math.round(valueKrw).toLocaleString("ko-KR")}
              <span className="text-[11px] font-normal text-muted-foreground ml-0.5">원</span>
            </p>
          </div>
          {/* 수익률 */}
          <div className="px-3 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground mb-1">{isEn ? "Return" : "수익률"}</p>
            <p className={cn("text-[18px] font-bold tabular-nums leading-tight", returnColor)}>
              {returnPct != null ? `${returnPct >= 0 ? "+" : ""}${returnPct.toFixed(2)}%` : "—"}
            </p>
            <p className={cn("text-[11px] font-medium tabular-nums", returnColor)}>
              {isPositive ? "+" : ""}{Math.round(plKrw).toLocaleString("ko-KR")}원
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 성과 차트 ─────────────────────────────────────────────────────────────────
function PerformanceChart({ perf, loading }: { perf: PerformanceData | null; loading: boolean }) {
  const { isEn } = useLanguage();

  const chartData = (perf?.snapshots ?? [])
    .filter(s => s.returnPct != null)
    .map(s => ({
      date: s.date.slice(5).replace("-", "/"),
      returnPct: parseFloat((s.returnPct ?? 0).toFixed(2)),
      valueKrw: Math.round(s.valueKrw),
    }));

  const hasData = chartData.length >= 2;
  const latestReturn = chartData.length > 0 ? chartData[chartData.length - 1].returnPct : null;
  const isPositive = latestReturn != null && latestReturn >= 0;
  const areaColor = isPositive ? "#ef4444" : "#3b82f6";

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/40">
        <BarChart3 className="w-3.5 h-3.5 text-primary/60 shrink-0" />
        <p className="text-[12px] font-semibold text-foreground/70 flex-1">
          {isEn ? "Portfolio Performance" : "포트폴리오 성과 추적"}
        </p>
        {latestReturn != null && (
          <span className={cn(
            "text-[11px] font-semibold px-2 py-0.5 rounded-full",
            isPositive ? "text-red-500 bg-red-500/10" : "text-blue-500 bg-blue-500/10"
          )}>
            {latestReturn >= 0 ? "+" : ""}{latestReturn.toFixed(2)}%
          </span>
        )}
      </div>

      <div className="px-4 py-3">
        {loading ? (
          <div className="flex items-center justify-center h-[120px] gap-2 text-muted-foreground/40">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[12px]">{isEn ? "Loading..." : "로딩 중…"}</span>
          </div>
        ) : !hasData ? (
          <div className="flex flex-col items-center justify-center h-[120px] text-center">
            <BarChart3 className="w-8 h-8 text-muted-foreground/20 mb-2" />
            <p className="text-[12px] text-muted-foreground/40">
              {isEn ? "Chart builds daily — come back tomorrow!" : "매일 스냅샷을 쌓아 차트를 만들어요. 내일 다시 확인해보세요!"}
            </p>
            {chartData.length === 1 && (
              <p className="text-[11px] text-muted-foreground/25 mt-1">
                {isEn ? "First data point recorded" : "첫 번째 데이터 기록됨"} ✓
              </p>
            )}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="perfGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={areaColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={areaColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "currentColor", opacity: 0.35 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "currentColor", opacity: 0.35 }} tickLine={false} axisLine={false} tickFormatter={v => `${v > 0 ? "+" : ""}${v}%`} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, isEn ? "Return" : "수익률"]}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              />
              <Area type="monotone" dataKey="returnPct" stroke={areaColor} strokeWidth={1.5} fill="url(#perfGrad)" dot={false} activeDot={{ r: 3, fill: areaColor }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <p className="text-[10px] text-muted-foreground/25 text-right mt-1">
          {isEn ? `${chartData.length}-day history` : `${chartData.length}일 누적`}
        </p>
      </div>
    </div>
  );
}

// ── 리밸런싱 카드 ─────────────────────────────────────────────────────────────
function RebalancingCard({ perf }: { perf: PerformanceData | null }) {
  const { isEn } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  const detail = perf?.today?.holdingsDetail ?? [];
  const withValue = detail.filter(h => h.value != null && h.value > 0 && h.currency === "KRW");
  const totalValue = withValue.reduce((s, h) => s + (h.value ?? 0), 0);
  if (totalValue <= 0 || withValue.length < 2) return null;

  const sorted = [...withValue].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const target = 100 / withValue.length;

  const highConc = sorted.filter(h => ((h.value ?? 0) / totalValue) * 100 > 35);
  const hasAlert = highConc.length > 0;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <Scale className={cn("w-3.5 h-3.5 shrink-0", hasAlert ? "text-amber-400" : "text-primary/60")} />
        <p className="text-[12px] font-semibold text-foreground/70 flex-1 text-left">
          {isEn ? "Rebalancing Analysis" : "리밸런싱 분석"}
        </p>
        {hasAlert && (
          <span className="text-[10px] font-semibold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full shrink-0">
            {isEn ? "Concentrated" : "집중 위험"}
          </span>
        )}
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/40 transition-transform shrink-0", expanded && "rotate-180")} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/40 px-4 py-3 space-y-2.5">
              <p className="text-[11px] text-muted-foreground/50">
                {isEn ? `Equal weight target: ${target.toFixed(1)}% per stock` : `균등 비중 기준: 종목당 ${target.toFixed(1)}%`}
              </p>
              {sorted.map(h => {
                const pct = ((h.value ?? 0) / totalValue) * 100;
                const drift = pct - target;
                const isOver = pct > 35;
                const isUnder = pct < target * 0.5 && withValue.length > 3;
                const barColor = isOver ? "bg-amber-400" : h.returnPct != null && h.returnPct > 0 ? "bg-red-400/60" : "bg-blue-400/60";
                const retColor = h.returnPct == null ? "text-muted-foreground/30"
                  : h.returnPct > 0 ? "text-red-400" : "text-blue-400";
                return (
                  <div key={h.ticker}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11.5px] text-foreground/70 font-medium truncate flex-1">{h.name || h.ticker}</span>
                      {isOver && <span className="text-[9.5px] text-amber-400 font-semibold shrink-0">{isEn ? "HIGH" : "과집중"}</span>}
                      {isUnder && <span className="text-[9.5px] text-muted-foreground/40 font-semibold shrink-0">{isEn ? "LOW" : "비중부족"}</span>}
                      <span className={cn("text-[10.5px] font-semibold tabular-nums shrink-0", retColor)}>
                        {h.returnPct != null ? `${h.returnPct >= 0 ? "+" : ""}${h.returnPct.toFixed(1)}%` : "—"}
                      </span>
                      <span className="text-[10.5px] text-muted-foreground/50 tabular-nums shrink-0 w-10 text-right">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", barColor)}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                      {/* 균등 비중 기준선 */}
                      <div
                        className="absolute top-0 h-full w-px bg-foreground/20"
                        style={{ left: `${Math.min(target, 99)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground/30 mt-0.5">
                      {drift > 0 ? `+` : ""}{drift.toFixed(1)}p {isEn ? "drift" : "편차"}
                      {isOver && (isEn ? " → Consider reducing" : " → 비중 축소 검토")}
                      {isUnder && (isEn ? " → Consider adding" : " → 추가 매수 검토")}
                    </p>
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

// ── 포트폴리오 히어로 배너 (삼쩜삼 스타일) ────────────────────────────────────
function heroRelativeTime(date: Date, isEn = false): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60)  return isEn ? `${sec}s ago` : `${sec}초 전`;
  if (sec < 3600) return isEn ? `${Math.floor(sec / 60)}m ago` : `${Math.floor(sec / 60)}분 전`;
  return format(date, "HH:mm");
}

function PortfolioHero({
  holdings, lastPriceUpdate, priceUpdating, onAdd,
}: {
  holdings: Holding[];
  lastPriceUpdate: Date | null;
  priceUpdating: boolean;
  onAdd: () => void;
}) {
  const { isEn } = useLanguage();
  const withUpside    = holdings.filter(h => h.analysis?.upsidePct != null);
  const avgUpside     = withUpside.length > 0
    ? withUpside.reduce((s, h) => s + (h.analysis!.upsidePct!), 0) / withUpside.length
    : null;
  const hasPositive   = avgUpside != null && avgUpside > 0;
  const analysedCount = holdings.filter(h => h.analysis).length;
  const analysedPct   = holdings.length > 0 ? (analysedCount / holdings.length) * 100 : 0;

  // Buy / Hold / Sell 분포
  const buyCount  = holdings.filter(h => /buy/i.test(h.analysis?.verdict ?? "")).length;
  const holdCount = holdings.filter(h => /hold/i.test(h.analysis?.verdict ?? "")).length;
  const sellCount = holdings.filter(h => /sell/i.test(h.analysis?.verdict ?? "")).length;

  return (
    <div className="rounded-2xl bg-card border border-border overflow-hidden">
      {/* 상단: 주요 수치 */}
      <div className="px-5 pt-5 pb-4">
        <p className="text-[12px] text-muted-foreground mb-1">{isEn ? "My Portfolio" : "내 포트폴리오"}</p>
        <div className="flex items-end gap-3">
          <div>
            <span className="text-[40px] font-bold text-foreground tabular-nums leading-none">
              {holdings.length}
            </span>
            <span className="text-[16px] text-muted-foreground ml-1.5">{isEn ? "stocks" : "개 종목"}</span>
          </div>
          {avgUpside != null && (
            <div className={cn(
              "mb-1.5 flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-semibold",
              hasPositive ? "bg-red-500/15 text-red-500" : "bg-blue-500/15 text-blue-500"
            )}>
              {hasPositive ? "▲" : "▼"} {isEn ? `Avg. ${Math.abs(avgUpside).toFixed(1)}% upside` : `평균 ${Math.abs(avgUpside).toFixed(1)}% 여력`}
            </div>
          )}
        </div>

        {/* 구분선 */}
        <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-3 gap-0">
          {/* AI 판정 분포 */}
          <div className="pr-3">
            <p className="text-[11px] text-muted-foreground mb-2">{isEn ? "AI Verdict" : "AI 판정"}</p>
            <div className="flex flex-col gap-1">
              {buyCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 inline-block" />{buyCount} {isEn ? "Buy" : "매수"}
                </span>
              )}
              {holdCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 inline-block" />{holdCount} {isEn ? "Hold" : "홀드"}
                </span>
              )}
              {sellCount > 0 && (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-red-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0 inline-block" />{sellCount} {isEn ? "Sell" : "매도"}
                </span>
              )}
              {buyCount + holdCount + sellCount === 0 && (
                <span className="text-[13px] font-bold text-muted-foreground/50">—</span>
              )}
            </div>
          </div>

          {/* AI 분석 완료 — 프로그레스 바 */}
          <div className="px-4 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground mb-2">{isEn ? "AI Analysis" : "AI 분석"}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${analysedPct}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-foreground tabular-nums shrink-0">
                {analysedCount}/{holdings.length}
              </span>
            </div>
          </div>

          {/* 가격 업데이트 — 상대 시간 */}
          <div className="pl-4 border-l border-border/40">
            <p className="text-[11px] text-muted-foreground mb-2">{isEn ? "Price Update" : "가격 갱신"}</p>
            <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              {priceUpdating
                ? <><Loader2 className="w-3 h-3 animate-spin" /> {isEn ? "Updating" : "갱신 중"}</>
                : lastPriceUpdate
                ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block shrink-0" />{heroRelativeTime(lastPriceUpdate, isEn)}</>
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
        <Plus className="w-4 h-4" /> {isEn ? "Add Stock" : "종목 추가하기"}
      </button>
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────────────
export default function Portfolio() {
  const { isEn } = useLanguage();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey, setSortKey] = useState<"added" | "upside">("added");
  const [lastPriceUpdate, setLastPriceUpdate] = useState<Date | null>(null);
  const [priceUpdating, setPriceUpdating] = useState(false);
  const holdingsRef = useRef<Holding[]>([]);

  // 성과 추적
  const [perf, setPerf] = useState<PerformanceData | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);


  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      // skipPrices=true: 분석/메타 데이터만 즉시 받고, 현재가는 batch-quotes로 후속 채움
      const r = await fetch(getApiUrl("/api/portfolio?skipPrices=true"), { credentials: "include" });
      if (r.ok) {
        const d = await r.json();
        const h = d.holdings ?? [];
        setHoldings(h);
        holdingsRef.current = h;
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

  // 성과 데이터 로드 (스냅샷 저장 + 이력 조회)
  const loadPerf = useCallback(async () => {
    setPerfLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/portfolio/performance"), { credentials: "include" });
      if (r.ok) setPerf(await r.json());
    } catch { /* ignore */ }
    finally { setPerfLoading(false); }
  }, []);

  useEffect(() => {
    // 1단계: 분석/메타 데이터 즉시 렌더
    load().then(() => {
      // 2단계: 로드 직후 batch-quotes로 현재가 채움 (캐시 있으면 즉각 반영)
      refreshPrices();
    });
    // 3단계: 성과 스냅샷 로드 (현재가 포함 계산 → 약간 느림)
    loadPerf();
  }, [load, refreshPrices, loadPerf]);

  // 30초마다 가격 자동 갱신
  useEffect(() => {
    const id = setInterval(refreshPrices, 30_000);
    return () => clearInterval(id);
  }, [refreshPrices]);

  function handleDelete(id: number) {
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  const portfolioHoldings = holdings.filter(h => (h.holdingType ?? "portfolio") === "portfolio");
  const watchlistHoldings = holdings.filter(h => h.holdingType === "watchlist");

  const sortedPortfolio = [...portfolioHoldings].sort((a, b) => {
    if (sortKey === "upside") return ((b.analysis?.upsidePct) ?? -Infinity) - ((a.analysis?.upsidePct) ?? -Infinity);
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });
  const sortedWatchlist = [...watchlistHoldings].sort((a, b) =>
    new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* ── 헤더: 새로고침 ── */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="p-2 rounded-xl hover:bg-muted text-muted-foreground/60 hover:text-muted-foreground"
          title="새로고침"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-36">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-7 h-7 animate-spin text-primary/60" />
            <p className="text-[13px] text-muted-foreground">{isEn ? "Loading portfolio..." : "포트폴리오 불러오는 중…"}</p>
          </div>
        </div>
      ) : holdings.length === 0 ? (
        /* ── 완전 빈 상태 ── */
        <div className="flex flex-col items-center justify-center py-32 space-y-5 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Briefcase className="w-8 h-8 text-primary/60" />
          </div>
          <div>
            <p className="text-[16px] font-bold text-foreground">{isEn ? "No stocks yet" : "종목이 없어요"}</p>
            <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed">
              {isEn
                ? "Add holdings or watchlist stocks to get started."
                : <>보유 종목이나 관심종목을 추가하면<br/>AI가 분석과 이슈를 한눈에 보여드려요.</>
              }
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> {isEn ? "Add First Stock" : "첫 종목 추가하기"}
          </button>
        </div>
      ) : (
        <>
          {/* ════ 보유종목 섹션 ════ */}
          {portfolioHoldings.length > 0 && (
            <>
              <PortfolioHero
                holdings={portfolioHoldings}
                lastPriceUpdate={lastPriceUpdate}
                priceUpdating={priceUpdating}
                onAdd={() => setShowAdd(true)}
              />
              <PortfolioSummaryCard perf={perf} />
              <PerformanceChart perf={perf} loading={perfLoading} />
              <RebalancingCard perf={perf} />

              {/* 정렬 */}
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-muted-foreground mr-1">{isEn ? "Sort" : "정렬"}</span>
                {(["added", "upside"] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setSortKey(k)}
                    className={cn(
                      "px-3 py-1.5 text-[11px] rounded-full transition-colors",
                      sortKey === k
                        ? "bg-stone-200 text-stone-900 font-semibold dark:bg-foreground/10 dark:text-foreground"
                        : "text-stone-500 hover:text-stone-900 dark:text-muted-foreground dark:hover:text-foreground"
                    )}
                  >
                    {isEn
                      ? { added: "Recently Added", upside: "By Upside" }[k]
                      : { added: "최근 추가순", upside: "상승여력순" }[k]
                    }
                  </button>
                ))}
              </div>

              <PortfolioNewsFeed tickers={portfolioHoldings.map(h => h.ticker)} />

              <div className="space-y-2.5">
                <AnimatePresence mode="popLayout">
                  {sortedPortfolio.map(h => (
                    <HoldingCard key={h.id} holding={h} onDelete={handleDelete} onRefresh={() => load(true)} />
                  ))}
                </AnimatePresence>
              </div>

              <PortfolioReview holdings={portfolioHoldings} />
            </>
          )}

          {/* 보유종목이 없으면 빈 상태 유도 */}
          {portfolioHoldings.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Briefcase className="w-6 h-6 text-primary/50" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-foreground">{isEn ? "No holdings yet" : "보유 종목이 없어요"}</p>
                <p className="text-[12px] text-muted-foreground mt-1">{isEn ? "Add stocks you've bought." : "실제로 보유한 종목을 추가해보세요."}</p>
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> {isEn ? "Add holding" : "보유종목 추가"}
              </button>
            </div>
          )}

          {/* ════ 관심종목 섹션 ════ */}
          <WatchlistSection
            holdings={sortedWatchlist}
            onAdd={() => setShowAdd(true)}
            onDelete={handleDelete}
            onRefresh={() => load(true)}
          />
        </>
      )}

      {/* 종목 추가 다이얼로그 */}
      <AnimatePresence>
        {showAdd && (
          <AddDialog
            onClose={() => setShowAdd(false)}
            onAdded={() => { load(); loadPerf(); }}
            defaultType="portfolio"
          />
        )}
      </AnimatePresence>

      {/* 멀티뷰 정의 */}
      <div className="mt-8 px-1 flex items-start gap-1.5 text-[10px] text-muted-foreground/35 leading-relaxed">
        <Users className="w-3 h-3 shrink-0 mt-0.5" />
        <p>
          {isEn
            ? <><span className="font-semibold text-muted-foreground/50">Multi-View</span> is the average AI fair value from multiple analysts who analyzed this stock within the last 30 days. Only the latest analyses are reflected, as fair value may vary by timing and context. Shown when 2+ analysts are available.</>
            : <><span className="font-semibold text-muted-foreground/50">멀티뷰</span>는 최근 30일 내 이 종목을 분석한 여러 분석자의 AI 적정주가를 평균낸 값입니다. 시점·이슈에 따라 적정주가가 달라질 수 있어 최신 분석만 반영합니다. 분석자가 2명 이상일 때 표시됩니다.</>
          }
        </p>
      </div>
    </div>
  );
}
