import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from "recharts";

import { useGetMarketData } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Loader2, AlertCircle, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

type Period = "3m" | "6m" | "1y" | "2y" | "5y";
type Interval = "1d" | "1wk" | "1mo";

export interface ChartLevels {
  support?: number;
  resistance?: number;
  entryMin?: number;
  entryMax?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
  currentPrice?: number;
}

export interface ChartEvent {
  date: string; // "YYYY-MM"
  label: string;
  type: "catalyst" | "risk" | "earnings" | "news";
}

interface PriceSwing {
  date: string;
  dateLabel: string;
  close: number;
  changePercent: number;
  index: number;
}

interface PriceEventNews {
  date: string;
  changePercent: number;
  summary: string;
}


interface StockChartProps {
  ticker: string;
  companyName?: string;
  companyNameEn?: string;
  chartLevels?: ChartLevels;
  events?: ChartEvent[];
  currency?: "KRW" | "USD";
  isEn?: boolean;
}

const PERIOD_OPTIONS: { value: Period; label: string; labelEn: string }[] = [
  { value: "3m", label: "3개월", labelEn: "3M" },
  { value: "6m", label: "6개월", labelEn: "6M" },
  { value: "1y", label: "1년",   labelEn: "1Y" },
  { value: "2y", label: "2년",   labelEn: "2Y" },
  { value: "5y", label: "5년",   labelEn: "5Y" },
];

const INTERVAL_OPTIONS: { value: Interval; label: string; labelEn: string }[] = [
  { value: "1d",  label: "일봉", labelEn: "Daily"   },
  { value: "1wk", label: "주봉", labelEn: "Weekly"  },
  { value: "1mo", label: "월봉", labelEn: "Monthly" },
];

