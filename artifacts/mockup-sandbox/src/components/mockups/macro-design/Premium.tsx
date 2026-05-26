import { useState } from "react";

const MOCK_CATS = [
  {
    id: "markets", name: "글로벌 시장",
    items: [
      { id: "sp500",  name: "S&P 500",    flag: "🇺🇸", value: "7,508",  chg: +0.46 },
      { id: "nasdaq", name: "Nasdaq",      flag: "🇺🇸", value: "26,554", chg: +0.80 },
      { id: "dow",    name: "Dow Jones",   flag: "🇺🇸", value: "50,451", chg: -0.25 },
      { id: "nikkei", name: "Nikkei 225",  flag: "🇯🇵", value: "64,996", chg: -0.25 },
      { id: "kospi",  name: "KOSPI",       flag: "🇰🇷", value: "8,048",  chg: +2.55 },
      { id: "stoxx",  name: "Euro Stoxx",  flag: "🇪🇺", value: "6,064",  chg: -1.18 },
      { id: "wti",    name: "WTI",         flag: "🛢️", value: "93.97",  chg: -2.72 },
      { id: "gold",   name: "Gold",        flag: "🥇", value: "4,506",  chg: -0.38 },
    ]
  },
];

const INSIGHTS = [
  {
    theme: "Fed 금리 동결 기대", sentiment: "positive",
    desc: "연준의 금리 동결 시사로 채권 가격 상승 압력이 지속됩니다.",
    krEtfs: [{ ticker: "305080", name: "TIGER 미국채10년선물" }],
    usEtfs: [{ ticker: "TLT", name: "iShares 20+ Year" }],
  },
  {
    theme: "유럽 경기 둔화",  sentiment: "negative",
    desc: "Euro Stoxx 약세와 독일 제조업 PMI 부진이 리스크를 키웁니다.",
    krEtfs: [],
    usEtfs: [{ ticker: "EUO", name: "ProShares Short Euro" }],
  },
  {
    theme: "원자재 혼조 흐름", sentiment: "mixed",
    desc: "유가 하락, 금 횡보로 인플레이션 기대가 혼재합니다.",
    krEtfs: [{ ticker: "132030", name: "KODEX 골드선물(H)" }],
    usEtfs: [{ ticker: "GLD", name: "SPDR Gold Shares" }],
  },
];

const SENT_STYLE = {
  positive: { bg: "bg-emerald-950/40 border-emerald-800/40", badge: "text-emerald-400 border-emerald-800", dot: "bg-emerald-400", label: "↑ 긍정" },
  negative: { bg: "bg-rose-950/40 border-rose-800/40",       badge: "text-rose-400 border-rose-800",       dot: "bg-rose-400",    label: "↓ 부정" },
  mixed:    { bg: "bg-amber-950/40 border-amber-800/40",     badge: "text-amber-400 border-amber-800",     dot: "bg-amber-400",  label: "~ 혼조" },
};

const TABS = ["전체", "글로벌 시장", "AI 시사점"];

