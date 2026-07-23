import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/hooks/useApi";

// ── 상수: 웹 agents.ts와 완전히 동일 ─────────────────────────────────────────

const STEP_ORDER = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "relative_valuation",
  "market_analysis",
  "investment_strategy",
] as const;

const AGENTS: Record<string, { name: string; role: string; color: string }> = {
  company_intro:       { name: "브리핑",             role: "Lead Portfolio Strategist",      color: "#2563eb" },
  industry_analysis:   { name: "매크로 및 산업 분석", role: "Macro & Industry Analyst",       color: "#2563eb" },
  catalyst_analysis:   { name: "투자 촉매 및 수급 분석", role: "Catalyst & Smart Money Analyst", color: "#d97706" },
  company_analysis:    { name: "실적 전망",           role: "Financial Analyst",              color: "#2563eb" },
  relative_valuation:  { name: "적정주가 산출",       role: "Valuation Analyst",              color: "#2563eb" },
  market_analysis:     { name: "기술적 분석",         role: "Market & Technical Analyst",    color: "#2563eb" },
  investment_strategy: { name: "최종 결론",           role: "Lead Portfolio Strategist",      color: "#2563eb" },
};

// ── helpers ───────────────────────────────────────────────────────────────────

function isUSTicker(ticker: string): boolean {
  return !/^\d{6}$/.test(ticker.replace(/\.KS|\.KQ/g, ""));
}

function fmtPrice(val: string | number | null | undefined, currency: "KRW" | "USD" = "KRW"): string {
  if (val == null || val === "") return "N/A";
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return String(val);
  if (currency === "USD") return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return n.toLocaleString("ko-KR") + "원";
}

function fmtMC(v: number | null | undefined, currency = "KRW"): string {
  if (v == null) return "—";
  if (currency === "USD") {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
    return `$${(v / 1e6).toFixed(0)}M`;
  }
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (v >= 1e8)  return `${(v / 1e8).toFixed(0)}억`;
  return `${(v / 1e6).toFixed(0)}M`;
}

function fmtVol(v: number | null | undefined, currency = "KRW"): string {
  if (v == null) return "—";
  if (currency === "USD") {
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
    return `${Math.round(v / 1000)}K`;
  }
  return v.toLocaleString("ko-KR");
}

