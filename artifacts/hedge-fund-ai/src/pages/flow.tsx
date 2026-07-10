import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw, Users, Building2, Globe, Activity, Info,
  TrendingUp, ArrowUpRight, ArrowDownRight, Minus, Zap, Radio,
  ChevronDown, ChevronUp, Telescope, BarChart2, Target,
  TrendingDown, AlertCircle,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import StockLogo from "@/components/ui/stock-logo";

/* ── 타입 ───────────────────────────────────────────────────────────── */
interface MarketRow  { date: string; individual: number; institution: number; foreign: number }
interface StockFlow  { code: string; name: string; sector: string; individual: number; institution: number; foreign: number }

interface SurgeCandidate {
  ticker: string;
  name: string;
  market: "KOSPI" | "KOSDAQ";
  change: number;
  volume: number;
  volumeRatio: number;
  institution: number;
  foreign: number;
  smartMoney: number;
  surgeScore: number;
  themes: string[];
  signal: "breakout" | "accumulation" | "volume_spike";
}

interface PreSurgeCandidate {
  ticker:        string;
  market:        "KOSPI" | "KOSDAQ";
  name:          string;
  close:         number;
  change:        number;
  score:         number;
  volExpansion:  number;
  volDryupDays:  number;
  priceRangePct: number;
  nearHighPct:   number;
  maAligned:     boolean;
  momentum3d:    number;
  bbWidthPct:    number;
}

interface BacktestSummary {
  totalEvents:    number;
  avgSurgePct:    number;
  avgT1VolRatio:  number;
  avgT1DryupDays: number;
  period:         string;
}
interface PresurgeBandStat { band: string; n: number; hitRate5: number | null; avgChange: number | null }
interface PresurgePickAccuracy {
  totalTracked: number;
  resolved: number;
  pending: number;
  hitRate5: number | null;
  hitRate10: number | null;
  avgNextDayChange: number | null;
  byScoreBand: PresurgeBandStat[];
  byDryupDays: PresurgeBandStat[];
  byNearHighBand: PresurgeBandStat[];
  since: string | null;
}
interface FlowData   { marketFlow: { kospi: MarketRow[]; kosdaq: MarketRow[] }; stocks: StockFlow[]; updatedAt: string }
type SortTab = "individual" | "institution" | "foreign" | "total";

/* ── 유틸 ───────────────────────────────────────────────────────────── */
function flowColor(v: number) {
  if (v > 0) return "text-rose-500 dark:text-rose-400";
  if (v < 0) return "text-sky-500 dark:text-sky-400";
  return "text-muted-foreground/40";
}
function shortDate(raw: string) {
  if (!raw) return raw;
  if (raw.includes("-")) { const p = raw.split("-"); return `${Number(p[1])}/${Number(p[2])}`; }
  if (raw.length >= 8) return `${Number(raw.slice(4,6))}/${Number(raw.slice(6,8))}`;
  return raw;
}

