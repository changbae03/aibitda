import { useState } from "react";
import {
  ComposedChart,
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
import { TrendingUp, TrendingDown, Loader2, AlertCircle } from "lucide-react";

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
    <div className="bg-white border border-neutral-200 rounded-lg p-3 text-xs shadow-lg min-w-[160px]">
      <p className="text-neutral-400 mb-2 font-medium">{label}</p>
      {d?.close != null && (
        <div className="space-y-1.5">
          <div className="flex justify-between gap-4">
            <span className="text-neutral-400">종가</span>
            <span className="text-neutral-900 font-bold font-mono">{formatPrice(d.close)}원</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-400">고가</span>
            <span className="text-emerald-600 font-mono">{formatPrice(d.high)}원</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-neutral-400">저가</span>
            <span className="text-red-500 font-mono">{formatPrice(d.low)}원</span>
          </div>
          {d.volume != null && (
            <div className="flex justify-between gap-4 border-t border-neutral-100 pt-1.5 mt-0.5">
              <span className="text-neutral-400">거래량</span>
              <span className="text-neutral-600 font-mono">{formatVolume(d.volume)}</span>
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
      ? "bg-neutral-900 text-white"
      : "text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
  );

function LevelBadge({ label, value, color }: { label: string; value: number | string; color: string }) {
  const display = typeof value === "number" ? `${value.toLocaleString("ko-KR")}원` : value + "원";
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium" style={{ borderColor: `${color}40`, backgroundColor: `${color}10`, color }}>
      <span className="w-2 h-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-neutral-400 font-normal">{label}</span>
      <span className="font-mono font-semibold">{display}</span>
    </div>
  );
}

export default function StockChart({ ticker, companyName, chartLevels }: StockChartProps) {
  const [period, setPeriod] = useState<Period>("1y");
  const [interval, setInterval] = useState<Interval>("1d");

  const { data, isLoading, error } = useGetMarketData(ticker, { period, interval });

  const isUp = (data?.changePercent ?? 0) >= 0;
  const nxtInfo = (data as any)?.nxtInfo as { price: number; changePercent: number; compareToPrev: string; at: string; sessionType: string; status: string } | null | undefined;
  const nxtIsUp = (nxtInfo?.changePercent ?? 0) >= 0;

  const chartData = data?.candles?.map((c) => ({
    ...c,
    close: parseFloat(c.close.toFixed(2)),
    dateLabel: c.date.slice(5),
  })) ?? [];

  const priceMin = chartData.length ? Math.min(...chartData.map((d) => d.low ?? d.close)) * 0.99 : 0;
  const priceMax = chartData.length ? Math.max(...chartData.map((d) => d.high ?? d.close)) * 1.01 : 100;
  const maxVolume = chartData.length ? Math.max(...chartData.map((d) => d.volume ?? 0)) : 1;
  // 거래량을 차트 아래쪽 25%에만 표시하도록 Y축 스케일 확대
  const volumeDomainMax = maxVolume * 5;

  const axisStyle = { fontSize: 10, fill: "#a3a3a3", fontFamily: "'Noto Sans KR', sans-serif" };
  const gridColor = "#f0f0f0";

  return (
    <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-neutral-900">{companyName ?? ticker}</span>
            <span className="text-xs text-neutral-400 font-mono bg-neutral-100 px-1.5 py-0.5 rounded">{ticker}</span>
          </div>
          {data && (
            <div className="flex flex-col gap-0.5 mt-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold text-neutral-900 font-mono tracking-tight">
                  {formatPrice(data.currentPrice)}
                  <span className="text-sm font-normal text-neutral-400 ml-0.5">원</span>
                </span>
                <span className={cn(
                  "flex items-center gap-0.5 text-sm font-semibold",
                  isUp ? "text-emerald-600" : "text-red-500"
                )}>
                  {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {isUp ? "+" : ""}{data.changePercent.toFixed(2)}%
                </span>
                <span className="text-[10px] text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded font-mono">KRX</span>
              </div>
              {nxtInfo && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] font-bold text-neutral-900 bg-neutral-100 px-1.5 py-0.5 rounded border border-neutral-200">
                    {nxtInfo.sessionType === "AFTER_MARKET" ? "NXT 장후" : "NXT 장전"}
                    {nxtInfo.status === "OPEN" ? " 거래중" : ""}
                  </span>
                  <span className="font-mono font-bold text-sm text-neutral-900">{formatPrice(nxtInfo.price)}</span>
                  <span className={cn("text-xs font-semibold", nxtIsUp ? "text-emerald-600" : "text-red-500")}>
                    {nxtIsUp ? "+" : ""}{nxtInfo.changePercent.toFixed(2)}%
                  </span>
                  <span className="text-[10px] text-neutral-400">({nxtInfo.compareToPrev}원)</span>
                  {nxtInfo.at && (
                    <span className="text-[10px] text-neutral-400 hidden sm:inline">
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
              <div className="text-neutral-400 mb-0.5 text-[11px]">52주 고가</div>
              <div className="text-emerald-600 font-mono font-bold">{formatPrice(data.yearHigh)}</div>
            </div>
            <div>
              <div className="text-neutral-400 mb-0.5 text-[11px]">52주 저가</div>
              <div className="text-red-500 font-mono font-bold">{formatPrice(data.yearLow)}</div>
            </div>
            {(data as any).quoteInfo?.marketCap != null && (
              <div>
                <div className="text-neutral-400 mb-0.5 text-[11px]">시가총액</div>
                <div className="font-mono font-bold text-neutral-900">
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
      <div className="px-4 py-2 border-b border-neutral-100 flex gap-1.5 items-center overflow-x-auto scrollbar-none bg-neutral-50/50">
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setPeriod(opt.value)} className={ctrlBtn(period === opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="w-px h-3.5 bg-neutral-200 mx-0.5" />
        <div className="flex gap-1">
          {INTERVAL_OPTIONS.map((opt) => (
            <button key={opt.value} onClick={() => setInterval(opt.value)} className={ctrlBtn(interval === opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="p-4">
        {isLoading && (
          <div className="h-80 flex items-center justify-center">
            <div className="flex items-center gap-2 text-neutral-400">
              <Loader2 className="animate-spin" size={16} />
              <span className="text-sm">데이터 로딩 중...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="h-80 flex items-center justify-center">
            <div className="flex items-center gap-2 text-red-500">
              <AlertCircle size={16} />
              <span className="text-sm">데이터를 불러올 수 없습니다: {ticker}</span>
            </div>
          </div>
        )}
        {data && chartData.length > 0 && (
          <>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tick={axisStyle}
                  tickLine={false}
                  axisLine={false}
                  interval={Math.floor(chartData.length / 7)}
                />
                {/* 주가 Y축 (왼쪽) */}
                <YAxis
                  yAxisId="price"
                  domain={[priceMin, priceMax]}
                  tick={axisStyle}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => v.toLocaleString("ko-KR")}
                  width={72}
                />
                {/* 거래량 Y축 (오른쪽 숨김 — 스케일만 담당) */}
                <YAxis
                  yAxisId="volume"
                  orientation="right"
                  domain={[0, volumeDomainMax]}
                  tick={false}
                  tickLine={false}
                  axisLine={false}
                  width={0}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", paddingTop: "10px", fontFamily: "'Noto Sans KR', sans-serif" }}
                  formatter={(value) => <span style={{ color: "#737373" }}>{value}</span>}
                />

                {/* 진입 구간 영역 */}
                {chartLevels?.entryMin && chartLevels?.entryMax && (
                  <ReferenceArea
                    yAxisId="price"
                    y1={chartLevels.entryMin}
                    y2={chartLevels.entryMax}
                    fill="#1d4ed8"
                    fillOpacity={0.06}
                    strokeOpacity={0}
                  />
                )}

                {/* 거래량 바 — 아래쪽 20%에 반투명 표시 */}
                <Bar
                  yAxisId="volume"
                  dataKey="volume"
                  name="거래량"
                  fill="#d4d4d4"
                  opacity={0.6}
                  radius={[1, 1, 0, 0]}
                  isAnimationActive={false}
                />

                {/* 종가 라인 */}
                <Line
                  yAxisId="price"
                  dataKey="close"
                  name="주가"
                  stroke="#0a0a0a"
                  strokeWidth={1.8}
                  dot={false}
                  activeDot={{ r: 3, fill: "#0a0a0a" }}
                />

                {/* 기술적 분석 라인 */}
                {chartLevels?.resistance && (
                  <ReferenceLine yAxisId="price" y={chartLevels.resistance} stroke="#ef4444" strokeWidth={1.2} strokeDasharray="5 3" label={{ value: "저항", position: "right", fontSize: 9, fill: "#ef4444" }} />
                )}
                {chartLevels?.support && (
                  <ReferenceLine yAxisId="price" y={chartLevels.support} stroke="#22c55e" strokeWidth={1.2} strokeDasharray="5 3" label={{ value: "지지", position: "right", fontSize: 9, fill: "#22c55e" }} />
                )}
                {chartLevels?.stopLoss && (
                  <ReferenceLine yAxisId="price" y={chartLevels.stopLoss} stroke="#dc2626" strokeWidth={1.2} strokeDasharray="3 3" label={{ value: "손절", position: "right", fontSize: 9, fill: "#dc2626" }} />
                )}
                {chartLevels?.target1 && (
                  <ReferenceLine yAxisId="price" y={chartLevels.target1} stroke="#16a34a" strokeWidth={1.2} strokeDasharray="4 3" label={{ value: "목표1", position: "right", fontSize: 9, fill: "#16a34a" }} />
                )}
                {chartLevels?.target2 && (
                  <ReferenceLine yAxisId="price" y={chartLevels.target2} stroke="#15803d" strokeWidth={1.5} strokeDasharray="4 3" label={{ value: "목표2", position: "right", fontSize: 9, fill: "#15803d" }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>

            {/* 기술적 분석 레벨 배지 */}
            {chartLevels && Object.values(chartLevels).some(v => v && v > 0) && (
              <div className="mt-3 flex flex-wrap gap-2 px-1">
                {chartLevels.resistance && <LevelBadge label="저항선" value={chartLevels.resistance} color="#ef4444" />}
                {chartLevels.support && <LevelBadge label="지지선" value={chartLevels.support} color="#22c55e" />}
                {chartLevels.entryMin && chartLevels.entryMax && (
                  <LevelBadge label="진입구간" value={`${chartLevels.entryMin.toLocaleString("ko-KR")} ~ ${chartLevels.entryMax.toLocaleString("ko-KR")}`} color="#1d4ed8" />
                )}
                {chartLevels.stopLoss && <LevelBadge label="손절선" value={chartLevels.stopLoss} color="#dc2626" />}
                {chartLevels.target1 && <LevelBadge label="1차 목표" value={chartLevels.target1} color="#16a34a" />}
                {chartLevels.target2 && <LevelBadge label="2차 목표" value={chartLevels.target2} color="#15803d" />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
