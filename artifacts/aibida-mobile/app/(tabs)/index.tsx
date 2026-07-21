import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, Platform, TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/hooks/useApi";
import { SkeletonCard } from "@/components/SkeletonCard";

// ─── Types (web-parity) ─────────────────────────────────────────────────────

interface MarketIndex { close?: number; change?: number; changePercent?: number; label?: string; }
interface MarketEvent { title: string; impact: "positive" | "negative" | "neutral"; description?: string; direction?: string; }
interface SectorTrend { sector: string; trend: string; change?: number; }
interface MacroFactor { factor?: string; status?: string; implication?: string; }
interface ForwardLookItem { point?: string; detail?: string; watchFor?: string; }
interface UpcomingEvent { date?: string; event?: string; title?: string; description?: string; }
interface KeyTopic { keyword?: string; description?: string; }

interface MarketBrief {
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  leadParagraph?: string;
  storyLine?: string;
  keyTopics?: Array<string | KeyTopic>;
  marketEvents?: MarketEvent[];
  indices?: Record<string, MarketIndex>;
  sectorTrends?: SectorTrend[];
  macroFactors?: Array<string | MacroFactor>;
  forwardLook?: Array<string | ForwardLookItem>;
  actionPoints?: string[];
  keyRisk?: string;
  upcomingMacroEvents?: UpcomingEvent[];
}

interface SessionSlot {
  slot: string; label: string; icon: string; time: string;
  brief: MarketBrief | null;
  generatedAt: number | null;
  status: "available" | "generating" | "upcoming" | "past";
  isActive: boolean; isPast?: boolean;
}

interface SessionsResponse {
  date: string; sessions: SessionSlot[];
  currentSession: string; currentSlot: string; generating: boolean;
}

// ETF
interface UnifiedSignal {
  code: string; name: string; sector: string; issuer: string; leverage: number;
  price: number; change1d: number; return5d: number; rsi14: number;
  combinedScore: number; signal: string; reason: string;
}
interface IndexOutlook {
  name: string; symbol: string; trend: string;
  predictedReturn3d: number | null; agreementSignal: "up" | "down" | "neutral";
  agreementStrength: number; latestPrice: number | null; change1d: number | null;
}
interface SectorMomentum {
  id: string; name: string; icon: string; score: number;
  outlook: "bullish" | "neutral" | "cautious"; horizon: string; reason: string;
}
interface InstitutionalFlow { sector: string; direction: "in" | "out" | "watch"; reason: string; strength: number; }
interface MarketPulse {
  fearGreedScore: number; fearGreedLabel: string;
  overallSentiment: "bullish" | "neutral" | "bearish";
  institutionalFlow: InstitutionalFlow[];
  retailWarning: string[];
  marketNarrative: string;
}
interface MomentumAnalysis {
  marketPulse: MarketPulse;
  nowSectors: SectorMomentum[];
  futureSectors?: SectorMomentum[];
  indexOutlook?: { kospi: IndexOutlook; kosdaq: IndexOutlook; ready: boolean; };
}

// Calendar
interface EarningsEntry {
  ticker: string; companyName: string; earningsDate: string;
  epsEstimate: number | null; currency: string; isKorean: boolean; isCompleted?: boolean;
}
interface EconomicEvent {
  date: string; time?: string; title: string; country: string;
  importance: "high" | "medium" | "low"; forecast?: string; previous?: string; unit?: string;
}

// ─── 감성 설정 ─────────────────────────────────────────────────────────────

function sentimentCfg(s?: string): { label: string; color: string; bg: string } {
  switch (s) {
    case "bullish": return { label: "상승", color: "#ef4444", bg: "#ef444420" };
    case "bearish":  return { label: "하락", color: "#3b82f6", bg: "#3b82f620" };
    case "mixed":    return { label: "혼조", color: "#f59e0b", bg: "#f59e0b20" };
    default:         return { label: "보합", color: "#94a3b8", bg: "#94a3b820" };
  }
}

function fmtPct(v?: number) {
  if (v == null) return "--";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

const SESSION_ICON: Record<string, string> = {
  sunrise: "🌅", chart: "📊", sunset: "🔔", moon: "🌙",
};

// ─── SessionCard ────────────────────────────────────────────────────────────

function SessionCard({ session, selected, onPress, colors }: {
  session: SessionSlot; selected: boolean; onPress: () => void; colors: any;
}) {
  const sc = sentimentCfg(session.brief?.sentiment);
  const available = session.status === "available" && session.brief;
  const isGen = session.status === "generating";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{
        width: "48%", borderRadius: 14, padding: 14, gap: 6,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors.primary + "12" : colors.card,
        opacity: pressed ? 0.75 : 1,
      }]}
    >
      {session.isActive && (
        <View style={{ position: "absolute", top: 10, right: 10, width: 7, height: 7, borderRadius: 4, backgroundColor: "#f59e0b" }} />
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Text style={{ fontSize: 14 }}>{SESSION_ICON[session.icon] ?? "📋"}</Text>
        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground }} numberOfLines={1}>{session.label}</Text>
      </View>
      <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: colors.mutedForeground + "99" }}>
        {session.time === "주말" ? "토·일 수시 업데이트" : `${session.time} KST`}
      </Text>

      {available ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: sc.color }} />
            <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: sc.color }}>{sc.label}</Text>
          </View>
          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.mutedForeground, lineHeight: 16 }} numberOfLines={3}>
            {session.brief!.summary}
          </Text>
        </>
      ) : isGen ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          {[1, 0.7, 0.5].map((op, i) => (
            <View key={i} style={{ height: 5, borderRadius: 3, backgroundColor: colors.border, opacity: op }} />
          ))}
          <Text style={{ fontSize: 10, color: "#f59e0b", fontFamily: "Inter_400Regular", marginTop: 2 }}>생성 중…</Text>
        </View>
      ) : session.status === "past" ? (
        <Text style={{ fontSize: 11, color: colors.border, fontFamily: "Inter_400Regular", marginTop: 2 }}>브리핑 없음</Text>
      ) : (
        <Text style={{ fontSize: 11, color: colors.border, fontFamily: "Inter_400Regular", marginTop: 2 }}>준비중</Text>
      )}
    </Pressable>
  );
}