/** JSON 블록을 제거하고 이후 텍스트만 반환 */
function stripJsonBlock(text: string): string {
  if (!text) return "";
  // ```json ... ``` 또는 ``` ... ``` 제거
  let s = text.replace(/```json[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, "").trim();
  // 앞부분 JSON 오브젝트 제거 (200자 안에 { 로 시작하면)
  const si = s.indexOf("{");
  if (si !== -1 && si < 200) {
    let depth = 0; let inString = false; let escaped = false;
    for (let i = si; i < s.length; i++) {
      const ch = s[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\" && inString) { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { s = s.slice(i + 1).trim(); break; } }
    }
  }
  return s;
}

function extractJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim()
    .replace(/FINAL_VALUATION_DATA:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/g, "")
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const startIdx = s.indexOf("{");
  if (startIdx === -1) return null;
  let depth = 0; let endIdx = -1; let inString = false; let escaped = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) return null;
  s = s.slice(startIdx, endIdx + 1);
  try { return JSON.parse(s); } catch { /**/ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, "$1")); } catch { /**/ }
  return null;
}

// ── 공통 UI ──────────────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  const colors = useColors();
  return <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{text}</Text>;
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

function VerdictBadge({ verdict }: { verdict?: string | null }) {
  if (!verdict) return null;
  const map: Record<string, { color: string; bg: string; label: string }> = {
    "STRONG_BUY":  { color: "#16a34a", bg: "#dcfce7", label: "강력매수" },
    "Strong Buy":  { color: "#16a34a", bg: "#dcfce7", label: "강력매수" },
    "BUY":         { color: "#22c55e", bg: "#f0fdf4", label: "매수" },
    "Buy":         { color: "#22c55e", bg: "#f0fdf4", label: "매수" },
    "HOLD":        { color: "#d97706", bg: "#fef9c3", label: "보유" },
    "Hold":        { color: "#d97706", bg: "#fef9c3", label: "보유" },
    "SELL":        { color: "#dc2626", bg: "#fee2e2", label: "매도" },
    "Sell":        { color: "#dc2626", bg: "#fee2e2", label: "매도" },
    "STRONG_SELL": { color: "#b91c1c", bg: "#fee2e2", label: "강력매도" },
    "Strong Sell": { color: "#b91c1c", bg: "#fee2e2", label: "강력매도" },
  };
  const c = map[verdict] ?? map[verdict.toUpperCase()] ?? { color: "#6b7280", bg: "#f3f4f6", label: verdict };
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
      <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: c.color }}>{c.label}</Text>
    </View>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const isComplete = status === "completed";
  const isRunning  = status === "in_progress";
  const isQueued   = status === "queued";
  const color = isComplete ? "#16a34a" : isRunning ? "#d97706" : isQueued ? "#2563eb" : "#dc2626";
  const bg    = isComplete ? "#dcfce7" : isRunning ? "#fef9c3" : isQueued ? "#dbeafe" : "#fee2e2";
  const label = isComplete ? "분석 완료" : isRunning ? "분석 중" : isQueued ? "대기 중" : "오류";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 }}>
      {isRunning && <ActivityIndicator size="small" color={color} style={{ width: 12, height: 12 }} />}
      <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color }}>{label}</Text>
    </View>
  );
}

// ── TickerStats hook ──────────────────────────────────────────────────────────

interface TickerStats {
  per: number | null; pbr: number | null;
  week52High: number | null; week52Low: number | null;
  volume: number | null; marketCap: number | null; currency: string;
}

function useTickerStats(ticker: string | null) {
  const [data, setData] = useState<TickerStats | null>(null);
  useEffect(() => {
    if (!ticker) return;
    apiFetch<any>(`/api/market-data/ticker-stats/${encodeURIComponent(ticker)}`)
      .then((d) => setData({ per: d.per ?? null, pbr: d.pbr ?? null, week52High: d.week52High ?? null, week52Low: d.week52Low ?? null, volume: d.volume ?? null, marketCap: d.marketCap ?? null, currency: d.currency ?? "KRW" }))
      .catch(() => {});
  }, [ticker]);
  return data;
}

// ── NavBar ────────────────────────────────────────────────────────────────────

function NavBar({ status, onBack }: { status: string; onBack: () => void }) {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const topPad   = Platform.OS === "web" ? 0 : insets.top;
  return (
    <View style={[styles.navBar, { paddingTop: topPad + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
      <Pressable style={styles.navBack} onPress={onBack}>
        <Feather name="arrow-left" size={18} color={colors.foreground} />
        <Text style={[styles.navBackText, { color: colors.foreground }]}>목록으로</Text>
      </Pressable>
      <StatusBadge status={status} />
    </View>
  );
}

// ── HeaderCard ────────────────────────────────────────────────────────────────

function HeaderCard({
  analysis, quote, stats,
}: {
  analysis: any;
  quote: { price: number | null; change: number | null; currency: string } | null;
  stats: TickerStats | null;
}) {
  const colors   = useColors();
  const isUS     = isUSTicker(analysis.ticker);
  const currency: "KRW" | "USD" = isUS ? "USD" : "KRW";
  const statCurrency = stats?.currency ?? (isUS ? "USD" : "KRW");

  const metrics = [
    { label: "시가총액",  value: fmtMC(stats?.marketCap, statCurrency) },
    { label: "PER",      value: stats?.per != null ? `${stats.per.toFixed(1)}x` : "—" },
    { label: "PBR",      value: stats?.pbr != null ? `${stats.pbr.toFixed(2)}x` : "—" },
    { label: "52주 고",  value: stats?.week52High != null ? fmtPrice(stats.week52High, currency) : "—" },
    { label: "52주 저",  value: stats?.week52Low  != null ? fmtPrice(stats.week52Low,  currency) : "—" },
    { label: "거래량",   value: fmtVol(stats?.volume, statCurrency) },
  ];

  return (
    <Card style={styles.headerCard}>
      {/* Company + verdict */}
      <View style={styles.headerTop}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.companyName, { color: colors.foreground }]}>
            {analysis.companyName ?? analysis.englishName ?? analysis.ticker}
          </Text>
          {analysis.industry && (
            <Text style={[styles.companyIndustry, { color: colors.mutedForeground }]}>
              {analysis.ticker}  ·  {analysis.industry}
            </Text>
          )}
        </View>
        <VerdictBadge verdict={analysis.investmentVerdict} />
      </View>

      {/* Live price */}
      {quote?.price != null && (
        <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.livePrice, { color: colors.foreground }]}>
            {fmtPrice(quote.price, currency)}
          </Text>
          {quote.change != null && (
            <Text style={[styles.liveChange, { color: quote.change >= 0 ? "#16a34a" : "#dc2626" }]}>
              {quote.change >= 0 ? "▲" : "▼"} {Math.abs(quote.change).toFixed(2)}%
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <View style={[styles.liveDot, { backgroundColor: "#22c55e" }]} />
        </View>
      )}

      {/* Target price highlight */}
      {analysis.targetPrice != null && (
        <View style={[styles.targetRow, { borderTopColor: colors.border, backgroundColor: colors.accent }]}>
          <Text style={[styles.targetLabel, { color: colors.mutedForeground }]}>적정주가 (12개월)</Text>
          <View style={{ alignItems: "flex-end", gap: 2 }}>
            <Text style={[styles.targetPrice, { color: "#16a34a" }]}>
              {fmtPrice(analysis.targetPrice, currency)}
            </Text>
            {quote?.price != null && quote.price > 0 && (
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#16a34a" }}>
                +{(((analysis.targetPrice - quote.price) / quote.price) * 100).toFixed(1)}% 상승여지
              </Text>
            )}
          </View>
        </View>
      )}

      {/* Metrics grid */}
      {stats && (
        <View style={[styles.metricsGrid, { borderTopColor: colors.border }]}>
          {metrics.map((m, i) => (
            <View
              key={m.label}
              style={[
                styles.metricItem,
                i % 3 !== 2 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
                i < 3 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
              <Text style={[styles.metricValue, { color: colors.foreground }]}>{m.value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Tags row */}
      <View style={styles.tagsRow}>
        <View style={[styles.tag, { backgroundColor: colors.muted }]}>
          <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{analysis.ticker}</Text>
        </View>
        {analysis.industry && (
          <View style={[styles.tag, { backgroundColor: colors.muted }]}>
            <Text style={[styles.tagText, { color: colors.mutedForeground }]}>{analysis.industry}</Text>
          </View>
        )}
        <View style={[styles.tag, { backgroundColor: "#ede9fe" }]}>
          <Text style={[styles.tagText, { color: "#6d28d9" }]}>AI자동생성 · 참고용</Text>
        </View>
      </View>
    </Card>
  );
}

// ── TldrCard ──────────────────────────────────────────────────────────────────

function TldrCard({ analysis }: { analysis: any }) {
  const colors  = useColors();
  const stratStep = analysis.steps?.find((s: any) => s.stepKey === "investment_strategy");
  const json    = stratStep ? extractJson(stratStep.content) : null;
  if (!json) return null;

  const verdictMap: Record<string, string> = {
    BUY: "매수", STRONG_BUY: "강력매수", SELL: "매도", STRONG_SELL: "강력매도",
    HOLD: "보유", WATCH: "관찰",
  };
  const verdictStr = json.verdict
    ? (verdictMap[String(json.verdict).toUpperCase().replace(" ", "_")] ?? json.verdict)
    : null;

  const hasContent = json.plain_verdict || json.key_issue || json.summary;
  if (!hasContent && !verdictStr) return null;

  return (
    <View style={styles.section}>
      <SectionLabel text="투자 요약 · 한눈에 보기" />
      <Card>
        {verdictStr && (
          <View style={[styles.tldrRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.tldrSubLabel, { color: colors.mutedForeground }]}>AI 판단</Text>
            <Text style={[styles.tldrVerdictVal, { color: "#2563eb" }]}>{verdictStr}</Text>
          </View>
        )}
        {json.plain_verdict && (
          <View style={[styles.tldrRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.tldrSubLabel, { color: colors.mutedForeground }]}>쉽게 말하면</Text>
            <Text style={[styles.tldrText, { color: colors.foreground }]}>{json.plain_verdict}</Text>
          </View>
        )}
        {json.key_issue && (
          <View style={[styles.tldrRow, { borderBottomColor: colors.border, backgroundColor: "#fef9c3" }]}>
            <Text style={[styles.tldrSubLabel, { color: "#d97706" }]}>핵심 이슈</Text>
            <Text style={[styles.tldrText, { color: "#92400e" }]}>{json.key_issue}</Text>
          </View>
        )}
        {json.summary && (
          <View style={[styles.tldrRow, { backgroundColor: colors.accent }]}>
            <Text style={[styles.tldrSubLabel, { color: colors.mutedForeground }]}>투자 논거</Text>
            <Text style={[styles.tldrText, { color: colors.mutedForeground, fontSize: 13 }]}>{json.summary}</Text>
          </View>
        )}
      </Card>
    </View>
  );
}

// ── ScenarioCard ──────────────────────────────────────────────────────────────

function ScenarioCard({ analysis }: { analysis: any }) {
  const colors  = useColors();
  const stratStep = analysis.steps?.find((s: any) => s.stepKey === "investment_strategy");
  const json    = stratStep ? extractJson(stratStep.content) : null;
  if (!json?.scenarios?.length) return null;

  const isUS    = isUSTicker(analysis.ticker);
  const currency: "KRW" | "USD" = isUS ? "USD" : "KRW";

  const caseConfig = {
    Bull: { label: "▲ Bull", sub: "낙관 전망", accent: "#16a34a", bar: "#22c55e", border: "#22c55e" },
    Base: { label: "— Base", sub: "기본 전망", accent: "#2563eb", bar: "#3b82f6", border: "#3b82f6" },
    Bear: { label: "▼ Bear", sub: "비관 전망", accent: "#dc2626", bar: "#f87171", border: "#f87171" },
  } as const;

  const ordered = (["Bull", "Base", "Bear"] as const)
    .map((c) => json.scenarios.find((s: any) => s.case === c))
    .filter(Boolean);
  if (ordered.length < 2) return null;

  return (
    <View style={styles.section}>
      <SectionLabel text="시나리오 분석 — 낙관 · 기본 · 비관" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {ordered.map((s: any, idx: number) => {
          const cfg = caseConfig[s.case as keyof typeof caseConfig];
          if (!cfg) return null;
          const uNum = parseFloat(String(s.upside ?? "").replace(/[^0-9.\-]/g, ""));
          const pNum = parseFloat(String(s.probability ?? "").replace(/[^0-9.]/g, ""));
          const pct  = isNaN(pNum) ? 0 : Math.min(pNum, 100);
          return (
            <View
              key={s.case}
              style={[
                styles.scenarioRow,
                { borderBottomColor: colors.border, borderLeftColor: cfg.border },
                idx === ordered.length - 1 && { borderBottomWidth: 0 },
              ]}
            >
              <View style={styles.scenarioLabel}>
                <Text style={[styles.scenarioCaseText, { color: cfg.accent }]}>{cfg.label}</Text>
                <Text style={[styles.scenarioSub, { color: colors.mutedForeground }]}>{cfg.sub}</Text>
              </View>
              <View style={styles.scenarioMid}>
                <Text style={[styles.scenarioPriceText, { color: colors.foreground }]}>
                  {fmtPrice(s.target_price, currency)}
                </Text>
                {!isNaN(uNum) && (
                  <Text style={[styles.scenarioUpside, { color: uNum >= 0 ? "#16a34a" : "#dc2626" }]}>
                    {uNum >= 0 ? "+" : ""}{uNum.toFixed(1)}%
                  </Text>
                )}
              </View>
              <View style={styles.scenarioProb}>
                <View style={styles.scenarioProbHeader}>
                  <Text style={[styles.scenarioProbLabel, { color: colors.mutedForeground }]}>확률</Text>
                  <Text style={[styles.scenarioProbValue, { color: colors.foreground }]}>
                    {!isNaN(pNum) ? pNum + "%" : String(s.probability ?? "")}
                  </Text>
                </View>
                <View style={[styles.probTrack, { backgroundColor: colors.border }]}>
                  <View style={[styles.probFill, { width: `${pct}%` as any, backgroundColor: cfg.bar }]} />
                </View>
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

// ── PeerMultiplesPanel ────────────────────────────────────────────────────────

interface PeerMultiples {
  name: string; marketCap: number | null; pbr: number | null;
  per_trailing: number | null; ev_ebitda: number | null; roe: number | null;
}

function PeerMultiplesPanel({ ticker }: { ticker: string }) {
  const colors = useColors();
  const [data, setData] = useState<{ subject: string; peers: Record<string, PeerMultiples>; averages?: Partial<PeerMultiples> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    apiFetch<any>(`/api/peers/latest?subject=${encodeURIComponent(ticker)}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!loading && !data) return null;
  const rows = data ? Object.entries(data.peers) : [];

  return (
    <View style={styles.section}>
      <SectionLabel text="피어 멀티플" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <TouchableOpacity
          onPress={() => setExpanded((e) => !e)}
          style={[styles.panelHeader, { borderBottomColor: colors.border, borderBottomWidth: expanded ? StyleSheet.hairlineWidth : 0 }]}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="bar-chart-2" size={15} color="#3b82f6" />
            <Text style={[styles.panelTitle, { color: colors.foreground }]}>피어 비교</Text>
            {loading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
            {!loading && data && (
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{rows.length}개 피어</Text>
              </View>
            )}
          </View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

        {expanded && !loading && data && (
          <View style={{ padding: 14, gap: 12 }}>
            {data.averages && (
              <View style={[styles.avgRow, { backgroundColor: colors.accent }]}>
                <Text style={[styles.avgTitle, { color: colors.mutedForeground }]}>섹터 평균</Text>
                <View style={{ flexDirection: "row", gap: 0 }}>
                  {([["PER", data.averages.per_trailing, 1, "x"], ["PBR", data.averages.pbr, 2, "x"], ["EV/EBITDA", data.averages.ev_ebitda, 1, "x"], ["ROE", data.averages.roe, 1, "%"]] as [string, number | null | undefined, number, string][]).map(([label, val, dec, suf]) => (
                    <View key={label} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                      <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{label}</Text>
                      <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: colors.foreground }}>
                        {val != null ? `${val.toFixed(dec)}${suf}` : "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {rows.map(([peerTicker, peer], idx) => (
              <View key={peerTicker} style={[styles.peerRow, { borderBottomColor: colors.border, borderBottomWidth: idx < rows.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.peerName, { color: colors.foreground }]} numberOfLines={1}>{peer.name || peerTicker}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{peerTicker}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 0 }}>
                  {([["PER", peer.per_trailing, 1, "x"], ["PBR", peer.pbr, 2, "x"], ["ROE", peer.roe, 1, "%"]] as [string, number | null, number, string][]).map(([label, val, dec, suf]) => (
                    <View key={label} style={{ width: 52, alignItems: "center", gap: 2 }}>
                      <Text style={{ fontSize: 9, color: colors.mutedForeground }}>{label}</Text>
                      <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>
                        {val != null ? `${val.toFixed(dec)}${suf}` : "—"}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}
        {expanded && loading && (
          <View style={{ padding: 24, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}
      </Card>
    </View>
  );
}

// ── AnalystConsensusPanel ─────────────────────────────────────────────────────

interface AnalystConsensus {
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; total: number;
  recommendationKey: string | null; currency: string;
  targetLowPrice: number | null; targetMeanPrice: number | null; targetHighPrice: number | null;
  firmTargets: { firm: string; target: number; grade: string; date: string }[];
}

function AnalystConsensusPanel({ ticker, currentPrice }: { ticker: string; currentPrice?: number | null }) {
  const colors  = useColors();
  const [info, setInfo] = useState<AnalystConsensus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    apiFetch<AnalystConsensus>(`/api/market-data/analyst-consensus?ticker=${encodeURIComponent(ticker)}`)
      .then((d) => { setInfo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!loading && !info) return null;

  const buyCount   = (info?.strongBuy ?? 0) + (info?.buy ?? 0);
  const holdCount  = info?.hold ?? 0;
  const sellCount  = (info?.sell ?? 0) + (info?.strongSell ?? 0);
  const total      = info?.total || 1;
  const buyPct     = Math.round((buyCount / total) * 100);
  const holdPct    = Math.round((holdCount / total) * 100);
  const sellPct    = 100 - buyPct - holdPct;

  const keyLabel: Record<string, { label: string; color: string }> = {
    strong_buy:  { label: "강력매수", color: "#16a34a" },
    buy:         { label: "매수",     color: "#22c55e" },
    hold:        { label: "중립",     color: "#f59e0b" },
    sell:        { label: "매도",     color: "#f87171" },
    strong_sell: { label: "강력매도", color: "#dc2626" },
  };
  const consensus = keyLabel[info?.recommendationKey ?? ""] ?? { label: "", color: colors.mutedForeground };
  const currency  = info?.currency === "USD" ? "USD" : "KRW";
  const mean      = info?.targetMeanPrice;
  const upside    = mean && currentPrice && currentPrice > 0 ? ((mean - currentPrice) / currentPrice) * 100 : null;

  return (
    <View style={styles.section}>
      <SectionLabel text="애널리스트 컨센서스" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <TouchableOpacity
          onPress={() => setExpanded((e) => !e)}
          style={[styles.panelHeader, { borderBottomColor: colors.border, borderBottomWidth: expanded ? StyleSheet.hairlineWidth : 0 }]}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Feather name="users" size={15} color="#8b5cf6" />
            <Text style={[styles.panelTitle, { color: colors.foreground }]}>애널리스트</Text>
            {loading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
            {!loading && info && (
              <View style={[styles.countBadge, { backgroundColor: "#ede9fe" }]}>
                <Text style={[styles.countBadgeText, { color: "#6d28d9" }]}>{info.total}명</Text>
              </View>
            )}
            {!loading && consensus.label && (
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: consensus.color }}>{consensus.label}</Text>
            )}
          </View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

        {expanded && !loading && info && (
          <View style={{ padding: 14, gap: 14 }}>
            <View style={[styles.avgRow, { backgroundColor: colors.accent, flexDirection: "row", gap: 0 }]}>
              {([["하단", info.targetLowPrice, "#dc2626"], ["평균", info.targetMeanPrice, colors.foreground], ["상단", info.targetHighPrice, "#16a34a"]] as [string, number | null, string][]).map(([label, val, color]) => (
                <View key={label} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{label}</Text>
                  <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color }}>{val != null ? fmtPrice(val, currency as any) : "—"}</Text>
                  {label === "평균" && upside != null && (
                    <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: upside >= 0 ? "#16a34a" : "#dc2626" }}>
                      {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                    </Text>
                  )}
                </View>
              ))}
            </View>
            {info.total > 0 && (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: "#f1f5f9" }}>
                  {buyPct > 0  && <View style={{ width: `${buyPct}%`  as any, backgroundColor: "#22c55e" }} />}
                  {holdPct > 0 && <View style={{ width: `${holdPct}%` as any, backgroundColor: "#f59e0b" }} />}
                  {sellPct > 0 && <View style={{ width: `${sellPct}%` as any, backgroundColor: "#f87171" }} />}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#16a34a" }}>매수 {buyCount}명 ({buyPct}%)</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#d97706" }}>중립 {holdCount}명 ({holdPct}%)</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#dc2626" }}>매도 {sellCount}명 ({sellPct}%)</Text>
                </View>
              </View>
            )}
            {(info.firmTargets ?? []).slice(0, 8).map((f, i, arr) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                <Text style={{ flex: 1, fontSize: 13, color: colors.foreground }} numberOfLines={1}>{f.firm}</Text>
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{fmtPrice(f.target, currency as any)}</Text>
                  {f.grade && <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{f.grade}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}
        {expanded && loading && <View style={{ padding: 24, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>}
      </Card>
    </View>
  );
}

// ── RunningProgressCard ───────────────────────────────────────────────────────

const STEP_LABELS_KO: Record<string, string> = Object.fromEntries(
  Object.entries(AGENTS).map(([k, v]) => [k, v.name])
);

function RunningProgressCard({ analysis }: { analysis: any }) {
  const colors  = useColors();
  const steps   = analysis.steps ?? [];
  const completedKeys = steps.filter((s: any) => s.status === "completed" || s.content).map((s: any) => s.stepKey);
  const currentStep   = steps.find((s: any) => s.status === "in_progress")?.stepKey ?? null;
  const doneCount = completedKeys.length;
  const total     = STEP_ORDER.length;
  const pct       = total > 0 ? (doneCount / total) * 100 : 0;

  return (
    <Card style={{ margin: 16, marginBottom: 0 }}>
      <Text style={[styles.companyName, { color: colors.foreground, marginBottom: 4 }]}>
        {analysis.companyName ?? analysis.ticker}
      </Text>
      <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
        <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: "#FF8A7A" }]} />
      </View>
      <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
        {doneCount}/{total} 단계 완료
      </Text>
      {currentStep && (
        <View style={[styles.currentStep, { backgroundColor: "#FFF0EE", borderColor: "#FFCFC9" }]}>
          <ActivityIndicator size="small" color="#FF8A7A" />
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#FF8A7A" }}>
            {STEP_LABELS_KO[currentStep] ?? currentStep}
          </Text>
        </View>
      )}
      <View style={{ gap: 8, marginTop: 12 }}>
        {STEP_ORDER.map((key, i) => {
          const done   = completedKeys.includes(key);
          const active = currentStep === key;
          const color  = done ? "#16a34a" : active ? "#FF8A7A" : colors.border;
          return (
            <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: done ? "#dcfce7" : active ? "#FFF0EE" : colors.muted, alignItems: "center", justifyContent: "center" }}>
                {done ? (
                  <Feather name="check" size={12} color="#16a34a" />
                ) : active ? (
                  <ActivityIndicator size="small" color="#FF8A7A" style={{ width: 12, height: 12 }} />
                ) : (
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: colors.mutedForeground }}>{i + 1}</Text>
                )}
              </View>
              <Text style={{ fontSize: 13, fontFamily: done ? "Pretendard-SemiBold" : "Pretendard-Regular", color }}>
                {AGENTS[key]?.name ?? key}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

// ── AgentStepsSection ─────────────────────────────────────────────────────────

function AgentStepsSection({ analysis }: { analysis: any }) {
  const colors  = useColors();
  const stepsMap: Record<string, any> = {};
  for (const s of (analysis.steps ?? [])) stepsMap[s.stepKey] = s;
  const hasAny = STEP_ORDER.some((k) => !!stepsMap[k]?.content);
  if (!hasAny) return null;

  return (
    <View style={styles.section}>
      <SectionLabel text="AI 에이전트 분석 — 7단계" />
      <View style={{ gap: 12 }}>
        {STEP_ORDER.map((key, index) => {
          const step  = stepsMap[key];
          if (!step?.content) return null;
          const agent = AGENTS[key];
          const displayContent = stripJsonBlock(step.content);
          const accentColor    = agent?.color ?? "#2563eb";

          return (
            <Card key={key}>
              {/* Step header */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: accentColor + "18", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Bold", color: accentColor }}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: accentColor }}>
                    {agent?.name ?? key}
                  </Text>
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>
                    {step.agentName ?? agent?.role ?? ""}
                  </Text>
                </View>
                {step.informationType && (
                  <View style={{ backgroundColor: accentColor + "18", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: accentColor }}>
                      {step.informationType === "confirmed_fact" ? "확인된 사실"
                       : step.informationType === "data_based_estimate" ? "데이터 추정"
                       : step.informationType === "hypothesis" ? "가설"
                       : step.informationType}
                    </Text>
                  </View>
                )}
              </View>

              {/* Content */}
              <Text style={[styles.stepContent, { color: colors.foreground }]}>
                {displayContent || step.content}
              </Text>

              {/* Validation notes */}
              {step.validationNotes && (
                <View style={[styles.validationBox, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                  <Text style={[styles.validationLabel, { color: colors.mutedForeground }]}>검증 노트</Text>
                  <Text style={{ fontSize: 12, lineHeight: 18, color: colors.mutedForeground }}>{step.validationNotes}</Text>
                </View>
              )}
            </Card>
          );
        })}
      </View>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AnalysisDetailScreen() {
  const { id }    = useLocalSearchParams<{ id: string }>();
  const colors    = useColors();
  const insets    = useSafeAreaInsets();
  const router    = useRouter();

  const [analysis, setAnalysis] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [quote, setQuote] = useState<{ price: number | null; change: number | null; currency: string } | null>(null);
  const stats = useTickerStats(analysis?.ticker ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAnalysis = React.useCallback(() => {
    if (!id) return;
    apiFetch<any>(`/api/analysis/${id}`)
      .then((data) => { setAnalysis(data); setIsLoading(false); setFetchError(false); })
      .catch(() => { setFetchError(true); setIsLoading(false); });
  }, [id]);

  useEffect(() => { loadAnalysis(); }, [loadAnalysis]);

  // 실시간 현재가 fetch
  useEffect(() => {
    if (!analysis?.ticker) return;
    apiFetch<Record<string, any>>("/api/market-data/batch-quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [analysis.ticker] }),
    })
      .then((res) => { const q = res[analysis.ticker]; if (q) setQuote(q); })
      .catch(() => {});
  }, [analysis?.ticker]);

  // 분석 진행 중일 때 폴링
  useEffect(() => {
    const status = analysis?.status;
    if (status === "in_progress" || status === "queued") {
      pollRef.current = setInterval(() => loadAnalysis(), 4000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [analysis?.status]);

  const botPad = Platform.OS === "web" ? 34 : insets.bottom + 24;
  const analysisStatus = (analysis as any)?.status ?? "unknown";
  const isComplete = analysisStatus === "completed";
  const currentPrice = quote?.price ?? (analysis as any)?.startPrice ?? null;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <NavBar status="queued" onBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color="#FF8A7A" size="large" />
          <Text style={{ color: colors.mutedForeground, fontSize: 13, marginTop: 10, fontFamily: "Pretendard-Regular" }}>
            분석 보고서 로딩 중…
          </Text>
        </View>
      </View>
    );
  }

  if (fetchError || (!isLoading && !analysis)) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <NavBar status="error" onBack={() => router.back()} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: 12 }}>
          <Feather name="alert-circle" size={36} color={colors.destructive} />
          <Text style={{ color: colors.mutedForeground, fontSize: 15, fontFamily: "Pretendard-Regular" }}>
            분석을 불러오지 못했어요
          </Text>
          <Pressable onPress={loadAnalysis} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#FF8A7A", borderRadius: 8 }}>
            <Text style={{ color: "#fff", fontSize: 14, fontFamily: "Pretendard-SemiBold" }}>다시 시도</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <NavBar status={analysisStatus} onBack={() => router.back()} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: botPad }}
        showsVerticalScrollIndicator={false}
      >
        {/* 분석 진행 중: 진행 상황 카드 먼저 표시 */}
        {!isComplete && <RunningProgressCard analysis={analysis} />}

        {/* 헤더 (완료 여부 관계없이 표시) */}
        <HeaderCard analysis={analysis} quote={quote} stats={stats} />

        {/* 완료 시: 요약 · 시나리오 · 피어 · 컨센서스 · 스텝 콘텐츠 */}
        {isComplete && (
          <>
            <TldrCard analysis={analysis} />
            <ScenarioCard analysis={analysis} />
            <PeerMultiplesPanel ticker={analysis.ticker} />
            <AnalystConsensusPanel ticker={analysis.ticker} currentPrice={currentPrice} />
            <AgentStepsSection analysis={analysis} />
          </>
        )}

        {/* 진행 중에도 완료된 단계는 미리 보여줌 */}
        {!isComplete && <AgentStepsSection analysis={analysis} />}

        {/* Disclaimer */}
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
          본 보고서는 공개된 데이터를 기반으로 AI가 자동 생성한 참고용 자료입니다.{"\n"}
          투자 권유가 아니며, 최종 투자 결정과 그 결과는 투자자 본인에게 있습니다.
        </Text>
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* nav */
  navBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navBack:     { flexDirection: "row", alignItems: "center", gap: 6 },
  navBackText: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  /* card */
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  section: { marginTop: 16, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 10, fontFamily: "Pretendard-Bold",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8,
  },

  /* header */
  headerCard:      { margin: 16, marginBottom: 0 },
  headerTop:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  companyName:     { fontSize: 22, fontFamily: "Pretendard-Bold" },
  companyIndustry: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 2 },
  priceRow:        { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  livePrice:       { fontSize: 26, fontFamily: "Pretendard-Bold" },
  liveChange:      { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  liveDot:         { width: 8, height: 8, borderRadius: 4 },

  targetRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  targetLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  targetPrice: { fontSize: 20, fontFamily: "Pretendard-Bold" },

  metricsGrid:  { flexDirection: "row", flexWrap: "wrap", borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  metricItem:   { width: "33.33%", paddingVertical: 10, paddingHorizontal: 4, alignItems: "center", gap: 3 },
  metricLabel:  { fontSize: 10, fontFamily: "Pretendard-Regular" },
  metricValue:  { fontSize: 13, fontFamily: "Pretendard-SemiBold" },

  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  tag:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontFamily: "Pretendard-Regular" },

  /* tldr */
  tldrRow:       { paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth, gap: 5, marginHorizontal: -2 },
  tldrSubLabel:  { fontSize: 10, fontFamily: "Pretendard-Bold", textTransform: "uppercase", letterSpacing: 0.6 },
  tldrVerdictVal:{ fontSize: 14, fontFamily: "Pretendard-Bold" },
  tldrText:      { fontSize: 14, lineHeight: 22, fontFamily: "Pretendard-Regular" },

  /* scenario */
  scenarioRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, gap: 10 },
  scenarioLabel:     { width: 68 },
  scenarioCaseText:  { fontSize: 12, fontFamily: "Pretendard-Bold" },
  scenarioSub:       { fontSize: 10, marginTop: 2, fontFamily: "Pretendard-Regular" },
  scenarioMid:       { flex: 1 },
  scenarioPriceText: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  scenarioUpside:    { fontSize: 12, fontFamily: "Pretendard-SemiBold", marginTop: 2 },
  scenarioProb:      { width: 68 },
  scenarioProbHeader:{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  scenarioProbLabel: { fontSize: 10, fontFamily: "Pretendard-Regular" },
  scenarioProbValue: { fontSize: 11, fontFamily: "Pretendard-Bold" },
  probTrack:         { height: 5, borderRadius: 3, overflow: "hidden" },
  probFill:          { height: "100%", borderRadius: 3 },

  /* panels */
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  panelTitle:  { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  countBadge:  { backgroundColor: "#dbeafe", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  countBadgeText: { fontSize: 10, fontFamily: "Pretendard-Bold", color: "#1d4ed8" },
  avgRow:  { padding: 12, borderRadius: 10, gap: 8 },
  avgTitle:{ fontSize: 10, fontFamily: "Pretendard-SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  peerRow: { paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  peerName:{ fontSize: 13, fontFamily: "Pretendard-SemiBold" },

  /* running */
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginVertical: 10 },
  progressFill:  { height: "100%", borderRadius: 3 },
  progressLabel: { fontSize: 12, fontFamily: "Pretendard-Regular", textAlign: "center", marginBottom: 4 },
  currentStep:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },

  /* steps */
  stepContent:    { fontSize: 14, lineHeight: 23, fontFamily: "Pretendard-Regular", marginTop: 2 },
  validationBox:  { marginTop: 10, padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  validationLabel:{ fontSize: 10, fontFamily: "Pretendard-Bold", textTransform: "uppercase", letterSpacing: 0.5 },

  disclaimer: { fontSize: 11, lineHeight: 17, textAlign: "center", margin: 16, marginTop: 24, fontFamily: "Pretendard-Regular" },
});
