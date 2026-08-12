import { useState } from "react";
import { useLocation } from "wouter";
import { Search, Loader2, Sparkles, MapPin } from "lucide-react";
import { getApiUrl, cn } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

/**
 * 관련주 찾기 — "유리기판 하는 회사 찾아줘"에 사업보고서로 답한다.
 *
 * 예전에는 비슷한 기능이 둘로 나뉘어 있었다. 테마 분석 탭의 "테마 직접 발굴하기"는
 * AI가 기억으로 종목을 고르는 방식이고, "테마 관련주 찾기"는 사업보고서 원문을 뒤졌다.
 * 사용자에게는 같은 일이라 하나로 합쳤고, **근거가 남는 쪽**(사업보고서)을 남겼다.
 *
 * 이 화면의 값은 목록이 아니라 **근거 문장**이다. 뉴스가 짚어준 종목이 아니라
 * 회사가 스스로 "우리는 이 사업을 한다"고 적어놓은 것을 보여준다.
 */

interface Hit {
  ticker: string;
  name: string | null;
  marketCap: number | null;
  mentions: number;
  evidence: string | null;
  bsnsYear: number;
  regionMatch?: boolean;
  regionEvidence?: string | null;
}

interface SearchResult {
  keywords: string[];
  expanded: boolean;
  regions: string[];
  hits: Hit[];
}

const EXAMPLES = [
  "유리기판 만드는 기업",
  "광주 반도체 전력망 관련 기업",
  "CDMO 하는 회사",
  "휴머노이드 로봇 부품",
  "원전 기자재 납품 기업",
];

