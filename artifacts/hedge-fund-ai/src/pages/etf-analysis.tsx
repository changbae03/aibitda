import { useState, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, Legend,
} from "recharts";
import {
  Search, TrendingUp, TrendingDown, Loader2, RefreshCw,
  BarChart3, Zap, LayoutGrid, ChevronRight, Info,
  Building2, Globe, ArrowUpDown, Brain, Sparkles,
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
interface UnifiedSignal {
  code: string; name: string; sector: string; issuer: string; leverage: number;
  price: number; change1d: number; return5d: number; return20d: number;
  rsi14: number; ma5: number; ma20: number;
  techScore: number; sectorRank: number; aiScore: number; aiBonus: number;
  combinedScore: number; signal: string;
  aiDirection: "up" | "down" | "neutral"; aiStrength: number; reason: string;
}
interface AiContext {
  kospi: { direction: "up" | "down" | "neutral"; strength: number };
  nasdaq: { direction: "up" | "down" | "neutral"; strength: number };
  ready: boolean;
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
  "원자재":   "#d97706",
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

/** 펼치고 접는 개념 설명 박스 */
function HelpTip({ label = "💡 이게 뭔가요?", children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11px] text-primary/70 hover:text-primary transition-colors font-medium"
      >
        <span>{label}</span>
        <ChevronRight className={cn("w-3 h-3 transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="mt-2 rounded-xl bg-primary/5 border border-primary/15 px-4 py-3 text-[12px] text-muted-foreground leading-relaxed space-y-1.5">
          {children}
        </div>
      )}
    </div>
  );
}

/** ETF 섹터별 한 줄 해설 */
function etfDescription(etf: ETFInfo): string {
  const leverageNote = etf.leverage === 2
    ? " ⚠️ 2배 레버리지 상품으로, 수익과 손실 모두 2배로 증폭됩니다."
    : etf.leverage === -1
    ? " ⚠️ 인버스 상품으로, 지수가 하락할 때 수익이 납니다."
    : "";
  const base: Record<string, string> = {
    "국내주식":  "코스피200 대형주 전반에 분산 투자하는 ETF입니다. 한국 경제 전체에 베팅하는 가장 기본적인 선택으로, 시장 전반이 오를 때 수익을 냅니다.",
    "코스닥":   "코스닥 중소·성장주 중심 ETF입니다. 변동성이 높지만 성장 잠재력도 큰 기업들로 구성되어, 위험을 감수할 수 있는 투자자에게 적합합니다.",
    "반도체":   "삼성전자·SK하이닉스 등 반도체 기업에 집중 투자합니다. AI·데이터센터 수요와 글로벌 반도체 경기 사이클에 민감하게 반응합니다.",
    "2차전지":  "배터리 셀·소재·장비 기업들로 구성됩니다. 전기차(EV) 전환 속도, 리튬 등 핵심 광물 가격에 따라 크게 움직입니다.",
    "헬스케어": "바이오·제약·의료기기 기업들을 담습니다. 임상 결과 발표, 신약 허가 여부에 따라 급등락이 잦은 고위험·고수익 섹터입니다.",
    "금융":     "은행·보험·증권주 중심 ETF입니다. 기준금리 방향에 가장 민감한 섹터로, 금리가 오를수록 수혜를 받는 경향이 있습니다.",
    "IT":       "소프트웨어·IT서비스·게임 기업들을 포함합니다. 플랫폼·디지털 전환 테마와 함께 움직이며, 기술주 심리에 영향을 받습니다.",
    "해외주식": "미국 S&P500 등 글로벌 우량 기업에 투자합니다. 달러 강약에 따른 환율 효과도 함께 반영됩니다.",
    "배당":     "고배당 우량주 중심으로 안정적인 현금흐름을 추구합니다. 변동성이 낮아 보수적인 투자자나 인컴 전략에 적합합니다.",
    "원자재":   "금·원유·농산물 선물 가격을 추종합니다. 인플레이션 헷지나 포트폴리오 분산 목적으로 활용됩니다.",
  };
  return (base[etf.sector] ?? "다양한 자산에 분산 투자하는 ETF입니다.") + leverageNote;
}

/** 보유 종목 집중도 해설 */
function holdingConcentration(holdings: ETFHolding[]): { text: string; level: "high" | "mid" | "low" } {
  const top3 = holdings.slice(0, 3).reduce((s, h) => s + h.weight, 0);
  if (top3 > 65) return {
    level: "high",
    text: `상위 3개 종목이 전체의 ${top3.toFixed(0)}%를 차지하는 고집중형 ETF입니다. 특정 종목의 주가 변동이 ETF 성과에 크게 영향을 줍니다.`,
  };
  if (top3 > 45) return {
    level: "mid",
    text: `상위 3개 종목 비중이 ${top3.toFixed(0)}%로, 핵심 종목에 어느 정도 집중된 구조입니다. 개별 종목 리스크와 분산 효과가 공존합니다.`,
  };
  return {
    level: "low",
    text: `상위 3개 종목 비중이 ${top3.toFixed(0)}%로, 비교적 균형 있게 분산된 포트폴리오입니다. 단일 종목 리스크가 낮습니다.`,
  };
}

// ─── 탭 1: 검색 ───────────────────────────────────────────────────────────────

function SearchTab() {
  const [mode, setMode]           = useState<"etf" | "stock">("etf");
  const [query, setQuery]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [etfResult, setEtfResult] = useState<{ etf: ETFInfo | null; holdings: ETFHolding[]; source?: string } | null>(null);
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
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
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
              {/* ETF 해설 */}
              <p className="text-[12px] text-muted-foreground leading-relaxed border-t border-border/50 pt-3">
                {etfDescription(etfResult.etf)}
              </p>
              {/* 총보수 해설 */}
              {etfResult.etf.ter != null && (
                <p className="text-[11px] text-muted-foreground/60">
                  💰 연간 총보수 {etfResult.etf.ter}% — 보유 기간 동안 자동으로 차감되는 운용 비용입니다. 낮을수록 유리합니다.
                </p>
              )}
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
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest">Top {etfResult.holdings.length} 보유 종목</p>
                  {etfResult.source === "live" ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 font-semibold">● KIS 실시간</span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 font-semibold">참고용 데이터</span>
                  )}
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
                  <p className="text-[10px] text-muted-foreground/40">
                    {etfResult.source === "live"
                      ? "* KIS Open API 실시간 데이터 — 기준가격 비중 기준"
                      : "* 참고용 정적 데이터 — 실제 비중과 차이가 있을 수 있습니다"}
                  </p>
                </div>
              </div>

              {/* 집중도 해설 */}
              {(() => {
                const conc = holdingConcentration(etfResult.holdings);
                return (
                  <div className={cn(
                    "rounded-xl px-4 py-3 text-[12px] leading-relaxed border",
                    conc.level === "high"
                      ? "bg-orange-500/5 border-orange-500/20 text-orange-700 dark:text-orange-400"
                      : conc.level === "mid"
                      ? "bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-400"
                      : "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400",
                  )}>
                    📊 {conc.text}
                  </div>
                );
              })()}
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
              {/* 노출도 요약 해설 */}
              <div className="rounded-xl bg-primary/5 border border-primary/15 px-4 py-3 text-[12px] text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground">{stockResult[0]?.holding.stockName}</span>은(는) 현재 {stockResult.length}개 ETF에 편입되어 있습니다.
                {" "}가장 높은 비중으로 편입된 ETF는 <span className="font-semibold text-foreground">{stockResult[0]?.etf.name}</span>으로,
                전체 ETF 자산의 <span className="font-semibold text-foreground">{stockResult[0]?.holding.weight.toFixed(2)}%</span>를 차지합니다.
                ETF를 통하면 이 종목에 간접적으로 분산 투자할 수 있습니다.
              </div>
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
            {["069500","091160","305720","143460","132030","261220","144600","133690","229200","379800"].map(code => {
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

// ─── AI 방향 뱃지 ─────────────────────────────────────────────────────────────

function AiDirChip({ dir, strength, label }: {
  dir: "up" | "down" | "neutral"; strength: number; label: string;
}) {
  const cfg =
    dir === "up"   ? { text: "text-red-500",   bg: "bg-red-500/10",   border: "border-red-500/30",   icon: "▲", emoji: "📈" } :
    dir === "down" ? { text: "text-blue-500",  bg: "bg-blue-500/10",  border: "border-blue-500/30",  icon: "▼", emoji: "📉" } :
                     { text: "text-slate-400", bg: "bg-slate-500/10", border: "border-slate-500/20", icon: "–", emoji: "➡️" };
  const pct = Math.round(strength * 100);
  const conviction = strength > 0.7 ? "고신뢰" : strength > 0.4 ? "중신뢰" : "저신뢰";
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5", cfg.bg, cfg.border)}>
      <span className="text-lg">{cfg.emoji}</span>
      <div>
        <p className="text-[11px] text-muted-foreground/60 font-medium">{label}</p>
        <p className={cn("text-sm font-bold", cfg.text)}>
          {dir === "up" ? "상승 예측" : dir === "down" ? "하락 예측" : "중립"}
          {dir !== "neutral" && <span className="ml-1.5 text-[11px] font-normal opacity-70">{conviction} {pct}%</span>}
        </p>
      </div>
    </div>
  );
}

// ─── 미니 3단 스코어 바 ───────────────────────────────────────────────────────

function ScoreBreakdown({ tech, sector, ai, combined, aiBonus }: {
  tech: number; sector: number; ai: number; combined: number; aiBonus: number;
}) {
  const bars: { label: string; value: number; color: string; weight: string }[] = [
    { label: "기술적", value: tech,   color: "#3b82f6", weight: "55%" },
    { label: "섹터강도", value: sector, color: "#8b5cf6", weight: "25%" },
    { label: "AI예측", value: ai,    color: "#f59e0b", weight: "20%" },
  ];
  const bonusColor = aiBonus > 0 ? "text-red-400" : aiBonus < 0 ? "text-blue-400" : "text-muted-foreground/40";
  return (
    <div className="space-y-1.5">
      {bars.map(b => (
        <div key={b.label} className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/50 w-12 shrink-0">{b.label}</span>
          <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${b.value}%`, background: b.color }} />
          </div>
          <span className="text-[10px] font-bold w-5 text-right" style={{ color: b.color }}>{b.value}</span>
        </div>
      ))}
      {aiBonus !== 0 && (
        <p className={cn("text-[10px] font-medium", bonusColor)}>
          AI 보정: {aiBonus > 0 ? "+" : ""}{aiBonus}pt
        </p>
      )}
    </div>
  );
}

// ─── 탭 2: AI 통합 신호 ──────────────────────────────────────────────────────

function UnifiedSignalsTab() {
  const [data, setData]         = useState<UnifiedSignal[]>([]);
  const [aiCtx, setAiCtx]       = useState<AiContext | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshed, setRefreshed] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/etf/unified-signals"), { credentials: "include" });
      if (r.ok) {
        const j = await r.json();
        setData(Array.isArray(j.signals) ? j.signals : []);
        setAiCtx(j.aiContext ?? null);
        setRefreshed(new Date());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const top3    = data.slice(0, 3);
  const bottom3 = [...data].reverse().slice(0, 3);

  // 섹터별 집계 (바 차트용)
  const sectorData = (() => {
    const map: Record<string, { scores: number[]; rank: number[]; color: string }> = {};
    data.forEach(s => {
      if (!map[s.sector]) map[s.sector] = { scores: [], rank: [], color: SECTOR_COLORS[s.sector] ?? "#94a3b8" };
      map[s.sector].scores.push(s.combinedScore);
      map[s.sector].rank.push(s.sectorRank);
    });
    return Object.entries(map).map(([sector, v]) => ({
      sector,
      score: Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length),
      color: v.color,
    })).sort((a, b) => b.score - a.score);
  })();

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-primary" />
            AI 통합 시장 신호
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            기술적 지표(55%) + 섹터 상대강도(25%) + AI 방향 예측(20%) 종합
          </p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          {refreshed && <span>{refreshed.getHours()}:{String(refreshed.getMinutes()).padStart(2,"0")}</span>}
        </button>
      </div>

      {/* 개념 설명 */}
      <HelpTip label="💡 AI 통합 신호란?">
        <p>세 가지 신호를 결합해 ETF별 종합 점수를 계산합니다.</p>
        <div className="mt-2 space-y-1.5 text-[11px]">
          <div className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 mt-1 shrink-0" />
            <span><strong className="text-foreground">기술적 신호 (55%)</strong> — MA 골든/데드크로스, RSI, 5일·20일 모멘텀</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-purple-500 mt-1 shrink-0" />
            <span><strong className="text-foreground">섹터 상대강도 (25%)</strong> — 전체 ETF 대비 해당 섹터의 상대 모멘텀 퍼센타일</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 mt-1 shrink-0" />
            <span><strong className="text-foreground">AI 방향 예측 (20%)</strong> — LSTM+GBDT 앙상블이 예측한 KOSPI/NASDAQ 방향성 보정</span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          {[
            { range: "70점 이상", label: "강력 매수 신호", color: "text-emerald-500" },
            { range: "40~70점",   label: "중립 / 관망",   color: "text-slate-400"   },
            { range: "40점 미만", label: "약세 · 주의",   color: "text-red-400"     },
          ].map(s => (
            <div key={s.range} className="rounded-lg bg-muted/20 px-2 py-1.5">
              <p className={cn("text-[11px] font-bold", s.color)}>{s.range}</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </HelpTip>

      {/* AI 예측 배너 */}
      {aiCtx && (
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <p className="text-[12px] font-bold text-foreground">
              현재 AI 시장 방향 예측
              {!aiCtx.ready && <span className="ml-2 text-[10px] font-normal text-muted-foreground/60">(모델 학습 중…)</span>}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <AiDirChip dir={aiCtx.kospi.direction} strength={aiCtx.kospi.strength} label="KOSPI (한국 주식)" />
            <AiDirChip dir={aiCtx.nasdaq.direction} strength={aiCtx.nasdaq.strength} label="NASDAQ (미국 주식)" />
          </div>
          {(aiCtx.kospi.direction !== "neutral" || aiCtx.nasdaq.direction !== "neutral") && (
            <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
              AI 예측 방향이 ETF 종합 점수에 반영됩니다.
              국내 ETF는 KOSPI, 해외 ETF는 NASDAQ 예측을 활용하며,
              레버리지/인버스 ETF는 해당 배율로 증폭됩니다.
            </p>
          )}
        </div>
      )}

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
              <p className="text-[11px] font-bold text-emerald-500/70 uppercase tracking-widest">🚀 TOP 신호</p>
              {top3.map(s => (
                <div key={s.code} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SECTOR_COLORS[s.sector] ?? "#94a3b8" }} />
                    <span className="text-xs font-medium text-foreground truncate">{s.name.replace("KODEX ","").replace("TIGER ","")}</span>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-500 shrink-0">{s.combinedScore}점</span>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-4 space-y-2">
              <p className="text-[11px] font-bold text-red-400/70 uppercase tracking-widest">⚠️ 주의 신호</p>
              {bottom3.map(s => (
                <div key={s.code} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SECTOR_COLORS[s.sector] ?? "#94a3b8" }} />
                    <span className="text-xs font-medium text-foreground truncate">{s.name.replace("KODEX ","").replace("TIGER ","")}</span>
                  </div>
                  <span className="text-[11px] font-bold text-red-400 shrink-0">{s.combinedScore}점</span>
                </div>
              ))}
            </div>
          </div>

          {/* 섹터 바 차트 */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-4">섹터별 종합 점수</p>
            <ResponsiveContainer width="100%" height={sectorData.length * 40 + 20}>
              <BarChart
                layout="vertical"
                data={sectorData}
                margin={{ left: 10, right: 50, top: 4, bottom: 4 }}
              >
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="sector" tick={{ fontSize: 12 }} width={60} />
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.08)" />
                <Tooltip
                  formatter={(_v: any, _n: any, props: any) => [
                    `종합 ${props.payload.score}점`,
                    props.payload.sector,
                  ]}
                />
                <Bar dataKey="score" radius={[0, 6, 6, 0]} maxBarSize={22}>
                  {sectorData.map((s, i) => (
                    <Cell key={i} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ETF 카드 목록 */}
          <div className="grid grid-cols-1 gap-3">
            {data.map(s => {
              const cfg = SIGNAL_CONFIG[s.signal as keyof typeof SIGNAL_CONFIG] ?? SIGNAL_CONFIG.hold;
              const aiDirCfg =
                s.aiDirection === "up"   ? { icon: "📈", text: "text-red-400"  } :
                s.aiDirection === "down" ? { icon: "📉", text: "text-blue-400" } :
                                           { icon: "➡️", text: "text-muted-foreground/40" };
              return (
                <div key={s.code} className={cn(
                  "rounded-2xl border bg-card p-4 transition-all",
                  cfg.border,
                )}>
                  {/* 헤더 */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-foreground">{s.name}</h3>
                        <span className="text-[10px] text-muted-foreground/40">{s.code}</span>
                        {s.leverage !== 1 && (
                          <span className={cn(
                            "text-[10px] font-bold px-1.5 py-0.5 rounded border",
                            s.leverage === 2 ? "bg-orange-500/10 border-orange-500/30 text-orange-500"
                                             : "bg-blue-500/10 border-blue-500/30 text-blue-500",
                          )}>
                            {s.leverage === 2 ? "2×" : "인버스"}
                          </span>
                        )}
                        <span className={cn("text-[10px] font-medium", aiDirCfg.text)}>
                          {aiDirCfg.icon} AI
                        </span>
                      </div>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-lg font-bold text-foreground">{s.price.toLocaleString()}</span>
                        <Pct v={s.change1d} />
                        <span className="text-[10px] text-muted-foreground/50">{s.sector} · {s.issuer}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">{s.reason}</p>
                    </div>
                    <div className="text-right space-y-1 shrink-0">
                      <SignalBadge signal={s.signal} />
                      <div className="w-24">
                        <ScoreBar score={s.combinedScore} />
                      </div>
                    </div>
                  </div>

                  {/* 3단 스코어 분해 */}
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <ScoreBreakdown
                      tech={s.techScore} sector={s.sectorRank}
                      ai={s.aiScore} combined={s.combinedScore} aiBonus={s.aiBonus}
                    />
                  </div>

                  {/* 보조 지표 */}
                  <div className="grid grid-cols-4 gap-2 mt-3 pt-2 border-t border-border/30">
                    {[
                      { label: "5일", value: <Pct v={s.return5d} /> },
                      { label: "20일", value: <Pct v={s.return20d} /> },
                      { label: "RSI(14)", value: (
                        <span className={cn(
                          "font-bold",
                          s.rsi14 > 70 ? "text-red-400" : s.rsi14 < 30 ? "text-emerald-400" : "text-foreground",
                        )}>
                          {s.rsi14}
                        </span>
                      )},
                      { label: "MA교차", value: (
                        <span className={cn("font-bold text-xs", s.ma5 > s.ma20 ? "text-red-400" : "text-blue-400")}>
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

          {/* 면책 고지 */}
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground/50 bg-muted/20 rounded-xl px-3 py-2.5 border border-border/50">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p>AI 통합 신호는 참고용 투자 보조 지표입니다. 투자 결정의 유일한 근거로 사용하지 마세요. 실제 투자 손실에 대해 애빛다는 책임지지 않습니다.</p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

type Tab = "search" | "unified";

export default function ETFAnalysis() {
  const { isEn }      = useLanguage();
  const [tab, setTab] = useState<Tab>("search");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "search",  label: "ETF / 종목 검색", icon: <Search className="w-4 h-4" /> },
    { id: "unified", label: "AI 통합 신호",    icon: <Brain className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-5 pb-20">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl sm:text-2xl font-display font-bold text-foreground">
          ETF 분석
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          국내·해외 주요 ETF 구성 종목 · 섹터 모멘텀 · AI 통합 타이밍 신호
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
      {tab === "search"  && <SearchTab />}
      {tab === "unified" && <UnifiedSignalsTab />}
    </div>
  );
}
