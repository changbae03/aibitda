import { useListAnalyses } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Loader2, Inbox, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";

const VERDICT_STYLE: Record<string, { label: string; cls: string }> = {
  BUY:         { label: "매수",   cls: "bg-green-50 text-green-700 border-green-200" },
  STRONG_BUY:  { label: "강력매수", cls: "bg-green-50 text-green-700 border-green-200" },
  SELL:        { label: "매도",   cls: "bg-red-50 text-red-700 border-red-200" },
  STRONG_SELL: { label: "강력매도", cls: "bg-red-50 text-red-700 border-red-200" },
  HOLD:        { label: "보유",   cls: "bg-amber-50 text-amber-700 border-amber-200" },
  NEUTRAL:     { label: "중립",   cls: "bg-neutral-100 text-neutral-600 border-neutral-200" },
};

function verdictBadge(verdict?: string) {
  if (!verdict) return null;
  const s = VERDICT_STYLE[verdict.toUpperCase()] ?? { label: verdict, cls: "bg-neutral-100 text-neutral-600 border-neutral-200" };
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border", s.cls)}>
      {s.label}
    </span>
  );
}

export default function History() {
  const [, setLocation] = useLocation();
  const { data: analyses, isLoading } = useListAnalyses();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  const list = analyses ?? [];

  return (
    <div>
      <h1
        className="text-[22px] font-black tracking-tight text-neutral-900 mb-6"
        style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif" }}
      >
        내가 본 자료
      </h1>

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <Inbox className="w-10 h-10 text-neutral-200" />
          <p className="text-[15px] font-medium text-neutral-400">아직 분석한 기업이 없어요</p>
          <p className="text-[13px] text-neutral-300">
            AI 기업분석 메뉴에서 종목을 검색해 분석을 시작해보세요
          </p>
          <button
            onClick={() => setLocation("/analysis/new")}
            className="mt-2 px-4 py-2 rounded-md text-[13px] font-medium bg-[#1d4ed8] text-white hover:bg-blue-700 transition-colors"
          >
            분석 시작하기
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((a) => (
            <button
              key={a.id}
              onClick={() => setLocation(`/analysis/${a.id}`)}
              className="w-full text-left flex items-center gap-4 px-5 py-4 rounded-xl border border-neutral-100 hover:border-neutral-200 hover:bg-neutral-50 transition-all group"
            >
              {/* Status icon */}
              <div className="shrink-0">
                {a.status === "completed" ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <Clock className="w-4 h-4 text-amber-400" />
                )}
              </div>

              {/* Main info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-semibold text-neutral-900 truncate">
                    {a.companyName}
                  </span>
                  <span className="text-[12px] text-neutral-400 font-mono">{a.ticker}</span>
                  {verdictBadge(a.investmentVerdict)}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[12px] text-neutral-400">
                  <span>{a.industry || "—"}</span>
                  {a.targetPrice != null && (
                    <>
                      <span className="text-neutral-200">|</span>
                      <span>목표가 <span className="text-neutral-600 font-medium">{formatCurrency(a.targetPrice)}</span></span>
                    </>
                  )}
                  <span className="text-neutral-200">|</span>
                  <span>{format(new Date(a.createdAt), "yyyy.MM.dd HH:mm", { locale: ko })}</span>
                </div>
              </div>

              {/* Arrow */}
              <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 transition-colors shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
