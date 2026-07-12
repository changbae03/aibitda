import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, View, Platform, TouchableOpacity, Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useMarketBrief, useMarketSessions, apiFetch, type Session } from "@/hooks/useApi";
import { SkeletonCard } from "@/components/SkeletonCard";

// ── Labels ─────────────────────────────────────────────────────────────────

const SESSION_LABELS: Record<string, string> = {
  premarket: "장전", intraday1: "장중 1부", intraday2: "장중 2부",
  close: "장마감", weekend: "주말 브리핑",
  "장전": "장전", "장중1차": "장중 1부", "장중2차": "장중 2부",
  "장마감": "장마감", "주말": "주말 브리핑",
  morning: "장전", afternoon: "장중",
};
function sessionLabel(s: Session) { return s.sessionLabel || SESSION_LABELS[s.session] || s.session; }

// ── Types for Calendar / ETF ─────────────────────────────────────────────

interface EarningsEntry {
  ticker: string; companyName: string; earningsDate: string;
  epsEstimate: number | null; revenueEstimate: number | null;
  currency: string; isKorean: boolean; isCompleted?: boolean;
}
interface EconomicEvent {
  date: string; time?: string; title: string; country: string;
  category: string; importance: "high" | "medium" | "low";
  forecast?: string; previous?: string; unit?: string;
}
interface UnifiedSignal {
  code: string; name: string; sector: string; price: number;
  change1d: number; return5d: number; signal: string;
  combinedScore: number; reason: string; rsi14: number;
}

// ── 세션 카드 ─────────────────────────────────────────────────────────────

function SessionCard({ session, selected, onPress }: { session: Session; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const isDone = session.status === "done";
  const isGen  = session.status === "generating";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.sessionCard, {
        backgroundColor: selected ? colors.primary + "18" : colors.card,
        borderColor: selected ? colors.primary : colors.border,
        borderWidth: selected ? 1.5 : 1,
        opacity: pressed ? 0.75 : 1,
      }]}
    >
      <View style={styles.sessionStatus}>
        {isDone ? <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
          : isGen ? <ActivityIndicator size={10} color={colors.warning} />
          : <View style={[styles.statusDot, { backgroundColor: colors.mutedForeground }]} />}
        <Text style={[styles.sessionStatusText, { color: colors.mutedForeground }]}>
          {isDone ? "완료" : isGen ? "생성 중" : "대기"}
        </Text>
      </View>
      <Text style={[styles.sessionName, { color: selected ? colors.primary : colors.foreground }]}>
        {sessionLabel(session)}
      </Text>
      {session.generatedAt && (
        <Text style={[styles.sessionTime, { color: colors.mutedForeground }]} numberOfLines={1}>
          {new Date(session.generatedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
        </Text>
      )}
    </Pressable>
  );
}

// ── 브리핑 본문 ───────────────────────────────────────────────────────────

