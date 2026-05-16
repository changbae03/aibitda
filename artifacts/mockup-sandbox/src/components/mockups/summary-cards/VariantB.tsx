import { useState } from "react";

const mock = {
  ticker: "018290",
  companyName: "에이피알",
  verdict: "BUY",
  targetPrice: 477800,
  currentPrice: 404000,
  upside: 18.3,
  entryMin: 380000,
  entryMax: 402000,
  stopLoss: 370000,
  rrRatio: 4.18,
  bear: 311900,
  base: 477800,
  bull: 548900,
  catalysts: [
    "북미·유럽 오프라인 채널 가속 확장",
    "메디컬 뷰티 디바이스 신제품 출시",
    "2026E 매출 2.86조원 (+87%)",
  ],
  risks: [
    "글로벌 경기 침체 → 소비 심리 위축",
    "경쟁사 대비 밸류에이션 프리미엄 부담",
    "환율 변동 (달러·유로 약세)",
  ],
  eps26: 15279,
  rev26: 28600,
  op26: 7150,
};

const range = mock.bull - mock.bear;
const currentPct = ((mock.currentPrice - mock.bear) / range) * 100;
const basePct = ((mock.base - mock.bear) / range) * 100;

const CARDS = [
  {
    id: "verdict",
    emoji: "🎯",
    title: "투자 의견",
    subtitle: "Investment Verdict",
    accentFrom: "#FF8A7A",
    accentTo: "#FF5A5A",
    content: (
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-4">
          <div>
            <div className="text-6xl font-black" style={{ color: "#FF8A7A" }}>{mock.verdict}</div>
            <div className="text-white/50 text-sm mt-1">12개월 투자의견</div>
          </div>
          <div className="text-right ml-auto">
            <div className="text-3xl font-bold text-white">₩{mock.targetPrice.toLocaleString()}</div>
            <div className="text-sm mt-1" style={{ color: "#FF8A7A" }}>목표주가 +{mock.upside}%</div>
            <div className="text-xs text-white/40 mt-0.5">현재가 ₩{mock.currentPrice.toLocaleString()}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "진입 구간 (하단)", value: `₩${mock.entryMin.toLocaleString()}` },
            { label: "진입 구간 (상단)", value: `₩${mock.entryMax.toLocaleString()}` },
            { label: "손절선", value: `₩${mock.stopLoss.toLocaleString()}` },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="text-xs text-white/40 mb-1">{item.label}</div>
              <div className="text-sm font-bold text-white">{item.value}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: "rgba(255,138,122,0.1)", border: "1px solid rgba(255,138,122,0.2)" }}>
          <div>
            <div className="text-xs text-white/50">손익비 (R/R Ratio)</div>
            <div className="text-2xl font-black" style={{ color: "#FF8A7A" }}>{mock.rrRatio}:1</div>
          </div>
          <div className="text-xs text-white/40 text-right">상방 수익 가능성이<br/>하방 손실의 4.18배</div>
        </div>
      </div>
    ),
  },
  {
    id: "valuation",
    emoji: "💰",
    title: "밸류에이션",
    subtitle: "Valuation Band",
    accentFrom: "#7AB8FF",
    accentTo: "#5A8FFF",
    content: (
      <div className="flex flex-col gap-4">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-3xl font-bold text-white">₩{mock.base.toLocaleString()}</div>
            <div className="text-sm text-white/50 mt-1">12개월 목표주가 (Base)</div>
          </div>
          <div className="rounded-xl px-3 py-1.5 text-sm font-bold" style={{ background: "rgba(122,184,255,0.15)", color: "#7AB8FF" }}>
            DCF 70% + 피어 30%
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs text-white/40 mb-2">
            <span>Bear ₩{mock.bear.toLocaleString()}</span>
            <span>현재가 ₩{mock.currentPrice.toLocaleString()}</span>
            <span>Bull ₩{mock.bull.toLocaleString()}</span>
          </div>
          <div className="relative h-3 rounded-full mb-1" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: "100%", background: "linear-gradient(90deg,#FF5A5A 0%,#FF8A7A 30%,#7AB8FF 70%,#7AE8B4 100%)" }} />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${currentPct}%` }}
            >
              <div className="w-1 h-6 rounded-full bg-white" />
              <div className="text-xs text-white font-bold mt-1 whitespace-nowrap -translate-x-1/2">현재</div>
            </div>
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${basePct}%` }}
            >
              <div className="w-3 h-3 rounded-full" style={{ background: "#7AB8FF", border: "2px solid white" }} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "DCF 내재가치", value: `₩${mock.bull.toLocaleString()}`, color: "#7AB8FF" },
            { label: "피어 목표가", value: `₩${mock.bear.toLocaleString()}`, color: "#FF8A7A" },
            { label: "WACC", value: "9.22%", color: "#7AE8B4" },
            { label: "Terminal Growth", value: "2.0%", color: "#C87AFF" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="text-xs text-white/40 mb-1">{item.label}</div>
              <div className="text-base font-bold" style={{ color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "catalyst",
    emoji: "🚀",
    title: "핵심 촉매",
    subtitle: "Key Catalysts",
    accentFrom: "#7AE8B4",
    accentTo: "#5ADBA0",
    content: (
      <div className="flex flex-col gap-3">
        <div className="text-white/50 text-sm">상승 시나리오를 견인하는 핵심 이벤트</div>
        {mock.catalysts.map((c, i) => (
          <div key={i} className="flex items-start gap-3 rounded-2xl p-4" style={{ background: i === 0 ? "rgba(122,232,180,0.10)" : "rgba(255,255,255,0.05)", border: i === 0 ? "1px solid rgba(122,232,180,0.2)" : "1px solid transparent" }}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
              style={{ background: "rgba(122,232,180,0.2)", color: "#7AE8B4" }}
            >
              {i + 1}
            </div>
            <div>
              <div className="text-white text-sm font-medium leading-snug">{c}</div>
              {i === 0 && <div className="text-xs mt-1" style={{ color: "#7AE8B4" }}>★ 핵심 모니터링 지표</div>}
            </div>
          </div>
        ))}
        <div className="rounded-2xl p-3 text-xs text-white/40" style={{ background: "rgba(255,255,255,0.03)" }}>
          catalyst_analysis 스텝에서 자동 추출
        </div>
      </div>
    ),
  },
  {
    id: "risk",
    emoji: "⚠️",
    title: "주요 리스크",
    subtitle: "Key Risks",
    accentFrom: "#FFB87A",
    accentTo: "#FF8A4A",
    content: (
      <div className="flex flex-col gap-3">
        <div className="text-white/50 text-sm">투자 전 반드시 확인해야 할 하방 리스크</div>
        {mock.risks.map((r, i) => (
          <div key={i} className="flex items-start gap-3 rounded-2xl p-4" style={{ background: i === 0 ? "rgba(255,184,122,0.10)" : "rgba(255,255,255,0.05)", border: i === 0 ? "1px solid rgba(255,184,122,0.2)" : "1px solid transparent" }}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0"
              style={{ background: "rgba(255,184,122,0.2)", color: "#FFB87A" }}
            >
              !
            </div>
            <div className="text-white text-sm font-medium leading-snug">{r}</div>
          </div>
        ))}
        <div className="rounded-2xl p-3 text-xs text-white/40" style={{ background: "rgba(255,255,255,0.03)" }}>
          investment_strategy 스텝에서 자동 추출
        </div>
      </div>
    ),
  },
  {
    id: "earnings",
    emoji: "📈",
    title: "실적 전망",
    subtitle: "2026E Forecasts",
    accentFrom: "#C87AFF",
    accentTo: "#A05AFF",
    content: (
      <div className="flex flex-col gap-4">
        <div className="text-white/50 text-sm">company_analysis 기반 컨센서스 비교</div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "매출", value: `${(mock.rev26 / 10000).toFixed(2)}조`, sub: "+86.9% YoY", color: "#C87AFF" },
            { label: "영업이익", value: `${(mock.op26 / 10000).toFixed(2)}조`, sub: "+72.3% YoY", color: "#7AB8FF" },
            { label: "EPS", value: `₩${(mock.eps26 / 1000).toFixed(1)}k`, sub: "+12.4% YoY", color: "#7AE8B4" },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl p-4 text-center" style={{ background: "rgba(255,255,255,0.05)" }}>
              <div className="text-xs text-white/40 mb-2">{item.label} 2026E</div>
              <div className="text-xl font-black text-white">{item.value}</div>
              <div className="text-xs mt-1 font-medium" style={{ color: item.color }}>{item.sub}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4" style={{ background: "rgba(200,122,255,0.08)", border: "1px solid rgba(200,122,255,0.2)" }}>
          <div className="text-xs text-white/50 mb-2">당사 추정 vs 시장 컨센서스</div>
          <div className="flex justify-between items-center">
            <div>
              <div className="text-sm text-white/60">컨센서스</div>
              <div className="text-lg font-bold text-white">2.71조원</div>
            </div>
            <div className="text-2xl text-white/20">→</div>
            <div className="text-right">
              <div className="text-sm text-white/60">당사 추정</div>
              <div className="text-lg font-bold" style={{ color: "#C87AFF" }}>2.86조원</div>
            </div>
            <div className="rounded-xl px-2 py-1 text-sm font-bold" style={{ background: "rgba(200,122,255,0.15)", color: "#C87AFF" }}>+5.5%</div>
          </div>
        </div>
      </div>
    ),
  },
];

