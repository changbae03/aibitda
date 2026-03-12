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
  Area,
  AreaChart,
} from "recharts";
import { useGetMarketData } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Activity, Loader2, AlertCircle } from "lucide-react";

type Period = "3m" | "6m" | "1y" | "2y" | "5y";
type Interval = "1d" | "1wk" | "1mo";
type ChartType = "price" | "rsi" | "volume";

interface StockChartProps {
  ticker: string;
  companyName?: string;
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
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 text-xs shadow-xl min-w-[180px]">
      <p className="text-gray-400 mb-2 font-medium">{label}</p>
      {d?.close != null && (
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">종가</span>
            <span className="text-white font-bold">{formatPrice(d.close)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">고가</span>
            <span className="text-green-400">{formatPrice(d.high)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-gray-400">저가</span>
            <span className="text-red-400">{formatPrice(d.low)}</span>
          </div>
          {d.volume != null && (
            <div className="flex justify-between gap-4">
              <span className="text-gray-400">거래량</span>
              <span className="text-blue-400">{formatVolume(d.volume)}</span>
            </div>
          )}
          {d.rsi != null && (
            <div className="flex justify-between gap-4 border-t border-gray-700 pt-1 mt-1">
              <span className="text-gray-400">RSI(14)</span>
              <span className={cn(
                "font-bold",
                d.rsi > 70 ? "text-red-400" : d.rsi < 30 ? "text-green-400" : "text-yellow-400"
              )}>{d.rsi?.toFixed(1)}</span>
            </div>
          )}
        </div>
      )}
      {d?.rsi != null && d?.close == null && (
        <div className="flex justify-between gap-4">
          <span className="text-gray-400">RSI</span>
          <span className={cn(
            "font-bold",
            d.rsi > 70 ? "text-red-400" : d.rsi < 30 ? "text-green-400" : "text-yellow-400"
          )}>{d.rsi?.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
};

const RSITooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const rsi = payload[0]?.value;
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs shadow-xl">
      <p className="text-gray-400">{label}</p>
      <p className={cn(
        "font-bold",
        rsi > 70 ? "text-red-400" : rsi < 30 ? "text-green-400" : "text-yellow-400"
      )}>RSI: {rsi?.toFixed(1)}</p>
    </div>
  );
};

export default function StockChart({ ticker, companyName }: StockChartProps) {
  const [period, setPeriod] = useState<Period>("1y");
  const [interval, setInterval] = useState<Interval>("1d");
  const [showMA, setShowMA] = useState(true);
  const [showBB, setShowBB] = useState(false);
  const [activeChart, setActiveChart] = useState<ChartType>("price");

  const { data, isLoading, error } = useGetMarketData(ticker, { period, interval });

  const isUp = (data?.changePercent ?? 0) >= 0;

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

  const priceMin = chartData.length
    ? Math.min(...chartData.map((d) => d.low ?? d.close)) * 0.99
    : 0;
  const priceMax = chartData.length
    ? Math.max(...chartData.map((d) => d.high ?? d.close)) * 1.01
    : 100;

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">
                {companyName ?? ticker}
              </span>
              <span className="text-xs text-gray-500 font-mono">{ticker}</span>
            </div>
            {data && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xl font-bold text-white">
                  {formatPrice(data.currentPrice)}
                </span>
                <span className={cn(
                  "flex items-center gap-0.5 text-sm font-semibold",
                  isUp ? "text-green-400" : "text-red-400"
                )}>
                  {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {isUp ? "+" : ""}{data.changePercent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>

        {data && (
          <div className="flex flex-wrap gap-4 text-xs text-gray-400">
            <div>
              <div className="text-gray-600 mb-0.5">52주 고가</div>
              <div className="text-green-400 font-mono font-bold">{formatPrice(data.yearHigh)}</div>
            </div>
            <div>
              <div className="text-gray-600 mb-0.5">52주 저가</div>
              <div className="text-red-400 font-mono font-bold">{formatPrice(data.yearLow)}</div>
            </div>
            {data.currentRsi != null && (
              <div>
                <div className="text-gray-600 mb-0.5">RSI(14)</div>
                <div className={cn(
                  "font-mono font-bold",
                  data.currentRsi > 70 ? "text-red-400" :
                  data.currentRsi < 30 ? "text-green-400" : "text-yellow-400"
                )}>
                  {data.currentRsi.toFixed(1)}
                  {data.currentRsi > 70 && " ⚠️ 과열"}
                  {data.currentRsi < 30 && " 📉 침체"}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-2 border-b border-gray-800 flex flex-wrap gap-2 items-center">
        {/* Period */}
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={cn(
                "px-2 py-1 text-xs rounded font-medium transition-colors",
                period === opt.value
                  ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40"
                  : "text-gray-500 hover:text-gray-300"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-gray-700" />
        {/* Interval */}
        <div className="flex gap-1">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setInterval(opt.value)}
              className={cn(
                "px-2 py-1 text-xs rounded font-medium transition-colors",
                interval === opt.value
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/40"
                  : "text-gray-500 hover:text-gray-300"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="w-px h-4 bg-gray-700" />
        {/* Overlays */}
        <button
          onClick={() => setShowMA(!showMA)}
          className={cn(
            "px-2 py-1 text-xs rounded font-medium transition-colors",
            showMA ? "bg-purple-500/20 text-purple-400 border border-purple-500/40" : "text-gray-500 hover:text-gray-300"
          )}
        >
          MA
        </button>
        <button
          onClick={() => setShowBB(!showBB)}
          className={cn(
            "px-2 py-1 text-xs rounded font-medium transition-colors",
            showBB ? "bg-orange-500/20 text-orange-400 border border-orange-500/40" : "text-gray-500 hover:text-gray-300"
          )}
        >
          BB
        </button>
        <div className="w-px h-4 bg-gray-700" />
        {/* Chart tabs */}
        {(["price", "rsi", "volume"] as ChartType[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveChart(t)}
            className={cn(
              "px-2 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1",
              activeChart === t
                ? "bg-gray-700 text-white"
                : "text-gray-500 hover:text-gray-300"
            )}
          >
            <Activity size={10} />
            {t === "price" ? "주가" : t === "rsi" ? "RSI" : "거래량"}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="p-4">
        {isLoading && (
          <div className="h-72 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="animate-spin" size={16} />
              <span className="text-sm">데이터 로딩 중...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="h-72 flex items-center justify-center">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle size={16} />
              <span className="text-sm">데이터를 불러올 수 없습니다: {ticker}</span>
            </div>
          </div>
        )}
        {data && chartData.length > 0 && (
          <div>
            {activeChart === "price" && (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    tickLine={false}
                    interval={Math.floor(chartData.length / 8)}
                  />
                  <YAxis
                    domain={[priceMin, priceMax]}
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    tickLine={false}
                    tickFormatter={(v) => v.toLocaleString("ko-KR")}
                    width={70}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  />

                  {showBB && (
                    <>
                      <Line dataKey="bbUpper" name="BB 상단" stroke="#f97316" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
                      <Line dataKey="bbLower" name="BB 하단" stroke="#f97316" strokeWidth={1} dot={false} strokeDasharray="3 3" connectNulls />
                    </>
                  )}

                  <Line
                    dataKey="close"
                    name="종가"
                    stroke="#eab308"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                  />

                  {showMA && (
                    <>
                      <Line dataKey="ma20" name="MA20" stroke="#818cf8" strokeWidth={1.5} dot={false} connectNulls />
                      <Line dataKey="ma60" name="MA60" stroke="#34d399" strokeWidth={1.5} dot={false} connectNulls />
                      <Line dataKey="ma120" name="MA120" stroke="#f472b6" strokeWidth={1.5} dot={false} connectNulls />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}

            {activeChart === "rsi" && (
              <div>
                <div className="text-xs text-gray-500 mb-2">
                  RSI(14) — <span className="text-red-400">70 이상: 과열</span> / <span className="text-green-400">30 이하: 침체</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData.filter(d => d.rsi != null)} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis
                      dataKey="dateLabel"
                      tick={{ fontSize: 10, fill: "#6b7280" }}
                      tickLine={false}
                      interval={Math.floor(chartData.length / 8)}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "#6b7280" }}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip content={<RSITooltip />} />
                    <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.8} />
                    <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.8} />
                    <ReferenceLine y={50} stroke="#6b7280" strokeDasharray="2 4" strokeOpacity={0.4} />
                    <Line
                      dataKey="rsi"
                      name="RSI(14)"
                      stroke="#ef4444"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>

                {/* RSI Zone indicator */}
                {data.currentRsi != null && (
                  <div className="mt-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">현재 RSI(14)</span>
                      <span className={cn(
                        "text-sm font-bold",
                        data.currentRsi > 70 ? "text-red-400" :
                        data.currentRsi < 30 ? "text-green-400" : "text-yellow-400"
                      )}>
                        {data.currentRsi.toFixed(2)}
                        {data.currentRsi > 70 && " — 과매수 구간 (매도 고려)"}
                        {data.currentRsi < 30 && " — 과매도 구간 (매수 고려)"}
                        {data.currentRsi >= 30 && data.currentRsi <= 70 && " — 중립 구간"}
                      </span>
                    </div>
                    <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          data.currentRsi > 70 ? "bg-red-500" :
                          data.currentRsi < 30 ? "bg-green-500" : "bg-yellow-500"
                        )}
                        style={{ width: `${data.currentRsi}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeChart === "volume" && (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    tickLine={false}
                    interval={Math.floor(chartData.length / 8)}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    tickLine={false}
                    tickFormatter={formatVolume}
                    width={55}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs shadow-xl">
                          <p className="text-gray-400">{label}</p>
                          <p className="text-blue-400 font-bold">거래량: {formatVolume(payload[0]?.value as number)}</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="volume" name="거래량" fill="#3b82f6" opacity={0.8} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
