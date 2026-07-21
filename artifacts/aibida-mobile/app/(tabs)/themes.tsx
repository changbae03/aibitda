import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import {
  useTomorrowPicks, usePresurge, useThemeSignals,
  apiFetch,
  type TomorrowPick, type PresurgePick, type ThemeSignal,
} from "@/hooks/useApi";

// ── Types (web API 동일) ──────────────────────────────────────────────────

interface FeedStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale: string;
  priceChange?: number;
  volumeRatio?: number;
  isLeader?: boolean;
  institutionAek?: number;
  foreignAek?: number;
  smartMoneyAek?: number;
}

type ThemePhase = "hot" | "momentum" | "emerging" | "quiet";

interface ThemeFeedItem {
  id: string;
  name: string;
  description: string;
  emoji: string;
  summary: string;
  stocks: FeedStock[];
  phase?: ThemePhase;
  themeSmartMoney?: number;
}

// ── Force score helpers ───────────────────────────────────────────────────

function stockForceScore(s: FeedStock): number {
  const ch = s.priceChange ?? 0;
  const vr = (s.volumeRatio ?? 1) - 1;
  return ch * 0.6 + vr * 0.4;
}

function computeThemeForce(stocks: FeedStock[]) {
  const withData = stocks.filter(s => s.priceChange != null);
  if (withData.length === 0) return null;
  const scores = withData.map(stockForceScore);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { avg, max: Math.max(...scores) };
}

/** phase(서버 계산값) 또는 가격 avg 기반 표시 메타 */
function phaseMeta(phase?: ThemePhase, priceAvg?: number | null) {
  if (phase === "hot")      return { label: "강세",      emoji: "🔥", color: "#EF4444", barColor: "#EF4444" };
  if (phase === "momentum") return { label: "상승 중",   emoji: "⚡", color: "#F97316", barColor: "#F97316" };
  if (phase === "emerging") return { label: "수급 형성", emoji: "📡", color: "#8B5CF6", barColor: "#8B5CF6" };
  // quiet or fallback → price avg 기반
  const avg = priceAvg ?? 0;
  if (avg >= 2)  return { label: "상승 중",  emoji: "⚡", color: "#F97316", barColor: "#F97316" };
  if (avg >= 0)  return { label: "보합",     emoji: "〰", color: "#94a3b8", barColor: "#94a3b8" };
  return               { label: "조정 중",  emoji: "↘",  color: "#94a3b8", barColor: "#94a3b8" };
}

/** 종목별 상태 텍스트 — 스마트머니 우선 반영 */
function momentumInfo(s: FeedStock): { text: string; color: string } {
  const sm = s.smartMoneyAek;
  const inst = s.institutionAek ?? 0;
  const fore = s.foreignAek ?? 0;
  const up  = (s.priceChange ?? 0) > 0.5;
  const vol = (s.volumeRatio ?? 1) >= 1.3;

  // 스마트머니 신호 우선
  if (sm != null) {
    if (inst > 0 && fore > 0)    return { text: "기관+외인 동시 매수", color: "#7C3AED" };
    if (inst > 10)                return { text: `기관 +${inst.toFixed(0)}억`, color: "#7C3AED" };
    if (inst > 0)                 return { text: "기관 소량 매집",       color: "#8B5CF6" };
    if (fore > 10)                return { text: `외인 +${fore.toFixed(0)}억`, color: "#0EA5E9" };
    if (fore > 0)                 return { text: "외인 유입 중",         color: "#0EA5E9" };
    if (inst < -10)               return { text: "기관 매도 중",         color: "#EF4444" };
  }

  // 가격/거래량 신호
  if (s.priceChange == null) return { text: "조회 중", color: "#94a3b8" };
  if (up && vol)   return { text: "거래량 동반 상승", color: "#16a34a" };
  if (up && !vol)  return { text: "상승 (거래량 약)",  color: "#ca8a04" };
  if (!up && vol)  return { text: "거래량 증가",       color: "#F97316" };
  return                  { text: "관망",              color: "#94a3b8" };
}

