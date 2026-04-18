import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Loader2, Building2, ArrowRight, ChevronRight, Share2, Check, Zap, Flame } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ApiError } from "@workspace/api-client-react";
import { getApiUrl } from "@/lib/utils";

interface CreditStatus {
  dailyUsed: number;
  dailyLimit: number;
  bonusCredits: number;
  remaining: number;
  referralCode: string | null;
}

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

function CreditsBadge({ credits }: { credits: CreditStatus | undefined | null }) {
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch("/api/credits/referral/code", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return;
      const { code } = await res.json();
      const url = `${window.location.origin}/?ref=${code}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } finally {
      setSharing(false);
    }
  };

  if (!credits) return null;

  const dailyRemaining = Math.max(0, credits.dailyLimit - credits.dailyUsed);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
        credits.remaining === 0
          ? "bg-red-50 border-red-200 text-red-600"
          : credits.remaining <= 1
          ? "bg-amber-50 border-amber-200 text-amber-600"
          : "bg-emerald-50 border-emerald-200 text-emerald-600"
      }`}>
        <Zap className="w-3 h-3" />
        오늘 {dailyRemaining}회 남음
        {credits.bonusCredits > 0 && (
          <span className="ml-0.5 opacity-70">+{credits.bonusCredits} 보너스</span>
        )}
      </div>

      <button
        onClick={handleShare}
        disabled={sharing}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-neutral-200 text-neutral-500 hover:border-[#FF8A7A] hover:text-[#FF8A7A] transition-colors"
      >
        {copied ? (
          <><Check className="w-3 h-3 text-emerald-500" /><span className="text-emerald-500">링크 복사됨!</span></>
        ) : sharing ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <><Share2 className="w-3 h-3" />친구 초대 +1회</>
        )}
      </button>
    </div>
  );
}

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

