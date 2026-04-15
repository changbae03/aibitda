export function DarkTerminal() {
  return (
    <div className="flex h-screen w-full font-mono" style={{ background: "#0a0e13", color: "#c9d1d9" }}>
      {/* Sidebar */}
      <div className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "#0d1117", borderColor: "#21262d" }}>
        {/* Logo */}
        <div className="px-4 py-4 border-b flex items-center gap-2.5" style={{ borderColor: "#21262d" }}>
          <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold" style={{ background: "#1f6feb", color: "#fff" }}>C</div>
          <div>
            <div className="text-xs font-bold tracking-widest" style={{ color: "#58a6ff", fontFamily: "monospace" }}>CBST</div>
            <div className="text-[9px]" style={{ color: "#484f58" }}>RESEARCH TERMINAL</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {[
            { icon: "⬡", label: "AI 기업분석", active: true },
            { icon: "◈", label: "투자 아이디어", active: false },
            { icon: "◉", label: "뉴스", active: false },
          ].map((item) => (
            <div
              key={item.label}
              className="flex items-center gap-2.5 px-3 py-2 rounded text-xs cursor-pointer"
              style={{
                background: item.active ? "#1f6feb22" : "transparent",
                color: item.active ? "#58a6ff" : "#8b949e",
                border: item.active ? "1px solid #1f6feb44" : "1px solid transparent",
              }}
            >
              <span style={{ fontFamily: "monospace", fontSize: "14px" }}>{item.icon}</span>
              {item.label}
            </div>
          ))}
        </nav>

        {/* Status bar */}
        <div className="px-4 py-3 border-t text-[10px]" style={{ borderColor: "#21262d", color: "#484f58" }}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "#3fb950" }} />
            <span>시스템 정상</span>
          </div>
          <div>KOSPI · KOSDAQ 실시간</div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-10 border-b flex items-center px-5 text-[11px] justify-between" style={{ borderColor: "#21262d", background: "#0d1117" }}>
          <div className="flex items-center gap-3" style={{ color: "#484f58" }}>
            <span>KOSPI</span>
            <span style={{ color: "#3fb950" }}>▲ 2,612.35 +0.42%</span>
            <span className="mx-2" style={{ color: "#21262d" }}>|</span>
            <span>KOSDAQ</span>
            <span style={{ color: "#f85149" }}>▼ 768.21 -0.18%</span>
          </div>
          <div style={{ color: "#484f58" }}>2026.04.15 02:30 KST</div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center px-8">
          <div className="text-center mb-10">
            <div className="text-[11px] tracking-[0.3em] mb-3" style={{ color: "#1f6feb", fontFamily: "monospace" }}>// CBST AI RESEARCH ENGINE v2.0</div>
            <h1 className="text-3xl font-bold mb-3 tracking-tight" style={{ color: "#e6edf3" }}>종목 분석 터미널</h1>
            <p className="text-sm" style={{ color: "#8b949e" }}>KOSPI · KOSDAQ 종목코드 또는 기업명 입력</p>
          </div>

          <div className="w-full max-w-xl">
            <div className="flex rounded overflow-hidden border" style={{ borderColor: "#30363d", background: "#161b22" }}>
              <div className="flex items-center px-4" style={{ color: "#484f58" }}>
                <span className="text-sm">$</span>
              </div>
              <input
                className="flex-1 py-3.5 text-sm outline-none bg-transparent"
                placeholder="종목명 또는 코드 입력 (예: 삼성전자, 005930)"
                style={{ color: "#c9d1d9" }}
                readOnly
              />
              <button className="px-5 text-sm font-medium" style={{ background: "#1f6feb", color: "#fff" }}>
                RUN →
              </button>
            </div>

            {/* Quick access */}
            <div className="mt-4 flex gap-2 flex-wrap">
              {["005930 · 삼성전자", "000660 · SK하이닉스", "035420 · NAVER"].map((t) => (
                <div key={t} className="px-3 py-1.5 rounded text-[11px] border cursor-pointer" style={{ borderColor: "#30363d", color: "#8b949e", background: "#161b22" }}>
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* Recent analyses */}
          <div className="mt-12 w-full max-w-xl">
            <div className="text-[10px] tracking-widest mb-3" style={{ color: "#484f58", fontFamily: "monospace" }}>// RECENT_ANALYSES</div>
            <div className="space-y-2">
              {[
                { ticker: "005930", name: "삼성전자", verdict: "Strong Buy", upside: "+42.4%", color: "#3fb950" },
                { ticker: "032830", name: "삼성생명", verdict: "Hold", upside: "+1.9%", color: "#8b949e" },
              ].map((r) => (
                <div key={r.ticker} className="flex items-center justify-between px-4 py-3 rounded border text-sm" style={{ borderColor: "#21262d", background: "#161b22" }}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono" style={{ color: "#484f58" }}>{r.ticker}</span>
                    <span style={{ color: "#c9d1d9" }}>{r.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span style={{ color: r.color, fontFamily: "monospace", fontSize: "12px" }}>{r.upside}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: r.color + "20", color: r.color }}>{r.verdict}</span>
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
