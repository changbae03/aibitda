import { useState } from "react";

const MOCK_CATS = [
  {
    id: "markets", name: "글로벌 시장", icon: "🌐",
    items: [
      { id: "sp500",  name: "S&P 500",   nameEn: "S&P 500",   flag: "🇺🇸", value: "7,508",  chg: +0.46, unit: "pt" },
      { id: "nasdaq", name: "나스닥",     nameEn: "Nasdaq",    flag: "🇺🇸", value: "26,554", chg: +0.80, unit: "pt" },
      { id: "dow",    name: "다우존스",   nameEn: "Dow Jones", flag: "🇺🇸", value: "50,451", chg: -0.25, unit: "pt" },
      { id: "nikkei", name: "닛케이",     nameEn: "Nikkei",    flag: "🇯🇵", value: "64,996", chg: -0.25, unit: "pt" },
      { id: "kospi",  name: "코스피",     nameEn: "KOSPI",     flag: "🇰🇷", value: "8,048",  chg: +2.55, unit: "pt" },
      { id: "stoxx",  name: "유로스탁스", nameEn: "Euro Stoxx",flag: "🇪🇺", value: "6,064",  chg: -1.18, unit: "pt" },
    ]
  },
  {
    id: "commodities", name: "원자재", icon: "📦",
    items: [
      { id: "wti",    name: "WTI 원유", nameEn: "WTI Crude", flag: "🛢️", value: "93.97", chg: -2.72, unit: "$/bbl" },
      { id: "brent",  name: "브렌트",   nameEn: "Brent",     flag: "🛢️", value: "97.19", chg: -3.01, unit: "$/bbl" },
      { id: "gold",   name: "금",       nameEn: "Gold",      flag: "🥇", value: "4,506", chg: -0.38, unit: "$/oz" },
      { id: "silver", name: "은",       nameEn: "Silver",    flag: "🥈", value: "76.34", chg: +0.19, unit: "$/oz" },
    ]
  },
];

const INSIGHTS = [
  {
    theme: "미 연준 금리 동결 기대", sentiment: "positive",
    desc: "연준의 금리 동결 시사로 채권 가격 상승 압력이 지속됩니다.",
    etfs: ["TIGER 미국채10년선물", "KODEX 미국채울트라30년선물(H)"],
  },
  {
    theme: "유럽 경기 둔화 우려", sentiment: "negative",
    desc: "Euro Stoxx 약세와 독일 제조업 PMI 부진이 이를 반영합니다.",
    etfs: [],
  },
  {
    theme: "원자재 복합 시그널", sentiment: "mixed",
    desc: "유가 하락, 금 횡보로 인플레이션 기대가 혼재합니다.",
    etfs: ["KODEX 골드선물(H)", "TIGER 원유선물Enhanced(H)"],
  },
];

const SENT = {
  positive: { dot: "bg-emerald-400", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", label: "긍정" },
  negative: { dot: "bg-rose-400",    badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400",         label: "부정" },
  mixed:    { dot: "bg-amber-400",   badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",      label: "혼조" },
};

const TABS = [
  { id: "all",         label: "전체" },
  { id: "markets",     label: "글로벌 시장" },
  { id: "commodities", label: "원자재" },
  { id: "insights",    label: "✦ AI 시사점" },
];

export function Modern() {
  const [activeTab, setActiveTab] = useState("all");
  const [open, setOpen] = useState<number | null>(null);

  const cats = MOCK_CATS.filter(c =>
    activeTab === "all" || activeTab === "insights" || c.id === activeTab
  );

  return (
    <div className="min-h-screen bg-[#f8f8f6] dark:bg-[#111110] font-sans">
      <div className="max-w-3xl mx-auto px-5 py-9">

        {/* 헤더 */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 tracking-widest uppercase mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              Live
            </span>
            <h2 className="text-[22px] font-bold text-zinc-900 dark:text-zinc-50 tracking-tight leading-none">
              글로벌 거시 대시보드
            </h2>
          </div>
          <button className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors mt-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            오후 04:16
          </button>
        </div>

        {/* AI 내러티브 — 그라디언트 카드 */}
        <div className="relative rounded-2xl overflow-hidden mb-6 p-px"
          style={{ background: "linear-gradient(135deg, #e8e4f0 0%, #e4edf8 50%, #e4f0eb 100%)" }}>
          <div className="rounded-[calc(1rem-1px)] bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm px-5 py-4">
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"/>
                </svg>
              </div>
              <p className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                현재 글로벌 금융시장은 한국 증시의 독보적인 강세와 미국 기술주의 상승세 속에서
                지역별 차별화된 흐름을 보이고 있습니다. 국제 유가 하락 및 미 국채 금리 동반 하락은
                인플레이션 완화 및 연방준비제도(Fed)의 금리 정책 변화 기대를 높이는 요인입니다.
              </p>
            </div>
          </div>
        </div>

        {/* 카테고리 탭 — 필 스타일 */}
        <div className="flex items-center gap-1.5 mb-5 flex-wrap">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-all ${
                activeTab === t.id
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-sm"
                  : "bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* 마켓 카드 그리드 */}
        {activeTab !== "insights" && cats.map(cat => (
          <div key={cat.id} className="mb-6">
            <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-2.5 px-0.5">{cat.name}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {cat.items.map(item => {
                const up = item.chg >= 0;
                return (
                  <div key={item.id}
                    className="bg-white dark:bg-zinc-900 rounded-2xl px-4 py-3.5 shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-shadow"
                    style={{ borderLeft: `2px solid ${up ? "#10b981" : "#ef4444"}` }}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-base leading-none">{item.flag}</span>
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500 font-medium truncate">{item.name}</span>
                    </div>
                    <div className="font-mono font-bold text-[17px] tracking-tight leading-none"
                      style={{ color: up ? "#10b981" : "#ef4444" }}>
                      {item.value}
                    </div>
                    <div className="mt-1.5 text-[11px] font-mono font-medium"
                      style={{ color: up ? "#10b981" : "#ef4444" }}>
                      {up ? "▲" : "▼"} {up ? "+" : ""}{item.chg.toFixed(2)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* AI 시사점 */}
        {(activeTab === "all" || activeTab === "insights") && (
          <div className="mt-2">
            {activeTab === "all" && (
              <p className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest mb-2.5">AI 시사점</p>
            )}
            <div className="space-y-2">
              {INSIGHTS.map((ins, i) => {
                const cfg = SENT[ins.sentiment as keyof typeof SENT];
                return (
                  <div key={i} className="bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
                    <button
                      onClick={() => setOpen(open === i ? null : i)}
                      className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                        <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{ins.theme}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.badge}`}>{cfg.label}</span>
                      </div>
                      <svg className={`w-4 h-4 text-zinc-300 transition-transform shrink-0 ${open === i ? "rotate-180" : ""}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {open === i && (
                      <div className="px-4 pb-4 pt-1 border-t border-zinc-100 dark:border-zinc-800">
                        <p className="text-[12px] text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">{ins.desc}</p>
                        {ins.etfs.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {ins.etfs.map(etf => (
                              <span key={etf} className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-medium">
                                {etf}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 레이블 */}
        <div className="mt-10 pt-4 border-t border-zinc-100 dark:border-zinc-800/50 flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-widest text-zinc-300 dark:text-zinc-700 uppercase">B — 모던 글로스</span>
          <span className="text-[11px] text-zinc-300 dark:text-zinc-700">라운드 카드 · 그라디언트 배너 · 컬러 좌측 보더</span>
        </div>
      </div>
    </div>
  );
}