function BriefContent({ content }: { content: string }) {
  const colors = useColors();
  return (
    <View style={styles.briefContainer}>
      {content.split("\n").filter(Boolean).map((line, i) => {
        const isHeader  = line.startsWith("##") || line.startsWith("**");
        const isSection = line.startsWith("#");
        const cleaned   = line.replace(/^#+\s*/, "").replace(/\*\*/g, "");
        return (
          <Text key={`brief-${i}`} style={[styles.briefLine, {
            color: isHeader ? colors.foreground : isSection ? colors.primary : colors.mutedForeground,
            fontWeight: isHeader || isSection ? "600" : "400",
            fontSize: isSection ? 15 : 14,
            marginTop: isSection || isHeader ? 12 : 4,
          }]}>{cleaned}</Text>
        );
      })}
    </View>
  );
}

// ── 캘린더 서브탭 ─────────────────────────────────────────────────────────

const IMP_COLOR: Record<string, string> = { high: "#EF4444", medium: "#F59E0B", low: "#94a3b8" };
const IMP_LABEL: Record<string, string> = { high: "핵심", medium: "주요", low: "참고" };

function CalendarSubTab({ colors, insets }: { colors: any; insets: any }) {
  const [calTab, setCalTab] = useState<"earnings" | "economic">("earnings");
  const [earnings, setEarnings] = useState<EarningsEntry[]>([]);
  const [economic, setEconomic] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      apiFetch<{ earnings: EarningsEntry[] } | EarningsEntry[]>("/api/market-data/earnings-calendar"),
      apiFetch<{ events: EconomicEvent[] } | EconomicEvent[]>("/api/market-data/economic-calendar"),
    ]).then(([e, ec]) => {
      if (e.status === "fulfilled") {
        const d = e.value as any;
        setEarnings(Array.isArray(d) ? d : (d.earnings ?? d.data ?? []));
      }
      if (ec.status === "fulfilled") {
        const d = ec.value as any;
        setEconomic(Array.isArray(d) ? d : (d.events ?? d.data ?? []));
      }
    }).finally(() => setLoading(false));
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  function fmtDate(d: string) {
    try {
      const dt = new Date(d);
      const isToday = d.slice(0, 10) === today;
      const dayKo = ["일", "월", "화", "수", "목", "금", "토"][dt.getDay()];
      return isToday ? `오늘 (${dt.getMonth() + 1}/${dt.getDate()})` : `${dt.getMonth() + 1}/${dt.getDate()} (${dayKo})`;
    } catch { return d; }
  }

  return (
    <View style={{ flex: 1 }}>
      {/* 캘린더 미니탭 */}
      <View style={{ flexDirection: "row", gap: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
        {([["earnings", "실적 발표"], ["economic", "경제 지표"]] as const).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: calTab === key ? colors.primary : "transparent" }}
            onPress={() => setCalTab(key)}
          >
            <Text style={{ fontSize: 13, fontFamily: calTab === key ? "Inter_600SemiBold" : "Inter_400Regular", color: calTab === key ? colors.primary : colors.mutedForeground }}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}>
        {loading ? (
          <View style={{ padding: 24, gap: 10 }}>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={68} />)}
          </View>
        ) : calTab === "earnings" ? (
          earnings.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
              <Feather name="calendar" size={28} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>실적 발표 일정이 없습니다</Text>
            </View>
          ) : earnings.slice(0, 50).map((e, i) => (
            <View key={`${e.ticker}-${i}`} style={[styles.calRow, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{e.ticker}</Text>
                  <View style={{ backgroundColor: e.isKorean ? "#DBEAFE" : "#FEF9C3", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: e.isKorean ? "#2563EB" : "#B45309" }}>{e.isKorean ? "KR" : "US"}</Text>
                  </View>
                  {e.isCompleted && (
                    <View style={{ backgroundColor: "#DCFCE7", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#16A34A" }}>발표 완료</Text>
                    </View>
                  )}
                </View>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }} numberOfLines={1}>{e.companyName}</Text>
                {e.epsEstimate != null && (
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    EPS 예상: {e.epsEstimate > 0 ? "+" : ""}{e.epsEstimate.toFixed(2)} {e.currency}
                  </Text>
                )}
              </View>
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.foreground + "99" }}>{fmtDate(e.earningsDate)}</Text>
            </View>
          ))
        ) : (
          economic.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
              <Feather name="bar-chart" size={28} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>경제 지표 일정이 없습니다</Text>
            </View>
          ) : economic.slice(0, 50).map((ev, i) => (
            <View key={`ec-${i}`} style={[styles.calRow, { borderBottomColor: colors.border }]}>
              <View style={{ width: 4, alignSelf: "stretch", backgroundColor: IMP_COLOR[ev.importance] ?? "#94a3b8", borderRadius: 2, marginRight: 10 }} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ backgroundColor: IMP_COLOR[ev.importance] + "22", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                    <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: IMP_COLOR[ev.importance] }}>{IMP_LABEL[ev.importance]}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{ev.country}</Text>
                </View>
                <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: colors.foreground, lineHeight: 19 }}>{ev.title}</Text>
                {(ev.forecast || ev.previous) && (
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    {ev.forecast ? `예상 ${ev.forecast}` : ""}{ev.forecast && ev.previous ? " / " : ""}{ev.previous ? `이전 ${ev.previous}` : ""}{ev.unit ? ` ${ev.unit}` : ""}
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

// ── ETF 서브탭 ────────────────────────────────────────────────────────────

const SIGNAL_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  strong_buy:  { color: "#16a34a", bg: "#dcfce7", label: "강력매수" },
  buy:         { color: "#16a34a", bg: "#dcfce7", label: "매수" },
  hold:        { color: "#d97706", bg: "#fef9c3", label: "보유" },
  sell:        { color: "#dc2626", bg: "#fee2e2", label: "매도" },
  strong_sell: { color: "#dc2626", bg: "#fee2e2", label: "강력매도" },
};

function ETFSubTab({ colors, insets }: { colors: any; insets: any }) {
  const [signals, setSignals] = useState<UnifiedSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError(false);
    apiFetch<{ signals?: UnifiedSignal[] } | UnifiedSignal[]>("/api/etf/unified-signals")
      .then(d => { const arr = Array.isArray(d) ? d : ((d as any).signals ?? []); setSignals(arr); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = signals.reduce<Record<string, UnifiedSignal[]>>((acc, s) => {
    const k = s.sector || "기타";
    if (!acc[k]) acc[k] = [];
    acc[k].push(s);
    return acc;
  }, {});

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor="#f97316" />}
    >
      {loading && signals.length === 0 ? (
        <View style={{ padding: 24, gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={64} />)}
        </View>
      ) : error ? (
        <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
          <Feather name="alert-circle" size={28} color={colors.border} />
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>ETF 데이터를 불러올 수 없습니다</Text>
          <TouchableOpacity onPress={load}><Text style={{ fontSize: 13, color: "#f97316" }}>다시 시도</Text></TouchableOpacity>
        </View>
      ) : signals.length === 0 ? (
        <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
          <Feather name="layers" size={28} color={colors.border} />
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>ETF 신호가 없습니다</Text>
        </View>
      ) : (
        Object.entries(groups).map(([sector, items]) => (
          <View key={sector}>
            <View style={[styles.sectorHeader, { backgroundColor: colors.muted + "40", borderBottomColor: colors.border }]}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: colors.foreground + "BB" }}>{sector}</Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{items.length}개</Text>
            </View>
            {items.map(s => {
              const sig = SIGNAL_STYLE[s.signal?.toLowerCase()] ?? SIGNAL_STYLE.hold;
              return (
                <View key={s.code} style={[styles.etfRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.foreground }}>{s.code}</Text>
                      <View style={{ backgroundColor: sig.bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: sig.color }}>{sig.label}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }} numberOfLines={1}>{s.name}</Text>
                    {s.reason && (
                      <Text style={{ fontSize: 10, color: colors.mutedForeground + "BB", fontFamily: "Inter_400Regular" }} numberOfLines={1}>{s.reason}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 3 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>
                      {s.price?.toLocaleString("ko-KR")}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (s.change1d ?? 0) >= 0 ? colors.up : colors.down }}>
                      {(s.change1d ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(s.change1d ?? 0).toFixed(2)}%
                    </Text>
                    {s.rsi14 != null && (
                      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>RSI {s.rsi14.toFixed(0)}</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ))
      )}
    </ScrollView>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────

type MarketSubTab = "overview" | "calendar" | "etf";

export default function MarketScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const [market, setMarket]   = useState<"kr" | "us">("kr");
  const [subTab, setSubTab]   = useState<MarketSubTab>("overview");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const { data: sessionsData, isLoading, refetch, isRefetching } = useMarketSessions(market);
  const { data: briefData, isLoading: briefLoading } = useMarketBrief(market, selectedSession);

  const sessions    = sessionsData?.sessions ?? [];
  const autoSelected = selectedSession ?? sessionsData?.currentSession ?? sessions.find(s => s.status === "done")?.session ?? null;
  const activeBrief  = useMarketBrief(market, autoSelected);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const SUB_TABS: { key: MarketSubTab; label: string; icon: any }[] = [
    { key: "overview",  label: "개요",   icon: "bar-chart-2" },
    { key: "calendar",  label: "캘린더", icon: "calendar"    },
    { key: "etf",       label: "ETF",    icon: "layers"      },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── 헤더 ── */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>시장 분석</Text>
        {subTab === "overview" && (
          <View style={[styles.toggle, { backgroundColor: colors.accent }]}>
            {(["kr", "us"] as const).map(m => (
              <Pressable
                key={m}
                onPress={() => { setMarket(m); setSelectedSession(null); }}
                style={[styles.toggleBtn, { backgroundColor: market === m ? colors.primary : "transparent" }]}
              >
                <Text style={[styles.toggleText, { color: market === m ? colors.primaryForeground : colors.mutedForeground, fontWeight: market === m ? "600" : "400" }]}>
                  {m === "kr" ? "한국" : "미국"}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {/* ── 서브탭 바 ── */}
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

      {/* ── 개요 탭 ── */}
      {subTab === "overview" && (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={{ paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 100 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {sessionsData?.marketDate && (
            <Text style={[styles.dateLabel, { color: colors.mutedForeground }]}>{sessionsData.marketDate}</Text>
          )}

          {isLoading ? (
            <View style={styles.sessionGrid}>
              {[0,1,2,3].map(i => <SkeletonCard key={`skel-${i}`} height={88} width="48%" style={{ marginBottom: 8 }} />)}
            </View>
          ) : sessions.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="moon" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>오늘은 브리핑이 없어요</Text>
            </View>
          ) : (
            <View style={styles.sessionGrid}>
              {sessions.map(s => (
                <SessionCard
                  key={s.session} session={s}
                  selected={(selectedSession ?? autoSelected) === s.session}
                  onPress={() => setSelectedSession(selectedSession === s.session ? null : s.session)}
                />
              ))}
            </View>
          )}

          <View style={[styles.briefSection, { borderTopColor: colors.border }]}>
            {activeBrief.isLoading && !!autoSelected ? (
              <View style={styles.briefLoading}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[styles.briefLoadingText, { color: colors.mutedForeground }]}>브리핑 불러오는 중…</Text>
              </View>
            ) : activeBrief.data?.content ? (
              <>
                <View style={styles.briefHeader}>
                  <Text style={[styles.briefHeaderText, { color: colors.primary }]}>
                    {sessions.find(s => s.session === (selectedSession ?? autoSelected))
                      ? sessionLabel(sessions.find(s => s.session === (selectedSession ?? autoSelected))!)
                      : ""} 브리핑
                  </Text>
                  {activeBrief.data.cachedAt && (
                    <Text style={[styles.briefTime, { color: colors.mutedForeground }]}>
                      {new Date(activeBrief.data.cachedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </Text>
                  )}
                </View>
                <BriefContent content={activeBrief.data.content} />
              </>
            ) : autoSelected ? (
              <View style={styles.emptyState}>
                <Feather name="file-text" size={28} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>브리핑을 불러올 수 없어요</Text>
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Feather name="bar-chart-2" size={28} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>세션을 선택해 브리핑을 확인하세요</Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* ── 캘린더 탭 ── */}
      {subTab === "calendar" && <CalendarSubTab colors={colors} insets={insets} />}

      {/* ── ETF 탭 ── */}
      {subTab === "etf" && <ETFSubTab colors={colors} insets={insets} />}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  toggle: { flexDirection: "row", borderRadius: 8, padding: 3 },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 6 },
  toggleText: { fontSize: 13 },
  subTabBar: {
    flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subTabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  scroll: { flex: 1 },
  dateLabel: { fontSize: 12, textAlign: "center", marginTop: 12, marginBottom: 4 },
  sessionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, padding: 16, justifyContent: "space-between" },
  sessionCard: { width: "48%", padding: 14, borderRadius: 12, gap: 6 },
  sessionStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  sessionStatusText: { fontSize: 11 },
  sessionName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sessionTime: { fontSize: 11 },
  briefSection: { marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, paddingHorizontal: 16, minHeight: 120 },
  briefHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  briefHeaderText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  briefTime: { fontSize: 11 },
  briefContainer: { gap: 2 },
  briefLine: { lineHeight: 22 },
  briefLoading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 24 },
  briefLoadingText: { fontSize: 14 },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 14 },
  // Calendar
  calRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  sectorHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // ETF
  etfRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
});
