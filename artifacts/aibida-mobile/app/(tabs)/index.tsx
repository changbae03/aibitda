import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, Platform, TextInput,
} from "react-native";
import Svg, { Polyline, Path, Circle, Line, Defs, LinearGradient as SvgLinearGradient, Stop } from "react-native-svg";
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
  epsEstimate: number | null; epsLow?: number | null; epsHigh?: number | null;
  epsActualPrev?: number | null; epsEstimatePrev?: number | null; epsSurprisePct?: number | null;
  revenueEstimate?: number | null; fiscalQuarterEnding?: string | null;
  analyticCount?: number | null; currency: string; isKorean: boolean; isCompleted?: boolean;
}
interface EconomicEvent {
  date: string; time?: string; title: string; country: string;
  importance: "high" | "medium" | "low"; forecast?: string; previous?: string; unit?: string;
}

// FRED 지표
interface IndicatorPoint { date: string; value: number; }
interface IndicatorSeries {
  id: string; name: string; nameEn: string; country: string;
  unit: string; category: string; frequency: "monthly" | "quarterly";
  data: IndicatorPoint[]; targetLine?: number; rangeLabel?: string;
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
        width: "48%", borderRadius: 16, padding: 13, gap: 5,
        backgroundColor: selected ? colors.primary + "0F" : colors.muted,
        borderWidth: selected ? 1.5 : 0,
        borderColor: selected ? colors.primary + "80" : "transparent",
        opacity: pressed ? 0.7 : 1,
      }]}
    >
      {session.isActive && (
        <View style={{ position: "absolute", top: 11, right: 11, width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} />
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <Text style={{ fontSize: 13 }}>{SESSION_ICON[session.icon] ?? "📋"}</Text>
        <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: selected ? colors.primary : colors.foreground }} numberOfLines={1}>{session.label}</Text>
      </View>
      <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>
        {session.time === "주말" ? "토·일 수시" : `${session.time} KST`}
      </Text>

      {available ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: sc.color }} />
            <Text style={{ fontSize: 10, fontFamily: "Pretendard-Bold", color: sc.color }}>{sc.label}</Text>
          </View>
          <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: colors.mutedForeground, lineHeight: 15 }} numberOfLines={2}>
            {session.brief!.summary}
          </Text>
        </>
      ) : isGen ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          {[1, 0.7, 0.5].map((op, i) => (
            <View key={i} style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, opacity: op }} />
          ))}
          <Text style={{ fontSize: 10, color: "#f59e0b", fontFamily: "Pretendard-Regular", marginTop: 2 }}>생성 중…</Text>
        </View>
      ) : session.status === "past" ? (
        <Text style={{ fontSize: 11, color: colors.mutedForeground + "60", fontFamily: "Pretendard-Regular", marginTop: 2 }}>브리핑 없음</Text>
      ) : (
        <Text style={{ fontSize: 11, color: colors.mutedForeground + "60", fontFamily: "Pretendard-Regular", marginTop: 2 }}>준비중</Text>
      )}
    </Pressable>
  );
}

// ─── 섹션 레이블 ─────────────────────────────────────────────────────────────

