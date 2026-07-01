import { useEffect, useState, useCallback } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Users, Building2, Globe, Activity, Info, ChevronUp, ChevronDown } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import StockLogo from "@/components/ui/stock-logo";

/* ── 타입 ─────────────────────────────────────────────────────────────── */

interface MarketRow {
  date: string;
  individual: number;
  institution: number;
  foreign: number;
}

interface StockFlow {
  code: string;
  name: string;
  sector: string;
  individual: number;
  institution: number;
  foreign: number;
}

interface FlowData {
  marketFlow: {
    kospi: MarketRow[];
    kosdaq: MarketRow[];
  };
  stocks: StockFlow[];
  updatedAt: string;
}

/* ── 유틸 ─────────────────────────────────────────────────────────────── */

function fmt억(v: number) {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}조`;
  if (abs >= 1000)  return `${(v / 1000).toFixed(1)}천억`;
  return `${v}억`;
}

function flowColor(v: number) {
  if (v > 0)  return "text-red-500";
  if (v < 0)  return "text-blue-500";
  return "text-muted-foreground/50";
}

function flowBg(v: number) {
  if (v > 0)  return "bg-red-50 dark:bg-red-950/20";
  if (v < 0)  return "bg-blue-50 dark:bg-blue-950/20";
  return "bg-muted/20";
}

function FlowIcon({ v, size = 3 }: { v: number; size?: number }) {
  const cls = `w-${size} h-${size}`;
  if (v > 0)  return <ChevronUp   className={cn(cls, "text-red-500")} />;
  if (v < 0)  return <ChevronDown className={cn(cls, "text-blue-500")} />;
  return <Minus className={cn(cls, "text-muted-foreground/40")} />;
}

/* ── 최근 날짜 레이블 ─────────────────────────────────────────────────── */
function shortDate(raw: string) {
  if (!raw) return raw;
  // ISO format: "2026-06-25"
  if (raw.includes("-")) {
    const parts = raw.split("-");
    return `${Number(parts[1])}/${Number(parts[2])}`;
  }
  // KRX format: "20260625"
  if (raw.length >= 8) {
    return `${Number(raw.slice(4, 6))}/${Number(raw.slice(6, 8))}`;
  }
  return raw;
}

/* ── 시장 전체 수급 바 차트 ───────────────────────────────────────────── */
function InvestorBar({
  label,
  value,
  maxAbs,
}: {
  label: string;
  value: number;
  maxAbs: number;
}) {
  const pct = maxAbs > 0 ? Math.max((Math.abs(value) / maxAbs) * 100, 1.5) : 0;
  const isPos = value > 0;
  const isNeg = value < 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground/40 w-9 shrink-0 text-right">{label}</span>
      <div className="flex-1 relative h-5 flex items-center">
        <div
          className="absolute left-0 h-3.5 rounded-sm transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: isPos ? "rgba(248,113,113,0.55)" : isNeg ? "rgba(96,165,250,0.55)" : "rgba(128,128,128,0.2)",
          }}
        />
      </div>
      <span className={cn("text-[11px] tabular-nums font-semibold w-16 text-right shrink-0", flowColor(value))}>
        {value > 0 ? "+" : ""}{fmt억(value)}
      </span>
    </div>
  );
}

function MarketFlowChart({
  rows,
  label,
}: {
  rows: MarketRow[];
  label: string;
}) {
  if (!rows.length) return (
    <div className="py-6 text-center text-sm text-muted-foreground/40">데이터 없음</div>
  );

  const maxAbs = Math.max(
    ...rows.flatMap(r => [Math.abs(r.individual), Math.abs(r.institution), Math.abs(r.foreign)]),
    1,
  );

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-semibold text-muted-foreground/50 px-1">{label}</div>
      {rows.map(r => (
        <div key={r.date} className="space-y-1">
          <div className="flex items-center gap-2 px-1 mb-0.5">
            <span className="w-9 shrink-0" />
            <span className="text-[11px] text-muted-foreground/50 font-semibold tabular-nums">
              {shortDate(r.date)}
            </span>
          </div>
          <InvestorBar label="개인" value={r.individual} maxAbs={maxAbs} />
          <InvestorBar label="기관" value={r.institution} maxAbs={maxAbs} />
          <InvestorBar label="외인" value={r.foreign} maxAbs={maxAbs} />
        </div>
      ))}
    </div>
  );
}

/* ── 종목 수급 행 ─────────────────────────────────────────────────────── */
function StockFlowRow({
  stock,
  sortKey,
  rank,
}: {
  stock: StockFlow;
  sortKey: "individual" | "institution" | "foreign" | "total";
  rank: number;
}) {
  const net = sortKey === "total"
    ? stock.institution + stock.foreign
    : stock[sortKey];

  const indColor  = flowColor(stock.individual);
  const instColor = flowColor(stock.institution);
  const forColor  = flowColor(stock.foreign);

  return (
    <motion.div
      initial={{ opacity: 0, x: -4 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: rank * 0.03 }}
      className="flex items-center gap-3 px-4 py-3 border-b border-border/30 last:border-0 hover:bg-muted/10 transition-colors"
    >
      {/* 순위 */}
      <span className={cn(
        "text-[12px] font-bold tabular-nums w-5 text-center shrink-0",
        rank <= 3 ? "text-[#FF8A7A]" : "text-muted-foreground/40",
      )}>
        {rank}
      </span>

      {/* 로고 + 이름 */}
      <StockLogo ticker={`${stock.code}.KS`} size={32} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-foreground truncate">{stock.name}</div>
        <div className="text-[11px] text-muted-foreground/40">{stock.sector}</div>
      </div>

      {/* 투자자별 수급 */}
      <div className="flex gap-2 shrink-0">
        <div className={cn("flex flex-col items-end px-2 py-1 rounded-lg text-right min-w-[56px]", flowBg(stock.individual))}>
          <span className="text-[9px] text-muted-foreground/50 leading-none mb-0.5">개인</span>
          <span className={cn("text-[12px] font-bold tabular-nums leading-none", indColor)}>
            {stock.individual > 0 ? "+" : ""}{fmt억(stock.individual)}
          </span>
        </div>
        <div className={cn("flex flex-col items-end px-2 py-1 rounded-lg text-right min-w-[56px]", flowBg(stock.institution))}>
          <span className="text-[9px] text-muted-foreground/50 leading-none mb-0.5">기관</span>
          <span className={cn("text-[12px] font-bold tabular-nums leading-none", instColor)}>
            {stock.institution > 0 ? "+" : ""}{fmt억(stock.institution)}
          </span>
        </div>
        <div className={cn("flex flex-col items-end px-2 py-1 rounded-lg text-right min-w-[56px]", flowBg(stock.foreign))}>
          <span className="text-[9px] text-muted-foreground/50 leading-none mb-0.5">외국인</span>
          <span className={cn("text-[12px] font-bold tabular-nums leading-none", forColor)}>
            {stock.foreign > 0 ? "+" : ""}{fmt억(stock.foreign)}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ── 수급 요약 카드 ───────────────────────────────────────────────────── */
function SummaryCard({
  label,
  icon,
  value,
  sub,
}: {
  label: string;
  icon: React.ReactNode;
  value: number;
  sub: string;
}) {
  return (
    <div className={cn(
      "flex-1 rounded-xl border px-4 py-3",
      value > 0 ? "bg-red-50/50 border-red-200/50 dark:bg-red-950/10 dark:border-red-900/30"
        : value < 0 ? "bg-blue-50/50 border-blue-200/50 dark:bg-blue-950/10 dark:border-blue-900/30"
        : "bg-muted/20 border-border/40",
    )}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground/50">{icon}</span>
        <span className="text-[11px] text-muted-foreground/60 font-medium">{label}</span>
      </div>
      <div className={cn("text-[18px] font-black tabular-nums leading-none", flowColor(value))}>
        {value > 0 ? "+" : ""}{fmt억(value)}
      </div>
      <div className="text-[10px] text-muted-foreground/40 mt-0.5">{sub}</div>
    </div>
  );
}

/* ── 탭 타입 ──────────────────────────────────────────────────────────── */
type SortTab = "individual" | "institution" | "foreign" | "total";

/* ── 메인 페이지 ──────────────────────────────────────────────────────── */
export default function FlowPage() {
  const [data, setData]       = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);
  const [tab, setTab]         = useState<SortTab>("individual");
  const [market, setMarket]   = useState<"kospi" | "kosdaq">("kospi");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(false);
    try {
      const url = force
        ? getApiUrl("/api/market/flow/refresh")
        : getApiUrl("/api/market/flow");
      const res = await fetch(url, {
        method: force ? "POST" : "GET",
        credentials: "include",
      });
      if (!res.ok) throw new Error("bad");
      const json: FlowData = await res.json();
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load(true);
  }

  /* 정렬된 종목 */
  const sorted = data?.stocks
    ? [...data.stocks].sort((a, b) => {
        if (tab === "individual")  return b.individual  - a.individual;
        if (tab === "institution") return b.institution - a.institution;
        if (tab === "foreign")     return b.foreign     - a.foreign;
        return (b.institution + b.foreign) - (a.institution + a.foreign);
      })
    : [];

  /* 최신 날짜 시장 합계 */
  const latestKospi  = data?.marketFlow.kospi.at(-1);
  const latestKosdaq = data?.marketFlow.kosdaq.at(-1);

  const updatedAt = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : null;

  const TAB_DEFS: { key: SortTab; label: string; icon: React.ReactNode }[] = [
    { key: "individual",  label: "개인(개미)",    icon: <Users      className="w-3 h-3" /> },
    { key: "institution", label: "기관",          icon: <Building2  className="w-3 h-3" /> },
    { key: "foreign",     label: "외국인",        icon: <Globe      className="w-3 h-3" /> },
    { key: "total",       label: "기관+외인",     icon: <TrendingUp className="w-3 h-3" /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-16">

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Activity className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-bold text-foreground">수급 레이더</h1>
            </div>
            <p className="text-[12px] text-muted-foreground/50">
              개미·기관·외국인 순매수 — 돈이 어디에 쏠리는지 확인하세요
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {updatedAt && (
              <span className="text-[11px] text-muted-foreground/40 tabular-nums">{updatedAt} 기준</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground/40 hover:text-foreground disabled:opacity-30"
            >
              <RefreshCw className={cn("w-4 h-4", (loading || refreshing) && "animate-spin")} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-2xl border border-border/50 overflow-hidden animate-pulse">
                <div className="h-12 bg-muted/40" />
                <div className="p-4 space-y-3">
                  {[1, 2, 3].map(j => (
                    <div key={j} className="h-8 rounded bg-muted/30" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : error || !data ? (
          <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground/40">
            <Activity className="w-8 h-8" />
            <p className="text-sm">수급 데이터를 불러오지 못했습니다.</p>
            <button
              onClick={() => load()}
              className="text-[12px] text-primary/70 hover:text-primary underline underline-offset-2"
            >
              다시 시도
            </button>
          </div>
        ) : (
          <div className="space-y-6">

            {/* ── 오늘 시장 수급 요약 ──────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[13px] font-bold text-foreground/70">오늘의 시장 수급</span>
                <span className="text-[11px] text-muted-foreground/40">
                  (코스피 + 코스닥 합산, 억원)
                </span>
              </div>
              <div className="flex gap-2">
                <SummaryCard
                  label="개인(개미)"
                  icon={<Users className="w-3.5 h-3.5" />}
                  value={(latestKospi?.individual ?? 0) + (latestKosdaq?.individual ?? 0)}
                  sub="순매수 거래대금"
                />
                <SummaryCard
                  label="기관"
                  icon={<Building2 className="w-3.5 h-3.5" />}
                  value={(latestKospi?.institution ?? 0) + (latestKosdaq?.institution ?? 0)}
                  sub="순매수 거래대금"
                />
                <SummaryCard
                  label="외국인"
                  icon={<Globe className="w-3.5 h-3.5" />}
                  value={(latestKospi?.foreign ?? 0) + (latestKosdaq?.foreign ?? 0)}
                  sub="순매수 거래대금"
                />
              </div>
            </div>

            {/* ── 최근 5일 시장 수급 차트 ─────────────────────────────── */}
            <div className="rounded-2xl border border-border/50 overflow-hidden">
              {/* 시장 탭 */}
              <div className="flex border-b border-border/40 px-4 pt-3 pb-0">
                {(["kospi", "kosdaq"] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMarket(m)}
                    className={cn(
                      "mr-4 pb-2.5 text-[13px] font-semibold border-b-2 transition-colors",
                      market === m
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground/50 hover:text-foreground/70",
                    )}
                  >
                    {m === "kospi" ? "코스피" : "코스닥"}
                  </button>
                ))}
              </div>
              <div className="p-4">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={market}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <MarketFlowChart
                      rows={data.marketFlow[market]}
                      label={market === "kospi" ? "코스피 투자자별 순매수 (억원)" : "코스닥 투자자별 순매수 (억원)"}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="px-4 py-2 border-t border-border/30 bg-muted/10">
                <p className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  pykrx(KRX) 기준 · 양수(+)=순매수 빨강, 음수(-)=순매도 파랑
                </p>
              </div>
            </div>

            {/* ── 종목별 수급 TOP ─────────────────────────────────────── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[13px] font-bold text-foreground/70">종목별 수급 현황</span>
                <span className="text-[11px] text-muted-foreground/40">
                  KIS API · 오늘 기준
                </span>
              </div>

              {/* 정렬 탭 */}
              <div className="flex gap-1.5 mb-3 flex-wrap">
                {TAB_DEFS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors",
                      tab === t.key
                        ? "bg-foreground text-background"
                        : "bg-muted/40 text-muted-foreground/60 hover:bg-muted hover:text-foreground/80",
                    )}
                  >
                    {t.icon}
                    {t.label} 순매수
                  </button>
                ))}
              </div>

              {/* 종목 목록 */}
              <div className="rounded-2xl border border-border/50 overflow-hidden">
                {sorted.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground/40">
                    종목 수급 데이터가 없습니다 (장 마감 후 또는 API 한도)
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={tab}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.1 }}
                    >
                      {sorted.slice(0, 15).map((s, i) => (
                        <StockFlowRow
                          key={s.code}
                          stock={s}
                          sortKey={tab}
                          rank={i + 1}
                        />
                      ))}
                    </motion.div>
                  </AnimatePresence>
                )}
              </div>
            </div>

            {/* ── 개미 vs 기관·외인 힘의 방향 ────────────────────────── */}
            {data.stocks.length > 0 && (() => {
              const totalInd  = data.stocks.reduce((s, st) => s + st.individual,  0);
              const totalInst = data.stocks.reduce((s, st) => s + st.institution, 0);
              const totalFor  = data.stocks.reduce((s, st) => s + st.foreign,     0);
              const smart = totalInst + totalFor;
              const agreement = (totalInd > 0 && smart > 0) || (totalInd < 0 && smart < 0);
              return (
                <div className={cn(
                  "rounded-2xl border px-4 py-4",
                  agreement
                    ? "bg-emerald-50/50 border-emerald-200/50 dark:bg-emerald-950/10 dark:border-emerald-900/30"
                    : "bg-amber-50/50 border-amber-200/50 dark:bg-amber-950/10 dark:border-amber-900/30",
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-lg",
                      agreement ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-amber-100 dark:bg-amber-900/30",
                    )}>
                      {agreement ? "🤝" : "⚡"}
                    </div>
                    <div>
                      <div className={cn(
                        "text-[13px] font-bold mb-0.5",
                        agreement ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
                      )}>
                        {agreement
                          ? `개미·기관·외국인 방향 일치 — ${totalInd > 0 ? "동반 매수" : "동반 매도"}`
                          : "개미 vs 스마트머니 방향 엇갈림"}
                      </div>
                      <div className="text-[12px] text-muted-foreground/60">
                        개인 합계 {fmt억(totalInd)} · 기관+외인 합계 {fmt억(smart)}
                        {!agreement && " · 개미와 기관이 반대 방향 — 어느 쪽이 맞는지 지켜보세요"}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <p className="text-[10px] text-muted-foreground/30 text-center mt-4 leading-relaxed">
              본 수급 데이터는 투자 권유가 아닙니다. 단일 지표로 투자 결정을 내리지 마세요.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
