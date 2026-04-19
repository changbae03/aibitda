import { useState, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";

interface FinancialEntry {
  period: string;
  isEstimate: boolean;
  opIncomeFromMargin?: boolean;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingMargin: number | null;
}

interface FinancialData {
  ticker: string;
  currency: string;
  marketCap: number | null;
  annual: FinancialEntry[];
  quarterly: FinancialEntry[];
}

function formatAmount(value: number, currency: string): string {
  if (currency === "KRW") {
    const tril = value / 1e12;
    if (Math.abs(tril) >= 1) return `${tril.toFixed(1)}조`;
    const bil = value / 1e8;
    return `${Math.round(bil)}억`;
  }
  const bil = value / 1e9;
  if (Math.abs(bil) >= 1) return `$${bil.toFixed(1)}B`;
  const mil = value / 1e6;
  return `$${Math.round(mil)}M`;
}

function formatYAxis(value: number, currency: string): string {
  if (currency === "KRW") {
    const tril = value / 1e12;
    if (Math.abs(tril) >= 1) return `${tril.toFixed(0)}조`;
    const bil = value / 1e8;
    return `${Math.round(bil)}억`;
  }
  const bil = value / 1e9;
  if (Math.abs(bil) >= 1) return `$${bil.toFixed(0)}B`;
  return `$${(value / 1e6).toFixed(0)}M`;
}

const COLORS = {
  revenue: "#6366f1",
  operatingIncome: "#10b981",
  margin: "#ef4444",
  estimate: {
    revenue: "#a5b4fc",
    operatingIncome: "#6ee7b7",
  },
};

const CustomTooltip = ({ active, payload, label, currency, separateIncomeAxis }: any) => {
  if (!active || !payload?.length) return null;
  const entry: FinancialEntry | undefined = payload[0]?.payload;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg p-3 text-xs min-w-[160px]">
      <div className="font-semibold text-foreground mb-2">
        {label}
        {entry?.isEstimate && (
          <span className="ml-1.5 text-[10px] font-normal text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">추정치</span>
        )}
      </div>
      {payload.map((p: any) => (
        p.value != null && (
          <div key={p.dataKey} className="flex justify-between gap-4 mb-1">
            <span style={{ color: p.color }}>
              {p.dataKey === "revenue" ? "매출" :
               p.dataKey === "operatingIncome" ? "영업이익" : "영업이익률"}
              {p.dataKey === "operatingIncome" && entry?.opIncomeFromMargin && (
                <span className="ml-1 text-muted-foreground">(이익률 추정)</span>
              )}
            </span>
            <span className="font-mono font-semibold text-foreground">
              {p.dataKey === "operatingMargin"
                ? `${Number(p.value).toFixed(1)}%`
                : formatAmount(p.value, currency)}
            </span>
          </div>
        )
      ))}
      {separateIncomeAxis && (
        <div className="mt-1.5 pt-1.5 border-t border-border/50 text-[10px] text-muted-foreground">
          * 매출·영업이익 축 독립 적용
        </div>
      )}
    </div>
  );
};

