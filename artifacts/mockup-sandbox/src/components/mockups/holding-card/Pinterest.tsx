import { useState } from "react";
import {
  TrendingUp, AlertTriangle, Zap, ExternalLink, ChevronDown,
  Newspaper, Activity,
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

export function Pinterest() {
  const [tab, setTab] = useState<"price" | "brief">("price");

  return (
    <div className="min-h-screen bg-[#0f0f0f] flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#161616] overflow-hidden shadow-xl">

        {/* ── 헤더 ── */}
        <div className="px-4 pt-4 pb-0">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-11 h-11 rounded-xl bg-blue-500/20 text-blue-300 flex items-center justify-center text-[18px] font-bold shrink-0">
              삼
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-white leading-tight">{MOCK.name}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="font-mono text-[11px] text-white/40">{MOCK.ticker}</span>
                <span className="text-[10px] text-white/30">· {MOCK.industry}</span>
              </div>
            </div>
            <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full border font-semibold bg-green-500/10 border-green-500/25 text-green-400">
              상승여력
            </span>
          </div>

          {/* 탭 스위처 */}
          <div className="flex rounded-xl bg-white/5 p-0.5 mb-0">
            <button
              onClick={() => setTab("price")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-[12px] font-semibold transition-all ${
                tab === "price"
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" /> 가격 정보
            </button>
            <button
              onClick={() => setTab("brief")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-[12px] font-semibold transition-all ${
                tab === "brief"
                  ? "bg-amber-500/15 text-amber-300 shadow-sm"
                  : "text-white/40 hover:text-white/60"
              }`}
            >
              <Newspaper className="w-3.5 h-3.5" /> 오늘 브리핑
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            </button>
          </div>
        </div>

        {/* ── 가격 탭 ── */}
        {tab === "price" && (
          <div className="px-4 pt-3 pb-4">
            <div className="grid grid-cols-2 gap-2 mb-3">
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
            {/* 미니 브리핑 티저 */}
            <button
              onClick={() => setTab("brief")}
              className="w-full flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-left hover:bg-amber-500/10 transition-colors"
            >
              <Newspaper className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <p className="flex-1 text-[12px] text-amber-300/80 line-clamp-1 min-w-0">
                {MOCK.brief.core}
              </p>
              <span className="text-[10px] text-amber-400/60 shrink-0">더보기 →</span>
            </button>
          </div>
        )}

        {/* ── 브리핑 탭 (핀터레스트 스타일 — 섹션별 비주얼 카드) ── */}
        {tab === "brief" && (
          <div className="px-4 pt-3 pb-4 space-y-2.5">
            {/* 핵심 */}
            <div className="rounded-xl bg-gradient-to-br from-amber-500/10 to-amber-500/5 border border-amber-500/20 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Activity className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">오늘의 핵심</span>
              </div>
              <p className="text-[13px] text-white/85 leading-relaxed font-medium">{MOCK.brief.core}</p>
            </div>
            {/* 촉매 */}
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border border-emerald-500/20 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">촉매</span>
              </div>
              <p className="text-[12.5px] text-white/75 leading-relaxed">{MOCK.brief.catalyst}</p>
            </div>
            {/* 리스크 */}
            <div className="rounded-xl bg-gradient-to-br from-red-500/10 to-red-500/5 border border-red-500/20 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">리스크</span>
              </div>
              <p className="text-[12.5px] text-white/75 leading-relaxed">{MOCK.brief.risk}</p>
            </div>
          </div>
        )}

        {/* ── 하단 ── */}
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
        B안 — 핀터레스트 (탭 전환형)
      </div>
    </div>
  );
}
