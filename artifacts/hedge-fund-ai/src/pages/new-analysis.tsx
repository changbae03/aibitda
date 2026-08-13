import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Loader2, Building2, ArrowRight, ChevronRight, Zap, Flame, Clock, TrendingUp, TrendingDown, Minus, BarChart2, LogIn, Check, Lock, Calendar } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ApiError } from "@workspace/api-client-react";
import { getApiUrl, cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

/* ── 익명 분석 횟수 제한 ─────────────────────────────────────────────────── */
const ANON_LIMIT = 3;
const ANON_KEY = "anon_analysis_count";
function getAnonCount(): number {
  return parseInt(localStorage.getItem(ANON_KEY) ?? "0", 10);
}
function incrementAnonCount() {
  localStorage.setItem(ANON_KEY, String(getAnonCount() + 1));
}

interface AuthUser { id: string; nickname: string; profileImage: string | null }
function useAuth() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  useEffect(() => {
    fetch(getApiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setUser(d?.user ?? null))
      .catch(() => setUser(null));
  }, []);
  return user;
}

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
      const res = await fetch(getApiUrl("/api/credits"), { credentials: "include" });
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
  englishName: string | null;
  investmentVerdict: string | null;
  targetPrice: number | null;
  startPrice: number | null;
  createdAt: string;
  status: string;
}

// 언어 모드에 따른 표시명 선택: 영문 모드이고 영문명 있으면 영문명, 아니면 한국어명
function dn(ko: string | null | undefined, en: string | null | undefined, isEn: boolean): string {
  if (isEn && en) return en;
  return ko ?? en ?? "";
}

const VERDICT_MINI: Record<string, { icon: React.ReactNode; color: string }> = {
  "Strong Buy":  { icon: <TrendingUp className="w-3 h-3" />,  color: "text-emerald-600" },
  "Buy":         { icon: <TrendingUp className="w-3 h-3" />,  color: "text-green-600" },
  "Hold":        { icon: <Minus className="w-3 h-3" />,        color: "text-amber-500" },
  "Sell":        { icon: <TrendingDown className="w-3 h-3" />, color: "text-orange-500" },
  "Strong Sell": { icon: <TrendingDown className="w-3 h-3" />, color: "text-red-500" },
};

// localStorage에서 최근 조회 종목 읽기 (비로그인 포함)
const LOCAL_RECENT_KEY = "avitda-recent-analyses";
function useLocalRecentTickers(): Array<{ id: number; ticker: string; companyName: string | null; englishName: string | null }> {
  const [items, setItems] = useState<Array<{ id: number; ticker: string; companyName: string | null; englishName: string | null }>>([]);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_RECENT_KEY) || "[]") as any[];
      const seen = new Set<string>();
      const deduped = raw.filter((x) => {
        const t = (x.ticker ?? "").replace(/\.(KS|KQ)$/, "");
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
      }).slice(0, 8);
      setItems(deduped.map((x) => ({ id: x.id, ticker: (x.ticker ?? "").replace(/\.(KS|KQ)$/, ""), companyName: x.companyName ?? null, englishName: x.englishName ?? null })));
    } catch {}
  }, []);
  return items;
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

