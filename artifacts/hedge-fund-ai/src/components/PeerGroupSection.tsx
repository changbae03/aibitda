import { useState, useEffect } from "react";
import { Users, AlertCircle, Info, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface Peer {
  ticker: string;
  name: string;
  nameEn: string | null;
  reason: string;
  keyPoints: string[];
  marketCap: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  operatingMargin: number | null;
}

interface PeerGroupData {
  ticker: string;
  companyName: string;
  industry: string;
  peers: Peer[];
  methodology: string;
  comparisonNote: string;
}

function formatKRW(value: number | null): string {
  if (value == null) return "—";
  const tril = value / 1e12;
  if (Math.abs(tril) >= 1) return `${tril.toFixed(1)}조`;
  const bil = value / 1e8;
  if (Math.abs(bil) >= 0.1) return `${bil.toFixed(0)}억`;
  return "—";
}

function PeerRow({ peer, index }: { peer: Peer; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const exchange = peer.ticker.includes(".KQ") ? "KOSDAQ" : "KOSPI";
  const code = peer.ticker.replace(/\.(KS|KQ)$/, "");

  const hasFinancials = peer.marketCap != null || peer.revenue != null || peer.operatingIncome != null;

  return (
    <div className="rounded-xl border border-border bg-background/60 overflow-hidden">
      <button
        className="w-full text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        {/* 헤더 행 */}
        <div className="px-3.5 pt-3 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 border border-primary/20">
                  {index + 1}
                </span>
                <span className="font-semibold text-sm text-foreground">{peer.name}</span>
                {peer.nameEn && (
                  <span className="text-xs text-muted-foreground truncate hidden sm:block">{peer.nameEn}</span>
                )}
              </div>
              <div className="flex items-center gap-2 ml-7">
                <span className="font-mono text-xs text-muted-foreground">{code}</span>
                <span className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded border",
                  exchange === "KOSDAQ"
                    ? "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800"
                    : "text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-950 dark:border-violet-800"
                )}>
                  {exchange}
                </span>
              </div>
            </div>
            <div className="shrink-0 text-muted-foreground mt-0.5">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>

        {/* 재무 요약 인라인 (항상 표시) */}
        {hasFinancials && (
          <div className="px-3.5 pb-3 ml-7">
            <div className="flex items-center gap-4 flex-wrap">
              {peer.marketCap != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">시가총액</span>
                  <span className="text-[11px] font-semibold font-mono text-foreground">{formatKRW(peer.marketCap)}</span>
                </div>
              )}
              {peer.revenue != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">매출</span>
                  <span className="text-[11px] font-semibold font-mono text-foreground">{formatKRW(peer.revenue)}</span>
                </div>
              )}
              {peer.operatingIncome != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">영업이익</span>
                  <span className={cn(
                    "text-[11px] font-semibold font-mono",
                    peer.operatingIncome >= 0 ? "text-emerald-600" : "text-red-500"
                  )}>{formatKRW(peer.operatingIncome)}</span>
                </div>
              )}
              {peer.operatingMargin != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">영업이익률</span>
                  <span className={cn(
                    "text-[11px] font-semibold font-mono",
                    peer.operatingMargin >= 0 ? "text-emerald-600" : "text-red-500"
                  )}>{peer.operatingMargin.toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>
        )}
      </button>

      {/* 확장: 선정 근거 + 키포인트 */}
      {expanded && (
        <div className="px-3.5 pb-3.5 pt-0 border-t border-border/50 bg-muted/10">
          <p className="text-xs text-muted-foreground leading-relaxed mt-3 mb-2">{peer.reason}</p>
          {peer.keyPoints?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {peer.keyPoints.map((pt, i) => (
                <span key={i} className="text-[11px] bg-primary/5 text-primary border border-primary/15 px-2 py-0.5 rounded-full font-medium">
                  {pt}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PeerGroupSection({
  ticker,
  companyName,
  industry,
}: {
  ticker: string;
  companyName: string;
  industry?: string;
}) {
  const [data, setData] = useState<PeerGroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ companyName });
    if (industry) params.set("industry", industry);

    fetch(`/api/market-data/peer-group/${encodeURIComponent(ticker)}?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ticker, companyName, industry]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-base">Peer Group 분석</h3>
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-base">Peer Group 분석</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          <span>피어 그룹 데이터를 불러올 수 없습니다</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="mb-4">
        <h3 className="font-display font-semibold text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Peer Group 분석
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{companyName} · {industry}</p>
      </div>

      {/* 재무 범례 */}
      <p className="text-[10px] text-muted-foreground mb-3">시가총액 · 매출 · 영업이익은 TTM(최근 12개월) 기준</p>

      {/* Peer list */}
      <div className="space-y-2 mb-5">
        {(data.peers ?? []).map((peer, i) => (
          <PeerRow key={peer.ticker} peer={peer} index={i} />
        ))}
      </div>

      {/* Methodology */}
      {(data.methodology || data.comparisonNote) && (
        <div className="rounded-xl bg-muted/30 border border-border/60 p-3.5 space-y-2">
          {data.methodology && (
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">선정 방법론</span>
                <p className="text-xs text-muted-foreground leading-relaxed">{data.methodology}</p>
              </div>
            </div>
          )}
          {data.comparisonNote && (
            <div className="flex items-start gap-2 pt-2 border-t border-border/50">
              <ExternalLink className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
              <div>
                <span className="text-[11px] font-semibold text-primary uppercase tracking-wide block mb-0.5">투자 관점</span>
                <p className="text-xs text-muted-foreground leading-relaxed">{data.comparisonNote}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
