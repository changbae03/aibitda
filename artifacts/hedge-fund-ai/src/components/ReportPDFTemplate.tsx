import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { formatCurrency, isUSTicker } from "@/lib/utils";
import { AGENTS, ANALYSIS_STEPS_ORDER } from "@/lib/agents";

interface Props { analysis: any }

function verdictConfig(verdict: string | null | undefined) {
  if (!verdict) return { label: "—", accent: "#6b7280", light: "#f9fafb", dark: "#374151" };
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return { label: "높은 상승여력", accent: "#059669", light: "#ecfdf5", dark: "#065f46" };
  if (s.includes("buy"))         return { label: "상승여력",      accent: "#16a34a", light: "#f0fdf4", dark: "#14532d" };
  if (s.includes("strong sell")) return { label: "높은 하락여지", accent: "#dc2626", light: "#fef2f2", dark: "#7f1d1d" };
  if (s.includes("sell"))        return { label: "하락여지",      accent: "#ef4444", light: "#fff1f2", dark: "#7f1d1d" };
  return { label: "적정 수준", accent: "#d97706", light: "#fffbeb", dark: "#78350f" };
}

function cleanMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/#{1,6}\s+(.+)/g, "\n**$1**\n")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function SectionDivider({ color }: { color: string }) {
  return <div style={{ height: 1, background: "#e5e7eb", margin: "0 0 20px 0" }} />;
}