// ─── 섹션 레이블 ─────────────────────────────────────────────────────────────

function SL({ label, colors }: { label: string; colors: any }) {
  return (
    <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 8 }}>
      {label}
    </Text>
  );
}

// ─── BriefDetail ─────────────────────────────────────────────────────────────

function BriefDetail({ session, colors }: { session: SessionSlot; colors: any }) {
  const brief = session.brief;

  if (session.status === "generating") {
    return (
      <View style={{ alignItems: "center", paddingVertical: 28, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#f59e0b" }} />
          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#f59e0b" }}>브리핑 생성 중</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          AI가 현재 시장 데이터를 분석하고 있습니다
        </Text>
        {[1, 0.7, 0.5].map((op, i) => (
          <View key={i} style={{ height: 8, borderRadius: 4, backgroundColor: colors.border, opacity: op, width: "80%", marginTop: i === 0 ? 8 : 0 }} />
        ))}
      </View>
    );
  }

  if (!brief) {
    return (
      <View style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          {session.isPast
            ? "이 시간대에 브리핑이 생성되지 않았습니다"
            : `${session.label} 브리핑은 ${session.time} KST 이후 자동 생성됩니다`}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 20 }}>
      {/* 요약 */}
      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: colors.foreground, lineHeight: 22 }}>{brief.summary}</Text>

      {/* 리드 단락 */}
      {brief.leadParagraph && (
        <View style={{ borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 12 }}>
          <Text style={{ fontSize: 13, color: colors.foreground + "CC", fontFamily: "Inter_400Regular", lineHeight: 21 }}>{brief.leadParagraph}</Text>
        </View>
      )}

      {/* 스토리라인 */}
      {brief.storyLine && (
        <View style={{ gap: 6 }}>
          <SL label="심층 분석" colors={colors} />
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 21 }}>{brief.storyLine}</Text>
        </View>
      )}

      {/* 지수 현황 */}
      {brief.indices && Object.keys(brief.indices).length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="지수 현황" colors={colors} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {Object.entries(brief.indices)
              .filter(([, v]) => v.changePercent != null || v.close != null)
              .map(([name, v]) => (
                <View key={name} style={{ backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minWidth: "45%" }}>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 2 }} numberOfLines={1}>{v.label ?? name}</Text>
                  {v.close != null && (
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{v.close.toLocaleString("ko-KR")}</Text>
                  )}
                  {v.changePercent != null && (
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (v.changePercent ?? 0) >= 0 ? colors.up : colors.down }}>
                      {fmtPct(v.changePercent)}
                    </Text>
                  )}
                </View>
              ))}
          </View>
        </View>
      )}

      {/* 주요 테마 */}
      {brief.keyTopics && brief.keyTopics.length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="주요 테마" colors={colors} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {brief.keyTopics.map((t, i) => {
              const label = typeof t === "string" ? t : ((t as KeyTopic).keyword ?? "");
              if (!label) return null;
              return (
                <View key={`kt-${i}`} style={{ backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.foreground + "CC" }}>{label}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 시장 이슈 */}
      {brief.marketEvents && brief.marketEvents.length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="시장 이슈" colors={colors} />
          {brief.marketEvents.map((e, i) => {
            const dir = (e as any).direction ?? e.impact;
            const isPos = dir === "positive"; const isNeg = dir === "negative";
            return (
              <View key={`me-${i}`} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: isPos ? colors.up : isNeg ? colors.down : colors.border, marginTop: 1 }}>
                  {isPos ? "▲" : isNeg ? "▼" : "●"}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, lineHeight: 19 }}>{e.title}</Text>
                  {((e as any).impact_desc || e.description) && (
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 }}>
                      {(e as any).impact_desc ?? e.description}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* 섹터 동향 */}
      {brief.sectorTrends && brief.sectorTrends.length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="섹터 동향" colors={colors} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {brief.sectorTrends.map((s) => {
              const isUp = (s.change ?? 0) > 0 || s.trend === "상승" || s.trend === "강세";
              const isDn = (s.change ?? 0) < 0 || s.trend === "하락" || s.trend === "약세";
              return (
                <View key={s.sector} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minWidth: "47%" }}>
                  <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_400Regular" }} numberOfLines={1}>{s.sector}</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: isUp ? colors.up : isDn ? colors.down : colors.mutedForeground, marginLeft: 6 }}>
                    {s.change != null ? fmtPct(s.change) : s.trend}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* 거시 환경 */}
      {brief.macroFactors && brief.macroFactors.length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="거시 환경" colors={colors} />
          {brief.macroFactors.map((f, i) => {
            if (typeof f === "string") {
              return (
                <View key={`mf-${i}`} style={{ flexDirection: "row", gap: 8 }}>
                  <Text style={{ color: colors.border, marginTop: 2 }}>•</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 }}>{f}</Text>
                </View>
              );
            }
            const mf = f as MacroFactor;
            return (
              <View key={`mf-${i}`} style={{ backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{mf.factor}</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{mf.status}</Text>
                </View>
                {mf.implication && <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 17 }}>{mf.implication}</Text>}
              </View>
            );
          })}
        </View>
      )}

      {/* 향후 전망 */}
      {brief.forwardLook && brief.forwardLook.length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="향후 전망" colors={colors} />
          {brief.forwardLook.map((f, i) => {
            if (typeof f === "string") {
              return (
                <View key={`fl-${i}`} style={{ flexDirection: "row", gap: 8 }}>
                  <Text style={{ color: colors.border, marginTop: 2 }}>•</Text>
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 }}>{f}</Text>
                </View>
              );
            }
            const fl = f as ForwardLookItem;
            return (
              <View key={`fl-${i}`} style={{ backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 3 }}>{fl.point}</Text>
                {fl.detail && <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 17 }}>{fl.detail}</Text>}
                {fl.watchFor && <Text style={{ fontSize: 11, color: "#f59e0b", fontFamily: "Inter_400Regular", marginTop: 4 }}>📌 {fl.watchFor}</Text>}
              </View>
            );
          })}
        </View>
      )}

      {/* 투자 포인트 */}
      {brief.actionPoints && brief.actionPoints.length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="투자 포인트" colors={colors} />
          {brief.actionPoints.map((a, i) => (
            <View key={`ap-${i}`} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <Text style={{ fontSize: 12, color: "#f59e0b", fontFamily: "Inter_700Bold", marginTop: 1 }}>→</Text>
              <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 }}>
                {typeof a === "string" ? a : JSON.stringify(a)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* 핵심 리스크 */}
      {brief.keyRisk && (
        <View style={{ backgroundColor: "#1e3a5f", borderWidth: 1, borderColor: "#1e40af60", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 4 }}>
          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#60a5fa", letterSpacing: 1.2, textTransform: "uppercase" }}>핵심 리스크</Text>
          <Text style={{ fontSize: 12, color: colors.foreground + "CC", fontFamily: "Inter_400Regular", lineHeight: 18 }}>{brief.keyRisk}</Text>
        </View>
      )}

      {/* 주요 일정 */}
      {brief.upcomingMacroEvents && brief.upcomingMacroEvents.length > 0 && (
        <View style={{ gap: 8 }}>
          <SL label="주요 일정" colors={colors} />
          {brief.upcomingMacroEvents.map((ev, i) => {
            const title = ev.title ?? ev.event ?? "";
            return (
              <View key={`ue-${i}`} style={{ flexDirection: "row", gap: 12 }}>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", width: 72 }}>{ev.date}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_400Regular" }}>{title}</Text>
                  {ev.description && <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 2 }}>{ev.description}</Text>}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── HistoryItem ─────────────────────────────────────────────────────────────

const SESSION_TYPE_LABEL: Record<string, string> = {
  pre_open: "장전", morning: "개장", midday: "장중 1차", afternoon: "장중 2차",
  pre_close: "마감 전", closing: "장마감", evening: "야간",
  us_premarket: "개장 전", us_open: "장중 1차", us_midday: "장중 2차",
  us_afterhours: "마감 후", premarket: "개장 전", open: "장중 1차", close: "마감 후",
};

function HistoryItem({ item, colors }: { item: any; colors: any }) {
  const [open, setOpen] = useState(false);
  const sc = sentimentCfg(item.sentiment);
  const sessionLabel = SESSION_TYPE_LABEL[item.sessionType] ?? item.sessionType ?? "브리핑";
  const timeStr = new Date(item.generatedAt).toLocaleString("ko-KR", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const fakeSlot: SessionSlot = {
    slot: item.sessionType, label: sessionLabel, icon: "chart", time: "--",
    brief: item.data, generatedAt: new Date(item.generatedAt).getTime(),
    status: "available", isActive: false,
  };
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden", marginBottom: 8 }}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        style={({ pressed }) => [{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 14, paddingVertical: 12,
          backgroundColor: pressed ? colors.muted : colors.card,
        }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: sc.color }} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground }}>{sessionLabel}</Text>
          {item.summary && (
            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", flex: 1 }} numberOfLines={1}>
              — {item.summary.slice(0, 50)}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{timeStr}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{open ? "▲" : "▾"}</Text>
        </View>
      </Pressable>
      {open && item.data && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
          <BriefDetail session={fakeSlot} colors={colors} />
        </View>
      )}
    </View>
  );
}

