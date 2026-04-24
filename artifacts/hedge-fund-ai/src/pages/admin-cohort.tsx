import { useState, useEffect } from "react";
import { Users, RefreshCw, TrendingUp, AlertCircle } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface CohortRow {
  cohort_week: string;
  cohort_size: number;
  retention: Array<{ week: number; users: number }>;
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function heatColor(p: number) {
  if (p >= 60) return "bg-emerald-500 text-white";
  if (p >= 40) return "bg-emerald-200 text-emerald-800";
  if (p >= 20) return "bg-amber-100 text-amber-800";
  if (p > 0)   return "bg-red-100 text-red-700";
  return "bg-muted text-muted-foreground/30";
}

export default function AdminCohort() {
  const [data, setData] = useState<CohortRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(getApiUrl("/api/admin/cohort"), { credentials: "include" })
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const maxWeeks = Math.max(...data.map(r => r.retention.map(x => x.week).reduce((a, b) => Math.max(a, b), 0)), 4);
  const weekLabels = Array.from({ length: Math.min(maxWeeks + 1, 9) }, (_, i) => i);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            코호트 잔존율
          </h1>
          <p className="text-sm text-muted-foreground mt-1">가입 주차별 분석 서비스 재사용률 (최근 12주)</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition-colors"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          새로고침
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm mb-6">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-12 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">코호트 데이터가 없습니다 (유저·분석 이력 필요)</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-3 text-left font-semibold text-muted-foreground whitespace-nowrap">가입 주</th>
                  <th className="px-4 py-3 text-right font-semibold text-muted-foreground">코호트 크기</th>
                  {weekLabels.map(w => (
                    <th key={w} className="px-3 py-3 text-center font-semibold text-muted-foreground whitespace-nowrap">
                      {w === 0 ? "W0" : `W+${w}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, ri) => {
                  const retMap: Record<number, number> = {};
                  for (const r of row.retention) retMap[r.week] = r.users;
                  return (
                    <tr key={row.cohort_week} className={cn("border-b border-border/50", ri % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {row.cohort_week.slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.cohort_size}</td>
                      {weekLabels.map(w => {
                        const n = retMap[w] ?? 0;
                        const p = pct(n, Number(row.cohort_size));
                        return (
                          <td key={w} className="px-1 py-1 text-center">
                            {n > 0 ? (
                              <span className={cn("inline-block px-2 py-1 rounded-lg text-xs font-bold tabular-nums", heatColor(p))}>
                                {p}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground/20 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-muted/30 border-t border-border flex items-center gap-4 text-xs text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>W0 = 가입 주에 분석 실행. W+N = 가입 N주 후에도 재사용한 비율</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="w-3 h-3 rounded bg-emerald-500 inline-block" /> 60%+
              <span className="w-3 h-3 rounded bg-emerald-200 inline-block" /> 40%+
              <span className="w-3 h-3 rounded bg-amber-100 inline-block" /> 20%+
              <span className="w-3 h-3 rounded bg-red-100 inline-block" /> &lt;20%
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
