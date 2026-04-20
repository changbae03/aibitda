import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { formatCurrency, isUSTicker } from "@/lib/utils";
import { AGENTS, ANALYSIS_STEPS_ORDER } from "@/lib/agents";

interface Props {
  analysis: any;
}

function verdictConfig(verdict: string | null | undefined) {
  if (!verdict) return { label: "—", accent: "#6b7280", light: "#f3f4f6" };
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return { label: "높은 상승여력", accent: "#059669", light: "#ecfdf5" };
  if (s.includes("buy"))         return { label: "상승여력",      accent: "#16a34a", light: "#f0fdf4" };
  if (s.includes("strong sell")) return { label: "높은 하락여지", accent: "#dc2626", light: "#fef2f2" };
  if (s.includes("sell"))        return { label: "하락여지",      accent: "#ef4444", light: "#fef2f2" };
  return { label: "적정 수준", accent: "#d97706", light: "#fffbeb" };
}

function toKoreanIndustry(industry: string | null | undefined): string {
  if (!industry) return "—";
  const map: Record<string, string> = {
    "Technology": "기술",
    "Healthcare": "헬스케어",
    "Finance": "금융",
    "Consumer Discretionary": "경기소비재",
    "Consumer Staples": "필수소비재",
    "Energy": "에너지",
    "Industrials": "산업재",
    "Materials": "소재",
    "Communication Services": "커뮤니케이션",
    "Utilities": "유틸리티",
    "Real Estate": "부동산",
    "Semiconductor": "반도체",
    "Biotechnology": "바이오테크",
    "Pharmaceuticals": "제약",
    "Aerospace & Defense": "항공·방산",
    "Communication Equipment": "통신장비",
    "Software": "소프트웨어",
    "Banks": "은행",
    "Insurance": "보험",
    "Chemicals": "화학",
    "Steel": "철강",
    "Automotive": "자동차",
    "Retail": "유통·소매",
    "Food & Beverage": "식품·음료",
    "Electric Equipment": "전기장비",
  };
  return map[industry] ?? industry;
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, (m) => m.trimStart())
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function Metric({ label, value, accent, small }: { label: string; value: string; accent?: string; small?: boolean }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontSize: 9, color: "#9ca3af", letterSpacing: "0.05em", marginBottom: 4, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: small ? 13 : 15, fontWeight: 700, color: accent ?? "#111827", fontFamily: "monospace", letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  );
}