const TABS = ["테마 분석", "내일 종목", "수급 레이더"] as const;
type Tab = typeof TABS[number];

// ── 테마별 수급 강도 랭킹 ─────────────────────────────────────────────────

function ThemeForceRanking({ feed, colors }: { feed: ThemeFeedItem[]; colors: any }) {
  // 서버 phase 기준으로 정렬 (hot > momentum > emerging > quiet)
  const phaseRank: Record<string, number> = { hot: 4, momentum: 3, emerging: 2, quiet: 1 };
  const ranked = feed
    .map(item => ({ ...item, force: computeThemeForce(item.stocks) }))
    .sort((a, b) => {
      const pr = (phaseRank[b.phase ?? "quiet"] ?? 1) - (phaseRank[a.phase ?? "quiet"] ?? 1);
      if (pr !== 0) return pr;
      return (b.themeSmartMoney ?? 0) - (a.themeSmartMoney ?? 0);
    });

  if (ranked.length === 0) return null;
  const absMax = Math.max(...ranked.map(r => Math.abs(r.force?.avg ?? 0)), 1);

  return (
    <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <Feather name="activity" size={14} color="#6366f1" />
        <Text style={[s.cardTitle, { color: colors.foreground }]}>테마별 수급 강도</Text>
        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>돈이 쏠리는 순서</Text>
      </View>
      {ranked.map((item, i) => {
        const force = item.force;
        const meta = phaseMeta(item.phase, force?.avg);
        const barPct = Math.max(2, (Math.abs(force?.avg ?? 0) / absMax) * 100);
        const sm = item.themeSmartMoney;
        return (
          <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Text style={{ fontSize: 10, color: colors.mutedForeground, width: 14, textAlign: "right", fontFamily: "Inter_400Regular" }}>{i + 1}</Text>
            <Text style={{ fontSize: 15 }}>{item.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_500Medium" }} numberOfLines={1}>{item.name}</Text>
              {item.phase === "emerging" && sm != null && sm > 0 && (
                <Text style={{ fontSize: 9, color: "#8B5CF6", fontFamily: "Inter_400Regular" }}>
                  스마트머니 {sm > 0 ? "+" : ""}{sm.toFixed(0)}억 유입
                </Text>
              )}
            </View>
            <View style={{ width: 80, height: 6, backgroundColor: colors.muted, borderRadius: 3, overflow: "hidden" }}>
              <View style={{ width: `${barPct}%` as any, height: "100%", backgroundColor: meta.barColor, borderRadius: 3 }} />
            </View>
            <Text style={{ fontSize: 10, color: meta.color, width: 52, textAlign: "right", fontFamily: "Inter_600SemiBold" }}>
              {meta.emoji} {meta.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ── 종목 행 ────────────────────────────────────────────────────────────────

function StockRow({ stock, onAnalyze, colors }: { stock: FeedStock; onAnalyze: (t: string, n: string) => void; colors: any }) {
  const change = stock.priceChange;
  const momentum = momentumInfo(stock);
  const hasSmartMoney = stock.smartMoneyAek != null;
  const sm = stock.smartMoneyAek ?? 0;
  const isAccumulating = hasSmartMoney && sm > 0 && Math.abs(change ?? 0) < 3;

  return (
    <View style={[s.stockRow, { borderBottomColor: colors.border }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {stock.isLeader && (
            <View style={{ backgroundColor: "#FEF3C7", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontSize: 9, color: "#D97706", fontFamily: "Inter_700Bold" }}>주도주</Text>
            </View>
          )}
          {isAccumulating && (
            <View style={{ backgroundColor: "#EDE9FE", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
              <Text style={{ fontSize: 9, color: "#7C3AED", fontFamily: "Inter_700Bold" }}>📡 매집</Text>
            </View>
          )}
          <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{stock.name}</Text>
          <View style={{
            backgroundColor: stock.market === "KR" ? "#EFF6FF" : "#F0FDF4",
            paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
          }}>
            <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: stock.market === "KR" ? "#3B82F6" : "#16A34A" }}>{stock.market}</Text>
          </View>
          {change != null && (
            <Text style={{ fontSize: 11, color: change >= 0 ? "#EF4444" : "#3B82F6", fontFamily: "Inter_600SemiBold" }}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
            </Text>
          )}
          <Text style={{ fontSize: 10, color: momentum.color, fontFamily: "Inter_400Regular" }}>{momentum.text}</Text>
        </View>
        <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 16 }} numberOfLines={2}>
          {stock.rationale}
        </Text>
      </View>
      <TouchableOpacity
        style={{ backgroundColor: "#eef2ff", paddingHorizontal: 11, paddingVertical: 7, borderRadius: 8, marginLeft: 8 }}
        onPress={() => onAnalyze(stock.ticker, stock.name)}
      >
        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6366f1" }}>분석</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── 테마 카드 ──────────────────────────────────────────────────────────────

function ThemeCard({ item, idx, onAnalyze, colors }: {
  item: ThemeFeedItem; idx: number;
  onAnalyze: (t: string, n: string) => void; colors: any;
}) {
  const [expanded, setExpanded] = useState(idx === 0);
  const force = computeThemeForce(item.stocks);
  const meta = phaseMeta(item.phase, force?.avg);
  const isEmerging = item.phase === "emerging";
  const sm = item.themeSmartMoney;

  return (
    <View style={[s.card, {
      backgroundColor: colors.card, borderColor: isEmerging ? "#C4B5FD" : colors.border,
      borderWidth: isEmerging ? 1.5 : StyleSheet.hairlineWidth,
    }]}>
      {/* 수급 형성 중 배너 */}
      {isEmerging && (
        <View style={{ backgroundColor: "#EDE9FE", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 11, color: "#7C3AED", fontFamily: "Inter_700Bold" }}>📡 수급 형성 중</Text>
          {sm != null && sm > 0 && (
            <Text style={{ fontSize: 10, color: "#8B5CF6", fontFamily: "Inter_400Regular" }}>
              스마트머니 +{sm.toFixed(0)}억 유입 — 가격 반영 전
            </Text>
          )}
        </View>
      )}
      <TouchableOpacity
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <View style={{
          width: 38, height: 38, backgroundColor: colors.muted,
          borderRadius: 19, alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{item.name}</Text>
            <Text style={{ fontSize: 11, color: meta.color, fontFamily: "Inter_600SemiBold" }}>
              {meta.emoji} {meta.label}
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            {item.stocks.length}종목
          </Text>
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
          <Text style={{ fontSize: 12, color: colors.mutedForeground, paddingTop: 10, paddingBottom: 8, lineHeight: 18, fontFamily: "Inter_400Regular" }}>
            {item.summary}
          </Text>
          {item.stocks.map((stock, i) => (
            <StockRow key={`${stock.ticker}-${i}`} stock={stock} onAnalyze={onAnalyze} colors={colors} />
          ))}
        </View>
      )}
    </View>
  );
}

// ── 내일 종목: 픽 카드 ────────────────────────────────────────────────────

function PickCard({ item, type, colors, onAnalyze }: {
  item: TomorrowPick | PresurgePick; type: "tomorrow" | "presurge"; colors: any;
  onAnalyze: (ticker: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const conf = type === "tomorrow" ? (item as TomorrowPick).confidence : null;
  const score = type === "presurge" ? (item as PresurgePick).score : null;
  const confColor = conf === "high" ? "#16a34a" : conf === "medium" ? "#ca8a04" : "#dc2626";
  const confBg   = conf === "high" ? "#dcfce7" : conf === "medium" ? "#fef9c3" : "#fee2e2";
  const confLabel = conf === "high" ? "신뢰 높음" : conf === "medium" ? "신뢰 보통" : "신뢰 낮음";

  // TouchableOpacity 중첩(button>button) 방지: 외부는 View, 콘텐츠 영역만 터치 핸들링
  return (
    <View style={[s.pickRow, { borderBottomColor: colors.border }]}>
      {/* 왼쪽: 종목 정보 (탭 → 펼침) */}
      <TouchableOpacity
        style={{ flex: 1, gap: 3 }}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{item.ticker}</Text>
          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: colors.mutedForeground, flex: 1 }} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
        {expanded && (
          <View style={{ gap: 6, paddingTop: 8 }}>
            <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_400Regular", lineHeight: 18 }}>{item.reason}</Text>
            {item.themes && item.themes.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                {item.themes.map((t, i) => (
                  <View key={i} style={{ backgroundColor: colors.muted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>

      {/* 오른쪽: 배지 + 분석 버튼 + 펼침 화살표 */}
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        {conf != null && (
          <View style={{ backgroundColor: confBg, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: confColor }}>{confLabel}</Text>
          </View>
        )}
        {score != null && (
          <View style={{ backgroundColor: "#eef2ff", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#6366f1" }}>{score.toFixed(1)}</Text>
          </View>
        )}
        <TouchableOpacity
          onPress={() => onAnalyze(item.ticker, item.name)}
          activeOpacity={0.7}
          style={{
            paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
            borderWidth: 1, borderColor: "#6366f140",
            backgroundColor: "#6366f111",
          }}
        >
          <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6366f1" }}>분석</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setExpanded(v => !v)} hitSlop={8}>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── 수급 레이더: 신호 카드 ───────────────────────────────────────────────

function SignalCard({ signal, colors }: { signal: ThemeSignal; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const strength = signal.strength;
  const strengthColor = strength === "strong" ? "#EF4444" : strength === "moderate" ? "#F97316" : "#94a3b8";
  const strengthBg    = strength === "strong" ? "#FEE2E2" : strength === "moderate" ? "#FFF1EE" : "#F1F5F9";
  const strengthLabel = strength === "strong" ? "강한 신호" : strength === "moderate" ? "보통 신호" : "약한 신호";
  const tickers = signal.tickers ?? signal.stocks ?? [];

  return (
    <TouchableOpacity
      style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => setExpanded(v => !v)}
      activeOpacity={0.7}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>{signal.theme}</Text>
            {strength && (
              <View style={{ backgroundColor: strengthBg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: strengthColor }}>{strengthLabel}</Text>
              </View>
            )}
          </View>
          {signal.signal && (
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{signal.signal}</Text>
          )}
          {expanded && (signal.reason ?? signal.description) && (
            <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 8 }}>
              {signal.reason ?? signal.description}
            </Text>
          )}
          {expanded && tickers.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
              {tickers.map((t, i) => (
                <View key={i} style={{ backgroundColor: colors.muted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export default function ThemesTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("테마 분석");

  // 테마 피드
  const [feed, setFeed] = useState<ThemeFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [feedCachedAt, setFeedCachedAt] = useState<string | null>(null);

  // 내일 종목
  const tomorrow = useTomorrowPicks();
  const presurge = usePresurge();

  // 수급 레이더
  const signals = useThemeSignals();

  const loadFeed = useCallback(async (attempt = 0) => {
    setFeedLoading(true);
    setFeedError(false);
    try {
      const raw = await apiFetch<any>(`/api/themes/trending-feed`);
      const data: ThemeFeedItem[] = Array.isArray(raw) ? raw : (raw.feed ?? []);
      const cachedAt: string | null = Array.isArray(raw) ? null : (raw.cachedAt ?? null);
      if (data.length > 0) {
        setFeed(data);
        if (cachedAt) setFeedCachedAt(cachedAt);
      } else if (attempt < 6) {
        setTimeout(() => loadFeed(attempt + 1), 5000);
        return;
      } else {
        setFeedError(true);
      }
    } catch {
      setFeedError(true);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  function onAnalyze(ticker: string, name: string) {
    router.push(`/analysis/${encodeURIComponent(ticker)}?name=${encodeURIComponent(name)}`);
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const tabActiveColor = (tab: Tab) => {
    if (tab === "테마 분석") return "#6366f1";
    if (tab === "내일 종목") return "#10b981";
    return colors.foreground;
  };

  function onRefresh() {
    if (activeTab === "테마 분석") loadFeed();
    if (activeTab === "내일 종목") {
      // 강제 갱신: ?refresh=1 엔드포인트 호출 후 쿼리 재패치
      apiFetch(`/api/market/tomorrow-picks?refresh=1`)
        .catch(() => {})
        .finally(() => tomorrow.refetch());
      presurge.refetch();
    }
    if (activeTab === "수급 레이더") signals.refetch();
  }

  const isRefreshing =
    activeTab === "내일 종목" ? (tomorrow.isFetching || presurge.isFetching)
    : activeTab === "수급 레이더" ? signals.isFetching
    : false;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Text style={{ fontSize: 20 }}>🔥</Text>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>테마 분석</Text>
        </View>

        {/* 탭 버튼 */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab;
            const activeColor = tabActiveColor(tab);
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[
                  s.tabBtn,
                  { backgroundColor: isActive ? activeColor : colors.muted },
                ]}
              >
                <Text style={[s.tabLabel, { color: isActive ? "#fff" : colors.mutedForeground }]}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── 테마 분석 탭 ─────────────────────────────────── */}
      {activeTab === "테마 분석" && (
        feedLoading ? (
          <View style={s.center}>
            <ActivityIndicator size="small" color="#6366f1" />
            <Text style={[s.loadingText, { color: colors.mutedForeground }]}>AI가 관련주를 분석하는 중… (약 10초)</Text>
          </View>
        ) : feedError ? (
          <View style={s.center}>
            <Feather name="alert-circle" size={32} color={colors.border} />
            <Text style={[s.loadingText, { color: colors.mutedForeground }]}>피드를 불러오지 못했습니다</Text>
            <TouchableOpacity style={[s.retryBtn, { borderColor: "#6366f1" }]} onPress={() => loadFeed()}>
              <Text style={{ fontSize: 13, color: "#6366f1", fontFamily: "Inter_600SemiBold" }}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => loadFeed()} tintColor="#6366f1" />}
          >
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 4 }}>
              최근 3일 기관·외국인 순매수가 집중된 테마와 관련주를 분석합니다 · 3시간마다 갱신
              {feedCachedAt ? ` · ${new Date(feedCachedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 갱신됨` : ""}
            </Text>
            <ThemeForceRanking feed={feed} colors={colors} />
            {[...feed]
              .sort((a, b) => {
                const fa = computeThemeForce(a.stocks)?.avg ?? -Infinity;
                const fb = computeThemeForce(b.stocks)?.avg ?? -Infinity;
                return fb - fa;
              })
              .map((item, idx) => (
                <ThemeCard key={item.id} item={item} idx={idx} onAnalyze={onAnalyze} colors={colors} />
              ))}
          </ScrollView>
        )
      )}

      {/* ── 내일 종목 탭 ─────────────────────────────────── */}
      {activeTab === "내일 종목" && (
        (tomorrow.isLoading || presurge.isLoading) ? (
          <View style={s.center}>
            <ActivityIndicator size="small" color="#10b981" />
            <Text style={[s.loadingText, { color: colors.mutedForeground }]}>분석 중…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#10b981" />}
          >
            {/* 컨셉 안내 카드 */}
            <View style={[s.conceptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Text style={{ fontSize: 16 }}>✨</Text>
                <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.foreground }}>
                  3가지 렌즈로 내일 상승 종목을 찾습니다
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 16, marginBottom: 10 }}>
                서로 다른 지표를 함께 보면 한 지표만으론 놓치는 신호를 줄일 수 있습니다. 여러 리스트에 동시에 등장하는 종목일수록 신뢰도가 높습니다.
              </Text>
              <View style={{ gap: 6 }}>
                {[
                  { n: 1, color: "#EF4444", bg: "#FEE2E2", title: "오늘 수급 폭발 포착",  desc: "실시간 · 거래량 급증 + 기관·외인 매집 · 장중 갱신" },
                  { n: 2, color: "#10b981", bg: "#DCFCE7", title: "내일 급등 예비군",    desc: "기술적 패턴 · 눌림목·거래량 수축→팽창 스캔" },
                  { n: 3, color: "#6366f1", bg: "#E0E7FF", title: "내일 상승 후보",      desc: "테마·검색 트렌드 · 순환매 지연·화제성 포착" },
                ].map(({ n, color, bg, title, desc }) => (
                  <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.muted, padding: 10, borderRadius: 10 }}>
                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color }}>{n}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color }}>{title}</Text>
                      <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* 급등 예비군 */}
            <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 16 }}>⚡</Text>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground }}>급등 예비군</Text>
                <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                  <Text style={{ fontSize: 10, color: "#EF4444", fontFamily: "Inter_600SemiBold" }}>오늘 수급 포착</Text>
                </View>
              </View>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2, fontFamily: "Inter_400Regular" }}>
                거래량 급증 + 기관·외인 매집 실시간 스캔
              </Text>
            </View>
            {(presurge.data?.picks ?? []).length === 0
              ? <EmptyState text="급등 예비군이 없습니다" colors={colors} />
              : (presurge.data?.picks ?? []).map((p, i) => (
                  <PickCard key={`presurge-${i}`} item={p} type="presurge" colors={colors} onAnalyze={onAnalyze} />
                ))
            }

            {/* 내일 상승 후보 */}
            <View style={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 16 }}>🎯</Text>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground }}>내일 상승 후보</Text>
                <View style={{ backgroundColor: "#DCFCE7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                  <Text style={{ fontSize: 10, color: "#16a34a", fontFamily: "Inter_600SemiBold" }}>내일픽</Text>
                </View>
              </View>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2, fontFamily: "Inter_400Regular" }}>
                테마·검색 트렌드 · 순환매 지연·화제성 포착
              </Text>
            </View>
            {(tomorrow.data?.picks ?? []).length === 0
              ? <EmptyState text="내일 픽이 없습니다" colors={colors} />
              : (tomorrow.data?.picks ?? []).map((p, i) => (
                  <PickCard key={`tomorrow-${i}`} item={p} type="tomorrow" colors={colors} onAnalyze={onAnalyze} />
                ))
            }
          </ScrollView>
        )
      )}

      {/* ── 수급 레이더 탭 ───────────────────────────────── */}
      {activeTab === "수급 레이더" && (
        signals.isLoading ? (
          <View style={s.center}>
            <ActivityIndicator size="small" color={colors.foreground} />
            <Text style={[s.loadingText, { color: colors.mutedForeground }]}>신호 분석 중…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.foreground} />}
          >
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 4 }}>
              기관·외국인 수급 신호를 실시간으로 분석합니다
            </Text>
            {(() => {
              const allSignals = signals.data?.signals ?? signals.data?.feed ?? [];
              if (allSignals.length === 0) {
                return <EmptyState text="수급 신호가 없습니다" colors={colors} />;
              }
              const sorted = [...allSignals].sort((a, b) => {
                const order = { strong: 0, moderate: 1, weak: 2 };
                return (order[a.strength ?? "weak"] ?? 2) - (order[b.strength ?? "weak"] ?? 2);
              });
              return sorted.map((sig, i) => (
                <SignalCard key={`${sig.theme}-${i}`} signal={sig} colors={colors} />
              ));
            })()}
          </ScrollView>
        )
      )}
    </View>
  );
}

function EmptyState({ text, colors }: { text: string; colors: any }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 48, gap: 8 }}>
      <Feather name="inbox" size={32} color={colors.border} />
      <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  tabBtn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  tabLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  card: {
    borderRadius: 14, borderWidth: 1, padding: 14,
  },
  cardTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  stockRow: {
    flexDirection: "row", alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  conceptCard: {
    margin: 16, borderRadius: 14, borderWidth: 1, padding: 14,
  },
  center: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24,
  },
  loadingText: {
    fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center",
  },
  retryBtn: {
    marginTop: 4, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
  },
});
