import { useAuth } from "@clerk/expo";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useStockSearch, useBatchQuotes, useRecentAnalyses, apiFetch,
  type StockSearchResult,
} from "@/hooks/useApi";

const STORAGE_KEY = "watchlist_v2";

interface WatchItem { ticker: string; name: string; addedAt: string; }

// ── 공개 통계 타입 ─────────────────────────────────────────────────────────
interface PublicStats {
  totalAnalyses: number;
  reviewedCount: number;
  hitTargetCount: number;
  hitStopCount: number;
  ongoingCount: number;
  winRate: number | null;
  avgReturn: number | null;
  topTickers: { ticker: string; companyName: string; count: number; winRate: number | null }[];
  recentCases: {
    ticker: string; companyName: string; verdict: string | null;
    priceReturn: number | null; daysElapsed: number | null;
    outcome: string; analysisId: number | null;
  }[];
}

// ── PriceChange ────────────────────────────────────────────────────────────

function PriceChange({ change, price, currency }: { change: number | null; price: number | null; currency: string }) {
  const colors = useColors();
  if (price == null) return <ActivityIndicator size="small" color={colors.mutedForeground} />;
  const isKR = currency === "KRW" || currency === "KRX";
  const formatted = isKR ? price.toLocaleString("ko-KR") + "원" : "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <View style={{ alignItems: "flex-end", gap: 2 }}>
      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.foreground }}>{formatted}</Text>
      {change != null && (
        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: change >= 0 ? colors.up : colors.down }}>
          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
        </Text>
      )}
    </View>
  );
}

// ── AnalysisBadge ──────────────────────────────────────────────────────────

function AnalysisBadge({ ticker, analyses }: { ticker: string; analyses: any[] }) {
  const colors = useColors();
  const match = analyses.find(a => a.ticker === ticker && a.status === "completed");
  if (!match) return null;
  const v = match.investmentVerdict?.toLowerCase() ?? "";
  const color = v.includes("strong buy") ? "#16a34a" : v.includes("buy") ? colors.success : v.includes("sell") ? colors.destructive : "#d97706";
  const bg    = v.includes("strong buy") ? "#dcfce7" : v.includes("buy") ? "#dcfce7" : v.includes("sell") ? "#fee2e2" : "#fef9c3";
  const label = v.includes("strong buy") ? "강력매수" : v.includes("buy") ? "매수" : v.includes("sell") ? "매도" : "보유";
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 10, color, fontFamily: "Inter_600SemiBold" }}>{label}</Text>
    </View>
  );
}

// ── 비로그인 CTA ───────────────────────────────────────────────────────────