function formatPrice(v: number | null | undefined, currency: "KRW" | "USD" = "KRW") {
  if (v == null) return "—";
  if (currency === "USD") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function priceLabel(v: number, currency: "KRW" | "USD", isEn = false): string {
  if (currency === "USD") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (isEn) return `KRW ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v)}`;
  return `${v.toLocaleString("ko-KR")}원`;
}

function formatVolume(v: number | null | undefined) {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

const CustomTooltip = ({ active, payload, label, currency = "KRW", isEn = false }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-background border border-border rounded-lg p-3 text-xs shadow-lg min-w-[160px]">
      <p className="text-muted-foreground mb-2 font-medium">{d?.date ?? label}</p>
      {d?.close != null && (
        <div className="space-y-1.5">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{isEn ? "Close" : "종가"}</span>
            <span className="text-foreground font-bold font-mono">{priceLabel(d.close, currency, isEn)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{isEn ? "High" : "고가"}</span>
            <span className="text-emerald-600 font-mono">{priceLabel(d.high, currency, isEn)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{isEn ? "Low" : "저가"}</span>
            <span className="text-red-500 font-mono">{priceLabel(d.low, currency, isEn)}</span>
          </div>
          {d.volume != null && (
            <div className="flex justify-between gap-4 border-t border-border pt-1.5 mt-0.5">
              <span className="text-muted-foreground">{isEn ? "Volume" : "거래량"}</span>
              <span className="text-foreground/70 font-mono">{formatVolume(d.volume)}</span>
            </div>
          )}
          {d._swingIdx != null && (
            <div className="border-t border-border pt-1.5 mt-0.5">
              <span className="font-bold" style={{ color: d._swingIsUp ? "#16a34a" : "#dc2626" }}>
                {d._swingIsUp ? "▲" : "▼"} {d._swingIsUp ? "+" : ""}{d._swingPct?.toFixed(1)}% {isEn ? "swing" : "급변"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ctrlBtn = (active: boolean) =>
  cn(
    "px-2.5 py-1 text-xs rounded-md font-medium transition-colors whitespace-nowrap shrink-0",
    active
      ? "bg-foreground text-white"
      : "text-muted-foreground hover:text-foreground hover:bg-muted"
  );

function LevelBadge({ label, value, color, currency = "KRW", isEn = false }: { label: string; value: number | string; color: string; currency?: "KRW" | "USD"; isEn?: boolean }) {
  const display = typeof value === "number" ? priceLabel(value, currency, isEn) : (currency === "USD" ? `$${value}` : isEn ? `KRW ${value}` : `${value}원`);
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium" style={{ borderColor: `${color}40`, backgroundColor: `${color}10`, color }}>
      <span className="w-2 h-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground font-normal">{label}</span>
      <span className="font-mono font-semibold">{display}</span>
    </div>
  );
}

// 주가 급변 자동 감지 (>= minPct % 변화)
function detectPriceSwings(chartData: any[], minPct = 4, maxCount = 5): PriceSwing[] {
  if (chartData.length < 2) return [];
  const swings: PriceSwing[] = [];
  for (let i = 1; i < chartData.length; i++) {
    const prev = chartData[i - 1].close;
    const curr = chartData[i].close;
    if (!prev || !curr) continue;
    const changePct = ((curr - prev) / prev) * 100;
    if (Math.abs(changePct) >= minPct) {
      swings.push({
        date: chartData[i].date ?? "",
        dateLabel: chartData[i].dateLabel,
        close: curr,
        changePercent: changePct,
        index: i,
      });
    }
  }
  swings.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  const top = swings.slice(0, maxCount);
  top.sort((a, b) => a.index - b.index);

  const filtered: PriceSwing[] = [];
  for (const s of top) {
    const last = filtered[filtered.length - 1];
    if (last && s.index - last.index < 7) {
      if (Math.abs(s.changePercent) > Math.abs(last.changePercent)) {
        filtered[filtered.length - 1] = s;
      }
    } else {
      filtered.push(s);
    }
  }
  return filtered;
}

// 백엔드 price-events 조회
async function fetchPriceEvents(ticker: string, companyName: string | undefined, swings: PriceSwing[]): Promise<PriceEventNews[]> {
  const BASE = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  const res = await fetch(`${BASE}/api/market-data/price-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker,
      companyName,
      events: swings.map(s => ({ date: s.date, changePercent: s.changePercent })),
    }),
  });
  if (!res.ok) throw new Error("price-events fetch failed");
  return res.json();
}

const NUM_BADGES = ["①", "②", "③", "④", "⑤"];

export default function StockChart({ ticker, companyName, companyNameEn, chartLevels, events = [], currency = "KRW", isEn = false }: StockChartProps) {
  const [period, setPeriod] = useState<Period>("1y");
  const [interval, setInterval] = useState<Interval>("1d");
  const [showEvents, setShowEvents] = useState(true);
  const [priceEventNews, setPriceEventNews] = useState<PriceEventNews[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState(false);

  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const obs = new MutationObserver(() => setIsDark(document.documentElement.classList.contains("dark")));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  const lineColor = isDark ? "#e2e8f0" : "#0a0a0a";

  const { data, isLoading, error } = useGetMarketData(ticker, { period, interval });

  const isUp = (data?.changePercent ?? 0) >= 0;
  const nxtInfo = (data as any)?.nxtInfo as { price: number; changePercent: number; compareToPrev: string; at: string; sessionType: string; status: string } | null | undefined;
  const nxtIsUp = (nxtInfo?.changePercent ?? 0) >= 0;

  const useLongDate = period === "5y" || period === "2y" || period === "1y";
  const chartData = data?.candles?.map((c) => ({
    ...c,
    close: parseFloat(c.close.toFixed(2)),
    dateLabel: useLongDate ? c.date.slice(0, 10) : c.date.slice(5),
  })) ?? [];

  const minSwingPct = period === "5y" ? 8 : period === "2y" ? 6 : 4;
  const swings = chartData.length > 1 ? detectPriceSwings(chartData, minSwingPct, 5) : [];

  const swingDateSet = new Set(swings.map(s => s.dateLabel));
  const chartDataWithSwings = chartData.map((d, i) => {
    const swing = swings.find(s => s.dateLabel === d.dateLabel);
    if (!swing) return d;
    return {
      ...d,
      _swingIdx: swings.indexOf(swing),
      _swingIsUp: swing.changePercent > 0,
      _swingPct: swing.changePercent,
    };
  });

  const currentPrice = data?.currentPrice ?? 0;
  const MAX_LEVEL_RATIO = 1.5;
  const showTarget1OnChart = chartLevels?.target1 && currentPrice > 0 && chartLevels.target1 <= currentPrice * MAX_LEVEL_RATIO;
  const showTarget2OnChart = chartLevels?.target2 && currentPrice > 0 && chartLevels.target2 <= currentPrice * MAX_LEVEL_RATIO;
  const showStopLossOnChart = chartLevels?.stopLoss && currentPrice > 0 && chartLevels.stopLoss >= currentPrice * (2 - MAX_LEVEL_RATIO);

  const priceMin = chartData.length ? Math.min(
    ...chartData.map((d) => d.low ?? d.close),
    ...(showStopLossOnChart ? [chartLevels!.stopLoss!] : [])
  ) * 0.99 : 0;
  const dataMax = chartData.length ? Math.max(...chartData.map((d) => d.high ?? d.close)) : 100;
  const levelMax = Math.max(
    dataMax,
    showTarget1OnChart ? chartLevels!.target1! : 0,
    showTarget2OnChart ? chartLevels!.target2! : 0,
  );
  const priceMax = levelMax * 1.03;
  const maxVolume = chartData.length ? Math.max(...chartData.map((d) => d.volume ?? 0)) : 1;
  const volumeDomainMax = maxVolume * 5;

  useEffect(() => {
    if (swings.length === 0) return;
    setPriceEventNews([]);
    setNewsLoading(true);
    setNewsError(false);
    fetchPriceEvents(ticker, companyName, swings)
      .then(setPriceEventNews)
      .catch(() => setNewsError(true))
      .finally(() => setNewsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, period, interval, chartData.length]);

  const axisStyle = { fontSize: 10, fill: "var(--muted-foreground, #a3a3a3)", fontFamily: "'Pretendard', sans-serif" };

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-foreground">{isEn ? (companyNameEn ?? ticker) : (companyName ?? ticker)}</span>
            <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{ticker}</span>
          </div>
          {data && (
            <div className="flex flex-col gap-0.5 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-foreground font-mono tracking-tight">
                  {currency === "USD"
                    ? <>${formatPrice(data.currentPrice, "USD").replace("$", "")}</>
                    : isEn
                      ? <>KRW {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(data.currentPrice ?? 0)}</>
                      : <>{formatPrice(data.currentPrice)}<span className="text-sm font-normal text-muted-foreground ml-0.5">원</span></>
                  }
                </span>
                <span className={cn(
                  "flex items-center gap-0.5 text-sm font-semibold",
                  isUp ? "text-emerald-600" : "text-red-500"
                )}>
                  {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {isUp ? "+" : ""}{data.changePercent.toFixed(2)}%
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                  {currency === "USD" ? "NYSE/NASDAQ" : "KRX"}
                </span>
              </div>
              {nxtInfo && currency === "KRW" && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-bold text-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                    {nxtInfo.sessionType === "AFTER_MARKET"
                      ? (isEn ? "NXT After-Mkt" : "NXT 장후")
                      : (isEn ? "NXT Pre-Mkt" : "NXT 장전")}
                    {nxtInfo.status === "OPEN" ? (isEn ? " Live" : " 거래중") : ""}
                  </span>
                  <span className="font-mono font-bold text-sm text-foreground">{isEn ? `KRW ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(nxtInfo.price)}` : formatPrice(nxtInfo.price)}</span>
                  <span className={cn("text-xs font-semibold", nxtIsUp ? "text-emerald-600" : "text-red-500")}>
                    {nxtIsUp ? "+" : ""}{nxtInfo.changePercent.toFixed(2)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">({nxtInfo.compareToPrev}{isEn ? "" : "원"})</span>
                  {nxtInfo.at && (
                    <span className="text-[10px] text-muted-foreground hidden sm:inline">
                      {nxtInfo.at.replace("T", " ").substring(0, 16)} KST
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {data && (
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <div>
              <div className="text-muted-foreground mb-0.5 text-[11px]">{isEn ? "52W High" : "52주 고가"}</div>
              <div className="text-emerald-600 font-mono font-bold">{formatPrice(data.yearHigh, currency)}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-0.5 text-[11px]">{isEn ? "52W Low" : "52주 저가"}</div>
              <div className="text-red-500 font-mono font-bold">{formatPrice(data.yearLow, currency)}</div>
            </div>
            {(data as any).quoteInfo?.marketCap != null && (
              <div>
                <div className="text-muted-foreground mb-0.5 text-[11px]">{isEn ? "Mkt Cap" : "시가총액"}</div>
                <div className="font-mono font-bold text-foreground">
                  {(() => {
                    const cap = (data as any).quoteInfo.marketCap as number;
                    if (isEn) {
                      const tril = cap / 1e12;
                      if (tril >= 1) return `$${tril.toFixed(1)}T`;
                      const bil = cap / 1e9;
                      if (bil >= 1) return `$${bil.toFixed(1)}B`;
                      return `$${Math.round(cap / 1e6)}M`;
                    }
                    const tril = cap / 1e12;
                    if (tril >= 1) return `${tril.toFixed(1)}조`;
                    return `${Math.round(cap / 1e8)}억`;
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-2 border-b border-border flex gap-1.5 items-center overflow-x-auto scrollbar-none bg-muted/30">
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setPeriod(opt.value)} className={ctrlBtn(period === opt.value)}>
              {isEn ? opt.labelEn : opt.label}
            </button>
          ))}
        </div>
        <div className="w-px h-3.5 bg-border mx-0.5" />
        <div className="flex gap-1">
          {INTERVAL_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setInterval(opt.value)} className={ctrlBtn(interval === opt.value)}>
              {isEn ? opt.labelEn : opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="p-4">
        {isLoading && (
          <div className="h-80 flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" size={16} />
              <span className="text-sm">{isEn ? "Loading data..." : "데이터 로딩 중..."}</span>
            </div>
          </div>
        )}
        {error && (
          <div className="h-80 flex items-center justify-center">
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle size={16} />
              <span className="text-sm">{isEn ? `Unable to load data: ${ticker}` : `데이터를 불러올 수 없습니다: ${ticker}`}</span>
            </div>
          </div>
        )}
        {data && chartData.length > 0 && (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={chartDataWithSwings} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #e5e7eb)" vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tick={axisStyle}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.floor(chartData.length / 7)}
                  tickFormatter={(v: string) => {
                    if (!useLongDate) return v;
                    if (period === "1y") return v.slice(5, 10);
                    return v.slice(2, 7).replace("-", ".");
                  }}
                />
                <YAxis
                  yAxisId="price"
                  domain={[priceMin, priceMax]}
                  tick={axisStyle}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => currency === "USD" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v.toLocaleString("ko-KR")}
                  width={currency === "USD" ? 64 : 72}
                />
                <YAxis
                  yAxisId="volume"
                  orientation="right"
                  domain={[0, volumeDomainMax]}
                  tick={false}
                  tickLine={false}
                  axisLine={false}
                  width={0}
                />
                <Tooltip content={<CustomTooltip currency={currency} isEn={isEn} />} />

                {chartLevels?.stopLoss && chartLevels?.entryMin && (
                  <ReferenceArea yAxisId="price" y1={chartLevels.stopLoss} y2={chartLevels.entryMin} fill="#ef4444" fillOpacity={0.04} strokeOpacity={0} />
                )}
                {chartLevels?.entryMin && chartLevels?.entryMax && (
                  <ReferenceArea yAxisId="price" y1={chartLevels.entryMin} y2={chartLevels.entryMax} fill="#1d4ed8" fillOpacity={0.08} stroke="#1d4ed8" strokeOpacity={0.2} strokeDasharray="3 3" />
                )}
                {chartLevels?.target1 && chartLevels?.target2 && (
                  <ReferenceArea yAxisId="price" y1={chartLevels.target1} y2={chartLevels.target2} fill="#16a34a" fillOpacity={0.06} strokeOpacity={0} />
                )}

                <Bar yAxisId="volume" dataKey="volume" name={isEn ? "Volume" : "거래량"} fill="#d4d4d4" opacity={0.5} radius={[1, 1, 0, 0]} isAnimationActive={false} />

                <Line
                  yAxisId="price"
                  dataKey="close"
                  name={isEn ? "Price" : "주가"}
                  stroke={lineColor}
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 3, fill: lineColor }}
                />

                {showStopLossOnChart && (
                  <ReferenceLine yAxisId="price" y={chartLevels!.stopLoss!} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="3 2" />
                )}
                {chartLevels?.entryMin && (
                  <ReferenceLine yAxisId="price" y={chartLevels.entryMin} stroke="#1d4ed8" strokeWidth={1} strokeDasharray="4 2" />
                )}
                {chartLevels?.entryMax && (
                  <ReferenceLine yAxisId="price" y={chartLevels.entryMax} stroke="#1d4ed8" strokeWidth={1} strokeDasharray="4 2" />
                )}
                {showTarget1OnChart && (
                  <ReferenceLine yAxisId="price" y={chartLevels!.target1!} stroke="#16a34a" strokeWidth={1.5} strokeDasharray="5 3" />
                )}
                {showTarget2OnChart && (
                  <ReferenceLine yAxisId="price" y={chartLevels!.target2!} stroke="#15803d" strokeWidth={2} strokeDasharray="5 3" />
                )}

                {swings.map((swing, idx) => (
                  <ReferenceDot
                    key={`swing-${idx}`}
                    yAxisId="price"
                    x={swing.dateLabel}
                    y={swing.close}
                    r={5}
                    fill={swing.changePercent > 0 ? "#16a34a" : "#dc2626"}
                    stroke="white"
                    strokeWidth={1.5}
                    label={{
                      value: NUM_BADGES[idx] ?? `${idx + 1}`,
                      position: swing.changePercent > 0 ? "top" : "bottom",
                      fontSize: 10,
                      fill: swing.changePercent > 0 ? "#16a34a" : "#dc2626",
                      fontWeight: 700,
                    }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>

            {/* Level badges */}
            {chartLevels && Object.values(chartLevels).some(v => v && v > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5 px-1">
                {chartLevels.stopLoss && (
                  <LevelBadge label={isEn ? "Stop Loss" : "손절선"} value={chartLevels.stopLoss} color="#dc2626" currency={currency} isEn={isEn} />
                )}
                {chartLevels.entryMin && chartLevels.entryMax && (
                  <LevelBadge
                    label={isEn ? "Entry Zone" : "진입 구간"}
                    value={currency === "USD"
                      ? `$${chartLevels.entryMin.toLocaleString("en-US", { minimumFractionDigits: 2 })} ~ $${chartLevels.entryMax.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                      : isEn
                        ? `${chartLevels.entryMin.toLocaleString("en-US")} ~ ${chartLevels.entryMax.toLocaleString("en-US")}`
                        : `${chartLevels.entryMin.toLocaleString("ko-KR")} ~ ${chartLevels.entryMax.toLocaleString("ko-KR")}`
                    }
                    color="#1d4ed8"
                    currency={currency}
                    isEn={isEn}
                  />
                )}
                {chartLevels.target1 && (
                  <LevelBadge label={isEn ? "1st Target" : "1차 적정주가"} value={chartLevels.target1} color="#16a34a" currency={currency} isEn={isEn} />
                )}
                {chartLevels.target2 && (
                  <LevelBadge label={isEn ? "2nd Target" : "2차 목표"} value={chartLevels.target2} color="#15803d" currency={currency} isEn={isEn} />
                )}
              </div>
            )}

            {/* Price swing events */}
            {swings.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border">
                <button
                  className="flex items-center gap-2 w-full text-left mb-2"
                  onClick={() => setShowEvents(!showEvents)}
                >
                  <Sparkles size={12} className="text-amber-500 flex-shrink-0" />
                  <span className="text-[11px] font-semibold text-foreground/80 uppercase tracking-wider">
                    {isEn ? "Key Price Events" : "주요 주가 급변 이슈"}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-1">
                    ({isEn
                      ? `${swings.length} swing${swings.length > 1 ? "s" : ""} ≥${minSwingPct}%`
                      : `${minSwingPct}% 이상 급변 ${swings.length}건`})
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {showEvents ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </span>
                </button>

                {showEvents && (
                  <div className="space-y-2">
                    {swings.map((swing, idx) => {
                      const news = priceEventNews.find(n => n.date === swing.date);
                      const isPos = swing.changePercent > 0;
                      return (
                        <div
                          key={idx}
                          className="flex gap-3 p-2.5 rounded-lg border border-border bg-muted/30"
                        >
                          <div
                            className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                            style={{ backgroundColor: isPos ? "#16a34a" : "#dc2626" }}
                          >
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[11px] font-mono text-muted-foreground">{swing.date.slice(0, 10)}</span>
                              <span className={cn("text-[11px] font-bold", isPos ? "text-emerald-600" : "text-red-500")}>
                                {isPos ? "+" : ""}{swing.changePercent.toFixed(1)}%
                              </span>
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {priceLabel(swing.close, currency)}
                              </span>
                            </div>
                            {newsLoading && !news && (
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <Loader2 size={10} className="animate-spin" />
                                <span>{isEn ? "Analyzing..." : "이슈 분석 중..."}</span>
                              </div>
                            )}
                            {news && (
                              <p className="text-[11px] text-foreground/80 leading-relaxed">{news.summary}</p>
                            )}
                            {newsError && !news && !newsLoading && (
                              <p className="text-[11px] text-muted-foreground/50 italic">
                                {isEn ? "Failed to load event summary" : "이슈 조회 실패"}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
