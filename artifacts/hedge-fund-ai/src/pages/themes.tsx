import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Lightbulb, Search, Loader2, TrendingUp, ArrowRight,
  RefreshCw, Building2, ChevronDown, Info, Sparkles, Flame, Radio, Crown, Zap, Activity,
  Target, BarChart2, AlertCircle, Calendar,
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
  institutionAek?: number;
  foreignAek?: number;
  smartMoneyAek?: number;
}

type ThemePhase = "hot" | "momentum" | "emerging" | "quiet";

interface ThemeFeedItem extends TrendingTheme {
  summary: string;
  stocks: FeedStock[];
  phase?: ThemePhase;
  themeSmartMoney?: number;
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

// ── 돈의 힘 (수급 강도) 유틸 ─────────────────────────────────────────────────

function stockForceScore(s: FeedStock): number {
  const ch = s.priceChange ?? 0;
  const vr = (s.volumeRatio ?? 1) - 1;
  return ch * 0.6 + vr * 0.4;
}

interface ThemeForce {
  avg: number;
  max: number;
  coverage: number; // 데이터 있는 종목 비율
}

function computeThemeForce(stocks: FeedStock[]): ThemeForce | null {
  const withData = stocks.filter(s => s.priceChange != null);
  if (withData.length === 0) return null;
  const scores = withData.map(stockForceScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const max = Math.max(...scores);
  return { avg, max, coverage: withData.length / Math.max(stocks.length, 1) };
}

/** 서버의 phase 또는 price avg 기반으로 테마 상태 반환 */
function phaseMeta(phase?: ThemePhase, priceAvg?: number | null): { label: string; emoji: string; color: string; barColor: string } {
  if (phase === "hot")      return { label: "강세",      emoji: "🔥", color: "text-red-500",     barColor: "#EF4444" };
  if (phase === "momentum") return { label: "상승 중",   emoji: "⚡", color: "text-orange-500",  barColor: "#F97316" };
  if (phase === "emerging") return { label: "수급 형성", emoji: "📡", color: "text-violet-600 dark:text-violet-400", barColor: "#8B5CF6" };
  const avg = priceAvg ?? 0;
  if (avg >= 2)  return { label: "상승 중",  emoji: "⚡", color: "text-orange-500",    barColor: "#F97316" };
  if (avg >= 0)  return { label: "보합",     emoji: "〰", color: "text-foreground/40",  barColor: "#94a3b8" };
  return               { label: "조정 중",  emoji: "↘",  color: "text-foreground/40",  barColor: "#94a3b8" };
}

/** 종목별 수급 신호 — 스마트머니 우선 */
function stockSignalBadge(s: FeedStock): { text: string; cls: string; title: string } | null {
  const inst = s.institutionAek ?? 0;
  const fore = s.foreignAek ?? 0;
  const sm   = s.smartMoneyAek;
  const priceWeak = Math.abs(s.priceChange ?? 0) < 3;

  if (sm != null) {
    if (inst > 0 && fore > 0 && priceWeak)
      return { text: "기관+외인 동시 매수", cls: "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400", title: `기관 +${inst.toFixed(0)}억, 외인 +${fore.toFixed(0)}억 — 가격 반영 전 수급 선행` };
    if (inst > 10)
      return { text: `기관 +${inst.toFixed(0)}억`, cls: "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400", title: "기관 순매수 — 가격 선행 가능성" };
    if (inst > 0 && priceWeak)
      return { text: "기관 소량 매집", cls: "bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400", title: "기관이 조용히 물량 쌓는 중" };
    if (fore > 10)
      return { text: `외인 +${fore.toFixed(0)}억`, cls: "bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400", title: "외국인 순매수 유입" };
    if (fore > 0 && priceWeak)
      return { text: "외인 유입 중", cls: "bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400", title: "외국인 소량 순매수" };
    if (inst < -10)
      return { text: "기관 매도", cls: "bg-red-50 dark:bg-red-900/20 text-red-500", title: "기관 순매도 중" };
  }

  // 가격+거래량 기반 기존 신호
  if (s.priceChange == null) return null;
  const priceUp = s.priceChange > 0.5;
  const volUp   = (s.volumeRatio ?? 1) >= 1.3;
  if (priceUp && volUp)   return { text: "거래량 동반 상승", cls: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400", title: "주가↑ + 거래량↑ — 상승 모멘텀 살아있음" };
  if (priceUp && !volUp)  return { text: "힘 약해지는 중",  cls: "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400",   title: "주가↑이지만 거래량↓ — 상승 힘 소진 주의" };
  if (!priceUp && volUp)  return { text: "거래량 증가",     cls: "bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400", title: "주가↓ + 거래량↑ — 매도세 또는 저가 매수 경합" };
  return null;
}

// ── 내일 종목 탭 상단 컨셉 안내 카드 ─────────────────────────────────────────



// ── 다가오는 일정 ──────────────────────────────────────────────────────────
//
// 개인 투자자는 네이버에 "12일"을 쳐서 그날 예정된 일을 미리 챙긴다. 실제로 8/10
// 대통령 메가프로젝트 점검회의가 예고돼 있었고 다음 날 관련주가 상한가였다.
// 수급·기술 지표만으로는 이 축이 통째로 비어 있어서, 서버가 뉴스에서 뽑아 여기 붙인다.

interface EventTicker { ticker?: string; name: string; why?: string }
interface UpcomingEvent {
  eventDate: string; title: string; category: string; summary: string | null;
  tickers: EventTicker[]; sectors: string[]; importance: number;
}

const EVENT_CAT_UI: Record<string, { icon: string; cls: string }> = {
  "임상·허가": { icon: "🧬", cls: "bg-violet-500/12 text-violet-600 dark:text-violet-300" },
  "정부·정책": { icon: "🏛️", cls: "bg-blue-500/12 text-blue-600 dark:text-blue-300" },
  "계약·수주": { icon: "📝", cls: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" },
  "실적":      { icon: "📊", cls: "bg-amber-500/12 text-amber-600 dark:text-amber-300" },
  "지수·수급": { icon: "🔄", cls: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300" },
  "기타":      { icon: "📌", cls: "bg-muted text-foreground/60" },
};

/** "8/12 (수)" — 오늘·내일은 말로 */
function eventDayLabel(iso: string, today: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const diff = Math.round((d.getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  const dow = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (diff === 0) return `오늘 ${md}`;
  if (diff === 1) return `내일 ${md}`;
  return `${md} (${dow})`;
}

function UpcomingEvents({ onAnalyze }: { onAnalyze: (ticker: string, name: string) => void }) {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);

  useEffect(() => {
    fetch(getApiUrl("api/events/upcoming?days=7"), { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setEvents(Array.isArray(d?.events) ? d.events : []))
      .catch(() => setEvents([]));
  }, []);

  if (!events || events.length === 0) return null;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  // 날짜별로 묶는다 — 사용자가 "며칠에 뭐가 있나"로 읽기 때문
  const byDate = new Map<string, UpcomingEvent[]>();
  for (const e of events) {
    if (!byDate.has(e.eventDate)) byDate.set(e.eventDate, []);
    byDate.get(e.eventDate)!.push(e);
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-blue-500" />
        <h2 className="text-[14px] font-bold text-foreground">다가오는 일정</h2>
        <span className="text-[10.5px] text-foreground/40">앞으로 7일 · 뉴스에서 수집</span>
      </div>
      <p className="text-[11.5px] text-foreground/50 leading-relaxed">
        임상 발표·정부 일정·정책·계약처럼 <b className="text-foreground/70">날짜가 정해진 재료</b>입니다.
        미리 알면 당일에 쫓아가지 않아도 됩니다.
      </p>

      <div className="space-y-3">
        {[...byDate.entries()].map(([date, list]) => (
          <div key={date}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11.5px] font-bold text-foreground/80">{eventDayLabel(date, today)}</span>
              <span className="h-px flex-1 bg-border/50" />
            </div>
            <div className="space-y-1.5">
              {list.map((e, i) => {
                const ui = EVENT_CAT_UI[e.category] ?? EVENT_CAT_UI["기타"];
                return (
                  <div key={i} className="rounded-xl bg-background/60 border border-border/40 px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className={cn("shrink-0 text-[10px] px-1.5 py-0.5 rounded-md font-semibold", ui.cls)}>
                        {ui.icon} {e.category}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-foreground leading-snug">
                          {e.title}
                          {e.importance >= 3 && <span className="ml-1 text-[10px] text-rose-500 font-bold">주목</span>}
                        </p>
                        {e.summary && (
                          <p className="text-[11px] text-foreground/55 leading-relaxed mt-0.5">{e.summary}</p>
                        )}
                        {e.tickers.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {e.tickers.map((t, j) => (
                              t.ticker ? (
                                <button key={j} onClick={() => onAnalyze(t.ticker!, t.name)}
                                        title={t.why}
                                        className="text-[10.5px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium hover:bg-primary/20 transition">
                                  {t.name}
                                </button>
                              ) : (
                                <span key={j} title={t.why}
                                      className="text-[10.5px] px-2 py-0.5 rounded-md bg-muted text-foreground/60">
                                  {t.name}
                                </span>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 테마 관련주 찾기 (사업보고서 원문 기반) ────────────────────────────────
//
// 테마주를 찾을 때 보통은 뉴스가 짚어준 한두 종목이 전부다. 우리는 2,700여 종목의
// 사업보고서 본문을 갖고 있으니 **회사가 스스로 그 사업을 한다고 적어놓은 것**을 찾는다.
// "CDMO"로 찾으면 이엔셀(39회)·프레스티지바이오(32회)가 위로 온다 — 언급 횟수가
// 곧 "그 사업이 이 회사에서 얼마나 중심인가"다.

interface ThemeHit {
  ticker: string; name: string | null; marketCap: number | null;
  mentions: number; evidence: string | null; bsnsYear: number;
}

const THEME_PRESETS = ["CDMO", "반도체 클러스터", "HBM", "휴머노이드", "원자력", "전력기기"];

function ThemeStockFinder({ onAnalyze }: { onAnalyze: (ticker: string, name: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ThemeHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  // 뉴스 말로 검색했는데 결과가 적으면 서버가 회사 말로 번역해 다시 찾는다.
  // 무엇으로 찾았는지 보여줘야 결과를 믿을 수 있다.
  const [used, setUsed] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);

  const run = async (keyword: string) => {
    const kw = keyword.trim();
    if (kw.length < 2) return;
    setQ(kw); setLoading(true);
    try {
      const r = await fetch(getApiUrl(`api/events/theme-stocks?q=${encodeURIComponent(kw)}&limit=15`),
                            { credentials: "include" });
      const d = r.ok ? await r.json() : null;
      setHits(Array.isArray(d?.hits) ? d.hits : []);
      setUsed(Array.isArray(d?.keywords) ? d.keywords : []);
      setExpanded(!!d?.expanded);
    } catch { setHits([]); setUsed([]); setExpanded(false); }
    finally { setLoading(false); }
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-indigo-500" />
        <h2 className="text-[14px] font-bold text-foreground">테마 관련주 찾기</h2>
        <span className="text-[10.5px] text-foreground/40">사업보고서 원문 검색</span>
      </div>
      <p className="text-[11.5px] text-foreground/50 leading-relaxed">
        뉴스가 짚어준 종목 말고, <b className="text-foreground/70">회사가 사업보고서에 직접 적어놓은</b> 것으로 찾습니다.
        많이 언급할수록 그 사업이 중심입니다.
      </p>

      <form onSubmit={e => { e.preventDefault(); run(q); }} className="flex gap-2">
        <input
          value={q} onChange={e => setQ(e.target.value)}
          placeholder="예: CDMO, 반도체 클러스터, 광주공항"
          className="flex-1 rounded-xl bg-background/60 border border-border/50 px-3 py-2 text-[12.5px] outline-none focus:border-border"
        />
        <button type="submit" disabled={loading}
                className="px-3.5 py-2 rounded-xl bg-foreground text-background text-[12px] font-semibold disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "찾기"}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {THEME_PRESETS.map(p => (
          <button key={p} onClick={() => run(p)}
                  className="text-[10.5px] px-2 py-1 rounded-lg bg-muted/60 text-foreground/60 hover:bg-muted hover:text-foreground/80 transition">
            {p}
          </button>
        ))}
      </div>

      {expanded && used.length > 1 && (
        <div className="rounded-xl bg-indigo-500/8 border border-indigo-500/20 px-3 py-2">
          <p className="text-[10.5px] text-foreground/60 leading-relaxed">
            <b className="text-indigo-600 dark:text-indigo-300">회사가 쓰는 말로 바꿔 찾았습니다.</b>{" "}
            기사에 쓰는 표현은 사업보고서에 잘 안 나와서요.
          </p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {used.slice(1).map(w => (
              <span key={w} className="text-[10px] px-1.5 py-0.5 rounded-md bg-background/70 text-foreground/60">{w}</span>
            ))}
          </div>
        </div>
      )}

      {hits !== null && (
        hits.length === 0 ? (
          <p className="text-[11.5px] text-foreground/40 py-3 text-center">
            사업보고서에서 이 표현을 쓴 회사를 찾지 못했습니다. 다른 표현으로 시도해보세요.
          </p>
        ) : (
          <div className="space-y-1.5 pt-1">
            {hits.map(h => (
              <button key={h.ticker} onClick={() => onAnalyze(h.ticker, h.name ?? h.ticker)}
                      className="w-full text-left rounded-xl bg-background/60 border border-border/40 px-3 py-2.5 hover:border-border transition">
                <div className="flex items-center gap-2">
                  <span className="text-[12.5px] font-bold text-foreground truncate">{h.name ?? h.ticker}</span>
                  <span className="text-[10px] text-foreground/40">{h.ticker}</span>
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-500/12 text-indigo-600 dark:text-indigo-300 font-semibold shrink-0">
                    {h.mentions}회 언급
                  </span>
                  {h.marketCap != null && (
                    <span className="text-[10px] text-foreground/40 shrink-0">
                      {Math.round(h.marketCap / 1e8).toLocaleString()}억
                    </span>
                  )}
                </div>
                {h.evidence && (
                  <p className="text-[10.5px] text-foreground/50 leading-relaxed mt-1 line-clamp-2">
                    “{h.evidence}”
                  </p>
                )}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ── 내일 오를 것 같은 종목 (통합) ──────────────────────────────────────────
//
// 예전에는 수급·기술·테마 리스트가 **따로따로 3개** 떠서 "그래서 뭘 보라는 거지"가 됐다.
// 세 신호를 한 목록으로 합치고, **다가오는 일정에 걸린 종목에 가산점**을 준다 —
// 재료가 있는 종목이 신호까지 겹치면 그게 가장 앞에 와야 한다.

interface Candidate {
  ticker: string; name: string; market: string;
  score: number;
  reasons: Array<{ label: string; tone: "rose" | "emerald" | "indigo" | "amber" }>;
}

function TomorrowCandidates({ onAnalyze }: { onAnalyze: (ticker: string, name: string) => void }) {
  const [list, setList] = useState<Candidate[] | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const [surge, presurge, tomorrow, events] = await Promise.allSettled([
        fetch(getApiUrl("/api/market/surge"), { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch(getApiUrl("/api/market/presurge"), { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch(getApiUrl("/api/market/tomorrow-picks"), { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch(getApiUrl("api/events/upcoming?days=3"), { credentials: "include" }).then(r => r.ok ? r.json() : null),
      ]);
      if (dead) return;

      const map = new Map<string, Candidate>();
      const add = (
        ticker: string, name: string, market: string,
        pts: number, reason: Candidate["reasons"][number],
      ) => {
        if (!ticker || !name) return;
        const cur = map.get(ticker) ?? { ticker, name, market: market ?? "", score: 0, reasons: [] };
        cur.score += pts;
        if (!cur.reasons.some(r => r.label === reason.label)) cur.reasons.push(reason);
        map.set(ticker, cur);
      };

      // 수급: 기관·외인이 실제로 사고 있다는 신호가 가장 무겁다
      if (surge.status === "fulfilled" && Array.isArray(surge.value?.data)) {
        for (const s of surge.value.data as any[]) {
          const heavy = (s.institution ?? 0) > 0 || (s.foreign ?? 0) > 0;
          add(s.ticker, s.name, s.market, heavy ? 34 : 22,
              { label: heavy ? "기관·외인 매집" : "거래량 급증", tone: "rose" });
        }
      }
      // 기술: 아직 안 올랐지만 형태가 갖춰진 것
      if (presurge.status === "fulfilled" && Array.isArray(presurge.value?.data)) {
        for (const s of presurge.value.data as any[]) {
          add(s.ticker, s.name, s.market, 30, { label: "눌림목·거래량 수축", tone: "emerald" });
        }
      }
      // 테마: 화제성·순환매
      if (tomorrow.status === "fulfilled" && Array.isArray(tomorrow.value?.picks)) {
        for (const p of tomorrow.value.picks as any[]) {
          add(p.ticker, p.name, p.market, 26, { label: "테마·화제성", tone: "indigo" });
        }
      }
      // 일정(재료): 날짜가 정해진 이벤트가 있으면 크게 얹는다 — 오를 '이유'가 있는 것
      if (events.status === "fulfilled" && Array.isArray(events.value?.events)) {
        for (const e of events.value.events as any[]) {
          for (const t of e.tickers ?? []) {
            if (!t?.ticker) continue;
            add(t.ticker, t.name, "", 40, { label: `일정: ${String(e.title).slice(0, 14)}`, tone: "amber" });
          }
        }
      }

      // 신호가 겹칠수록 위로. 같은 점수면 근거가 많은 쪽.
      const ranked = [...map.values()]
        .filter(c => c.reasons.length >= 2 || c.score >= 40)
        .sort((a, b) => b.score - a.score || b.reasons.length - a.reasons.length)
        .slice(0, 12);
      setList(ranked);
    })().catch(() => { if (!dead) setList([]); });
    return () => { dead = true; };
  }, []);

  const TONE: Record<string, string> = {
    rose: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
    emerald: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
    indigo: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  };

  if (list === null) return <div className="h-40 rounded-2xl bg-muted/30 animate-pulse" />;

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-rose-500" />
        <h2 className="text-[14px] font-bold text-foreground">내일 오를 것 같은 종목</h2>
        {list.length > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/12 text-rose-600 dark:text-rose-300">
            {list.length}개
          </span>
        )}
      </div>
      <p className="text-[11.5px] text-foreground/50 leading-relaxed">
        수급·기술·테마 신호에 <b className="text-foreground/70">다가오는 일정</b>을 얹어 한 줄로 세웠습니다.
        근거가 여러 개 겹칠수록 위에 옵니다.
      </p>

      {list.length === 0 ? (
        <p className="text-[11.5px] text-foreground/40 py-4 text-center">
          아직 신호가 겹치는 종목이 없습니다. 장중·장마감 후 갱신됩니다.
        </p>
      ) : (
        <div className="space-y-1.5">
          {list.map((c, i) => (
            <button key={c.ticker} onClick={() => onAnalyze(c.ticker, c.name)}
                    className="w-full text-left rounded-xl bg-background/60 border border-border/40 px-3 py-2.5 hover:border-border transition">
              <div className="flex items-center gap-2.5">
                <span className="shrink-0 w-5 text-[11px] font-black text-foreground/30 tabular-nums">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[13px] font-bold text-foreground truncate">{c.name}</span>
                    <span className="text-[10px] text-foreground/40 shrink-0">{c.ticker}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.reasons.map((r, j) => (
                      <span key={j} className={cn("text-[10px] px-1.5 py-0.5 rounded-md font-medium", TONE[r.tone])}>
                        {r.label}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-foreground/25 shrink-0" />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 테마별 수급 강도 랭킹 ──────────────────────────────────────────────────

function ThemeForceRanking({ feed }: { feed: ThemeFeedItem[] }) {
  const [showLegend, setShowLegend] = useState(false);

  const phaseRank: Record<string, number> = { hot: 4, momentum: 3, emerging: 2, quiet: 1 };
  const ranked = feed
    .map(item => ({ ...item, force: computeThemeForce(item.stocks) }))
    .sort((a, b) => {
      const pr = (phaseRank[b.phase ?? "quiet"] ?? 1) - (phaseRank[a.phase ?? "quiet"] ?? 1);
      if (pr !== 0) return pr;
      return (b.themeSmartMoney ?? 0) - (a.themeSmartMoney ?? 0);
    });

  if (ranked.length === 0) return null;

  const absMax = Math.max(...ranked.map(r => Math.abs(r.force?.avg ?? 0)), 1);

  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-[#FF8A7A] shrink-0" />
        <span className="text-[13px] font-semibold text-foreground">테마별 수급 강도</span>
        <span className="text-[11px] text-foreground/35">돈이 쏠리는 순서</span>
        <button
          onClick={() => setShowLegend(v => !v)}
          className="ml-auto text-foreground/25 hover:text-foreground/60 transition-colors"
          title="기준 설명 보기"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* 범례 */}
      <AnimatePresence>
        {showLegend && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl bg-muted/40 px-3 py-2.5 space-y-1.5 text-[10.5px] text-foreground/60">
              <p className="font-semibold text-foreground/80 mb-1">수급 강도 기준</p>
              <p>해당 테마 종목들의 <span className="text-foreground/80 font-medium">주가변화율 × 거래량비율</span> 합산 점수예요.</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-0.5">
                <span><span className="text-red-500 font-bold">🔥 강세</span> — 돈이 확실히 몰리는 중</span>
                <span><span className="text-orange-500 font-bold">⚡ 상승 중</span> — 수급 유입 중</span>
                <span><span className="text-violet-600 font-bold">📡 수급 형성</span> — 가격 반영 전 스마트머니 유입</span>
                <span><span className="text-foreground/40 font-bold">〰 보합</span> — 방향 없이 유지 중</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="space-y-1.5">
        {ranked.map((item, i) => {
          const force = item.force;
          const meta = phaseMeta(item.phase, force?.avg);
          const barPct = Math.max(2, (Math.abs(force?.avg ?? 0) / absMax) * 100);
          const sm = item.themeSmartMoney;
          return (
            <div key={item.id} className="flex items-center gap-2">
              <span className="text-[10px] text-foreground/25 w-3 text-right shrink-0">{i + 1}</span>
              <span className="text-sm shrink-0 leading-none">{item.emoji}</span>
              <div className="flex-1 min-w-0">
                <span className="text-[11.5px] font-medium text-foreground/75 truncate block">{item.name}</span>
                {item.phase === "emerging" && sm != null && sm > 0 && (
                  <span className="text-[9px] text-violet-500 font-medium">스마트머니 +{sm.toFixed(0)}억 유입</span>
                )}
              </div>
              <div className="w-20 shrink-0 h-2 bg-muted/50 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${barPct}%`, backgroundColor: meta.barColor }}
                />
              </div>
              <span className={cn("text-[10px] font-semibold shrink-0 w-16 text-right", meta.color)}>
                {meta.emoji} {meta.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ThemesPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { mutateAsync: startAnalysis, isPending: isStarting } = useStartAnalysis();

  // 핫 테마 피드
  const [feed, setFeed] = useState<ThemeFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [feedCachedAt, setFeedCachedAt] = useState<string | null>(null);

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

  // 섹션 탭
  const [activeSection, setActiveSection] = useState<"themes" | "picks">("themes");

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
        const raw = await r.json();
        if (cancelled) return;
        const data = Array.isArray(raw) ? raw : (raw.feed ?? []);
        const cachedAt = Array.isArray(raw) ? null : (raw.cachedAt ?? null);
        if (data.length > 0) {
          setFeed(data);
          if (cachedAt) setFeedCachedAt(cachedAt);
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
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* ── 페이지 탭 ──────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveSection("themes")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-all",
            activeSection === "themes"
              ? "bg-[#FF8A7A] text-white shadow-sm"
              : "bg-muted/60 text-muted-foreground/70 hover:bg-muted hover:text-foreground/80",
          )}
        >
          <Lightbulb className="w-3.5 h-3.5" />
          테마 분석
        </button>
        <button
          onClick={() => setActiveSection("picks")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-all",
            activeSection === "picks"
              ? "bg-emerald-500 text-white shadow-sm"
              : "bg-muted/60 text-muted-foreground/70 hover:bg-muted hover:text-foreground/80",
          )}
        >
          <Target className="w-3.5 h-3.5" />
          내일 종목
        </button>
      </div>

      {/* ── 내일 종목 탭 ──────────────────────────────────────────
          블록은 딱 둘. ① 다가오는 일정 = 왜 오를까(재료)  ② 내일 오를 것 같은 종목 = 결론.
          예전엔 수급·기술·테마 리스트가 따로 3개 떠서 "그래서 뭘 보라는 거지"가 됐다.
          '오늘 수급 폭발'·'수급 레이더'는 이미 오른 종목 이야기라 화면에서 뺐다. */}
      {activeSection === "picks" && (
        <div className="space-y-4">
          <UpcomingEvents onAnalyze={goAnalyze} />
          <TomorrowCandidates onAnalyze={goAnalyze} />
        </div>
      )}

      {/* ── 테마 분석 탭 ───────────────────────────────────────── */}
      {activeSection === "themes" && <>

      {/* 테마 관련주 찾기 — 뉴스가 아니라 사업보고서 원문에서 찾는다. 이 탭의 주인공. */}
      <div className="mb-4">
        <ThemeStockFinder onAnalyze={goAnalyze} />
      </div>

      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Flame className="w-5 h-5 text-[#FF8A7A]" />
          <h1 className="text-lg font-semibold text-foreground">핫 테마 피드</h1>
        </div>
        <p className="text-sm text-foreground/55">
          최근 3일 기관·외국인 순매수가 집중된 테마와 관련주를 분석합니다 · 3시간마다 갱신
          {feedCachedAt && (
            <span className="text-foreground/35 ml-1">
              · {new Date(feedCachedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 갱신됨
            </span>
          )}
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
          <ThemeForceRanking feed={feed} />
          {[...feed]
            .sort((a, b) => {
              const fa = computeThemeForce(a.stocks)?.avg ?? -Infinity;
              const fb = computeThemeForce(b.stocks)?.avg ?? -Infinity;
              return fb - fa;
            })
            .map((item, idx) => (
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

      </>}

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

// ── 내일 종목 컴포넌트 ──────────────────────────────────────────────────────

type PickCategory = "laggard" | "volume" | "momentum" | "confluence";

type PickConfidence = "high" | "medium" | "low";

interface TomorrowPick {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  theme: string;
  themeEmoji: string;
  themeHeat: number;
  priceChange: number;
  volumeRatio: number;
  laggardGap: number;
  finalScore: number;
  signals: string[];
  rationale: string;
  category?: PickCategory;
  confidence?: PickConfidence;
  confluenceGroups?: string[];
}

const CATEGORY_META: Record<string, { label: string; dot: string }> = {
  laggard:    { label: "테마 미반영",    dot: "bg-emerald-500" },
  volume:     { label: "거래량 집중",    dot: "bg-violet-500"  },
  momentum:   { label: "상승 모멘텀",   dot: "bg-orange-400"  },
  confluence: { label: "복합 신호",     dot: "bg-rose-500"    },
};

const CONFIDENCE_META: Record<PickConfidence, { label: string; cls: string }> = {
  high:   { label: "고신뢰", cls: "text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20" },
  medium: { label: "보통",   cls: "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20" },
  low:    { label: "참고",   cls: "text-foreground/35 bg-muted/60" },
};

const SIGNAL_STYLE: Record<string, string> = {
  "테마 강세":   "text-red-500",
  "테마 상승":   "text-orange-500",
  "미반영 구간": "text-emerald-600 dark:text-emerald-400",
  "상대 지연":   "text-teal-600 dark:text-teal-400",
  "거래량 급증": "text-violet-600 dark:text-violet-400",
  "거래량 증가": "text-indigo-500",
  "거래량 집중": "text-violet-600 dark:text-violet-400",
  "수급 유입":   "text-blue-500",
  "보합 수급":   "text-sky-500",
  "소폭 상승":   "text-rose-400",
  "하락 후 매집":"text-blue-400",
  "주도주":      "text-amber-500",
  "모멘텀":      "text-orange-500",
};


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
      {(() => {
        const force = computeThemeForce(item.stocks);
        const meta  = phaseMeta(item.phase, force?.avg);
        const isEmerging = item.phase === "emerging";
        const sm = item.themeSmartMoney;
        return (
          <>
            {/* 수급 형성 중 배너 */}
            {isEmerging && (
              <div className="flex items-center gap-2 px-4 py-2 bg-violet-50 dark:bg-violet-900/20 border-b border-violet-100 dark:border-violet-800/30">
                <Radio className="w-3 h-3 text-violet-500 shrink-0" />
                <span className="text-[10.5px] font-bold text-violet-600 dark:text-violet-400">수급 형성 중</span>
                {sm != null && sm > 0 && (
                  <span className="text-[10px] text-violet-500/70 font-medium">
                    스마트머니 +{sm.toFixed(0)}억 유입 — 가격 반영 전
                  </span>
                )}
              </div>
            )}
            <button
              onClick={() => setExpanded(v => !v)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-2xl shrink-0">{item.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{item.name}</p>
                  <span className={cn("text-[10px] font-bold shrink-0", meta.color)}>
                    {meta.emoji} {meta.label}
                  </span>
                </div>
                <p className="text-xs text-foreground/50 truncate mt-0.5">{item.summary}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.stocks.length > 0 && (
                  <span className="text-[11px] text-foreground/35 font-medium">{item.stocks.length}종목</span>
                )}
                <ChevronDown className={cn("w-4 h-4 text-foreground/30 transition-transform duration-200", expanded && "rotate-180")} />
              </div>
            </button>
          </>
        );
      })()}

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
                        {(hasChg || volBurst || stock.smartMoneyAek != null) && (
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
                            {/* 스마트머니 우선 → 없으면 가격/거래량 신호 */}
                            {(() => {
                              const badge = stockSignalBadge(stock);
                              if (!badge) return null;
                              return (
                                <span title={badge.title} className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded cursor-default", badge.cls)}>
                                  {badge.text}
                                </span>
                              );
                            })()}
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
