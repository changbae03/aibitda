import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lightbulb, Search, Loader2, TrendingUp, ArrowRight,
  RefreshCw, Building2, ChevronDown, Info, Sparkles, Flame, Radio, Crown, Zap,
} from "lucide-react";
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

interface FeedStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale: string;
  priceChange?: number;
  volumeRatio?: number;
  isLeader?: boolean;
}

interface ThemeFeedItem extends TrendingTheme {
  summary: string;
  stocks: FeedStock[];
}

interface DiscoveredStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale: string;
  dartVerified?: boolean;
  dartIndustry?: string;
  dartBizMatch?: boolean | null;
}

interface DiscoverResult {
  theme: string;
  summary: string;
  stocks: DiscoveredStock[];
}

interface SignalStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  changePercent?: number;
  volume?: number;
  close?: number;
}

interface SignalGroup {
  id: string;
  label: string;
  desc: string;
  market: "US" | "KR";
  stocks: SignalStock[];
}

function fmtChange(v?: number) {
  if (v == null) return null;
  const s = v > 0 ? `+${v.toFixed(1)}%` : `${v.toFixed(1)}%`;
  return { text: s, up: v > 0 };
}

function fmtVolume(v?: number) {
  if (!v) return null;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

export default function ThemesPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { mutateAsync: startAnalysis, isPending: isStarting } = useStartAnalysis();

  // 핫 테마 피드
  const [feed, setFeed] = useState<ThemeFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);

  // 직접 발굴
  const [showSearch, setShowSearch] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoverResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidTheme, setInvalidTheme] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<"all" | "KR" | "US">("all");
  const [showGuide, setShowGuide] = useState(false);

  // 투자자 행동 신호
  const [signals, setSignals] = useState<SignalGroup[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);

  // 분석 모달
  const [confirmModal, setConfirmModal] = useState<{ ticker: string; companyName: string } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadFeed(attempt = 0) {
      if (cancelled) return;
      setFeedLoading(true);
      setFeedError(false);
      try {
        const r = await fetch(getApiUrl("api/themes/trending-feed"));
        if (!r.ok) throw new Error("bad response");
        const data = await r.json();
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setFeed(data);
          setFeedLoading(false);
        } else if (attempt < 8) {
          // 서버가 백그라운드 생성 중 — 5초 후 재시도
          retryTimer = setTimeout(() => loadFeed(attempt + 1), 5000);
        } else {
          setFeedError(true);
          setFeedLoading(false);
        }
      } catch {
        if (cancelled) return;
        setFeedError(true);
        setFeedLoading(false);
      }
    }

    loadFeed();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(getApiUrl("api/themes/signals"))
      .then(r => r.json())
      .then((data: SignalGroup[]) => {
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setSignals(data);
          setSelectedSignal(data[0].id);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSignalsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function discover(theme: string) {
    if (!theme.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    setInvalidTheme(null);
    setMarketFilter("all");
    try {
      const r = await fetch(getApiUrl("api/themes/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: theme.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.invalid) setInvalidTheme(data.error ?? "투자 테마로 인식할 수 없는 입력입니다.");
        else throw new Error(data.error ?? "오류가 발생했습니다.");
        return;
      }
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
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
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Flame className="w-5 h-5 text-[#FF8A7A]" />
          <h1 className="text-lg font-semibold text-foreground">핫 테마 피드</h1>
        </div>
        <p className="text-sm text-foreground/55">
          최근 3일 기관·외국인 순매수가 집중된 테마와 관련주를 분석합니다 · 3시간마다 갱신
        </p>
      </div>

      {/* ── 핫 테마 피드 ─────────────────────────────────────────── */}
      {feedLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border overflow-hidden animate-pulse">
              <div className="px-4 py-3 bg-muted/40 border-b border-border/50 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-muted" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 bg-muted rounded w-1/3" />
                  <div className="h-2.5 bg-muted/70 rounded w-1/2" />
                </div>
              </div>
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-2.5 bg-muted/60 rounded w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          ))}
          <p className="text-center text-xs text-foreground/35 py-2 flex items-center justify-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            AI가 관련주를 분석하는 중… (약 10초)
          </p>
        </div>
      ) : feedError ? (
        <div className="py-8 text-center text-sm text-foreground/40">
          피드를 불러오지 못했습니다.{" "}
          <button
            onClick={() => { setFeedError(false); setFeedLoading(true); fetch(getApiUrl("api/themes/trending-feed")).then(r => r.json()).then(setFeed).catch(() => setFeedError(true)).finally(() => setFeedLoading(false)); }}
            className="text-[#FF8A7A] underline"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {feed.map((item, idx) => (
            <FeedCard key={item.id} item={item} idx={idx} onAnalyze={goAnalyze} onDiscover={discover} />
          ))}
        </div>
      )}

      {/* ── 투자자 행동 신호 ───────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Radio className="w-4 h-4 text-[#FF8A7A]" />
          <h2 className="text-base font-semibold text-foreground">투자자 행동 신호</h2>
        </div>
        <p className="text-sm text-foreground/50 mb-3">
          실시간 급등·거래량 폭발 종목 · 20분마다 갱신
        </p>

        {signalsLoading ? (
          <div className="rounded-2xl border border-border overflow-hidden animate-pulse">
            <div className="flex gap-2 px-4 py-3 border-b border-border/50 overflow-x-auto">
              {[1,2,3,4].map(i => <div key={i} className="h-7 w-28 rounded-full bg-muted shrink-0" />)}
            </div>
            <div className="divide-y divide-border/30">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-muted rounded w-1/3" />
                    <div className="h-2.5 bg-muted/60 rounded w-1/4" />
                  </div>
                  <div className="h-5 w-14 bg-muted rounded" />
                </div>
              ))}
            </div>
          </div>
        ) : signals.length === 0 ? (
          <div className="rounded-2xl border border-border bg-muted/20 px-4 py-6 text-center text-sm text-foreground/40">
            시장 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.
          </div>
        ) : (
          <div className="rounded-2xl border border-border overflow-hidden">
            {/* 탭 */}
            <div className="flex gap-1.5 px-3 py-2.5 border-b border-border/50 overflow-x-auto scrollbar-none">
              {signals.map(g => (
                <button
                  key={g.id}
                  onClick={() => setSelectedSignal(g.id)}
                  className={cn(
                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                    selectedSignal === g.id
                      ? "bg-[#FF8A7A] text-white"
                      : "bg-muted/50 text-foreground/60 hover:bg-muted hover:text-foreground/80"
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* 선택된 탭 종목 리스트 */}
            {(() => {
              const group = signals.find(g => g.id === selectedSignal);
              if (!group) return null;
              return (
                <div>
                  <div className="px-4 py-2 border-b border-border/30 bg-muted/10">
                    <p className="text-[11px] text-foreground/45">{group.desc}</p>
                  </div>
                  <div className="divide-y divide-border/30">
                    {group.stocks.map((stock, si) => {
                      const ch = fmtChange(stock.changePercent);
                      const vol = fmtVolume(stock.volume);
                      return (
                        <motion.div
                          key={stock.ticker}
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: si * 0.03 }}
                          className="flex items-center gap-3 px-4 py-2.5 group hover:bg-muted/20 transition-colors"
                        >
                          <span className="text-xs text-foreground/30 w-4 shrink-0 text-right">{si + 1}</span>
                          <StockLogo ticker={stock.ticker} companyName={stock.name} size="sm" className="shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-sm font-semibold text-foreground truncate leading-tight">{stock.name}</span>
                              <span className={cn(
                                "text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0",
                                stock.market === "KR"
                                  ? "bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400"
                                  : "bg-purple-50 dark:bg-purple-900/20 text-purple-500 dark:text-purple-400"
                              )}>
                                {stock.market}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-[10px] text-foreground/30">{stock.ticker}</span>
                              {vol && (
                                <>
                                  <span className="text-foreground/20 text-[10px]">·</span>
                                  <span className="text-[10px] text-foreground/35">거래량 {vol}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {ch && (
                              <span className={cn(
                                "text-sm font-bold tabular-nums",
                                ch.up ? "text-red-500" : "text-blue-500"
                              )}>
                                {ch.text}
                              </span>
                            )}
                            <button
                              onClick={() => goAnalyze(stock.ticker, stock.name)}
                              className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[#FF8A7A] border border-[#FF8A7A]/30 bg-[#FF8A7A]/5 hover:bg-[#FF8A7A]/15 transition-colors md:opacity-0 md:group-hover:opacity-100"
                            >
                              분석
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── 직접 발굴하기 ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border overflow-hidden">
        <button
          onClick={() => setShowSearch(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-foreground/50" />
            <span className="text-sm font-medium text-foreground/70">테마 직접 발굴하기</span>
            <span className="text-[11px] text-foreground/35">원하는 테마를 직접 입력</span>
          </div>
          <ChevronDown className={cn("w-4 h-4 text-foreground/30 transition-transform duration-200", showSearch && "rotate-180")} />
        </button>
        <AnimatePresence initial={false}>
          {showSearch && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden border-t border-border/50"
            >
              <div className="px-4 py-4 space-y-4">
                {/* 사용법 안내 */}
                <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
                  <button
                    onClick={() => setShowGuide(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Info className="w-3 h-3 text-foreground/40 shrink-0" />
                      <span className="text-xs text-foreground/50">이 기능은 어떻게 동작하나요?</span>
                    </div>
                    <ChevronDown className={cn("w-3 h-3 text-foreground/30 transition-transform duration-200", showGuide && "rotate-180")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {showGuide && (
                      <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-border/40">
                        <div className="px-3 py-3 space-y-2 text-[11.5px] text-foreground/55 leading-relaxed">
                          <p>AI가 DART 공시·KRX 상장 정보를 바탕으로 해당 테마에 직접 노출된 종목을 발굴합니다.</p>
                          <p className="text-foreground/35">예시: "K-방산", "AI 에이전트 인프라", "GLP-1 비만치료제", "HVDC 변압기"</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* 입력창 */}
                <form onSubmit={e => { e.preventDefault(); discover(input); }} className="flex gap-2">
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="테마 입력 (예: 미국 전력 인프라, 금리 인하 수혜...)"
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
                </form>

                {/* 오류 */}
                {invalidTheme && !loading && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-muted/60 border border-border text-sm">
                    <span className="mt-0.5">🔍</span>
                    <div>
                      <p className="font-medium text-foreground">투자 테마를 찾을 수 없습니다</p>
                      <p className="text-xs text-foreground/55 mt-1">{invalidTheme}</p>
                    </div>
                  </div>
                )}
                {error && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/40 text-red-600 dark:text-red-400 text-sm">
                    {error}
                  </div>
                )}

                {/* 로딩 */}
                {loading && (
                  <div className="flex flex-col items-center gap-2 py-8 text-foreground/40">
                    <Loader2 className="w-6 h-6 animate-spin text-[#FF8A7A]" />
                    <p className="text-sm">관련 종목을 발굴하고 있습니다…</p>
                  </div>
                )}

                {/* 결과 */}
                <AnimatePresence>
                  {result && !loading && (
                    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-[#FF8A7A]/8 border border-[#FF8A7A]/20">
                        <TrendingUp className="w-4 h-4 text-[#FF8A7A] mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium">{result.theme}</p>
                          <p className="text-xs text-foreground/55 mt-0.5">{result.summary}</p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium text-foreground/50 uppercase tracking-wide">
                            관련 종목 {marketFilter === "all" ? result.stocks.length : result.stocks.filter(s => s.market === marketFilter).length}개
                          </p>
                          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                            {(["all", "KR", "US"] as const).map(f => (
                              <button key={f} onClick={() => setMarketFilter(f)}
                                className={cn("px-3 py-1.5 transition-colors", marketFilter === f ? "bg-[#FF8A7A] text-white" : "text-foreground/50 hover:text-foreground/80")}>
                                {f === "all" ? "전체" : f}
                              </button>
                            ))}
                          </div>
                        </div>
                        {result.stocks.filter(s => marketFilter === "all" || s.market === marketFilter).map((stock, i) => (
                          <motion.div key={stock.ticker} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                            className="flex flex-col gap-2 p-3.5 rounded-xl border border-border bg-card hover:border-[#FF8A7A]/30 transition-all group">
                            <div className="flex items-start gap-3">
                              <StockLogo ticker={stock.ticker} companyName={stock.name} size="md" className="shrink-0 mt-0.5" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-sm">{stock.name}</span>
                                  <span className="text-xs text-foreground/35 font-mono">{stock.ticker}</span>
                                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", stock.market === "KR" ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400" : "bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400")}>{stock.market}</span>
                                  {stock.sector && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/50">{stock.sector}</span>}
                                  {stock.dartVerified && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 font-medium">📋 {stock.dartIndustry ?? "DART"}</span>}
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-foreground/60 leading-relaxed pl-[52px]">{stock.rationale}</p>
                            <div className="flex justify-end pl-[52px]">
                              <button onClick={() => goAnalyze(stock.ticker, stock.name)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#FF8A7A] border border-[#FF8A7A]/30 hover:bg-[#FF8A7A]/10 transition-colors md:opacity-0 md:group-hover:opacity-100">
                                AI 분석 <ArrowRight className="w-3 h-3" />
                              </button>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                      <button onClick={() => discover(result.theme)} className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-foreground/60 transition-colors">
                        <RefreshCw className="w-3 h-3" />
                        다른 종목으로 다시 발굴
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 분석 확인 팝업 */}
      <AnimatePresence>
        {confirmModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => !isStarting && setConfirmModal(null)}>
            <motion.div initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }}
              transition={{ duration: 0.22, ease: "easeOut" }} onClick={e => e.stopPropagation()}
              className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
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
              <div className="rounded-xl bg-muted/60 px-4 py-3.5 mb-5 space-y-1">
                <p className="text-[13.5px] text-foreground/85 leading-relaxed">
                  <span className="font-bold" style={{ color: "#FF8A7A" }}>애빛다의 AI 애널리스트 팀</span>이<br />7단계 심층 분석을 시작합니다.
                </p>
                <p className="text-[11.5px] text-muted-foreground">평균 3분 소요 · DCF·rNPV 등 밸류에이션 자동 선정</p>
              </div>
              {startError && <p className="text-[12px] text-red-500 text-center mb-3">{startError}</p>}
              <div className="flex gap-2.5">
                <button onClick={() => setConfirmModal(null)} disabled={isStarting}
                  className="flex-1 py-3 rounded-xl border border-border text-[14px] font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50">
                  취소
                </button>
                <button onClick={handleStartAnalysis} disabled={isStarting}
                  className="flex-1 py-3 rounded-xl text-[14px] font-bold text-white transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  style={{ backgroundColor: "#FF8A7A" }}>
                  {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>분석 시작 <ArrowRight className="w-4 h-4" /></>}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── 피드 카드 컴포넌트 ──────────────────────────────────────────────────────

function FeedCard({
  item, idx, onAnalyze, onDiscover,
}: {
  item: ThemeFeedItem;
  idx: number;
  onAnalyze: (ticker: string, name: string) => void;
  onDiscover: (theme: string) => void;
}) {
  const [expanded, setExpanded] = useState(idx < 3); // 처음 3개는 기본 열림

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.06, duration: 0.3 }}
      className="rounded-2xl border border-border bg-card overflow-hidden"
    >
      {/* 카드 헤더 */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-2xl shrink-0">{item.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-foreground">{item.name}</p>
          <p className="text-xs text-foreground/50 truncate mt-0.5">{item.summary}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.stocks.length > 0 && (
            <span className="text-[11px] text-foreground/35 font-medium">{item.stocks.length}종목</span>
          )}
          <ChevronDown className={cn("w-4 h-4 text-foreground/30 transition-transform duration-200", expanded && "rotate-180")} />
        </div>
      </button>

      {/* 종목 리스트 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden border-t border-border/40"
          >
            {/* 왜 핫한지 전문 설명 */}
            {item.description && (
              <div className="px-4 py-3 bg-muted/20 border-b border-border/30">
                <p className="text-[11px] text-foreground/60 leading-relaxed">{item.description}</p>
              </div>
            )}

            {item.stocks.length === 0 ? (
              <div className="px-4 py-4 text-center text-xs text-foreground/35">
                관련주 데이터를 불러오지 못했습니다
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {item.stocks.map((stock, si) => {
                  const chg = stock.priceChange;
                  const vr  = stock.volumeRatio;
                  const hasChg = chg != null;
                  const chgUp  = (chg ?? 0) >= 0;
                  const volBurst = vr != null && vr >= 1.5; // 거래량 1.5배 이상
                  return (
                    <motion.div
                      key={stock.ticker}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: si * 0.04 }}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 group hover:bg-muted/20 transition-colors",
                        stock.isLeader && "bg-amber-50/40 dark:bg-amber-900/10"
                      )}
                    >
                      <StockLogo ticker={stock.ticker} companyName={stock.name} size="sm" className="shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        {/* 이름 행 */}
                        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                          {stock.isLeader && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 shrink-0">
                              <Crown className="w-2.5 h-2.5" />주도주
                            </span>
                          )}
                          <span className="text-sm font-semibold text-foreground leading-tight truncate">{stock.name}</span>
                          <span className={cn(
                            "text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0",
                            stock.market === "KR"
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400"
                              : "bg-purple-50 dark:bg-purple-900/20 text-purple-500 dark:text-purple-400"
                          )}>
                            {stock.market}
                          </span>
                        </div>
                        {/* 티커·섹터 행 */}
                        <div className="flex items-center gap-1 mt-0.5 min-w-0">
                          <span className="font-mono text-[10px] text-foreground/30 shrink-0">{stock.ticker}</span>
                          {stock.sector && (
                            <>
                              <span className="text-foreground/20 text-[10px] shrink-0">·</span>
                              <span className="text-[10px] text-foreground/35 truncate">{stock.sector}</span>
                            </>
                          )}
                        </div>
                        {/* 수급 힘 지표 행 */}
                        {(hasChg || volBurst) && (
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            {hasChg && (
                              <span className={cn(
                                "text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded",
                                chgUp
                                  ? "text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400"
                                  : "text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400"
                              )}>
                                {chgUp ? "+" : ""}{chg!.toFixed(2)}%
                              </span>
                            )}
                            {volBurst && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400">
                                <Zap className="w-2.5 h-2.5" />거래량 {vr!.toFixed(1)}배
                              </span>
                            )}
                          </div>
                        )}
                        {/* 근거 */}
                        <p className="text-[11px] text-foreground/50 line-clamp-2 leading-snug mt-0.5">{stock.rationale}</p>
                      </div>
                      <button
                        onClick={() => onAnalyze(stock.ticker, stock.name)}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#FF8A7A] border border-[#FF8A7A]/30 bg-[#FF8A7A]/5 hover:bg-[#FF8A7A]/15 active:bg-[#FF8A7A]/20 transition-colors whitespace-nowrap mt-0.5"
                      >
                        분석
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
            {/* 더 많은 종목 발굴 버튼 */}
            <div className="px-4 py-2.5 border-t border-border/30 flex justify-end">
              <button
                onClick={() => onDiscover(item.name)}
                className="flex items-center gap-1.5 text-xs text-foreground/40 hover:text-[#FF8A7A] transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                더 많은 종목 발굴
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
