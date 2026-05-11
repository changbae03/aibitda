import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, Loader2, TrendingUp, TrendingDown, ArrowRight, PieChart, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

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
  holdings: Holding[];
  equityHoldings: {
    priceToEarnings?: number;
    priceToBook?: number;
    priceToSales?: number;
  };
}

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

export default function ETFPage() {
  const [, setLocation] = useLocation();
  const { isEn } = useLanguage();
  const [inputVal, setInputVal] = useState("");
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: etf, isLoading, error } = useETFHoldings(activeTicker);

  function t(ko: string, en: string) { return isEn ? en : ko; }

  function submit(ticker: string) {
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;
    setActiveTicker(clean);
    setInputVal(clean);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(inputVal);
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
          <h1 className="text-[22px] font-black text-foreground">{t("ETF 구성 분석", "ETF Holdings")}</h1>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {t("ETF 상위 보유 종목을 확인하고 개별 종목을 분석하세요.", "See top holdings inside any ETF and analyze each stock.")}
        </p>
      </div>

      {/* 검색창 */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            ref={inputRef}
            value={inputVal}
            onChange={e => setInputVal(e.target.value.toUpperCase())}
            placeholder={t("ETF 티커 입력 (예: QQQ, 069500.KS)", "Enter ETF ticker (e.g. QQQ, SPY)")}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-card border border-border text-[13px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={!inputVal.trim() || isLoading}
          className="px-4 py-2.5 rounded-xl bg-primary text-white text-[13px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {t("조회", "Search")}
        </button>
      </form>

      {/* 빠른 선택 */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide">{t("미국 ETF", "US ETFs")}</p>
        <div className="flex flex-wrap gap-1.5">
          {US_ETFS.map(({ ticker, label }) => (
            <button
              key={ticker}
              onClick={() => submit(ticker)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all",
                activeTicker === ticker
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {ticker} <span className="opacity-60 font-normal">· {label}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide pt-1">{t("한국 ETF", "Korean ETFs")}</p>
        <div className="flex flex-wrap gap-1.5">
          {KR_ETFS.map(({ ticker, label }) => (
            <button
              key={ticker}
              onClick={() => submit(ticker)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-all",
                activeTicker === ticker
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-card border-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
              )}
            >
              {label} <span className="opacity-60 font-normal">· {ticker.replace(".KS", "")}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 결과 */}
      <AnimatePresence mode="wait">
        {isLoading && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-[13px]">{t("ETF 구성 종목 불러오는 중...", "Loading ETF holdings...")}</span>
          </motion.div>
        )}

        {error && !isLoading && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-950/30 border border-red-800/40 text-red-400 text-[13px]">
            <Info className="w-4 h-4 shrink-0" />
            {(error as Error).message}
          </motion.div>
        )}

        {etf && !isLoading && (
          <motion.div key={etf.ticker} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">

            {/* ETF 헤더 카드 */}
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">{etf.ticker}</span>
                    {etf.category && (
                      <span className="text-[10px] text-muted-foreground/60">{etf.category}</span>
                    )}
                  </div>
                  <p className="text-[16px] font-bold text-foreground leading-tight">{etf.name}</p>
                  {etf.expenseRatio != null && (
                    <p className="text-[11px] text-muted-foreground/60 mt-1">
                      {t("운용보수", "Expense ratio")} {fmtPct(etf.expenseRatio)}
                    </p>
                  )}
                </div>
                {etf.price != null && (
                  <div className="text-right shrink-0">
                    <p className="text-[20px] font-black tabular-nums text-foreground">{fmtPrice(etf.price, etf.currency ?? null)}</p>
                    {etf.changePercent != null && (
                      <div className={cn("flex items-center justify-end gap-1 text-[12px] font-semibold mt-0.5",
                        etf.changePercent >= 0 ? "text-emerald-500" : "text-red-500")}>
                        {etf.changePercent >= 0
                          ? <TrendingUp className="w-3.5 h-3.5" />
                          : <TrendingDown className="w-3.5 h-3.5" />}
                        {etf.changePercent >= 0 ? "+" : ""}{(etf.changePercent * 100).toFixed(2)}%
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 밸류에이션 멀티플 */}
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
                    <motion.div
                      key={h.ticker}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/40 transition-colors group"
                    >
                      {/* 순위 */}
                      <span className="text-[11px] font-bold text-muted-foreground/40 tabular-nums w-5 shrink-0 text-right">{i + 1}</span>

                      {/* 종목 정보 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-1.5 mb-1">
                          <span className="text-[13px] font-bold text-foreground">{h.ticker}</span>
                          <span className="text-[11px] text-muted-foreground/70 truncate">{h.name}</span>
                        </div>
                        {/* 비중 바 */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden max-w-[120px]">
                            <div
                              className="h-full rounded-full bg-primary/60"
                              style={{ width: `${(h.weight / maxWeight) * 100}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtPct(h.weight)}</span>
                        </div>
                      </div>

                      {/* 분석 버튼 */}
                      <button
                        onClick={() => setLocation(`/analysis/new?ticker=${h.ticker}`)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-primary bg-primary/8 hover:bg-primary/15 border border-primary/20 transition-all opacity-0 group-hover:opacity-100 shrink-0"
                      >
                        {t("분석", "Analyze")} <ArrowRight className="w-3 h-3" />
                      </button>
                    </motion.div>
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
    </div>
  );
}