function SL({ label, colors }: { label: string; colors: any }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 10 }}>
      <View style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: colors.primary + "60" }} />
      <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: colors.mutedForeground, letterSpacing: 0.2 }}>
        {label}
      </Text>
    </View>
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
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: "#f59e0b" }}>브리핑 생성 중</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
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
        <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
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
      <Text style={{ fontSize: 14, fontFamily: "Pretendard-Medium", color: colors.foreground, lineHeight: 23 }}>{brief.summary}</Text>

      {/* 리드 단락 */}
      {brief.leadParagraph && (
        <View style={{ borderLeftWidth: 2.5, borderLeftColor: colors.primary + "50", paddingLeft: 13, paddingVertical: 2 }}>
          <Text style={{ fontSize: 13, color: colors.foreground + "CC", fontFamily: "Pretendard-Regular", lineHeight: 21 }}>{brief.leadParagraph}</Text>
        </View>
      )}

      {/* 스토리라인 */}
      {brief.storyLine && (
        <View style={{ gap: 6 }}>
          <SL label="심층 분석" colors={colors} />
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", lineHeight: 21 }}>{brief.storyLine}</Text>
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
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", marginBottom: 2 }} numberOfLines={1}>{v.label ?? name}</Text>
                  {v.close != null && (
                    <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{v.close.toLocaleString("ko-KR")}</Text>
                  )}
                  {v.changePercent != null && (
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: (v.changePercent ?? 0) >= 0 ? colors.up : colors.down }}>
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
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Regular", color: colors.foreground + "CC" }}>{label}</Text>
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
                <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: isPos ? colors.up : isNeg ? colors.down : colors.border, marginTop: 1 }}>
                  {isPos ? "▲" : isNeg ? "▼" : "●"}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Medium", color: colors.foreground, lineHeight: 19 }}>{e.title}</Text>
                  {((e as any).impact_desc || e.description) && (
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", lineHeight: 17, marginTop: 2 }}>
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
                  <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Pretendard-Regular" }} numberOfLines={1}>{s.sector}</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: isUp ? colors.up : isDn ? colors.down : colors.mutedForeground, marginLeft: 6 }}>
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
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 18 }}>{f}</Text>
                </View>
              );
            }
            const mf = f as MacroFactor;
            return (
              <View key={`mf-${i}`} style={{ backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{mf.factor}</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>{mf.status}</Text>
                </View>
                {mf.implication && <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", lineHeight: 17 }}>{mf.implication}</Text>}
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
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 18 }}>{f}</Text>
                </View>
              );
            }
            const fl = f as ForwardLookItem;
            return (
              <View key={`fl-${i}`} style={{ backgroundColor: colors.muted, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground, marginBottom: 3 }}>{fl.point}</Text>
                {fl.detail && <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", lineHeight: 17 }}>{fl.detail}</Text>}
                {fl.watchFor && <Text style={{ fontSize: 11, color: "#f59e0b", fontFamily: "Pretendard-Regular", marginTop: 4 }}>📌 {fl.watchFor}</Text>}
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
              <Text style={{ fontSize: 12, color: "#f59e0b", fontFamily: "Pretendard-Bold", marginTop: 1 }}>→</Text>
              <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Pretendard-Regular", flex: 1, lineHeight: 18 }}>
                {typeof a === "string" ? a : JSON.stringify(a)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* 핵심 리스크 */}
      {brief.keyRisk && (
        <View style={{ backgroundColor: colors.downBg, borderWidth: 1, borderColor: colors.down + "30", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.down }} />
            <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: colors.down }}>핵심 리스크</Text>
          </View>
          <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Pretendard-Regular", lineHeight: 19 }}>{brief.keyRisk}</Text>
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
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", width: 72 }}>{ev.date}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Pretendard-Regular" }}>{title}</Text>
                  {ev.description && <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", marginTop: 2 }}>{ev.description}</Text>}
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
    <View style={{ borderRadius: 14, backgroundColor: colors.muted, overflow: "hidden", marginBottom: 8 }}>
      <Pressable
        onPress={() => setOpen(o => !o)}
        style={({ pressed }) => [{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          paddingHorizontal: 14, paddingVertical: 13,
          opacity: pressed ? 0.7 : 1,
        }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: sc.color }} />
          <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{sessionLabel}</Text>
          {item.summary && (
            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", flex: 1 }} numberOfLines={1}>
              {item.summary.slice(0, 48)}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>{timeStr}</Text>
          <Feather name={open ? "chevron-up" : "chevron-down"} size={13} color={colors.mutedForeground} />
        </View>
      </Pressable>
      {open && item.data && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border + "60" }}>
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
      {/* Session Timeline */}
      <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>오늘의 시장 흐름</Text>
          {dateLabel ? <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>{dateLabel}</Text> : null}
        </View>

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
        <View style={{ marginHorizontal: 16, borderRadius: 18, backgroundColor: colors.muted, overflow: "hidden", marginBottom: 4 }}>
          {/* 브리핑 헤더 */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 13 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
              <Text style={{ fontSize: 15 }}>{SESSION_ICON[selectedSession.icon] ?? "📋"}</Text>
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{selectedSession.label}</Text>
              {selectedSession.time !== "주말" && (
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
                  {selectedSession.time} KST
                </Text>
              )}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {selectedSession.generatedAt && (
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
                  {new Date(selectedSession.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                </Text>
              )}
              {selectedSession.brief?.sentiment && (
                <View style={{ backgroundColor: sc.bg, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-Bold", color: sc.color }}>{sc.label}</Text>
                </View>
              )}
            </View>
          </View>

          {/* 구분선 */}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border + "60", marginHorizontal: 16 }} />

          {/* 브리핑 본문 */}
          <View style={{ padding: 16 }}>
            <BriefDetail session={selectedSession} colors={colors} />
          </View>
        </View>
      )}

      {/* 브리핑 히스토리 */}
      <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
        <TouchableOpacity
          onPress={() => {
            if (!historyOpen && history.length === 0) fetchHistory();
            setHistoryOpen(o => !o);
          }}
          style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 10 }}
        >
          <Feather name={historyOpen ? "chevron-down" : "chevron-right"} size={14} color={colors.mutedForeground} />
          <Text style={{ fontSize: 12, color: historyOpen ? colors.foreground : colors.mutedForeground, fontFamily: "Pretendard-Medium" }}>
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
              <Text style={{ fontSize: 12, color: colors.border, fontFamily: "Pretendard-Regular", paddingVertical: 12 }}>
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
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {([["search", "검색"], ["rebalancing", "리밸런싱"], ["fundflow", "집중 종목"]] as const).map(([key, label]) => (
          <Pressable
            key={key}
            style={({ pressed }) => [{
              paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20,
              backgroundColor: etfSubTab === key ? colors.primary + "12" : "transparent",
              opacity: pressed ? 0.7 : 1,
            }]}
            onPress={() => setEtfSubTab(key)}
          >
            <Text style={{ fontSize: 13, fontFamily: etfSubTab === key ? "Pretendard-SemiBold" : "Pretendard-Regular", color: etfSubTab === key ? colors.primary : colors.mutedForeground }}>
              {label}
            </Text>
          </Pressable>
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
          <View style={{ flexDirection: "row", margin: 14, marginBottom: 10, borderRadius: 12, backgroundColor: colors.muted, padding: 3 }}>
            {(["etf", "stock"] as const).map(m => (
              <Pressable
                key={m}
                style={({ pressed }) => [{
                  flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10,
                  backgroundColor: searchMode === m ? colors.card : "transparent",
                  opacity: pressed ? 0.8 : 1,
                }]}
                onPress={() => { setSearchMode(m); setSearchQuery(""); setSelectedEtf(null); setHoldings([]); setExposure([]); }}
              >
                <Text style={{ fontSize: 12, fontFamily: searchMode === m ? "Pretendard-SemiBold" : "Pretendard-Regular", color: searchMode === m ? colors.primary : colors.mutedForeground }}>
                  {m === "etf" ? "ETF 보유 종목" : "종목 담은 ETF"}
                </Text>
              </Pressable>
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
              <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: "#fff" }}>검색</Text>
            </TouchableOpacity>
          </View>

          {/* 인기 ETF 칩 (ETF 모드이고 검색 결과 없을 때) */}
          {searchMode === "etf" && !selectedEtf && exposure.length === 0 && (
            <View style={{ paddingHorizontal: 14, gap: 14 }}>
              {POPULAR_ETFS.map(group => (
                <View key={group.label} style={{ gap: 8 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Pretendard-Bold", color: colors.mutedForeground, letterSpacing: 1, textTransform: "uppercase" }}>{group.label}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {group.items.map(etf => (
                      <TouchableOpacity
                        key={etf.code}
                        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
                        onPress={() => { setSearchQuery(etf.code); loadEtfHoldings(etf.code, etf.name); }}
                      >
                        <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{etf.code}</Text>
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
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: colors.foreground, marginBottom: 10 }}>
                {selectedEtf.code} 보유 종목 ({holdings.length}개)
              </Text>
              {holdings.map((h, idx) => (
                <View key={h.stockCode} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Pretendard-Bold", color: colors.primary, width: 22 }}>{h.rank ?? idx + 1}</Text>
                    <View>
                      <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{h.stockName}</Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{h.stockCode}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{h.weight.toFixed(2)}%</Text>
                    {h.weightChange != null && h.weightChange !== 0 && (
                      <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: h.weightChange > 0 ? colors.up : colors.down }}>
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
              <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: colors.foreground, marginBottom: 10 }}>
                '{searchQuery}' 포함 ETF ({exposure.length}개)
              </Text>
              {exposure.map((item, idx) => (
                <View key={item.etf.code + idx} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{item.etf.code}</Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground }} numberOfLines={1}>{item.etf.name}</Text>
                    {item.etf.sector ? <Text style={{ fontSize: 10, color: colors.mutedForeground + "88" }}>{item.etf.sector}</Text> : null}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{item.holding.weight.toFixed(2)}%</Text>
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
                  <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: colors.foreground }}>ETF 리밸런싱 현황</Text>
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
                      <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{stat.value}</Text>
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
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Bold", color: colors.foreground, marginBottom: 8 }}>
                    {section.emoji} {section.label} ({(section.data as RebalStock[]).length}개)
                  </Text>
                  <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" }}>
                    {(section.data as RebalStock[]).slice(0, 8).map((stock, idx) => (
                      <View key={stock.ticker + idx} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: idx < (section.data as RebalStock[]).slice(0,8).length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{stock.ticker}</Text>
                            <View style={{ backgroundColor: stock.region === "KR" ? "#3b82f615" : "#f9731615", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                              <Text style={{ fontSize: 9, fontFamily: "Pretendard-SemiBold", color: stock.region === "KR" ? "#3b82f6" : "#f97316" }}>{stock.region}</Text>
                            </View>
                          </View>
                          {stock.name ? <Text style={{ fontSize: 11, color: colors.mutedForeground }} numberOfLines={1}>{stock.name}</Text> : null}
                          <Text style={{ fontSize: 10, color: colors.mutedForeground + "88" }} numberOfLines={1}>{stock.etfs.join(" · ")}</Text>
                        </View>
                        {stock.delta != null && (
                          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: section.color }}>
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
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-Bold", color: colors.foreground, marginBottom: 8 }}>🏭 섹터 변화</Text>
                  <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" }}>
                    {rebalData.sectorMoves.map((sm, idx) => (
                      <View key={sm.sector} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: idx < rebalData.sectorMoves.length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{sm.sector}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{sm.prevCount} → {sm.etfCount}개 ETF</Text>
                          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: sm.direction === "up" ? colors.up : sm.direction === "down" ? colors.down : colors.mutedForeground }}>
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
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
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
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-Bold", color: colors.mutedForeground, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>지금 어떤 섹터가 뜨거운가</Text>
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
                          <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: chipColor }}>{t.label}</Text>
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
                    <Text style={{ fontSize: 12, fontFamily: flowPanel === p ? "Pretendard-SemiBold" : "Pretendard-Regular", color: flowPanel === p ? colors.foreground : colors.mutedForeground }}>
                      {p === "kr" ? "국내 ETF 집중 종목" : "해외 ETF 집중 종목"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* 종목 리스트 */}
              <View style={{ marginHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: "hidden" }}>
                <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.muted }}>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
                    {flowPanel === "kr"
                      ? `국내 ${fundFlow.coverageStats.krEtfCount}개 ETF가 공통으로 많이 담고 있는 종목 순위`
                      : `해외 ${fundFlow.coverageStats.usEtfCount}개 ETF가 공통으로 많이 담고 있는 종목 순위`}
                  </Text>
                </View>
                {(flowPanel === "kr" ? fundFlow.krTopStocks : fundFlow.usTopStocks).map((stock, i) => {
                  const rankColor = i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#b45309" : colors.border;
                  return (
                    <View key={stock.code} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: i < (flowPanel === "kr" ? fundFlow.krTopStocks : fundFlow.usTopStocks).length - 1 ? StyleSheet.hairlineWidth : 0, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: rankColor, width: 20, textAlign: "center" }}>{i + 1}</Text>
                      <View style={{ flex: 1, gap: 5 }}>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                          <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{stock.name || stock.code}</Text>
                          <Text style={{ fontSize: 10, color: colors.border, fontFamily: "Pretendard-Regular" }}>{stock.code}</Text>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                          {stock.etfs.slice(0, 4).map(e => (
                            <View key={e} style={{ backgroundColor: colors.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20 }}>
                              <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }} numberOfLines={1}>{e}</Text>
                            </View>
                          ))}
                          {stock.etfs.length > 4 && (
                            <View style={{ backgroundColor: colors.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 20 }}>
                              <Text style={{ fontSize: 10, color: colors.mutedForeground + "88", fontFamily: "Pretendard-Regular" }}>+{stock.etfs.length - 4}개 ETF</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 20, fontFamily: "Pretendard-Bold", color: colors.foreground, lineHeight: 24 }}>{stock.etfCount}</Text>
                        <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>개 ETF</Text>
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
const COUNTRY_FLAG_IND: Record<string, string> = { US: "🇺🇸", KR: "🇰🇷", EU: "🇪🇺", CN: "🇨🇳", JP: "🇯🇵" };

// ── 지표 색상 테마 ──────────────────────────────────────────────────────────

function getIndicatorTheme(s: IndicatorSeries): { color: string; trend: "up" | "down" | "flat" } {
  const vals = s.data.map(d => d.value);
  if (vals.length < 2) return { color: "#6366f1", trend: "flat" };
  const last = vals[vals.length - 1]; const prev = vals[vals.length - 2];
  const trend: "up" | "down" | "flat" = Math.abs(last - prev) < 0.01 ? "flat" : last > prev ? "up" : "down";
  if (s.id === "fed-rate") return { color: "#6366f1", trend };
  if (s.id === "us-cpi" || s.id === "core-pce") {
    if (last <= 2.5) return { color: "#22c55e", trend };
    if (last <= 3.5) return { color: "#f59e0b", trend };
    return { color: trend === "down" ? "#f59e0b" : "#ef4444", trend };
  }
  if (s.id === "unemployment" || s.id === "kr-unemployment") {
    return last < 4.0 ? { color: "#22c55e", trend } : last < 5.0 ? { color: "#f59e0b", trend } : { color: "#ef4444", trend };
  }
  if (s.id === "us-gdp" || s.id === "kr-gdp") {
    return last >= 2.0 ? { color: "#22c55e", trend } : last >= 0 ? { color: "#f59e0b", trend } : { color: "#ef4444", trend };
  }
  return { color: "#6366f1", trend };
}

// ── 미니 스파크라인 (react-native-svg) ─────────────────────────────────────

function MobileSparkline({ data, color, targetLine, w = 90, h = 36 }: {
  data: number[]; color: string; targetLine?: number; w?: number; h?: number;
}) {
  if (data.length < 2) return <View style={{ width: w, height: h }} />;
  const pad = 3;
  const allVals = targetLine !== undefined ? [...data, targetLine] : data;
  const min = Math.min(...allVals); const max = Math.max(...allVals);
  const range = max - min || 1;
  const xScale = (i: number) => pad + (i / (data.length - 1)) * (w - pad * 2);
  const yScale = (v: number) => h - pad - ((v - min) / range) * (h - pad * 2);
  const pts = data.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(" ");
  const lastX = xScale(data.length - 1); const lastY = yScale(data[data.length - 1]);
  const areaD = [
    `M ${xScale(0).toFixed(1)},${yScale(data[0]).toFixed(1)}`,
    ...data.slice(1).map((v, i) => `L ${xScale(i + 1).toFixed(1)},${yScale(v).toFixed(1)}`),
    `L ${lastX.toFixed(1)},${h} L ${xScale(0).toFixed(1)},${h} Z`,
  ].join(" ");
  const uid = `sp-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Defs>
        <SvgLinearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <Stop offset="100%" stopColor={color} stopOpacity={0.01} />
        </SvgLinearGradient>
      </Defs>
      <Path d={areaD} fill={`url(#${uid})`} />
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {targetLine !== undefined && (
        <Line x1={pad} y1={yScale(targetLine)} x2={w - pad} y2={yScale(targetLine)} stroke={color} strokeWidth={0.8} strokeDasharray="3,2" opacity={0.35} />
      )}
      <Circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </Svg>
  );
}

// ── 지표 카드 ───────────────────────────────────────────────────────────────

function MobileIndicatorCard({ series, colors }: { series: IndicatorSeries; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const { color, trend } = useMemo(() => getIndicatorTheme(series), [series]);
  const vals = (series.data ?? []).map(d => d.value).filter(v => v != null && !isNaN(v));
  if (vals.length === 0) return null;
  const last = vals[vals.length - 1]; const prev = vals[vals.length - 2] ?? last;
  const delta = last - prev;
  const lastDate = series.data[series.data.length - 1]?.date ?? "";
  const dateLabel = lastDate.slice(0, 7);
  const trendArrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "–";

  return (
    <Pressable
      onPress={() => setExpanded(v => !v)}
      style={({ pressed }) => [{
        flex: 1, minWidth: "47%", maxWidth: "49%",
        backgroundColor: colors.card, borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
        padding: 11, overflow: "hidden", opacity: pressed ? 0.85 : 1,
      }]}
    >
      {/* 헤더: 국가 + 카테고리 */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 11 }}>{COUNTRY_FLAG_IND[series.country] ?? "🌐"}</Text>
          <View style={{ backgroundColor: color + "22", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
            <Text style={{ fontSize: 9, fontFamily: "Pretendard-Bold", color }}>{series.category}</Text>
          </View>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={11} color={colors.mutedForeground + "66"} />
      </View>

      {/* 지표명 */}
      <Text style={{ fontSize: 10, fontFamily: "Pretendard-Medium", color: colors.foreground + "99", marginBottom: 6, lineHeight: 13 }} numberOfLines={2}>
        {series.name}
      </Text>

      {/* 값 + 스파크라인 */}
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
        <View>
          {series.rangeLabel ? (
            <>
              <Text style={{ fontSize: 15, fontFamily: "Pretendard-Bold", color: colors.foreground, letterSpacing: -0.5 }}>{series.rangeLabel}</Text>
              <Text style={{ fontSize: 9, fontFamily: "Pretendard-Regular", color: colors.mutedForeground, marginTop: 1 }}>FOMC 레인지</Text>
            </>
          ) : (
            <>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 2 }}>
                <Text style={{ fontSize: 18, fontFamily: "Pretendard-Bold", color: colors.foreground, letterSpacing: -0.5 }}>
                  {last.toFixed(series.id === "us-gdp" || series.id === "kr-gdp" ? 1 : 2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>{series.unit}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color }}>{trendArrow} {delta >= 0 ? "+" : ""}{delta.toFixed(2)}</Text>
                <Text style={{ fontSize: 9, fontFamily: "Pretendard-Regular", color: colors.mutedForeground + "80" }}>{dateLabel}</Text>
              </View>
            </>
          )}
        </View>
        <MobileSparkline data={vals.slice(-18)} color={color} targetLine={series.targetLine} />
      </View>

      {/* 펼쳤을 때: 최근 히스토리 */}
      {expanded && (
        <View style={{ marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8, gap: 4 }}>
          {[...series.data].reverse().slice(0, 6).map((row, i, arr) => {
            const nextVal = arr[i + 1]?.value;
            const d = nextVal != null ? row.value - nextVal : null;
            return (
              <View key={row.date} style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ fontSize: 9, fontFamily: "Pretendard-Regular", color: colors.mutedForeground, flex: 1 }}>{row.date.slice(0, 7)}</Text>
                <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: colors.foreground, width: 44, textAlign: "right" }}>
                  {row.value.toFixed(series.id === "us-gdp" || series.id === "kr-gdp" ? 1 : 2)}{series.unit}
                </Text>
                <Text style={{ fontSize: 9, fontFamily: "Pretendard-Regular", width: 36, textAlign: "right",
                  color: d == null ? colors.mutedForeground : d > 0 ? "#22c55e" : d < 0 ? "#ef4444" : colors.mutedForeground + "60" }}>
                  {d == null ? "—" : `${d > 0 ? "▲" : "▼"}${Math.abs(d).toFixed(2)}`}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

// ── 지표 추이 전체 섹션 ─────────────────────────────────────────────────────

let _indCache: { data: IndicatorSeries[]; at: number } | null = null;

function MobileIndicatorSection({ colors }: { colors: any }) {
  const [indicators, setIndicators] = useState<IndicatorSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (_indCache && Date.now() - _indCache.at < 12 * 60 * 60 * 1000) {
      setIndicators(_indCache.data); return;
    }
    setLoading(true);
    apiFetch<IndicatorSeries[]>("/api/market-data/indicator-history")
      .then(data => {
        const valid = (Array.isArray(data) ? data : []).filter(s => Array.isArray(s.data) && s.data.length > 0);
        _indCache = { data: valid, at: Date.now() };
        setIndicators(valid);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const usIndicators = indicators.filter(s => s.country === "US");
  const krIndicators = indicators.filter(s => s.country === "KR");

  return (
    <View style={{ marginHorizontal: 12, marginTop: 12, marginBottom: 4, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.card + "60", overflow: "hidden" }}>
      {/* 섹션 헤더 */}
      <Pressable
        onPress={() => setCollapsed(v => !v)}
        style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 11, opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Feather name="trending-up" size={13} color={colors.primary} />
          <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>주요 지표 추이</Text>
          <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>FRED 실제 데이터</Text>
        </View>
        <Feather name={collapsed ? "chevron-right" : "chevron-down"} size={14} color={colors.mutedForeground + "80"} />
      </Pressable>

      {!collapsed && (
        <View style={{ paddingHorizontal: 10, paddingBottom: 12 }}>
          {loading ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 20 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>FRED 데이터 불러오는 중…</Text>
            </View>
          ) : indicators.length === 0 ? null : (
            <>
              {/* 미국 */}
              {usIndicators.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: colors.mutedForeground, marginBottom: 8, marginLeft: 2 }}>🇺🇸 미국</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {usIndicators.map(s => <MobileIndicatorCard key={s.id} series={s} colors={colors} />)}
                  </View>
                </View>
              )}
              {/* 한국 */}
              {krIndicators.length > 0 && (
                <View>
                  <Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: colors.mutedForeground, marginBottom: 8, marginLeft: 2 }}>🇰🇷 한국</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {krIndicators.map(s => <MobileIndicatorCard key={s.id} series={s} colors={colors} />)}
                  </View>
                </View>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

function fmtRevenue(val: number, currency: string) {
  if (currency === "KRW") {
    if (val >= 1e12) return `${(val / 1e12).toFixed(1)}조`;
    if (val >= 1e8) return `${(val / 1e8).toFixed(0)}억`;
    return `${val.toLocaleString()}`;
  }
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
  if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
  return `$${val.toLocaleString()}`;
}

function fmtEps(val: number, currency: string) {
  if (currency === "KRW") return `₩${val.toLocaleString("ko-KR", { maximumFractionDigits: 0 })}`;
  return `$${val.toFixed(2)}`;
}

function EarningsCard({ e, colors }: { e: EarningsEntry; colors: any }) {
  const initials = (e.companyName || e.ticker).slice(0, 2).toUpperCase();
  const isKR = e.isKorean;
  const surprisePct = e.epsSurprisePct;
  const hasEps = e.epsEstimate != null;
  const hasRevenue = e.revenueEstimate != null && e.revenueEstimate! > 0;

  const surpriseColor = surprisePct == null ? null
    : surprisePct > 0 ? "#16a34a" : "#dc2626";

  return (
    <View style={{
      marginHorizontal: 16, marginBottom: 10,
      backgroundColor: colors.card, borderRadius: 16,
      borderWidth: 1, borderColor: colors.border,
      padding: 14, gap: 10,
    }}>
      {/* Row 1: avatar + name + badge + quarter */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{
          width: 40, height: 40, borderRadius: 12,
          backgroundColor: isKR ? "#dbeafe" : "#fef9c3",
          alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Bold", color: isKR ? "#2563eb" : "#b45309" }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
            <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{e.ticker.replace(".KS", "").replace(".KQ", "")}</Text>
            <View style={{ backgroundColor: isKR ? "#dbeafe" : "#fef9c3", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontSize: 9, fontFamily: "Pretendard-SemiBold", color: isKR ? "#2563eb" : "#b45309" }}>{isKR ? "🇰🇷 KR" : "🇺🇸 US"}</Text>
            </View>
            {e.isCompleted && (
              <View style={{ backgroundColor: "#dcfce7", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                <Text style={{ fontSize: 9, fontFamily: "Pretendard-SemiBold", color: "#16a34a" }}>발표완료</Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", marginTop: 1 }} numberOfLines={1}>{e.companyName}</Text>
        </View>
        {e.fiscalQuarterEnding && (
          <View style={{ backgroundColor: colors.muted, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 }}>
            <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>{e.fiscalQuarterEnding}</Text>
          </View>
        )}
      </View>

      {/* Row 2: EPS + Revenue metrics */}
      {(hasEps || hasRevenue) && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          {hasEps && (
            <View style={{ flex: 1, backgroundColor: colors.muted, borderRadius: 10, padding: 10, gap: 3 }}>
              <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>EPS 예상</Text>
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: colors.foreground }}>
                {fmtEps(e.epsEstimate!, e.currency)}
              </Text>
              {e.epsLow != null && e.epsHigh != null && (
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
                  {fmtEps(e.epsLow, e.currency)} ~ {fmtEps(e.epsHigh, e.currency)}
                </Text>
              )}
              {e.analyticCount != null && e.analyticCount > 0 && (
                <Text style={{ fontSize: 9, color: colors.mutedForeground + "99", fontFamily: "Pretendard-Regular" }}>
                  애널리스트 {e.analyticCount}명
                </Text>
              )}
            </View>
          )}
          {hasRevenue && (
            <View style={{ flex: 1, backgroundColor: colors.muted, borderRadius: 10, padding: 10, gap: 3 }}>
              <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>매출 예상</Text>
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: colors.foreground }}>
                {fmtRevenue(e.revenueEstimate!, e.currency)}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Row 3: Previous surprise */}
      {surprisePct != null && e.epsActualPrev != null && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
          <Feather name="trending-up" size={11} color={surpriseColor!} />
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
            전분기 실적: <Text style={{ color: colors.foreground, fontFamily: "Pretendard-Medium" }}>{fmtEps(e.epsActualPrev, e.currency)}</Text>
            {"  "}서프라이즈: <Text style={{ color: surpriseColor!, fontFamily: "Pretendard-SemiBold" }}>
              {surprisePct > 0 ? "+" : ""}{(surprisePct * 100).toFixed(1)}%
            </Text>
          </Text>
        </View>
      )}
    </View>
  );
}

function CalendarTab({ colors, insets }: { colors: any; insets: any }) {
  const [calTab, setCalTab] = useState<"economic" | "earnings">("economic");
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

  function fmtDateLabel(d: string) {
    try {
      const dt = new Date(d);
      const dayKo = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
      return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${dayKo})`;
    } catch { return d; }
  }

  const earningsByDate = earnings.slice(0, 50).reduce<Record<string, EarningsEntry[]>>((acc, e) => {
    const key = e.earningsDate.slice(0, 10);
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});
  const earningsDates = Object.keys(earningsByDate).sort();

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {([["economic", "경제 지표"], ["earnings", "실적 발표"]] as const).map(([key, label]) => (
          <Pressable
            key={key}
            style={({ pressed }) => [{
              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
              backgroundColor: calTab === key ? colors.primary + "12" : "transparent",
              opacity: pressed ? 0.7 : 1,
            }]}
            onPress={() => setCalTab(key)}
          >
            <Text style={{ fontSize: 13, fontFamily: calTab === key ? "Pretendard-SemiBold" : "Pretendard-Regular", color: calTab === key ? colors.primary : colors.mutedForeground }}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}>
        {loading ? (
          <View style={{ padding: 16, gap: 10 }}>
            {[0, 1, 2, 3, 4].map(i => <SkeletonCard key={i} height={68} />)}
          </View>
        ) : calTab === "earnings" ? (
          earningsDates.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
              <Feather name="calendar" size={28} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>실적 발표 일정이 없습니다</Text>
            </View>
          ) : (
            <View style={{ paddingTop: 12 }}>
              {earningsDates.map((dateKey) => {
                const isToday = dateKey === today;
                const isTomorrow = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return dateKey === t.toISOString().slice(0, 10); })();
                return (
                  <View key={dateKey} style={{ marginBottom: 4 }}>
                    {/* Date header */}
                    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
                      <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{fmtDateLabel(dateKey)}</Text>
                      {isToday && <View style={{ backgroundColor: "#fef3c7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 }}><Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#b45309" }}>오늘</Text></View>}
                      {isTomorrow && <View style={{ backgroundColor: "#dbeafe", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 }}><Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#2563eb" }}>내일</Text></View>}
                      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>{earningsByDate[dateKey].length}개사</Text>
                    </View>
                    {/* Cards */}
                    {earningsByDate[dateKey].map((e, i) => (
                      <EarningsCard key={`${e.ticker}-${i}`} e={e} colors={colors} />
                    ))}
                  </View>
                );
              })}
            </View>
          )
        ) : (
          <>
            <MobileIndicatorSection colors={colors} />
            {economic.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Feather name="calendar" size={12} color={colors.primary} />
                  <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>다가올 경제지표 발표</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#ef4444" }} /><Text style={{ fontSize: 9, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>매우 중요</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} /><Text style={{ fontSize: 9, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>중요</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#94a3b8" }} /><Text style={{ fontSize: 9, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>보통</Text>
                    </View>
                  </View>
                </View>
                {economic.slice(0, 50).map((ev, i) => {
                  const evDate = ev.date.slice(0, 10);
                  const prevDate = i > 0 ? economic[i - 1].date.slice(0, 10) : null;
                  const showDateHeader = evDate !== prevDate;
                  const dt = new Date(evDate);
                  const dayKo = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
                  const dateStr = `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${dayKo})`;
                  const isToday2 = evDate === today;
                  const isTomorrow2 = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return evDate === t.toISOString().slice(0, 10); })();
                  return (
                    <View key={`ec-${i}`}>
                      {showDateHeader && (
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0, borderTopColor: colors.border + "60" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>{dateStr}</Text>
                          {isToday2 && <View style={{ backgroundColor: "#fef3c7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 }}><Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#b45309" }}>오늘</Text></View>}
                          {isTomorrow2 && <View style={{ backgroundColor: "#dbeafe", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 }}><Text style={{ fontSize: 10, fontFamily: "Pretendard-SemiBold", color: "#2563eb" }}>내일</Text></View>}
                        </View>
                      )}
                      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: 10 }}>
                        <View style={{ width: 3, alignSelf: "stretch", backgroundColor: IMP_COLOR[ev.importance] ?? "#94a3b8", borderRadius: 2 }} />
                        <View style={{ flex: 1, gap: 3 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                            <Text style={{ fontSize: 12 }}>{COUNTRY_FLAG_IND[ev.country] ?? "🌐"}</Text>
                            <View style={{ backgroundColor: IMP_COLOR[ev.importance] + "22", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                              <Text style={{ fontSize: 9, fontFamily: "Pretendard-Bold", color: IMP_COLOR[ev.importance] }}>{IMP_LABEL[ev.importance]}</Text>
                            </View>
                            {ev.time && <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>{ev.time}</Text>}
                          </View>
                          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Medium", color: colors.foreground, lineHeight: 18 }}>{ev.title}</Text>
                          {(ev.forecast || ev.previous) && (
                            <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
                              {ev.forecast ? `예상 ${ev.forecast}` : ""}{ev.forecast && ev.previous ? " · " : ""}{ev.previous ? `이전 ${ev.previous}` : ""}
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
            {economic.length === 0 && !loading && (
              <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
                <Feather name="bar-chart" size={28} color={colors.border} />
                <Text style={{ fontSize: 13, color: colors.mutedForeground }}>경제 지표 일정이 없습니다</Text>
              </View>
            )}
          </>
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
      <View style={[styles.header, { paddingTop: topPad + 14, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>애빛다</Text>
          <Text style={{ fontSize: 10, fontFamily: "Pretendard-Regular", color: colors.mutedForeground, marginTop: 1 }}>AI 헤지펀드 · 시장 분석</Text>
        </View>
        {subTab === "overview" && (
          <View style={{ flexDirection: "row", backgroundColor: colors.muted, borderRadius: 10, padding: 3 }}>
            {(["kr", "us"] as const).map(m => (
              <Pressable
                key={m}
                onPress={() => setMarket(m)}
                style={({ pressed }) => [{
                  paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
                  backgroundColor: market === m ? colors.card : "transparent",
                  opacity: pressed ? 0.8 : 1,
                }]}
              >
                <Text style={{ fontSize: 12, fontFamily: market === m ? "Pretendard-SemiBold" : "Pretendard-Regular", color: market === m ? colors.primary : colors.mutedForeground }}>
                  {m === "kr" ? "🇰🇷 한국" : "🇺🇸 미국"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* 서브탭 바 */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {SUB_TABS.map(({ key: tabKey, label }) => (
          <Pressable
            key={tabKey}
            style={({ pressed }) => [{
              paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
              backgroundColor: subTab === tabKey ? colors.primary + "12" : "transparent",
              opacity: pressed ? 0.7 : 1,
            }]}
            onPress={() => setSubTab(tabKey)}
          >
            <Text style={{ fontSize: 13, fontFamily: subTab === tabKey ? "Pretendard-SemiBold" : "Pretendard-Regular", color: subTab === tabKey ? colors.primary : colors.mutedForeground }}>
              {label}
            </Text>
          </Pressable>
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
    paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 24, fontFamily: "Pretendard-Bold" },
  indexCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  pulseCard: { borderRadius: 14, borderWidth: 1, padding: 14 },
  sectorCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
});
