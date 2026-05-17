import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, Search, SlidersHorizontal, ChevronLeft, ChevronRight,
  TrendingUp, TrendingDown, Minus, Globe, BookOpen, X,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { format } from "date-fns";
import { ko } from "date-fns/locale";

// ── 타입 ──────────────────────────────────────────────────────────────────────
interface BrowseItem {
  id: number;
  ticker: string;
  companyName: string;
  englishName: string | null;
  industry: string | null;
  investmentVerdict: string;
  targetPrice: number | null;
  entryPrice: number | null;
  language: string;
  createdAt: string;
}

interface BrowseResponse {
  total: number;
  page: number;
  limit: number;
  items: BrowseItem[];
  meta: { industries: string[]; verdicts: string[] };
}

// ── 판정 관련 헬퍼 ────────────────────────────────────────────────────────────
const VERDICT_ORDER = ["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"];

const VERDICT_KO: Record<string, string> = {
  "Strong Buy":  "높은 상승여력",
  "Buy":         "상승여력",
  "Hold":        "적정 수준",
  "Sell":        "하락여지",
  "Strong Sell": "높은 하락여지",
};

function verdictStyle(v: string) {
  if (v === "Strong Buy")  return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (v === "Buy")         return "bg-green-500/15 text-green-400 border-green-500/30";
  if (v === "Hold")        return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  if (v === "Sell")        return "bg-red-400/15 text-red-400 border-red-400/30";
  if (v === "Strong Sell") return "bg-red-600/15 text-red-500 border-red-600/30";
  return "bg-muted text-muted-foreground border-border";
}

function verdictDotColor(v: string) {
  if (v === "Strong Buy")  return "bg-emerald-400";
  if (v === "Buy")         return "bg-green-400";
  if (v === "Hold")        return "bg-amber-400";
  if (v === "Sell")        return "bg-red-400";
  if (v === "Strong Sell") return "bg-red-500";
  return "bg-muted-foreground";
}

function VerdictIcon({ v }: { v: string }) {
  if (v === "Strong Buy" || v === "Buy")   return <TrendingUp  className="w-3.5 h-3.5" />;
  if (v === "Strong Sell" || v === "Sell") return <TrendingDown className="w-3.5 h-3.5" />;
  return <Minus className="w-3.5 h-3.5" />;
}

function isKR(ticker: string) {
  return /^\d/.test(ticker) || ticker.endsWith(".KQ") || ticker.endsWith(".KS");
}

// ── 분석 카드 ─────────────────────────────────────────────────────────────────
function AnalysisCard({ item, isEn, onClick }: { item: BrowseItem; isEn: boolean; onClick: () => void }) {
  const upside = item.targetPrice && item.entryPrice
    ? ((item.targetPrice - item.entryPrice) / item.entryPrice) * 100
    : null;
  const kr = isKR(item.ticker);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      onClick={onClick}
      className="group cursor-pointer rounded-xl border border-border bg-card hover:bg-card/80 hover:border-primary/30 transition-all duration-200 p-4 flex flex-col gap-3"
    >
      {/* 상단: 티커 + 판정 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={cn(
              "text-[9px] font-bold px-1.5 py-0.5 rounded-full border",
              kr
                ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                : "bg-orange-500/10 text-orange-400 border-orange-500/20"
            )}>
              {kr ? "KR" : "US"}
            </span>
            <span className="font-mono text-[11px] font-bold text-muted-foreground/60">{item.ticker}</span>
          </div>
          <p className="text-[14px] font-bold text-foreground leading-tight truncate max-w-[160px]">
            {isEn && item.englishName ? item.englishName : item.companyName}
          </p>
          {item.industry && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">{item.industry}</p>
          )}
        </div>
        <div className={cn(
          "shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold",
          verdictStyle(item.investmentVerdict)
        )}>
          <VerdictIcon v={item.investmentVerdict} />
          <span>{isEn ? item.investmentVerdict : (VERDICT_KO[item.investmentVerdict] ?? item.investmentVerdict)}</span>
        </div>
      </div>

      {/* 중단: 적정주가 업사이드 */}
      {upside !== null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
            <motion.div
              className={cn("h-full rounded-full", upside >= 0 ? "bg-primary/60" : "bg-blue-500/60")}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(Math.abs(upside), 100)}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <span className={cn(
            "text-[12px] font-bold tabular-nums shrink-0",
            upside >= 0 ? "text-primary" : "text-blue-400"
          )}>
            {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
          </span>
        </div>
      )}
      {item.targetPrice && item.entryPrice && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          <span>분석가 {formatCurrency(item.entryPrice, kr ? "KRW" : "USD")}</span>
          <span>→</span>
          <span className="text-foreground/60 font-semibold">{formatCurrency(item.targetPrice, kr ? "KRW" : "USD")}</span>
        </div>
      )}

      {/* 하단: 날짜 */}
      <div className="flex items-center justify-between mt-auto pt-1 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground/40">
          {format(new Date(item.createdAt), isEn ? "MMM d, yyyy" : "yyyy.MM.dd", { locale: isEn ? undefined : ko })}
        </span>
        <span className="text-[10px] text-primary/0 group-hover:text-primary/60 transition-colors">
          {isEn ? "View →" : "보기 →"}
        </span>
      </div>
    </motion.div>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
const LIMIT = 20;

