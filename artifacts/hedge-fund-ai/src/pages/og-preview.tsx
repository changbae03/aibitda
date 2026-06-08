export default function OGPreview() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        background: "linear-gradient(135deg, #0f1117 0%, #161b2e 60%, #1a1f35 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 80px",
        fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* 배경 장식 */}
      <div style={{
        position: "absolute", top: -120, right: 320,
        width: 500, height: 500,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(255,138,122,0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", bottom: -80, left: 200,
        width: 300, height: 300,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* 왼쪽: 브랜딩 + 설명 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 520 }}>
        {/* 로고 */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "#FF8A7A",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 26, fontWeight: 800, color: "#fff",
          }}>
            애
          </div>
          <span style={{ fontSize: 32, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            애빛다
          </span>
        </div>

        {/* 헤드라인 */}
        <div>
          <div style={{ fontSize: 44, fontWeight: 800, color: "#fff", lineHeight: 1.2, letterSpacing: "-0.03em" }}>
            AI 주식 분석,
          </div>
          <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.2, letterSpacing: "-0.03em" }}>
            <span style={{ color: "#FF8A7A" }}>3분</span>
            <span style={{ color: "#fff" }}>이면 충분합니다</span>
          </div>
        </div>

        {/* 기능 목록 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[
            { icon: "📊", text: "코스피·코스닥·미국 주식 적정주가 산출" },
            { icon: "🔍", text: "DCF·rNPV 기반 7단계 AI 분석 파이프라인" },
            { icon: "📈", text: "피어비교 · 시나리오 · 수급 분석까지" },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>{item.icon}</span>
              <span style={{ fontSize: 17, color: "rgba(255,255,255,0.70)", fontWeight: 500 }}>
                {item.text}
              </span>
            </div>
          ))}
        </div>

        {/* URL 배지 */}
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          background: "rgba(255,138,122,0.15)", borderRadius: 100,
          padding: "8px 18px", width: "fit-content",
          border: "1px solid rgba(255,138,122,0.3)",
        }}>
          <span style={{ fontSize: 15, color: "#FF8A7A", fontWeight: 600 }}>aibitda.kr</span>
        </div>
      </div>

      {/* 오른쪽: 앱 화면 모크업 */}
      <div style={{
        width: 340,
        height: 540,
        borderRadius: 28,
        background: "#1a1f2e",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
      }}>
        {/* 상단바 */}
        <div style={{
          padding: "16px 20px 12px",
          background: "#12151f",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ color: "#FF8A7A", fontWeight: 800, fontSize: 15 }}>애빛다</span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginLeft: "auto" }}>Samsung Electronics</span>
        </div>

        {/* 종목 헤더 */}
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>삼성전자</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>005930 · 반도체</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>74,000</span>
            <span style={{ fontSize: 12, color: "#4ade80" }}>▲ +2.8%</span>
          </div>
        </div>

        {/* 적정주가 카드 */}
        <div style={{
          margin: "14px 16px",
          background: "linear-gradient(135deg, rgba(255,138,122,0.15) 0%, rgba(255,138,122,0.05) 100%)",
          borderRadius: 14,
          padding: "14px 16px",
          border: "1px solid rgba(255,138,122,0.25)",
        }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>AI 적정주가</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#FF8A7A" }}>95,000원</div>
          <div style={{ fontSize: 12, color: "#4ade80", marginTop: 4 }}>상승여력 +28.4%</div>
        </div>

        {/* 시나리오 바 */}
        <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { label: "강세", value: "115,000", color: "#4ade80", pct: 85 },
            { label: "기본", value: "95,000", color: "#FF8A7A", pct: 60 },
            { label: "약세", value: "62,000", color: "#64748b", pct: 30 },
          ].map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", width: 28 }}>{s.label}</span>
              <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.07)", borderRadius: 99 }}>
                <div style={{ width: `${s.pct}%`, height: "100%", background: s.color, borderRadius: 99 }} />
              </div>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", width: 50, textAlign: "right" }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* 하단 투자의견 */}
        <div style={{
          margin: "14px 16px 0",
          background: "rgba(74,222,128,0.08)",
          borderRadius: 10,
          padding: "10px 14px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          border: "1px solid rgba(74,222,128,0.2)",
        }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>투자의견</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#4ade80" }}>매수</span>
        </div>
      </div>
    </div>
  );
}
