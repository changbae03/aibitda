import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Platform, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/hooks/useApi";
import {
  FinancialChartPanel, DisclosurePanel, DividendPanel,
  ShortInfoPanel, MajorShareholdersPanel, ETFInclusionPanel, NewsTimelinePanel,
} from "@/components/detail-panels";

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

/**
 * JSON 블록을 제거하고 이후 텍스트만 반환.
 * 텍스트가 없으면 JSON 내 텍스트 필드(plain_verdict, summary, narrative 등)를 조합.
 * null = 처리 불가(콘텐츠 없음).
 */
function stripJsonBlock(text: string): string | null {
  if (!text?.trim()) return null;
  // ```json ... ``` 코드 블록 제거
  let s = text.replace(/```json[\s\S]*?```/g, "").replace(/```[\s\S]*?```/g, "").trim();
  // 앞부분 JSON 오브젝트 감지 및 제거
  const si = s.indexOf("{");
  let jsonObj: any = null;
  if (si !== -1 && si < 200) {
    let depth = 0; let inStr = false; let esc = false; let ei = -1;
    for (let i = si; i < s.length; i++) {
      const ch = s[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { ei = i; break; } }
    }
    if (ei !== -1) {
      try { jsonObj = JSON.parse(s.slice(si, ei + 1)); } catch { /**/ }
      s = s.slice(ei + 1).trim();
    }
  }
  // JSON 제거 후 텍스트가 있으면 그대로 반환
  if (s) return s;
  // 텍스트가 없으면 JSON 필드에서 서술 텍스트 추출
  if (jsonObj) {
    const textFields = ["plain_verdict", "summary", "narrative", "analysis", "conclusion", "reasoning", "description"];
    const parts: string[] = [];
    for (const f of textFields) {
      if (typeof jsonObj[f] === "string" && jsonObj[f].trim()) parts.push(jsonObj[f].trim());
    }
    if (parts.length > 0) return parts.join("\n\n");
  }
  return null;
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
      <Text style={{ fontSize: 15, fontFamily: "Pretendard-Bold", color: c.color }}>{c.label}</Text>
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
      <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color }}>{label}</Text>
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
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#16a34a" }}>
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
            <Text style={[styles.tldrText, { color: colors.mutedForeground, fontSize: 15 }]}>{json.summary}</Text>
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
                      <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{label}</Text>
                      <Text style={{ fontSize: 15, fontFamily: "Pretendard-Bold", color: colors.foreground }}>
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
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{peerTicker}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 0 }}>
                  {([["PER", peer.per_trailing, 1, "x"], ["PBR", peer.pbr, 2, "x"], ["ROE", peer.roe, 1, "%"]] as [string, number | null, number, string][]).map(([label, val, dec, suf]) => (
                    <View key={label} style={{ width: 52, alignItems: "center", gap: 2 }}>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{label}</Text>
                      <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>
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
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: consensus.color }}>{consensus.label}</Text>
            )}
          </View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

        {expanded && !loading && info && (
          <View style={{ padding: 14, gap: 14 }}>
            <View style={[styles.avgRow, { backgroundColor: colors.accent, flexDirection: "row", gap: 0 }]}>
              {([["하단", info.targetLowPrice, "#dc2626"], ["평균", info.targetMeanPrice, colors.foreground], ["상단", info.targetHighPrice, "#16a34a"]] as [string, number | null, string][]).map(([label, val, color]) => (
                <View key={label} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{label}</Text>
                  <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color }}>{val != null ? fmtPrice(val, currency as any) : "—"}</Text>
                  {label === "평균" && upside != null && (
                    <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: upside >= 0 ? "#16a34a" : "#dc2626" }}>
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
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#16a34a" }}>매수 {buyCount}명 ({buyPct}%)</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#d97706" }}>중립 {holdCount}명 ({holdPct}%)</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#dc2626" }}>매도 {sellCount}명 ({sellPct}%)</Text>
                </View>
              </View>
            )}
            {(info.firmTargets ?? []).slice(0, 8).map((f, i, arr) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: i < arr.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                <Text style={{ flex: 1, fontSize: 15, color: colors.foreground }} numberOfLines={1}>{f.firm}</Text>
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  <Text style={{ fontSize: 15, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{fmtPrice(f.target, currency as any)}</Text>
                  {f.grade && <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{f.grade}</Text>}
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

function RunningProgressCard({ analysis, activeStepKey }: { analysis: any; activeStepKey: string | null }) {
  const colors  = useColors();
  const steps   = analysis.steps ?? [];
  const completedKeys = steps.filter((s: any) => s.status === "completed" || s.content).map((s: any) => s.stepKey);
  // 클라이언트 스트리밍 중인 스텝을 우선, 없으면 서버 리포트 스텝
  const serverCurrent = steps.find((s: any) => s.status === "in_progress")?.stepKey ?? null;
  const currentStep   = activeStepKey ?? serverCurrent;
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
          <Text style={{ fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#FF8A7A" }}>
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
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.mutedForeground }}>{i + 1}</Text>
                )}
              </View>
              <Text style={{ fontSize: 15, fontFamily: done ? "Pretendard-SemiBold" : "Pretendard-Regular", color }}>
                {AGENTS[key]?.name ?? key}
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

// ── MarkdownText ──────────────────────────────────────────────────────────────

/** 인라인 마크다운: **bold**, *italic* 파싱 */
function InlineText({ text, style }: { text: string; style?: TextStyle }) {
  const parts: { content: string; bold: boolean; italic: boolean }[] = [];
  const re = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ content: text.slice(last, m.index), bold: false, italic: false });
    if (m[2]) parts.push({ content: m[2], bold: true, italic: true });
    else if (m[3]) parts.push({ content: m[3], bold: true, italic: false });
    else if (m[4]) parts.push({ content: m[4], bold: false, italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ content: text.slice(last), bold: false, italic: false });
  if (parts.length === 0) return <Text style={style} lineBreakStrategyIOS="hangul-word">{text}</Text>;
  return (
    <Text style={style} lineBreakStrategyIOS="hangul-word">
      {parts.map((p, i) => (
        <Text
          key={i}
          style={[
            style,
            p.bold  && { fontFamily: "Pretendard-Bold" },
            p.italic && { fontStyle: "italic" },
          ] as TextStyle[]}
        >
          {p.content}
        </Text>
      ))}
    </Text>
  );
}

type MdBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "hr" }
  | { type: "bullet"; text: string; indent: number }
  | { type: "numbered"; text: string; n: number }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "para"; lines: string[] };

