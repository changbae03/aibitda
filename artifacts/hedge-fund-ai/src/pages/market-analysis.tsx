import React, { useState, useEffect, useCallback, useRef } from "react";
import { getApiUrl } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MarketIndex {
  close?: number;
  change?: number;
  changePercent?: number;
  label?: string;
}

interface MarketEvent {
  title: string;
  impact: "positive" | "negative" | "neutral";
  description?: string;
}

interface SectorTrend {
  sector: string;
  trend: string;
  change?: number;
}

interface FundFlows {
  foreign?: number;
  institution?: number;
  retail?: number;
  foreignLabel?: string;
}

interface MarketBrief {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  keyTopics?: string[];
  marketEvents?: MarketEvent[];
  indices?: Record<string, MarketIndex>;
  sectorTrends?: SectorTrend[];
  fundFlows?: FundFlows;
  macroFactors?: string[];
  forwardLook?: string[];
  actionPoints?: string[];
  sessionType?: string;
  upcomingMacroEvents?: Array<{ date: string; event: string }>;
}

interface SessionSlot {
  slot: string;
  label: string;
  icon: string;
  time: string;
  sessionTypes: string[];
  brief: MarketBrief | null;
  generatedAt: number | null;
  status: "available" | "generating" | "upcoming" | "past";
  isActive: boolean;
  isPast?: boolean;
}

