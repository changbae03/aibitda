import { useState, useEffect } from "react";
import { Building2, AlertCircle, Info, ChevronDown, ChevronUp, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface Peer {
  ticker: string;
  name: string;
  nameEn: string | null;
  exchange: string | null;
  region: string | null;
  reason: string;
  keyPoints: string[];
  marketCap: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  operatingMargin: number | null;
  currency: string | null;
}

interface PeerGroupData {
  ticker: string;
  companyName: string;
  industry: string;
  peers: Peer[];
  methodology: string;
  comparisonNote: string;
}

function formatKRW(value: number): string {
  const tril = value / 1e12;
  if (Math.abs(tril) >= 1) return `${tril.toFixed(1)}조`;
  const bil = value / 1e8;
  if (Math.abs(bil) >= 0.1) return `${bil.toFixed(0)}억`;
  return "—";
}

function formatUSD(value: number): string {
  const b = value / 1e9;
  if (Math.abs(b) >= 1) return `$${b.toFixed(1)}B`;
  const m = value / 1e6;
  if (Math.abs(m) >= 1) return `$${m.toFixed(0)}M`;
  return "—";
}

function formatValue(value: number | null, currency: string | null): string {
  if (value == null) return "—";
  const cur = (currency ?? "").toUpperCase();
  if (cur === "KRW" || cur === "") return formatKRW(value);
  return formatUSD(value);
}

function getExchangeInfo(peer: Peer): { label: string; colorClass: string } {
  const ex = (peer.exchange ?? "").toUpperCase();
  const ticker = peer.ticker ?? "";
  const region = (peer.region ?? "").toUpperCase();

  if (ex === "KOSDAQ" || ticker.endsWith(".KQ")) {
    return { label: "KOSDAQ", colorClass: "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800" };
  }
  if (ex === "KOSPI" || ticker.endsWith(".KS")) {
    return { label: "KOSPI", colorClass: "text-violet-600 bg-violet-50 border-violet-200 dark:text-violet-400 dark:bg-violet-950 dark:border-violet-800" };
  }
  if (ex === "NASDAQ") {
    return { label: "NASDAQ", colorClass: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800" };
  }
  if (ex === "NYSE") {
    return { label: "NYSE", colorClass: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800" };
  }
  if (ex === "TSE" || ticker.endsWith(".T") || region === "JP") {
    return { label: "TSE", colorClass: "text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-950 dark:border-rose-800" };
  }
  if (region === "US" || ex === "US") {
    return { label: "US", colorClass: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800" };
  }
  return { label: ex || "글로벌", colorClass: "text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-400 dark:bg-slate-900 dark:border-slate-700" };
}

function getDisplayCode(peer: Peer): string {
  const ticker = peer.ticker ?? "";
  if (/^\d{6}\.(KS|KQ)$/.test(ticker)) return ticker.replace(/\.(KS|KQ)$/, "");
  return ticker;
}

function isGlobal(peer: Peer): boolean {
  const ticker = peer.ticker ?? "";
  const region = (peer.region ?? "").toUpperCase();
  return !/^\d{6}\.(KS|KQ)$/.test(ticker) && region !== "KR";
}

function PeerRow({ peer, index }: { peer: Peer; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const { label, colorClass } = getExchangeInfo(peer);
  const code = getDisplayCode(peer);
  const global = isGlobal(peer);

  const hasFinancials = peer.marketCap != null || peer.revenue != null || peer.operatingIncome != null;

  return (
    <div className="rounded-xl border border-border bg-background/60 overflow-hidden">
      <button
        className="w-full text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
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
                {global && (
                  <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-2 ml-7">
                <span className="font-mono text-xs text-muted-foreground">{code}</span>
                <span className={cn(
                  "text-[10px] font-medium px-1.5 py-0.5 rounded border",
                  colorClass
                )}>
                  {label}
                </span>
              </div>
            </div>
            <div className="shrink-0 text-muted-foreground mt-0.5">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </div>
        </div>

        {hasFinancials && (
          <div className="px-3.5 pb-3 ml-7">
            <div className="flex items-center gap-4 flex-wrap">
              {peer.marketCap != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">시가총액</span>
                  <span className="text-[11px] font-semibold font-mono text-foreground">
                    {formatValue(peer.marketCap, peer.currency)}
                  </span>
                </div>
              )}
              {peer.revenue != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">매출</span>
                  <span className="text-[11px] font-semibold font-mono text-foreground">
                    {formatValue(peer.revenue, peer.currency)}
                  </span>
                </div>
              )}
              {peer.operatingIncome != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">영업이익</span>
                  <span className={cn(
                    "text-[11px] font-semibold font-mono",
                    peer.operatingIncome >= 0 ? "text-emerald-600" : "text-red-500"
                  )}>
                    {formatValue(peer.operatingIncome, peer.currency)}
                  </span>
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
  analysisSteps,
}: {
  ticker: string;
  companyName: string;
  industry?: string;
  analysisSteps?: Array<{ stepKey: string; content: string }>;
}) {
  const [data, setData] = useState<PeerGroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    fetch(`/api/market-data/peer-group/${encodeURIComponent(ticker)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, industry, analysisSteps: analysisSteps ?? [] }),
    })
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [ticker, companyName, industry]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-base">연관기업</h3>
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
          <Building2 className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-base">연관기업</h3>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="w-4 h-4" />
          <span>연관기업 데이터를 불러올 수 없습니다</span>
        </div>
      </div>
    );
  }

  const koreanPeers = (data.peers ?? []).filter(p => !isGlobal(p));
  const globalPeers = (data.peers ?? []).filter(p => isGlobal(p));

  return (
    <div className="bg-card border border-border rounded-2xl p-5">
      <div className="mb-4">
        <h3 className="font-display font-semibold text-base flex items-center gap-2">
          <Building2 className="w-4 h-4 text-primary" />
          연관기업
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{companyName} · {industry}</p>
      </div>

      <p className="text-[10px] text-muted-foreground mb-3">시가총액 · 매출 · 영업이익은 TTM 기준 (한국주식: 원화, 글로벌: USD)</p>

      {koreanPeers.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">국내 상장</p>
          <div className="space-y-2">
            {koreanPeers.map((peer, i) => (
              <PeerRow key={peer.ticker} peer={peer} index={i} />
            ))}
          </div>
        </div>
      )}

      {globalPeers.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
            <Globe className="w-3 h-3" /> 글로벌
          </p>
          <div className="space-y-2">
            {globalPeers.map((peer, i) => (
              <PeerRow key={peer.ticker} peer={peer} index={koreanPeers.length + i} />
            ))}
          </div>
        </div>
      )}

      {!koreanPeers.length && !globalPeers.length && (
        <p className="text-sm text-muted-foreground">연관기업 데이터가 없습니다</p>
      )}

      {data.methodology && (
        <div className="rounded-xl bg-muted/30 border border-border/60 p-3.5 mt-1">
          <div className="flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide block mb-0.5">선정 방법론</span>
              <p className="text-xs text-muted-foreground leading-relaxed">{data.methodology}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
