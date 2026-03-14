import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { Search, Loader2, TrendingUp, Building2, ArrowRight, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const EXAMPLES = [
  { ticker: "005930", label: "삼성전자" },
  { ticker: "000660", label: "SK하이닉스" },
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

export default function NewAnalysis() {
  const [, setLocation] = useLocation();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();
  const [ticker, setTicker] = useState("");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isComposing = useRef(false);

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
    const isKoreanInput = isKorean(ticker);
    const isSixDigit = /^\d{6}$/.test(ticker.trim());
    if (!isKoreanInput && !isSixDigit) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => fetchSuggestions(ticker.trim()), 300);
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
      setLocation(`/analysis/${result.id}`);
    } catch {
      setError("분석을 시작할 수 없습니다. 올바른 종목코드를 확인해주세요.");
    }
  };

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
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl flex flex-col items-center gap-8"
      >
        {/* Logo + Title */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 mb-1">
            <TrendingUp className="w-6 h-6 text-primary" />
            <span className="text-sm font-semibold text-primary uppercase tracking-widest">CBST AI 기업분석</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground">
            어떤 종목을 분석할까요?
          </h1>
          <p className="text-muted-foreground text-base">
            코스피·코스닥 종목코드(6자리) 또는 한글 회사명을 입력하면 AI 에이전트가 즉시 분석을 시작합니다
          </p>
        </div>

        {/* Search box */}
        <form onSubmit={onSubmit} className="w-full relative">
          <div className={`flex items-center gap-3 bg-white border-2 rounded-2xl px-5 py-3 shadow-md transition-all ${error ? "border-destructive" : "border-border focus-within:border-primary focus-within:shadow-lg focus-within:shadow-primary/10"}`}>
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
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
              placeholder="예) 삼성전자, 하이닉스, 005930, 247540"
              className="flex-1 bg-transparent border-none outline-none text-foreground text-lg placeholder:text-muted-foreground/50 placeholder:font-sans placeholder:text-base"
              autoFocus
              disabled={isPending}
              autoComplete="off"
            />
            {isSearching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />}
            <button
              type="submit"
              disabled={isPending || !ticker.trim()}
              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>분석 시작 <ArrowRight className="w-4 h-4" /></>
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
                transition={{ duration: 0.12 }}
                className="absolute top-full left-0 right-0 mt-2 bg-white border border-border rounded-xl shadow-lg z-50 overflow-hidden"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectSuggestion(s.symbol); }}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-primary/5 transition-colors text-left ${i === selectedIndex ? "bg-primary/10" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center font-mono text-primary text-[10px] font-bold shrink-0">
                        {s.symbol.substring(0, 4)}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-foreground">{s.shortname}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-xs text-muted-foreground">{s.symbol}</span>
                          {s.exchange && <span className="text-[10px] text-muted-foreground/60 bg-muted px-1 rounded">{s.exchange}</span>}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-2 text-sm text-destructive text-center"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {isPending && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-4 text-center"
            >
              <p className="text-sm text-muted-foreground">
                기업 정보를 조회하고 AI 분석 팀을 구성하고 있습니다...
              </p>
              <div className="mt-2 flex justify-center gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </form>

        {/* Example chips */}
        <div className="flex flex-col items-center gap-3 w-full">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">빠른 검색</p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.ticker}
                onClick={() => { setTicker(ex.ticker); handleSubmit(ex.ticker); }}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-secondary-foreground text-sm font-medium hover:bg-primary/10 hover:text-primary border border-border hover:border-primary/30 transition-all disabled:opacity-50"
              >
                <Building2 className="w-3 h-3" />
                <span className="font-mono text-xs">{ex.ticker}</span>
                <span className="text-muted-foreground">·</span>
                <span>{ex.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Info note */}
        <p className="text-xs text-muted-foreground text-center max-w-md leading-relaxed">
          코스피·코스닥 전 종목 지원 · 6자리 종목코드 또는 한글 회사명으로 검색
        </p>
      </motion.div>
    </div>
  );
}