export default function RelatedStocksPage() {
  const [, setLocation] = useLocation();
  const { isEn } = useLanguage();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async (raw: string) => {
    const text = raw.trim();
    if (text.length < 2 || loading) return;
    setQ(text); setLoading(true); setFailed(false);
    try {
      const r = await fetch(
        getApiUrl(`api/events/theme-stocks?q=${encodeURIComponent(text)}&limit=20`),
        { credentials: "include" },
      );
      // 실패(500)와 "결과 없음"은 다르다. 뭉뚱그리면 고칠 수 없는 화면이 된다.
      if (!r.ok) { setFailed(true); setResult(null); return; }
      setResult(await r.json());
    } catch { setFailed(true); setResult(null); }
    finally { setLoading(false); }
  };

  const goAnalyze = (ticker: string, name: string) => {
    setLocation(`/analysis/new?ticker=${encodeURIComponent(ticker)}&name=${encodeURIComponent(name)}`);
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-5 pb-16">
      <div className="pt-2">
        <h1 className="text-[26px] sm:text-[32px] font-bold tracking-tight text-foreground leading-tight"
            style={{ wordBreak: "keep-all" }}>
          {isEn ? "Which companies actually do this?" : "이 사업, 누가 하고 있나요?"}
        </h1>
        <p className="text-[13.5px] text-muted-foreground/80 leading-relaxed mt-2 break-keep">
          {isEn
            ? "We search what companies wrote about themselves in their filings — not what the news guessed."
            : "뉴스가 짚어준 종목이 아니라, 회사가 사업보고서에 직접 적어놓은 것으로 찾습니다."}
        </p>
      </div>

      <form onSubmit={e => { e.preventDefault(); run(q); }} className="flex gap-2">
        <div className="flex-1 flex items-center gap-2.5 bg-card border border-border/60 rounded-2xl px-4 py-3
                        focus-within:border-foreground/30 transition">
          <Search className="w-4 h-4 text-muted-foreground/50 shrink-0" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={isEn ? "e.g. glass substrate makers" : "예: 유리기판 만드는 기업"}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-foreground
                       placeholder:text-muted-foreground/40 placeholder:text-[14px]"
            style={{ fontSize: "16px" }}
          />
        </div>
        <button type="submit" disabled={loading || q.trim().length < 2}
                className="shrink-0 px-4 rounded-2xl bg-primary text-primary-foreground text-[14px] font-semibold
                           disabled:opacity-40 transition">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEn ? "Find" : "찾기")}
        </button>
      </form>

      {/* 뭘 칠 수 있는지 보여준다 — 빈 검색창만 있으면 아무도 안 친다 */}
      {!result && !loading && (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground/50">{isEn ? "Try these" : "이렇게 물어보세요"}</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map(x => (
              <button key={x} onClick={() => run(x)}
                      className="text-[12px] px-3 py-1.5 rounded-xl bg-muted/50 text-foreground/65
                                 hover:bg-muted hover:text-foreground/85 transition">
                {x}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground/60">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[13px]">{isEn ? "Reading filings…" : "사업보고서 뒤지는 중…"}</span>
        </div>
      )}

      {failed && !loading && (
        <p className="text-[13px] text-muted-foreground/60 py-8 text-center">
          {isEn ? "Search failed. Please try again." : "검색이 실패했어요. 잠시 후 다시 시도해 주세요."}
        </p>
      )}

      {result && !loading && (
        <div className="space-y-3">
          {/* 무엇으로 찾았는지 밝힌다 — AI가 말을 넓혔으면 그것도 보여줘야 결과가 납득된다 */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="text-muted-foreground/50">{isEn ? "searched" : "검색어"}</span>
            {result.keywords.map(k => (
              <span key={k} className="px-2 py-0.5 rounded-lg bg-muted/60 text-foreground/70 font-medium">{k}</span>
            ))}
            {result.expanded && (
              <span className="flex items-center gap-1 text-[11px] text-primary/80">
                <Sparkles className="w-3 h-3" />
                {isEn ? "AI widened the words" : "AI가 표현을 넓혔어요"}
              </span>
            )}
            {result.regions?.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                <MapPin className="w-3 h-3" />
                {isEn ? "region matched" : "지역 시설 우선"}
              </span>
            )}
          </div>

          {result.hits.length === 0 ? (
            <p className="text-[13px] text-muted-foreground/60 py-8 text-center break-keep">
              {isEn
                ? "No company describes this business in its filings. Try different wording."
                : "사업보고서에 이 표현을 쓴 회사를 찾지 못했어요. 다른 말로 바꿔보세요."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {result.hits.map((h, i) => (
                <button key={h.ticker} onClick={() => goAnalyze(h.ticker, h.name ?? h.ticker)}
                        className="w-full text-left rounded-2xl bg-card border border-border/50 px-4 py-3
                                   hover:border-border transition">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-foreground/25 w-4 tabular-nums shrink-0">{i + 1}</span>
                    <span className="text-[14px] font-bold text-foreground truncate">{h.name ?? h.ticker}</span>
                    <span className="text-[11px] text-foreground/40 shrink-0">{h.ticker}</span>
                    {h.regionMatch && (
                      <MapPin className="w-3 h-3 text-emerald-500 shrink-0" />
                    )}
                    <span className="ml-auto text-[11px] px-2 py-0.5 rounded-lg bg-primary/10 text-primary
                                     font-semibold shrink-0">
                      {h.mentions}{isEn ? "×" : "회"}
                    </span>
                    {h.marketCap != null && (
                      <span className="text-[11px] text-foreground/40 shrink-0 tabular-nums">
                        {Math.round(h.marketCap / 1e8).toLocaleString()}억
                      </span>
                    )}
                  </div>
                  {(h.evidence || h.regionEvidence) && (
                    <p className="text-[11.5px] text-muted-foreground/70 leading-relaxed mt-1.5 pl-6 line-clamp-2 break-keep">
                      “{h.regionEvidence ?? h.evidence}”
                    </p>
                  )}
                </button>
              ))}
              <p className="text-[11px] text-muted-foreground/40 pt-2 px-1 break-keep">
                {isEn
                  ? "Count = how often the phrase appears in the latest filing. More mentions means the business is more central."
                  : "숫자는 최신 사업보고서에 그 표현이 나온 횟수예요. 많이 적을수록 그 사업이 회사의 중심입니다."}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
