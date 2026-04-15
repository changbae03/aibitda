export function PremiumNavy() {
  return (
    <div className="flex h-screen w-full" style={{ background: "#f4f5f7", fontFamily: "Inter, sans-serif" }}>
      {/* Sidebar */}
      <div className="w-60 flex-shrink-0 flex flex-col" style={{ background: "linear-gradient(180deg, #0f2044 0%, #1a3a6b 100%)" }}>
        {/* Logo */}
        <div className="px-5 py-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm" style={{ background: "linear-gradient(135deg, #c9a227, #f0c040)", color: "#0f2044" }}>C</div>
            <div>
              <div className="text-xs font-bold tracking-widest" style={{ color: "#f0c040" }}>CBST</div>
              <div className="text-[9px] tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>AI 리서치센터</div>
            </div>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-5 space-y-1">
          {[
            { label: "AI 기업분석", icon: "◈", active: true, sub: "종목 심층 리서치" },
            { label: "투자 아이디어", icon: "◉", active: false, sub: "전략 포트폴리오" },
            { label: "뉴스", icon: "◎", active: false, sub: "마켓 인사이트" },
          ].map((item) => (
            <div
              key={item.label}
              className="px-3 py-2.5 rounded-lg cursor-pointer"
              style={{
                background: item.active ? "rgba(240, 192, 64, 0.12)" : "transparent",
                borderLeft: item.active ? "3px solid #f0c040" : "3px solid transparent",
              }}
            >
              <div className="text-[13px] font-medium" style={{ color: item.active ? "#f0c040" : "rgba(255,255,255,0.6)" }}>{item.label}</div>
              <div className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>{item.sub}</div>
            </div>
          ))}
        </nav>

        {/* Bottom badge */}
        <div className="px-4 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <div className="text-[10px] tracking-wider mb-1" style={{ color: "rgba(255,255,255,0.3)" }}>MARKET STATUS</div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80" }} />
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.5)" }}>KOSPI · KOSDAQ 연동 중</span>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-12 border-b flex items-center px-6 justify-between" style={{ background: "#fff", borderColor: "#e5e7eb" }}>
          <div className="flex items-center gap-6 text-xs">
            <span style={{ color: "#6b7280" }}>KOSPI</span>
            <span className="font-semibold" style={{ color: "#16a34a" }}>▲ 2,612.35</span>
            <span style={{ color: "#6b7280" }}>KOSDAQ</span>
            <span className="font-semibold" style={{ color: "#dc2626" }}>▼ 768.21</span>
          </div>
          <div className="text-xs" style={{ color: "#9ca3af" }}>2026.04.15</div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-10 py-10">
          {/* Hero */}
          <div className="mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-4" style={{ background: "#eff6ff", color: "#1d4ed8" }}>
              ✦ CBST AI 기업분석
            </div>
            <h1 className="text-3xl font-bold mb-2" style={{ color: "#111827" }}>어떤 종목을 분석할까요?</h1>
            <p className="text-sm" style={{ color: "#6b7280" }}>코스피·코스닥 종목코드 또는 기업명으로 AI 심층 분석을 시작하세요</p>
          </div>

          {/* Search */}
          <div className="w-full max-w-2xl mb-8">
            <div className="flex rounded-xl overflow-hidden shadow-lg" style={{ border: "1.5px solid #1a3a6b22" }}>
              <div className="flex items-center px-4 bg-white" style={{ color: "#9ca3af" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </div>
              <input
                className="flex-1 py-4 text-sm outline-none bg-white"
                placeholder="종목명 또는 코드 입력"
                style={{ color: "#111827" }}
                readOnly
              />
              <button className="px-6 text-sm font-semibold" style={{ background: "linear-gradient(135deg, #0f2044, #1a3a6b)", color: "#f0c040" }}>
                분석 시작 →
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              {["005930 · 삼성전자", "000660 · SK하이닉스"].map((t) => (
                <button key={t} className="px-3 py-1.5 rounded-full text-[11px] border" style={{ borderColor: "#d1d5db", color: "#374151", background: "#fff" }}>{t}</button>
              ))}
            </div>
          </div>

          {/* Recent */}
          <div>
            <h2 className="text-xs font-semibold tracking-widest mb-4" style={{ color: "#9ca3af" }}>최근 분석</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { ticker: "005930", name: "삼성전자", verdict: "Strong Buy", upside: "+42.4%", date: "4월 14일", verdictColor: "#16a34a" },
                { ticker: "032830", name: "삼성생명", verdict: "Hold", upside: "+1.9%", date: "4월 15일", verdictColor: "#6b7280" },
              ].map((r) => (
                <div key={r.ticker} className="bg-white rounded-xl p-4 shadow-sm border" style={{ borderColor: "#f3f4f6" }}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-xs font-mono mb-0.5" style={{ color: "#9ca3af" }}>{r.ticker}</div>
                      <div className="font-semibold" style={{ color: "#111827" }}>{r.name}</div>
                    </div>
                    <span className="text-[11px] px-2.5 py-1 rounded-full font-medium" style={{ background: r.verdictColor + "15", color: r.verdictColor }}>{r.verdict}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs" style={{ color: "#9ca3af" }}>{r.date}</span>
                    <span className="font-bold text-sm" style={{ color: r.verdictColor }}>{r.upside}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
