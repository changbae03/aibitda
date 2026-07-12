import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useStockSearch, type StockSearchResult } from "@/hooks/useApi";

const WATCHLIST_KEY = "aibida:watchlist:v1";

interface WatchItem {
  ticker: string;
  name: string;
  market?: string;
  addedAt: string;
}

function useWatchlist() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(WATCHLIST_KEY)
      .then((v) => {
        if (v) setItems(JSON.parse(v));
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (next: WatchItem[]) => {
    setItems(next);
    await AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  }, []);

  const add = useCallback(
    (item: WatchItem) => {
      setItems((prev) => {
        if (prev.some((p) => p.ticker === item.ticker)) return prev;
        const next = [item, ...prev];
        AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const remove = useCallback(
    (ticker: string) => {
      setItems((prev) => {
        const next = prev.filter((p) => p.ticker !== ticker);
        AsyncStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const has = useCallback(
    (ticker: string) => items.some((i) => i.ticker === ticker),
    [items]
  );

  return { items, loaded, add, remove, has };
}

function WatchRow({
  item,
  onRemove,
}: {
  item: WatchItem;
  onRemove: () => void;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.watchRow,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.watchMain}>
        <Text style={[styles.watchName, { color: colors.foreground }]}>
          {item.name}
        </Text>
        <Text style={[styles.watchTicker, { color: colors.mutedForeground }]}>
          {item.ticker}
          {item.market ? ` · ${item.market}` : ""}
        </Text>
      </View>
      <Text style={[styles.watchDate, { color: colors.mutedForeground }]}>
        {new Date(item.addedAt).toLocaleDateString("ko-KR", {
          month: "short",
          day: "numeric",
        })}
      </Text>
      <Pressable
        onPress={onRemove}
        hitSlop={12}
        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
      >
        <Feather name="x" size={16} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function SearchRow({
  item,
  inWatch,
  onAdd,
}: {
  item: StockSearchResult;
  inWatch: boolean;
  onAdd: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.searchRow,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.searchMain}>
        <Text style={[styles.watchName, { color: colors.foreground }]}>
          {item.name}
        </Text>
        <Text style={[styles.watchTicker, { color: colors.mutedForeground }]}>
          {item.ticker}
          {item.market ? ` · ${item.market}` : ""}
        </Text>
      </View>
      <Pressable
        onPress={onAdd}
        disabled={inWatch}
        style={({ pressed }) => [
          styles.addBtn,
          {
            backgroundColor: inWatch ? colors.accent : colors.primary,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.addBtnText,
            {
              color: inWatch ? colors.mutedForeground : colors.primaryForeground,
            },
          ]}
        >
          {inWatch ? "추가됨" : "추가"}
        </Text>
      </Pressable>
    </View>
  );
}

export default function PortfolioScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { items, loaded, add, remove, has } = useWatchlist();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const { data: searchResults, isLoading: searchLoading } =
    useStockSearch(debouncedQuery);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  function handleAdd(item: StockSearchResult) {
    add({
      ticker: item.ticker,
      name: item.name,
      market: item.market,
      addedAt: new Date().toISOString(),
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleRemove(ticker: string) {
    Alert.alert("관심종목 삭제", "목록에서 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          remove(ticker);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        },
      },
    ]);
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = Platform.OS === "web" ? 34 + 84 : insets.bottom + 100;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          관심종목
        </Text>
        <Pressable
          onPress={() => {
            setShowSearch((v) => !v);
            if (!showSearch) setQuery("");
          }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Feather
            name={showSearch ? "x" : "plus"}
            size={22}
            color={colors.primary}
          />
        </Pressable>
      </View>

      {showSearch && (
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              marginHorizontal: 16,
              marginTop: 12,
              marginBottom: 4,
            },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="종목명 또는 티커 추가"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoFocus
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      )}

      {showSearch && debouncedQuery.length > 0 ? (
        <FlatList
          data={searchResults ?? []}
          keyExtractor={(item) => item.ticker}
          renderItem={({ item }) => (
            <SearchRow
              item={item}
              inWatch={has(item.ticker)}
              onAdd={() => handleAdd(item)}
            />
          )}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: botPad,
            gap: 8,
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            searchLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.centered}>
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  검색 결과가 없어요
                </Text>
              </View>
            )
          }
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.ticker}
          renderItem={({ item }) => (
            <WatchRow item={item} onRemove={() => handleRemove(item.ticker)} />
          )}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: botPad,
            gap: 8,
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            !loaded ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Feather
                  name="star"
                  size={32}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  관심종목이 없어요
                </Text>
                <Text
                  style={[
                    styles.emptySubText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  + 버튼을 눌러 종목을 추가해보세요
                </Text>
              </View>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14 },
  watchRow: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  watchMain: { flex: 1, gap: 3 },
  watchName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  watchTicker: { fontSize: 12 },
  watchDate: { fontSize: 11 },
  searchRow: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchMain: { flex: 1, gap: 3 },
  addBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { fontSize: 13, fontWeight: "600" },
  centered: { paddingVertical: 40, alignItems: "center" },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14 },
  emptySubText: { fontSize: 13 },
});