// ─── 개요 탭 ──────────────────────────────────────────────────────────────────

function OverviewTab({ market, colors, insets }: { market: "kr" | "us"; colors: any; insets: any }) {
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const { data: sessionsData, isLoading, isRefetching, refetch, error } = useQuery<SessionsResponse>({
    queryKey: ["market-analysis-sessions", market],
    queryFn: () => apiFetch<SessionsResponse>(`/api/market-analysis/sessions?market=${market}`),
    staleTime: 3 * 60 * 1000,
    retry: 1,
  });

  const sessions = sessionsData?.sessions ?? [];

  // 자동 선택 로직 (웹과 동일)
  const resolvedSlot = (() => {
    if (selectedSlot && sessions.find(s => s.slot === selectedSlot)?.brief) return selectedSlot;
    const active = sessions.find(s => s.isActive && s.brief);
    if (active) return active.slot;
    const latest = [...sessions].reverse().find(s => s.brief);
    if (latest) return latest.slot;
    return sessionsData?.currentSlot ?? sessions[0]?.slot ?? null;
  })();

  const selectedSession = sessions.find(s => s.slot === resolvedSlot);
  const sc = sentimentCfg(selectedSession?.brief?.sentiment);

  const dateLabel = sessionsData?.date
    ? new Date(sessionsData.date + "T00:00:00+09:00").toLocaleDateString("ko-KR", {
        year: "numeric", month: "long", day: "numeric", weekday: "short",
      })
    : "";

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const d = await apiFetch<any[]>(`/api/market-analysis/brief-history?market=${market}&limit=8`);
      setHistory(Array.isArray(d) ? d : []);
    } catch { } finally { setHistoryLoading(false); }
  }, [market]);

  // 마켓 변경 시 초기화
  useEffect(() => {
    setSelectedSlot(null);
    setHistory([]);
    setHistoryOpen(false);
  }, [market]);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80, paddingTop: 4 }}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
      showsVerticalScrollIndicator={false}
    >
      {dateLabel ? (
        <Text style={{ fontSize: 11, color: colors.mutedForeground, textAlign: "center", marginBottom: 12, fontFamily: "Inter_400Regular" }}>{dateLabel}</Text>
      ) : null}

      {/* Session Timeline */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
          오늘의 시장 흐름
        </Text>

        {isLoading ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
            {[0, 1, 2, 3].map(i => <SkeletonCard key={i} height={120} width="48%" />)}
          </View>
        ) : error ? (
          <View style={{ alignItems: "center", paddingVertical: 32, gap: 10 }}>
            <Feather name="alert-circle" size={24} color={colors.border} />
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>데이터를 불러오지 못했습니다</Text>
            <TouchableOpacity onPress={() => refetch()}>
              <Text style={{ fontSize: 12, color: colors.primary }}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" }}>
            {sessions.map(session => (
              <SessionCard
                key={session.slot} session={session} colors={colors}
                selected={resolvedSlot === session.slot}
                onPress={() => setSelectedSlot(s => s === session.slot ? null : session.slot)}
              />
            ))}
          </View>
        )}
      </View>

      {/* Selected Brief Detail */}
      {selectedSession && !isLoading && (
        <View style={[styles.briefCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
          {/* 브리핑 헤더 */}
          <View style={[styles.briefCardHeader, { borderBottomColor: colors.border }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Text style={{ fontSize: 16 }}>{SESSION_ICON[selectedSession.icon] ?? "📋"}</Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{selectedSession.label}</Text>
              <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                {selectedSession.time === "주말" ? "" : `${selectedSession.time} KST`}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {selectedSession.generatedAt && (
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  {new Date(selectedSession.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 생성
                </Text>
              )}
              {selectedSession.brief?.sentiment && (
                <View style={{ backgroundColor: sc.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: sc.color }}>{sc.label}</Text>
                </View>
              )}
            </View>
          </View>

          {/* 브리핑 본문 */}
          <View style={{ padding: 16 }}>
            <BriefDetail session={selectedSession} colors={colors} />
          </View>
        </View>
      )}

      {/* 브리핑 히스토리 */}
      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <TouchableOpacity
          onPress={() => {
            if (!historyOpen && history.length === 0) fetchHistory();
            setHistoryOpen(o => !o);
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 }}
        >
          <Text style={{ fontSize: 10, color: historyOpen ? colors.foreground : colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            {historyOpen ? "▼" : "▶"}
          </Text>
          <Text style={{ fontSize: 12, color: historyOpen ? colors.foreground : colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            지난 브리핑
          </Text>
        </TouchableOpacity>

        {historyOpen && (
          <View style={{ marginTop: 4 }}>
            {historyLoading ? (
              <View style={{ gap: 8 }}>
                {[0, 1, 2].map(i => <SkeletonCard key={i} height={52} />)}
              </View>
            ) : history.length === 0 ? (
              <Text style={{ fontSize: 12, color: colors.border, fontFamily: "Inter_400Regular", paddingVertical: 12 }}>
                저장된 브리핑이 없습니다
              </Text>
            ) : (
              history.map((item, i) => <HistoryItem key={i} item={item} colors={colors} />)
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

// ─── ETF 공통 유틸 ────────────────────────────────────────────────────────────

function fearGreedColor(score: number) {
  if (score <= 25) return "#3b82f6";
  if (score <= 45) return "#f59e0b";
  if (score <= 55) return "#94a3b8";
  if (score <= 75) return "#22c55e";
  return "#ef4444";
}

const SIGNAL_CFG: Record<string, { label: string; color: string; bg: string }> = {
  strong_buy:  { label: "강력매수", color: "#16a34a", bg: "#16a34a20" },
  buy:         { label: "매수",     color: "#22c55e", bg: "#22c55e20" },
  hold:        { label: "보유",     color: "#94a3b8", bg: "#94a3b820" },
  sell:        { label: "매도",     color: "#f59e0b", bg: "#f59e0b20" },
  strong_sell: { label: "강력매도", color: "#ef4444", bg: "#ef444420" },
};

const OUTLOOK_CFG: Record<string, { label: string; color: string }> = {
  bullish:  { label: "상승",  color: "#16a34a" },
  neutral:  { label: "중립",  color: "#94a3b8" },
  cautious: { label: "주의",  color: "#f59e0b" },
};

// ─── ETF 탭 ──────────────────────────────────────────────────────────────────

// 집중 종목
interface FlowStock { code: string; name: string; etfCount: number; totalWeight: number; avgWeight: number; etfs: string[]; }
interface ThemeBreakdown { key: string; label: string; emoji: string; etfCount: number; totalEtfs: number; score: number; }
interface FundFlowData {
  krTopStocks: FlowStock[]; usTopStocks: FlowStock[];
  themeBreakdown: ThemeBreakdown[];
  coverageStats: { krEtfCount: number; usEtfCount: number };
  updatedAt: string;
}

// 리밸런싱
interface RebalStock { ticker: string; name: string; region: string; etfs: string[]; delta?: number; }
interface SectorMove { sector: string; direction: "up" | "down" | "neutral"; etfCount: number; prevCount: number; }
interface TopHolding { ticker: string; name: string; region: string; etfCount: number; totalWeight: number; etfs: string[]; }
interface RebalancingData {
  etfsAnalyzed: number; etfsWithChanges: number; hasChanges: boolean; updatedAt: string;
  newEntries: RebalStock[]; exits: RebalStock[]; bigBuys: RebalStock[]; bigSells: RebalStock[];
  sectorMoves: SectorMove[]; topHoldings: TopHolding[];
}

// 검색
interface ETFInfo { code: string; name: string; sector: string; issuer: string; leverage: number; }
interface ETFHolding { rank: number; stockCode: string; stockName: string; weight: number; weightChange?: number; }
interface ETFExposureItem { etf: ETFInfo; holding: ETFHolding; }

const POPULAR_ETFS: { label: string; items: { code: string; name: string }[] }[] = [
  { label: "국내 대표", items: [{ code: "069500", name: "KODEX 200" }, { code: "229200", name: "코스닥150" }, { code: "102110", name: "TIGER KOSPI" }] },
  { label: "반도체·AI", items: [{ code: "091160", name: "KODEX 반도체" }, { code: "395160", name: "AI반도체TOP2+" }, { code: "SOXX", name: "SOXX" }, { code: "SMH", name: "SMH" }] },
  { label: "2차전지·헬스케어", items: [{ code: "305720", name: "KODEX 2차전지" }, { code: "266420", name: "KODEX 헬스케어" }] },
  { label: "미국 시장", items: [{ code: "SPY", name: "SPY S&P500" }, { code: "QQQ", name: "QQQ 나스닥100" }, { code: "IWM", name: "IWM 러셀2000" }, { code: "ITA", name: "ITA 방산" }] },
  { label: "기관투자자", items: [{ code: "NPS", name: "국민연금 국내주식" }, { code: "NPSINT", name: "국민연금 미국주식" }] },
];

function ETFTab({ colors, insets }: { colors: any; insets: any }) {
  const [etfSubTab, setEtfSubTab] = useState<"search" | "rebalancing" | "fundflow">("search");

  // ── 검색 탭 상태 ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"etf" | "stock">("etf");
  const [selectedEtf, setSelectedEtf] = useState<ETFInfo | null>(null);
  const [holdings, setHoldings] = useState<ETFHolding[]>([]);
  const [exposure, setExposure] = useState<ETFExposureItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ETFInfo[]>([]);

  // ── 리밸런싱 탭 상태 ──
  const [rebalData, setRebalData] = useState<RebalancingData | null>(null);
  const [rebalLoading, setRebalLoading] = useState(false);
  const [rebalLoaded, setRebalLoaded] = useState(false);

  // ── 집중 종목 탭 상태 ──
  const [fundFlow, setFundFlow] = useState<FundFlowData | null>(null);
  const [fundFlowLoading, setFundFlowLoading] = useState(false);
  const [fundFlowLoaded, setFundFlowLoaded] = useState(false);
  const [flowPanel, setFlowPanel] = useState<"kr" | "us">("kr");

  // ── 검색: ETF 보유 종목 조회 ──
  const loadEtfHoldings = useCallback((code: string, name: string) => {
    setSelectedEtf({ code, name, sector: "", issuer: "", leverage: 1 });
    setHoldings([]); setExposure([]);
    setSearchLoading(true);
    apiFetch<any>(`/api/etf/${encodeURIComponent(code)}/holdings`)
      .then(d => setHoldings(Array.isArray(d) ? d : (d.holdings ?? [])))
      .catch(() => {})
      .finally(() => setSearchLoading(false));
  }, []);

  // ── 검색: 종목이 담긴 ETF 조회 ──
  const loadStockExposure = useCallback((query: string) => {
    if (!query.trim()) return;
    setSelectedEtf(null); setHoldings([]);
    setSearchLoading(true);
    apiFetch<any>(`/api/etf/stock/${encodeURIComponent(query.trim())}/exposure`)
      .then(d => setExposure(Array.isArray(d) ? d : (d.items ?? [])))
      .catch(() => {})
      .finally(() => setSearchLoading(false));
  }, []);

  // ── 리밸런싱 로드 ──
  const loadRebal = useCallback(() => {
    if (rebalLoading) return;
    setRebalLoading(true);
    apiFetch<RebalancingData>("/api/etf/rebalancing")
      .then(d => { setRebalData(d); setRebalLoaded(true); })
      .catch(() => setRebalLoaded(true))
      .finally(() => setRebalLoading(false));
  }, [rebalLoading]);

  // ── 집중 종목 로드 ──
  const loadFundFlow = useCallback(() => {
    if (fundFlowLoading) return;
    setFundFlowLoading(true);
    apiFetch<FundFlowData>("/api/etf/fund-flow")
      .then(d => { setFundFlow(d); setFundFlowLoaded(true); })
      .catch(() => setFundFlowLoaded(true))
      .finally(() => setFundFlowLoading(false));
  }, [fundFlowLoading]);

  useEffect(() => {
    if (etfSubTab === "rebalancing" && !rebalLoaded && !rebalLoading) loadRebal();
    if (etfSubTab === "fundflow" && !fundFlowLoaded && !fundFlowLoading) loadFundFlow();
  }, [etfSubTab, rebalLoaded, rebalLoading, fundFlowLoaded, fundFlowLoading, loadRebal, loadFundFlow]);

  const pb = (Platform.OS === "web" ? 84 : insets.bottom) + 80;

  return (
    <View style={{ flex: 1 }}>
      {/* 서브탭 */}
      <View style={{ flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {([["search", "검색"], ["rebalancing", "리밸런싱"], ["fundflow", "집중 종목"]] as const).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: etfSubTab === key ? colors.primary : "transparent" }}
            onPress={() => setEtfSubTab(key)}
          >
            <Text style={{ fontSize: 12, fontFamily: etfSubTab === key ? "Inter_600SemiBold" : "Inter_400Regular", color: etfSubTab === key ? colors.primary : colors.mutedForeground }}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── 검색 탭 ── */}
      {etfSubTab === "search" && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: pb }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* 모드 토글 */}
          <View style={{ flexDirection: "row", margin: 14, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
            {(["etf", "stock"] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={{ flex: 1, paddingVertical: 9, alignItems: "center", backgroundColor: searchMode === m ? colors.primary : "transparent" }}
                onPress={() => { setSearchMode(m); setSearchQuery(""); setSelectedEtf(null); setHoldings([]); setExposure([]); }}
              >
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: searchMode === m ? "#fff" : colors.mutedForeground }}>
                  {m === "etf" ? "ETF 보유 종목" : "종목 담은 ETF"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 검색 입력 */}
          <View style={{ flexDirection: "row", marginHorizontal: 14, marginBottom: 14, gap: 8, alignItems: "center" }}>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 12 }}>
              <Feather name="search" size={14} color={colors.mutedForeground} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={searchMode === "etf" ? "ETF 코드 또는 이름 (예: 069500)" : "종목 코드 또는 이름 (예: 삼성전자)"}
                placeholderTextColor={colors.mutedForeground}
                style={{ flex: 1, fontSize: 13, color: colors.foreground, paddingVertical: 9, paddingLeft: 8 }}
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (searchMode === "etf") loadEtfHoldings(searchQuery, searchQuery);
                  else loadStockExposure(searchQuery);
                }}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchQuery(""); setSelectedEtf(null); setHoldings([]); setExposure([]); }}>
                  <Feather name="x" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity
              style={{ backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 }}
              onPress={() => {
                if (searchMode === "etf") loadEtfHoldings(searchQuery, searchQuery);
                else loadStockExposure(searchQuery);
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>검색</Text>
            </TouchableOpacity>
          </View>

          {/* 인기 ETF 칩 (ETF 모드이고 검색 결과 없을 때) */}
          {searchMode === "etf" && !selectedEtf && exposure.length === 0 && (
            <View style={{ paddingHorizontal: 14, gap: 14 }}>
              {POPULAR_ETFS.map(group => (
                <View key={group.label} style={{ gap: 8 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase" }}>{group.label}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {group.items.map(etf => (
                      <TouchableOpacity
                        key={etf.code}
                        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                        onPress={() => { setSearchQuery(etf.code); loadEtfHoldings(etf.code, etf.name); }}
                      >
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{etf.code}</Text>
                        <Text style={{ fontSize: 10, color: colors.mutedForeground }}>{etf.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 로딩 */}
          {searchLoading && (
            <View style={{ padding: 16, gap: 10 }}>
              {[0,1,2,3,4].map(i => <SkeletonCard key={i} height={60} />)}
            </View>
          )}

          {/* ETF 보유 종목 결과 */}
          {!searchLoading && selectedEtf && holdings.length > 0 && (
            <View style={{ paddingHorizontal: 14 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 10 }}>
                {selectedEtf.code} 보유 종목 ({holdings.length}개)
              </Text>
              {holdings.map((h, idx) => (
                <View key={h.stockCode} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: colors.primary, width: 22 }}>{h.rank ?? idx + 1}</Text>
                    <View>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{h.stockName}</Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{h.stockCode}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{h.weight.toFixed(2)}%</Text>
                    {h.weightChange != null && h.weightChange !== 0 && (
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: h.weightChange > 0 ? colors.up : colors.down }}>
                        {h.weightChange > 0 ? "▲" : "▼"} {Math.abs(h.weightChange).toFixed(2)}%p
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 종목이 담긴 ETF 결과 */}
          {!searchLoading && searchMode === "stock" && exposure.length > 0 && (
            <View style={{ paddingHorizontal: 14 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 10 }}>
                '{searchQuery}' 포함 ETF ({exposure.length}개)
              </Text>
              {exposure.map((item, idx) => (
                <View key={item.etf.code + idx} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{item.etf.code}</Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground }} numberOfLines={1}>{item.etf.name}</Text>
                    {item.etf.sector ? <Text style={{ fontSize: 10, color: colors.mutedForeground + "88" }}>{item.etf.sector}</Text> : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{item.holding.weight.toFixed(2)}%</Text>
                    <Text style={{ fontSize: 10, color: colors.mutedForeground }}>비중 {item.holding.rank}위</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* 빈 결과 */}
          {!searchLoading && selectedEtf && holdings.length === 0 && (
            <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
              <Feather name="inbox" size={28} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>보유 종목 정보 없음</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* ── 리밸런싱 탭 ── */}
      {etfSubTab === "rebalancing" && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: pb }}
          refreshControl={<RefreshControl refreshing={rebalLoading} onRefresh={loadRebal} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {rebalLoading && !rebalData ? (
            <View style={{ padding: 16, gap: 12 }}>
              {[0,1,2,3].map(i => <SkeletonCard key={i} height={90} />)}
            </View>
          ) : !rebalData ? (
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 12 }}>
              <Feather name="refresh-cw" size={28} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>리밸런싱 데이터를 불러오지 못했습니다</Text>
              <TouchableOpacity onPress={loadRebal}><Text style={{ fontSize: 12, color: colors.primary }}>다시 시도</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              {/* 요약 헤더 */}
              <View style={{ margin: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14, gap: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground }}>ETF 리밸런싱 현황</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                    {(() => { try { return new Date(rebalData.updatedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return rebalData.updatedAt; } })()}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {[
                    { label: "분석 ETF", value: rebalData.etfsAnalyzed },
                    { label: "변화 있음", value: rebalData.etfsWithChanges },
                    { label: "신규 편입", value: rebalData.newEntries.length },
                    { label: "제외 종목", value: rebalData.exits.length },
                  ].map(stat => (
                    <View key={stat.label} style={{ flex: 1, alignItems: "center", backgroundColor: colors.muted, borderRadius: 10, paddingVertical: 8 }}>
                      <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.foreground }}>{stat.value}</Text>
                      <Text style={{ fontSize: 9, color: colors.mutedForeground, marginTop: 2 }}>{stat.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* 리밸런싱 섹션 공통 렌더러 */}
              {([
                { key: "newEntries", label: "신규 편입", emoji: "🆕", data: rebalData.newEntries, color: colors.up },
                { key: "exits", label: "제외 종목", emoji: "🚪", data: rebalData.exits, color: colors.down },
                { key: "bigBuys", label: "비중 확대", emoji: "📈", data: rebalData.bigBuys, color: "#22c55e" },
                { key: "bigSells", label: "비중 축소", emoji: "📉", data: rebalData.bigSells, color: "#ef4444" },
              ] as const).filter(s => (s.data as RebalStock[]).length > 0).map(section => (
                <View key={section.key} style={{ marginHorizontal: 14, marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 8 }}>
                    {section.emoji} {section.label} ({(section.data as RebalStock[]).length}개)
                  </Text>
                  <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" }}>
                    {(section.data as RebalStock[]).slice(0, 8).map((stock, idx) => (
                      <View key={stock.ticker + idx} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: idx < (section.data as RebalStock[]).slice(0,8).length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{stock.ticker}</Text>
                            <View style={{ backgroundColor: stock.region === "KR" ? "#3b82f615" : "#f9731615", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                              <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: stock.region === "KR" ? "#3b82f6" : "#f97316" }}>{stock.region}</Text>
                            </View>
                          </View>
                          {stock.name ? <Text style={{ fontSize: 11, color: colors.mutedForeground }} numberOfLines={1}>{stock.name}</Text> : null}
                          <Text style={{ fontSize: 10, color: colors.mutedForeground + "88" }} numberOfLines={1}>{stock.etfs.join(" · ")}</Text>
                        </View>
                        {stock.delta != null && (
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: section.color }}>
                            {stock.delta > 0 ? "+" : ""}{stock.delta.toFixed(1)}%p
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              ))}

              {/* 섹터 변화 */}
              {rebalData.sectorMoves.length > 0 && (
                <View style={{ marginHorizontal: 14, marginBottom: 14 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 8 }}>🏭 섹터 변화</Text>
                  <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" }}>
                    {rebalData.sectorMoves.map((sm, idx) => (
                      <View key={sm.sector} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: idx < rebalData.sectorMoves.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{sm.sector}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{sm.prevCount} → {sm.etfCount}개 ETF</Text>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: sm.direction === "up" ? colors.up : sm.direction === "down" ? colors.down : colors.mutedForeground }}>
                            {sm.direction === "up" ? "▲" : sm.direction === "down" ? "▼" : "→"}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* 변화 없음 */}
              {!rebalData.hasChanges && (
                <View style={{ alignItems: "center", paddingVertical: 30, gap: 8 }}>
                  <Text style={{ fontSize: 13, color: colors.mutedForeground }}>최근 리밸런싱 변화 없음</Text>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* ── 집중 종목 탭 ── */}
      {etfSubTab === "fundflow" && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: pb }}
          refreshControl={<RefreshControl refreshing={fundFlowLoading} onRefresh={loadFundFlow} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {fundFlowLoading && !fundFlow ? (
            <View style={{ padding: 16, gap: 12 }}>
              <SkeletonCard height={120} />
              {[0,1,2,3,4].map(i => <SkeletonCard key={i} height={72} />)}
            </View>
          ) : !fundFlow ? (
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 12 }}>
              <Feather name="layers" size={28} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>데이터를 불러오지 못했습니다</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground + "99" }}>처음 로드 시 20~30초 소요될 수 있습니다</Text>
              <TouchableOpacity onPress={loadFundFlow}><Text style={{ fontSize: 12, color: colors.primary }}>다시 시도</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              {/* 헤더 */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  {fundFlow.coverageStats.krEtfCount + fundFlow.coverageStats.usEtfCount}개 ETF 집계
                  <Text style={{ color: colors.border + "99" }}>  ·  </Text>
                  {(() => { try { return new Date(fundFlow.updatedAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return fundFlow.updatedAt; } })()}
                </Text>
                <TouchableOpacity onPress={loadFundFlow} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Feather name="refresh-cw" size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>새로고침</Text>
                </TouchableOpacity>
              </View>

              {/* 섹터 온도 */}
              {fundFlow.themeBreakdown?.length > 0 && (
                <View style={{ marginHorizontal: 16, marginBottom: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: colors.mutedForeground, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>지금 어떤 섹터가 뜨거운가</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {fundFlow.themeBreakdown.map(t => {
                      const heat = t.score >= 75 ? "🔥" : t.score >= 40 ? "📈" : "❄️";
                      const isHot = t.score >= 75; const isWarm = t.score >= 40;
                      const chipBg = isHot ? "#6366f115" : isWarm ? "#22c55e15" : colors.muted;
                      const chipBorder = isHot ? "#6366f140" : isWarm ? "#22c55e40" : colors.border;
                      const chipColor = isHot ? "#6366f1" : isWarm ? "#16a34a" : colors.mutedForeground;
                      return (
                        <View key={t.key} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, backgroundColor: chipBg, borderColor: chipBorder }}>
                          <Text style={{ fontSize: 12 }}>{heat}</Text>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: chipColor }}>{t.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* KR / US 패널 토글 */}
              <View style={{ flexDirection: "row", marginHorizontal: 16, marginBottom: 12, gap: 6, backgroundColor: colors.muted, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: colors.border }}>
                {(["kr", "us"] as const).map(p => (
                  <TouchableOpacity key={p} onPress={() => setFlowPanel(p)}
                    style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8, borderRadius: 10, backgroundColor: flowPanel === p ? colors.card : "transparent" }}>
                    <Text style={{ fontSize: 12 }}>{p === "kr" ? "🏛" : "🌐"}</Text>
                    <Text style={{ fontSize: 12, fontFamily: flowPanel === p ? "Inter_600SemiBold" : "Inter_400Regular", color: flowPanel === p ? colors.foreground : colors.mutedForeground }}>
                      {p === "kr" ? "국내 ETF 집중 종목" : "해외 ETF 집중 종목"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 종목 리스트 */}
              <View style={{ marginHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" }}>
                <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.muted }}>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    {flowPanel === "kr"
                      ? `국내 ${fundFlow.coverageStats.krEtfCount}개 ETF가 공통으로 많이 담고 있는 종목 순위`
                      : `해외 ${fundFlow.coverageStats.usEtfCount}개 ETF가 공통으로 많이 담고 있는 종목 순위`}
                  </Text>
                </View>
                {(flowPanel === "kr" ? fundFlow.krTopStocks : fundFlow.usTopStocks).map((stock, i) => {
                  const rankColor = i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#b45309" : colors.border;
                  return (
                    <View key={stock.code} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: i < (flowPanel === "kr" ? fundFlow.krTopStocks : fundFlow.usTopStocks).length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_900Black", color: rankColor, width: 20, textAlign: "center" }}>{i + 1}</Text>
                      <View style={{ flex: 1, gap: 5 }}>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{stock.name || stock.code}</Text>
                          <Text style={{ fontSize: 10, color: colors.border, fontFamily: "Inter_400Regular" }}>{stock.code}</Text>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                          {stock.etfs.slice(0, 4).map(e => (
                            <View key={e} style={{ backgroundColor: colors.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20 }}>
                              <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }} numberOfLines={1}>{e}</Text>
                            </View>
                          ))}
                          {stock.etfs.length > 4 && (
                            <View style={{ backgroundColor: colors.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20 }}>
                              <Text style={{ fontSize: 10, color: colors.mutedForeground + "88", fontFamily: "Inter_400Regular" }}>+{stock.etfs.length - 4}개 ETF</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 20, fontFamily: "Inter_900Black", color: colors.foreground, lineHeight: 24 }}>{stock.etfCount}</Text>
                        <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>개 ETF</Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={{ height: 16 }} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── 캘린더 탭 ────────────────────────────────────────────────────────────────

const IMP_COLOR: Record<string, string> = { high: "#ef4444", medium: "#f59e0b", low: "#94a3b8" };
const IMP_LABEL: Record<string, string> = { high: "핵심", medium: "주요", low: "참고" };

function CalendarTab({ colors, insets }: { colors: any; insets: any }) {
  const [calTab, setCalTab] = useState<"earnings" | "economic">("earnings");
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [economic, setEconomic] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      apiFetch<any>("/api/market-data/earnings-calendar"),
      apiFetch<any>("/api/market-data/economic-calendar"),
    ]).then(([e, ec]) => {
      if (e.status === "fulfilled") { const d = e.value; setEarnings(Array.isArray(d) ? d : (d.earnings ?? d.data ?? [])); }
      if (ec.status === "fulfilled") { const d = ec.value; setEconomic(Array.isArray(d) ? d : (d.events ?? d.data ?? [])); }
    }).finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  function fmtDate(d: string) {
    try {
      const dt = new Date(d); const isToday = d.slice(0, 10) === today;
      const dayKo = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
      return isToday ? `오늘 (${dt.getMonth() + 1}/${dt.getDate()})` : `${dt.getMonth() + 1}/${dt.getDate()} (${dayKo})`;
    } catch { return d; }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {([["earnings", "실적 발표"], ["economic", "경제 지표"]] as const).map(([key, label]) => (
          <TouchableOpacity key={key} style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: calTab === key ? colors.primary : "transparent" }} onPress={() => setCalTab(key)}>
            <Text style={{ fontSize: 13, fontFamily: calTab === key ? "Inter_600SemiBold" : "Inter_400Regular", color: calTab === key ? colors.primary : colors.mutedForeground }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}>
        {loading ? (
          <View style={{ padding: 16, gap: 10 }}>
            {[0, 1, 2, 3, 4].map(i => <SkeletonCard key={i} height={68} />)}
          </View>
        ) : calTab === "earnings" ? (
          earnings.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}><Feather name="calendar" size={28} color={colors.border} /><Text style={{ fontSize: 13, color: colors.mutedForeground }}>실적 발표 일정이 없습니다</Text></View>
          ) : earnings.slice(0, 50).map((e, i) => (
            <View key={`${e.ticker}-${i}`} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 10 }}>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{e.ticker}</Text>
                  <View style={{ backgroundColor: e.isKorean ? "#dbeafe" : "#fef9c3", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: e.isKorean ? "#2563eb" : "#b45309" }}>{e.isKorean ? "KR" : "US"}</Text>
                  </View>
                  {e.isCompleted && <View style={{ backgroundColor: "#dcfce7", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}><Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#16a34a" }}>완료</Text></View>}
                </View>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }} numberOfLines={1}>{e.companyName}</Text>
                {e.epsEstimate != null && <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>EPS 예상 {e.epsEstimate > 0 ? "+" : ""}{e.epsEstimate.toFixed(2)}</Text>}
              </View>
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground + "99" }}>{fmtDate(e.earningsDate)}</Text>
            </View>
          ))
        ) : (
          economic.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}><Feather name="bar-chart" size={28} color={colors.border} /><Text style={{ fontSize: 13, color: colors.mutedForeground }}>경제 지표 일정이 없습니다</Text></View>
          ) : economic.slice(0, 50).map((ev, i) => (
            <View key={`ec-${i}`} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 8 }}>
              <View style={{ width: 4, alignSelf: "stretch", backgroundColor: IMP_COLOR[ev.importance] ?? "#94a3b8", borderRadius: 2 }} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={{ backgroundColor: IMP_COLOR[ev.importance] + "22", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: IMP_COLOR[ev.importance] }}>{IMP_LABEL[ev.importance]}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{ev.country}</Text>
                </View>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: colors.foreground, lineHeight: 18 }}>{ev.title}</Text>
                {(ev.forecast || ev.previous) && (
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    {ev.forecast ? `예상 ${ev.forecast}` : ""}{ev.forecast && ev.previous ? " / " : ""}{ev.previous ? `이전 ${ev.previous}` : ""}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground + "99" }}>{fmtDate(ev.date)}</Text>
                {ev.time && <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{ev.time}</Text>}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

type MarketSubTab = "overview" | "calendar" | "etf";

export default function MarketScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [market, setMarket] = useState<"kr" | "us">("kr");
  const [subTab, setSubTab] = useState<MarketSubTab>("overview");
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const SUB_TABS: { key: MarketSubTab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { key: "overview",  label: "개요",   icon: "bar-chart-2" },
    { key: "calendar",  label: "캘린더", icon: "calendar"    },
    { key: "etf",       label: "ETF",    icon: "layers"      },
  ];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.primary }]}>애빛다</Text>
        {subTab === "overview" && (
          <View style={[styles.toggle, { backgroundColor: colors.muted }]}>
            {(["kr", "us"] as const).map(m => (
              <Pressable
                key={m}
                onPress={() => setMarket(m)}
                style={[styles.toggleBtn, { backgroundColor: market === m ? colors.primary : "transparent" }]}
              >
                <Text style={{ fontSize: 12, fontFamily: market === m ? "Inter_600SemiBold" : "Inter_400Regular", color: market === m ? "#fff" : colors.mutedForeground }}>
                  {m === "kr" ? "🇰🇷 한국" : "🇺🇸 미국"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* 서브탭 바 */}
      <View style={[styles.subTabBar, { borderBottomColor: colors.border }]}>
        {SUB_TABS.map(({ key: tabKey, label, icon }) => (
          <TouchableOpacity
            key={tabKey}
            style={[styles.subTabBtn, subTab === tabKey && { borderBottomColor: colors.primary }]}
            onPress={() => setSubTab(tabKey)}
          >
            <Feather name={icon} size={13} color={subTab === tabKey ? colors.primary : colors.mutedForeground} />
            <Text style={{ fontSize: 13, fontFamily: subTab === tabKey ? "Inter_600SemiBold" : "Inter_400Regular", color: subTab === tabKey ? colors.primary : colors.mutedForeground }}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 탭 콘텐츠 */}
      {subTab === "overview"  && <OverviewTab  market={market} colors={colors} insets={insets} />}
      {subTab === "calendar"  && <CalendarTab  colors={colors} insets={insets} />}
      {subTab === "etf"       && <ETFTab       colors={colors} insets={insets} />}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  toggle: { flexDirection: "row", borderRadius: 8, padding: 3 },
  toggleBtn: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  subTabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  subTabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  briefCard: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  briefCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  indexCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  pulseCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sectorCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
});
