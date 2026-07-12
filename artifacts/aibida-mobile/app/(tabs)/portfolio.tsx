import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useStockSearch, useBatchQuotes, useRecentAnalyses,
  type StockSearchResult,
} from "@/hooks/useApi";

const STORAGE_KEY = "watchlist_v2";

interface WatchItem {
  ticker: string;
  name: string;
  addedAt: string;
}

function PriceChange({ change, price, currency }: {
  change: number | null;
  price: number | null;
  currency: string;
}) {
  const colors = useColors();
  if (price == null) return <ActivityIndicator size="small" color={colors.mutedForeground} />;
  const isKR = currency === "KRW" || currency === "KRX";
  const formatted = isKR
    ? price.toLocaleString("ko-KR") + "원"
    : "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function AnalysisBadge({ ticker, analyses }: { ticker: string; analyses: any[] }) {
  const colors = useColors();
  const match = analyses.find((a) => a.ticker === ticker && a.status === "completed");
  if (!match) return null;
  const v = match.investmentVerdict?.toLowerCase() ?? "";
  const color = v.includes("strong buy") ? "#16a34a" : v.includes("buy") ? colors.success : v.includes("sell") ? colors.destructive : "#d97706";
  const bg = v.includes("strong buy") ? "#dcfce7" : v.includes("buy") ? "#dcfce7" : v.includes("sell") ? "#fee2e2" : "#fef9c3";
  const label = v.includes("strong buy") ? "강력매수" : v.includes("buy") ? "매수" : v.includes("sell") ? "매도" : "보유";
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 10, color, fontFamily: "Inter_600SemiBold" }}>{label}</Text>
    </View>
  );
}