export default function ReportPDFTemplate({ analysis }: Props) {
  const currency = isUSTicker(analysis.ticker) ? "USD" : "KRW";
  const vc = verdictConfig(analysis.investmentVerdict);
  const dateStr = format(new Date(analysis.createdAt), "yyyy년 M월 d일 HH:mm", { locale: ko });

  const entryStr  = analysis.entryPrice  ? formatCurrency(analysis.entryPrice,  currency) : "—";
  const targetStr = analysis.targetPrice ? formatCurrency(analysis.targetPrice, currency) : "—";
  const stopStr   = analysis.stopLoss    ? formatCurrency(analysis.stopLoss,    currency) : "—";
  const upside = analysis.entryPrice && analysis.targetPrice
    ? (((analysis.targetPrice - analysis.entryPrice) / analysis.entryPrice) * 100)
    : null;

  // 올바른 데이터 접근: analysis.steps 배열
  const steps = ANALYSIS_STEPS_ORDER
    .map(key => ({
      key,
      agent: AGENTS[key],
      step: (analysis.steps ?? []).find((s: any) => s.stepKey === key),
    }))
    .filter(({ step }) => step?.content);

  return (
    <div
      id="pdf-report-root"
      style={{
        width: 794,
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        background: "#ffffff",
        color: "#111827",
        boxSizing: "border-box",
        fontSize: 13,
      }}
    >
      {/* ── 헤더 ── */}
      <div style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1a3a5c 100%)",
        padding: "32px 40px 28px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
          <div style={{ flex: 1 }}>
            {/* 브랜드 + 날짜 */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div style={{
                background: "rgba(255,255,255,0.12)", borderRadius: 5, padding: "3px 9px",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
                color: "rgba(255,255,255,0.8)", textTransform: "uppercase",
              }}>
                애빛다 · AI 기업분석 리포트
              </div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>{dateStr} 생성</div>
            </div>

            {/* 회사명 */}
            <div style={{
              fontSize: 28, fontWeight: 800, color: "#ffffff",
              letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: 6,
            }}>
              {analysis.companyName}
            </div>
            {analysis.englishName && (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>
                {analysis.englishName}
              </div>
            )}

            {/* 태그 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.75)",
                borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600,
                fontFamily: "monospace",
              }}>{analysis.ticker}</span>
              {analysis.industry && (
                <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
                  · {analysis.industry}
                </span>
              )}
            </div>
          </div>

          {/* 투자 의견 배지 */}
          <div style={{
            background: vc.light, border: `2px solid ${vc.accent}44`,
            borderRadius: 14, padding: "18px 22px", textAlign: "center",
            minWidth: 155, flexShrink: 0,
          }}>
            <div style={{ fontSize: 9, color: vc.accent, fontWeight: 700, letterSpacing: "0.06em",
              textTransform: "uppercase", marginBottom: 8 }}>
              투자 의견
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, color: vc.dark, lineHeight: 1.2 }}>
              {vc.label}
            </div>
            {upside !== null && (
              <div style={{
                fontSize: 13, color: vc.accent, marginTop: 6,
                fontFamily: "monospace", fontWeight: 700,
              }}>
                {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% 업사이드
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 핵심 지표 ── */}
      <div style={{
        display: "flex", background: "#f8fafc",
        borderBottom: "1px solid #e2e8f0", padding: "0 40px",
      }}>
        {[
          { label: "적정주가 (12M)", value: targetStr, accent: vc.accent },
          { label: "분석 당시 가격", value: entryStr, accent: "#374151" },
          { label: "업사이드",
            value: upside !== null ? `${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%` : "—",
            accent: upside !== null && upside >= 0 ? "#16a34a" : "#ef4444",
          },
          { label: "손절 기준선", value: stopStr, accent: "#ef4444" },
          { label: "리포트 날짜", value: format(new Date(analysis.createdAt), "yyyy.MM.dd"), accent: "#6b7280" },
        ].map(({ label, value, accent }, i, arr) => (
          <div key={label} style={{
            flex: 1, padding: "16px 0", textAlign: "center",
            borderRight: i < arr.length - 1 ? "1px solid #e2e8f0" : "none",
          }}>
            <div style={{ fontSize: 9, color: "#9ca3af", letterSpacing: "0.05em",
              textTransform: "uppercase", marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: accent, fontFamily: "monospace" }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* ── 분석 섹션 ── */}
      <div style={{ padding: "8px 40px 32px" }}>
        {steps.map(({ key, agent, step }, idx) => {
          const isLast = key === "investment_strategy";
          const text = cleanMarkdown(step.content ?? "");
          const paragraphs = text.split("\n\n").filter(Boolean);

          return (
            <div key={key} style={{ marginTop: 24 }}>
              {/* 구분선 */}
              {idx > 0 && <SectionDivider color="#e5e7eb" />}

              {/* 섹션 헤더 */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                  background: isLast ? vc.accent : "#eff6ff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                  color: isLast ? "#fff" : "#1d4ed8",
                }}>
                  {idx + 1}
                </div>
                <div>
                  <div style={{
                    fontSize: 14, fontWeight: 700,
                    color: isLast ? vc.dark : "#1e293b",
                  }}>
                    {agent?.name ?? key}
                  </div>
                  <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 1 }}>
                    {agent?.role}
                  </div>
                </div>
              </div>

              {/* 본문 */}
              <div style={{ paddingLeft: 36 }}>
                {paragraphs.map((para, i) => {
                  const lines = para.split("\n");
                  const isBulletBlock = lines.every(l => l.startsWith("•") || l.trim() === "");
                  if (isBulletBlock) {
                    return (
                      <div key={i} style={{ marginBottom: 10 }}>
                        {lines.filter(Boolean).map((line, j) => (
                          <div key={j} style={{
                            display: "flex", gap: 8, marginBottom: 4,
                            fontSize: 11.5, lineHeight: 1.7, color: "#374151",
                          }}>
                            <span style={{ color: vc.accent, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                              ·
                            </span>
                            <span>{line.replace(/^•\s*/, "")}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return (
                    <p key={i} style={{
                      margin: "0 0 9px 0", fontSize: 11.5, lineHeight: 1.75,
                      color: "#374151", textAlign: "justify",
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

      {/* ── 푸터 ── */}
      <div style={{
        margin: "0 40px", borderTop: "2px solid #0f172a",
        padding: "16px 0 32px",
        display: "flex", justifyContent: "space-between", alignItems: "flex-start",
      }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>애빛다 · CBST</div>
          <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>AI로 기업가치를 밝히다</div>
        </div>
        <div style={{ textAlign: "right", maxWidth: 380 }}>
          <div style={{ fontSize: 8.5, color: "#c4c4c4", lineHeight: 1.6 }}>
            본 리포트는 AI가 공개 자료를 바탕으로 자동 생성한 참고 자료이며, 투자 권유가 아닙니다.
            투자 판단의 책임은 투자자 본인에게 있으며, CBST는 본 자료로 인한 손실에 책임지지 않습니다.
          </div>
        </div>
      </div>
    </div>
  );
}
