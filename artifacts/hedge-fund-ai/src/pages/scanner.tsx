import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, RefreshCw, Loader2, ChevronRight,
  SlidersHorizontal, Zap, Globe, Building2,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import StockLogo from "@/components/ui/stock-logo";

interface ScannerItem {
  id: number;
  ticker: string;
  companyName: string;
  englishName: string | null;
  industry: string | null;
  investmentVerdict: string;
  targetPrice: number;
  startPrice: number | null;
  currentPrice: number | null;
  upside: number | null;
  todayChangePct: number | null;
  analysisDate: string;
}

const MARKET_TABS = [
  { key: "ALL", label: "전체", icon: Globe },
  { key: "KR",  label: "한국",  icon: Building2 },
  { key: "US",  label: "미국",  icon: Globe },
] as const;

const UPSIDE_OPTIONS = [
  { value: 10,  label: "10%+" },
  { value: 20,  label: "20%+" },
  { value: 30,  label: "30%+" },
  { value: 50,  label: "50%+" },
];

const SORT_OPTIONS = [
  { value: "upside",  label: "상승여력순" },
  { value: "today",   label: "오늘 낙폭순" },
  { value: "recent",  label: "최신 분석순" },
];

function verdictBadge(v: string) {
  if (v === "Strong Buy") return { label: "높은 상승여력", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
  return { label: "상승여력", cls: "bg-green-500/15 text-green-400 border-green-500/30" };
}

function UpsidePill({ pct }: { pct: number }) {
  const color = pct >= 50 ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : pct >= 30 ? "text-green-400 bg-green-500/10 border-green-500/20"
    : "text-blue-400 bg-blue-500/10 border-blue-500/20";
  return (
    <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full border", color)}>
      +{pct.toFixed(1)}%
    </span>
  );
}

function TodayChange({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-muted-foreground">-</span>;
  const isUp = pct >= 0;
  return (
    <span className={cn("text-xs font-semibold flex items-center gap-0.5", isUp ? "text-red-400" : "text-blue-400")}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function isKRTicker(t: string) { return /^\d{5,6}$/.test(t); }

export default function Scanner() {
  const [, navigate] = useLocation();
  const [market, setMarket]       = useState<"ALL" | "KR" | "US">("ALL");
  const [minUpside, setMinUpside] = useState(10);
  const [sortBy, setSortBy]       = useState<"upside" | "today" | "recent">("upside");
  const [items, setItems]         = useState<ScannerItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing]   = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const url = getApiUrl(`/api/analysis/scanner?market=${market}&minUpside=${minUpside}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error("서버 오류");
      const data: ScannerItem[] = await res.json();
      setItems(data);
      setRefreshedAt(new Date());
    } catch (e: any) {
      setError(e.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market, minUpside]);

  useEffect(() => { load(); }, [load]);

  const sorted = [...items].sort((a, b) => {
    if (sortBy === "upside")  return (b.upside ?? 0) - (a.upside ?? 0);
    if (sortBy === "today")   return (a.todayChangePct ?? 0) - (b.todayChangePct ?? 0); // 낙폭 큰 것 먼저
    return new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime();
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5 text-[#FF8A7A]" />
          <h1 className="text-lg font-bold text-foreground">저평가 스캐너</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          AI 적정주가 대비 현재가가 낮은 종목 발굴 · 5분 캐시
        </p>
      </div>

      {/* 필터 */}
      <div className="space-y-3">
        {/* 시장 탭 */}
        <div className="flex gap-1.5 p-1 bg-muted/40 rounded-xl w-fit">
          {MARKET_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setMarket(tab.key)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                market === tab.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 상승여력 + 정렬 */}
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs text-muted-foreground">최소 상승여력</span>
          <div className="flex gap-1">
            {UPSIDE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMinUpside(opt.value)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border",
                  minUpside === opt.value
                    ? "bg-[#FF8A7A]/15 text-[#FF8A7A] border-[#FF8A7A]/30"
                    : "bg-transparent text-muted-foreground border-border hover:border-foreground/20"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value as any)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border",
                  sortBy === opt.value
                    ? "bg-foreground/10 text-foreground border-foreground/20"
                    : "bg-transparent text-muted-foreground border-border hover:border-foreground/20"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 결과 헤더 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {loading ? "조회 중…" : `${sorted.length}개 종목 발굴됨`}
          {refreshedAt && !loading && (
            <span className="ml-2 opacity-60">
              {format(refreshedAt, "HH:mm 기준", { locale: ko })}
            </span>
          )}
        </span>
        <button
          onClick={() => load(true)}
          disabled={loading || refreshing}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={cn("w-3 h-3", refreshing && "animate-spin")} />
          새로고침
        </button>
      </div>

      {/* 리스트 */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-[#FF8A7A]" />
          <p className="text-sm text-muted-foreground">현재가 조회 중…</p>
          <p className="text-xs text-muted-foreground/60">종목별 시세를 실시간으로 가져오고 있습니다</p>
        </div>
      ) : error ? (
        <div className="text-center py-16 text-sm text-destructive">{error}</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          조건에 맞는 종목이 없습니다
        </div>
      ) : (
        <AnimatePresence initial={false}>
          <div className="space-y-2">
            {sorted.map((item, i) => {
              const badge = verdictBadge(item.investmentVerdict);
              const isKR = isKRTicker(item.ticker);
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => navigate(`/analysis/${item.id}`)}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:bg-muted/30 active:bg-muted/50 cursor-pointer transition-colors group"
                >
                  {/* 로고 */}
                  <StockLogo
                    ticker={item.ticker}
                    companyName={item.companyName}
                    size="sm"
                    className="shrink-0"
                  />

                  {/* 종목 정보 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
                      <span className="font-semibold text-sm text-foreground truncate">{item.companyName}</span>
                      <span className={cn(
                        "text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0",
                        isKR
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-500"
                          : "bg-purple-50 dark:bg-purple-900/20 text-purple-500"
                      )}>
                        {isKR ? "KR" : "US"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground font-mono">{item.ticker}</span>
                      {item.industry && (
                        <>
                          <span className="text-muted-foreground/30 text-[10px]">·</span>
                          <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{item.industry}</span>
                        </>
                      )}
                    </div>
                    {/* 가격 행 */}
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        현재 {item.currentPrice != null
                          ? isKR
                            ? `${item.currentPrice.toLocaleString()}원`
                            : `$${item.currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "–"}
                      </span>
                      <span className="text-muted-foreground/30 text-[10px]">→</span>
                      <span className="text-xs font-semibold text-[#FF8A7A]">
                        목표 {isKR
                          ? `${item.targetPrice.toLocaleString()}원`
                          : `$${item.targetPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                    </div>
                  </div>

                  {/* 우측: 상승여력 + 오늘등락 */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {item.upside != null && <UpsidePill pct={item.upside} />}
                    <TodayChange pct={item.todayChangePct} />
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-semibold", badge.cls)}>
                      {badge.label}
                    </span>
                  </div>

                  <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0 group-hover:text-muted-foreground transition-colors" />
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      )}

      {/* 안내 */}
      {!loading && sorted.length > 0 && (
        <p className="text-[10px] text-muted-foreground/50 text-center pb-4">
          최근 6개월 내 AI 분석 기준 · 투자 판단의 최종 책임은 투자자 본인에게 있습니다
        </p>
      )}
    </div>
  );
}
