export function ModernMinimal() {
  return (
    <div className="flex h-screen w-full" style={{ background: "#fafafa", fontFamily: "Inter, sans-serif" }}>
      {/* Sidebar */}
      <div className="w-52 flex-shrink-0 flex flex-col border-r" style={{ background: "#fff", borderColor: "#f0f0f0" }}>
        {/* Logo */}
        <div className="px-5 py-5">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md" style={{ background: "#111" }} />
            <span className="text-sm font-bold tracking-tight" style={{ color: "#111" }}>CBST</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3">
          {[
            { label: "AI 기업분석", active: true },
            { label: "투자 아이디어", active: false },
            { label: "뉴스", active: false },
          ].map((item) => (
            <div
              key={item.label}
              className="px-3 py-2 rounded-lg mb-0.5 text-sm cursor-pointer"
              style={{
                background: item.active ? "#f5f5f5" : "transparent",
                color: item.active ? "#111" : "#999",
                fontWeight: item.active ? 500 : 400,
              }}
            >
              {item.label}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "#bbb" }}>
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#22c55e" }} />
            실시간 연동
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-11 border-b flex items-center px-8 justify-between" style={{ background: "#fff", borderColor: "#f0f0f0" }}>
          <div className="flex items-center gap-4 text-xs" style={{ color: "#999" }}>
            <span>KOSPI <span style={{ color: "#22c55e", fontWeight: 500 }}>2,612.35</span></span>
            <span>KOSDAQ <span style={{ color: "#ef4444", fontWeight: 500 }}>768.21</span></span>
          </div>
          <span className="text-xs" style={{ color: "#ccc" }}>2026.04.15</span>
        </div>

        {/* Hero content */}
        <div className="flex-1 flex flex-col items-center justify-center px-10 pb-10">
          <div className="text-center mb-10 max-w-lg">
            <p className="text-xs uppercase tracking-widest mb-5" style={{ color: "#bbb" }}>CBST AI Research</p>
            <h1 className="text-4xl font-bold mb-4 leading-tight" style={{ color: "#111", letterSpacing: "-0.02em" }}>
              어떤 종목을<br />분석할까요?
            </h1>
            <p className="text-sm leading-relaxed" style={{ color: "#888" }}>
              코스피·코스닥 종목코드 또는 기업명을 입력하면<br />AI가 즉시 심층 분석을 시작합니다
            </p>
          </div>

          {/* Search */}
          <div className="w-full max-w-lg mb-5">
            <div className="flex items-center rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1.5px solid #e8e8e8", boxShadow: "0 2px 20px rgba(0,0,0,0.06)" }}>
              <div className="pl-5" style={{ color: "#ccc" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              </div>
              <input
                className="flex-1 px-4 py-4 text-sm outline-none bg-transparent"
                placeholder="종목명 또는 코드 입력"
                style={{ color: "#111" }}
                readOnly
              />
              <button className="mr-2 px-5 py-2.5 rounded-xl text-sm font-medium" style={{ background: "#111", color: "#fff" }}>
                분석
              </button>
            </div>
          </div>

          {/* Quick chips */}
          <div className="flex gap-2">
            {["삼성전자", "SK하이닉스", "NAVER"].map((t) => (
              <button key={t} className="px-4 py-1.5 rounded-full text-xs border" style={{ borderColor: "#e8e8e8", color: "#666", background: "#fff" }}>{t}</button>
            ))}
          </div>

          {/* Recent */}
          <div className="mt-12 w-full max-w-lg">
            <p className="text-xs mb-4" style={{ color: "#bbb" }}>최근 분석</p>
            <div className="space-y-2">
              {[
                { ticker: "005930", name: "삼성전자", verdict: "Strong Buy", upside: "+42.4%", verdictColor: "#22c55e", bg: "#f0fdf4" },
                { ticker: "032830", name: "삼성생명", verdict: "Hold", upside: "+1.9%", verdictColor: "#999", bg: "#fafafa" },
              ].map((r) => (
                <div key={r.ticker} className="flex items-center justify-between px-5 py-3.5 rounded-xl cursor-pointer" style={{ background: "#fff", border: "1px solid #f0f0f0" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: "#bbb" }}>{r.ticker}</span>
                    <span className="text-sm font-medium" style={{ color: "#111" }}>{r.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm" style={{ color: r.verdictColor }}>{r.upside}</span>
                    <span className="text-xs px-2.5 py-1 rounded-full" style={{ background: r.bg, color: r.verdictColor }}>{r.verdict}</span>
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
