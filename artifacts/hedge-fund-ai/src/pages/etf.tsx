import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, TrendingUp, TrendingDown, ArrowRight, PieChart, Info, Layers, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Holding {
  ticker: string;
  name: string;
  weight: number;
}

interface ETFData {
  ticker: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  currency: string | null;
  expenseRatio: number | null;
  category: string | null;
  nav?: number | null;
  threeMonthReturn?: number | null;
  holdings: Holding[];
  holdingsUnavailable?: boolean;
  equityHoldings: {
    priceToEarnings?: number;
    priceToBook?: number;
    priceToSales?: number;
  };
}

interface ETFMatch {
  etf: string;
  etfName: string;
  weight: number;
}

interface ContainingResult {
  ticker: string;
  etfs: ETFMatch[];
  totalETFs: number;
}

// ─── Quick picks ───────────────────────────────────────────────────────────

const US_ETFS = [
  { ticker: "QQQ",  label: "나스닥 100" },
  { ticker: "SPY",  label: "S&P 500" },
  { ticker: "SCHD", label: "배당" },
  { ticker: "SOXX", label: "반도체" },
  { ticker: "VTI",  label: "미국 전체" },
  { ticker: "IWM",  label: "러셀 2000" },
];

const KR_ETFS = [
  { ticker: "069500.KS", label: "KODEX 200" },
  { ticker: "091160.KS", label: "KODEX 반도체" },
  { ticker: "360750.KS", label: "TIGER S&P500" },
  { ticker: "371460.KS", label: "TIGER 미국테크" },
];

const POPULAR_STOCKS = [
  { ticker: "NVDA", label: "엔비디아" },
  { ticker: "AAPL", label: "애플" },
  { ticker: "MSFT", label: "마이크로소프트" },
  { ticker: "AMZN", label: "아마존" },
  { ticker: "GOOGL", label: "알파벳" },
  { ticker: "META", label: "메타" },
  { ticker: "TSLA", label: "테슬라" },
  { ticker: "AVGO", label: "브로드컴" },
];

// ─── Hooks ─────────────────────────────────────────────────────────────────