function parseMarkdown(raw: string): MdBlock[] {
  const lines = raw.split("\n");
  const blocks: MdBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // blank
    if (!trimmed) { i++; continue; }

    // headings
    if (/^### /.test(trimmed)) { blocks.push({ type: "h3", text: trimmed.slice(4).trim() }); i++; continue; }
    if (/^## /.test(trimmed))  { blocks.push({ type: "h2", text: trimmed.slice(3).trim() }); i++; continue; }
    if (/^# /.test(trimmed))   { blocks.push({ type: "h1", text: trimmed.slice(2).trim() }); i++; continue; }

    // hr
    if (/^[\-\*_]{3,}$/.test(trimmed)) { blocks.push({ type: "hr" }); i++; continue; }

    // table: collect consecutive | lines
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      // separator row: every cell is only dashes/colons e.g. |---|:--:|--:|
      const isSep = (l: string) =>
        l.split("|").slice(1, -1).every(cell => /^\s*:?-+:?\s*$/.test(cell));
      const parseRow = (l: string): string[] =>
        l.split("|").slice(1, -1).map(c => c.trim());
      const nonSep = tableLines.filter(l => !isSep(l));
      if (nonSep.length >= 1) {
        const headers = parseRow(nonSep[0]);
        const rows = nonSep.slice(1).map(parseRow);
        blocks.push({ type: "table", headers, rows });
      }
      continue;
    }

    // bullet list
    const bulletM = /^(\s*)[-*+] (.*)$/.exec(line);
    if (bulletM) {
      blocks.push({ type: "bullet", text: bulletM[2].trim(), indent: bulletM[1].length });
      i++;
      continue;
    }

    // numbered list
    const numberedM = /^(\d+)\. (.*)$/.exec(trimmed);
    if (numberedM) {
      blocks.push({ type: "numbered", text: numberedM[2].trim(), n: parseInt(numberedM[1]) });
      i++;
      continue;
    }

    // paragraph: collect until a heading/table/hr/list or blank
    const paraLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t) { i++; break; }
      if (/^#+\s/.test(t) || t.startsWith("|") || /^[\-\*_]{3,}$/.test(t) || /^(\s*)[-*+] /.test(lines[i]) || /^\d+\. /.test(t)) break;
      paraLines.push(t);
      i++;
    }
    if (paraLines.length > 0) blocks.push({ type: "para", lines: paraLines });
  }
  return blocks;
}

function MarkdownTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const colors = useColors();
  if (headers.length === 0) return null;

  const colCount = Math.max(headers.length, ...rows.map(r => r.length));

  // 5열 이상이면 가로 스크롤 + 고정 픽셀 폭
  const isWide = colCount >= 5;

  // 숫자/단순 값 셀 판별 (줄바꿈 금지)
  function isNumericCell(val: string) {
    return /^[+-]?[\d,\.%—\-–]+[EKMBW]?$/.test(val.trim()) || val.trim() === "—";
  }

  // 열 고정 폭 (wide 모드)
  function colPx(ci: number): number {
    if (ci === 0) return 78;                                      // 라벨 열
    const lastHeader = headers[colCount - 1] ?? "";
    if (ci === colCount - 1 && /추세|trend/i.test(lastHeader)) return 38; // 추세 열
    return 58;                                                    // 데이터 열
  }

  // flex 비율 (narrow 모드)
  function colFlex(ci: number): number {
    if (colCount === 1) return 1;
    if (colCount === 2) return ci === 0 ? 1.2 : 2;
    if (colCount === 3) return ci === 0 ? 1.1 : ci === 1 ? 1.5 : 2.2;
    if (colCount === 4) return ci === 0 ? 1.1 : 1.2;
    return ci === 0 ? 1 : 1.1;
  }

  const tableBody = (
    <View style={{ borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: "hidden", marginVertical: 4 }}>
      {/* 헤더 행 */}
      <View style={{ flexDirection: "row", backgroundColor: colors.muted }}>
        {Array.from({ length: colCount }).map((_, ci) => (
          <View
            key={ci}
            style={[
              mdStyles.cell,
              isWide
                ? { width: colPx(ci), flexShrink: 0 }
                : { flex: colFlex(ci) },
              { backgroundColor: colors.muted, alignItems: "center" },
              ci < colCount - 1 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
            ]}
          >
            <Text
              style={[mdStyles.headerCell, { color: colors.foreground }]}
              lineBreakStrategyIOS="hangul-word"
            >
              {(headers[ci] ?? "").replace(/\*\*/g, "")}
            </Text>
          </View>
        ))}
      </View>

      {/* 데이터 행 */}
      {rows.map((row, ri) => (
        <View
          key={ri}
          style={[
            { flexDirection: "row" },
            ri < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ri % 2 === 0 ? { backgroundColor: colors.background } : { backgroundColor: colors.accent },
          ]}
        >
          {Array.from({ length: colCount }).map((_, ci) => {
            const raw    = row[ci] ?? "";
            const boldM  = raw.match(/^\*\*(.+)\*\*$/s);
            const cell   = boldM ? boldM[1] : raw;
            const isBold = !!boldM;
            const isUp   = cell === "↑" || cell === "▲";
            const isDown = cell === "↓" || cell === "▼";
            const isNum  = isNumericCell(cell);
            const isLabel = ci === 0;
            return (
              <View
                key={ci}
                style={[
                  mdStyles.cell,
                  isWide
                    ? { width: colPx(ci), flexShrink: 0 }
                    : { flex: colFlex(ci) },
                  { alignItems: isLabel ? "center" : "center" },
                  ci < colCount - 1 && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    mdStyles.dataCell,
                    { color: isUp ? "#16a34a" : isDown ? "#dc2626" : colors.foreground, textAlign: isLabel ? "center" : isNum ? "center" : "left" },
                    isLabel && { fontFamily: "Pretendard-Medium" },
                    isBold  && { fontFamily: "Pretendard-SemiBold" },
                  ]}
                  lineBreakStrategyIOS="hangul-word"
                  numberOfLines={isNum ? 1 : undefined}
                >
                  {cell}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );

  if (isWide) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 4 }}>
        {tableBody}
      </ScrollView>
    );
  }
  return tableBody;
}

function MarkdownText({ content, baseColor }: { content: string; baseColor: string }) {
  const colors = useColors();
  const blocks = React.useMemo(() => parseMarkdown(content), [content]);

  return (
    <View style={{ gap: 0 }}>
      {blocks.map((block, idx) => {
        switch (block.type) {
          case "h1":
            return (
              <InlineText
                key={idx}
                text={block.text}
                style={{ fontSize: 19, fontFamily: "Pretendard-Bold", color: colors.foreground, marginTop: 22, marginBottom: 6, lineHeight: 26 }}
              />
            );
          case "h2":
            return (
              <View key={idx} style={{ marginTop: 22, marginBottom: 12, paddingBottom: 8, borderBottomWidth: 1.5, borderBottomColor: colors.border }}>
                <InlineText
                  text={block.text}
                  style={{ fontSize: 17, fontFamily: "Pretendard-Bold", color: colors.foreground, lineHeight: 24 }}
                />
              </View>
            );
          case "h3":
            return (
              <View key={idx} style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 16, marginBottom: 8, paddingLeft: 10, borderLeftWidth: 2.5, borderLeftColor: "#2563eb" }}>
                <InlineText
                  text={block.text}
                  style={{ flex: 1, fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#2563eb", lineHeight: 22 }}
                />
              </View>
            );
          case "hr":
            return <View key={idx} style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 16 }} />;
          case "bullet":
            return (
              <View key={idx} style={{ flexDirection: "row", gap: 8, paddingLeft: block.indent * 8, marginBottom: 8 }}>
                <Text style={{ fontSize: 16, color: baseColor, marginTop: 5, lineHeight: 30 }}>•</Text>
                <InlineText
                  text={block.text}
                  style={{ flex: 1, fontSize: 16, lineHeight: 30, fontFamily: "Pretendard-Regular", color: baseColor }}
                />
              </View>
            );
          case "numbered":
            return (
              <View key={idx} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                <Text style={{ fontSize: 16, color: colors.mutedForeground, lineHeight: 30, fontFamily: "Pretendard-SemiBold", minWidth: 22 }}>{block.n}.</Text>
                <InlineText
                  text={block.text}
                  style={{ flex: 1, fontSize: 16, lineHeight: 30, fontFamily: "Pretendard-Regular", color: baseColor }}
                />
              </View>
            );
          case "table":
            return <View key={idx} style={{ marginVertical: 12 }}><MarkdownTable headers={block.headers} rows={block.rows} /></View>;
          case "para":
            return (
              <InlineText
                key={idx}
                text={block.lines.join(" ")}
                style={{ fontSize: 16, lineHeight: 30, fontFamily: "Pretendard-Regular", color: baseColor, marginBottom: 16 }}
              />
            );
          default:
            return null;
        }
      })}
    </View>
  );
}

