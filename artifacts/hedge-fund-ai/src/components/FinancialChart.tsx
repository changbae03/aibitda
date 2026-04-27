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
import { cn, getApiUrl } from "@/lib/utils";

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

function formatPeriodLabel(period: string, view: "annual" | "quarterly"): string {
  if (view === "annual") {
    // 연간: "2024" or "2024-12" → "2024"
    return period.slice(0, 4);
  }
  // 분기: "2025-06" → month=06 → Q2 → "2Q25"
  const match = period.match(/^(\d{4})[-.](\d{2})$/);
  if (!match) return period;
  const year = match[1].slice(2); // "25"
  const month = parseInt(match[2], 10);
  const q = Math.ceil(month / 3); // 1~12 → Q1~Q4
  return `${q}Q${year}`;
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
    <div className="bg-background border border-border rounded-xl shadow-lg p-3 text-xs min-w-[160px]">
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
    fetch(getApiUrl(`/api/market-data/financials/${encodeURIComponent(ticker)}`))
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


  // Combined domain: revenue + operating income share the left axis
  const allVals = [...revenueVals, ...incomeVals];
  const allMax = allVals.length ? Math.max(...allVals) : 0;
  const allMin = allVals.length ? Math.min(...allVals) : 0;
  const hasNegative = allMin < 0;
  const leftDomain: [number, number] = hasNegative
    ? [Math.floor(allMin * 1.3), Math.ceil(allMax * 1.15)]
    : [0, Math.ceil(allMax * 1.15) || 1];

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
        <ComposedChart data={entries} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} tickFormatter={(p) => formatPeriodLabel(p, view)} />
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
      </ResponsiveContainer>

      {entries.some((e) => e.isEstimate) && (
        <p className="text-[10px] text-muted-foreground text-right">옅은 색 = 컨센서스 추정치</p>
      )}
    </div>
  );
}