function useETFHoldings(ticker: string | null) {
  return useQuery<ETFData>({
    queryKey: ["etf-holdings", ticker],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/market-data/etf/holdings?ticker=${ticker}`), { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "ETF 데이터를 불러올 수 없습니다");
      }
      return r.json();
    },
    enabled: !!ticker,
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
  });
}

function useETFContaining(ticker: string | null) {
  return useQuery<ContainingResult>({
    queryKey: ["etf-containing", ticker],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`/api/market-data/etf/containing?ticker=${ticker}`), { credentials: "include" });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "ETF 조회에 실패했습니다");
      }
      return r.json();
    },
    enabled: !!ticker,
    staleTime: 1000 * 60 * 60 * 4,
    retry: false,
  });
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function ETFPage() {
  const [, setLocation] = useLocation();
  const { isEn } = useLanguage();
  const [mode, setMode] = useState<"holdings" | "containing">("holdings");

  const [etfInput, setEtfInput] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);

  const [stockInput, setStockInput] = useState("");
  const [activeStock, setActiveStock] = useState<string | null>(null);

  const { data: etf, isLoading: etfLoading, error: etfError } = useETFHoldings(activeTicker);
  const { data: containing, isLoading: containingLoading, error: containingError } = useETFContaining(activeStock);

  function t(ko: string, en: string) { return isEn ? en : ko; }

  function submitETF(ticker: string) {
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;
    setActiveTicker(clean);
    setEtfInput(clean);
  }

  function submitStock(ticker: string) {
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;
    setActiveStock(clean);
    setStockInput(clean);
  }

  const maxWeight = etf?.holdings?.[0]?.weight ?? 1;
  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const fmtPrice = (v: number, cur: string | null) =>
    cur === "KRW"
      ? `₩${v.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`
      : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <PieChart className="w-5 h-5 text-primary" />
          <h1 className="text-[22px] font-black text-foreground">{t("ETF 구성 분석", "ETF Analysis")}</h1>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {t("ETF 보유 종목 확인 · 종목이 담긴 ETF 탐색", "Explore ETF holdings or find which ETFs hold a stock.")}
        </p>
      </div>

      {/* 모드 토글 */}
      <div className="flex gap-1 p-1 rounded-xl bg-muted/40 border border-border/60 w-fit">
        <button
          onClick={() => setMode("holdings")}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
            mode === "holdings"
              ? "bg-card border border-border shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <PieChart className="w-3.5 h-3.5" />
          {t("ETF 구성 종목", "ETF Holdings")}
        </button>
        <button
          onClick={() => setMode("containing")}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
            mode === "containing"
              ? "bg-card border border-border shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Layers className="w-3.5 h-3.5" />
          {t("종목 포함 ETF", "ETFs Holding Stock")}
        </button>
      </div>

      <AnimatePresence mode="wait">

        {/* ── 모드 A: ETF → 구성 종목 ─────────────────────────────────────── */}
        {mode === "holdings" && (
          <motion.div key="holdings" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
            {/* 검색창 */}
            <form onSubmit={e => { e.preventDefault(); submitETF(etfInput); }} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <input
                  value={etfInput}
                  onChange={e => setEtfInput(e.target.value.toUpperCase())}
                  placeholder={t("ETF 티커 입력 (예: QQQ, 069500.KS)", "Enter ETF ticker (e.g. QQQ, SPY)")}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={!etfInput.trim() || etfLoading}
                className="px-4 py-2.5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {etfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {t("조회", "Search")}
              </button>
            </form>

            {/* 빠른 선택 */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide">{t("미국 ETF", "US ETFs")}</p>
              <div className="flex flex-wrap gap-1.5">
                {US_ETFS.map(({ ticker, label }) => (
                  <button key={ticker} onClick={() => submitETF(ticker)}
                    className={cn("px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all",
                      activeTicker === ticker
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground")}>
                    {ticker} <span className="opacity-60 font-normal">· {label}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide pt-1">{t("한국 ETF", "Korean ETFs")}</p>
              <div className="flex flex-wrap gap-1.5">
                {KR_ETFS.map(({ ticker, label }) => (
                  <button key={ticker} onClick={() => submitETF(ticker)}
                    className={cn("px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all",
                      activeTicker === ticker
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground")}>
                    {label} <span className="opacity-60 font-normal">· {ticker.replace(".KS", "")}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 결과 */}
            <AnimatePresence mode="wait">
              {etfLoading && (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="text-[13px]">{t("ETF 구성 종목 불러오는 중...", "Loading ETF holdings...")}</span>
                </motion.div>
              )}
              {etfError && !etfLoading && (
                <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/30 border border-red-800/40 text-red-400 text-[13px]">
                  <Info className="w-4 h-4 shrink-0" />
                  {(etfError as Error).message}
                </motion.div>
              )}
              {etf && !etfLoading && (
                <motion.div key={etf.ticker} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-4">
                  {/* ETF 헤더 카드 */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{etf.ticker}</span>
                          {etf.category && <span className="text-[10px] text-muted-foreground/60">{etf.category}</span>}
                        </div>
                        <p className="text-[16px] font-bold text-foreground leading-tight">{etf.name}</p>
                        {etf.expenseRatio != null && (
                          <p className="text-[11px] text-muted-foreground/60 mt-1">
                            {t("운용보수", "Expense ratio")} {fmtPct(etf.expenseRatio)}
                          </p>
                        )}
                        {etf.nav != null && (
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                            NAV {etf.currency === "KRW" ? `₩${etf.nav.toLocaleString("ko-KR")}` : `$${etf.nav.toFixed(2)}`}
                            {etf.threeMonthReturn != null && (
                              <span className={cn("ml-2 font-semibold", etf.threeMonthReturn >= 0 ? "text-emerald-500" : "text-red-500")}>
                                3M {etf.threeMonthReturn >= 0 ? "+" : ""}{etf.threeMonthReturn.toFixed(2)}%
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      {etf.price != null && (
                        <div className="text-right shrink-0">
                          <p className="text-[20px] font-black tabular-nums text-foreground">{fmtPrice(etf.price, etf.currency ?? null)}</p>
                          {etf.changePercent != null && (
                            <div className={cn("flex items-center justify-end gap-1 text-[12px] font-semibold mt-0.5",
                              etf.changePercent >= 0 ? "text-emerald-500" : "text-red-500")}>
                              {etf.changePercent >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                              {etf.changePercent >= 0 ? "+" : ""}{(etf.changePercent * 100).toFixed(2)}%
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* 밸류에이션 */}
                    {(etf.equityHoldings?.priceToEarnings || etf.equityHoldings?.priceToBook) && (
                      <div className="flex gap-4 mt-3 pt-3 border-t border-border/60">
                        {etf.equityHoldings.priceToEarnings != null && etf.equityHoldings.priceToEarnings > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground/50">P/E</p>
                            <p className="text-[13px] font-bold tabular-nums text-foreground">{(1 / etf.equityHoldings.priceToEarnings).toFixed(1)}x</p>
                          </div>
                        )}
                        {etf.equityHoldings.priceToBook != null && etf.equityHoldings.priceToBook > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground/50">P/B</p>
                            <p className="text-[13px] font-bold tabular-nums text-foreground">{(1 / etf.equityHoldings.priceToBook).toFixed(1)}x</p>
                          </div>
                        )}
                        {etf.equityHoldings.priceToSales != null && etf.equityHoldings.priceToSales > 0 && (
                          <div>
                            <p className="text-[10px] text-muted-foreground/50">P/S</p>
                            <p className="text-[13px] font-bold tabular-nums text-foreground">{(1 / etf.equityHoldings.priceToSales).toFixed(1)}x</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 보유 종목 리스트 */}
                  {etf.holdings.length > 0 ? (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                      <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
                        <p className="text-[12px] font-semibold text-foreground">{t("상위 보유 종목", "Top Holdings")}</p>
                        <p className="text-[11px] text-muted-foreground/50">{etf.holdings.length}{t("개", " stocks")}</p>
                      </div>
                      <div className="divide-y divide-border/40">
                        {etf.holdings.map((h, i) => (
                          <motion.div key={h.ticker}
                            initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors group">
                            <span className="text-[11px] font-bold text-muted-foreground/40 tabular-nums w-5 shrink-0 text-right">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-1.5 mb-1">
                                <span className="text-[13px] font-bold text-foreground">{h.ticker}</span>
                                <span className="text-[11px] text-muted-foreground/70 truncate">{h.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden max-w-[120px]">
                                  <div className="h-full rounded-full bg-primary/60" style={{ width: `${(h.weight / maxWeight) * 100}%` }} />
                                </div>
                                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtPct(h.weight)}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => setLocation(`/analysis/new?ticker=${h.ticker}`)}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-primary bg-primary/8 hover:bg-primary/15 border border-primary/20 transition-all opacity-0 group-hover:opacity-100 shrink-0">
                              {t("분석", "Analyze")} <ArrowRight className="w-3 h-3" />
                            </button>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  ) : etf.holdingsUnavailable ? (
                    <div className="rounded-xl border border-border bg-card p-6 flex flex-col items-center gap-3 text-center">
                      <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                        <PieChart className="w-5 h-5 text-muted-foreground/40" />
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-foreground mb-1">{t("구성 종목 데이터 준비 중", "Holdings data unavailable")}</p>
                        <p className="text-[12px] text-muted-foreground/60 max-w-xs">
                          {t("한국 ETF 구성 종목은 현재 지원하지 않습니다. 미국 ETF(QQQ, SPY 등)는 바로 확인하실 수 있어요.", "Korean ETF constituent data is not yet supported. Try US ETFs like QQQ or SPY.")}
                        </p>
                      </div>
                      <div className="flex gap-2 mt-1">
                        {US_ETFS.slice(0, 3).map(({ ticker }) => (
                          <button key={ticker} onClick={() => submitETF(ticker)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
                            {ticker}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-10 text-muted-foreground text-[13px]">
                      {t("보유 종목 데이터가 없습니다.", "No holdings data available.")}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── 모드 B: 종목 → 포함 ETF 목록 ────────────────────────────────── */}
        {mode === "containing" && (
          <motion.div key="containing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
            {/* 설명 배너 */}
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-primary/5 border border-primary/15">
              <Layers className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                {t(
                  `주요 미국 ETF ${40}개를 스캔해 해당 종목을 보유한 ETF와 비중을 알려드립니다.`,
                  `Scans ${40} major US ETFs to show which ones hold your stock and at what weight.`
                )}
              </p>
            </div>

            {/* 종목 검색창 */}
            <form onSubmit={e => { e.preventDefault(); submitStock(stockInput); }} className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <input
                  value={stockInput}
                  onChange={e => setStockInput(e.target.value.toUpperCase())}
                  placeholder={t("종목 티커 입력 (예: NVDA, AAPL)", "Enter stock ticker (e.g. NVDA, AAPL)")}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={!stockInput.trim() || containingLoading}
                className="px-4 py-2.5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {containingLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {t("검색", "Find")}
              </button>
            </form>

            {/* 인기 종목 빠른 선택 */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide">{t("인기 종목", "Popular Stocks")}</p>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_STOCKS.map(({ ticker, label }) => (
                  <button key={ticker} onClick={() => submitStock(ticker)}
                    className={cn("px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all",
                      activeStock === ticker
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground")}>
                    {ticker} <span className="opacity-60 font-normal">· {label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 결과 */}
            <AnimatePresence mode="wait">
              {containingLoading && (
                <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <div className="text-center">
                    <p className="text-[13px]">{t("ETF 스캔 중...", "Scanning ETFs...")}</p>
                    <p className="text-[11px] text-muted-foreground/50 mt-1">
                      {t("처음 조회 시 잠시 걸릴 수 있습니다 (최대 20초)", "First scan may take up to 20 seconds")}
                    </p>
                  </div>
                </motion.div>
              )}
              {containingError && !containingLoading && (
                <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/30 border border-red-800/40 text-red-400 text-[13px]">
                  <Info className="w-4 h-4 shrink-0" />
                  {(containingError as Error).message}
                </motion.div>
              )}
              {containing && !containingLoading && (
                <motion.div key={containing.ticker} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                  {/* 결과 헤더 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold px-2 py-0.5 rounded-lg bg-primary/10 text-primary">{containing.ticker}</span>
                      {containing.etfs.length > 0 ? (
                        <span className="text-[13px] text-muted-foreground">
                          {t(`${containing.etfs.length}개 ETF에 포함`, `found in ${containing.etfs.length} ETFs`)}
                        </span>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">{t("포함 ETF 없음", "not in any scanned ETF")}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground/40">
                      {t(`${containing.totalETFs}개 ETF 스캔`, `${containing.totalETFs} ETFs scanned`)}
                    </span>
                  </div>

                  {containing.etfs.length === 0 ? (
                    <div className="rounded-xl border border-border bg-card p-8 text-center">
                      <p className="text-[13px] font-semibold text-foreground mb-1">{t("검색된 ETF 없음", "Not found in major ETFs")}</p>
                      <p className="text-[12px] text-muted-foreground/60">
                        {t("스캔한 주요 ETF 상위 보유 종목에 포함되지 않거나 티커가 정확하지 않을 수 있습니다.", "May not be a top holding in major ETFs, or the ticker may be incorrect.")}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                      <div className="divide-y divide-border/40">
                        {containing.etfs.map((m, i) => (
                          <motion.div key={m.etf}
                            initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                            className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent/40 transition-colors group">
                            {/* 순위 */}
                            <span className="text-[11px] font-bold text-muted-foreground/30 w-5 text-right shrink-0">{i + 1}</span>

                            {/* ETF 정보 */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2 mb-1">
                                <span className="text-[14px] font-black text-foreground">{m.etf}</span>
                                <span className="text-[11px] text-muted-foreground/60 truncate">{m.etfName}</span>
                              </div>
                              {/* 비중 바 */}
                              <div className="flex items-center gap-2">
                                <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden max-w-[160px]">
                                  <motion.div
                                    className="h-full rounded-full bg-primary/70"
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min((m.weight / (containing.etfs[0]?.weight ?? 1)) * 100, 100)}%` }}
                                    transition={{ delay: i * 0.04 + 0.1, duration: 0.4, ease: "easeOut" }}
                                  />
                                </div>
                                <span className="text-[12px] font-bold tabular-nums text-primary">
                                  {(m.weight * 100).toFixed(2)}%
                                </span>
                              </div>
                            </div>

                            {/* 버튼 그룹 */}
                            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                              <button
                                onClick={() => { setMode("holdings"); submitETF(m.etf); }}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-muted-foreground bg-muted/60 hover:bg-muted transition-colors">
                                <PieChart className="w-3 h-3" /> {t("구성", "Holdings")}
                              </button>
                              <button
                                onClick={() => setLocation(`/analysis/new?ticker=${m.etf}`)}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-primary bg-primary/8 hover:bg-primary/15 border border-primary/20 transition-colors">
                                {t("분석", "Analyze")} <ChevronRight className="w-3 h-3" />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