const mdStyles = StyleSheet.create({
  cell:       { paddingVertical: 10, paddingHorizontal: 10, justifyContent: "center" },
  headerCell: { fontSize: 13, fontFamily: "Pretendard-Bold", textAlign: "center", lineHeight: 18 },
  dataCell:   { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
});

// ── Streaming helpers ─────────────────────────────────────────────────────────

const getApiBase = () =>
  process.env.EXPO_PUBLIC_DOMAIN
    ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
    : "";

type StreamState = {
  key: string;
  content: string;
  debateStatus?: "challenging" | "synthesizing";
  qcStatus?: "checking" | "approved" | "revising" | "revised";
  qcScore?: number;
};

// ── AgentStepsSection ─────────────────────────────────────────────────────────

const STEP_TOPICS: Record<string, string> = {
  company_intro:       "기업 개요 · 사업 구조 · 주요 제품 · 경영진",
  industry_analysis:   "산업 구조 · 성장률 · 정책 환경 · 경쟁 구도 · 매크로 리스크",
  catalyst_analysis:   "투자 촉매 · 스마트머니 수급 · 주요 이벤트 · 리스크",
  company_analysis:    "실적 분석 · 매출/이익 전망 · 재무 건전성 · 이익률",
  relative_valuation:  "DCF · PER · EV/EBITDA · 피어 비교 · 목표주가 산출",
  market_analysis:     "기술적 분석 · 지지/저항선 · 모멘텀 · 수급 흐름",
  investment_strategy: "투자 전략 · 매수 타이밍 · 리스크 관리 · 시나리오",
};

function InProgressStepCard({ stepKey, index }: { stepKey: string; index: number }) {
  const colors = useColors();
  const agent  = AGENTS[stepKey];
  const accentColor = agent?.color ?? "#2563eb";
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9,  duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Card style={{ borderColor: accentColor + "55", borderWidth: 1.5 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: accentColor + "18", alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="small" color={accentColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: accentColor }}>
            {agent?.name ?? stepKey}
          </Text>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>
            {agent?.role ?? ""} · 분석 리포트 작성 중…
          </Text>
        </View>
        <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.mutedForeground }}>
          {index + 1}/{STEP_ORDER.length}
        </Text>
      </View>
      <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", lineHeight: 20, marginBottom: 14 }}>
        {STEP_TOPICS[stepKey] ?? "분석 진행 중"}
      </Text>
      <Animated.View style={{ gap: 9, opacity: pulse }}>
        {[1, 0.88, 0.72, 0.52].map((w, i) => (
          <View key={i} style={{ height: 13, borderRadius: 6, backgroundColor: colors.muted, width: `${w * 100}%` as any }} />
        ))}
      </Animated.View>
    </Card>
  );
}

