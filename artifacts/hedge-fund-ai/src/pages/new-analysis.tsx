import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Loader2, Building2, ArrowRight, ChevronRight, Zap, Flame, Clock, TrendingUp, TrendingDown, Minus, BarChart2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ApiError } from "@workspace/api-client-react";
import { getApiUrl, cn } from "@/lib/utils";

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

const VERDICT_MINI: Record<string, { icon: React.ReactNode; color: string }> = {
  "Strong Buy":  { icon: <TrendingUp className="w-3 h-3" />,  color: "text-emerald-600" },
  "Buy":         { icon: <TrendingUp className="w-3 h-3" />,  color: "text-green-600" },
  "Hold":        { icon: <Minus className="w-3 h-3" />,        color: "text-amber-500" },
  "Sell":        { icon: <TrendingDown className="w-3 h-3" />, color: "text-orange-500" },
  "Strong Sell": { icon: <TrendingDown className="w-3 h-3" />, color: "text-red-500" },
};

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

// 회원 개인화 Quick Picks: 자주 분석한 종목 상위 6개
function usePersonalizedPicks() {
  return useQuery<{ ticker: string; companyName: string | null; count: number }[]>({
    queryKey: ["personalized-picks"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/analyses?limit=50"), { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      const list: RecentAnalysis[] = d.data ?? d ?? [];
      // 티커별 빈도 집계
      const map = new Map<string, { companyName: string | null; count: number }>();
      for (const a of list) {
        const existing = map.get(a.ticker);
        if (existing) {
          existing.count++;
          if (!existing.companyName && a.companyName) existing.companyName = a.companyName;
        } else {
          map.set(a.ticker, { companyName: a.companyName, count: 1 });
        }
      }
      return [...map.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 6)
        .map(([ticker, v]) => ({ ticker, ...v }));
    },
    staleTime: 1000 * 60 * 5,
  });
}

// 유사 기업 추천: 상위 분석 종목의 피어 그룹에서 미분석 기업 제안
interface RelatedCompany {
  ticker: string;
  companyName: string;
  baseTicker: string;
  baseCompanyName: string;
}

function useRelatedCompanies(
  recentAnalyses: RecentAnalysis[] | undefined,
  personalizedPicks: { ticker: string; companyName: string | null; count: number }[] | undefined,
): RelatedCompany[] {
  const [related, setRelated] = useState<RelatedCompany[]>([]);

  useEffect(() => {
    // 기준 종목: 자주 분석한 1위 종목 또는 최근 분석 종목
    const baseTicker =
      personalizedPicks?.[0]?.ticker ??
      recentAnalyses?.[0]?.ticker?.replace(/\.(KS|KQ)$/, "");
    const baseCompanyName =
      personalizedPicks?.[0]?.companyName ??
      recentAnalyses?.[0]?.companyName ??
      baseTicker;

    if (!baseTicker) return;

    // 이미 분석한 티커 집합
    const analyzed = new Set<string>([
      ...(recentAnalyses?.map(a => a.ticker?.replace(/\.(KS|KQ)$/, "")) ?? []),
      ...(personalizedPicks?.map(p => p.ticker) ?? []),
    ]);

    (async () => {
      try {
        const r = await fetch(
          getApiUrl(`api/peers/latest?subject=${encodeURIComponent(baseTicker)}`),
          { credentials: "include" },
        );
        if (!r.ok) return;
        const data = await r.json();
        const peers: RelatedCompany[] = Object.entries(
          (data.peers ?? {}) as Record<string, { name?: string }>,
        )
          .filter(([t]) => !analyzed.has(t))
          .slice(0, 6)
          .map(([t, m]) => ({
            ticker: t,
            companyName: m.name ?? t,
            baseTicker: baseTicker!,
            baseCompanyName: baseCompanyName ?? baseTicker!,
          }));
        setRelated(peers);
      } catch {}
    })();
  }, [recentAnalyses, personalizedPicks]);

  return related;
}