export default function ReportPDFTemplate({ analysis }: Props) {
  const currency = isUSTicker(analysis.ticker) ? "USD" : "KRW";
  const vc = verdictConfig(analysis.investmentVerdict);
  const dateStr = format(new Date(analysis.createdAt), "yyyy년 M월 d일 HH:mm", { locale: ko });

  const entryStr = analysis.entryPrice ? formatCurrency(analysis.entryPrice, currency) : "—";
  const targetStr = analysis.targetPrice ? formatCurrency(analysis.targetPrice, currency) : "—";
  const stopStr = analysis.stopLoss ? formatCurrency(analysis.stopLoss, currency) : "—";

  const upside = analysis.entryPrice && analysis.targetPrice
    ? (((analysis.targetPrice - analysis.entryPrice) / analysis.entryPrice) * 100).toFixed(1)
    : null;

  const steps = ANALYSIS_STEPS_ORDER.filter(
    (key) => analysis.analysis?.[key]?.result
  );

  return (
    <div
      id="pdf-report-root"
      style={{
        width: 794,
        background: "#ffffff",
        fontFamily: "'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif",
        color: "#111827",
        boxSizing: "border-box",
      }}
    >
      {/* ── Header ── */}
      <div style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)", padding: "28px 36px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div style={{
                background: "rgba(255,255,255,0.15)", borderRadius: 6, padding: "3px 8px",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.8)", textTransform: "uppercase"
              }}>
                애빛다 · AI 기업분석 리포트
              </div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em" }}>{dateStr} 생성</div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#ffffff", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {analysis.companyName}
            </div>
            {analysis.englishName && (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 3 }}>{analysis.englishName}</div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={{
                background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)",
                borderRadius: 4, padding: "2px 7px", fontSize: 10, fontWeight: 600, fontFamily: "monospace"
              }}>{analysis.ticker}</span>
              <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 10 }}>·</span>
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 10 }}>{toKoreanIndustry(analysis.industry)}</span>
            </div>
          </div>

          {/* Verdict badge */}
          <div style={{
            background: vc.light, border: `2px solid ${vc.accent}33`,
            borderRadius: 12, padding: "14px 20px", textAlign: "right", minWidth: 160
          }}>
            <div style={{ fontSize: 10, color: vc.accent, fontWeight: 600, letterSpacing: "0.04em", marginBottom: 6, textTransform: "uppercase" }}>
              투자 의견
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: vc.accent }}>{vc.label}</div>
            {upside && (
              <div style={{ fontSize: 12, color: vc.accent, marginTop: 4, fontFamily: "monospace", fontWeight: 600 }}>
                {Number(upside) >= 0 ? "+" : ""}{upside}% 업사이드
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Key Metrics Bar ── */}
      <div style={{
        display: "flex", background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0", padding: "16px 36px"
      }}>
        <Metric label="적정주가 (12M)" value={targetStr} accent={vc.accent} />
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 16px" }} />
        <Metric label="분석 당시 가격" value={entryStr} />
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 16px" }} />
        <Metric label="업사이드" value={upside ? `${Number(upside) >= 0 ? "+" : ""}${upside}%` : "—"} accent={vc.accent} />
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 16px" }} />
        <Metric label="손절 기준선" value={stopStr} accent="#ef4444" />
        <div style={{ width: 1, background: "#e2e8f0", margin: "0 16px" }} />
        <Metric label="리포트 날짜" value={format(new Date(analysis.createdAt), "yyyy.MM.dd")} small />
      </div>

      {/* ── Analysis Sections ── */}
      <div style={{ padding: "0 36px 36px" }}>
        {steps.map((key, idx) => {
          const agent = AGENTS[key];
          const step = analysis.analysis[key];
          const raw = step?.result ?? "";
          const text = cleanMarkdown(raw);
          if (!text) return null;

          const isLast = key === "investment_strategy";

          return (
            <div key={key} style={{
              marginTop: 24,
              paddingTop: 24,
              borderTop: idx === 0 ? "none" : "1px solid #f1f5f9",
            }}>
              {/* Section header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6,
                  background: isLast ? vc.accent : "#eff6ff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700,
                  color: isLast ? "#fff" : "#1d4ed8",
                }}>
                  {idx + 1}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isLast ? vc.accent : "#1e293b" }}>
                    {agent?.name ?? key}
                  </div>
                  <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>{agent?.role}</div>
                </div>
              </div>

              {/* Section body */}
              <div style={{ paddingLeft: 32 }}>
                {text.split("\n\n").map((para, i) => {
                  const isBulletBlock = para.startsWith("•");
                  if (isBulletBlock) {
                    const lines = para.split("\n").filter(Boolean);
                    return (
                      <ul key={i} style={{ margin: "0 0 10px 0", padding: 0, listStyle: "none" }}>
                        {lines.map((line, j) => (
                          <li key={j} style={{
                            display: "flex", gap: 8, marginBottom: 4,
                            fontSize: 11, lineHeight: 1.65, color: "#374151"
                          }}>
                            <span style={{ color: vc.accent, fontWeight: 700, flexShrink: 0 }}>•</span>
                            <span>{line.replace(/^•\s*/, "")}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  return (
                    <p key={i} style={{
                      margin: "0 0 10px 0", fontSize: 11, lineHeight: 1.7,
                      color: "#374151", textAlign: "justify"
                    }}>
                      {para}
                    </p>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div style={{
        borderTop: "2px solid #0f172a", margin: "0 36px",
        padding: "16px 0 28px", display: "flex", justifyContent: "space-between", alignItems: "center"
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>애빛다 · CBST</div>
          <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 3 }}>AI로 기업가치를 밝히다</div>
        </div>
        <div style={{ textAlign: "right", maxWidth: 400 }}>
          <div style={{ fontSize: 8, color: "#d1d5db", lineHeight: 1.5 }}>
            본 리포트는 AI가 공개 자료를 바탕으로 자동 생성한 참고 자료이며, 투자 권유가 아닙니다.
            투자 판단의 책임은 투자자 본인에게 있습니다. CBST는 본 자료로 인한 손실에 책임지지 않습니다.
          </div>
        </div>
      </div>
    </div>
  );
}