function UpcomingStepCard({ stepKey, index }: { stepKey: string; index: number }) {
  const colors = useColors();
  const agent  = AGENTS[stepKey];
  return (
    <Card style={{ opacity: 0.3 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: colors.mutedForeground }}>{index + 1}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: colors.mutedForeground }}>
            {agent?.name ?? stepKey}
          </Text>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>
            {agent?.role ?? ""}
          </Text>
        </View>
      </View>
      <View style={{ gap: 9 }}>
        {[0.92, 0.76, 0.55].map((w, i) => (
          <View key={i} style={{ height: 13, borderRadius: 6, backgroundColor: colors.muted, width: `${w * 100}%` as any }} />
        ))}
      </View>
    </Card>
  );
}

// ── StreamingStepCard ─────────────────────────────────────────────────────────

function StreamingStepCard({ state, index }: { state: StreamState; index: number }) {
  const colors = useColors();
  const agent = AGENTS[state.key];
  const accentColor = agent?.color ?? "#2563eb";
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1,    duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const statusBadge =
    state.debateStatus === "challenging"  ? { label: "⚔️  Devil's Advocate 검토 중",   color: "#7C3AED", bg: "#EDE9FE" } :
    state.debateStatus === "synthesizing" ? { label: "🔄  최종본 통합 중",              color: "#2563EB", bg: "#DBEAFE" } :
    state.qcStatus === "checking"         ? { label: "🔍  팀장 검토 중",                color: "#D97706", bg: "#FEF3C7" } :
    state.qcStatus === "revising"         ? { label: `✏️  재작성 중 (초기 점수 ${state.qcScore ?? "?"}점)`, color: "#DC2626", bg: "#FEE2E2" } :
    (state.qcStatus === "approved" || state.qcStatus === "revised")
      ? { label: `✓  검토 완료 (${state.qcScore}/10)`, color: "#16A34A", bg: "#DCFCE7" } :
    null;

  return (
    <Card style={{ borderColor: accentColor + "55", borderWidth: 1.5 }}>
      {/* 헤더 */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: accentColor + "18", alignItems: "center", justifyContent: "center" }}>
          {state.content
            ? <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accentColor, opacity: pulse }} />
            : <ActivityIndicator size="small" color={accentColor} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: accentColor }}>
            {agent?.name ?? state.key}
          </Text>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>
            {agent?.role ?? ""} · 리포트 작성 중
          </Text>
        </View>
        <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.mutedForeground }}>
          {index + 1}/{STEP_ORDER.length}
        </Text>
      </View>

      {/* 상태 배지 */}
      {statusBadge && (
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 6,
          borderRadius: 8, backgroundColor: statusBadge.bg, alignSelf: "flex-start", marginBottom: 10 }}>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: statusBadge.color }}>
            {statusBadge.label}
          </Text>
        </View>
      )}

      {/* 콘텐츠 or 스켈레톤 */}
      {state.content ? (
        <View>
          <Text style={{ fontSize: 15, lineHeight: 25, fontFamily: "Pretendard-Regular", color: colors.foreground }}>
            {state.content}
          </Text>
          <Animated.View style={{ width: 2, height: 18, backgroundColor: accentColor, borderRadius: 1,
            marginTop: 6, opacity: pulse }} />
        </View>
      ) : (
        <Animated.View style={{ gap: 9, opacity: pulse }}>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular",
            lineHeight: 20, marginBottom: 6 }}>
            {STEP_TOPICS[state.key] ?? "분석 진행 중"}
          </Text>
          {[1, 0.88, 0.72, 0.52].map((w, i) => (
            <View key={i} style={{ height: 13, borderRadius: 6, backgroundColor: colors.muted,
              width: `${w * 100}%` as any }} />
          ))}
        </Animated.View>
      )}
    </Card>
  );
}

