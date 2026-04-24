import { useState, useCallback } from "react";
import { Search, Loader2, Building2, ArrowRight, X, TrendingUp, TrendingDown, Minus, SplitSquareHorizontal, ChevronRight } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLocation } from "wouter";

interface AnalysisSummary {
  id: number;
  ticker: string;
  company_name: string;
  industry: string | null;
  investment_verdict: string | null;
  target_price: number | null;
  start_price: number | null;
  created_at: string;
  token_count: number;
}

interface SearchResult {
  symbol: string;
  shortname: string;
  exchange: string;
}

const VERDICT_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  "Strong Buy":  { label: "높은 상승여력", color: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: <TrendingUp className="w-3.5 h-3.5" /> },
  "Buy":         { label: "상승여력",      color: "text-green-600 bg-green-50 border-green-200",       icon: <TrendingUp className="w-3.5 h-3.5" /> },
  "Hold":        { label: "적정 수준",     color: "text-amber-600 bg-amber-50 border-amber-200",       icon: <Minus className="w-3.5 h-3.5" /> },
  "Sell":        { label: "하락여지",      color: "text-orange-600 bg-orange-50 border-orange-200",    icon: <TrendingDown className="w-3.5 h-3.5" /> },
  "Strong Sell": { label: "높은 하락여지", color: "text-red-600 bg-red-50 border-red-200",             icon: <TrendingDown className="w-3.5 h-3.5" /> },
};

