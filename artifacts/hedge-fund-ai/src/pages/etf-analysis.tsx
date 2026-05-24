import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  Search, TrendingUp, TrendingDown, Loader2, RefreshCw,
  BarChart3, Zap, LayoutGrid, ChevronRight, Info,
  Building2, Globe, ArrowUpDown,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

// ─── 타입 ─────────────────────────────────────────────────────────────────────

interface ETFInfo {
  code: string; isuCd: string; name: string; sector: string;
  issuer: string; yahooCode: string; leverage: number; ter?: number; benchmark?: string;
}
interface ETFHolding {
  rank: number; stockCode: string; stockName: string; weight: number;
}
interface SectorScore {
  sector: string; score: number; return5d: number; return20d: number;
  signal: string; etfCode: string; etfName: string; price?: number; change1d?: number;
}
interface TimingSignal {
  code: string; name: string; price: number; change1d: number;
  return5d: number; return20d: number; ma5: number; ma20: number;
  rsi14: number; signal: string; signalScore: number; reason: string;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const SIGNAL_CONFIG = {
  strong_buy:  { label: "강력 매수", color: "#16a34a", bg: "bg-emerald-500/15", border: "border-emerald-500/30", text: "text-emerald-500" },
  buy:         { label: "매수",     color: "#22c55e", bg: "bg-green-500/10",    border: "border-green-500/25",   text: "text-green-500"  },
  hold:        { label: "관망",     color: "#94a3b8", bg: "bg-slate-500/10",    border: "border-slate-500/20",   text: "text-slate-400"  },
  sell:        { label: "매도",     color: "#ef4444", bg: "bg-red-500/10",      border: "border-red-500/25",     text: "text-red-400"    },
  strong_sell: { label: "강력 매도", color: "#dc2626", bg: "bg-red-500/15",     border: "border-red-500/30",     text: "text-red-500"    },
};

const PIE_COLORS = ["#FF8A7A","#3b82f6","#22c55e","#f59e0b","#8b5cf6","#06b6d4","#f97316","#10b981","#6366f1","#ec4899","#84cc16","#14b8a6"];

const SECTOR_COLORS: Record<string, string> = {
  "국내주식": "#3b82f6", "코스닥": "#8b5cf6", "반도체": "#f59e0b",
  "2차전지":  "#22c55e", "헬스케어":"#ec4899", "금융": "#06b6d4",
  "IT":       "#f97316", "해외주식": "#6366f1", "배당": "#10b981",
};

// ─── 유틸 컴포넌트 ────────────────────────────────────────────────────────────

function Pct({ v, bold }: { v: number; bold?: boolean }) {
  const up = v >= 0;
  return (
    <span className={cn(
      bold ? "font-bold" : "font-medium",
      up ? "text-red-500" : "text-blue-500",
    )}>
      {up ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}

function SignalBadge({ signal }: { signal: string }) {
  const cfg = SIGNAL_CONFIG[signal as keyof typeof SIGNAL_CONFIG] ?? SIGNAL_CONFIG.hold;
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border",
      cfg.bg, cfg.border, cfg.text,
    )}>
      {cfg.label}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "#16a34a" : score >= 55 ? "#22c55e" : score >= 40 ? "#94a3b8" : score >= 25 ? "#f97316" : "#dc2626";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold w-6 text-right" style={{ color }}>{score}</span>
    </div>
  );
}

function LeverageBadge({ lev }: { lev: number }) {
  if (lev === 1) return null;
  return (
    <span className={cn(
      "text-[10px] font-bold px-1.5 py-0.5 rounded border",
      lev === 2 ? "bg-orange-500/10 border-orange-500/30 text-orange-500" : "bg-blue-500/10 border-blue-500/30 text-blue-500",
    )}>
      {lev === 2 ? "2×" : "인버스"}
    </span>
  );
}

// ─── 탭 1: 검색 ───────────────────────────────────────────────────────────────

