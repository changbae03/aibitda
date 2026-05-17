import { useState } from "react";
import {
  AlertTriangle, Zap, ExternalLink, ChevronDown,
  Newspaper, Activity, ChevronUp, X,
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
    catalyst: "3분기 실적발표(10/31)에서 HBM 매출 비중 첫 10% 돌파 예상",
  },
};

export function SwipeUp() {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
      <div className="w-full max-w-sm relative">
        {/* ── 메인 카드 ── */}
        <div
          className={`rounded-2xl border border-white/10 bg-[#161616] overflow-hidden shadow-xl transition-all duration-300 ${
            sheetOpen ? "opacity-40 scale-[0.98] pointer-events-none" : "opacity-100 scale-100"
          }`}
        >
          {/* 헤더 */}
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
                  <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full border font-semibold bg-green-500/10 border-green-500/25 text-green-400">
                    상승여력
                  </span>
                </div>
              </div>
            </div>

            {/* 가격 */}
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

          {/* 하단 바 */}
          <div className="border-t border-white/8 px-4 py-2.5 flex items-center gap-3">
            <button className="flex items-center gap-1.5 text-[11px] text-[#FF8A7A]/80 font-medium">
              <ExternalLink className="w-3 h-3" /> 리서치 보고서
              <span className="text-white/25 font-normal">5/12</span>
            </button>
            <div className="flex-1" />
            <button className="flex items-center gap-1 text-[11px] text-white/40">
              <ChevronDown className="w-3.5 h-3.5" /> 요약 보기
            </button>
          </div>

          {/* ── 스와이프업 핸들 ── */}
          <button
            onClick={() => setSheetOpen(true)}
            className="w-full flex items-center gap-2.5 px-4 py-3 bg-amber-500/8 border-t border-amber-500/15 hover:bg-amber-500/12 transition-colors"
          >
            <Newspaper className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <p className="flex-1 text-[12px] text-amber-300/75 line-clamp-1 min-w-0 text-left">
              {MOCK.brief.core}
            </p>
            <ChevronUp className="w-3.5 h-3.5 text-amber-400/60 shrink-0" />
          </button>
        </div>

        {/* ── 바텀 시트 ── */}
        <div
          className={`absolute inset-x-0 bottom-0 rounded-2xl overflow-hidden transition-all duration-300 ease-out ${
            sheetOpen
              ? "translate-y-0 opacity-100 pointer-events-auto"
              : "translate-y-full opacity-0 pointer-events-none"
          }`}
          style={{ top: "auto" }}
        >
          <div className="bg-[#1c1c1c] border border-amber-500/20 rounded-2xl shadow-2xl">
            {/* 시트 헤더 */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8">
              <div className="w-5 h-5 rounded-lg bg-amber-500/15 flex items-center justify-center">
                <Newspaper className="w-3 h-3 text-amber-400" />
              </div>
              <span className="text-[13px] font-semibold text-white flex-1">오늘의 핵심 브리핑</span>
              <span className="text-[10px] text-white/30 mr-2">2026.05.17</span>
              <button onClick={() => setSheetOpen(false)} className="p-1 rounded-lg hover:bg-white/8 text-white/40">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* 브리핑 콘텐츠 */}
            <div className="px-4 py-4 space-y-3">
              <div className="flex gap-2.5">
                <Activity className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">오늘의 핵심</p>
                  <p className="text-[13px] text-white/85 leading-relaxed font-medium">{MOCK.brief.core}</p>
                </div>
              </div>
              <div className="h-px bg-white/6" />
              <div className="flex gap-2.5">
                <Zap className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">촉매</p>
                  <p className="text-[12.5px] text-white/70 leading-relaxed">{MOCK.brief.catalyst}</p>
                </div>
              </div>
              <div className="h-px bg-white/6" />
              <div className="flex gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1">리스크</p>
                  <p className="text-[12.5px] text-white/70 leading-relaxed">{MOCK.brief.risk}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/8 text-[11px] text-white/40 border border-white/10">
        C안 — 스와이프업 바텀 시트
      </div>
    </div>
  );
}