export function Premium() {
  const [activeTab, setActiveTab] = useState("전체");
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="max-w-3xl mx-auto px-5 py-9">

        {/* 헤더 — 터미널 스타일 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-rose-500" />
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <span className="text-xs text-zinc-500 tracking-widest uppercase ml-2">
              MACRO / GLOBAL / 04:16 KST
            </span>
          </div>
          <button className="text-[10px] text-zinc-600 hover:text-zinc-400 border border-zinc-800 px-2 py-1 rounded transition-colors">
            ↺ 새로고침
          </button>
        </div>

        {/* AI 내러티브 — 터미널 블록 */}
        <div className="border border-zinc-800 rounded-xl p-4 mb-6 bg-zinc-900/50">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] text-emerald-500 font-mono">▶ AI.NARRATIVE</span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          <p className="text-[12px] text-zinc-400 leading-relaxed font-sans">
            현재 글로벌 금융시장은 한국 증시의 독보적인 강세와 미국 기술주의 상승세 속에서
            지역별 차별화된 흐름을 보이고 있습니다. 국제 유가 하락 및 미 국채 금리 동반 하락은
            인플레이션 완화 및 연방준비제도(Fed)의 금리 정책 변화 기대를 높입니다.
          </p>
        </div>

        {/* 탭 — 터미널 세그먼트 */}
        <div className="flex gap-0 mb-5 border border-zinc-800 rounded-lg overflow-hidden w-fit">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-[11px] font-mono font-semibold tracking-wider transition-colors ${
                activeTab === t
                  ? "bg-zinc-100 text-zinc-900"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
              } ${i > 0 ? "border-l border-zinc-800" : ""}`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* 마켓 데이터 — 테이블 스타일 */}
        {activeTab !== "AI 시사점" && (
          <div className="border border-zinc-800 rounded-xl overflow-hidden mb-6">
            <div className="grid grid-cols-4 px-4 py-2 bg-zinc-900/80 border-b border-zinc-800">
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest">지수</span>
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest text-right col-span-2">현재가</span>
              <span className="text-[10px] text-zinc-600 uppercase tracking-widest text-right">등락률</span>
            </div>
            {MOCK_CATS[0].items.map((item, i) => {
              const up = item.chg >= 0;
              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-4 items-center px-4 py-3 hover:bg-zinc-900/40 transition-colors ${
                    i < MOCK_CATS[0].items.length - 1 ? "border-b border-zinc-800/50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{item.flag}</span>
                    <span className="text-[12px] text-zinc-400 font-sans">{item.name}</span>
                  </div>
                  <span className="text-[14px] font-mono font-semibold text-zinc-100 col-span-2 text-right pr-4">
                    {item.value}
                  </span>
                  <span className={`text-[13px] font-mono font-bold text-right ${up ? "text-emerald-400" : "text-rose-400"}`}>
                    {up ? "+" : ""}{item.chg.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* AI 시사점 */}
        {(activeTab === "전체" || activeTab === "AI 시사점") && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[10px] text-emerald-500 font-mono">▶ AI.INSIGHTS</span>
              <div className="h-px flex-1 bg-zinc-800" />
            </div>
            <div className="space-y-2">
              {INSIGHTS.map((ins, i) => {
                const cfg = SENT_STYLE[ins.sentiment as keyof typeof SENT_STYLE];
                return (
                  <div key={i} className={`border rounded-xl overflow-hidden ${cfg.bg}`}>
                    <button
                      onClick={() => setOpen(open === i ? null : i)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} shrink-0`} />
                        <span className="text-[13px] font-semibold font-sans text-zinc-200">{ins.theme}</span>
                        <span className={`text-[10px] font-mono font-bold border px-1.5 py-0.5 rounded ${cfg.badge}`}>{cfg.label}</span>
                      </div>
                      <svg className={`w-3.5 h-3.5 text-zinc-600 transition-transform ${open === i ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {open === i && (
                      <div className="px-4 pb-4 pt-2 border-t border-white/10 space-y-3">
                        <p className="text-[12px] text-zinc-400 leading-relaxed font-sans">{ins.desc}</p>
                        <div className="flex gap-3">
                          {ins.krEtfs.length > 0 && (
                            <div>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1.5">KR ETF</p>
                              <div className="flex flex-wrap gap-1.5">
                                {ins.krEtfs.map(e => (
                                  <span key={e.ticker} className="text-[11px] font-mono px-2 py-1 rounded-md bg-blue-950/60 border border-blue-900/60 text-blue-300">
                                    {e.ticker} <span className="text-[10px] text-blue-500">{e.name}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {ins.usEtfs.length > 0 && (
                            <div>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-widest mb-1.5">US ETF</p>
                              <div className="flex flex-wrap gap-1.5">
                                {ins.usEtfs.map(e => (
                                  <span key={e.ticker} className="text-[11px] font-mono px-2 py-1 rounded-md bg-violet-950/60 border border-violet-900/60 text-violet-300">
                                    {e.ticker} <span className="text-[10px] text-violet-500">{e.name}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 레이블 */}
        <div className="mt-10 pt-4 border-t border-zinc-800 flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest text-zinc-700 uppercase">C — 프리미엄 다크</span>
          <span className="text-[10px] text-zinc-700">터미널 테이블 · 모노 폰트 · 고대비</span>
        </div>
      </div>
    </div>
  );
}