function SearchTab() {
  const [mode, setMode]           = useState<"etf" | "stock">("etf");
  const [query, setQuery]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [etfResult, setEtfResult] = useState<{ etf: ETFInfo | null; holdings: ETFHolding[] } | null>(null);
  const [stockResult, setStockResult] = useState<{ etf: ETFInfo; holding: ETFHolding }[] | null>(null);
  const [searchList, setSearchList]   = useState<ETFInfo[]>([]);
  const [showList, setShowList]       = useState(false);
  const [allEtfs, setAllEtfs]         = useState<ETFInfo[]>([]);

  useEffect(() => {
    fetch(getApiUrl("/api/etf/list"), { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => setAllEtfs(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setShowList(false);
    try {
      if (mode === "etf") {
        const r = await fetch(getApiUrl(`/api/etf/${encodeURIComponent(q.trim())}/holdings`), { credentials: "include" });
        if (r.ok) setEtfResult(await r.json());
      } else {
        const r = await fetch(getApiUrl(`/api/etf/stock/${encodeURIComponent(q.trim())}/exposure`), { credentials: "include" });
        if (r.ok) setStockResult(await r.json());
      }
    } finally {
      setLoading(false);
    }
  }, [mode]);

  const onInput = (v: string) => {
    setQuery(v);
    if (mode === "etf" && v.trim()) {
      const filtered = allEtfs.filter(e =>
        e.name.toLowerCase().includes(v.toLowerCase()) || e.code.includes(v)
      );
      setSearchList(filtered.slice(0, 8));
      setShowList(true);
    } else {
      setShowList(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 모드 토글 */}
      <div className="flex gap-2">
        {(["etf","stock"] as const).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); setQuery(""); setEtfResult(null); setStockResult(null); setShowList(false); }}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border",
              mode === m
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50",
            )}
          >
            {m === "etf" ? "🏦 ETF 검색 → 구성 종목" : "🔍 종목 검색 → ETF 노출도"}
          </button>
        ))}
      </div>

      {/* 검색창 */}
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
            <input
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={mode === "etf" ? "069500, KODEX 200, 반도체..." : "005930, 삼성전자, SK하이닉스..."}
              value={query}
              onChange={e => onInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch(query)}
              onBlur={() => setTimeout(() => setShowList(false), 150)}
            />
            {/* 자동완성 드롭다운 */}
            {showList && searchList.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-xl z-20 overflow-hidden">
                {searchList.map(etf => (
                  <button
                    key={etf.code}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/40 text-left transition-colors"
                    onMouseDown={() => { setQuery(etf.code); setShowList(false); handleSearch(etf.code); }}
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{etf.name}</p>
                      <p className="text-[11px] text-muted-foreground">{etf.code} · {etf.issuer}</p>
                    </div>
                    <LeverageBadge lev={etf.leverage} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => handleSearch(query)}
            disabled={loading || !query.trim()}
            className="px-5 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 transition-all hover:opacity-90"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "검색"}
          </button>
        </div>
      </div>

      {/* ETF 결과: 구성 종목 */}
      {mode === "etf" && etfResult && (
        <div className="space-y-4">
          {etfResult.etf && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-base font-bold text-foreground">{etfResult.etf.name}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {etfResult.etf.code} · {etfResult.etf.issuer} · {etfResult.etf.benchmark}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <LeverageBadge lev={etfResult.etf.leverage} />
                  {etfResult.etf.ter != null && (
                    <span className="text-[11px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full border border-border">
                      총보수 {etfResult.etf.ter}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {etfResult.holdings.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 도넛 차트 */}
              <div className="rounded-2xl border border-border bg-card p-4">
                <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-3">구성 비중</p>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={[
                        ...etfResult.holdings.slice(0, 9),
                        etfResult.holdings.length > 9
                          ? { stockName: "기타", weight: 100 - etfResult.holdings.slice(0, 9).reduce((s, h) => s + h.weight, 0) }
                          : null,
                      ].filter(Boolean) as any}
                      dataKey="weight" nameKey="stockName"
                      cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                      paddingAngle={2}
                    >
                      {etfResult.holdings.slice(0, 10).map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* 테이블 */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest">Top {etfResult.holdings.length} 보유 종목</p>
                </div>
                <div className="divide-y divide-border/50">
                  {etfResult.holdings.map(h => (
                    <div key={h.rank} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-muted-foreground/40 w-4 text-right">{h.rank}</span>
                        <div>
                          <p className="text-sm font-medium text-foreground">{h.stockName}</p>
                          <p className="text-[11px] text-muted-foreground/50">{h.stockCode}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-24 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.min(100, h.weight * 2.5)}%` }}
                          />
                        </div>
                        <span className="text-sm font-bold text-foreground w-12 text-right">{h.weight.toFixed(2)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-2.5 bg-muted/10 border-t border-border">
                  <p className="text-[10px] text-muted-foreground/40">* 운용사 공시 기준, 실제 비중과 차이가 있을 수 있습니다</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              구성 종목 데이터를 불러올 수 없습니다
            </div>
          )}
        </div>
      )}

      {/* 종목 결과: ETF 노출도 */}
      {mode === "stock" && stockResult && (
        <div className="space-y-3">
          {stockResult.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              해당 종목을 담고 있는 ETF를 찾지 못했습니다
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground px-1">
                <span className="font-semibold text-foreground">{stockResult[0]?.holding.stockName}</span>을 담고 있는 ETF {stockResult.length}개
              </p>
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest">ETF 편입 현황</p>
                </div>
                {/* 바 차트 */}
                <div className="px-4 pt-4 pb-2">
                  <ResponsiveContainer width="100%" height={stockResult.length * 36 + 20}>
                    <BarChart
                      layout="vertical"
                      data={stockResult.map(r => ({ name: r.etf.name, weight: r.holding.weight, sector: r.etf.sector }))}
                      margin={{ left: 10, right: 40 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" />
                      <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}%`, "편입 비중"]} />
                      <Bar dataKey="weight" radius={[0, 4, 4, 0]}>
                        {stockResult.map((r, i) => (
                          <Cell key={i} fill={SECTOR_COLORS[r.etf.sector] ?? "#94a3b8"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="divide-y divide-border/50">
                  {stockResult.map(r => (
                    <div key={r.etf.code} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-foreground">{r.etf.name}</p>
                        <p className="text-[11px] text-muted-foreground/50">{r.etf.code} · {r.etf.issuer}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-foreground">{r.holding.weight.toFixed(2)}%</p>
                        <p className="text-[11px] text-muted-foreground/40">#{r.holding.rank}위</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* 빠른 ETF 버튼 */}
      {!etfResult && !stockResult && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground/50 font-medium px-1">인기 ETF</p>
          <div className="flex flex-wrap gap-2">
            {["069500","091160","305720","143460","133690","229200","122630","379800"].map(code => {
              const etf = allEtfs.find(e => e.code === code);
              if (!etf) return null;
              return (
                <button
                  key={code}
                  onClick={() => { setMode("etf"); setQuery(code); handleSearch(code); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted/30 border border-border text-xs font-medium hover:bg-muted/50 transition-colors"
                >
                  {etf.name} <LeverageBadge lev={etf.leverage} />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 탭 2: 섹터 로테이션 ─────────────────────────────────────────────────────

function SectorRotationTab() {
  const [data, setData]     = useState<SectorScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshed, setRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/etf/sector-rotation"), { credentials: "include" });
      if (r.ok) { setData(await r.json()); setRefreshed(new Date()); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const top3    = data.slice(0, 3);
  const bottom3 = data.slice(-3).reverse();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">섹터 로테이션 레이더</h2>
          <p className="text-xs text-muted-foreground mt-0.5">5일·20일 모멘텀 기반 섹터 강도 스코어 (0~100)</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          {refreshed && <span>{refreshed.getHours()}:{String(refreshed.getMinutes()).padStart(2,"0")}</span>}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          데이터를 불러오는 중입니다...
        </div>
      ) : (
        <>
          {/* 상위/하위 요약 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
              <p className="text-[11px] font-bold text-emerald-500/70 uppercase tracking-widest">🚀 강한 섹터</p>
              {top3.map(s => (
                <div key={s.sector} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: SECTOR_COLORS[s.sector] ?? "#94a3b8" }} />
                    <span className="text-sm font-medium text-foreground">{s.sector}</span>
                  </div>
                  <Pct v={s.return5d} />
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-4 space-y-2">
              <p className="text-[11px] font-bold text-red-400/70 uppercase tracking-widest">📉 약한 섹터</p>
              {bottom3.map(s => (
                <div key={s.sector} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: SECTOR_COLORS[s.sector] ?? "#94a3b8" }} />
                    <span className="text-sm font-medium text-foreground">{s.sector}</span>
                  </div>
                  <Pct v={s.return5d} />
                </div>
              ))}
            </div>
          </div>

          {/* 가로 바 차트 */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-4">섹터별 모멘텀 스코어</p>
            <ResponsiveContainer width="100%" height={data.length * 44 + 20}>
              <BarChart
                layout="vertical"
                data={data.map(s => ({
                  sector: s.sector, score: s.score, etfName: s.etfName,
                  ret5d: s.return5d, ret20d: s.return20d,
                }))}
                margin={{ left: 10, right: 50, top: 4, bottom: 4 }}
              >
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="sector" tick={{ fontSize: 12 }} width={60} />
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.08)" />
                <Tooltip
                  formatter={(_v: any, _n: any, props: any) => [
                    `${props.payload.score}점 | 5일 ${props.payload.ret5d >= 0 ? "+" : ""}${props.payload.ret5d}% | 20일 ${props.payload.ret20d >= 0 ? "+" : ""}${props.payload.ret20d}%`,
                    props.payload.etfName,
                  ]}
                />
                <Bar dataKey="score" radius={[0, 6, 6, 0]} maxBarSize={26}>
                  {data.map((s, i) => (
                    <Cell key={i} fill={SECTOR_COLORS[s.sector] ?? "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 상세 테이블 */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border grid grid-cols-5 text-[11px] font-bold text-muted-foreground/40 uppercase tracking-wider">
              <span className="col-span-2">섹터 / ETF</span>
              <span className="text-right">5일</span>
              <span className="text-right">20일</span>
              <span className="text-right">스코어</span>
            </div>
            <div className="divide-y divide-border/50">
              {data.map(s => (
                <div key={s.sector} className="px-4 py-3 grid grid-cols-5 items-center gap-2">
                  <div className="col-span-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: SECTOR_COLORS[s.sector] ?? "#94a3b8" }} />
                      <div>
                        <p className="text-sm font-semibold text-foreground">{s.sector}</p>
                        <p className="text-[11px] text-muted-foreground/50 truncate">{s.etfName}</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-right"><Pct v={s.return5d} /></div>
                  <div className="text-right"><Pct v={s.return20d} /></div>
                  <div className="text-right">
                    <div className="space-y-0.5">
                      <SignalBadge signal={s.signal} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 탭 3: 타이밍 신호 ───────────────────────────────────────────────────────

function TimingSignalsTab() {
  const [data, setData]     = useState<TimingSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshed, setRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/etf/timing-signals"), { credentials: "include" });
      if (r.ok) { setData(await r.json()); setRefreshed(new Date()); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground">ETF 타이밍 신호</h2>
          <p className="text-xs text-muted-foreground mt-0.5">MA, 모멘텀, RSI 기반 기술적 신호 — 참고용</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          {refreshed && <span>{refreshed.getHours()}:{String(refreshed.getMinutes()).padStart(2,"0")}</span>}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {data.map(s => {
            const cfg = SIGNAL_CONFIG[s.signal as keyof typeof SIGNAL_CONFIG] ?? SIGNAL_CONFIG.hold;
            return (
              <div key={s.code} className={cn(
                "rounded-2xl border bg-card p-4 transition-all",
                cfg.border.replace("border-", "border-"),
              )}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-foreground">{s.name}</h3>
                      <span className="text-[11px] text-muted-foreground/50">{s.code}</span>
                    </div>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-lg font-bold text-foreground">{s.price.toLocaleString()}</span>
                      <Pct v={s.change1d} />
                    </div>
                    <p className="text-[11px] text-muted-foreground/60 mt-1.5 leading-relaxed">{s.reason}</p>
                  </div>
                  <div className="text-right space-y-1 shrink-0">
                    <SignalBadge signal={s.signal} />
                    <div className="w-24">
                      <ScoreBar score={s.signalScore} />
                    </div>
                  </div>
                </div>

                {/* 지표 그리드 */}
                <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-border/50">
                  {[
                    { label: "5일 수익", value: <Pct v={s.return5d} /> },
                    { label: "20일 수익", value: <Pct v={s.return20d} /> },
                    { label: "RSI(14)", value: (
                      <span className={cn(
                        "font-bold",
                        s.rsi14 > 70 ? "text-red-400" : s.rsi14 < 30 ? "text-emerald-400" : "text-foreground",
                      )}>
                        {s.rsi14}
                      </span>
                    )},
                    { label: "MA5/MA20", value: (
                      <span className={cn(
                        "font-bold text-xs",
                        s.ma5 > s.ma20 ? "text-red-400" : "text-blue-400",
                      )}>
                        {s.ma5 > s.ma20 ? "골든" : "데드"}
                      </span>
                    )},
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center">
                      <p className="text-[10px] text-muted-foreground/40 mb-0.5">{label}</p>
                      <p className="text-sm">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 면책 고지 */}
      <div className="flex items-start gap-2 text-[11px] text-muted-foreground/50 bg-muted/20 rounded-xl px-3 py-2.5 border border-border/50">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <p>타이밍 신호는 기술적 분석 기반 참고 지표로, 투자 결정의 유일한 근거로 사용하지 마세요. 실제 투자 손실에 대해 애빛다는 책임지지 않습니다.</p>
      </div>
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

type Tab = "search" | "sector" | "timing";

export default function ETFAnalysis() {
  const { isEn }    = useLanguage();
  const [tab, setTab] = useState<Tab>("search");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "search", label: "ETF / 종목 검색", icon: <Search className="w-4 h-4" /> },
    { id: "sector", label: "섹터 로테이션",   icon: <ArrowUpDown className="w-4 h-4" /> },
    { id: "timing", label: "타이밍 신호",      icon: <Zap className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5 pb-20">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">
          ETF 분석
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          국내·해외 주요 ETF 구성 종목 · 섹터 모멘텀 · AI 타이밍 신호
        </p>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 p-1 rounded-2xl bg-muted/30 border border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all",
              tab === t.id
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon}
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {tab === "search" && <SearchTab />}
      {tab === "sector" && <SectorRotationTab />}
      {tab === "timing" && <TimingSignalsTab />}
    </div>
  );
}