function AgentStepsSection({ analysis, streamingStep }: { analysis: any; streamingStep: StreamState | null }) {
  const colors = useColors();
  const stepsMap: Record<string, any> = {};
  for (const s of (analysis.steps ?? [])) stepsMap[s.stepKey] = s;

  const isRunning      = analysis.status === "in_progress" || analysis.status === "queued";
  const streamingKey   = streamingStep?.key ?? null;
  const streamingIdx   = streamingKey ? STEP_ORDER.indexOf(streamingKey as any) : -1;

  // Server-reported current step (fallback when not streaming from client)
  const serverCurrent: string | null = (analysis.steps ?? []).find((s: any) => s.status === "in_progress")?.stepKey ?? null;
  const activeIdx      = streamingIdx >= 0 ? streamingIdx : serverCurrent ? STEP_ORDER.indexOf(serverCurrent as any) : -1;
  const upcomingKeys   = activeIdx >= 0 ? STEP_ORDER.slice(activeIdx + 1, activeIdx + 3) : [];

  const hasAnyContent  = STEP_ORDER.some(k => !!stepsMap[k]?.content) || !!streamingKey;
  if (!hasAnyContent && !isRunning) return null;

  return (
    <View style={styles.section}>
      <SectionLabel text="AI 에이전트 분석 — 7단계" />
      <View style={{ gap: 12 }}>
        {STEP_ORDER.map((key, index) => {
          // 현재 스트리밍 중인 스텝
          if (key === streamingKey) {
            return <StreamingStepCard key={`stream-${key}`} state={streamingStep!} index={index} />;
          }

          const step = stepsMap[key];
          if (!step?.content) return null;
          const agent = AGENTS[key];
          const displayContent = stripJsonBlock(step.content);
          if (!displayContent) return null;
          const accentColor = agent?.color ?? "#2563eb";

          return (
            <Card key={key}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: accentColor + "18",
                  alignItems: "center", justifyContent: "center" }}>
                  <Feather name="check-circle" size={14} color={accentColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: accentColor }}>
                    {agent?.name ?? key}
                  </Text>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>
                    {agent?.role ?? ""}
                  </Text>
                </View>
              </View>
              <MarkdownText content={displayContent} baseColor={colors.foreground} />
            </Card>
          );
        })}

        {/* 클라이언트 스트리밍 없이 서버에서만 진행 중인 스텝 */}
        {isRunning && !streamingKey && serverCurrent && !stepsMap[serverCurrent]?.content && (
          <InProgressStepCard
            key={`inprog-${serverCurrent}`}
            stepKey={serverCurrent}
            index={STEP_ORDER.indexOf(serverCurrent as any)}
          />
        )}

        {/* 예정 스텝 고스트 카드 */}
        {isRunning && upcomingKeys.map(key => (
          <UpcomingStepCard
            key={`upcoming-${key}`}
            stepKey={key}
            index={STEP_ORDER.indexOf(key as any)}
          />
        ))}
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

  const [analysis, setAnalysis]     = useState<any>(null);
  const [isLoading, setIsLoading]   = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [quote, setQuote] = useState<{ price: number | null; change: number | null; currency: string } | null>(null);
  const stats = useTickerStats(analysis?.ticker ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 스트리밍 상태 ──────────────────────────────────────────────────────────
  const [streamingStep, setStreamingStep] = useState<StreamState | null>(null);
  const hasInitiatedRef   = useRef(false);
  const triggeredSteps    = useRef(new Set<string>());
  const streamingStepRef  = useRef<((stepKey: string) => void) | null>(null);
  const streamContentRef  = useRef("");       // 토큰 누적 버퍼 (setState throttle용)
  const lastContentUpdate = useRef(0);
  const xhrRef            = useRef<XMLHttpRequest | null>(null);

  // 언마운트 시 진행 중 XHR 중단
  useEffect(() => () => { xhrRef.current?.abort(); }, []);

  const loadAnalysis = React.useCallback(() => {
    if (!id) return;
    apiFetch<any>(`/api/analysis/${id}`)
      .then((data) => { setAnalysis(data); setIsLoading(false); setFetchError(false); })
      .catch(() => { setFetchError(true); setIsLoading(false); });
  }, [id]);

  useEffect(() => { loadAnalysis(); }, [loadAnalysis]);

  // ── SSE 스트리밍 실행 ──────────────────────────────────────────────────────
  const runStreamingStep = React.useCallback((stepKey: string) => {
    if (!id) return;
    streamContentRef.current = "";
    setStreamingStep({ key: stepKey, content: "" });

    const url = `${getApiBase()}/api/analysis/${id}/step`;
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    let processedLen = 0;
    let gotDone = false;

    const processChunk = (chunk: string) => {
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const msg = JSON.parse(line.slice(6));
          if (msg.t) {
            streamContentRef.current += msg.t;
            // 200ms 간격으로 state 업데이트 (빈번한 re-render 방지)
            const now = Date.now();
            if (now - lastContentUpdate.current > 200) {
              lastContentUpdate.current = now;
              const snap = streamContentRef.current;
              setStreamingStep(prev => prev ? { ...prev, content: snap } : null);
            }
          } else if (msg.debate === "challenging") {
            setStreamingStep(prev => prev ? { ...prev, debateStatus: "challenging" } : null);
          } else if (msg.debate === "synthesizing") {
            streamContentRef.current = "";
            setStreamingStep(prev => prev ? { ...prev, debateStatus: "synthesizing", content: "" } : null);
          } else if (msg.qc === "checking") {
            setStreamingStep(prev => prev ? { ...prev, debateStatus: undefined, qcStatus: "checking" } : null);
          } else if (msg.qc === "revising") {
            streamContentRef.current = "";
            setStreamingStep(prev => prev ? { ...prev, qcStatus: "revising", qcScore: msg.score, content: "" } : null);
          } else if (msg.qc === "approved" || msg.qc === "revised") {
            setStreamingStep(prev => prev ? { ...prev, qcStatus: msg.qc, qcScore: msg.score } : null);
          }
          if (msg.done) gotDone = true;
        } catch { /* ignore parse errors */ }
      }
    };

    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.onprogress = () => {
      const newData = xhr.responseText.slice(processedLen);
      processedLen = xhr.responseText.length;
      if (newData) processChunk(newData);
    };

    xhr.onload = () => {
      const remaining = xhr.responseText.slice(processedLen);
      if (remaining) processChunk(remaining);
      xhrRef.current = null;
      setStreamingStep(null);

      if (xhr.status === 409) {
        // 이미 서버 백그라운드에서 실행 중 — 폴링에 맡김
        return;
      }

      // 완료 시: 분석 재조회 후 다음 스텝 자동 체이닝
      loadAnalysis();
      if (gotDone || xhr.status === 200) {
        const nextIdx = STEP_ORDER.indexOf(stepKey as any) + 1;
        if (nextIdx < STEP_ORDER.length) {
          const nextKey = STEP_ORDER[nextIdx];
          if (!triggeredSteps.current.has(nextKey)) {
            triggeredSteps.current.add(nextKey);
            setTimeout(() => streamingStepRef.current?.(nextKey), 300);
          }
        }
      }
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setStreamingStep(null);
      // 에러 시 폴링 폴백 유지
    };

    xhr.send(JSON.stringify({ stepKey }));
  }, [id, loadAnalysis]);

  streamingStepRef.current = runStreamingStep;

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

  // ── 분석 진입 시 첫 미완료 스텝부터 스트리밍 시작 ──────────────────────────
  const pipelineKickedRef = useRef(false);
  useEffect(() => {
    const status = analysis?.status;
    const steps  = analysis?.steps ?? [];
    if (!status || !id) return;

    // 서버 파이프라인 안전망 (1회 킥)
    const isResumable = status === "in_progress" || status === "queued" ||
      (status === "error" && steps.length < 7);
    if (isResumable && !pipelineKickedRef.current) {
      pipelineKickedRef.current = true;
      apiFetch(`/api/analysis/${id}/run-pipeline`, { method: "POST" }).catch(() => {});
    }

    // in_progress면 클라이언트 스트리밍 시작
    if (status === "in_progress" && !hasInitiatedRef.current && !streamingStep) {
      const completedKeys = new Set(steps.filter((s: any) => s.content).map((s: any) => s.stepKey));
      const nextKey = STEP_ORDER.find(k => !completedKeys.has(k));
      if (nextKey && !triggeredSteps.current.has(nextKey)) {
        hasInitiatedRef.current = true;
        triggeredSteps.current.add(nextKey);
        runStreamingStep(nextKey);
      }
    }
  }, [analysis?.status, analysis?.steps?.length, id]);

  // ── 폴링: 스트리밍 비활성 시 폴백 (느린 주기) ──────────────────────────────
  useEffect(() => {
    const status = analysis?.status;
    const active = streamingStep !== null;
    if ((status === "in_progress" || status === "queued") && !active) {
      pollRef.current = setInterval(() => loadAnalysis(), 8000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [analysis?.status, streamingStep !== null]);

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
          <Text style={{ color: colors.mutedForeground, fontSize: 15, marginTop: 10, fontFamily: "Pretendard-Regular" }}>
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
          <Text style={{ color: colors.mutedForeground, fontSize: 17, fontFamily: "Pretendard-Regular" }}>
            분석을 불러오지 못했어요
          </Text>
          <Pressable onPress={loadAnalysis} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: "#FF8A7A", borderRadius: 8 }}>
            <Text style={{ color: "#fff", fontSize: 16, fontFamily: "Pretendard-SemiBold" }}>다시 시도</Text>
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
        {!isComplete && <RunningProgressCard analysis={analysis} activeStepKey={streamingStep?.key ?? null} />}

        {/* 헤더 (완료 여부 관계없이 표시) */}
        <HeaderCard analysis={analysis} quote={quote} stats={stats} />

        {/* 완료 시: 요약 · 시나리오 · 피어 · 컨센서스 · 스텝 콘텐츠 */}
        {isComplete && (
          <>
            <TldrCard analysis={analysis} />
            <ScenarioCard analysis={analysis} />
            <PeerMultiplesPanel ticker={analysis.ticker} />
            <AnalystConsensusPanel ticker={analysis.ticker} currentPrice={currentPrice} />
            <AgentStepsSection analysis={analysis} streamingStep={null} />
            {/* 추가 데이터 패널 */}
            <FinancialChartPanel ticker={analysis.ticker} />
            <DisclosurePanel ticker={analysis.ticker} />
            <DividendPanel ticker={analysis.ticker} />
            <ShortInfoPanel ticker={analysis.ticker} />
            <MajorShareholdersPanel ticker={analysis.ticker} />
            <ETFInclusionPanel ticker={analysis.ticker} />
            <NewsTimelinePanel
              ticker={analysis.ticker}
              keyword={analysis.companyName ?? analysis.ticker}
            />
          </>
        )}

        {/* 진행 중에도 완료된 단계 + 스트리밍 카드 표시 */}
        {!isComplete && <AgentStepsSection analysis={analysis} streamingStep={streamingStep} />}

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
  navBackText: { fontSize: 16, fontFamily: "Pretendard-SemiBold" },

  /* card */
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  section: { marginTop: 16, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 12, fontFamily: "Pretendard-Bold",
    textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8,
  },

  /* header */
  headerCard:      { margin: 16, marginBottom: 0 },
  headerTop:       { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  companyName:     { fontSize: 24, fontFamily: "Pretendard-Bold" },
  companyIndustry: { fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 2 },
  priceRow:        { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  livePrice:       { fontSize: 28, fontFamily: "Pretendard-Bold" },
  liveChange:      { fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  liveDot:         { width: 8, height: 8, borderRadius: 4 },

  targetRow:   { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  targetLabel: { fontSize: 14, fontFamily: "Pretendard-Regular" },
  targetPrice: { fontSize: 22, fontFamily: "Pretendard-Bold" },

  metricsGrid:  { flexDirection: "row", flexWrap: "wrap", borderTopWidth: StyleSheet.hairlineWidth, marginBottom: 10 },
  metricItem:   { width: "33.33%", paddingVertical: 10, paddingHorizontal: 4, alignItems: "center", gap: 3 },
  metricLabel:  { fontSize: 12, fontFamily: "Pretendard-Regular" },
  metricValue:  { fontSize: 15, fontFamily: "Pretendard-SemiBold" },

  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  tag:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  /* tldr */
  tldrRow:       { paddingVertical: 10, paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth, gap: 5, marginHorizontal: -2 },
  tldrSubLabel:  { fontSize: 12, fontFamily: "Pretendard-Bold", textTransform: "uppercase", letterSpacing: 0.6 },
  tldrVerdictVal:{ fontSize: 16, fontFamily: "Pretendard-Bold" },
  tldrText:      { fontSize: 16, lineHeight: 22, fontFamily: "Pretendard-Regular" },

  /* scenario */
  scenarioRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, gap: 10 },
  scenarioLabel:     { width: 68 },
  scenarioCaseText:  { fontSize: 14, fontFamily: "Pretendard-Bold" },
  scenarioSub:       { fontSize: 12, marginTop: 2, fontFamily: "Pretendard-Regular" },
  scenarioMid:       { flex: 1 },
  scenarioPriceText: { fontSize: 16, fontFamily: "Pretendard-Bold" },
  scenarioUpside:    { fontSize: 14, fontFamily: "Pretendard-SemiBold", marginTop: 2 },
  scenarioProb:      { width: 68 },
  scenarioProbHeader:{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  scenarioProbLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  scenarioProbValue: { fontSize: 13, fontFamily: "Pretendard-Bold" },
  probTrack:         { height: 5, borderRadius: 3, overflow: "hidden" },
  probFill:          { height: "100%", borderRadius: 3 },

  /* panels */
  panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12 },
  panelTitle:  { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  countBadge:  { backgroundColor: "#dbeafe", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  countBadgeText: { fontSize: 12, fontFamily: "Pretendard-Bold", color: "#1d4ed8" },
  avgRow:  { padding: 12, borderRadius: 10, gap: 8 },
  avgTitle:{ fontSize: 12, fontFamily: "Pretendard-SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  peerRow: { paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  peerName:{ fontSize: 15, fontFamily: "Pretendard-SemiBold" },

  /* running */
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden", marginVertical: 10 },
  progressFill:  { height: "100%", borderRadius: 3 },
  progressLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", marginBottom: 4 },
  currentStep:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },

  /* steps */
  stepContent:    { fontSize: 16, lineHeight: 23, fontFamily: "Pretendard-Regular", marginTop: 2 },
  validationBox:  { marginTop: 10, padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  validationLabel:{ fontSize: 12, fontFamily: "Pretendard-Bold", textTransform: "uppercase", letterSpacing: 0.5 },

  disclaimer: { fontSize: 13, lineHeight: 17, textAlign: "center", margin: 16, marginTop: 24, fontFamily: "Pretendard-Regular" },
});