function SignInCTA({ colors, insets, router }: { colors: any; insets: any; router: any }) {
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <View style={[s.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>MY</Text>
      </View>
      <View style={s.ctaContainer}>
        <View style={[s.ctaIconBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="star" size={32} color={colors.primary} />
        </View>
        <Text style={[s.ctaTitle, { color: colors.foreground }]}>관심 종목을 저장하세요</Text>
        <Text style={[s.ctaSub, { color: colors.mutedForeground }]}>
          로그인하면 관심 종목과 AI 분석 이력이{"\n"}클라우드에 동기화되어 어디서나 확인할 수 있어요
        </Text>
        <View style={[s.featuresBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { icon: "star",  text: "관심 종목 저장 및 실시간 시세" },
            { icon: "cpu",   text: "AI 분석 이력 보관" },
            { icon: "award", text: "애빛다 투자 통계 확인" },
          ].map(({ icon, text }) => (
            <View key={text} style={[s.featureRow, { borderBottomColor: colors.border }]}>
              <View style={[s.featureIcon, { backgroundColor: colors.primary + "15" }]}>
                <Feather name={icon as any} size={14} color={colors.primary} />
              </View>
              <Text style={[s.featureText, { color: colors.foreground }]}>{text}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[s.loginBtn, { backgroundColor: colors.primary }]} onPress={() => router.push("/(auth)/sign-in")} activeOpacity={0.85}>
          <Feather name="log-in" size={16} color="#fff" />
          <Text style={s.loginBtnText}>로그인하기</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/(auth)/sign-up")}>
          <Text style={[s.signupLink, { color: colors.mutedForeground }]}>
            계정이 없으신가요? <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>회원가입</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── 관심종목 서브탭 ────────────────────────────────────────────────────────

function WatchlistTab({ colors, insets, router }: { colors: any; insets: any; router: any }) {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(true);

  const search = useStockSearch(query);
  const recentAnalyses = useRecentAnalyses();
  const tickers = items.map(i => i.ticker);
  const quotes  = useBatchQuotes(tickers);
  const analyses = recentAnalyses.data ?? [];

  const load = useCallback(async () => {
    try { const raw = await AsyncStorage.getItem(STORAGE_KEY); setItems(raw ? JSON.parse(raw) : []); }
    catch { setItems([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addItem(stock: StockSearchResult) {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (items.find(i => i.ticker === stock.ticker)) { Alert.alert("이미 추가됨", `${stock.ticker}는 이미 관심 종목에 있습니다`); return; }
    const next: WatchItem[] = [{ ticker: stock.ticker, name: stock.name, addedAt: new Date().toISOString() }, ...items];
    setItems(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setQuery(""); setShowSearch(false);
  }

  async function removeItem(ticker: string) {
    Alert.alert("관심 종목 삭제", `${ticker}를 삭제할까요?`, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const next = items.filter(i => i.ticker !== ticker);
        setItems(next);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      }},
    ]);
  }

  if (loading) return <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />;

  return (
    <View style={{ flex: 1 }}>
      {/* 검색창 */}
      <View style={[s.searchSection, { borderBottomColor: colors.border }]}>
        <View style={[s.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="plus" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[s.searchInput, { color: colors.foreground }]}
            placeholder="종목 추가..." placeholderTextColor={colors.mutedForeground}
            value={query} onChangeText={v => { setQuery(v); setShowSearch(true); }}
            onFocus={() => setShowSearch(true)} returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(""); setShowSearch(false); }}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* 검색 결과 드롭다운 */}
      {showSearch && query.trim().length >= 1 && (
        <View style={[s.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {search.isLoading ? <ActivityIndicator color={colors.primary} style={{ padding: 16 }} />
            : (search.data ?? []).length === 0 ? <Text style={[s.emptySearch, { color: colors.mutedForeground }]}>검색 결과 없음</Text>
            : (search.data ?? []).slice(0, 8).map(item => (
              <Pressable key={item.ticker}
                style={({ pressed }) => [s.searchRow, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" }]}
                onPress={() => addItem(item)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.srTicker, { color: colors.foreground }]}>{item.ticker}</Text>
                  <Text style={[s.srName, { color: colors.mutedForeground }]}>{item.name}</Text>
                </View>
                <Feather name="plus-circle" size={18} color={colors.primary} />
              </Pressable>
            ))
          }
        </View>
      )}

      {/* 빈 상태 */}
      {items.length === 0 && !(showSearch && query.trim().length >= 1) ? (
        <View style={s.emptyState}>
          <View style={[s.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="star" size={32} color={colors.mutedForeground} />
          </View>
          <Text style={[s.emptyTitle, { color: colors.foreground }]}>종목이 없어요</Text>
          <Text style={[s.emptySub, { color: colors.mutedForeground }]}>
            관심 종목을 추가하면{"\n"}AI가 분석과 이슈를 한눈에 보여드려요
          </Text>
        </View>
      ) : (
        <>
          {/* 요약 바 */}
          {items.length > 0 && (
            <View style={[s.summaryBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <View style={s.summaryItem}>
                <Text style={[s.summaryVal, { color: colors.foreground }]}>{items.length}개</Text>
                <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>관심 종목</Text>
              </View>
              {quotes.data && (
                <>
                  <View style={[s.summarySep, { backgroundColor: colors.border }]} />
                  <View style={s.summaryItem}>
                    {quotes.isFetching
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Text style={[s.summaryVal, { color: colors.foreground }]}>{Object.keys(quotes.data).length}개</Text>}
                    <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>시세 조회</Text>
                  </View>
                  <View style={[s.summarySep, { backgroundColor: colors.border }]} />
                  <View style={s.summaryItem}>
                    {(() => {
                      const ups = Object.values(quotes.data).filter(q => (q.change ?? 0) >= 0).length;
                      const dns = Object.values(quotes.data).filter(q => (q.change ?? 0) < 0).length;
                      return <Text style={[s.summaryVal, { color: ups >= dns ? colors.up : colors.down }]}>{ups}↑ / {dns}↓</Text>;
                    })()}
                    <Text style={[s.summaryLabel, { color: colors.mutedForeground }]}>상승/하락</Text>
                  </View>
                </>
              )}
            </View>
          )}
          <FlatList
            data={items}
            keyExtractor={item => item.ticker}
            contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
            refreshControl={<RefreshControl refreshing={quotes.isFetching} onRefresh={() => { quotes.refetch(); recentAnalyses.refetch(); }} tintColor={colors.primary} />}
            renderItem={({ item }) => {
              const q = quotes.data?.[item.ticker];
              return (
                <Pressable
                  style={({ pressed }) => [s.stockRow, { backgroundColor: pressed ? colors.muted : colors.card, borderBottomColor: colors.border }]}
                  onPress={() => {
                    const a = analyses.find(an => an.ticker === item.ticker && an.status === "completed");
                    if (a) router.push(`/analysis/${a.id}`);
                    else router.push({ pathname: "/new-analysis", params: { ticker: item.ticker, name: item.name } });
                  }}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={[s.stockTicker, { color: colors.foreground }]}>{item.ticker}</Text>
                      <AnalysisBadge ticker={item.ticker} analyses={analyses} />
                    </View>
                    <Text style={[s.stockName, { color: colors.mutedForeground }]} numberOfLines={1}>{item.name}</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <PriceChange price={q?.price ?? null} change={q?.change ?? null} currency={q?.currency ?? "KRW"} />
                    <TouchableOpacity onPress={() => removeItem(item.ticker)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                      <Feather name="x" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                </Pressable>
              );
            }}
          />
        </>
      )}
    </View>
  );
}

// ── 최근 분석 서브탭 ──────────────────────────────────────────────────────

function RecentAnalysesTab({ colors, insets, router }: { colors: any; insets: any; router: any }) {
  const recentAnalyses = useRecentAnalyses();
  const analyses = recentAnalyses.data ?? [];

  const VERDICT_STYLE: Record<string, { color: string; bg: string }> = {
    "strong buy":  { color: "#16a34a", bg: "#dcfce7" },
    "buy":         { color: "#16a34a", bg: "#dcfce7" },
    "hold":        { color: "#d97706", bg: "#fef9c3" },
    "sell":        { color: "#dc2626", bg: "#fee2e2" },
    "strong sell": { color: "#dc2626", bg: "#fee2e2" },
  };

  function verdictKo(v: string | null) {
    if (!v) return null;
    const l = v.toLowerCase();
    if (l.includes("strong buy")) return "강력매수";
    if (l.includes("buy")) return "매수";
    if (l.includes("strong sell")) return "강력매도";
    if (l.includes("sell")) return "매도";
    if (l.includes("hold")) return "보유";
    return v;
  }

  if (recentAnalyses.isLoading) return <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />;

  if (analyses.length === 0) return (
    <View style={s.emptyState}>
      <Feather name="cpu" size={32} color={colors.border} />
      <Text style={[s.emptyTitle, { color: colors.foreground }]}>분석 이력이 없어요</Text>
      <Text style={[s.emptySub, { color: colors.mutedForeground }]}>
        AI 분석 탭에서 종목을 검색하면{"\n"}분석 이력이 여기에 쌓입니다
      </Text>
    </View>
  );

  return (
    <FlatList
      data={analyses}
      keyExtractor={item => String(item.id ?? item.ticker)}
      contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
      refreshControl={<RefreshControl refreshing={recentAnalyses.isFetching} onRefresh={() => recentAnalyses.refetch()} tintColor={colors.primary} />}
      renderItem={({ item }) => {
        const v = item.investmentVerdict?.toLowerCase() ?? "";
        const vstyle = VERDICT_STYLE[Object.keys(VERDICT_STYLE).find(k => v.includes(k)) ?? ""] ?? { color: colors.mutedForeground, bg: colors.muted };
        const ko = verdictKo(item.investmentVerdict);
        const daysAgo = item.createdAt ? Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 86400000) : null;
        return (
          <Pressable
            style={({ pressed }) => [s.stockRow, { backgroundColor: pressed ? colors.muted : colors.card, borderBottomColor: colors.border }]}
            onPress={() => item.id && router.push(`/analysis/${item.id}`)}
          >
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={[s.stockTicker, { color: colors.foreground }]}>{item.ticker}</Text>
                {ko && (
                  <View style={{ backgroundColor: vstyle.bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: vstyle.color }}>{ko}</Text>
                  </View>
                )}
                {item.status === "generating" && (
                  <View style={{ backgroundColor: colors.primary + "20", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: colors.primary }}>생성 중</Text>
                  </View>
                )}
              </View>
              <Text style={[s.stockName, { color: colors.mutedForeground }]} numberOfLines={1}>{item.companyName ?? item.ticker}</Text>
              {item.targetPrice && (
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  목표가 {Number(item.targetPrice).toLocaleString("ko-KR")}
                  {item.currency === "USD" ? "$" : "원"}
                </Text>
              )}
            </View>
            <View style={{ alignItems: "flex-end", gap: 3 }}>
              {daysAgo != null && (
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                  {daysAgo === 0 ? "오늘" : `${daysAgo}일 전`}
                </Text>
              )}
              <Feather name="chevron-right" size={16} color={colors.border} />
            </View>
          </Pressable>
        );
      }}
    />
  );
}

// ── 통계 서브탭 ────────────────────────────────────────────────────────────

function StatsTab({ colors, insets }: { colors: any; insets: any }) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiFetch<PublicStats>("/api/model-insights/public-stats")
      .then(d => setStats(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <ActivityIndicator color={colors.primary} style={{ flex: 1 }} />;
  if (error || !stats) return (
    <View style={s.emptyState}>
      <Feather name="bar-chart" size={32} color={colors.border} />
      <Text style={[s.emptyTitle, { color: colors.foreground }]}>통계를 불러올 수 없습니다</Text>
    </View>
  );

  const winRatePct  = stats.winRate != null ? (stats.winRate * 100).toFixed(1) : "—";
  const avgRetPct   = stats.avgReturn != null ? ((stats.avgReturn) * 100).toFixed(1) : "—";

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}>
      {/* 헤더 카드 */}
      <View style={[s.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 14 }}>
          🏆 애빛다 AI 성과 요약
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {[
            { label: "총 분석", value: `${stats.totalAnalyses.toLocaleString()}건` },
            { label: "리뷰 완료", value: `${stats.reviewedCount.toLocaleString()}건` },
            { label: "목표 달성", value: `${stats.hitTargetCount.toLocaleString()}건`, color: "#16a34a" },
            { label: "손절 발동", value: `${stats.hitStopCount.toLocaleString()}건`,  color: "#dc2626" },
            { label: "진행 중",  value: `${stats.ongoingCount.toLocaleString()}건` },
          ].map(({ label, value, color }) => (
            <View key={label} style={{ width: "46%", backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 4 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{label}</Text>
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: color ?? colors.foreground }}>{value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 승률 / 평균 수익 */}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={[s.statsHalf, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>AI 승률</Text>
          <Text style={{ fontSize: 28, fontFamily: "Inter_900Black", color: "#16a34a" }}>{winRatePct}%</Text>
          <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>목표 달성 기준</Text>
        </View>
        <View style={[s.statsHalf, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>평균 수익률</Text>
          <Text style={{ fontSize: 28, fontFamily: "Inter_900Black", color: Number(avgRetPct) >= 0 ? "#16a34a" : "#dc2626" }}>
            {Number(avgRetPct) >= 0 ? "+" : ""}{avgRetPct}%
          </Text>
          <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>완료 케이스 기준</Text>
        </View>
      </View>

      {/* 인기 종목 */}
      {stats.topTickers?.length > 0 && (
        <View style={[s.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 12 }}>
            📊 많이 분석된 종목 TOP {Math.min(stats.topTickers.length, 5)}
          </Text>
          {stats.topTickers.slice(0, 5).map((t, i) => (
            <View key={t.ticker} style={[s.topRow, { borderBottomColor: colors.border }]}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: colors.mutedForeground, width: 22 }}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{t.ticker}</Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{t.companyName}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{t.count}건</Text>
                {t.winRate != null && (
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: t.winRate >= 0.5 ? "#16a34a" : "#dc2626" }}>
                    승률 {(t.winRate * 100).toFixed(0)}%
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* 최근 케이스 */}
      {stats.recentCases?.length > 0 && (
        <View style={[s.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 12 }}>
            📋 최근 리뷰 케이스
          </Text>
          {stats.recentCases.slice(0, 5).map((c, i) => {
            const isHit = c.outcome === "hit_target";
            const isStop = c.outcome === "hit_stop";
            return (
              <View key={i} style={[s.topRow, { borderBottomColor: colors.border }]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isHit ? "#16a34a" : isStop ? "#dc2626" : "#94a3b8", marginTop: 4 }} />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{c.ticker}</Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{c.companyName}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 2 }}>
                  {c.priceReturn != null && (
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: c.priceReturn >= 0 ? "#16a34a" : "#dc2626" }}>
                      {c.priceReturn >= 0 ? "+" : ""}{(c.priceReturn * 100).toFixed(1)}%
                    </Text>
                  )}
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                    {isHit ? "목표 달성" : isStop ? "손절" : "진행 중"}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────

type MyTab = "watchlist" | "recent" | "stats";

export default function PortfolioTab() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const [myTab, setMyTab] = useState<MyTab>("watchlist");
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (!isLoaded) return <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>;
  if (!isSignedIn) return <SignInCTA colors={colors} insets={insets} router={router} />;

  const MY_TABS: { key: MyTab; label: string; icon: any }[] = [
    { key: "watchlist", label: "관심종목", icon: "star" },
    { key: "recent",    label: "최근 분석", icon: "clock" },
    { key: "stats",     label: "통계",      icon: "award" },
  ];

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* ── 헤더 ── */}
      <View style={[s.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>MY</Text>
        <TouchableOpacity onPress={() => router.push("/mypage")} style={{ padding: 6 }}>
          <Feather name="user" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* ── 서브탭 바 ── */}
      <View style={[s.subTabBar, { borderBottomColor: colors.border }]}>
        {MY_TABS.map(({ key, label, icon }) => (
          <TouchableOpacity
            key={key}
            style={[s.subTabBtn, myTab === key && { borderBottomColor: colors.primary }]}
            onPress={() => setMyTab(key)}
          >
            <Feather name={icon} size={13} color={myTab === key ? colors.primary : colors.mutedForeground} />
            <Text style={{ fontSize: 13, fontFamily: myTab === key ? "Inter_600SemiBold" : "Inter_400Regular", color: myTab === key ? colors.primary : colors.mutedForeground }}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── 서브탭 콘텐츠 ── */}
      {myTab === "watchlist" && <WatchlistTab colors={colors} insets={insets} router={router} />}
      {myTab === "recent"    && <RecentAnalysesTab colors={colors} insets={insets} router={router} />}
      {myTab === "stats"     && <StatsTab colors={colors} insets={insets} />}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subTabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  subTabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  searchSection: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  dropdown: { marginHorizontal: 16, marginTop: 4, borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  searchRow: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  srTicker: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  srName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  emptySearch: { padding: 16, textAlign: "center", fontFamily: "Inter_400Regular" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  summaryBar: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summarySep: { width: 1, height: 32 },
  stockRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  stockTicker: { fontSize: 15, fontFamily: "Inter_700Bold" },
  stockName: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statsCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 0 },
  statsHalf: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 16, gap: 4, alignItems: "center" },
  topRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  // CTA
  ctaContainer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 16 },
  ctaIconBox: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  ctaTitle: { fontSize: 20, fontFamily: "Inter_700Bold", textAlign: "center" },
  ctaSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 22 },
  featuresBox: { width: "100%", borderRadius: 14, borderWidth: 1, overflow: "hidden", marginTop: 4 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  featureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  loginBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 14, marginTop: 4, width: "100%", justifyContent: "center" },
  loginBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  signupLink: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
