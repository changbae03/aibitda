import { useState } from "react";
import {
  ComposedChart,
  LineChart,
  BarChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { useGetMarketData } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Activity, Loader2, AlertCircle } from "lucide-react";

type Period = "3m" | "6m" | "1y" | "2y" | "5y";
type Interval = "1d" | "1wk" | "1mo";
type ChartType = "price" | "rsi" | "volume";

export interface ChartLevels {
  support?: number;
  resistance?: number;
  entryMin?: number;
  entryMax?: number;
  stopLoss?: number;
  target1?: number;
  target2?: number;
}

interface StockChartProps {
  ticker: string;
  companyName?: string;
  chartLevels?: ChartLevels;
}

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "3m", label: "3개월" },
  { value: "6m", label: "6개월" },
  { value: "1y", label: "1년" },
  { value: "2y", label: "2년" },
  { value: "5y", label: "5년" },
];

const INTERVAL_OPTIONS: { value: Interval; label: string }[] = [
  { value: "1d", label: "일봉" },
  { value: "1wk", label: "주봉" },
  { value: "1mo", label: "월봉" },
];

function formatPrice(v: number | null | undefined) {
  if (v == null) return "—";
  return v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function formatVolume(v: number | null | undefined) {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white border border-border rounded-lg p-3 text-xs shadow-lg min-w-[160px]">
      <p className="text-muted-foreground mb-2 font-medium">{label}</p>
      {d?.close != null && (
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">종가</span>
            <span className="text-foreground font-bold">{formatPrice(d.close)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">고가</span>
            <span className="text-success">{formatPrice(d.high)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">저가</span>
            <span className="text-destructive">{formatPrice(d.low)}</span>
          </div>
          {d.volume != null && (
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">거래량</span>
              <span className="text-primary">{formatVolume(d.volume)}</span>
            </div>
          )}
          {d.rsi != null && (
            <div className="flex justify-between gap-4 border-t border-border pt-1 mt-1">
              <span className="text-muted-foreground">RSI(14)</span>
              <span className={cn(
                "font-bold",
                d.rsi > 70 ? "text-destructive" : d.rsi < 30 ? "text-success" : "text-warning"
              )}>{d.rsi?.toFixed(1)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const RSITooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const rsi = payload[0]?.value;
  return (
    <div className="bg-white border border-border rounded-lg p-2 text-xs shadow-lg">
      <p className="text-muted-foreground">{label}</p>
      <p className={cn(
        "font-bold",
        rsi > 70 ? "text-destructive" : rsi < 30 ? "text-success" : "text-warning"
      )}>RSI: {rsi?.toFixed(1)}</p>
    </div>
  );
};

const ctrlBtn = (active: boolean, color = "primary") =>
  cn(
    "px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
    active
      ? `bg-primary/10 text-primary border border-primary/30`
      : "text-muted-foreground hover:text-foreground hover:bg-muted"
  );

function LevelBadge({ label, value, color }: { label: string; value: number | string; color: string }) {
  const display = typeof value === "number" ? `${value.toLocaleString("ko-KR")}원` : value + "원";
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium" style={{ borderColor: `${color}40`, backgroundColor: `${color}10`, color }}>
      <span className="w-2 h-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-muted-foreground font-normal">{label}</span>
      <span className="font-mono font-semibold">{display}</span>
    </div>
  );
}

export default function StockChart({ ticker, companyName, chartLevels }: StockChartProps) {
  const [period, setPeriod] = useState<Period>("1y");
  const [interval, setInterval] = useState<Interval>("1d");
  const [showMA, setShowMA] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [activeChart, setActiveChart] = useState<ChartType>("price");

  const { data, isLoading, error } = useGetMarketData(ticker, { period, interval });

  const isUp = (data?.changePercent ?? 0) >= 0;
  const nxtInfo = (data as any)?.nxtInfo as { price: number; changePercent: number; compareToPrev: string; at: string; sessionType: string; status: string } | null | undefined;
  const nxtIsUp = (nxtInfo?.changePercent ?? 0) >= 0;

  const chartData = data?.candles?.map((c) => ({
    ...c,
    rsi: c.rsi != null ? parseFloat(c.rsi.toFixed(2)) : null,
    close: parseFloat(c.close.toFixed(2)),
    ma20: c.ma20 != null ? parseFloat(c.ma20.toFixed(2)) : null,
    ma60: c.ma60 != null ? parseFloat(c.ma60.toFixed(2)) : null,
    ma120: c.ma120 != null ? parseFloat(c.ma120.toFixed(2)) : null,
    bbUpper: c.bbUpper != null ? parseFloat(c.bbUpper.toFixed(2)) : null,
    bbLower: c.bbLower != null ? parseFloat(c.bbLower.toFixed(2)) : null,
    dateLabel: c.date.slice(5),
  })) ?? [];

  const priceMin = chartData.length ? Math.min(...chartData.map((d) => d.low ?? d.close)) * 0.99 : 0;
  const priceMax = chartData.length ? Math.max(...chartData.map((d) => d.high ?? d.close)) * 1.01 : 100;

  const axisStyle = { fontSize: 10, fill: "#9ca3af" };
  const gridColor = "#e5e7eb";

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-foreground">{companyName ?? ticker}</span>
            <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{ticker}</span>
          </div>
          {data && (
            <div className="flex flex-col gap-0.5 mt-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold text-foreground font-mono">{formatPrice(data.currentPrice)}</span>
                <span className={cn(
                  "flex items-center gap-0.5 text-sm font-semibold",
                  isUp ? "text-success" : "text-destructive"
                )}>
                  {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {isUp ? "+" : ""}{data.changePercent.toFixed(2)}%
                </span>
                <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">KRX 종가</span>
              </div>
              {nxtInfo && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                    {nxtInfo.sessionType === "AFTER_MARKET" ? "NXT 장후" : "NXT 장전"}
                    {nxtInfo.status === "OPEN" ? " 거래중" : ""}
                  </span>
                  <span className="font-mono font-bold text-sm text-foreground">{formatPrice(nxtInfo.price)}</span>
                  <span className={cn("text-xs font-semibold", nxtIsUp ? "text-success" : "text-destructive")}>
                    {nxtIsUp ? "+" : ""}{nxtInfo.changePercent.toFixed(2)}%
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    ({nxtInfo.compareToPrev}원)
                  </span>
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
          <div className="flex gap-5 text-xs">
            <div>
              <div className="text-muted-foreground mb-0.5">52주 고가</div>
              <div className="text-success font-mono font-bold">{formatPrice(data.yearHigh)}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-0.5">52주 저가</div>
              <div className="text-destructive font-mono font-bold">{formatPrice(data.yearLow)}</div>
            </div>
            {data.currentRsi != null && (
              <div>
                <div className="text-muted-foreground mb-0.5">RSI(14)</div>
                <div className={cn(
                  "font-mono font-bold",
                  data.currentRsi > 70 ? "text-destructive" :
                  data.currentRsi < 30 ? "text-success" : "text-warning"
                )}>
                  {data.currentRsi.toFixed(1)}
                  {data.currentRsi > 70 && " ⚠ 과열"}
                  {data.currentRsi < 30 && " 침체"}
                </div>
              </div>
            )}
            {(data as any).quoteInfo?.marketCap != null && (
              <div>
                <div className="text-muted-foreground mb-0.5">시가총액</div>
                <div className="font-mono font-bold text-foreground">
                  {(() => {
                    const cap = (data as any).quoteInfo.marketCap as number;
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
      <div className="px-4 py-2.5 border-b border-border flex flex-wrap gap-1.5 items-center bg-muted/30">
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setPeriod(opt.value)} className={ctrlBtn(period === opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="w-px h-3.5 bg-border mx-0.5" />
        <div className="flex gap-1">
          {INTERVAL_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setInterval(opt.value)} className={ctrlBtn(interval === opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="w-px h-3.5 bg-border mx-0.5" />
        <button onClick={() => setShowMA(!showMA)} className={ctrlBtn(showMA)}>MA</button>
        <button onClick={() => setShowBB(!showBB)} className={ctrlBtn(showBB)}>BB</button>
        <div className="w-px h-3.5 bg-border mx-0.5" />
        {(["price", "rsi", "volume"] as ChartType[]).map((t) => (
          <button key={t} onClick={() => setActiveChart(t)} className={ctrlBtn(activeChart === t)}>
            {t === "price" ? "주가" : t === "rsi" ? "RSI" : "거래량"}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="p-4">
        {isLoading && (
          <div className="h-72 flex items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" size={16} />
              <span className="text-sm">데이터 로딩 중...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="h-72 flex items-center justify-center">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle size={16} />
              <span className="text-sm">데이터를 불러올 수 없습니다: {ticker}</span>
            </div>
          </div>
        )}
        {data && chartData.length > 0 && (
          <div>
            {activeChart === "price" && (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="dateLabel" tick={axisStyle} tickLine={false} interval={Math.floor(chartData.length / 8)} />
                    <YAxis domain={[priceMin, priceMax]} tick={axisStyle} tickLine={false} tickFormatter={(v) => v.toLocaleString("ko-KR")} width={70} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />

                    {/* AI 기술적 분석 레벨 — 진입 구간 영역 */}
                    {chartLevels?.entryMin && chartLevels?.entryMax && (
                      <ReferenceArea
                        y1={chartLevels.entryMin}
                        y2={chartLevels.entryMax}
                        fill="#2563b0"
                        fillOpacity={0.08}
                        strokeOpacity={0}
                      />
                    )}

                    {showBB && (
                      <>
                        <Line dataKey="bbUpper" name="BB 상단" stroke="#f97316" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
                        <Line dataKey="bbLower" name="BB 하단" stroke="#f97316" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
                      </>
                    )}

                    <Line dataKey="close" name="종가" stroke="#2563b0" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />

                    {showMA && (
                      <>
                        <Line dataKey="ma20" name="MA20" stroke="#818cf8" strokeWidth={1.5} dot={false} connectNulls />
                        <Line dataKey="ma60" name="MA60" stroke="#10b981" strokeWidth={1.5} dot={false} connectNulls />
                        <Line dataKey="ma120" name="MA120" stroke="#f472b6" strokeWidth={1.5} dot={false} connectNulls />
                      </>
                    )}

                    {/* AI 기술적 분석 레벨 — 개별 라인 */}
                    {chartLevels?.resistance && (
                      <ReferenceLine y={chartLevels.resistance} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3" label={{ value: "저항", position: "right", fontSize: 9, fill: "#ef4444" }} />
                    )}
                    {chartLevels?.support && (
                      <ReferenceLine y={chartLevels.support} stroke="#22c55e" strokeWidth={1.5} strokeDasharray="5 3" label={{ value: "지지", position: "right", fontSize: 9, fill: "#22c55e" }} />
                    )}
                    {chartLevels?.stopLoss && (
                      <ReferenceLine y={chartLevels.stopLoss} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="3 3" label={{ value: "손절", position: "right", fontSize: 9, fill: "#dc2626" }} />
                    )}
                    {chartLevels?.target1 && (
                      <ReferenceLine y={chartLevels.target1} stroke="#16a34a" strokeWidth={1.5} strokeDasharray="4 3" label={{ value: "목표1", position: "right", fontSize: 9, fill: "#16a34a" }} />
                    )}
                    {chartLevels?.target2 && (
                      <ReferenceLine y={chartLevels.target2} stroke="#15803d" strokeWidth={2} strokeDasharray="4 3" label={{ value: "목표2", position: "right", fontSize: 9, fill: "#15803d" }} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>

                {/* 차트 레벨 범례 */}
                {chartLevels && Object.values(chartLevels).some(v => v && v > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2 px-1">
                    {chartLevels.resistance && <LevelBadge label="저항선" value={chartLevels.resistance} color="#ef4444" />}
                    {chartLevels.support && <LevelBadge label="지지선" value={chartLevels.support} color="#22c55e" />}
                    {chartLevels.entryMin && chartLevels.entryMax && (
                      <LevelBadge label="진입구간" value={`${chartLevels.entryMin.toLocaleString("ko-KR")} ~ ${chartLevels.entryMax.toLocaleString("ko-KR")}`} color="#2563b0" />
                    )}
                    {chartLevels.stopLoss && <LevelBadge label="손절선" value={chartLevels.stopLoss} color="#dc2626" />}
                    {chartLevels.target1 && <LevelBadge label="1차 목표" value={chartLevels.target1} color="#16a34a" />}
                    {chartLevels.target2 && <LevelBadge label="2차 목표" value={chartLevels.target2} color="#15803d" />}
                  </div>
                )}
              </>
            )}

            {activeChart === "rsi" && (
              <div>
                <div className="text-xs text-muted-foreground mb-2">
                  RSI(14) — <span className="text-destructive font-medium">70 이상: 과열</span> / <span className="text-success font-medium">30 이하: 침체</span>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={chartData.filter(d => d.rsi != null)} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="dateLabel" tick={axisStyle} tickLine={false} interval={Math.floor(chartData.length / 8)} />
                    <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} width={35} />
                    <Tooltip content={<RSITooltip />} />
                    <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.7} />
                    <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.7} />
                    <ReferenceLine y={50} stroke="#9ca3af" strokeDasharray="2 4" strokeOpacity={0.5} />
                    <Line dataKey="rsi" name="RSI(14)" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>

                {data.currentRsi != null && (
                  <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">현재 RSI(14)</span>
                      <span className={cn(
                        "text-sm font-bold",
                        data.currentRsi > 70 ? "text-destructive" :
                        data.currentRsi < 30 ? "text-success" : "text-warning"
                      )}>
                        {data.currentRsi.toFixed(2)}
                        {data.currentRsi > 70 && " — 과매수 (매도 고려)"}
                        {data.currentRsi < 30 && " — 과매도 (매수 고려)"}
                        {data.currentRsi >= 30 && data.currentRsi <= 70 && " — 중립"}
                      </span>
                    </div>
                    <div className="h-1.5 bg-border rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          data.currentRsi > 70 ? "bg-destructive" :
                          data.currentRsi < 30 ? "bg-success" : "bg-warning"
                        )}
                        style={{ width: `${data.currentRsi}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeChart === "volume" && (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="dateLabel" tick={axisStyle} tickLine={false} interval={Math.floor(chartData.length / 8)} />
                  <YAxis tick={axisStyle} tickLine={false} tickFormatter={formatVolume} width={52} />
                  <Tooltip content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-white border border-border rounded-lg p-2 text-xs shadow-lg">
                        <p className="text-muted-foreground">{label}</p>
                        <p className="text-primary font-bold">거래량: {formatVolume(payload[0]?.value as number)}</p>
                      </div>
                    );
                  }} />
                  <Bar dataKey="volume" name="거래량" fill="#2563b0" opacity={0.7} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
