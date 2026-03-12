import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useStartAnalysis } from "@workspace/api-client-react";
import { Search, Loader2, TrendingUp, Building2, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const EXAMPLES = [
  { ticker: "005930", label: "삼성전자" },
  { ticker: "000660", label: "SK하이닉스" },
  { ticker: "035720", label: "카카오" },
  { ticker: "NVDA", label: "NVIDIA" },
  { ticker: "AAPL", label: "Apple" },
  { ticker: "078160.KS", label: "메디포스트" },
];

export default function NewAnalysis() {
  const [, setLocation] = useLocation();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();
  const [ticker, setTicker] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (tickerValue: string) => {
    const value = tickerValue.trim().toUpperCase();
    if (!value) {
      setError("종목코드를 입력해주세요");
      inputRef.current?.focus();
      return;
    }
    setError("");
    try {
      const result = await startAnalysis({ data: { ticker: value } });
      setLocation(`/analysis/${result.id}`);
    } catch (e: any) {
      setError("분석을 시작할 수 없습니다. 올바른 종목코드를 확인해주세요.");
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit(ticker);
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
            종목코드를 입력하면 8개 AI 에이전트가 즉시 분석을 시작합니다
          </p>
        </div>

        {/* Search box */}
        <form onSubmit={onSubmit} className="w-full">
          <div className={`flex items-center gap-3 bg-white border-2 rounded-2xl px-5 py-3 shadow-md transition-all ${error ? "border-destructive" : "border-border focus-within:border-primary focus-within:shadow-lg focus-within:shadow-primary/10"}`}>
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={ticker}
              onChange={(e) => { setTicker(e.target.value.toUpperCase()); setError(""); }}
              placeholder="종목코드 입력  예) 005930, NVDA, 078160.KS"
              className="flex-1 bg-transparent border-none outline-none text-foreground text-lg font-mono placeholder:text-muted-foreground/50 placeholder:font-sans placeholder:text-base"
              autoFocus
              disabled={isPending}
              onKeyDown={(e) => e.key === "Enter" && onSubmit(e as any)}
            />
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
          한국(KOSPI/KOSDAQ), 미국, 글로벌 거래소 모든 종목 지원 · 기업명과 산업은 자동으로 조회됩니다
        </p>
      </motion.div>
    </div>
  );
}
