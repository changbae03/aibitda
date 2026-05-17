import { useState } from "react";
import {
  TrendingUp, AlertTriangle, Zap, ChevronDown, ChevronUp,
  RefreshCw, ExternalLink, Brain, Newspaper,
} from "lucide-react";

const MOCK = {
  ticker: "005930",
  name: "삼성전자",
  industry: "반도체",
  verdict: "Buy",
  currentPrice: 74800,
  change1d: 2.14,
  targetPrice: 95000,
  upsidePct: 27.0,
  brief: {
    core: "HBM3E 12단 양산 본격화로 NVIDIA향 물량이 2분기 대비 40% 증가, 메모리 ASP 회복 견인",
    risk: "미중 반도체 규제 재확산 우려로 중국향 레거시 DRAM 수출 제한 가능성",
    catalyst: "3분기 실적발표(10/31) 에서 HBM 매출 비중이 첫 10% 돌파 예상",
  },
};

function verdictColor(v: string) {
  if (v === "Strong Buy") return { bg: "bg-emerald-500/10", border: "border-emerald-500/25", text: "text-emerald-400", label: "높은 상승여력" };
  if (v === "Buy")         return { bg: "bg-green-500/10",   border: "border-green-500/25",   text: "text-green-400",   label: "상승여력" };
  if (v === "Hold")        return { bg: "bg-amber-500/10",   border: "border-amber-500/25",   text: "text-amber-400",   label: "적정 수준" };
  return { bg: "bg-muted/40", border: "border-border", text: "text-muted-foreground", label: v };
}

export function NewsLine() {
  const [briefExpanded, setBriefExpanded] = useState(false);
  const vc = verdictColor(MOCK.verdict);

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#161616] overflow-hidden shadow-xl">

        {/* ── 헤더 ── */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center text-[18px] font-bold shrink-0">
              삼
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-white leading-tight">{MOCK.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="font-mono text-[11px] text-white/40">{MOCK.ticker}</span>
                <span className="text-[10px] text-white/30">· {MOCK.industry}</span>
              </div>
              <div className="mt-1.5">
                <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-semibold ${vc.bg} ${vc.border} ${vc.text}`}>
                  {vc.label}
                </span>
              </div>
            </div>
          </div>

          {/* 가격 그리드 */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
              <p className="text-[10px] text-white/40 mb-1">현재가</p>
              <p className="text-[18px] font-bold text-white tabular-nums leading-none">
                {MOCK.currentPrice.toLocaleString("ko-KR")}원
              </p>
              <p className="text-[11px] tabular-nums mt-1 font-medium text-emerald-400">
                ▲ {MOCK.change1d}% 오늘
              </p>
            </div>
            <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/20 px-3 py-2.5">
              <p className="text-[10px] text-white/40 mb-1">AI 적정주가</p>
              <p className="text-[18px] font-bold text-white tabular-nums leading-none">
                {MOCK.targetPrice.toLocaleString("ko-KR")}원
              </p>
              <p className="text-[11px] tabular-nums mt-1 font-semibold text-emerald-400">
                ▲ {MOCK.upsidePct}% 여력
              </p>
            </div>
          </div>
        </div>

        {/* ── 뉴스라인 브리핑 (항상 보임 + 토글 확장) ── */}
        <div className="mx-3 mb-3 rounded-xl border border-white/8 bg-white/[0.03] overflow-hidden">
          {/* 한 줄 요약 (항상 표시) */}
          <button
            onClick={() => setBriefExpanded(v => !v)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors"
          >
            <Newspaper className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <p className="flex-1 text-[12px] text-white/70 leading-snug line-clamp-1 min-w-0">
              {MOCK.brief.core}
            </p>
            {briefExpanded
              ? <ChevronUp className="w-3.5 h-3.5 text-white/30 shrink-0" />
              : <ChevronDown className="w-3.5 h-3.5 text-white/30 shrink-0" />
            }
          </button>

          {/* 확장 시 상세 3섹션 */}
          {briefExpanded && (
            <div className="border-t border-white/8 px-3 pb-3 space-y-2.5 pt-2.5">
              <div className="flex gap-2">
                <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-0.5">촉매</p>
                  <p className="text-[12px] text-white/65 leading-relaxed">{MOCK.brief.catalyst}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-0.5">리스크</p>
                  <p className="text-[12px] text-white/65 leading-relaxed">{MOCK.brief.risk}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 하단 액션 ── */}
        <div className="border-t border-white/8 px-4 py-2.5 flex items-center gap-3">
          <button className="flex items-center gap-1.5 text-[11px] text-[#FF8A7A]/80 hover:text-[#FF8A7A] font-medium">
            <ExternalLink className="w-3 h-3" /> 리서치 보고서
            <span className="text-white/25 font-normal">5/12</span>
          </button>
          <div className="flex-1" />
          <button className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white">
            <ChevronDown className="w-3.5 h-3.5" /> 요약 보기
          </button>
        </div>
      </div>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/8 text-[11px] text-white/40 border border-white/10">
        A안 — 뉴스라인 (인라인 한 줄 + 확장)
      </div>
    </div>
  );
}