// 회원 개인화 Quick Picks: 자주 분석한 종목 상위 6개
function usePersonalizedPicks() {
  return useQuery<{ ticker: string; companyName: string | null; englishName: string | null; count: number }[]>({
    queryKey: ["personalized-picks"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("/api/analyses?limit=50"), { credentials: "include" });
      if (!r.ok) return [];
      const d = await r.json();
      const list: RecentAnalysis[] = d.data ?? d ?? [];
      // 티커별 빈도 집계
      const map = new Map<string, { companyName: string | null; englishName: string | null; count: number }>();
      for (const a of list) {
        const existing = map.get(a.ticker);
        if (existing) {
          existing.count++;
          if (!existing.companyName && a.companyName) existing.companyName = a.companyName;
          if (!existing.englishName && a.englishName) existing.englishName = a.englishName;
        } else {
          map.set(a.ticker, { companyName: a.companyName, englishName: a.englishName, count: 1 });
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
  personalizedPicks: { ticker: string; companyName: string | null; englishName: string | null; count: number }[] | undefined,
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
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  if (!credits) return null;

  if (credits.remaining === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius)] border border-amber-500/40 bg-amber-950/25 text-amber-300 text-[12px] font-medium"
      >
        <Zap className="w-3 h-3 shrink-0" />
        <span>{isEn ? "All credits used · Come back tomorrow" : "오늘 크레딧 소진 · 내일 다시 이용해주세요"}</span>
      </motion.div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border",
      credits.remaining <= 2
        ? "text-amber-400 border-amber-400/40 bg-amber-400/5"
        : "text-muted-foreground border-border/50"
    )}>
      <Zap className={cn("w-3 h-3", credits.remaining <= 2 ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
      {isEn ? `${credits.remaining} credits left` : `크레딧 ${credits.remaining}개 남음`}
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
  englishName?: string;
  exchange: string;
  quoteType: string;
}

interface PopularTicker {
  ticker: string;
  companyName: string;
  englishName: string | null;
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
        const data: { ticker: string; companyName: string; englishName: string | null; investmentVerdict: string | null }[] = await r.json();
        // Count by ticker
        const map = new Map<string, { companyName: string; englishName: string | null; count: number; investmentVerdict: string | null }>();
        for (const d of data) {
          const existing = map.get(d.ticker);
          if (existing) { existing.count++; } else { map.set(d.ticker, { companyName: d.companyName, englishName: d.englishName ?? null, count: 1, investmentVerdict: d.investmentVerdict }); }
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
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();
  const queryClient = useQueryClient();
  const { data: credits } = useCredits();
  const user = useAuth();
  const [ticker, setTicker] = useState("");
  const [error, setError] = useState("");
  const trending = useTrendingTickers();
  const localRecent = useLocalRecentTickers();
  const { data: recentAnalyses } = useRecentAnalyses();
  const { data: personalizedPicks } = usePersonalizedPicks();
  const relatedCompanies = useRelatedCompanies(recentAnalyses, personalizedPicks);

  useEffect(() => {
    const code = localStorage.getItem("pending_referral");
    if (!code) return;
    localStorage.removeItem("pending_referral");
    fetch(getApiUrl("/api/credits/referral/register"), {
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
  const [selectHint, setSelectHint] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ ticker: string; companyName: string } | null>(null);
  const [showAnonGate, setShowAnonGate] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);
  const handleSubmitRef = useRef<(val: string) => Promise<void>>(async () => {});
  const touchStartY = useRef(0);
  const touchMoved = useRef(false);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (!query.trim()) { setSuggestions([]); setShowDropdown(false); return; }
    setIsSearching(true);
    try {
      const res = await fetch(getApiUrl(`/api/market-data/search/${encodeURIComponent(query)}`));
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
    // 익명 사용자 3회 제한
    if (user === null && getAnonCount() >= ANON_LIMIT) {
      setShowAnonGate(true);
      return;
    }

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
      if (user === null) incrementAnonCount();
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      setLocation(`/analysis/${result.id}`);
    } catch (err) {
      const errStatus = (err as any)?.status as number | undefined;
      const errMsg = (err as any)?.data?.error as string | undefined;
      if (errStatus === 402) {
        setError(errMsg ?? "오늘 크레딧이 모두 소진됐습니다. 내일 다시 이용해주세요.");
      } else if (errStatus === 429) {
        setError("분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.");
      } else if (errStatus === 400) {
        setError(errMsg ?? "유효하지 않은 종목코드입니다.");
      } else {
        setError(errMsg ?? "분석을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.");
      }
    }
  };

  handleSubmitRef.current = handleSubmit;

  const showConfirm = (tickerVal: string, companyName: string) => {
    setTicker(tickerVal);
    setSuggestions([]);
    setShowDropdown(false);
    inputRef.current?.blur();
    setConfirmModal({ ticker: tickerVal, companyName });
  };

  const handleSelectSuggestion = (sym: string, name?: string, englishName?: string) => {
    const normalized = /^\d{6}\.(KS|KQ)$/.test(sym.toUpperCase()) ? sym.split(".")[0] : sym;
    const displayName = (isEn && englishName) ? englishName : (name ?? normalized);
    showConfirm(normalized, displayName);
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

    // 방향키로 선택한 항목 있으면 입력창에만 채우기
    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      const s = suggestions[selectedIndex];
      handleSelectSuggestion(s.symbol, s.shortname, s.englishName);
      return;
    }

    const val = ticker.trim();

    // 6자리 숫자 코드 또는 영문 1~5자 티커 → 확인 팝업 표시
    if (isDirectTicker(val)) {
      showConfirm(val, selectedCompany || val);
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
    <>
    <div className="min-h-[75dvh] flex flex-col items-center justify-start pt-14 sm:justify-center sm:pt-0">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-xl flex flex-col gap-10"
      >
        {/* Headline */}
        <div className="space-y-4">
          {/* 브랜드가 아니라 **질문**을 건다. 바로 아래 검색창이 답을 받는 자리라
              "무엇을 하는 화면인가"가 한 줄로 읽힌다. (브랜드는 상단 헤더에 이미 있다) */}
          <h1
            className="text-[2.5rem] md:text-[3.25rem] font-bold tracking-tight text-foreground leading-[1.15]"
            style={{ wordBreak: 'keep-all' }}
          >
            {isEn ? (
              <>Which company<br />are you curious about?</>
            ) : (
              <>어떤 기업이<br />궁금하세요?</>
            )}
          </h1>
          <p className="text-[15px] text-muted-foreground/80 leading-relaxed break-keep font-medium">
            {isEn ? (
              // ⚠️ `<br className="hidden sm:block">`을 쓰면 모바일에서 br이 사라지면서
              // 두 문장이 그대로 붙는다("…짚어드립니다종목코드나"). 항상 별도 줄로 둔다.
              <>
                <span className="block">We compare years of filings to place a company on its curve.</span>
                <span className="block">Enter a ticker or company name to start.</span>
              </>
            ) : (
              <>
                <span className="block">3년치 공시를 나란히 놓고 대조해 기업의 이면을 파악합니다</span>
                <span className="block">종목코드나 회사명으로 검색해보세요</span>
              </>
            )}
          </p>
          <CreditsBadge credits={credits} />
        </div>

        {/* Search */}
        <form onSubmit={onSubmit} className="w-full relative">
          <div
            className={`flex items-center gap-3 bg-card border rounded-2xl px-4 py-3.5 shadow-sm transition-all duration-200 ${
              error
                ? "border-red-400 ring-2 ring-red-400/20"
                : "border-border/60 focus-within:border-foreground/30 focus-within:shadow-md focus-within:ring-2 focus-within:ring-foreground/8"
            }`}
          >
            <Search className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={ticker}
              onChange={(e) => { setTicker(e.target.value); setError(""); setSelectedCompany(null); }}
              onCompositionStart={() => { isComposing.current = true; }}
              onCompositionEnd={(e) => {
                isComposing.current = false;
                setTicker(e.currentTarget.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder={isEn ? "NVDA, AAPL, 005930, TSLA..." : "삼성전자, NVDA, 005930, AAPL..."}
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-foreground text-base placeholder:text-muted-foreground/40 placeholder:text-sm"
              style={{ fontSize: '16px' }}
              disabled={isPending}
              autoComplete="off"
            />
            {isSearching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50 shrink-0" />}
            <button
              type="submit"
              disabled={isPending || !ticker.trim()}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius)] text-[13px] font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>{isEn ? "Analyze" : "분석 시작"}<ArrowRight className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>

          {/* 선택된 종목 표시 */}
          <AnimatePresence>
            {selectedCompany && !showDropdown && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2 mt-2 px-1"
              >
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                <span className="text-[13px] font-semibold text-foreground">{selectedCompany}</span>
                <span className="text-muted-foreground/40 text-[12px]">·</span>
                <span className="text-[12px] text-muted-foreground/60">
                  {isEn ? "Press Analyze to start →" : "분석 시작 버튼을 눌러주세요 →"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Autocomplete Dropdown */}
          <AnimatePresence>
            {showDropdown && suggestions.length > 0 && (
              <motion.div
                ref={dropdownRef}
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  boxShadow: selectHint
                    ? "0 0 0 2px hsl(var(--primary)), 0 8px 24px rgba(0,0,0,0.12)"
                    : "0 4px 16px rgba(0,0,0,0.08)",
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border rounded-[var(--radius)] z-50 overflow-hidden"
              >
                {/* 드롭다운 헤더 */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {isEn ? "Select Stock" : "종목 선택"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {isEn ? "↑↓ Navigate · Enter to select" : "↑↓ 이동 · Enter 선택"}
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
                    ex === "KOSPI" ? (isEn ? "KOSPI" : "코스피") :
                    ex === "KOSDAQ" ? (isEn ? "KOSDAQ" : "코스닥") :
                    ex || "US";
                  const isHighlighted = i === selectedIndex;
                  return (
                    <motion.button
                      key={s.symbol}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onTouchStart={(e) => { touchStartY.current = e.touches[0].clientY; touchMoved.current = false; }}
                      onTouchMove={(e) => { if (Math.abs(e.touches[0].clientY - touchStartY.current) > 8) touchMoved.current = true; }}
                      onClick={() => { if (touchMoved.current) { touchMoved.current = false; return; } handleSelectSuggestion(s.symbol, s.shortname, s.englishName); }}
                      animate={isHighlighted ? { backgroundColor: "hsl(var(--accent))" } : { backgroundColor: "transparent" }}
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
                          <span className="text-[14px] font-semibold text-foreground truncate">{isEn && s.englishName ? s.englishName : s.shortname}</span>
                          <span className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeStyle}`}>
                            {badgeLabel}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-muted-foreground">{code}</span>
                      </div>
                      <div className={`flex items-center gap-1 shrink-0 transition-opacity ${isHighlighted ? "opacity-100" : "opacity-0"}`}>
                        <span className="text-[10px] text-primary font-medium">{isEn ? "Select" : "선택"}</span>
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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5"
              >
                <Loader2 className="w-3 h-3 animate-spin" />
                {isEn ? "Searching..." : "종목 검색 중..."}
              </motion.p>
            )}
          </AnimatePresence>

          {/* 드롭다운 선택 유도 힌트 */}
          <AnimatePresence>
            {selectHint && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-primary font-medium flex items-center gap-1"
              >
                {isEn ? "↑ Click a stock above or use ↑↓ arrow keys, then press Enter" : "↑ 위 목록에서 종목을 클릭하거나 ↑↓ 방향키로 선택 후 Enter를 눌러주세요"}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && !selectHint && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-xs text-red-500"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>


          {isPending ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 flex flex-col items-center gap-1"
            >
              <p className="text-xs text-muted-foreground text-center">{isEn ? "Initializing analysis pipeline..." : "분석 파이프라인 초기화 중..."}</p>
              <p className="text-[11px] text-primary/70 font-medium text-center">{isEn ? "⏱ Average 3 minutes to complete" : "⏱ 완성까지 평균 3분 소요됩니다"}</p>
            </motion.div>
          ) : (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-2 text-[11px] text-muted-foreground/50 text-center"
            >
              {isEn ? "⏱ Report completed in ~3 minutes" : "⏱ 평균 3분 만에 리포트 완성"}
            </motion.p>
          )}
        </form>

        {/* ── 종목명을 모를 때 가는 길 ────────────────────────────────────
            홈에 검색창만 있으면 "찾을 종목을 이미 아는 사람"만 쓸 수 있다.
            테마로 훑거나(광주공항·CDMO) 날짜로 훑는(내일 뭐 있나) 입구를 같이 준다. */}
        <div className="-mt-4">
          <p className="text-[12px] text-muted-foreground/50 mb-2">
            {isEn ? "Don't have a ticker in mind?" : "찾을 종목이 딱히 없다면"}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setLocation("/themes")}
              className="group flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-card border border-border/50 hover:border-border transition text-left"
            >
              <Search className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12.5px] font-semibold text-foreground/85">
                {isEn ? "Find theme stocks" : "테마 관련주 찾기"}
              </span>
              <span className="text-[11px] text-muted-foreground/50 hidden sm:inline">
                {isEn ? "from filings" : "공시 원문에서"}
              </span>
            </button>
            <button
              onClick={() => setLocation("/themes")}
              className="group flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-card border border-border/50 hover:border-border transition text-left"
            >
              <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-[12.5px] font-semibold text-foreground/85">
                {isEn ? "What's coming up" : "다가오는 일정"}
              </span>
              <span className="text-[11px] text-muted-foreground/50 hidden sm:inline">
                {isEn ? "and who it moves" : "어느 종목이 움직이나"}
              </span>
            </button>
          </div>
        </div>

        {/* ── 최근 조회 종목 — localStorage 기반, 비로그인도 표시 ── */}
        {(() => {
          // 서버 데이터(로그인) 우선, 없으면 localStorage 폴백
          const serverItems = (user && recentAnalyses && recentAnalyses.length > 0)
            ? (() => {
                const seen = new Set<string>();
                return recentAnalyses.filter(a => {
                  const t = (a.ticker ?? "").replace(/\.(KS|KQ)$/, "");
                  if (seen.has(t)) return false; seen.add(t); return true;
                }).slice(0, 8).map(a => ({
                  id: a.id,
                  ticker: (a.ticker ?? "").replace(/\.(KS|KQ)$/, ""),
                  companyName: a.companyName ?? null,
                  englishName: a.englishName ?? null,
                  verdict: a.investmentVerdict ?? null,
                }));
              })()
            : null;
          const localItems = localRecent.map(a => ({ ...a, verdict: null }));
          const displayItems = serverItems ?? localItems;
          if (displayItems.length === 0) return null;
          return (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[11px] font-semibold text-muted-foreground/60 tracking-wide uppercase">
                    {isEn ? "Recently viewed" : "최근 조회"}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {displayItems.map(a => {
                  const vm = a.verdict ? VERDICT_MINI[a.verdict] : null;
                  const label = dn(a.companyName, a.englishName, isEn) || a.ticker;
                  return (
                      <button
                      key={a.id}
                      onClick={() => a.id ? setLocation(`/analysis/${a.id}`) : showConfirm(a.ticker, label)}
                      disabled={isPending}
                      className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius)] border border-border/60 bg-card shadow-[var(--shadow-card)] hover:border-primary/30 hover:shadow-md transition-all disabled:opacity-40 group text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <span className="font-mono text-[10px] font-bold text-muted-foreground/60 leading-none">{a.ticker.slice(0, 4)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[14px] font-semibold text-foreground group-hover:text-primary transition-colors truncate block">{label}</span>
                        <span className="text-[11px] text-muted-foreground/50 font-mono">{a.ticker}</span>
                      </div>
                      {vm && <span className={cn("flex items-center shrink-0", vm.color)}>{vm.icon}</span>}
                      <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>
            </motion.div>
          );
        })()}

        {/* ── 많이 찾는 종목 (전체 유저 인기 순위) ── */}
        <AnimatePresence>
          {trending.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.04 }}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                <span className="text-[11px] font-semibold text-muted-foreground/70 tracking-wide">{isEn ? "Trending" : "많이 찾는 종목"}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                {trending.map((t, idx) => (
                  <motion.button
                    key={t.ticker}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => showConfirm(t.ticker, dn(t.companyName, t.englishName, isEn) || t.ticker)}
                    disabled={isPending}
                    className={cn(
                      "flex items-center gap-2 px-3.5 py-2.5 rounded-[var(--radius)] border shadow-[var(--shadow-card)] transition-all duration-150 disabled:opacity-40 group text-left",
                      idx === 0
                        ? "bg-primary/5 border-primary/20 hover:bg-primary/10 hover:border-primary/40"
                        : "bg-card border-border/60 hover:border-primary/30 hover:shadow-md"
                    )}
                  >
                    {idx < 3 && (
                      <span className={cn(
                        "font-bold text-[11px] tabular-nums leading-none shrink-0 w-3",
                        idx === 0 ? "text-primary/80" : "text-muted-foreground/40"
                      )}>{idx + 1}</span>
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className={cn(
                        "text-[13px] font-semibold truncate transition-colors",
                        idx === 0 ? "text-foreground" : "text-foreground/80 group-hover:text-foreground"
                      )}>{dn(t.companyName, t.englishName, isEn) || t.ticker}</span>
                      <span className="font-mono text-[10px] text-muted-foreground/50">{t.ticker}</span>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── 관심 있을 만한 기업 (피어 그룹 추천) ── */}
        {relatedCompanies.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 shrink-0" />
              <span className="text-[11px] font-semibold text-muted-foreground/60 tracking-wide">{isEn ? "You May Like" : "관심 있을 만한 기업"}</span>
              <span className="text-[9px] text-muted-foreground/30">· {relatedCompanies[0].baseCompanyName}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {relatedCompanies.map((c) => (
                <button
                  key={c.ticker}
                  onClick={() => showConfirm(c.ticker, c.companyName ?? c.ticker)}
                  disabled={isPending}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius)] border border-border/60 bg-card shadow-[var(--shadow-card)] text-[12.5px] text-muted-foreground hover:border-primary/40 hover:text-foreground hover:shadow-md transition-all disabled:opacity-40"
                >
                  <span className="font-mono text-[11px] text-muted-foreground/50">{c.ticker}</span>
                  <span className="truncate font-medium max-w-[120px] text-foreground/80">{c.companyName}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

      </motion.div>
    </div>

    {/* ── 분석 확인 모달 ── */}
    <AnimatePresence>
      {/* ── 익명 횟수 초과 게이트 모달 ── */}
      {showAnonGate && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowAnonGate(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6"
          >
            {/* 아이콘 */}
            <div className="flex flex-col items-center text-center mb-5">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <Lock className="w-7 h-7 text-primary" />
              </div>
              <h3 className="text-[18px] font-black text-foreground leading-tight mb-1.5">
                무료 체험 {ANON_LIMIT}회 완료
              </h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                로그인하면 매일 더 많은 분석을 무료로 이용할 수 있습니다
              </p>
            </div>

            {/* 혜택 목록 */}
            <div className="rounded-[var(--radius)] bg-muted/50 border border-border/40 px-4 py-3.5 mb-5 space-y-2">
              {[
                "매일 무료 분석 크레딧 제공",
                "분석 기록 저장 및 히스토리",
                "밸류에이션·투자전략 전체 공개",
                "뉴스 스크랩 및 주제별 정리",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-primary" />
                  </div>
                  <span className="text-[12.5px] text-foreground/80">{item}</span>
                </div>
              ))}
            </div>

            {/* 버튼 */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setShowAnonGate(false)}
                className="flex-1 py-3 rounded-[var(--radius)] border border-border text-[14px] font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                닫기
              </button>
              <a
                href="/login"
                className="flex-1 py-3 rounded-[var(--radius)] text-[14px] font-bold text-white flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
                style={{ backgroundColor: "#FF8A7A" }}
              >
                <LogIn className="w-4 h-4" />
                로그인하기
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}

      {confirmModal && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmModal(null)}
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
              <div className="w-11 h-11 rounded-[var(--radius)] bg-primary/10 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">{isEn ? "AI Analysis" : "AI 기업분석"}</p>
                <h3 className="text-[18px] font-black text-foreground leading-tight truncate">{confirmModal.companyName}</h3>
                <p className="font-mono text-[11px] text-muted-foreground/50">{confirmModal.ticker}</p>
              </div>
            </div>

            {/* 설명 */}
            <div className="rounded-[var(--radius)] bg-muted/60 px-4 py-3.5 mb-5 space-y-1">
              {isEn ? (
                <>
                  <p className="text-[13.5px] text-foreground/85 leading-relaxed">
                    From <span className="font-bold" style={{ color: "#FF8A7A" }}>DART filings</span><br />
                    to investment conclusion — AI reads it all.
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    ~3 min · Filings · Earnings · News · Catalysts
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[13.5px] text-foreground/85 leading-relaxed">
                    AI 에이전트들이 사업보고서와<br />
                    <span className="font-bold" style={{ color: "#FF8A7A" }}>기업의 행간</span>을 읽기 시작합니다.
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    평균 3분 · 사업보고서 · 실적 · 뉴스 · 촉매 분석
                  </p>
                </>
              )}
            </div>

            {/* 크레딧 */}
            {credits && (
              <p className="text-[11px] text-muted-foreground/50 text-center mb-4">
                {isEn ? `${Math.max(0, credits.dailyLimit - credits.dailyUsed)} analyses available today` : `오늘 ${Math.max(0, credits.dailyLimit - credits.dailyUsed)}회 사용 가능`}
              </p>
            )}

            {/* 비로그인 → 적정주가 로그인 유도 */}
            {user === null && (
              <div className="rounded-[var(--radius)] border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 mb-4 flex items-center gap-3">
                <Lock className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[12.5px] font-semibold text-foreground/80 leading-snug">
                    {isEn ? "Log in to unlock the target price" : "로그인하면 적정주가를 볼 수 있어요"}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {isEn ? "Valuation · Investment strategy · Full report" : "밸류에이션 · 투자전략 · 전체 리포트 공개"}
                  </p>
                </div>
                <a
                  href="/login"
                  className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold text-white transition-opacity hover:opacity-90"
                  style={{ backgroundColor: "#FF8A7A" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isEn ? "Log in" : "로그인"}
                </a>
              </div>
            )}

            {/* 버튼 */}
            <div className="flex gap-2.5">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-3 rounded-[var(--radius)] border border-border text-[14px] font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                {isEn ? "Cancel" : "취소"}
              </button>
              <button
                onClick={() => { setConfirmModal(null); handleSubmit(confirmModal.ticker); }}
                disabled={isPending}
                className="flex-1 py-3 rounded-[var(--radius)] text-[14px] font-bold text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                style={{ backgroundColor: "#FF8A7A" }}
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>{isEn ? "Start Analysis" : "분석 시작"} <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
