import { useState, useEffect } from "react";
import { BarChart3, Globe, AlertCircle, Tag } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface GlobalFund {
  name: string;
  ticker: string | null;
  pctHeld: number;
  value: number | null;
  reportDate: string;
}

interface DomesticEtf {
  code: string;
  name: string;
  manager: string;
  category: string;
  weight: number;
  dataSource: "real";
}

interface ETFData {
  ticker: string;
  exchange: string;
  globalFunds: GlobalFund[];
  domesticEtfs: DomesticEtf[];
  notes: string | null;
}

const CATEGORY_COLOR: Record<string, string> = {
  "시장전체":        "text-sky-600 bg-sky-50 border-sky-200 dark:text-sky-400 dark:bg-sky-900/20 dark:border-sky-800/40",
  "반도체·IT":       "text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-900/20 dark:border-violet-800/40",
  "2차전지":         "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-800/40",
  "바이오·헬스케어": "text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-900/20 dark:border-rose-800/40",
  "자동차·모빌리티": "text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-900/20 dark:border-orange-800/40",
  "금융":            "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/20 dark:border-amber-800/40",
  "에너지·화학":     "text-teal-600 bg-teal-50 border-teal-200 dark:text-teal-400 dark:bg-teal-900/20 dark:border-teal-800/40",
  "방산·우주":       "text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-900/20 dark:border-indigo-800/40",
  "조선·기계":       "text-cyan-600 bg-cyan-50 border-cyan-200 dark:text-cyan-400 dark:bg-cyan-900/20 dark:border-cyan-800/40",
  "건설·인프라":     "text-stone-600 bg-stone-50 border-stone-200 dark:text-stone-400 dark:bg-stone-900/20 dark:border-stone-800/40",
  "소비재":          "text-pink-600 bg-pink-50 border-pink-200 dark:text-pink-400 dark:bg-pink-900/20 dark:border-pink-800/40",
  "미디어·엔터":     "text-fuchsia-600 bg-fuchsia-50 border-fuchsia-200 dark:text-fuchsia-400 dark:bg-fuchsia-900/20 dark:border-fuchsia-800/40",
  "고배당":          "text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-500 dark:bg-yellow-900/20 dark:border-yellow-800/40",
  "ESG·테마":        "text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800/40",
  "나스닥100":       "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-900/20 dark:border-blue-800/40",
  "산업재":          "text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-400 dark:bg-slate-900/20 dark:border-slate-800/40",
  "혁신·테마":       "text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-900/20 dark:border-purple-800/40",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_COLOR[category] ?? "text-muted-foreground bg-muted border-border";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap", cls)}>
      <Tag className="w-2.5 h-2.5" />
      {category}
    </span>
  );
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
    fetch(getApiUrl(`/api/market-data/etf-inclusion/${encodeURIComponent(ticker)}?${params}`))
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ticker]);

  const isUsStock = !!(data?.exchange && (data.exchange === "NYSE/NASDAQ" || (!data?.exchange?.includes("KOS"))));

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-base">편입 ETF 현황</h3>
          <span className="text-[10px] text-muted-foreground animate-pulse ml-1">ETF 데이터 조회 중…</span>
        </div>
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 rounded-lg bg-muted/50 animate-pulse" />
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

  const uniqueDomesticEtfs = data.domesticEtfs.filter((etf, idx, arr) =>
    arr.findIndex(e => e.code === etf.code) === idx
  );
  const hasGlobal = data.globalFunds.length > 0;
  const hasDomestic = uniqueDomesticEtfs.length > 0;

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
        {/* ETF 편입 현황 — 국내(KRX) or 미국(Yahoo Finance) */}
        {hasDomestic && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <BarChart3 className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">
                {isUsStock ? "미국 ETF 편입 현황" : "국내 ETF 편입 현황"}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                isUsStock
                  ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/40"
                  : "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800/40"
              }`}>
                {isUsStock ? "Yahoo Finance" : "KRX 실데이터"}
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">{uniqueDomesticEtfs.length}개</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[400px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-muted-foreground font-medium pb-2 pr-2">ETF명</th>
                    <th className="text-center text-muted-foreground font-medium pb-2 px-2 w-28">카테고리</th>
                    <th className="text-right text-muted-foreground font-medium pb-2 pl-2 w-20">편입 비중</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {uniqueDomesticEtfs.map(etf => (
                    <tr key={etf.code} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2.5 pr-2">
                        <div className="font-semibold text-foreground leading-tight">{etf.name}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] text-muted-foreground">{etf.code}</span>
                          <span className="text-[10px] text-muted-foreground">·</span>
                          <span className="text-[10px] text-muted-foreground">{etf.manager}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <CategoryBadge category={etf.category} />
                      </td>
                      <td className="py-2.5 pl-2 text-right">
                        <span className="font-mono font-semibold text-primary text-[12px]">
                          {etf.weight.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 글로벌 운용사 편입 */}
        {hasGlobal && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Globe className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-foreground">글로벌 운용사 편입</span>
              <span className="text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded font-semibold border border-blue-200 dark:border-blue-800/40">
                실데이터
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[380px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left text-muted-foreground font-medium pb-2 pr-3">펀드명</th>
                    <th className="text-left text-muted-foreground font-medium pb-2 px-2 w-20">티커</th>
                    <th className="text-right text-muted-foreground font-medium pb-2 px-2 w-20">편입 비중</th>
                    <th className="text-right text-muted-foreground font-medium pb-2 pl-2 w-20">기준월</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.globalFunds.map((f, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="py-2 pr-3 text-foreground leading-snug">{f.name}</td>
                      <td className="py-2 px-2">
                        {f.ticker ? (
                          <span className="font-mono text-[11px] font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                            {f.ticker}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
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
            <AlertCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              조회한 주요 ETF에서 이 종목을 찾을 수 없습니다. 소형주·신규 상장 종목이거나, 조회 대상 ETF에 포함되지 않은 경우일 수 있습니다.
            </p>
          </div>
        )}

        {data.notes && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground pt-1 border-t border-border/50">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="leading-relaxed">{data.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
}
