import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Loader2, Building2, ArrowRight, ChevronRight, Zap, Flame,
  Clock, TrendingUp, TrendingDown, Minus, Sparkles, BarChart2,
  Eye, AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ApiError } from "@workspace/api-client-react";
import { getApiUrl } from "@/lib/utils";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CreditStatus {
  dailyUsed: number;
  dailyLimit: number;
  bonusCredits: number;
  remaining: number;
  referralCode: string | null;
}

interface RecentAnalysis {
  id: number;
  ticker: string;
  companyName: string | null;
  investmentVerdict: string | null;
  targetPrice: number | null;
  startPrice: number | null;
  createdAt: string;
  status: string;
}

interface IndexData {
  key: string;
  label: string;
  currency: string;
  price: number | null;
  change: number | null;
  changeAbs: number | null;
  prevClose: number | null;
}

interface AiBriefing {
  headline: string;
  summary: string;
  keyThemes: { icon: string; title: string; desc: string }[];
  signals: { type: "bullish" | "bearish" | "neutral"; text: string }[];
  watchList: string[];
}

interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
  quoteType: string;
}

interface PopularTicker {
  ticker: string;
  companyName: string;
  count: number;
  investmentVerdict: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const VERDICT_MINI: Record<string, { icon: React.ReactNode; color: string }> = {
  "Strong Buy":  { icon: <TrendingUp className="w-3 h-3" />,  color: "text-emerald-600" },
  "Buy":         { icon: <TrendingUp className="w-3 h-3" />,  color: "text-green-600" },
  "Hold":        { icon: <Minus className="w-3 h-3" />,        color: "text-amber-500" },
  "Sell":        { icon: <TrendingDown className="w-3 h-3" />, color: "text-orange-500" },
  "Strong Sell": { icon: <TrendingDown className="w-3 h-3" />, color: "text-red-500" },
};

const EXAMPLES_KR = [
  { ticker: "005930", label: "삼성전자" },
  { ticker: "000660", label: "SK하이닉스" },
  { ticker: "035420", label: "NAVER" },
];

const EXAMPLES_US = [
  { ticker: "NVDA", label: "NVIDIA" },
  { ticker: "AAPL", label: "Apple" },
  { ticker: "TSLA", label: "Tesla" },
];

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useCredits() {
  return useQuery<CreditStatus>({
    queryKey: ["credits"],
    queryFn: async () => {
      const res = await fetch("/api/credits", { credentials: "include" });
      if (!res.ok) return null as any;
      return res.json();
    },
    staleTime: 30_000,
  });
}

function useRecentAnalyses() {
  return useQuery<RecentAnalysis[]>({
    queryKey: ["recent-analyses-home"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/analyses?limit=5"), { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      return d.data ?? d ?? [];
    },
    staleTime: 1000 * 60 * 2,
  });
}

function useIndices() {
  return useQuery<IndexData[]>({
    queryKey: ["market-indices"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/market-data/indices"));
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5,
  });
}

function useAiBriefing() {
  return useQuery<AiBriefing>({
    queryKey: ["ai-briefing"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/market-data/ai-briefing"));
      if (!r.ok) throw new Error("briefing failed");
      return r.json();
    },
    staleTime: 1000 * 60 * 60 * 3,
  });
}

function useTrendingTickers(): PopularTicker[] {
  const [trending, setTrending] = useState<PopularTicker[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(getApiUrl("/api/analysis/popular"));
        if (!r.ok) return;
        const data: { ticker: string; companyName: string; investmentVerdict: string | null }[] = await r.json();
        const map = new Map<string, { companyName: string; count: number; investmentVerdict: string | null }>();
        for (const d of data) {
          const existing = map.get(d.ticker);
          if (existing) { existing.count++; } else { map.set(d.ticker, { companyName: d.companyName, count: 1, investmentVerdict: d.investmentVerdict }); }
        }
        const sorted = [...map.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 8)
          .map(([ticker, v]) => ({ ticker, ...v }));
        setTrending(sorted);
      } catch {}
    })();
  }, []);
  return trending;
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function IndexChip({ idx }: { idx: IndexData }) {
  const up = (idx.change ?? 0) >= 0;
  const isRate = idx.key === "USDKRW";

  const fmt = (v: number) => {
    if (isRate) return v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
    if (idx.currency === "KRW") return v.toLocaleString("ko-KR", { maximumFractionDigits: 0 });
    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg bg-muted/40 border border-border/50 min-w-[90px]">
      <span className="text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wide">{idx.label}</span>
      {idx.price != null ? (
        <>
          <span className="text-[13px] font-bold text-foreground leading-none">{fmt(idx.price)}</span>
          <span className={cn("text-[10px] font-medium", up ? "text-emerald-600" : "text-red-500")}>
            {up ? "▲" : "▼"} {Math.abs(idx.change ?? 0).toFixed(2)}%
          </span>
        </>
      ) : (
        <span className="text-[11px] text-muted-foreground/40">—</span>
      )}
    </div>
  );
}