export function VariantB() {
  const [activeIdx, setActiveIdx] = useState(0);
  const card = CARDS[activeIdx];

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "#0f0f0f", fontFamily: "'Pretendard', 'Inter', sans-serif" }}>
      <div className="w-full max-w-md">
        {/* Company header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-white font-bold">{mock.companyName}</span>
            <span className="text-white/30 text-sm">{mock.ticker}</span>
          </div>
          <div className="text-xs text-white/30">
            {activeIdx + 1} / {CARDS.length}
          </div>
        </div>

        {/* Main card */}
        <div
          className="rounded-3xl p-6"
          style={{
            background: `linear-gradient(145deg, rgba(${card.accentFrom === "#FF8A7A" ? "255,138,122" : card.accentFrom === "#7AB8FF" ? "122,184,255" : card.accentFrom === "#7AE8B4" ? "122,232,180" : card.accentFrom === "#FFB87A" ? "255,184,122" : "200,122,255"},0.1) 0%, rgba(255,255,255,0.03) 100%)`,
            border: `1px solid rgba(${card.accentFrom === "#FF8A7A" ? "255,138,122" : card.accentFrom === "#7AB8FF" ? "122,184,255" : card.accentFrom === "#7AE8B4" ? "122,232,180" : card.accentFrom === "#FFB87A" ? "255,184,122" : "200,122,255"},0.2)`,
            minHeight: "380px",
          }}
        >
          <div className="flex items-center gap-2 mb-5">
            <span className="text-xl">{card.emoji}</span>
            <div>
              <div className="font-bold text-white">{card.title}</div>
              <div className="text-xs text-white/40">{card.subtitle}</div>
            </div>
            <div
              className="ml-auto rounded-full px-3 py-1 text-xs font-bold"
              style={{ background: `rgba(${card.accentFrom === "#FF8A7A" ? "255,138,122" : card.accentFrom === "#7AB8FF" ? "122,184,255" : card.accentFrom === "#7AE8B4" ? "122,232,180" : card.accentFrom === "#FFB87A" ? "255,184,122" : "200,122,255"},0.15)`, color: card.accentFrom }}
            >
              {activeIdx + 1}/{CARDS.length}
            </div>
          </div>
          {card.content}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
            disabled={activeIdx === 0}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
            style={{
              background: activeIdx === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.1)",
              color: activeIdx === 0 ? "rgba(255,255,255,0.2)" : "white",
            }}
          >
            ←
          </button>

          <div className="flex gap-1.5">
            {CARDS.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className="rounded-full transition-all"
                style={{
                  width: i === activeIdx ? "24px" : "6px",
                  height: "6px",
                  background: i === activeIdx ? "#FF8A7A" : "rgba(255,255,255,0.2)",
                }}
              />
            ))}
          </div>

          <button
            onClick={() => setActiveIdx((i) => Math.min(CARDS.length - 1, i + 1))}
            disabled={activeIdx === CARDS.length - 1}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
            style={{
              background: activeIdx === CARDS.length - 1 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.1)",
              color: activeIdx === CARDS.length - 1 ? "rgba(255,255,255,0.2)" : "white",
            }}
          >
            →
          </button>
        </div>

        {/* Quick jump tabs */}
        <div className="flex gap-2 mt-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {CARDS.map((c, i) => (
            <button
              key={i}
              onClick={() => setActiveIdx(i)}
              className="flex-shrink-0 rounded-full px-3 py-1.5 text-xs flex items-center gap-1 transition-all"
              style={{
                background: i === activeIdx ? "rgba(255,138,122,0.15)" : "rgba(255,255,255,0.05)",
                color: i === activeIdx ? "#FF8A7A" : "rgba(255,255,255,0.4)",
                border: `1px solid ${i === activeIdx ? "rgba(255,138,122,0.3)" : "transparent"}`,
              }}
            >
              {c.emoji} {c.title}
            </button>
          ))}
        </div>

        <div className="mt-4 text-center text-white/20 text-xs">
          Variant B — 풀 카드 슬라이드 (한 장씩 집중)
        </div>
      </div>
    </div>
  );
}