function fmtPrice(p: number | null, ticker: string) {
  if (p == null) return "—";
  const isKr = ticker.endsWith(".KS") || ticker.endsWith(".KQ") || /^\d{6}$/.test(ticker);
  return isKr ? `${Math.round(p).toLocaleString("ko-KR")}원` : `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function upsidePct(target: number | null, start: number | null) {
  if (!target || !start) return null;
  return ((target - start) / start) * 100;
}

function TickerSearch({
  value, onSelect, disabled, placeholder,
}: { value: string; onSelect: (ticker: string, name: string) => void; disabled?: boolean; placeholder?: string }) {
  const [q, setQ] = useState(value);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  const search = useCallback(async (v: string) => {
    if (!v.trim()) { setResults([]); setOpen(false); return; }
    setSearching(true);
    try {
      const r = await fetch(getApiUrl(`/api/market-data/search/${encodeURIComponent(v)}`));
      const d: SearchResult[] = await r.json();
      setResults(d);
      setOpen(d.length > 0);
    } finally {
      setSearching(false);
    }
  }, []);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card shadow-sm">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); search(e.target.value); }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder ?? "종목코드 또는 회사명"}
          className="flex-1 bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground/40"
          disabled={disabled}
          autoComplete="off"
        />
        {searching && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50" />}
        {q && !searching && (
          <button onClick={() => { setQ(""); setResults([]); setOpen(false); }}>
            <X className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-muted-foreground" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-popover border border-border rounded-xl z-50 overflow-hidden shadow-lg">
          {results.slice(0, 6).map(r => {
            const code = r.symbol.replace(/\.(KS|KQ)$/, "");
            const ex = r.exchange === "KOSPI" ? "코스피" : r.exchange === "KOSDAQ" ? "코스닥" : r.exchange;
            return (
              <button
                key={r.symbol}
                onMouseDown={e => { e.preventDefault(); onSelect(r.symbol, r.shortname); setQ(r.shortname); setOpen(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent transition-colors text-left border-b border-border/50 last:border-0"
              >
                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-foreground">{r.shortname}</div>
                  <div className="text-xs text-muted-foreground font-mono">{code} · {ex}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AnalysisCard({ analysis, onNavigate }: { analysis: AnalysisSummary | null; onNavigate: (id: number) => void; ticker: string }) {
  if (!analysis) return (
    <div className="flex-1 rounded-2xl border border-dashed border-border bg-muted/20 flex items-center justify-center min-h-48">
      <p className="text-sm text-muted-foreground">분석 데이터 없음</p>
    </div>
  );

  const vc = VERDICT_CONFIG[analysis.investment_verdict ?? ""] ?? null;
  const upside = upsidePct(analysis.target_price, analysis.start_price);
  const shortTicker = analysis.ticker.replace(/\.(KS|KQ)$/, "");

  return (
    <div className="flex-1 rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-foreground">{analysis.company_name}</span>
            <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{shortTicker}</span>
          </div>
          {analysis.industry && (
            <p className="text-xs text-muted-foreground mt-0.5">{analysis.industry}</p>
          )}
        </div>
        <button
          onClick={() => onNavigate(analysis.id)}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors"
        >
          전체 보기 <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {vc && (
        <div className={cn("flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-semibold w-fit", vc.color)}>
          {vc.icon}
          {vc.label}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">분석 시점 주가</p>
          <p className="text-sm font-bold text-foreground">{fmtPrice(analysis.start_price, analysis.ticker)}</p>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground mb-1">AI 목표가</p>
          <p className="text-sm font-bold text-foreground">{fmtPrice(analysis.target_price, analysis.ticker)}</p>
        </div>
      </div>

      {upside !== null && (
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold",
          upside >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        )}>
          {upside >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
          목표 수익률 {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        분석일: {new Date(analysis.created_at).toLocaleDateString("ko-KR")}
      </p>
    </div>
  );
}

export default function ComparePage() {
  const [, navigate] = useLocation();
  const [tickerA, setTickerA] = useState("");
  const [tickerB, setTickerB] = useState("");
  const [analysisA, setAnalysisA] = useState<AnalysisSummary | null>(null);
  const [analysisB, setAnalysisB] = useState<AnalysisSummary | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  const fetchAnalysis = async (ticker: string, side: "A" | "B") => {
    const setLoading = side === "A" ? setLoadingA : setLoadingB;
    const setAnalysis = side === "A" ? setAnalysisA : setAnalysisB;
    const setError = side === "A" ? setErrorA : setErrorB;
    setLoading(true); setError(null);
    try {
      const r = await fetch(getApiUrl(`/api/analysis/ticker-history/${encodeURIComponent(ticker)}`));
      const d: AnalysisSummary[] = await r.json();
      setAnalysis(d[0] ?? null);
      if (!d[0]) setError("분석된 리포트가 없습니다. 먼저 AI 기업분석을 실행하세요.");
    } catch {
      setError("데이터를 불러오지 못했습니다");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectA = (ticker: string) => { setTickerA(ticker); fetchAnalysis(ticker, "A"); };
  const handleSelectB = (ticker: string) => { setTickerB(ticker); fetchAnalysis(ticker, "B"); };

  const handleNavigate = (id: number) => navigate(`/analysis/${id}`);

  const hasBoth = analysisA && analysisB;
  const verdictOrder = ["Strong Buy","Buy","Hold","Sell","Strong Sell"];
  const betterSide = hasBoth
    ? (() => {
        const ia = verdictOrder.indexOf(analysisA.investment_verdict ?? "");
        const ib = verdictOrder.indexOf(analysisB.investment_verdict ?? "");
        if (ia < ib) return "A";
        if (ib < ia) return "B";
        return null;
      })()
    : null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <SplitSquareHorizontal className="w-6 h-6 text-primary" />
          종목 비교 분석
        </h1>
        <p className="text-sm text-muted-foreground mt-1">두 종목의 최신 AI 리포트를 나란히 비교합니다</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] font-bold">A</span>
            첫 번째 종목
          </p>
          <TickerSearch value="" onSelect={handleSelectA} placeholder="삼성전자, NVDA..." />
          {errorA && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><X className="w-3 h-3" />{errorA}</p>}
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <span className="w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center text-[10px] font-bold">B</span>
            두 번째 종목
          </p>
          <TickerSearch value="" onSelect={handleSelectB} placeholder="SK하이닉스, AMD..." />
          {errorB && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><X className="w-3 h-3" />{errorB}</p>}
        </div>
      </div>

      {hasBoth && betterSide && (
        <div className={cn(
          "mb-4 px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2",
          "bg-primary/10 text-primary border border-primary/20"
        )}>
          <TrendingUp className="w-4 h-4" />
          AI 리포트 기준 &nbsp;
          <span className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
            betterSide === "A" ? "bg-primary text-primary-foreground" : "bg-foreground text-background"
          )}>{betterSide}</span>
          &nbsp;
          <strong>{betterSide === "A" ? analysisA?.company_name : analysisB?.company_name}</strong>
          의 투자의견이 더 긍정적입니다
        </div>
      )}

      <div className="flex gap-4">
        {(loadingA || analysisA) ? (
          loadingA
            ? <div className="flex-1 rounded-2xl border border-border bg-card flex items-center justify-center min-h-48"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            : <AnalysisCard analysis={analysisA} onNavigate={handleNavigate} ticker={tickerA} />
        ) : (
          <div className="flex-1 rounded-2xl border border-dashed border-border bg-muted/20 flex flex-col items-center justify-center min-h-48 gap-2 text-muted-foreground">
            <Search className="w-6 h-6 opacity-30" />
            <p className="text-sm">첫 번째 종목 선택</p>
          </div>
        )}

        {(loadingB || analysisB) ? (
          loadingB
            ? <div className="flex-1 rounded-2xl border border-border bg-card flex items-center justify-center min-h-48"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            : <AnalysisCard analysis={analysisB} onNavigate={handleNavigate} ticker={tickerB} />
        ) : (
          <div className="flex-1 rounded-2xl border border-dashed border-border bg-muted/20 flex flex-col items-center justify-center min-h-48 gap-2 text-muted-foreground">
            <Search className="w-6 h-6 opacity-30" />
            <p className="text-sm">두 번째 종목 선택</p>
          </div>
        )}
      </div>

      {hasBoth && (
        <div className="mt-6 p-4 rounded-2xl bg-muted/30 border border-border text-xs text-muted-foreground text-center">
          비교는 각 종목의 가장 최근 완료된 AI 리포트 기준입니다. 더 정확한 비교를 위해 동시에 재분석을 실행하는 것을 권장합니다.
          <div className="flex justify-center gap-3 mt-3">
            {analysisA && (
              <button
                onClick={() => navigate(`/analysis/new?ticker=${encodeURIComponent(analysisA.ticker)}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
              >
                <ArrowRight className="w-3 h-3" />
                {analysisA.company_name} 재분석
              </button>
            )}
            {analysisB && (
              <button
                onClick={() => navigate(`/analysis/new?ticker=${encodeURIComponent(analysisB.ticker)}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:bg-accent transition-colors"
              >
                <ArrowRight className="w-3 h-3" />
                {analysisB.company_name} 재분석
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
