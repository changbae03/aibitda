import { useState, useEffect, useCallback } from "react";
import { format, isToday, isTomorrow, parseISO, addDays, startOfDay } from "date-fns";
import { ko } from "date-fns/locale";
import {
  CalendarDays, RefreshCw, TrendingUp, DollarSign,
  ChevronRight, Building2, AlertCircle, Search, X,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";

interface EarningsEntry {
  ticker: string;
  companyName: string;
  earningsDate: string;
  epsEstimate: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  revenueEstimate: number | null;
  currency: string;
  isKorean: boolean;
}

type Range = "week" | "month";

function fmtEps(val: number | null, currency: string): string {
  if (val == null) return "—";
  if (currency === "KRW") return `${Math.round(val).toLocaleString("ko-KR")}원`;
  return `$${val.toFixed(2)}`;
}

function fmtRevenue(val: number | null, isKorean: boolean): string {
  if (val == null) return "—";
  if (isKorean) {
    if (val >= 1e12) return `${(val / 1e12).toFixed(1)}조원`;
    if (val >= 1e8)  return `${(val / 1e8).toFixed(0)}억원`;
    return `${val.toLocaleString("ko-KR")}원`;
  }
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function DateBadge({ dateStr }: { dateStr: string }) {
  const d = parseISO(dateStr);
  if (isToday(d)) return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ml-2">
      오늘
    </span>
  );
  if (isTomorrow(d)) return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ml-2">
      내일
    </span>
  );
  return null;
}

function ExchangeBadge({ ticker, isKorean }: { ticker: string; isKorean: boolean }) {
  const exchange = ticker.endsWith(".KS") ? "KOSPI" : ticker.endsWith(".KQ") ? "KOSDAQ" : isKorean ? "KRX" : "US";
  const cls = isKorean
    ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
    : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300";
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", cls)}>
      {exchange}
    </span>
  );
}