/* ── 폭발 조짐 종목 위젯 ─────────────────────────────────────────────── */
const SIGNAL_CFG = {
  breakout:      { label: "🚀 돌파",      cls: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-500/10 dark:border-red-500/25" },
  accumulation:  { label: "📡 집중 매집", cls: "text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-500/10 dark:border-violet-500/25" },
  volume_spike:  { label: "⚡ 거래량 폭발", cls: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-500/10 dark:border-amber-500/25" },
};

function fmt억(v: number) {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}조`;
  if (abs >= 1000)  return `${(v / 1000).toFixed(1)}천억`;
  if (abs === 0) return "0";
  return `${v > 0 ? "+" : ""}${v}억`;
}

export function SurgeWidget() {
  const [data,          setData]          = useState<SurgeCandidate[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [open,          setOpen]          = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [cachedAt,      setCachedAt]      = useState<number | null>(null);
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null);
  const [serverScanning, setServerScanning] = useState(false);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const url = force
        ? getApiUrl("/api/market/surge/refresh")
        : getApiUrl("/api/market/surge");
      const res = await fetch(url, { method: force ? "POST" : "GET", credentials: "include" });
      if (!res.ok) return;
      const j = await res.json();
      const candidates = Array.isArray(j.data) ? j.data : [];
      setData(candidates);
      setCachedAt(j.cachedAt ?? null);
      setServerScanning(j.scanning === true && candidates.length === 0);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // 서버 스캔 중일 때 20초마다 재조회
  useEffect(() => {
    if (!serverScanning) return;
    const id = setInterval(() => load(), 20_000);
    return () => clearInterval(id);
  }, [serverScanning, load]);

  const timeStr = cachedAt
    ? new Date(cachedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      {/* 헤더 */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-red-500" />
            <span className="text-[13px] font-bold text-foreground">오늘 수급 폭발 포착</span>
          </div>
          {data.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 border border-red-500/20">
              {data.length}개
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/40">실시간 수급 기반</span>
          {timeStr && (
            <span className="text-[10px] text-muted-foreground/50">{timeStr} 기준</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={e => { e.stopPropagation(); load(true); }}
            disabled={refreshing || loading}
            className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground/40 hover:text-foreground/70 transition-colors disabled:opacity-30"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground/40" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/40" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              {/* 설명 */}
              <p className="text-[11px] text-muted-foreground/55 leading-relaxed">
                오늘 거래량 급증 + 등락률 상승 + 기관·외인 매집 패턴 감지 · 장 중 30분마다 갱신
              </p>

              {/* 로딩 */}
              {loading && (
                <div className="space-y-2 pt-1">
                  {[0,1,2].map(i => (
                    <div key={i} className="h-14 rounded-xl bg-muted/30 animate-pulse" />
                  ))}
                  <p className="text-[11px] text-muted-foreground/40 text-center pt-1">
                    전 종목 스캔 중… (30~90초 소요)
                  </p>
                </div>
              )}

              {/* 데이터 없음 / 스캔 중 */}
              {!loading && data.length === 0 && (
                <div className="py-8 text-center space-y-1.5">
                  <Zap className={cn("w-6 h-6 mx-auto", serverScanning ? "text-amber-400 animate-pulse" : "text-muted-foreground/20")} />
                  {serverScanning ? (
                    <>
                      <p className="text-[12px] text-amber-500/80">전 종목 스캔 중…</p>
                      <p className="text-[11px] text-muted-foreground/40">잠시 후 자동으로 업데이트됩니다</p>
                    </>
                  ) : (
                    <>
                      <p className="text-[12px] text-muted-foreground/40">장 중(09:00~15:30)에만 탐지됩니다</p>
                      <p className="text-[11px] text-muted-foreground/30">현재 조건 충족 종목 없음</p>
                    </>
                  )}
                </div>
              )}

              {/* 종목 리스트 */}
              {!loading && data.map((s, i) => {
                const sig = SIGNAL_CFG[s.signal];
                const isExpanded = expandedTicker === s.ticker;
                const hasSmartBuy = s.smartMoney > 0;
                return (
                  <div key={s.ticker} className={cn(
                    "rounded-xl border overflow-hidden transition-colors",
                    s.signal === "breakout"
                      ? "border-red-200/60 dark:border-red-500/20"
                      : s.signal === "accumulation"
                      ? "border-violet-200/60 dark:border-violet-500/20"
                      : "border-border/50",
                  )}>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
                      onClick={() => setExpandedTicker(isExpanded ? null : s.ticker)}
                    >
                      {/* 순위 */}
                      <span className="text-[11px] font-black text-muted-foreground/30 w-4 text-right shrink-0">{i + 1}</span>

                      {/* 로고 */}
                      <StockLogo ticker={s.ticker} companyName={s.name} size="sm" />

                      {/* 종목 정보 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-bold text-foreground truncate">{s.name}</span>
                          <span className={cn("text-[9px] font-semibold px-1 py-0.5 rounded border", sig.cls)}>
                            {sig.label}
                          </span>
                          {s.themes.slice(0, 1).map(t => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 font-medium truncate max-w-[80px]">
                              {t}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] font-medium text-muted-foreground/50">{s.ticker} · {s.market}</span>
                          <span className={cn("text-[11px] font-bold", hasSmartBuy ? "text-red-500" : "text-muted-foreground/40")}>
                            {hasSmartBuy ? "🤝 스마트머니↑" : "개인 주도"}
                          </span>
                        </div>
                      </div>

                      {/* 등락률 + 거래량배율 */}
                      <div className="text-right shrink-0">
                        <div className="text-[15px] font-black text-red-500 tabular-nums">
                          +{s.change.toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-muted-foreground/50 tabular-nums">
                          거래량 {s.volumeRatio}배
                        </div>
                      </div>

                      <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/30 shrink-0 transition-transform", isExpanded && "rotate-180")} />
                    </button>

                    {/* 펼침 상세 */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-3 pt-1 border-t border-border/40 grid grid-cols-3 gap-2">
                            <div className="text-center">
                              <p className="text-[10px] text-muted-foreground/50 mb-0.5">기관</p>
                              <p className={cn("text-[12px] font-bold tabular-nums", s.institution > 0 ? "text-red-500" : s.institution < 0 ? "text-blue-500" : "text-muted-foreground/40")}>
                                {s.institution > 0 ? "+" : ""}{fmt억(s.institution)}
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-[10px] text-muted-foreground/50 mb-0.5">외국인</p>
                              <p className={cn("text-[12px] font-bold tabular-nums", s.foreign > 0 ? "text-red-500" : s.foreign < 0 ? "text-blue-500" : "text-muted-foreground/40")}>
                                {s.foreign > 0 ? "+" : ""}{fmt억(s.foreign)}
                              </p>
                            </div>
                            <div className="text-center">
                              <p className="text-[10px] text-muted-foreground/50 mb-0.5">기관+외인</p>
                              <p className={cn("text-[12px] font-bold tabular-nums", s.smartMoney > 0 ? "text-red-500" : s.smartMoney < 0 ? "text-blue-500" : "text-muted-foreground/40")}>
                                {s.smartMoney > 0 ? "+" : ""}{fmt억(s.smartMoney)}
                              </p>
                            </div>
                            {s.themes.length > 1 && (
                              <div className="col-span-3 flex flex-wrap gap-1 mt-1">
                                {s.themes.map(t => (
                                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/8 text-blue-500/80 border border-blue-500/15">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 급등 전조 위젯 (T-1/T-2 선행 신호 종목) ─────────────────────────── */
function ScoreBar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-teal-500" : "bg-sky-400";
  return (
    <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

function SignalBadge({ label, active, icon }: { label: string; active: boolean; icon: React.ReactNode }) {
  return (
    <span className={cn(
      "flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded border",
      active
        ? "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/10 dark:border-emerald-500/25"
        : "text-muted-foreground/30 bg-transparent border-border/20",
    )}>
      {icon}{label}
    </span>
  );
}

export function PreSurgeWidget() {
  const [data,          setData]          = useState<PreSurgeCandidate[]>([]);
  const [backtest,      setBacktest]      = useState<BacktestSummary | null>(null);
  const [pickAccuracy,  setPickAccuracy]  = useState<PresurgePickAccuracy | null>(null);
  const [loading,       setLoading]       = useState(true);   // 초기부터 로딩 표시
  const [refreshing,    setRefreshing]    = useState(false);
  const [open,          setOpen]          = useState(true);
  const [cachedAt,      setCachedAt]      = useState<number | null>(null);
  const [expanded,      setExpanded]      = useState<string | null>(null);
  const [showBacktest,  setShowBacktest]  = useState(false);
  const [serverScanning, setServerScanning] = useState(false); // 서버 스캔 중 폴링용

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const url = force
        ? getApiUrl("/api/market/presurge/refresh")
        : getApiUrl("/api/market/presurge");
      const res = await fetch(url, { method: force ? "POST" : "GET", credentials: "include" });
      if (!res.ok) return;
      const j = await res.json();
      const candidates = Array.isArray(j.data) ? j.data : [];
      setData(candidates);
      setBacktest(j.backtest ?? null);
      setCachedAt(j.cachedAt ?? null);
      // 서버가 스캔 중이고 아직 결과 없으면 폴링 모드
      setServerScanning(j.scanning === true && candidates.length === 0);
    } catch { /* silent */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const loadAccuracy = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl("/api/market/presurge/accuracy"), { credentials: "include" });
      if (!res.ok) return;
      setPickAccuracy(await res.json());
    } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); loadAccuracy(); }, [load, loadAccuracy]);

  // 서버 스캔 중일 때 20초마다 재조회
  useEffect(() => {
    if (!serverScanning) return;
    const id = setInterval(() => load(), 20_000);
    return () => clearInterval(id);
  }, [serverScanning, load]);

  const timeStr = cachedAt
    ? new Date(cachedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
      {/* 헤더 */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Telescope className="w-4 h-4 text-emerald-500" />
            <span className="text-[13px] font-bold text-foreground">내일 급등 예비군</span>
          </div>
          {data.length > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              {data.length}개
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/40">15영업일 전 종목 스캔</span>
          {timeStr && (
            <span className="text-[10px] text-muted-foreground/30">{timeStr} 기준</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={e => { e.stopPropagation(); load(true); }}
            disabled={refreshing || loading}
            className="p-1 rounded-md hover:bg-muted/50 text-muted-foreground/40 hover:text-foreground/70 transition-colors disabled:opacity-30"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          </button>
          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground/40" /> : <ChevronDown className="w-4 h-4 text-muted-foreground/40" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2">
              {/* 설명 + 백테스팅 배너 */}
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] text-muted-foreground/55 leading-relaxed">
                  거래량 수축→팽창·박스권·이동평균 정배열 등 T-1/T-2 선행 신호 탐지 · 최초 스캔 2~4분 소요
                </p>
                {(backtest || pickAccuracy) && (
                  <button
                    onClick={() => setShowBacktest(b => !b)}
                    className="shrink-0 text-[10px] px-2 py-1 rounded-lg bg-muted/40 hover:bg-muted/70 text-muted-foreground/60 border border-border/40 flex items-center gap-1"
                  >
                    <BarChart2 className="w-3 h-3" />
                    백테스팅
                  </button>
                )}
              </div>

              {/* 백테스팅 패널 */}
              <AnimatePresence>
                {showBacktest && (backtest || pickAccuracy) && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    {backtest && (
                      <div className="rounded-xl border border-emerald-200/50 dark:border-emerald-500/15 bg-emerald-50/40 dark:bg-emerald-500/5 p-3 space-y-2">
                        <div className="flex items-center gap-1.5 mb-1">
                          <BarChart2 className="w-3 h-3 text-emerald-500" />
                          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            최근 {backtest.period.slice(0,8)} ~ {backtest.period.slice(-8)} 백테스팅 결과
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-[10px] text-muted-foreground/50">급등 이벤트</p>
                            <p className="text-[14px] font-black text-emerald-600 dark:text-emerald-400">{backtest.totalEvents}건</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground/50">평균 상승폭</p>
                            <p className="text-[14px] font-black text-red-500">+{backtest.avgSurgePct}%</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground/50">T-1 거래량비</p>
                            <p className="text-[14px] font-black text-teal-600 dark:text-teal-400">{backtest.avgT1VolRatio}x</p>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground/40 text-center">
                          급등 전일 평균 거래량 {backtest.avgT1VolRatio}배 · 수축일 {backtest.avgT1DryupDays}일 관찰됨
                        </p>
                      </div>
                    )}

                    {/* 실제 픽 적중률 (오늘부터 순방향 추적) */}
                    <div className="rounded-xl border border-teal-200/50 dark:border-teal-500/15 bg-teal-50/40 dark:bg-teal-500/5 p-3 space-y-2 mt-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Telescope className="w-3 h-3 text-teal-500" />
                        <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400">
                          실제 픽 적중률 (오늘부터 누적 추적)
                        </span>
                      </div>
                      {pickAccuracy && pickAccuracy.resolved > 0 ? (
                        <>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div>
                              <p className="text-[10px] text-muted-foreground/50">익일 +5% 이상</p>
                              <p className="text-[14px] font-black text-teal-600 dark:text-teal-400">{pickAccuracy.hitRate5}%</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground/50">익일 +10% 이상</p>
                              <p className="text-[14px] font-black text-teal-600 dark:text-teal-400">{pickAccuracy.hitRate10}%</p>
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground/50">평균 익일 등락률</p>
                              <p className={cn("text-[14px] font-black", (pickAccuracy.avgNextDayChange ?? 0) >= 0 ? "text-red-500" : "text-blue-500")}>
                                {(pickAccuracy.avgNextDayChange ?? 0) >= 0 ? "+" : ""}{pickAccuracy.avgNextDayChange}%
                              </p>
                            </div>
                          </div>
                          <div className="pt-1 space-y-1">
                            <p className="text-[9px] text-muted-foreground/40">점수 구간별 적중률</p>
                            <div className="flex gap-1 flex-wrap">
                              {pickAccuracy.byScoreBand.filter(b => b.n > 0).map(b => (
                                <span key={b.band} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground/60">
                                  {b.band}: {b.hitRate5}%({b.n}건)
                                </span>
                              ))}
                            </div>
                          </div>
                          <p className="text-[9px] text-muted-foreground/35 text-center pt-1">
                            추적 {pickAccuracy.totalTracked}건 · 결과확인 {pickAccuracy.resolved}건 · 대기중 {pickAccuracy.pending}건
                            {pickAccuracy.since && ` · ${pickAccuracy.since} 부터`}
                          </p>
                        </>
                      ) : (
                        <p className="text-[10px] text-muted-foreground/45 leading-relaxed">
                          매일 스캔 결과를 저장해 다음 거래일 실제 등락률과 비교합니다. 아직 결과가 확정된 픽이 없어
                          (추적 {pickAccuracy?.totalTracked ?? 0}건 · 대기중 {pickAccuracy?.pending ?? 0}건) 오늘부터 데이터가
                          쌓이는 대로 표시됩니다.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 로딩 / 서버 스캔 중 */}
              {(loading || serverScanning) && data.length === 0 && (
                <div className="space-y-2 pt-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="h-16 rounded-xl bg-muted/30 animate-pulse" />
                  ))}
                  <div className="flex items-center justify-center gap-1.5 pt-1">
                    <RefreshCw className="w-3 h-3 text-emerald-500/60 animate-spin" />
                    <p className="text-[11px] text-muted-foreground/50">
                      {serverScanning ? "서버에서 전 종목 스캔 중… 잠시 후 자동 업데이트" : "스캔 데이터 불러오는 중…"}
                    </p>
                  </div>
                </div>
              )}

              {/* 데이터 없음 (스캔도 완료, 진짜 빈 결과) */}
              {!loading && !serverScanning && data.length === 0 && (
                <div className="py-8 text-center space-y-1.5">
                  <Telescope className="w-6 h-6 text-muted-foreground/20 mx-auto" />
                  <p className="text-[12px] text-muted-foreground/40">
                    현재 전조 신호 종목 없음
                  </p>
                  <p className="text-[11px] text-muted-foreground/30">
                    새로고침으로 재스캔 · 이후 1시간 캐시
                  </p>
                </div>
              )}

              {/* 종목 리스트 */}
              {!loading && data.map((s, i) => {
                const isExpanded = expanded === s.ticker;
                const sigDryup  = s.volDryupDays >= 3;
                const sigBox    = s.priceRangePct < 5;
                const sigHigh   = s.nearHighPct >= 80 && s.nearHighPct < 97;
                const sigVol    = s.volExpansion >= 1.5;
                const signalCount = [sigDryup, sigBox, sigHigh, s.maAligned, sigVol].filter(Boolean).length;

                return (
                  <div key={s.ticker} className={cn(
                    "rounded-xl border overflow-hidden transition-colors",
                    s.score >= 70
                      ? "border-emerald-200/70 dark:border-emerald-500/25"
                      : "border-border/50",
                  )}>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
                      onClick={() => setExpanded(isExpanded ? null : s.ticker)}
                    >
                      {/* 순위 */}
                      <span className="text-[11px] font-black text-muted-foreground/30 w-4 text-right shrink-0">{i + 1}</span>

                      {/* 로고 */}
                      <StockLogo ticker={s.ticker} companyName={s.name} size="sm" />

                      {/* 종목 정보 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13px] font-bold text-foreground truncate">{s.name}</span>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground/60 border border-border/40">
                            신호 {signalCount}/5
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-muted-foreground/50">{s.ticker} · {s.market}</span>
                          <span className={cn("text-[11px] font-medium", s.change > 0 ? "text-red-500" : s.change < 0 ? "text-blue-500" : "text-muted-foreground/40")}>
                            {s.change > 0 ? "+" : ""}{s.change.toFixed(1)}%
                          </span>
                        </div>
                      </div>

                      {/* 점수 */}
                      <div className="text-right shrink-0 w-16">
                        <div className="text-[15px] font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {s.score.toFixed(0)}점
                        </div>
                        <ScoreBar value={s.score} />
                      </div>

                      <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground/30 shrink-0 transition-transform", isExpanded && "rotate-180")} />
                    </button>

                    {/* 펼침 상세 */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-3 pt-2 border-t border-border/40 space-y-2.5">
                            {/* 신호 배지 */}
                            <div className="flex flex-wrap gap-1">
                              <SignalBadge active={sigDryup} icon={<TrendingDown className="w-2.5 h-2.5 mr-0.5" />} label={`거래량 수축 ${s.volDryupDays}일`} />
                              <SignalBadge active={sigVol}   icon={<Zap className="w-2.5 h-2.5 mr-0.5" />}           label={`거래량 ${s.volExpansion}x↑`} />
                              <SignalBadge active={sigBox}   icon={<Target className="w-2.5 h-2.5 mr-0.5" />}         label={`박스권 (변동 ${s.priceRangePct}%)`} />
                              <SignalBadge active={sigHigh}  icon={<TrendingUp className="w-2.5 h-2.5 mr-0.5" />}     label={`20일고점 ${s.nearHighPct.toFixed(0)}%`} />
                              <SignalBadge active={s.maAligned} icon={<Activity className="w-2.5 h-2.5 mr-0.5" />}   label="이동평균 정배열" />
                            </div>

                            {/* 수치 */}
                            <div className="grid grid-cols-3 gap-2 text-center">
                              <div>
                                <p className="text-[10px] text-muted-foreground/50">볼린저 폭</p>
                                <p className={cn("text-[12px] font-bold tabular-nums",
                                  s.bbWidthPct < 3 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/60")}>
                                  {s.bbWidthPct.toFixed(1)}%
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] text-muted-foreground/50">3일 모멘텀</p>
                                <p className={cn("text-[12px] font-bold tabular-nums",
                                  s.momentum3d > 0 ? "text-red-500" : s.momentum3d < 0 ? "text-blue-500" : "text-muted-foreground/40")}>
                                  {s.momentum3d > 0 ? "+" : ""}{s.momentum3d.toFixed(1)}%
                                </p>
                              </div>
                              <div>
                                <p className="text-[10px] text-muted-foreground/50">현재가</p>
                                <p className="text-[12px] font-bold text-foreground tabular-nums">
                                  {s.close.toLocaleString()}원
                                </p>
                              </div>
                            </div>

                            {/* 예상 시나리오 */}
                            <div className="rounded-lg bg-muted/20 px-2.5 py-2">
                              <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                                {sigDryup && sigVol
                                  ? `📦 ${s.volDryupDays}일 연속 거래량 수축 후 오늘 ${s.volExpansion}배 팽창 — 전형적인 큰손 매집 후 시동 패턴`
                                  : sigDryup
                                  ? `🤫 ${s.volDryupDays}일 거래량 수축 중 — 거래량 팽창 신호 발생 시 급등 가능성↑`
                                  : sigBox && sigHigh
                                  ? `📊 ${s.priceRangePct.toFixed(1)}% 박스권 압축 + 20일 고점 ${s.nearHighPct.toFixed(0)}% 근접 — 돌파 직전 패턴`
                                  : `🔍 복합 기술적 패턴 감지 — 종합 점수 ${s.score.toFixed(0)}점 (100점 만점)`
                                }
                              </p>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}

              {/* 면책 */}
              {!loading && data.length > 0 && (
                <div className="flex items-start gap-1.5 pt-1">
                  <AlertCircle className="w-3 h-3 text-muted-foreground/20 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-muted-foreground/30 leading-relaxed">
                    기술적 패턴 기반 탐지로 미래 수익을 보장하지 않습니다. 투자 판단은 본인 책임.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── 요약 카드 ──────────────────────────────────────────────────────── */
function SummaryCard({ label, icon, value, sub }: { label: string; icon: React.ReactNode; value: number; sub: string }) {
  const pos = value > 0, neg = value < 0;
  return (
    <div className={cn(
      "flex-1 rounded-2xl p-4 border transition-colors",
      pos ? "bg-rose-50/80 border-rose-200 dark:bg-rose-950/50 dark:border-rose-800/70"
        : neg ? "bg-sky-50/80 border-sky-200 dark:bg-sky-950/50 dark:border-sky-800/70"
        : "bg-muted/30 border-border/50",
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={cn(
            pos ? "text-rose-500 dark:text-rose-300"
              : neg ? "text-sky-500 dark:text-sky-300"
              : "text-muted-foreground",
          )}>{icon}</span>
          <span className={cn(
            "text-[11px] font-semibold",
            pos ? "text-rose-900 dark:text-rose-100"
              : neg ? "text-sky-900 dark:text-sky-100"
              : "text-foreground/70",
          )}>{label}</span>
        </div>
        <span className={cn(
          pos ? "text-rose-500 dark:text-rose-300"
            : neg ? "text-sky-500 dark:text-sky-300"
            : "text-muted-foreground/40",
        )}>
          {pos ? <ArrowUpRight className="w-3.5 h-3.5" /> : neg ? <ArrowDownRight className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
        </span>
      </div>
      <div className={cn("text-[22px] font-black tabular-nums leading-none tracking-tight", flowColor(value))}>
        {value > 0 ? "+" : ""}{fmt억(value)}
      </div>
      <div className={cn(
        "text-[10px] mt-1.5",
        pos ? "text-rose-800/70 dark:text-rose-200/70"
          : neg ? "text-sky-800/70 dark:text-sky-200/70"
          : "text-foreground/50 dark:text-foreground/60",
      )}>{sub}</div>
    </div>
  );
}

/* ── 수평 바 (중앙 기준) ─────────────────────────────────────────────── */
function CenterBar({ value, maxAbs }: { value: number; maxAbs: number }) {
  const pct = maxAbs > 0 ? Math.max(Math.min((Math.abs(value) / maxAbs) * 46, 46), 1.5) : 0;
  const pos = value > 0;
  const zero = value === 0;
  const barLeft = pos ? 50 : 50 - pct;
  return (
    <div className="flex-1 flex items-center h-5 relative">
      <div className="absolute inset-y-1.5 inset-x-0 rounded-full bg-muted/40 dark:bg-muted/30" />
      <div className="absolute left-1/2 top-1/2 w-px h-4 -translate-x-1/2 -translate-y-1/2 bg-border dark:bg-border/90 z-10" />
      {!zero && (
        <div
          className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full z-[5]"
          style={{
            left: `${barLeft}%`,
            width: `${pct}%`,
            backgroundColor: pos ? "rgb(251,113,133)" : "rgb(56,189,248)",
          }}
        />
      )}
    </div>
  );
}

/* ── 시장 수급 차트 ──────────────────────────────────────────────────── */
function MarketFlowChart({ rows }: { rows: MarketRow[] }) {
  if (!rows.length) return (
    <div className="py-8 text-center text-[13px] text-muted-foreground/40">데이터 없음</div>
  );
  const maxAbs = Math.max(...rows.flatMap(r => [Math.abs(r.individual), Math.abs(r.institution), Math.abs(r.foreign)]), 1);
  const INV = [
    { key: "individual"  as const, label: "개인" },
    { key: "institution" as const, label: "기관" },
    { key: "foreign"     as const, label: "외인" },
  ];
  return (
    <div className="space-y-0">
      {rows.map((r, ri) => (
        <div key={r.date} className={cn("py-3", ri > 0 && "border-t border-border/40")}>
          <div className="text-[11px] font-semibold text-foreground/65 dark:text-foreground/75 tabular-nums mb-2 px-1">
            {shortDate(r.date)}
          </div>
          <div className="space-y-1.5">
            {INV.map(inv => (
              <div key={inv.key} className="flex items-center gap-2">
                <span className="text-[10px] text-foreground/60 dark:text-foreground/70 w-7 shrink-0 text-right">{inv.label}</span>
                <CenterBar value={r[inv.key]} maxAbs={maxAbs} />
                <span className={cn("text-[11px] tabular-nums font-semibold w-14 text-right shrink-0", flowColor(r[inv.key]))}>
                  {r[inv.key] > 0 ? "+" : ""}{fmt억(r[inv.key])}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── 종목 수급 행 ────────────────────────────────────────────────────── */
function StockFlowRow({ stock, sortKey, rank }: { stock: StockFlow; sortKey: SortTab; rank: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.025, duration: 0.2 }}
      className="px-4 py-3 border-b border-border/25 last:border-0 hover:bg-muted/10 transition-colors"
    >
      {/* 1행: 순위 + 로고 + 이름/섹터 */}
      <div className="flex items-center gap-2.5 mb-2">
        <div className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
          rank === 1 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
            : rank === 2 ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-700/60 dark:text-zinc-300"
            : rank === 3 ? "bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-300"
            : "text-muted-foreground/50 dark:text-muted-foreground/60",
        )}>
          {rank <= 3 ? rank : <span className="text-[10px]">{rank}</span>}
        </div>
        <StockLogo ticker={`${stock.code}.KS`} companyName={stock.name} size="sm" className="shrink-0" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground leading-tight">{stock.name}</div>
          {stock.sector && (
            <div className="text-[10px] text-muted-foreground/55 dark:text-muted-foreground/65 mt-0.5">{stock.sector}</div>
          )}
        </div>
      </div>

      {/* 2행: 수급 뱃지 (왼쪽 정렬, 전체 너비 활용) */}
      <div className="flex gap-2 ml-7">
        {(["individual", "institution", "foreign"] as const).map(k => {
          const v = stock[k];
          const label = k === "individual" ? "개인" : k === "institution" ? "기관" : "외인";
          const active = sortKey === k || (sortKey === "total" && k !== "individual");
          return (
            <div
              key={k}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1.5 flex-1 transition-opacity",
                active ? "opacity-100" : "opacity-55",
                v > 0
                  ? "bg-rose-50 dark:bg-rose-900/50"
                  : v < 0
                  ? "bg-sky-50 dark:bg-sky-900/50"
                  : "bg-muted/25 dark:bg-muted/30",
              )}
            >
              <span className="text-[9px] text-muted-foreground/55 dark:text-muted-foreground/65 shrink-0">{label}</span>
              <span className={cn("text-[11px] font-bold tabular-nums ml-auto", flowColor(v))}>
                {v > 0 ? "+" : ""}{fmt억(v)}
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── 스마트머니 인사이트 카드 ─────────────────────────────────────────── */
function SmartMoneyCard({ stocks }: { stocks: StockFlow[] }) {
  if (!stocks.length) return null;
  const totalInd  = stocks.reduce((s, st) => s + st.individual,  0);
  const totalInst = stocks.reduce((s, st) => s + st.institution, 0);
  const totalFor  = stocks.reduce((s, st) => s + st.foreign,     0);
  const smart = totalInst + totalFor;
  const agree = (totalInd > 0 && smart > 0) || (totalInd < 0 && smart < 0);
  return (
    <div className={cn(
      "rounded-2xl border px-5 py-4",
      agree
        ? "bg-emerald-50/50 border-emerald-100 dark:bg-emerald-950/25 dark:border-emerald-800/40"
        : "bg-amber-50/50 border-amber-100 dark:bg-amber-950/25 dark:border-amber-800/40",
    )}>
      <div className="flex items-center gap-3">
        <span className="text-xl">{agree ? "🤝" : "⚡"}</span>
        <div>
          <div className={cn("text-[13px] font-bold", agree ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>
            {agree
              ? `개미·기관·외인 방향 일치 — ${totalInd > 0 ? "동반 순매수" : "동반 순매도"}`
              : "개미 vs 스마트머니 방향 엇갈림"}
          </div>
          <div className="text-[11px] text-muted-foreground/65 dark:text-muted-foreground/75 mt-0.5">
            개인 {fmt억(totalInd)} · 기관+외인 {fmt억(smart)}
            {!agree && " · 어느 쪽이 맞는지 주시하세요"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 메인 ────────────────────────────────────────────────────────────── */
const TAB_DEFS: { key: SortTab; label: string; icon: React.ReactNode }[] = [
  { key: "individual",  label: "개인",     icon: <Users      className="w-3 h-3" /> },
  { key: "institution", label: "기관",     icon: <Building2  className="w-3 h-3" /> },
  { key: "foreign",     label: "외국인",   icon: <Globe      className="w-3 h-3" /> },
  { key: "total",       label: "기관+외인", icon: <TrendingUp className="w-3 h-3" /> },
];

export function FlowContent() {
  const [data,       setData]       = useState<FlowData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(false);
  const [tab,        setTab]        = useState<SortTab>("institution");
  const [market,     setMarket]     = useState<"kospi" | "kosdaq">("kospi");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!force) setLoading(true);
    setError(false);
    try {
      const url = force ? getApiUrl("/api/market/flow/refresh") : getApiUrl("/api/market/flow");
      const res = await fetch(url, { method: force ? "POST" : "GET", credentials: "include" });
      if (!res.ok) throw new Error("bad");
      setData(await res.json());
    } catch { setError(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => { setRefreshing(true); await load(true); };

  const sorted = data?.stocks
    ? [...data.stocks].sort((a, b) => {
        if (tab === "individual")  return b.individual  - a.individual;
        if (tab === "institution") return b.institution - a.institution;
        if (tab === "foreign")     return b.foreign     - a.foreign;
        return (b.institution + b.foreign) - (a.institution + a.foreign);
      })
    : [];

  const latestKospi  = data?.marketFlow.kospi.at(-1);
  const latestKosdaq = data?.marketFlow.kosdaq.at(-1);
  const updatedAt    = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>

      {/* 헤더 */}
        <div className="flex items-start justify-between mb-7">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <Activity className="w-5 h-5 text-primary" />
              <h1 className="text-[18px] font-extrabold text-foreground tracking-tight">수급 레이더</h1>
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                실시간
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground/60 leading-relaxed">
              개미·기관·외국인 순매수 흐름을 한눈에
            </p>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            {updatedAt && (
              <span className="text-[11px] text-muted-foreground/55 tabular-nums">{updatedAt} 기준</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors text-muted-foreground/50 hover:text-foreground disabled:opacity-30"
            >
              <RefreshCw className={cn("w-4 h-4", (loading || refreshing) && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* 로딩 */}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {[0,1,2].map(i => (
                <div key={i} className="h-24 rounded-2xl bg-muted/30 animate-pulse" />
              ))}
            </div>
            <div className="h-72 rounded-2xl bg-muted/20 animate-pulse" />
            <div className="h-48 rounded-2xl bg-muted/20 animate-pulse" />
            <p className="text-center text-[11px] text-muted-foreground/40 pt-1">
              수급 데이터 불러오는 중…
            </p>
          </div>
        ) : error || !data ? (
          <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground/40">
            <Activity className="w-8 h-8" />
            <p className="text-sm">수급 데이터를 불러오지 못했습니다</p>
            <button onClick={() => load()} className="text-[12px] text-primary/70 hover:text-primary underline underline-offset-2">
              다시 시도
            </button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-5"
          >
            {/* 요약 카드 */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-[12px] font-bold text-foreground/75 dark:text-foreground/85">오늘의 시장 수급</span>
                <span className="text-[10px] text-foreground/50 dark:text-foreground/60">코스피+코스닥 합산, 억원</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SummaryCard label="개인(개미)" icon={<Users className="w-3.5 h-3.5" />}
                  value={(latestKospi?.individual ?? 0) + (latestKosdaq?.individual ?? 0)} sub="순매수 거래대금" />
                <SummaryCard label="기관" icon={<Building2 className="w-3.5 h-3.5" />}
                  value={(latestKospi?.institution ?? 0) + (latestKosdaq?.institution ?? 0)} sub="순매수 거래대금" />
                <SummaryCard label="외국인" icon={<Globe className="w-3.5 h-3.5" />}
                  value={(latestKospi?.foreign ?? 0) + (latestKosdaq?.foreign ?? 0)} sub="순매수 거래대금" />
              </div>
            </div>

            {/* 최근 5일 시장 수급 */}
            <div className="rounded-2xl border border-border/40 overflow-hidden bg-card">
              {/* 탭 헤더 */}
              <div className="flex items-center border-b border-border/30 px-5 pt-4 pb-0 gap-1">
                {(["kospi", "kosdaq"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMarket(m)}
                    className={cn(
                      "mr-3 pb-3 text-[13px] font-semibold border-b-2 -mb-px transition-colors",
                      market === m ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground/50 hover:text-muted-foreground",
                    )}
                  >
                    {m === "kospi" ? "코스피" : "코스닥"}
                  </button>
                ))}
                <div className="ml-auto pb-3 text-[10px] text-foreground/50 dark:text-foreground/60">최근 5거래일</div>
              </div>

              <div className="px-5 py-3">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={market}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <MarketFlowChart rows={data.marketFlow[market]} />
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className="px-5 py-2.5 border-t border-border/40 bg-muted/20 dark:bg-muted/15 flex items-center gap-1.5">
                <Info className="w-3 h-3 text-foreground/40" />
                <p className="text-[10px] text-foreground/55 dark:text-foreground/65">
                  pykrx(KRX) · 빨강=순매수, 파랑=순매도
                </p>
              </div>
            </div>

            {/* 종목별 수급 */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] font-bold text-foreground/75 dark:text-foreground/85">종목별 수급 TOP</span>
                <span className="text-[10px] text-foreground/50 dark:text-foreground/60">KIS API · 오늘 기준</span>
              </div>

              {/* 정렬 탭 */}
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {TAB_DEFS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all",
                      tab === t.key
                        ? "bg-foreground text-background shadow-sm"
                        : "bg-muted/50 text-muted-foreground/70 hover:bg-muted/80 hover:text-foreground/90",
                    )}
                  >
                    {t.icon}
                    {t.label} 순매수
                  </button>
                ))}
              </div>

              {/* 목록 */}
              <div className="rounded-2xl border border-border/40 overflow-hidden bg-card">
                {sorted.length === 0 ? (
                  <div className="py-12 text-center text-[13px] text-muted-foreground/40">
                    종목 수급 데이터가 없습니다<br />
                    <span className="text-[11px]">(장 마감 후 또는 API 한도)</span>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }}>
                      {sorted.slice(0, 15).map((s, i) => (
                        <StockFlowRow key={s.code} stock={s} sortKey={tab} rank={i + 1} />
                      ))}
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </div>

            {/* 스마트머니 카드 */}
            {data.stocks.length > 0 && <SmartMoneyCard stocks={data.stocks} />}

            <p className="text-[10px] text-muted-foreground/30 dark:text-muted-foreground/40 text-center leading-relaxed pt-2">
              본 수급 데이터는 투자 권유가 아닙니다. 단일 지표로 투자 결정을 내리지 마세요.
            </p>
          </motion.div>
        )}
    </>
  );
}

export default function FlowPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-20">
        <FlowContent />
      </div>
    </div>
  );
}
