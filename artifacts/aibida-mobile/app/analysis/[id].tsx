import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/hooks/useApi";
import { useGetAnalysis } from "@workspace/api-client-react";

// ── helpers ──────────────────────────────────────────────────────────────────

function extractJson(raw: string): any | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/FINAL_VALUATION_DATA:\s*\{[^}]*(?:\{[^}]*\}[^}]*)?\}/g, "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
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
  try {
    const fix = s.replace(/"((?:[^"\\]|\\.)*)"/gs, (_m, inner) =>
      `"${inner.replace(/\n/g, "\\n").replace(/\r/g, "\\r")}"`);
    return JSON.parse(fix.replace(/,\s*([}\]])/g, "$1"));
  } catch { /**/ }
  try {
    const fix = s.replace(/:\s*([+-]?\d+\.?\d*)%/g, (_, n) => `: "${n}%"`).replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(fix);
  } catch { /**/ }
  return null;
}

function fmtPrice(val: string | number | null | undefined, currency: "KRW" | "USD" = "KRW"): string {
  if (val == null || val === "") return "N/A";
  const n = typeof val === "number" ? val : parseFloat(String(val).replace(/[^0-9.\-]/g, ""));
  if (isNaN(n)) return String(val);
  if (currency === "USD") return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return n.toLocaleString("ko-KR") + "원";
}

function fmtNum(v: number | null | undefined, dec = 1, suffix = ""): string {
  if (v == null) return "N/A";
  return `${v.toFixed(dec)}${suffix}`;
}

