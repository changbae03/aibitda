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
import { useStockSearch, useBatchQuotes, useRecentAnalyses, type StockSearchResult } from "@/hooks/useApi";

const STORAGE_KEY = "watchlist_v2";

interface WatchItem {
  ticker: string;
  name: string;
  addedAt: string;
}

function PriceChange({ change, price, currency }: { change: number | null; price: number | null; currency: string }) {
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
  const color = v.includes("strong buy") ? "#10b981" : v.includes("buy") ? colors.up : v.includes("sell") ? colors.down : "#f59e0b";
  const label = v.includes("strong buy") ? "강력매수" : v.includes("buy") ? "매수" : v.includes("sell") ? "매도" : "보유";
  return (
    <View style={{ backgroundColor: color + "22", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
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

  const s = makeStyles(colors);

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
      <View style={[s.root, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Feather name="star" size={18} color={colors.primary} />
        <Text style={s.headerTitle}>관심 종목</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={() => quotes.refetch()} style={s.refreshBtn}>
          <Feather name="refresh-cw" size={15} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={s.searchSection}>
        <View style={s.searchBox}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            placeholder="종목 추가..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={(v) => { setQuery(v); setShowSearch(true); }}
            onFocus={() => setShowSearch(true)}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(""); setShowSearch(false); }}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Search results */}
      {showSearch && query.trim().length >= 1 && (
        <View style={s.dropdown}>
          {search.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ padding: 16 }} />
          ) : (search.data ?? []).length === 0 ? (
            <Text style={s.emptySearch}>검색 결과 없음</Text>
          ) : (
            (search.data ?? []).slice(0, 8).map((item) => (
              <Pressable
                key={item.ticker}
                style={({ pressed }) => [s.searchRow, { backgroundColor: pressed ? colors.muted : "transparent" }]}
                onPress={() => addItem(item)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.srTicker}>{item.ticker}</Text>
                  <Text style={s.srName}>{item.name}</Text>
                </View>
                <Feather name="plus-circle" size={18} color={colors.primary} />
              </Pressable>
            ))
          )}
        </View>
      )}

      {/* Portfolio summary */}
      {items.length > 0 && !showSearch && (
        <View style={s.summaryBar}>
          <View style={s.summaryItem}>
            <Text style={s.summaryVal}>{items.length}개</Text>
            <Text style={s.summaryLabel}>관심 종목</Text>
          </View>
          {quotes.data && (
            <>
              <View style={s.summarySep} />
              <View style={s.summaryItem}>
                {quotes.isFetching
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Text style={s.summaryVal}>{Object.keys(quotes.data).length}개</Text>
                }
                <Text style={s.summaryLabel}>가격 조회됨</Text>
              </View>
              <View style={s.summarySep} />
              <View style={s.summaryItem}>
                <Text style={[s.summaryVal, {
                  color: Object.values(quotes.data).filter(q => (q.change ?? 0) >= 0).length > Object.values(quotes.data).length / 2
                    ? colors.up : colors.down
                }]}>
                  {Object.values(quotes.data).filter(q => (q.change ?? 0) >= 0).length}↑ /&nbsp;
                  {Object.values(quotes.data).filter(q => (q.change ?? 0) < 0).length}↓
                </Text>
                <Text style={s.summaryLabel}>상승/하락</Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* List */}
      {items.length === 0 && !showSearch ? (
        <View style={s.emptyState}>
          <Feather name="star" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>관심 종목이 없습니다</Text>
          <Text style={s.emptyDesc}>위 검색창에서 종목을 추가하세요</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.ticker}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
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
                style={s.card}
                onPress={() => {
                  const a = analyses.find((an) => an.ticker === item.ticker && an.status === "completed");
                  if (a) router.push(`/analysis/${a.id}`);
                  else router.push({ pathname: "/new-analysis", params: { ticker: item.ticker, name: item.name } });
                }}
              >
                <View style={s.cardRow}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={s.ticker}>{item.ticker}</Text>
                      <AnalysisBadge ticker={item.ticker} analyses={analyses} />
                    </View>
                    <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.date}>
                      {new Date(item.addedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} 추가
                    </Text>
                  </View>
                  <PriceChange
                    price={q?.price ?? null}
                    change={q?.change ?? null}
                    currency={q?.currency ?? "KRW"}
                  />
                </View>

                {/* Actions */}
                <View style={s.actionRow}>
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => router.push({ pathname: "/new-analysis", params: { ticker: item.ticker, name: item.name } })}
                  >
                    <Feather name="cpu" size={13} color={colors.primary} />
                    <Text style={s.actionText}>AI 분석</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.actionBtn, s.deleteBtn]} onPress={() => removeItem(item.ticker)}>
                    <Feather name="trash-2" size={13} color={colors.down} />
                    <Text style={[s.actionText, { color: colors.down }]}>삭제</Text>
                  </TouchableOpacity>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: c.foreground },
    refreshBtn: { padding: 6 },
    searchSection: { paddingHorizontal: 16, marginBottom: 10 },
    searchBox: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: c.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
      borderWidth: 1, borderColor: c.border,
    },
    searchInput: { flex: 1, fontSize: 14, color: c.foreground, fontFamily: "Inter_400Regular", padding: 0 },
    dropdown: {
      marginHorizontal: 16, backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.border, overflow: "hidden", marginBottom: 10,
    },
    searchRow: { flexDirection: "row", alignItems: "center", padding: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    srTicker: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.foreground },
    srName: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    emptySearch: { padding: 16, color: c.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular" },
    summaryBar: {
      flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 12,
      backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border,
    },
    summaryItem: { flex: 1, alignItems: "center", gap: 2 },
    summaryVal: { fontSize: 16, fontFamily: "Inter_700Bold", color: c.foreground },
    summaryLabel: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    summarySep: { width: 1, height: 32, backgroundColor: c.border },
    list: { padding: 16, gap: 10 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, gap: 12 },
    cardRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
    ticker: { fontSize: 15, fontFamily: "Inter_700Bold", color: c.foreground },
    name: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    date: { fontSize: 11, color: c.mutedForeground + "99", fontFamily: "Inter_400Regular" },
    actionRow: { flexDirection: "row", gap: 8 },
    actionBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
      backgroundColor: c.primary + "18", borderRadius: 8, paddingVertical: 7,
      borderWidth: 1, borderColor: c.primary + "33",
    },
    deleteBtn: { backgroundColor: c.down + "18", borderColor: c.down + "33" },
    actionText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: c.primary },
    emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: c.foreground },
    emptyDesc: { fontSize: 13, color: c.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular" },
  });
}