export default function Browse() {
  const { isEn } = useLanguage();
  const [, setLocation] = useLocation();

  const [page, setPage]           = useState(1);
  const [market, setMarket]       = useState<"" | "KR" | "US">("");
  const [verdict, setVerdict]     = useState("");
  const [industry, setIndustry]   = useState("");
  const [search, setSearch]       = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [data, setData]       = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // 검색 디바운스
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
        sort: "latest",
      });
      if (market)          params.set("market", market);
      if (verdict)         params.set("verdict", verdict);
      if (industry)        params.set("industry", industry);
      if (debouncedSearch) params.set("search", debouncedSearch);

      const res = await fetch(getApiUrl(`/api/analysis/browse?${params}`));
      if (!res.ok) throw new Error("Failed to load");
      const json: BrowseResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page, market, verdict, industry, debouncedSearch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  const hasFilters = market !== "" || verdict !== "" || industry !== "" || debouncedSearch !== "";

  function resetFilters() {
    setMarket(""); setVerdict(""); setIndustry(""); setSearch(""); setDebouncedSearch(""); setPage(1);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-10">

      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-[17px] font-black text-foreground leading-tight">
              {isEn ? "AI Research Reports" : "AI 분석 보고서"}
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {isEn ? "Auto-generated daily by AiBITDA · Public" : "매일 자동 생성되는 공개 AI 분석 리포트"}
            </p>
          </div>
        </div>

        {data && (
          <span className="text-[11px] text-muted-foreground/50 shrink-0">
            {isEn ? `${data.total} reports` : `총 ${data.total.toLocaleString()}건`}
          </span>
        )}
      </div>

      {/* 검색 + 필터 */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isEn ? "Search by company or ticker…" : "종목명 또는 티커 검색…"}
            className="w-full pl-8 pr-3 py-2 text-[13px] bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground/30"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters((p) => !p)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-semibold transition-colors",
            showFilters || hasFilters
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-muted/50 border-border text-muted-foreground hover:text-foreground"
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {isEn ? "Filter" : "필터"}
          {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
        </button>
      </div>

      {/* 필터 패널 */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
              {/* 시장 */}
              <div>
                <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-2">
                  {isEn ? "Market" : "시장"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[{ v: "", label: isEn ? "All" : "전체" }, { v: "KR", label: "한국 🇰🇷" }, { v: "US", label: "미국 🇺🇸" }].map(({ v, label }) => (
                    <button
                      key={v}
                      onClick={() => { setMarket(v as "" | "KR" | "US"); setPage(1); }}
                      className={cn(
                        "px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors",
                        market === v
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 판정 */}
              <div>
                <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-2">
                  {isEn ? "Verdict" : "투자 판정"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => { setVerdict(""); setPage(1); }}
                    className={cn(
                      "px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors",
                      verdict === ""
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {isEn ? "All" : "전체"}
                  </button>
                  {(data?.meta.verdicts ?? VERDICT_ORDER).map((v) => (
                    <button
                      key={v}
                      onClick={() => { setVerdict(verdict === v ? "" : v); setPage(1); }}
                      className={cn(
                        "px-3 py-1 rounded-full text-[12px] font-bold border transition-colors",
                        verdict === v
                          ? cn(verdictStyle(v), "opacity-100")
                          : "bg-background border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isEn ? v : (VERDICT_KO[v] ?? v)}
                    </button>
                  ))}
                </div>
              </div>

              {/* 업종 */}
              {data && data.meta.industries.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-wider mb-2">
                    {isEn ? "Industry" : "업종"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => { setIndustry(""); setPage(1); }}
                      className={cn(
                        "px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors",
                        industry === ""
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isEn ? "All" : "전체"}
                    </button>
                    {data.meta.industries.map((ind) => (
                      <button
                        key={ind}
                        onClick={() => { setIndustry(industry === ind ? "" : ind); setPage(1); }}
                        className={cn(
                          "px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors",
                          industry === ind
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {ind}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {hasFilters && (
                <button
                  onClick={resetFilters}
                  className="text-[11px] text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> {isEn ? "Clear all filters" : "필터 초기화"}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 로딩 */}
      {loading && (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">{isEn ? "Loading reports…" : "불러오는 중…"}</span>
        </div>
      )}

      {/* 에러 */}
      {!loading && error && (
        <div className="text-center py-16 text-muted-foreground text-sm">{error}</div>
      )}

      {/* 결과 없음 */}
      {!loading && !error && data && data.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Globe className="w-10 h-10 opacity-20" />
          <p className="text-sm">{isEn ? "No reports found." : "조건에 맞는 보고서가 없습니다."}</p>
          {hasFilters && (
            <button onClick={resetFilters} className="text-[12px] text-primary hover:underline">
              {isEn ? "Clear filters" : "필터 초기화"}
            </button>
          )}
        </div>
      )}

      {/* 카드 그리드 */}
      {!loading && !error && data && data.items.length > 0 && (
        <motion.div
          layout
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
        >
          <AnimatePresence mode="popLayout">
            {data.items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: i * 0.03 }}
              >
                <AnalysisCard
                  item={item}
                  isEn={isEn}
                  onClick={() => setLocation(`/analysis/${item.id}`)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* 페이지네이션 */}
      {!loading && !error && totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) {
                p = i + 1;
              } else if (page <= 4) {
                p = i + 1;
              } else if (page >= totalPages - 3) {
                p = totalPages - 6 + i;
              } else {
                p = page - 3 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={cn(
                    "w-8 h-8 rounded-lg text-[12px] font-semibold transition-colors",
                    p === page
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