export default function FinancialChart({ ticker }: { ticker: string }) {
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [view, setView] = useState<"annual" | "quarterly">("annual");

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/market-data/financials/${encodeURIComponent(ticker)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [ticker]);

  if (loading) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        재무 데이터 로딩 중...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
        재무 데이터를 불러올 수 없습니다
      </div>
    );
  }

  const entries = (view === "annual" ? data.annual : data.quarterly)
    .filter((e) => e.revenue != null || e.operatingIncome != null)
    .sort((a, b) => a.period.localeCompare(b.period)); // 왼쪽=옛날, 오른쪽=최신

  if (!entries.length) {
    return (
      <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
        표시할 데이터가 없습니다
      </div>
    );
  }

  const currency = data.currency;

  const revenueVals = entries.map((e) => e.revenue).filter((v): v is number => v != null);
  const incomeVals = entries.map((e) => e.operatingIncome).filter((v): v is number => v != null);

  const maxRevenue = revenueVals.length ? Math.max(...revenueVals) : 0;
  const minRevenue = revenueVals.length ? Math.min(...revenueVals) : 0;
  const maxIncomeAbs = incomeVals.length ? Math.max(...incomeVals.map(Math.abs)) : 0;
  const minIncome = incomeVals.length ? Math.min(...incomeVals) : 0;
  const maxIncome = incomeVals.length ? Math.max(...incomeVals) : 0;

  // Detect extreme scale difference: use separate income axis only when revenue >> income
  // e.g. Tesla 2024: revenue $97B, operating income $2B → ratio ~48 → separate
  // NVIDIA: revenue $130B, operating income $81B → ratio ~1.6 → same axis
  const scaleRatio = maxRevenue > 0 && maxIncomeAbs > 0
    ? maxRevenue / maxIncomeAbs
    : 1;
  const separateIncomeAxis = scaleRatio > 12 && incomeVals.length > 0;

  // Combined domain (for single-axis mode)
  const allVals = [...revenueVals, ...incomeVals];
  const allMax = allVals.length ? Math.max(...allVals) : 0;
  const allMin = allVals.length ? Math.min(...allVals) : 0;
  const hasNegative = allMin < 0;
  const leftDomain: [number, number] = hasNegative
    ? [Math.floor(allMin * 1.3), Math.ceil(allMax * 1.15)]
    : [0, Math.ceil(allMax * 1.15) || 1];

  // Separate income domain (for extreme-scale mode)
  const incomeHasNeg = minIncome < 0;
  const incomeDomain: [number, number] = incomeHasNeg
    ? [Math.floor(minIncome * 1.3), Math.ceil(maxIncome * 1.15)]
    : [0, Math.ceil(maxIncome * 1.15) || 1];

  // Revenue-only domain (for extreme-scale mode left axis)
  const revHasNeg = minRevenue < 0;
  const revenueDomain: [number, number] = revHasNeg
    ? [Math.floor(minRevenue * 1.3), Math.ceil(maxRevenue * 1.15)]
    : [0, Math.ceil(maxRevenue * 1.15) || 1];

  // Margin axis
  const allMargins = entries
    .map((e) => e.operatingMargin)
    .filter((v): v is number => v != null);
  const minMargin = allMargins.length ? Math.min(...allMargins) : 0;
  const maxMargin = allMargins.length ? Math.max(...allMargins) : 60;
  const marginMin = Math.min(minMargin - 5, -5);
  const marginMax = Math.max(maxMargin + 5, 10);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">매출 · 이익 추이</h3>
          {separateIncomeAxis && (
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">
              이익 별도 축
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(["annual", "quarterly"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors",
                view === v
                  ? "bg-primary text-white"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {v === "annual" ? "연간" : "분기"}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        {separateIncomeAxis ? (
          // ── Extreme-scale mode: revenue on left, income on right (hidden) ──
          <ComposedChart data={entries} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="rev" orientation="left"
              tickFormatter={(v) => formatYAxis(v, currency)}
              tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              domain={revenueDomain} width={52} />
            <YAxis yAxisId="inc" orientation="right"
              tickFormatter={(v) => formatYAxis(v, currency)}
              tick={{ fontSize: 10, fill: COLORS.operatingIncome }}
              axisLine={false} tickLine={false} domain={incomeDomain} hide />
            <YAxis yAxisId="margin" orientation="right"
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              domain={[marginMin, marginMax]} width={36} />
            {(hasNegative || incomeHasNeg) && (
              <ReferenceLine yAxisId="rev" y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />
            )}
            <Tooltip content={<CustomTooltip currency={currency} separateIncomeAxis={separateIncomeAxis} />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              formatter={(value) =>
                value === "revenue" ? "매출" :
                value === "operatingIncome" ? "영업이익 (별도 축)" : "영업이익률"
              } />
            <Bar yAxisId="rev" dataKey="revenue" name="revenue" radius={[3, 3, 0, 0]} maxBarSize={36}>
              {entries.map((e, i) => <Cell key={i} fill={e.isEstimate ? COLORS.estimate.revenue : COLORS.revenue} />)}
            </Bar>
            <Bar yAxisId="inc" dataKey="operatingIncome" name="operatingIncome" radius={[3, 3, 0, 0]} maxBarSize={36}>
              {entries.map((e, i) => <Cell key={i} fill={e.isEstimate ? COLORS.estimate.operatingIncome : COLORS.operatingIncome} />)}
            </Bar>
            <Line yAxisId="margin" dataKey="operatingMargin" name="operatingMargin"
              stroke={COLORS.margin} strokeWidth={2}
              dot={{ r: 3, fill: COLORS.margin, strokeWidth: 0 }} activeDot={{ r: 4 }}
              connectNullData={false} />
          </ComposedChart>
        ) : (
          // ── Normal mode: revenue + income share the left axis ──
          <ComposedChart data={entries} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="left" orientation="left"
              tickFormatter={(v) => formatYAxis(v, currency)}
              tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              domain={leftDomain} width={52} />
            <YAxis yAxisId="right" orientation="right"
              tickFormatter={(v) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              domain={[marginMin, marginMax]} width={36} />
            {hasNegative && (
              <ReferenceLine yAxisId="left" y={0} stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth={1} />
            )}
            <Tooltip content={<CustomTooltip currency={currency} separateIncomeAxis={false} />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
              formatter={(value) =>
                value === "revenue" ? "매출" :
                value === "operatingIncome" ? "영업이익" : "영업이익률"
              } />
            <Bar yAxisId="left" dataKey="revenue" name="revenue" radius={[3, 3, 0, 0]} maxBarSize={36}>
              {entries.map((e, i) => <Cell key={i} fill={e.isEstimate ? COLORS.estimate.revenue : COLORS.revenue} />)}
            </Bar>
            <Bar yAxisId="left" dataKey="operatingIncome" name="operatingIncome" radius={[3, 3, 0, 0]} maxBarSize={36}>
              {entries.map((e, i) => <Cell key={i} fill={e.isEstimate ? COLORS.estimate.operatingIncome : COLORS.operatingIncome} />)}
            </Bar>
            <Line yAxisId="right" dataKey="operatingMargin" name="operatingMargin"
              stroke={COLORS.margin} strokeWidth={2}
              dot={{ r: 3, fill: COLORS.margin, strokeWidth: 0 }} activeDot={{ r: 4 }}
              connectNullData={false} />
          </ComposedChart>
        )}
      </ResponsiveContainer>

      <div className="flex flex-col items-end gap-0.5">
        {entries.some((e) => e.isEstimate) && (
          <p className="text-[10px] text-muted-foreground">옅은 색 = 컨센서스 추정치</p>
        )}
        {separateIncomeAxis && (
          <p className="text-[10px] text-muted-foreground">
            매출·영업이익 스케일 차이로 독립 축 적용 — 실제값은 툴팁 참조
          </p>
        )}
      </div>
    </div>
  );
}