function AiBriefingCard({ briefing }: { briefing: AiBriefing }) {
  const signalColor = (type: string) =>
    type === "bullish" ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : type === "bearish" ? "text-red-500 bg-red-50 border-red-200"
    : "text-amber-600 bg-amber-50 border-amber-200";

  const signalIcon = (type: string) =>
    type === "bullish" ? <TrendingUp className="w-3 h-3" />
    : type === "bearish" ? <TrendingDown className="w-3 h-3" />
    : <Minus className="w-3 h-3" />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="rounded-xl border border-border bg-gradient-to-br from-background to-muted/20 p-4 flex flex-col gap-3"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-primary">
          <Sparkles className="w-3.5 h-3.5" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">AI 마켓 브리핑</span>
        </div>
        <span className="ml-auto text-[10px] text-muted-foreground/50">
          {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} 기준
        </span>
      </div>

      {/* Headline */}
      <p className="text-sm font-semibold text-foreground leading-snug">{briefing.headline}</p>

      {/* Summary */}
      <p className="text-[12px] text-muted-foreground leading-relaxed">{briefing.summary}</p>

      {/* Key Themes */}
      <div className="flex flex-wrap gap-2">
        {briefing.keyThemes.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted border border-border text-xs">
            <span>{t.icon}</span>
            <span className="font-medium text-foreground/80">{t.title}</span>
            <span className="text-muted-foreground/60">{t.desc}</span>
          </div>
        ))}
      </div>

      {/* Signals + WatchList */}
      <div className="flex gap-3 flex-wrap">
        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">시그널</span>
          {briefing.signals.map((s, i) => (
            <div key={i} className={cn("flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium w-fit", signalColor(s.type))}>
              {signalIcon(s.type)}
              {s.text}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">주목 섹터</span>
          {briefing.watchList.map((w, i) => (
            <div key={i} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Eye className="w-2.5 h-2.5 text-primary/50" />
              {w}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function CreditsBadge({ credits }: { credits: CreditStatus | undefined | null }) {
  if (!credits) return null;
  const dailyRemaining = Math.max(0, credits.dailyLimit - credits.dailyUsed);
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
      credits.remaining === 0
        ? "bg-red-50 border-red-200 text-red-600"
        : credits.remaining <= 1
        ? "bg-amber-50 border-amber-200 text-amber-600"
        : "bg-emerald-50 border-emerald-200 text-emerald-600"
    }`}>
      <Zap className="w-3 h-3" />
      오늘 {dailyRemaining}회 남음
    </div>
  );
}

function isKorean(str: string) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(str);
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function NewAnalysis() {
  const [, setLocation] = useLocation();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();
  const queryClient = useQueryClient();
  const { data: credits } = useCredits();
  const [ticker, setTicker] = useState("");
  const [error, setError] = useState("");
  const trending = useTrendingTickers();
  const { data: recentAnalyses } = useRecentAnalyses();
  const { data: indices } = useIndices();
  const { data: briefing, isLoading: briefingLoading } = useAiBriefing();

  useEffect(() => {
    const code = localStorage.getItem("pending_referral");
    if (!code) return;
    localStorage.removeItem("pending_referral");
    fetch("/api/credits/referral/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ code }),
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["credits"] });
    }).catch(() => {});
  }, [queryClient]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("ticker");
    if (!prefill) return;
    const val = prefill.trim().toUpperCase();
    setTicker(val);
    const t = setTimeout(() => {
      handleSubmitRef.current(val);
    }, 350);
    return () => clearTimeout(t);
  }, []);

  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const [selectHint, setSelectHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);
  const handleSubmitRef = useRef<(val: string) => Promise<void>>(async () => {});

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query.trim()) { setSuggestions([]); setShowDropdown(false); return; }
    setIsSearching(true);
    try {
      const res = await fetch(`/api/market-data/search/${encodeURIComponent(query)}`);
      const data: SearchResult[] = await res.json();
      setSuggestions(data);
      setShowDropdown(data.length > 0);
      setSelectedIndex(-1);
    } catch {
      setSuggestions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = ticker.trim();
    const isKoreanInput = isKorean(t);
    const isDigitInput = /^\d{2,}$/.test(t);
    const isEnglishInput = /^[A-Za-z0-9\-\. ]{2,}$/.test(t);
    if (!isKoreanInput && !isDigitInput && !isEnglishInput) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const delay = isDigitInput ? 150 : 350;
    searchTimer.current = setTimeout(() => fetchSuggestions(t), delay);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [ticker, fetchSuggestions]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSubmit = async (tickerValue: string) => {
    let value = tickerValue.trim().toUpperCase();
    if (/^\d{6}\.(KS|KQ)$/.test(value)) {
      value = value.split(".")[0];
      setTicker(value);
    }
    if (!value) {
      setError("종목코드 또는 종목명을 입력해주세요");
      inputRef.current?.focus();
      return;
    }
    setError("");
    setShowDropdown(false);
    try {
      const result = await startAnalysis({ data: { ticker: value } });
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      setLocation(`/analysis/${result.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        const msg = (err.data as any)?.error ?? "오늘 분석 횟수를 모두 사용했습니다.";
        setError(msg);
      } else {
        setError("분석을 시작할 수 없습니다. 올바른 종목코드를 확인해주세요.");
      }
    }
  };

  handleSubmitRef.current = handleSubmit;

  const handleSelectSuggestion = (sym: string) => {
    const normalized = /^\d{6}\.(KS|KQ)$/.test(sym.toUpperCase()) ? sym.split(".")[0] : sym;
    setTicker(normalized);
    setSuggestions([]);
    setShowDropdown(false);
    handleSubmit(normalized);
  };

  const isDirectTicker = (val: string) =>
    /^\d{6}$/.test(val) || /^[A-Za-z]{1,5}$/.test(val);

  const showSelectHint = () => {
    setSelectHint(true);
    setShowDropdown(true);
    if (suggestions.length > 0 && selectedIndex < 0) setSelectedIndex(0);
    setTimeout(() => setSelectHint(false), 2000);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing.current) return;
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      handleSelectSuggestion(suggestions[selectedIndex].symbol);
      return;
    }
    const val = ticker.trim();
    if (isDirectTicker(val)) {
      handleSubmit(val);
      return;
    }
    if (isSearching || suggestions.length > 0) {
      showSelectHint();
      return;
    }
    handleSubmit(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing.current) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setShowDropdown(true);
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setSelectedIndex(-1);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 py-6">

      {/* ── 주요 지수 바 ── */}
      {indices && indices.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex items-stretch gap-2 overflow-x-auto pb-1 scrollbar-none"
        >
          {indices.map((idx) => (
            <IndexChip key={idx.key} idx={idx} />
          ))}
        </motion.div>
      )}

      {/* ── AI 브리핑 ── */}
      {briefingLoading ? (
        <div className="rounded-xl border border-border bg-muted/20 p-4 flex items-center gap-2.5">
          <Loader2 className="w-4 h-4 animate-spin text-primary/50" />
          <span className="text-sm text-muted-foreground">AI가 오늘의 마켓 브리핑을 준비하고 있습니다...</span>
        </div>
      ) : briefing ? (
        <AiBriefingCard briefing={briefing} />
      ) : null}

      {/* ── 검색 섹션 ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              어떤 종목을 분석할까요?
            </h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              코스피·코스닥·NYSE·NASDAQ 종목코드 또는 회사명으로 검색
            </p>
          </div>
          <CreditsBadge credits={credits} />
        </div>

        {/* Search bar */}
        <form onSubmit={onSubmit} className="w-full relative">
          <div className={cn(
            "flex items-center gap-3 bg-background border rounded-xl px-4 py-3 transition-all duration-150",
            error
              ? "border-red-400 ring-2 ring-red-100"
              : "border-border focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/10"
          )}>
            <Search className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={ticker}
              onChange={(e) => { setTicker(e.target.value); setError(""); }}
              onCompositionStart={() => { isComposing.current = true; }}
              onCompositionEnd={(e) => {
                isComposing.current = false;
                setTicker(e.currentTarget.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="삼성전자, NVDA, 005930, AAPL..."
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-foreground text-[15px] placeholder:text-muted-foreground/40 placeholder:text-sm"
              autoFocus
              disabled={isPending}
              autoComplete="off"
            />
            {isSearching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50 shrink-0" />}
            <button
              type="submit"
              disabled={isPending || !ticker.trim()}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-foreground text-background text-[13px] font-semibold hover:bg-foreground/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>분석 시작<ArrowRight className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>

          {/* Autocomplete */}
          <AnimatePresence>
            {showDropdown && suggestions.length > 0 && (
              <motion.div
                ref={dropdownRef}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{
                  opacity: 1, y: 0, scale: 1,
                  boxShadow: selectHint
                    ? "0 0 0 2px hsl(var(--primary)), 0 8px 24px rgba(0,0,0,0.12)"
                    : "0 4px 16px rgba(0,0,0,0.08)",
                }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.12 }}
                className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border rounded-xl z-50 overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">종목 선택</span>
                  <span className="text-[10px] text-muted-foreground/60">↑↓ 이동 · Enter 선택</span>
                </div>
                {suggestions.map((s, i) => {
                  const isKrStock = /\.(KS|KQ)$/.test(s.symbol);
                  const code = isKrStock ? s.symbol.replace(/\.(KS|KQ)$/, "") : s.symbol;
                  const ex = s.exchange;
                  const badgeStyle =
                    ex === "KOSPI" ? "bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400" :
                    ex === "KOSDAQ" ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400" :
                    ex === "NASDAQ" ? "bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400" :
                    ex === "NYSE" ? "bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400" :
                    "bg-muted text-muted-foreground";
                  const badgeLabel =
                    ex === "KOSPI" ? "코스피" :
                    ex === "KOSDAQ" ? "코스닥" :
                    ex || "US";
                  const isHighlighted = i === selectedIndex;
                  return (
                    <motion.button
                      key={s.symbol}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(s.symbol); }}
                      onTouchEnd={(e) => { e.preventDefault(); handleSelectSuggestion(s.symbol); }}
                      animate={isHighlighted ? { backgroundColor: "hsl(var(--accent))" } : { backgroundColor: "transparent" }}
                      whileHover={{ backgroundColor: "hsl(var(--accent))" }}
                      whileTap={{ scale: 0.99 }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 transition-colors text-left border-b border-border/60 last:border-0 cursor-pointer"
                    >
                      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                        isHighlighted ? "bg-primary/10" : "bg-muted"
                      )}>
                        <Building2 className={cn("w-4 h-4 transition-colors", isHighlighted ? "text-primary" : "text-muted-foreground")} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[14px] font-semibold text-foreground truncate">{s.shortname}</span>
                          <span className={cn("shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full", badgeStyle)}>
                            {badgeLabel}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">{code}</span>
                      </div>
                      <div className={cn("flex items-center gap-1 shrink-0 transition-opacity", isHighlighted ? "opacity-100" : "opacity-0")}>
                        <span className="text-[10px] text-primary font-medium">선택</span>
                        <ChevronRight className="w-3.5 h-3.5 text-primary" />
                      </div>
                      {!isHighlighted && (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                      )}
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isSearching && !isDirectTicker(ticker.trim()) && (
              <motion.p
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5"
              >
                <Loader2 className="w-3 h-3 animate-spin" /> 종목 검색 중...
              </motion.p>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {selectHint && (
              <motion.p
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-primary font-medium flex items-center gap-1"
              >
                ↑ 위 목록에서 종목을 클릭하거나 ↑↓ 방향키로 선택 후 Enter를 눌러주세요
              </motion.p>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {error && !selectHint && (
              <motion.p
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-red-500 flex items-center gap-1"
              >
                <AlertCircle className="w-3 h-3" /> {error}
              </motion.p>
            )}
          </AnimatePresence>
          {isPending && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 text-xs text-muted-foreground text-center"
            >
              기업 정보 조회 중...
            </motion.p>
          )}
        </form>

        {/* 빠른 선택 예시 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground/50 mr-0.5">예시</span>
          {[...EXAMPLES_KR, ...EXAMPLES_US].map((ex) => (
            <button
              key={ex.ticker}
              type="button"
              onClick={() => { setTicker(ex.ticker); handleSubmit(ex.ticker); }}
              disabled={isPending}
              className="text-[11px] px-2.5 py-1 rounded-full border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* ── 많이 찾은 기업 ── */}
      <AnimatePresence>
        {trending.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, delay: 0.15 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-1.5">
              <Flame className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">많이 찾은 기업</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {trending.map((t) => {
                const vm = t.investmentVerdict ? VERDICT_MINI[t.investmentVerdict] : null;
                return (
                  <motion.button
                    key={t.ticker}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setTicker(t.ticker); handleSubmit(t.ticker); }}
                    disabled={isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted border border-border hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-40 group"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground/50 group-hover:text-primary/60 transition-colors">{t.ticker}</span>
                    <span className="text-[12.5px] text-foreground/80 font-medium">{t.companyName}</span>
                    {vm && <span className={cn("text-[10px] font-medium", vm.color)}>{vm.icon}</span>}
                    {t.count > 1 && <span className="text-[9px] text-muted-foreground/50">×{t.count}</span>}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 최근 분석 기록 ── */}
      {recentAnalyses && recentAnalyses.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center gap-1.5 justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">최근 분석 기록</span>
            </div>
            <button
              onClick={() => setLocation("/history")}
              className="text-[10px] text-muted-foreground/60 hover:text-primary transition-colors flex items-center gap-0.5"
            >
              전체 보기 <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            {recentAnalyses.slice(0, 5).map((a) => {
              const vm = a.investmentVerdict ? VERDICT_MINI[a.investmentVerdict] : null;
              const upside = (a.targetPrice && a.startPrice && a.startPrice > 0)
                ? ((a.targetPrice - a.startPrice) / a.startPrice * 100)
                : null;
              return (
                <motion.button
                  key={a.id}
                  whileHover={{ x: 2 }}
                  onClick={() => setLocation(`/analysis/${a.id}`)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-muted/40 border border-border/60 hover:border-primary/30 hover:bg-primary/3 transition-all text-left group"
                >
                  <div className="w-8 h-8 rounded-md bg-background border border-border flex items-center justify-center shrink-0">
                    <BarChart2 className="w-3.5 h-3.5 text-muted-foreground/60 group-hover:text-primary/60 transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground truncate">{a.companyName ?? a.ticker}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/50">{a.ticker}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {vm && (
                        <span className={cn("flex items-center gap-0.5 text-[10px] font-medium", vm.color)}>
                          {vm.icon} {a.investmentVerdict}
                        </span>
                      )}
                      {upside != null && (
                        <span className={cn("text-[10px]", upside >= 0 ? "text-emerald-600" : "text-red-500")}>
                          {upside >= 0 ? "▲" : "▼"} {Math.abs(upside).toFixed(1)}%
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/40">
                        {new Date(a.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-primary/50 transition-colors shrink-0" />
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      )}
    </div>
  );
}