function fmtMC(v: number | null | undefined): string {
  if (v == null) return "N/A";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(0)}억`;
  return `${(v / 1e6).toFixed(0)}M`;
}

function isUSTicker(ticker: string): boolean {
  return !/^\d{6}$/.test(ticker);
}

// ── sub-components ────────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  company_intro: "기업 소개",
  industry_analysis: "산업 분석",
  company_analysis: "기업 분석",
  market_analysis: "시장 분석",
  catalyst_analysis: "촉매 분석",
  investment_strategy: "투자 전략",
  relative_valuation: "밸류에이션",
};

const INFO_COLORS: Record<string, string> = {
  confirmed_fact: "#22c55e",
  data_based_estimate: "#f59e0b",
  hypothesis: "#64748b",
};

const INFO_LABELS: Record<string, string> = {
  confirmed_fact: "확인된 사실",
  data_based_estimate: "데이터 추정",
  hypothesis: "가설",
};

function SectionLabel({ text }: { text: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{text}</Text>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

function VerdictBadge({ verdict, large }: { verdict?: string; large?: boolean }) {
  const colors = useColors();
  if (!verdict) return null;
  const map: Record<string, { color: string; label: string }> = {
    BUY: { color: colors.up, label: "매수" },
    STRONG_BUY: { color: colors.up, label: "강력매수" },
    SELL: { color: colors.down, label: "매도" },
    STRONG_SELL: { color: colors.down, label: "강력매도" },
    HOLD: { color: colors.warning, label: "보유" },
    WATCH: { color: colors.mutedForeground, label: "관찰" },
  };
  const v = verdict.toUpperCase().replace(" ", "_");
  const c = map[v] ?? { color: colors.mutedForeground, label: verdict };
  return (
    <View style={[styles.verdictBadge, large && styles.verdictBadgeLarge, { backgroundColor: c.color + "22", borderColor: c.color + "44" }]}>
      <Text style={[styles.verdictText, large && styles.verdictTextLarge, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

// ── Header Card ──────────────────────────────────────────────────────────────

function HeaderCard({
  analysis,
  quote,
}: {
  analysis: any;
  quote: { price: number | null; change: number | null; currency: string } | null;
}) {
  const colors = useColors();
  const currency: "KRW" | "USD" = isUSTicker(analysis.ticker) ? "USD" : "KRW";

  return (
    <Card style={{ margin: 16, marginBottom: 0 }}>
      <View style={styles.topRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.companyName, { color: colors.foreground }]}>{analysis.companyName}</Text>
          <Text style={[styles.ticker, { color: colors.mutedForeground }]}>
            {analysis.ticker} · {analysis.industry}
          </Text>
        </View>
        <VerdictBadge verdict={analysis.investmentVerdict} large />
      </View>

      {/* Live price */}
      {quote?.price != null && (
        <View style={[styles.liveRow, { borderTopColor: colors.border }]}>
          <View style={{ gap: 2 }}>
            <Text style={[styles.livePrice, { color: colors.foreground }]}>
              {fmtPrice(quote.price, currency)}
            </Text>
            {quote.change != null && (
              <Text style={[styles.liveChange, { color: quote.change >= 0 ? colors.up : colors.down }]}>
                {quote.change >= 0 ? "+" : ""}{quote.change.toFixed(2)}%
              </Text>
            )}
          </View>
          <View style={[styles.liveDot, { backgroundColor: "#22c55e" }]} />
        </View>
      )}

      {/* Price grid */}
      {(analysis.targetPrice || analysis.entryPrice || analysis.stopLoss) && (
        <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
          {analysis.entryPrice != null && (
            <View style={styles.priceItem}>
              <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>진입가</Text>
              <Text style={[styles.priceValue, { color: colors.foreground }]}>
                {analysis.entryPrice.toLocaleString("ko-KR")}
              </Text>
            </View>
          )}
          {analysis.targetPrice != null && (
            <View style={styles.priceItem}>
              <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>목표가</Text>
              <Text style={[styles.priceValue, { color: colors.up }]}>
                {analysis.targetPrice.toLocaleString("ko-KR")}
              </Text>
            </View>
          )}
          {analysis.stopLoss != null && (
            <View style={styles.priceItem}>
              <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>손절가</Text>
              <Text style={[styles.priceValue, { color: colors.down }]}>
                {analysis.stopLoss.toLocaleString("ko-KR")}
              </Text>
            </View>
          )}
          {analysis.riskRewardRatio != null && (
            <View style={styles.priceItem}>
              <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>R/R</Text>
              <Text style={[styles.priceValue, { color: colors.primary }]}>
                {analysis.riskRewardRatio.toFixed(1)}
              </Text>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

// ── TL;DR Card ──────────────────────────────────────────────────────────────

function TldrCard({ analysis }: { analysis: any }) {
  const colors = useColors();
  const stratStep = analysis.steps?.find((s: any) => s.stepKey === "investment_strategy");
  const json = stratStep ? extractJson(stratStep.content) : null;
  if (!json) return null;

  const hasContent = json.plain_verdict || json.key_issue || json.summary || json.verdict;
  if (!hasContent) return null;

  const verdictMap: Record<string, string> = {
    BUY: "매수", STRONG_BUY: "강력매수", SELL: "매도", STRONG_SELL: "강력매도",
    HOLD: "보유", WATCH: "관찰",
  };
  const verdictStr = json.verdict ? (verdictMap[String(json.verdict).toUpperCase()] ?? json.verdict) : null;

  return (
    <View style={styles.sectionWrap}>
      <SectionLabel text="투자 요약" />
      <Card>
        {/* Verdict badge from JSON */}
        {verdictStr && (
          <View style={[styles.tldrVerdictRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.tldrVerdictLabel, { color: colors.mutedForeground }]}>AI 판단</Text>
            <Text style={[styles.tldrVerdictValue, { color: colors.primary }]}>{verdictStr}</Text>
          </View>
        )}

        {/* Plain verdict */}
        {json.plain_verdict && (
          <View style={[styles.tldrSection, { borderBottomColor: colors.border }]}>
            <Text style={[styles.tldrSubLabel, { color: colors.mutedForeground }]}>쉽게 말하면</Text>
            <Text style={[styles.tldrText, { color: colors.foreground }]}>{json.plain_verdict}</Text>
          </View>
        )}

        {/* Key issue */}
        {json.key_issue && (
          <View style={[styles.tldrSection, styles.tldrKeyIssue, { borderBottomColor: colors.border, backgroundColor: "#fef3c7" }]}>
            <Text style={[styles.tldrSubLabel, { color: "#d97706" }]}>핵심 이슈</Text>
            <Text style={[styles.tldrText, { color: "#92400e" }]}>{json.key_issue}</Text>
          </View>
        )}

        {/* Investment thesis summary */}
        {json.summary && (
          <View style={[styles.tldrSection, { backgroundColor: colors.accent }]}>
            <Text style={[styles.tldrSubLabel, { color: colors.mutedForeground }]}>투자 논거</Text>
            <Text style={[styles.tldrMuted, { color: colors.mutedForeground }]}>{json.summary}</Text>
          </View>
        )}
      </Card>
    </View>
  );
}

// ── Scenario Card ─────────────────────────────────────────────────────────────

function ScenarioCard({ analysis }: { analysis: any }) {
  const colors = useColors();
  const stratStep = analysis.steps?.find((s: any) => s.stepKey === "investment_strategy");
  const json = stratStep ? extractJson(stratStep.content) : null;
  if (!json?.scenarios?.length) return null;

  const currency: "KRW" | "USD" = isUSTicker(analysis.ticker) ? "USD" : "KRW";

  const caseConfig: Record<string, { label: string; sub: string; accent: string; bar: string; leftBorder: string }> = {
    Bull: { label: "▲ Bull", sub: "낙관 전망", accent: "#16a34a", bar: "#22c55e", leftBorder: "#22c55e" },
    Base: { label: "— Base", sub: "기본 전망", accent: "#2563eb", bar: "#3b82f6", leftBorder: "#3b82f6" },
    Bear: { label: "▼ Bear", sub: "비관 전망", accent: "#dc2626", bar: "#f87171", leftBorder: "#f87171" },
  };

  const ordered = (["Bull", "Base", "Bear"] as const)
    .map((c) => json.scenarios.find((s: any) => s.case === c))
    .filter(Boolean);

  if (ordered.length < 2) return null;

  return (
    <View style={styles.sectionWrap}>
      <SectionLabel text="시나리오 분석 — Bull · Base · Bear" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {ordered.map((s: any, idx: number) => {
          const cfg = caseConfig[s.case as keyof typeof caseConfig];
          if (!cfg) return null;
          const uStr = String(s.upside ?? "");
          const uNum = parseFloat(uStr.replace(/[^0-9.\-]/g, ""));
          const uDisplay = !isNaN(uNum) ? (uNum >= 0 ? "+" : "") + uNum.toFixed(1) + "%" : uStr;
          const pStr = String(s.probability ?? "");
          const pNum = parseFloat(pStr.replace(/[^0-9.]/g, ""));
          const pct = isNaN(pNum) ? 0 : Math.min(pNum, 100);
          return (
            <View
              key={s.case}
              style={[
                styles.scenarioRow,
                { borderBottomColor: colors.border },
                idx === ordered.length - 1 && { borderBottomWidth: 0 },
                { borderLeftColor: cfg.leftBorder },
              ]}
            >
              {/* Label */}
              <View style={styles.scenarioLabel}>
                <Text style={[styles.scenarioCaseText, { color: cfg.accent }]}>{cfg.label}</Text>
                <Text style={[styles.scenarioSub, { color: colors.mutedForeground }]}>{cfg.sub}</Text>
              </View>

              {/* Price + upside */}
              <View style={styles.scenarioPrice}>
                <Text style={[styles.scenarioPriceText, { color: colors.foreground }]}>
                  {fmtPrice(s.target_price, currency)}
                </Text>
                <Text style={[styles.scenarioUpside, { color: uNum >= 0 ? "#16a34a" : "#dc2626" }]}>
                  {uDisplay}
                </Text>
              </View>

              {/* Prob bar */}
              <View style={styles.scenarioProb}>
                <View style={styles.scenarioProbHeader}>
                  <Text style={[styles.scenarioProbLabel, { color: colors.mutedForeground }]}>확률</Text>
                  <Text style={[styles.scenarioProbValue, { color: colors.foreground }]}>
                    {!isNaN(pNum) ? pNum + "%" : pStr}
                  </Text>
                </View>
                <View style={[styles.probBarTrack, { backgroundColor: colors.border }]}>
                  <View style={[styles.probBarFill, { width: `${pct}%` as any, backgroundColor: cfg.bar }]} />
                </View>
              </View>
            </View>
          );
        })}

        {/* Assumption footnotes */}
        {ordered.some((s: any) => s.assumption) && (
          <View style={[styles.scenarioFootnotes, { borderTopColor: colors.border, backgroundColor: colors.accent }]}>
            {ordered.map((s: any) => {
              if (!s.assumption) return null;
              const cfg = caseConfig[s.case as keyof typeof caseConfig];
              return (
                <View key={s.case + "-note"} style={styles.assumptionRow}>
                  <Text style={[styles.assumptionLabel, { color: cfg?.accent }]}>{s.case}</Text>
                  <Text style={[styles.assumptionText, { color: colors.mutedForeground }]}>{s.assumption}</Text>
                </View>
              );
            })}
          </View>
        )}
      </Card>
    </View>
  );
}

// ── Peer Multiples Panel ──────────────────────────────────────────────────────

interface PeerMultiples {
  name: string; marketCap: number | null; pbr: number | null;
  per_trailing: number | null; per_fwd: number | null;
  ev_ebitda: number | null; ev_sales: number | null;
  roe: number | null; operating_margin: number | null;
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
  const avg = data?.averages;

  const METRICS = [
    { key: "per_trailing" as keyof PeerMultiples, label: "PER" },
    { key: "pbr" as keyof PeerMultiples, label: "PBR" },
    { key: "ev_ebitda" as keyof PeerMultiples, label: "EV/EBITDA" },
    { key: "roe" as keyof PeerMultiples, label: "ROE" },
  ];

  return (
    <View style={styles.sectionWrap}>
      <SectionLabel text="피어 멀티플 실측 데이터" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <TouchableOpacity
          onPress={() => setExpanded((e) => !e)}
          activeOpacity={0.7}
          style={[styles.panelHeader, { borderBottomColor: colors.border, borderBottomWidth: expanded ? StyleSheet.hairlineWidth : 0 }]}
        >
          <View style={styles.panelHeaderLeft}>
            <Feather name="bar-chart-2" size={15} color="#3b82f6" />
            <Text style={[styles.panelTitle, { color: colors.foreground }]}>피어 비교</Text>
            {loading && <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginLeft: 6 }} />}
            {!loading && data && (
              <View style={styles.peerCountBadge}>
                <Text style={styles.peerCountText}>{rows.length}개 피어</Text>
              </View>
            )}
          </View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

        {expanded && !loading && data && (
          <View style={{ paddingHorizontal: 14, paddingBottom: 14 }}>
            {/* Metric summary row for averages */}
            {avg && (
              <View style={[styles.avgRow, { backgroundColor: colors.accent, borderRadius: 10, marginTop: 12 }]}>
                <Text style={[styles.avgTitle, { color: colors.mutedForeground }]}>섹터 평균</Text>
                <View style={styles.avgMetrics}>
                  {METRICS.map((m) => (
                    <View key={m.key} style={styles.avgMetricItem}>
                      <Text style={[styles.avgMetricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                      <Text style={[styles.avgMetricValue, { color: colors.foreground }]}>
                        {fmtNum(avg[m.key] as number | null, 1)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Peer rows */}
            {rows.map(([peerTicker, peer], idx) => (
              <View
                key={peerTicker}
                style={[styles.peerRow, { borderBottomColor: colors.border, borderBottomWidth: idx < rows.length - 1 ? StyleSheet.hairlineWidth : 0 }]}
              >
                <View style={styles.peerLeft}>
                  <Text style={[styles.peerName, { color: colors.foreground }]} numberOfLines={1}>{peer.name || peerTicker}</Text>
                  <Text style={[styles.peerTicker, { color: colors.mutedForeground }]}>{peerTicker}</Text>
                  {peer.marketCap != null && (
                    <Text style={[styles.peerMC, { color: colors.mutedForeground }]}>시총 {fmtMC(peer.marketCap)}</Text>
                  )}
                </View>
                <View style={styles.peerMetrics}>
                  {METRICS.map((m) => (
                    <View key={m.key} style={styles.peerMetricItem}>
                      <Text style={[styles.peerMetricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                      <Text style={[styles.peerMetricValue, { color: colors.foreground }]}>
                        {fmtNum(peer[m.key] as number | null, 1)}
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

// ── Analyst Consensus Panel ───────────────────────────────────────────────────

interface AnalystConsensus {
  strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; total: number;
  recommendationKey: string | null; currency: string;
  targetLowPrice: number | null; targetMeanPrice: number | null; targetHighPrice: number | null;
  firmTargets: { firm: string; target: number; grade: string; date: string }[];
}

function AnalystConsensusPanel({ ticker, currentPrice }: { ticker: string; currentPrice?: number | null }) {
  const colors = useColors();
  const [info, setInfo] = useState<AnalystConsensus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    apiFetch<AnalystConsensus>(`/api/market-data/analyst-consensus?ticker=${encodeURIComponent(ticker)}`)
      .then((d) => { setInfo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!loading && !info) return null;

  const buyCount = (info?.strongBuy ?? 0) + (info?.buy ?? 0);
  const holdCount = info?.hold ?? 0;
  const sellCount = (info?.sell ?? 0) + (info?.strongSell ?? 0);
  const total = info?.total || 1;
  const buyPct = Math.round((buyCount / total) * 100);
  const holdPct = Math.round((holdCount / total) * 100);
  const sellPct = 100 - buyPct - holdPct;

  const keyLabel: Record<string, { label: string; color: string }> = {
    strong_buy: { label: "강력매수", color: "#16a34a" },
    buy: { label: "매수", color: "#22c55e" },
    hold: { label: "중립", color: "#f59e0b" },
    sell: { label: "매도", color: "#f87171" },
    strong_sell: { label: "강력매도", color: "#dc2626" },
  };
  const consensus = keyLabel[info?.recommendationKey ?? ""] ?? { label: info?.recommendationKey ?? "", color: colors.mutedForeground };

  const currency = info?.currency === "USD" ? "USD" : "KRW";
  const firmTargets = (info?.firmTargets ?? []).slice(0, 8);

  const mean = info?.targetMeanPrice;
  const upside = mean && currentPrice && currentPrice > 0 ? ((mean - currentPrice) / currentPrice) * 100 : null;

  return (
    <View style={styles.sectionWrap}>
      <SectionLabel text="애널리스트 컨센서스" />
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <TouchableOpacity
          onPress={() => setExpanded((e) => !e)}
          activeOpacity={0.7}
          style={[styles.panelHeader, { borderBottomColor: colors.border, borderBottomWidth: expanded ? StyleSheet.hairlineWidth : 0 }]}
        >
          <View style={styles.panelHeaderLeft}>
            <Feather name="users" size={15} color="#8b5cf6" />
            <Text style={[styles.panelTitle, { color: colors.foreground }]}>애널리스트</Text>
            {loading && <ActivityIndicator size="small" color={colors.mutedForeground} style={{ marginLeft: 6 }} />}
            {!loading && info && (
              <View style={[styles.peerCountBadge, { backgroundColor: "#ede9fe" }]}>
                <Text style={[styles.peerCountText, { color: "#6d28d9" }]}>{info.total}명</Text>
              </View>
            )}
            {!loading && info && consensus.label && (
              <Text style={[styles.consensusKey, { color: consensus.color }]}>{consensus.label}</Text>
            )}
          </View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>

        {expanded && !loading && info && (
          <View style={{ padding: 14, gap: 14 }}>
            {/* Target price summary */}
            <View style={[styles.consensusTargetRow, { backgroundColor: colors.accent, borderRadius: 10 }]}>
              {info.targetLowPrice != null && (
                <View style={styles.consensusTargetItem}>
                  <Text style={[styles.consensusTargetLabel, { color: colors.mutedForeground }]}>하단</Text>
                  <Text style={[styles.consensusTargetValue, { color: colors.down }]}>
                    {fmtPrice(info.targetLowPrice, currency as any)}
                  </Text>
                </View>
              )}
              {info.targetMeanPrice != null && (
                <View style={styles.consensusTargetItem}>
                  <Text style={[styles.consensusTargetLabel, { color: colors.mutedForeground }]}>평균</Text>
                  <Text style={[styles.consensusTargetValue, { color: colors.foreground }]}>
                    {fmtPrice(info.targetMeanPrice, currency as any)}
                  </Text>
                  {upside != null && (
                    <Text style={[styles.consensusUpside, { color: upside >= 0 ? colors.up : colors.down }]}>
                      {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                    </Text>
                  )}
                </View>
              )}
              {info.targetHighPrice != null && (
                <View style={styles.consensusTargetItem}>
                  <Text style={[styles.consensusTargetLabel, { color: colors.mutedForeground }]}>상단</Text>
                  <Text style={[styles.consensusTargetValue, { color: colors.up }]}>
                    {fmtPrice(info.targetHighPrice, currency as any)}
                  </Text>
                </View>
              )}
            </View>

            {/* Stacked bar */}
            {info.total > 0 && (
              <View style={{ gap: 8 }}>
                <View style={styles.consensusBarRow}>
                  {buyPct > 0 && (
                    <View style={[styles.consensusBarSegment, { width: `${buyPct}%` as any, backgroundColor: "#22c55e", borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }]} />
                  )}
                  {holdPct > 0 && (
                    <View style={[styles.consensusBarSegment, { width: `${holdPct}%` as any, backgroundColor: "#f59e0b" }]} />
                  )}
                  {sellPct > 0 && (
                    <View style={[styles.consensusBarSegment, { width: `${sellPct}%` as any, backgroundColor: "#f87171", borderTopRightRadius: 4, borderBottomRightRadius: 4 }]} />
                  )}
                </View>
                <View style={styles.consensusLegendRow}>
                  <Text style={[styles.consensusLegend, { color: "#16a34a" }]}>매수 {buyCount}명 ({buyPct}%)</Text>
                  <Text style={[styles.consensusLegend, { color: "#d97706" }]}>중립 {holdCount}명 ({holdPct}%)</Text>
                  <Text style={[styles.consensusLegend, { color: "#dc2626" }]}>매도 {sellCount}명 ({sellPct}%)</Text>
                </View>
              </View>
            )}

            {/* Firm targets */}
            {firmTargets.length > 0 && (
              <View style={{ gap: 6 }}>
                <Text style={[styles.firmTargetsTitle, { color: colors.mutedForeground }]}>기관별 목표주가</Text>
                {firmTargets.map((f, i) => (
                  <View key={i} style={[styles.firmRow, { borderBottomColor: colors.border, borderBottomWidth: i < firmTargets.length - 1 ? StyleSheet.hairlineWidth : 0 }]}>
                    <Text style={[styles.firmName, { color: colors.foreground }]} numberOfLines={1}>{f.firm}</Text>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <Text style={[styles.firmTarget, { color: colors.foreground }]}>
                        {fmtPrice(f.target, currency as any)}
                      </Text>
                      {f.grade && (
                        <Text style={[styles.firmGrade, { color: colors.mutedForeground }]}>{f.grade}</Text>
                      )}
                    </View>
                  </View>
                ))}
              </View>
            )}
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

// ── Agent Steps ───────────────────────────────────────────────────────────────

function AgentStepsSection({ analysis }: { analysis: any }) {
  const colors = useColors();
  const steps: any[] = analysis.steps ?? [];
  if (steps.length === 0) return null;

  return (
    <View style={styles.sectionWrap}>
      <SectionLabel text="AI 에이전트 분석" />
      <View style={{ gap: 10 }}>
        {steps.map((step) => {
          // Parse JSON out of content to get display text only
          let displayContent = step.content ?? "";
          // Remove leading JSON block if it exists, show text after it
          const jsonEndIdx = (() => {
            const si = displayContent.indexOf("{");
            if (si === -1) return -1;
            let d = 0; let ins = false; let esc = false;
            for (let i = si; i < displayContent.length; i++) {
              const ch = displayContent[i];
              if (esc) { esc = false; continue; }
              if (ch === "\\" && ins) { esc = true; continue; }
              if (ch === '"') { ins = !ins; continue; }
              if (ins) continue;
              if (ch === "{") d++;
              else if (ch === "}") { d--; if (d === 0) return i + 1; }
            }
            return -1;
          })();
          if (jsonEndIdx > 0 && displayContent.indexOf("{") < 200) {
            displayContent = displayContent.slice(jsonEndIdx).trim();
          }

          return (
            <Card key={step.id}>
              <View style={styles.stepHeader}>
                <Text style={[styles.stepTitle, { color: colors.primary }]}>
                  {STEP_LABELS[step.stepKey] ?? step.stepKey}
                </Text>
                <View style={[styles.infoBadge, { backgroundColor: (INFO_COLORS[step.informationType] ?? colors.mutedForeground) + "22" }]}>
                  <Text style={[styles.infoBadgeText, { color: INFO_COLORS[step.informationType] ?? colors.mutedForeground }]}>
                    {INFO_LABELS[step.informationType] ?? step.informationType}
                  </Text>
                </View>
              </View>
              <Text style={[styles.agentName, { color: colors.mutedForeground }]}>
                {step.agentName} · {step.agentRole}
              </Text>
              <Text style={[styles.stepContent, { color: colors.foreground }]}>
                {displayContent || step.content}
              </Text>
              {step.validationNotes && (
                <View style={[styles.validationBox, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                  <Text style={[styles.validationLabel, { color: colors.mutedForeground }]}>검증 노트</Text>
                  <Text style={[styles.validationText, { color: colors.mutedForeground }]}>{step.validationNotes}</Text>
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: analysis, isLoading, error } = useGetAnalysis(Number(id));

  const [quote, setQuote] = useState<{ price: number | null; change: number | null; currency: string } | null>(null);

  useEffect(() => {
    if (!analysis?.ticker) return;
    apiFetch<Record<string, any>>("/api/market-data/batch-quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [analysis.ticker] }),
    })
      .then((res) => {
        const q = res[analysis.ticker];
        if (q) setQuote(q);
      })
      .catch(() => {});
  }, [analysis?.ticker]);

  const botPad = Platform.OS === "web" ? 34 : insets.bottom + 24;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[{ color: colors.mutedForeground, fontSize: 13, marginTop: 10 }]}>분석 보고서 로딩 중…</Text>
      </View>
    );
  }

  if (error || !analysis) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center", gap: 12 }]}>
        <Feather name="alert-circle" size={36} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>분석을 불러오지 못했어요</Text>
      </View>
    );
  }

  const currentPrice = quote?.price ?? (analysis as any).startPrice ?? null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: botPad, gap: 0 }}
      showsVerticalScrollIndicator={false}
    >
      {/* 1. Header */}
      <HeaderCard analysis={analysis} quote={quote} />

      {/* 2. TL;DR */}
      <TldrCard analysis={analysis} />

      {/* 3. Scenarios */}
      <ScenarioCard analysis={analysis} />

      {/* 4. Peer Multiples */}
      <PeerMultiplesPanel ticker={analysis.ticker} />

      {/* 5. Analyst Consensus */}
      <AnalystConsensusPanel ticker={analysis.ticker} currentPrice={currentPrice} />

      {/* 6. AI Agent Steps */}
      <AgentStepsSection analysis={analysis} />

      {/* Disclaimer */}
      <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
        본 보고서는 AI가 생성한 정보로, 투자 권유가 아닙니다. 최종 투자 결정은 투자자 본인에게 있습니다.
      </Text>
    </ScrollView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  errorText: { fontSize: 15 },

  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  sectionWrap: { marginTop: 16, paddingHorizontal: 16 },
  sectionLabel: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },

  // Header
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  companyName: { fontSize: 20, fontWeight: "700", fontFamily: "Pretendard-Bold" },
  ticker: { fontSize: 13 },
  verdictBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  verdictBadgeLarge: { paddingHorizontal: 12, paddingVertical: 6 },
  verdictText: { fontSize: 13, fontWeight: "700", fontFamily: "Pretendard-Bold" },
  verdictTextLarge: { fontSize: 14 },

  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  livePrice: { fontSize: 22, fontWeight: "700", fontFamily: "Pretendard-Bold" },
  liveChange: { fontSize: 14, fontWeight: "600" },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  priceRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  priceItem: { alignItems: "center", gap: 4 },
  priceLabel: { fontSize: 11 },
  priceValue: { fontSize: 15, fontWeight: "600", fontFamily: "Pretendard-SemiBold" },

  // TL;DR
  tldrVerdictRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tldrVerdictLabel: { fontSize: 11, fontWeight: "600" },
  tldrVerdictValue: { fontSize: 14, fontWeight: "700", fontFamily: "Pretendard-Bold" },
  tldrSection: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
    marginHorizontal: -14,
    paddingHorizontal: 14,
  },
  tldrKeyIssue: {},
  tldrSubLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  tldrText: { fontSize: 14, lineHeight: 21, fontWeight: "500" },
  tldrMuted: { fontSize: 13, lineHeight: 20 },

  // Scenarios
  scenarioRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    gap: 10,
  },
  scenarioLabel: { width: 68 },
  scenarioCaseText: { fontSize: 12, fontWeight: "700" },
  scenarioSub: { fontSize: 10, marginTop: 2 },
  scenarioPrice: { flex: 1 },
  scenarioPriceText: { fontSize: 14, fontWeight: "700", fontFamily: "Pretendard-Bold" },
  scenarioUpside: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  scenarioProb: { width: 68 },
  scenarioProbHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  scenarioProbLabel: { fontSize: 10 },
  scenarioProbValue: { fontSize: 11, fontWeight: "700" },
  probBarTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  probBarFill: { height: "100%", borderRadius: 3 },
  scenarioFootnotes: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  assumptionRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  assumptionLabel: { fontSize: 10, fontWeight: "700", width: 34, paddingTop: 1 },
  assumptionText: { flex: 1, fontSize: 11, lineHeight: 16 },

  // Panel shared
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  panelHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  panelTitle: { fontSize: 14, fontWeight: "600", fontFamily: "Pretendard-SemiBold" },
  peerCountBadge: { backgroundColor: "#dbeafe", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  peerCountText: { fontSize: 10, fontWeight: "700", color: "#1d4ed8" },
  consensusKey: { fontSize: 12, fontWeight: "700" },

  // Peer
  avgRow: { padding: 12, gap: 8 },
  avgTitle: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  avgMetrics: { flexDirection: "row", gap: 0 },
  avgMetricItem: { flex: 1, alignItems: "center", gap: 2 },
  avgMetricLabel: { fontSize: 10 },
  avgMetricValue: { fontSize: 13, fontWeight: "700" },
  peerRow: { paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  peerLeft: { flex: 1, gap: 2 },
  peerName: { fontSize: 13, fontWeight: "600" },
  peerTicker: { fontSize: 10 },
  peerMC: { fontSize: 10 },
  peerMetrics: { flexDirection: "row", gap: 0 },
  peerMetricItem: { width: 52, alignItems: "center", gap: 2 },
  peerMetricLabel: { fontSize: 9 },
  peerMetricValue: { fontSize: 12, fontWeight: "600" },

  // Analyst
  consensusTargetRow: { flexDirection: "row", padding: 12, gap: 0 },
  consensusTargetItem: { flex: 1, alignItems: "center", gap: 4 },
  consensusTargetLabel: { fontSize: 10 },
  consensusTargetValue: { fontSize: 14, fontWeight: "700" },
  consensusUpside: { fontSize: 11, fontWeight: "600" },
  consensusBarRow: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: "#f1f5f9" },
  consensusBarSegment: { height: "100%" },
  consensusLegendRow: { flexDirection: "row", justifyContent: "space-between" },
  consensusLegend: { fontSize: 10, fontWeight: "600" },
  firmTargetsTitle: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  firmRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, gap: 8 },
  firmName: { flex: 1, fontSize: 13 },
  firmTarget: { fontSize: 13, fontWeight: "700" },
  firmGrade: { fontSize: 10 },

  // Steps
  stepHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  stepTitle: { fontSize: 13, fontWeight: "700", fontFamily: "Pretendard-Bold" },
  infoBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  infoBadgeText: { fontSize: 10, fontWeight: "600" },
  agentName: { fontSize: 11 },
  stepContent: { fontSize: 14, lineHeight: 22 },
  validationBox: { marginTop: 4, padding: 10, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, gap: 4 },
  validationLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  validationText: { fontSize: 12, lineHeight: 18 },

  disclaimer: { fontSize: 11, lineHeight: 17, textAlign: "center", margin: 16, marginTop: 24 },
});
