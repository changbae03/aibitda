import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw, Users, Building2, Globe, Activity, Info,
  TrendingUp, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import StockLogo from "@/components/ui/stock-logo";

/* ── 타입 ───────────────────────────────────────────────────────────── */
interface MarketRow  { date: string; individual: number; institution: number; foreign: number }
interface StockFlow  { code: string; name: string; sector: string; individual: number; institution: number; foreign: number }
interface FlowData   { marketFlow: { kospi: MarketRow[]; kosdaq: MarketRow[] }; stocks: StockFlow[]; updatedAt: string }
type SortTab = "individual" | "institution" | "foreign" | "total";

/* ── 유틸 ───────────────────────────────────────────────────────────── */
function fmt억(v: number) {
  const abs = Math.abs(v);
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}조`;
  if (abs >= 1000)  return `${(v / 1000).toFixed(1)}천억`;
  return `${v}억`;
}
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

export default function FlowPage() {
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
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-20">

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
      </div>
    </div>
  );
}
