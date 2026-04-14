import { useState, useEffect } from "react";
import { BarChart3, Info, Sparkles, Globe, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface GlobalFund {
  name: string;
  pctHeld: number;
  value: number | null;
  reportDate: string;
}

interface DomesticEtf {
  code: string;
  name: string;
  manager: string;
  indexBasis: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

interface ETFData {
  ticker: string;
  exchange: string;
  globalFunds: GlobalFund[];
  domesticEtfs: DomesticEtf[];
  notes: string | null;
}

const CONFIDENCE_CONFIG: Record<string, { label: string; color: string }> = {
  high: { label: "편입 확실", color: "text-success bg-success/10 border-success/20" },
  medium: { label: "편입 가능", color: "text-warning bg-warning/10 border-warning/20" },
  low: { label: "테마 가능", color: "text-muted-foreground bg-muted border-border" },
};

function formatKRW(value: number): string {
  const tril = value / 1e12;
  if (Math.abs(tril) >= 1) return `${tril.toFixed(1)}조`;
  const bil = value / 1e8;
  if (Math.abs(bil) >= 1) return `${Math.round(bil)}억`;
  return `${Math.round(value / 1e6)}백만`;
}

export default function ETFSection({
  ticker,
  companyName,
  industry,
}: {
  ticker: string;
  companyName: string;
  industry?: string;
}) {
  const [data, setData] = useState<ETFData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ companyName });
    if (industry) params.set("industry", industry);
    fetch(`/api/market-data/etf-inclusion/${encodeURIComponent(ticker)}?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-base">편입 ETF 현황</h3>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-base">편입 ETF 현황</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          <span>ETF 데이터를 불러올 수 없습니다</span>
        </div>
      </div>
    );
  }

  const hasGlobal = data.globalFunds.length > 0;
  const hasDomestic = data.domesticEtfs.length > 0;

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="font-display font-semibold text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            편입 ETF 현황
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{companyName} · {data.exchange}</p>
        </div>
      </div>

      <div className="space-y-5">
        {/* 국내 ETF (AI 추정) */}
        {hasDomestic && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">국내 주요 ETF</span>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono border border-border">AI 추정</span>
            </div>
            <div className="space-y-2">
              {data.domesticEtfs.map(etf => {
                const conf = CONFIDENCE_CONFIG[etf.confidence] ?? CONFIDENCE_CONFIG.low;
                return (
                  <div key={etf.code} className="rounded-xl border border-border p-3 bg-background/60 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground truncate">{etf.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">{etf.code}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="text-[11px] text-muted-foreground">{etf.manager}</span>
                          <span className="text-[11px] text-muted-foreground">·</span>
                          <span className="text-[11px] text-muted-foreground">{etf.indexBasis}</span>
                        </div>
                      </div>
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0", conf.color)}>
                        {conf.label}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{etf.reason}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 글로벌 운용사 편입 */}
        {hasGlobal && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-foreground">글로벌 운용사 편입</span>
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono border border-border">실데이터</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[400px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-muted-foreground font-medium pb-2 pr-3">펀드명</th>
                    <th className="text-right text-muted-foreground font-medium pb-2 px-2 w-20">편입 비중</th>
                    <th className="text-right text-muted-foreground font-medium pb-2 pl-2 w-24">기준월</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.globalFunds.map((f, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-3 text-foreground leading-snug">{f.name}</td>
                      <td className="py-2 px-2 text-right font-mono font-semibold text-primary">{f.pctHeld.toFixed(2)}%</td>
                      <td className="py-2 pl-2 text-right text-muted-foreground font-mono">{f.reportDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!hasGlobal && !hasDomestic && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/30 border border-border/50">
            <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              이 종목에 대한 ETF 편입 데이터가 없습니다. 소형주 또는 신규 상장 종목의 경우 주요 ETF에 편입되지 않았을 수 있습니다.
            </p>
          </div>
        )}

        {data.notes && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="leading-relaxed">{data.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
}
