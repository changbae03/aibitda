import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, Search, Loader2, TrendingUp, ArrowRight, RefreshCw, Building2 } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLocation } from "wouter";
import StockLogo from "@/components/ui/stock-logo";
import { useStartAnalysis } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface TrendingTheme {
  id: string;
  name: string;
  description: string;
  emoji: string;
}

interface DiscoveredStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale: string;
}

interface DiscoverResult {
  theme: string;
  summary: string;
  stocks: DiscoveredStock[];
}

type Market = "ALL" | "KR" | "US";

const MARKET_LABELS: Record<Market, string> = { ALL: "전체", KR: "한국", US: "미국" };

export default function ThemesPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { mutateAsync: startAnalysis, isPending: isStarting } = useStartAnalysis();

  const [trending, setTrending] = useState<TrendingTheme[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [input, setInput] = useState("");
  const [market, setMarket] = useState<Market>("ALL");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ ticker: string; companyName: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    setTrendingLoading(true);
    fetch(getApiUrl("api/themes/trending"))
      .then(r => r.json())
      .then(data => setTrending(Array.isArray(data) ? data : []))
      .catch(() => setTrending([]))
      .finally(() => setTrendingLoading(false));
  }, []);

  async function discover(theme: string) {
    if (!theme.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const r = await fetch(getApiUrl("api/themes/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: theme.trim(), market }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "오류가 발생했습니다.");
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  function handleChip(theme: TrendingTheme) {
    setInput(theme.name);
    discover(theme.name);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    discover(input);
  }

  function goAnalyze(ticker: string, companyName: string) {
    setStartError(null);
    setConfirmModal({ ticker, companyName });
  }

  async function handleStartAnalysis() {
    if (!confirmModal) return;
    setStartError(null);
    try {
      const res = await startAnalysis({ data: { ticker: confirmModal.ticker.toUpperCase() } });
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      setConfirmModal(null);
      navigate(`/analysis/${res.id}`);
    } catch (err: any) {
      const msg = err?.data?.error as string | undefined;
      setStartError(msg ?? "분석을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <Lightbulb className="w-5 h-5 text-[#FF8A7A]" />
        <h1 className="text-lg font-semibold text-foreground">테마종목발굴</h1>
      </div>
      <p className="text-sm text-foreground/60 -mt-4">
        지금 수급이 몰리는 테마를 입력하면 관련 종목을 찾아드립니다.
      </p>

      {/* 지금 주목받는 테마 */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground/50 uppercase tracking-wide">지금 주목받는 테마</p>
        {trendingLoading ? (
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 w-24 rounded-full bg-muted animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {trending.map(t => (
              <button
                key={t.id}
                onClick={() => handleChip(t)}
                title={t.description}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-all",
                  input === t.name
                    ? "bg-[#FF8A7A]/15 border-[#FF8A7A]/50 text-[#FF8A7A] font-medium"
                    : "bg-muted/50 border-border text-foreground/70 hover:border-[#FF8A7A]/40 hover:text-foreground"
                )}
              >
                <span>{t.emoji}</span>
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 검색 입력 */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="테마 직접 입력 (예: 미국 전력 인프라, 금리 인하 수혜...)"
            className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-background text-sm placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-[#FF8A7A]/30"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#FF8A7A] text-white text-sm font-medium disabled:opacity-40 hover:bg-[#ff7063] transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            {loading ? "발굴 중" : "발굴"}
          </button>
        </div>

        {/* 시장 필터 */}
        <div className="flex gap-1.5">
          {(["ALL", "KR", "US"] as Market[]).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMarket(m)}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-medium border transition-all",
                market === m
                  ? "bg-foreground text-background border-foreground"
                  : "bg-muted/40 text-foreground/60 border-border hover:border-foreground/30"
              )}
            >
              {MARKET_LABELS[m]}
            </button>
          ))}
        </div>
      </form>

      {/* 에러 */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="flex flex-col items-center gap-3 py-12 text-foreground/40">
          <Loader2 className="w-7 h-7 animate-spin text-[#FF8A7A]" />
          <p className="text-sm">관련 종목을 발굴하고 있습니다…</p>
        </div>
      )}

      {/* 결과 */}
      <AnimatePresence>
        {result && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* 테마 요약 */}
            <div className="flex items-start gap-2 p-3 rounded-xl bg-[#FF8A7A]/8 border border-[#FF8A7A]/20">
              <TrendingUp className="w-4 h-4 text-[#FF8A7A] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">{result.theme}</p>
                <p className="text-xs text-foreground/60 mt-0.5">{result.summary}</p>
              </div>
            </div>

            {/* 종목 리스트 */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground/50 uppercase tracking-wide">
                관련 종목 {result.stocks.length}개
              </p>
              {result.stocks.map((stock, i) => (
                <motion.div
                  key={stock.ticker}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:border-[#FF8A7A]/30 transition-all group"
                >
                  <StockLogo
                    ticker={stock.ticker}
                    companyName={stock.name}
                    size="md"
                    className="shrink-0 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">{stock.name}</span>
                      <span className="text-xs text-foreground/40 font-mono">{stock.ticker}</span>
                      <span className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded font-medium",
                        stock.market === "KR"
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                          : "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400"
                      )}>
                        {stock.market}
                      </span>
                      {stock.sector && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/50">
                          {stock.sector}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground/60 mt-1 leading-relaxed">{stock.rationale}</p>
                  </div>
                  <button
                    onClick={() => goAnalyze(stock.ticker, stock.name)}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[#FF8A7A] border border-[#FF8A7A]/30 hover:bg-[#FF8A7A]/10 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    분석
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </motion.div>
              ))}
            </div>

            {/* 다시 발굴 */}
            <button
              onClick={() => discover(result.theme)}
              className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/60 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              다른 종목으로 다시 발굴
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 분석 확인 팝업 */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !isStarting && setConfirmModal(null)}
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
                  <p className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-widest mb-0.5">AI 기업분석</p>
                  <h3 className="text-[18px] font-black text-foreground leading-tight truncate">{confirmModal.companyName}</h3>
                  <p className="font-mono text-[11px] text-muted-foreground/50">{confirmModal.ticker}</p>
                </div>
              </div>

              {/* 설명 */}
              <div className="rounded-xl bg-muted/60 px-4 py-3.5 mb-5 space-y-1">
                <p className="text-[13.5px] text-foreground/85 leading-relaxed">
                  <span className="font-bold" style={{ color: "#FF8A7A" }}>애빛다의 AI 애널리스트 팀</span>이<br />
                  7단계 심층 분석을 시작합니다.
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  평균 3분 소요 · DCF·rNPV 등 밸류에이션 자동 선정
                </p>
              </div>

              {/* 오류 */}
              {startError && (
                <p className="text-[12px] text-red-500 text-center mb-3">{startError}</p>
              )}

              {/* 버튼 */}
              <div className="flex gap-2.5">
                <button
                  onClick={() => setConfirmModal(null)}
                  disabled={isStarting}
                  className="flex-1 py-3 rounded-xl border border-border text-[14px] font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  취소
                </button>
                <button
                  onClick={handleStartAnalysis}
                  disabled={isStarting}
                  className="flex-1 py-3 rounded-xl text-[14px] font-bold text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: "#FF8A7A" }}
                >
                  {isStarting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>분석 시작 <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