interface SessionsResponse {
  date: string;
  sessions: SessionSlot[];
  currentSession: string;
  currentSlot: string;
  generating: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sentimentConfig(s?: string) {
  switch (s) {
    case "bullish":
      return { label: "상승", bg: "bg-red-500/10 border-red-500/30 text-red-400", dot: "bg-red-400" };
    case "bearish":
      return { label: "하락", bg: "bg-blue-500/10 border-blue-500/30 text-blue-400", dot: "bg-blue-400" };
    case "mixed":
      return { label: "혼조", bg: "bg-amber-500/10 border-amber-500/30 text-amber-400", dot: "bg-amber-400" };
    default:
      return { label: "보합", bg: "bg-zinc-700/50 border-zinc-600 text-zinc-400", dot: "bg-zinc-500" };
  }
}

function changeColor(v?: number) {
  if (v == null) return "text-zinc-500";
  return v > 0 ? "text-red-400" : v < 0 ? "text-blue-400" : "text-zinc-500";
}

function fmtPct(v?: number) {
  if (v == null) return "--";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtAmt(v?: number) {
  if (v == null) return "--";
  const abs = Math.abs(v);
  const billions = Math.round(abs / 100_000_000);
  return `${v >= 0 ? "+" : "-"}${billions.toLocaleString("ko-KR")}억`;
}

const SESSION_ICON: Record<string, string> = {
  sunrise: "🌅",
  chart: "📊",
  sunset: "🔔",
  moon: "🌙",
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  pre_open: "장전", morning: "개장", midday: "장중 1차",
  afternoon: "장중 2차", pre_close: "마감 전", closing: "장마감",
  evening: "야간", weekend: "주말",
  us_premarket: "개장 전", us_open: "개장", us_midday: "장중",
  us_afterhours: "마감 후", us_overnight: "야간",
};

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({ session, selected, onClick }: {
  session: SessionSlot;
  selected: boolean;
  onClick: () => void;
}) {
  const sc = sentimentConfig(session.brief?.sentiment);
  const available = session.status === "available" && session.brief;

  return (
    <button
      onClick={onClick}
      className={`relative text-left w-full rounded-xl border p-4 transition-all duration-150 ${
        selected
          ? "bg-zinc-800 border-zinc-500 shadow-lg shadow-black/40"
          : session.isActive
          ? "bg-zinc-900 border-zinc-700 hover:border-zinc-600"
          : available
          ? "bg-zinc-900/70 border-zinc-800 hover:border-zinc-700"
          : "bg-zinc-900/30 border-zinc-800/50 opacity-60 hover:opacity-80"
      }`}
    >
      {session.isActive && (
        <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}

      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm leading-none">{SESSION_ICON[session.icon] ?? "📋"}</span>
        <span className="text-xs font-semibold text-zinc-200">{session.label}</span>
      </div>
      <div className="text-[10px] font-mono text-zinc-600 mb-3">
        {session.time.includes("+1")
          ? `익일 ${session.time.replace("+1", "")} KST`
          : `${session.time} KST`}
      </div>

      {available ? (
        <>
          <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border mb-2 ${sc.bg}`}>
            <span className={`w-1 h-1 rounded-full ${sc.dot}`} />
            {sc.label}
          </span>
          <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-3">
            {session.brief!.summary}
          </p>
        </>
      ) : session.status === "generating" ? (
        <div className="space-y-1.5 mt-1">
          <div className="h-1.5 rounded bg-zinc-700 animate-pulse" />
          <div className="h-1.5 rounded bg-zinc-700/70 animate-pulse w-4/5" />
          <div className="h-1.5 rounded bg-zinc-700/50 animate-pulse w-3/5" />
          <p className="text-[10px] text-amber-400 mt-2">생성 중…</p>
        </div>
      ) : session.status === "past" ? (
        <p className="text-[11px] text-zinc-700 mt-1">브리핑 없음</p>
      ) : (
        <p className="text-[11px] text-zinc-600 mt-1">예정됨</p>
      )}
    </button>
  );
}

// ─── Index Grid ───────────────────────────────────────────────────────────────

function IndexGrid({ indices }: { indices: Record<string, MarketIndex> }) {
  const entries = Object.entries(indices).filter(([, v]) => v.changePercent != null || v.close != null);
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {entries.map(([name, v]) => (
        <div key={name} className="bg-zinc-800/80 rounded-lg px-3 py-2.5">
          <p className="text-[10px] text-zinc-500 mb-0.5 truncate">{v.label ?? name}</p>
          {v.close != null && (
            <p className="text-sm font-semibold text-zinc-200 tabular-nums">
              {v.close.toLocaleString("ko-KR")}
            </p>
          )}
          {v.changePercent != null && (
            <p className={`text-xs font-medium tabular-nums ${changeColor(v.changePercent)}`}>
              {fmtPct(v.changePercent)}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SL({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{children}</h3>
  );
}

// ─── Brief detail ─────────────────────────────────────────────────────────────

function BriefDetail({ session }: { session: SessionSlot }) {
  const brief = session.brief;

  if (session.status === "generating") {
    return (
      <div className="py-12 text-center space-y-3">
        <div className="inline-flex items-center gap-2 text-amber-400">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-sm font-medium">브리핑 생성 중</span>
        </div>
        <p className="text-xs text-zinc-500">AI가 현재 시장 데이터를 분석하고 있습니다</p>
        <div className="max-w-sm mx-auto space-y-2 mt-6">
          {[1, 0.7, 0.5].map((op, i) => (
            <div key={i} className="h-2.5 rounded bg-zinc-800 animate-pulse" style={{ opacity: op }} />
          ))}
        </div>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-zinc-500">
          {session.label} 브리핑은{" "}
          <span className="text-zinc-300 font-medium">{session.time} KST</span> 이후 자동 생성됩니다
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-200 leading-relaxed">{brief.summary}</p>

      {brief.indices && <IndexGrid indices={brief.indices} />}

      {brief.keyTopics && brief.keyTopics.length > 0 && (
        <div>
          <SL>주요 테마</SL>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {brief.keyTopics.map((t, i) => {
              const label = typeof t === "string" ? t : JSON.stringify(t);
              return (
                <span key={`${label}-${i}`} className="text-xs px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300">
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {brief.marketEvents && brief.marketEvents.length > 0 && (
        <div>
          <SL>시장 이슈</SL>
          <div className="mt-2 space-y-3">
            {brief.marketEvents.map((e, i) => (
              <div key={i} className="flex gap-3">
                <span className={`mt-0.5 flex-shrink-0 text-sm font-bold ${
                  e.impact === "positive" ? "text-red-500" :
                  e.impact === "negative" ? "text-blue-500" : "text-zinc-600"
                }`}>
                  {e.impact === "positive" ? "▲" : e.impact === "negative" ? "▼" : "●"}
                </span>
                <div>
                  <p className="text-sm text-zinc-100 font-medium leading-snug">{e.title}</p>
                  {e.description && (
                    <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{e.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {brief.fundFlows && (
        <div>
          <SL>수급 동향</SL>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {[
              { label: brief.fundFlows.foreignLabel ?? "외국인", val: brief.fundFlows.foreign },
              { label: "기관", val: brief.fundFlows.institution },
              { label: "개인", val: brief.fundFlows.retail },
            ].map(({ label, val }) => (
              <div key={label} className="bg-zinc-800/80 rounded-lg px-3 py-2.5 text-center">
                <p className="text-[10px] text-zinc-500 mb-1">{label}</p>
                <p className={`text-sm font-semibold tabular-nums ${changeColor(val)}`}>
                  {fmtAmt(val)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {brief.sectorTrends && brief.sectorTrends.length > 0 && (
        <div>
          <SL>섹터 동향</SL>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {brief.sectorTrends.map((s) => (
              <div key={s.sector} className="flex items-center justify-between bg-zinc-800/60 rounded-lg px-3 py-2">
                <span className="text-xs text-zinc-300 truncate">{s.sector}</span>
                <span className={`text-xs font-medium ml-2 flex-shrink-0 ${
                  (s.change ?? 0) > 0 || s.trend === "상승" || s.trend === "강세" ? "text-red-400" :
                  (s.change ?? 0) < 0 || s.trend === "하락" || s.trend === "약세" ? "text-blue-400" : "text-zinc-500"
                }`}>
                  {s.change != null ? fmtPct(s.change) : s.trend}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {brief.macroFactors && brief.macroFactors.length > 0 && (
        <div>
          <SL>거시 환경</SL>
          <ul className="mt-2 space-y-1.5">
            {brief.macroFactors.map((f, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-400">
                <span className="text-zinc-600 flex-shrink-0 mt-0.5">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.forwardLook && brief.forwardLook.length > 0 && (
        <div>
          <SL>향후 전망</SL>
          <ul className="mt-2 space-y-1.5">
            {brief.forwardLook.map((f, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-400">
                <span className="text-zinc-600 flex-shrink-0 mt-0.5">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.actionPoints && brief.actionPoints.length > 0 && (
        <div>
          <SL>투자 포인트</SL>
          <ul className="mt-2 space-y-1.5">
            {brief.actionPoints.map((a, i) => (
              <li key={i} className="flex gap-2 text-xs text-zinc-300">
                <span className="text-amber-500 flex-shrink-0 mt-0.5 font-bold">→</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.upcomingMacroEvents && brief.upcomingMacroEvents.length > 0 && (
        <div>
          <SL>주요 일정</SL>
          <div className="mt-2 space-y-1.5">
            {brief.upcomingMacroEvents.map((ev, i) => (
              <div key={i} className="flex gap-3 text-xs">
                <span className="text-zinc-500 font-mono flex-shrink-0 w-20">{ev.date}</span>
                <span className="text-zinc-300">{ev.event}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── History Item ─────────────────────────────────────────────────────────────

function HistoryItem({ item }: { item: any }) {
  const [open, setOpen] = useState(false);
  const timeStr = new Date(item.generatedAt).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const sc = sentimentConfig(item.sentiment);
  const sessionLabel = SESSION_TYPE_LABEL[item.sessionType] ?? item.sessionType ?? "브리핑";

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
          <span className="text-xs text-zinc-300 flex-shrink-0">{sessionLabel}</span>
          {item.summary && (
            <span className="text-xs text-zinc-600 hidden sm:inline truncate">
              — {item.summary.slice(0, 60)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-[10px] text-zinc-600">{timeStr}</span>
          <span className={`text-zinc-600 text-xs transition-transform duration-200 ${open ? "rotate-180" : ""}`}>▾</span>
        </div>
      </button>

      {open && item.data && (
        <div className="px-4 pb-4 border-t border-zinc-800 pt-4">
          <BriefDetail
            session={{
              slot: item.sessionType,
              label: sessionLabel,
              icon: "chart",
              time: "--",
              sessionTypes: [item.sessionType],
              brief: item.data,
              generatedAt: new Date(item.generatedAt).getTime(),
              status: "available",
              isActive: false,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketAnalysisPage() {
  const [market, setMarket] = useState<"kr" | "us">("kr");
  const [sessionsData, setSessionsData] = useState<SessionsResponse | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const prevMarket = useRef(market);

  const fetchSessions = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/api/market-analysis/sessions?market=${market}`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionsResponse = await res.json();
      setSessionsData(data);
      setError(null);

      setSelectedSlot((prev) => {
        if (prev && data.sessions.find((s) => s.slot === prev)?.brief) return prev;
        const latest = [...data.sessions].reverse().find((s) => s.brief);
        return latest?.slot ?? data.currentSlot ?? data.sessions[0]?.slot ?? null;
      });
    } catch {
      setError("시장 브리핑을 불러오지 못했습니다.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [market]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(
        getApiUrl(`/api/market-analysis/brief-history?market=${market}&limit=8`),
        { credentials: "include" },
      );
      if (!res.ok) return;
      setHistory(await res.json());
    } catch { /* ignore */ } finally {
      setHistoryLoading(false);
    }
  }, [market]);

  useEffect(() => {
    if (prevMarket.current !== market) {
      setSessionsData(null);
      setSelectedSlot(null);
      setHistory([]);
      setHistoryOpen(false);
      prevMarket.current = market;
    }
    fetchSessions();
    fetchHistory();
  }, [market]);

  // Silent refresh every 3 minutes
  useEffect(() => {
    const id = setInterval(() => fetchSessions(true), 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchSessions]);

  const sessions = sessionsData?.sessions ?? [];
  const selectedSession = sessions.find((s) => s.slot === selectedSlot);
  const sc = sentimentConfig(selectedSession?.brief?.sentiment);

  const dateLabel = sessionsData?.date
    ? new Date(sessionsData.date + "T00:00:00+09:00").toLocaleDateString("ko-KR", {
        year: "numeric", month: "long", day: "numeric", weekday: "short",
      })
    : "";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <div className="sticky top-0 z-20 bg-zinc-950/90 backdrop-blur border-b border-zinc-800">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-sm font-bold text-zinc-100 flex-shrink-0">시장 분석</h1>
            {dateLabel && (
              <span className="text-xs text-zinc-500 hidden sm:inline truncate">{dateLabel}</span>
            )}
            {sessionsData?.generating && (
              <span className="hidden sm:flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20 flex-shrink-0">
                <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                생성 중
              </span>
            )}
          </div>

          <div className="flex items-center bg-zinc-900 rounded-lg border border-zinc-800 p-0.5 flex-shrink-0">
            {(["kr", "us"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  market === m
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {m === "kr" ? "🇰🇷 한국" : "🇺🇸 미국"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Session Timeline */}
        <section>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600 mb-3">
            오늘의 시장 흐름
          </p>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-36 rounded-xl bg-zinc-800/50 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-zinc-800 p-8 text-center space-y-3">
              <p className="text-sm text-zinc-500">{error}</p>
              <button
                onClick={() => fetchSessions()}
                className="text-xs text-zinc-400 hover:text-zinc-200 underline"
              >
                다시 시도
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {sessions.map((session) => (
                <SessionCard
                  key={session.slot}
                  session={session}
                  selected={selectedSlot === session.slot}
                  onClick={() => setSelectedSlot(session.slot)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Selected Brief Detail */}
        {selectedSession && !loading && (
          <section className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-base flex-shrink-0">{SESSION_ICON[selectedSession.icon] ?? "📋"}</span>
                <span className="font-semibold text-sm text-zinc-100 flex-shrink-0">{selectedSession.label}</span>
                <span className="text-xs text-zinc-600 font-mono flex-shrink-0">{selectedSession.time}</span>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {selectedSession.generatedAt && (
                  <span className="text-[10px] text-zinc-600 hidden sm:inline">
                    {new Date(selectedSession.generatedAt).toLocaleTimeString("ko-KR", {
                      hour: "2-digit", minute: "2-digit",
                    })} 생성
                  </span>
                )}
                {selectedSession.brief?.sentiment && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${sc.bg}`}>
                    {sc.label}
                  </span>
                )}
              </div>
            </div>

            <div className="p-5">
              <BriefDetail session={selectedSession} />
            </div>
          </section>
        )}

        {/* History */}
        <section>
          <button
            onClick={() => {
              if (!historyOpen && history.length === 0) fetchHistory();
              setHistoryOpen((o) => !o);
            }}
            className="flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1"
          >
            <span className={`transition-transform duration-200 text-[10px] ${historyOpen ? "rotate-90" : ""}`}>▶</span>
            지난 브리핑
          </button>

          {historyOpen && (
            <div className="mt-3 space-y-2">
              {historyLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-12 rounded-xl bg-zinc-800/50 animate-pulse" />
                  ))}
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-zinc-600 py-3">저장된 브리핑이 없습니다</p>
              ) : (
                history.map((item, i) => <HistoryItem key={i} item={item} />)
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