function EarningsCard({ entry }: { entry: EarningsEntry }) {
  const hasEps = entry.epsEstimate !== null;
  const hasRevenue = entry.revenueEstimate !== null;
  const shortTicker = entry.ticker.replace(/\.(KS|KQ)$/, "");
  const [, navigate] = useLocation();

  const handleClick = () => {
    navigate(`/analysis/new?ticker=${encodeURIComponent(entry.ticker)}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={handleClick}
      className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card hover:bg-accent/40 active:scale-[0.99] transition-all cursor-pointer"
    >
      {/* 아이콘 */}
      <div className="mt-0.5 w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Building2 className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* 메인 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-foreground truncate">{entry.companyName}</span>
          <ExchangeBadge ticker={entry.ticker} isKorean={entry.isKorean} />
          <span className="text-xs text-muted-foreground">{shortTicker}</span>
        </div>

        {(hasEps || hasRevenue) && (
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            {hasEps && (
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                EPS 예상: <span className="text-foreground font-medium ml-0.5">
                  {fmtEps(entry.epsEstimate, entry.currency)}
                </span>
                {entry.epsLow !== null && entry.epsHigh !== null && (
                  <span className="text-muted-foreground/70">
                    ({fmtEps(entry.epsLow, entry.currency)} – {fmtEps(entry.epsHigh, entry.currency)})
                  </span>
                )}
              </span>
            )}
            {hasRevenue && (
              <span className="flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                매출 예상: <span className="text-foreground font-medium ml-0.5">
                  {fmtRevenue(entry.revenueEstimate, entry.isKorean)}
                </span>
              </span>
            )}
          </div>
        )}

        {!hasEps && !hasRevenue && (
          <p className="mt-1 text-xs text-muted-foreground/60">컨센서스 데이터 없음</p>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-1" />
    </motion.div>
  );
}

function DateGroup({ date, entries }: { date: string; entries: EarningsEntry[] }) {
  const d = parseISO(date);
  const label = format(d, "M월 d일 (EEE)", { locale: ko });

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <DateBadge dateStr={date} />
        <span className="text-xs text-muted-foreground ml-auto">{entries.length}종목</span>
      </div>
      <div className="space-y-2">
        {entries.map(e => (
          <EarningsCard key={e.ticker} entry={e} />
        ))}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [range, setRange] = useState<Range>("week");
  const [entries, setEntries] = useState<EarningsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraInput, setExtraInput] = useState("");
  const [extraTickers, setExtraTickers] = useState<string[]>([]);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const fetchCalendar = useCallback(async (r: Range, extra: string[]) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range: r });
      if (extra.length > 0) params.set("tickers", extra.join(","));
      const resp = await fetch(getApiUrl(`/api/market-data/earnings-calendar?${params}`), {
        credentials: "include",
      });
      if (!resp.ok) throw new Error(`서버 오류: ${resp.status}`);
      const data: EarningsEntry[] = await resp.json();
      setEntries(data);
      setLastFetched(new Date());
    } catch (e: any) {
      setError(e.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalendar(range, extraTickers);
  }, [range, fetchCalendar]);

  // 날짜별 그룹화
  const grouped = entries.reduce<Record<string, EarningsEntry[]>>((acc, e) => {
    if (!acc[e.earningsDate]) acc[e.earningsDate] = [];
    acc[e.earningsDate].push(e);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort();

  const handleAddExtra = () => {
    const tickers = extraInput.split(/[,\s]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (!tickers.length) return;
    const merged = Array.from(new Set([...extraTickers, ...tickers]));
    setExtraTickers(merged);
    setExtraInput("");
    fetchCalendar(range, merged);
  };

  const handleRemoveExtra = (t: string) => {
    const next = extraTickers.filter(x => x !== t);
    setExtraTickers(next);
    fetchCalendar(range, next);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
      {/* 헤더 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">실적 발표 캘린더</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          분석 이력 종목 + 주요 코스피/미국 대형주 실적 발표 일정
        </p>
      </div>

      {/* 필터 탭 */}
      <div className="flex items-center gap-2 mb-4">
        {(["week", "month"] as Range[]).map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={cn(
              "px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors",
              range === r
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {r === "week" ? "이번 주 (7일)" : "이번 달 (30일)"}
          </button>
        ))}
        <button
          onClick={() => fetchCalendar(range, extraTickers)}
          disabled={loading}
          className="ml-auto p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* 종목 추가 */}
      <div className="mb-4 p-3 rounded-xl border border-border bg-card">
        <p className="text-xs font-medium text-muted-foreground mb-2">종목 직접 추가</p>
        <div className="flex gap-2">
          <input
            value={extraInput}
            onChange={e => setExtraInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAddExtra()}
            placeholder="예: 005935.KS, AAPL (쉼표 구분)"
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
          />
          <button
            onClick={handleAddExtra}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
        {extraTickers.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {extraTickers.map(t => (
              <span key={t} className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted text-foreground">
                {t}
                <button onClick={() => handleRemoveExtra(t)} className="hover:text-destructive transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 마지막 업데이트 */}
      {lastFetched && !loading && (
        <p className="text-xs text-muted-foreground mb-3">
          업데이트: {format(lastFetched, "HH:mm:ss")} 기준
        </p>
      )}

      {/* 콘텐츠 */}
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <RefreshCw className="w-8 h-8 animate-spin mb-3 text-primary/60" />
            <p className="text-sm">실적 발표 일정을 불러오는 중…</p>
            <p className="text-xs mt-1 text-muted-foreground/60">Yahoo Finance에서 조회 중 (수 초 소요)</p>
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <AlertCircle className="w-8 h-8 mb-3 text-destructive/60" />
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => fetchCalendar(range, extraTickers)}
              className="mt-3 text-xs text-primary underline underline-offset-2"
            >
              다시 시도
            </button>
          </motion.div>
        ) : sortedDates.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center py-16 text-muted-foreground"
          >
            <CalendarDays className="w-10 h-10 mb-3 text-muted-foreground/40" />
            <p className="text-sm font-medium">해당 기간 실적 발표 일정 없음</p>
            <p className="text-xs mt-1 text-muted-foreground/60">
              기간을 변경하거나 종목을 직접 추가해 보세요
            </p>
          </motion.div>
        ) : (
          <motion.div key="content" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {/* 요약 */}
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-muted/60 text-xs text-muted-foreground flex items-center gap-2">
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>
                향후 {range === "week" ? "7일" : "30일"} 내{" "}
                <span className="font-semibold text-foreground">{entries.length}개 종목</span> 실적 발표 예정
              </span>
            </div>

            {/* 날짜별 그룹 */}
            {sortedDates.map(date => (
              <DateGroup key={date} date={date} entries={grouped[date]} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