function CreditsBadge({ credits }: { credits: CreditStatus | undefined | null }) {
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
      </div>
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
  const { data: recentAnalyses } = useRecentAnalyses();
  const { data: personalizedPicks } = usePersonalizedPicks();
  const relatedCompanies = useRelatedCompanies(recentAnalyses, personalizedPicks);

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

  // ── 이탈 종목 재분석: ?ticker= 쿼리 파라미터로 자동 pre-fill + 제출 ──
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
  const [selectHint, setSelectHint] = useState(false); // 드롭다운 선택 유도 힌트
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
    // 한국 종목: .KS/.KQ 없이 6자리 코드만 사용
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
    // 한국 종목 suffix 제거 후 표시
    const normalized = /^\d{6}\.(KS|KQ)$/.test(sym.toUpperCase()) ? sym.split(".")[0] : sym;
    setTicker(normalized);
    setSuggestions([]);
    setShowDropdown(false);
    handleSubmit(normalized);
  };

  // 6자리 숫자 코드 or 순수 영문 티커(1-5자)는 직접 입력 허용
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

    // 방향키로 선택한 항목 있으면 바로 실행
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      handleSelectSuggestion(suggestions[selectedIndex].symbol);
      return;
    }

    const val = ticker.trim();

    // 6자리 숫자 코드 또는 영문 1~5자 티커 → 직접 제출 허용
    if (isDirectTicker(val)) {
      handleSubmit(val);
      return;
    }

    // ── 이하는 회사명(한글/영문 full name) 입력 케이스 ──
    // 반드시 드롭다운 목록에서 선택해야 분석 시작 가능

    // 이미 결과 있으면 드롭다운 선택 유도
    if (suggestions.length > 0) {
      showSelectHint();
      return;
    }

    // 검색 중이면 대기 안내
    if (isSearching) {
      setError("종목 검색 중입니다. 목록이 나타나면 선택해 주세요");
      setShowDropdown(true);
      return;
    }

    // 빠른 Enter로 디바운스 타이머가 아직 미발동 → 즉시 검색 트리거 후 블로킹
    if (val) {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      fetchSuggestions(val);
      setError("목록에서 종목을 선택한 후 분석을 시작해 주세요");
      return;
    }

    setError("종목코드 또는 종목명을 입력해주세요");
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
            className="text-4xl md:text-5xl font-black tracking-tighter text-foreground leading-[1.1]"
            style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif", fontWeight: 900 }}
          >
            어떤 종목을<br />분석할까요?
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed break-keep">
            코스피·코스닥·NYSE·NASDAQ 종목코드 또는 회사명으로 검색하면{" "}
            <br className="hidden sm:block" />AI 에이전트가 즉시 심층 분석을 시작합니다
          </p>
          <CreditsBadge credits={credits} />
        </div>

        {/* Search */}
        <form onSubmit={onSubmit} className="w-full relative">
          <div
            className={`flex items-center gap-3 bg-background border rounded-xl px-4 py-3 transition-all duration-150 ${
              error
                ? "border-red-400 ring-2 ring-red-100"
                : "border-border focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/10"
            }`}
          >
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

          {/* Autocomplete Dropdown */}
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
                {/* 드롭다운 헤더 */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    종목 선택
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    ↑↓ 이동 · Enter 선택
                  </span>
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
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isHighlighted ? "bg-primary/10" : "bg-muted"
                      }`}>
                        <Building2 className={`w-4 h-4 transition-colors ${isHighlighted ? "text-primary" : "text-muted-foreground"}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[14px] font-semibold text-foreground truncate">{s.shortname}</span>
                          <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeStyle}`}>
                            {badgeLabel}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">{code}</span>
                      </div>
                      <div className={`flex items-center gap-1 shrink-0 transition-opacity ${isHighlighted ? "opacity-100" : "opacity-0"}`}>
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

          {/* 검색 중 + 검색어가 이름인 경우 안내 */}
          <AnimatePresence>
            {isSearching && !isDirectTicker(ticker.trim()) && (
              <motion.p
                initial={{ opacity: 0, y: -2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                종목 검색 중...
              </motion.p>
            )}
          </AnimatePresence>

          {/* 드롭다운 선택 유도 힌트 */}
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
              className="mt-3 text-xs text-muted-foreground text-center"
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
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">많이 찾은 기업</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {trending.map((t) => (
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
                    {t.count > 1 && (
                      <span className="text-[9px] text-muted-foreground/50 font-medium">×{t.count}</span>
                    )}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 자주 분석한 종목 (개인화) — 이력 2개 이상인 경우 표시 */}
        {personalizedPicks && personalizedPicks.length >= 2 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-1.5">
              <BarChart2 className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">자주 분석한 종목</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {personalizedPicks.slice(0, 4).map((p) => {
                const lastAnalysis = recentAnalyses?.find(
                  a => (a.ticker?.replace(/\.(KS|KQ)$/, "") === p.ticker) || a.ticker === p.ticker
                );
                const vm = VERDICT_MINI[lastAnalysis?.investmentVerdict ?? ""];
                return (
                  <button
                    key={p.ticker}
                    onClick={() => { setTicker(p.ticker); handleSubmit(p.ticker); }}
                    disabled={isPending}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-card hover:bg-accent transition-colors text-left group disabled:opacity-40"
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground truncate">{p.companyName ?? p.ticker}</p>
                      <p className="text-[11px] font-mono text-muted-foreground">{p.ticker}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.count > 1 && (
                        <span className="text-[10px] text-muted-foreground/50 font-mono tabular-nums">×{p.count}회</span>
                      )}
                      {vm && (
                        <span className={cn("flex items-center gap-0.5 text-[11px] font-semibold", vm.color)}>
                          {vm.icon}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* 관심 있을 만한 기업 — 최다 분석 종목의 피어 그룹에서 미분석 기업 추천 */}
        {relatedCompanies.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                관심 있을 만한 기업
              </span>
              <span className="text-[9px] text-muted-foreground/40">
                · {relatedCompanies[0].baseCompanyName} 피어 그룹
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {relatedCompanies.map((c) => (
                <button
                  key={c.ticker}
                  onClick={() => { setTicker(c.ticker); handleSubmit(c.ticker); }}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-[12.5px] text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-primary/5 transition-colors disabled:opacity-40"
                >
                  <span className="font-mono text-[11px] text-muted-foreground/40">{c.ticker}</span>
                  <span className="truncate max-w-[120px]">{c.companyName}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {/* 최근 분석 기록 (개인화) */}
        {recentAnalyses && recentAnalyses.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-1.5 justify-between">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-primary" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">최근 분석 기록</span>
              </div>
              <a href="/history" className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-0.5 transition-colors">
                전체 보기 <ChevronRight className="w-3 h-3" />
              </a>
            </div>
            <div className="flex flex-col gap-1.5">
              {recentAnalyses.slice(0, 4).map(a => {
                const vm = VERDICT_MINI[a.investmentVerdict ?? ""];
                const shortTicker = a.ticker?.replace(/\.(KS|KQ)$/, "");
                const upside = a.targetPrice && a.startPrice
                  ? ((a.targetPrice - a.startPrice) / a.startPrice) * 100
                  : null;
                return (
                  <button
                    key={a.id}
                    onClick={() => setLocation(`/analysis/${a.id}`)}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-card hover:bg-accent transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-foreground truncate">{a.companyName ?? a.ticker}</p>
                      <p className="text-[11px] font-mono text-muted-foreground">{shortTicker}</p>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      {vm && (
                        <p className={`text-xs font-semibold flex items-center gap-1 justify-end ${vm.color}`}>
                          {vm.icon}
                          {a.investmentVerdict}
                        </p>
                      )}
                      {upside !== null && (
                        <p className={`text-[10px] font-mono ${upside >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Quick picks — 기본 예시 */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider whitespace-nowrap">국내</span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES_KR.map((ex) => (
                <button
                  key={ex.ticker}
                  onClick={() => { setTicker(ex.ticker); handleSubmit(ex.ticker); }}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-[12.5px] text-muted-foreground hover:border-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <span className="font-mono text-[11px] text-muted-foreground/40">{ex.ticker}</span>
                  <span>{ex.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider whitespace-nowrap">미국</span>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES_US.map((ex) => (
                <button
                  key={ex.ticker}
                  onClick={() => { setTicker(ex.ticker); handleSubmit(ex.ticker); }}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-[12.5px] text-muted-foreground hover:border-foreground hover:text-foreground transition-colors disabled:opacity-40"
                >
                  <span className="font-mono text-[11px] text-muted-foreground/40">{ex.ticker}</span>
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