function isKorean(str: string) {
  return /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(str);
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

function useTrendingTickers(): PopularTicker[] {
  const [trending, setTrending] = useState<PopularTicker[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(getApiUrl("/api/analysis/popular"));
        if (!r.ok) return;
        const data: { ticker: string; companyName: string; investmentVerdict: string | null }[] = await r.json();
        // Count by ticker
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

export default function NewAnalysis() {
  const [, setLocation] = useLocation();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();
  const queryClient = useQueryClient();
  const { data: credits } = useCredits();
  const [ticker, setTicker] = useState("");
  const [error, setError] = useState("");
  const trending = useTrendingTickers();

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
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);
  const pendingSubmit = useRef(false);
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
      if (pendingSubmit.current && data.length > 0) {
        pendingSubmit.current = false;
        setShowDropdown(false);
        setSuggestions([]);
        setTimeout(() => handleSubmitRef.current(data[0].symbol), 0);
      } else {
        pendingSubmit.current = false;
      }
    } catch {
      setSuggestions([]);
      pendingSubmit.current = false;
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
    const value = tickerValue.trim().toUpperCase();
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
    setTicker(sym);
    setSuggestions([]);
    setShowDropdown(false);
    handleSubmit(sym);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposing.current) return;
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      handleSelectSuggestion(suggestions[selectedIndex].symbol);
      return;
    }
    if (suggestions.length > 0) {
      handleSelectSuggestion(suggestions[0].symbol);
      return;
    }
    if (isSearching) {
      pendingSubmit.current = true;
      return;
    }
    handleSubmit(ticker);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isComposing.current) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
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
    <div className="min-h-[75vh] flex flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-xl flex flex-col gap-10"
      >
        {/* Headline */}
        <div className="space-y-3">
          <h1
            className="text-4xl md:text-5xl font-black tracking-tighter text-neutral-900 leading-[1.1]"
            style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900 }}
          >
            어떤 종목을<br />분석할까요?
          </h1>
          <p className="text-sm text-neutral-400 leading-relaxed break-keep">
            코스피·코스닥·NYSE·NASDAQ 종목코드 또는 회사명으로 검색하면{" "}
            <br className="hidden sm:block" />AI 에이전트가 즉시 심층 분석을 시작합니다
          </p>
          <CreditsBadge credits={credits} />
        </div>

        {/* Search */}
        <form onSubmit={onSubmit} className="w-full relative">
          <div
            className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 transition-all duration-150 ${
              error
                ? "border-red-400 ring-2 ring-red-100"
                : "border-neutral-200 focus-within:border-neutral-400 focus-within:ring-2 focus-within:ring-neutral-100"
            }`}
          >
            <Search className="w-4 h-4 text-neutral-300 shrink-0" />
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
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-neutral-900 text-[15px] placeholder:text-neutral-300 placeholder:text-sm"
              autoFocus
              disabled={isPending}
              autoComplete="off"
            />
            {isSearching && <Loader2 className="w-4 h-4 animate-spin text-neutral-300 shrink-0" />}
            <button
              type="submit"
              disabled={isPending || !ticker.trim()}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-neutral-900 text-white text-[13px] font-semibold hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>분석 시작<ArrowRight className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>

          {/* Autocomplete Dropdown */}
          <AnimatePresence>
            {showDropdown && suggestions.length > 0 && (
              <motion.div
                ref={dropdownRef}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.1 }}
                className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-neutral-200 rounded-xl shadow-lg z-50 overflow-hidden"
              >
                {suggestions.map((s, i) => {
                  const isKrStock = /\.(KS|KQ)$/.test(s.symbol);
                  const code = isKrStock ? s.symbol.replace(/\.(KS|KQ)$/, "") : s.symbol;
                  const ex = s.exchange;
                  const badgeStyle =
                    ex === "KOSPI" ? "bg-blue-50 text-blue-500" :
                    ex === "KOSDAQ" ? "bg-emerald-50 text-emerald-600" :
                    ex === "NASDAQ" ? "bg-violet-50 text-violet-600" :
                    ex === "NYSE" ? "bg-orange-50 text-orange-600" :
                    "bg-neutral-100 text-neutral-500";
                  const badgeLabel =
                    ex === "KOSPI" ? "코스피" :
                    ex === "KOSDAQ" ? "코스닥" :
                    ex || "US";
                  return (
                    <button
                      key={s.symbol}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(s.symbol); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left border-b border-neutral-100 last:border-0 ${
                        i === selectedIndex ? "bg-neutral-50" : "hover:bg-neutral-50"
                      }`}
                    >
                      <div className="w-8 h-8 rounded-lg bg-neutral-100 flex items-center justify-center shrink-0">
                        <Building2 className="w-3.5 h-3.5 text-neutral-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-neutral-900 truncate">{s.shortname}</span>
                          <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeStyle}`}>
                            {badgeLabel}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-neutral-400">{code}</span>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-300 shrink-0" />
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-red-500"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {isPending && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 text-xs text-neutral-400 text-center"
            >
              기업 정보 조회 중...
            </motion.p>
          )}
        </form>

        {/* 인기 종목 */}
        <AnimatePresence>
          {trending.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-1.5">
                <Flame className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">많이 찾은 기업</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {trending.map((t) => (
                  <motion.button
                    key={t.ticker}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setTicker(t.ticker); handleSubmit(t.ticker); }}
                    disabled={isPending}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-neutral-50 border border-neutral-200 hover:border-primary/40 hover:bg-primary/5 transition-all disabled:opacity-40 group"
                  >
                    <span className="font-mono text-[10px] text-neutral-300 group-hover:text-primary/60 transition-colors">{t.ticker}</span>
                    <span className="text-[12.5px] text-neutral-700 font-medium">{t.companyName}</span>
                    {t.count > 1 && (
                      <span className="text-[9px] text-neutral-300 font-medium">×{t.count}</span>
                    )}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick picks */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-neutral-300 uppercase tracking-wider whitespace-nowrap">국내</span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES_KR.map((ex) => (
                <button
                  key={ex.ticker}
                  onClick={() => { setTicker(ex.ticker); handleSubmit(ex.ticker); }}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 text-[12.5px] text-neutral-500 hover:border-neutral-900 hover:text-neutral-900 transition-colors disabled:opacity-40"
                >
                  <span className="font-mono text-[11px] text-neutral-300">{ex.ticker}</span>
                  <span>{ex.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-neutral-300 uppercase tracking-wider whitespace-nowrap">미국</span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES_US.map((ex) => (
                <button
                  key={ex.ticker}
                  onClick={() => { setTicker(ex.ticker); handleSubmit(ex.ticker); }}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 text-[12.5px] text-neutral-500 hover:border-neutral-900 hover:text-neutral-900 transition-colors disabled:opacity-40"
                >
                  <span className="font-mono text-[11px] text-neutral-300">{ex.ticker}</span>
                  <span>{ex.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