export default function PortfolioTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [items, setItems] = useState<WatchItem[]>([]);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(true);

  const search = useStockSearch(query);
  const recentAnalyses = useRecentAnalyses();
  const tickers = items.map((i) => i.ticker);
  const quotes = useBatchQuotes(tickers);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const load = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      setItems(raw ? JSON.parse(raw) : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addItem(stock: StockSearchResult) {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const exists = items.find((i) => i.ticker === stock.ticker);
    if (exists) { Alert.alert("이미 추가됨", `${stock.ticker}는 이미 관심 종목에 있습니다`); return; }
    const next: WatchItem[] = [{ ticker: stock.ticker, name: stock.name, addedAt: new Date().toISOString() }, ...items];
    setItems(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setQuery("");
    setShowSearch(false);
  }

  async function removeItem(ticker: string) {
    Alert.alert("관심 종목 삭제", `${ticker}를 삭제할까요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제", style: "destructive",
        onPress: async () => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          const next = items.filter((i) => i.ticker !== ticker);
          setItems(next);
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        },
      },
    ]);
  }

  const analyses = recentAnalyses.data ?? [];

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>관심 종목</Text>
        <TouchableOpacity onPress={() => quotes.refetch()} style={{ padding: 6 }}>
          <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={[styles.searchSection, { borderBottomColor: colors.border }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="plus" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="종목 추가..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={(v) => { setQuery(v); setShowSearch(true); }}
            onFocus={() => setShowSearch(true)}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(""); setShowSearch(false); }}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Search results */}
      {showSearch && query.trim().length >= 1 ? (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {search.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ padding: 16 }} />
          ) : (search.data ?? []).length === 0 ? (
            <Text style={[styles.emptySearch, { color: colors.mutedForeground }]}>검색 결과 없음</Text>
          ) : (
            (search.data ?? []).slice(0, 8).map((item) => (
              <Pressable
                key={item.ticker}
                style={({ pressed }) => [styles.searchRow, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" }]}
                onPress={() => addItem(item)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.srTicker, { color: colors.foreground }]}>{item.ticker}</Text>
                  <Text style={[styles.srName, { color: colors.mutedForeground }]}>{item.name}</Text>
                </View>
                <Feather name="plus-circle" size={18} color={colors.primary} />
              </Pressable>
            ))
          )}
        </View>
      ) : items.length === 0 ? (
        /* Empty state matching web design */
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="briefcase" size={32} color={colors.mutedForeground} />
            <View style={[styles.emptyIconPlus, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="plus" size={10} color={colors.mutedForeground} />
            </View>
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>종목이 없어요</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            보유 종목이나 관심종목을 추가하면{"\n"}AI가 분석과 이슈를 한눈에 보여드려요
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.foreground }]}
            onPress={() => {
              setShowSearch(true);
              setQuery(" ");
              setTimeout(() => setQuery(""), 50);
            }}
          >
            <Feather name="plus" size={14} color={colors.card} />
            <Text style={[styles.emptyBtnText, { color: colors.card }]}>첫 종목 추가하기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Portfolio summary bar */}
          <View style={[styles.summaryBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryVal, { color: colors.foreground }]}>{items.length}개</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>관심 종목</Text>
            </View>
            {quotes.data && (
              <>
                <View style={[styles.summarySep, { backgroundColor: colors.border }]} />
                <View style={styles.summaryItem}>
                  {quotes.isFetching
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Text style={[styles.summaryVal, { color: colors.foreground }]}>
                        {Object.keys(quotes.data).length}개
                      </Text>
                  }
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>시세 조회</Text>
                </View>
                <View style={[styles.summarySep, { backgroundColor: colors.border }]} />
                <View style={styles.summaryItem}>
                  {(() => {
                    const ups = Object.values(quotes.data).filter(q => (q.change ?? 0) >= 0).length;
                    const dns = Object.values(quotes.data).filter(q => (q.change ?? 0) < 0).length;
                    return (
                      <Text style={[styles.summaryVal, { color: ups >= dns ? colors.up : colors.down }]}>
                        {ups}↑ / {dns}↓
                      </Text>
                    );
                  })()}
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>상승/하락</Text>
                </View>
              </>
            )}
          </View>

          {/* Stock list */}
          <FlatList
            data={items}
            keyExtractor={(item) => item.ticker}
            contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
            refreshControl={
              <RefreshControl
                refreshing={quotes.isFetching}
                onRefresh={() => { quotes.refetch(); recentAnalyses.refetch(); }}
                tintColor={colors.primary}
              />
            }
            renderItem={({ item }) => {
              const q = quotes.data?.[item.ticker];
              return (
                <Pressable
                  style={({ pressed }) => [styles.stockRow, { backgroundColor: pressed ? colors.muted : colors.card, borderBottomColor: colors.border }]}
                  onPress={() => {
                    const a = analyses.find((an) => an.ticker === item.ticker && an.status === "completed");
                    if (a) router.push(`/analysis/${a.id}`);
                    else router.push({ pathname: "/new-analysis", params: { ticker: item.ticker, name: item.name } });
                  }}
                >
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={[styles.stockTicker, { color: colors.foreground }]}>{item.ticker}</Text>
                      <AnalysisBadge ticker={item.ticker} analyses={analyses} />
                    </View>
                    <Text style={[styles.stockName, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <PriceChange
                      price={q?.price ?? null}
                      change={q?.change ?? null}
                      currency={q?.currency ?? "KRW"}
                    />
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  searchSection: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  dropdown: {
    marginHorizontal: 16, marginTop: 4, borderRadius: 12, borderWidth: 1, overflow: "hidden",
  },
  searchRow: {
    flexDirection: "row", alignItems: "center", padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  srTicker: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  srName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  emptySearch: { padding: 16, textAlign: "center", fontFamily: "Inter_400Regular" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    position: "relative",
  },
  emptyIconPlus: {
    position: "absolute", bottom: -4, right: -4,
    width: 22, height: 22, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  emptyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 6,
  },
  emptyBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  summaryBar: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryVal: { fontSize: 16, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summarySep: { width: 1, height: 32 },
  stockRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stockTicker: { fontSize: 15, fontFamily: "Inter_700Bold" },
  stockName: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
