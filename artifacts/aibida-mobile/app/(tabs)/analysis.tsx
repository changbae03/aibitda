import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useStockSearch, type StockSearchResult } from "@/hooks/useApi";
import { useListAnalyses } from "@workspace/api-client-react";

function VerdictBadge({ verdict }: { verdict?: string }) {
  const colors = useColors();
  if (!verdict) return null;
  const map: Record<string, { color: string; label: string }> = {
    BUY: { color: colors.up, label: "매수" },
    SELL: { color: colors.down, label: "매도" },
    HOLD: { color: colors.warning, label: "보유" },
    WATCH: { color: colors.mutedForeground, label: "관찰" },
  };
  const v = verdict.toUpperCase();
  const c = map[v] ?? { color: colors.mutedForeground, label: verdict };
  return (
    <View style={[styles.badge, { backgroundColor: c.color + "22" }]}>
      <Text style={[styles.badgeText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

function AnalysisRow({ item }: { item: any }) {
  const colors = useColors();
  const router = useRouter();

  return (
    <Pressable
      onPress={() => router.push(`/analysis/${item.id}` as any)}
      style={({ pressed }) => [
        styles.analysisRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.analysisMain}>
        <View style={styles.analysisTop}>
          <Text
            style={[styles.companyName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {item.companyName}
          </Text>
          <VerdictBadge verdict={item.investmentVerdict} />
        </View>
        <Text style={[styles.industryText, { color: colors.mutedForeground }]}>
          {item.industry}
        </Text>
        <View style={styles.analysisFooter}>
          <Text style={[styles.tickerText, { color: colors.mutedForeground }]}>
            {item.ticker}
          </Text>
          {item.targetPrice && (
            <Text style={[styles.priceText, { color: colors.primary }]}>
              목표 {item.targetPrice.toLocaleString("ko-KR")}원
            </Text>
          )}
          <Text style={[styles.dateText, { color: colors.mutedForeground }]}>
            {new Date(item.createdAt).toLocaleDateString("ko-KR", {
              month: "short",
              day: "numeric",
            })}
          </Text>
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

function SearchResultRow({
  item,
  onPress,
}: {
  item: StockSearchResult;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.searchRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.searchRowLeft}>
        <Text style={[styles.searchName, { color: colors.foreground }]}>
          {item.name}
        </Text>
        <Text style={[styles.searchTicker, { color: colors.mutedForeground }]}>
          {item.ticker}
        </Text>
      </View>
      <View style={styles.searchRowRight}>
        {item.market && (
          <View style={[styles.marketTag, { backgroundColor: colors.accent }]}>
            <Text style={[styles.marketTagText, { color: colors.mutedForeground }]}>
              {item.market}
            </Text>
          </View>
        )}
        <Feather name="search" size={14} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function AnalysisScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const { data: analyses, isLoading: analysesLoading } = useListAnalyses();
  const { data: searchResults, isLoading: searchLoading } =
    useStockSearch(debouncedQuery);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(t);
  }, [query]);

  const showSearch = query.trim().length > 0;
  const topPad = Platform.OS === "web" ? 67 : insets.top;

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
          AI 분석
        </Text>
      </View>

      <View
        style={[
          styles.searchBar,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            marginHorizontal: 16,
            marginTop: 12,
            marginBottom: 8,
          },
        ]}
      >
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="종목명 또는 티커 검색"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery("")}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {showSearch ? (
        <FlatList
          data={searchResults ?? []}
          keyExtractor={(item) => item.ticker}
          renderItem={({ item }) => (
            <SearchResultRow
              item={item}
              onPress={() =>
                router.push(`/analysis/new?ticker=${item.ticker}&name=${encodeURIComponent(item.name)}` as any)
              }
            />
          )}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 100,
            gap: 8,
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            searchLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : debouncedQuery.length > 0 ? (
              <View style={styles.centered}>
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  검색 결과가 없어요
                </Text>
              </View>
            ) : null
          }
        />
      ) : (
        <FlatList
          data={analyses ?? []}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }) => <AnalysisRow item={item} />}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 100,
            gap: 8,
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text
              style={[styles.sectionTitle, { color: colors.mutedForeground }]}
            >
              최근 분석
            </Text>
          }
          ListEmptyComponent={
            analysesLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Feather
                  name="file-text"
                  size={32}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.emptyText, { color: colors.mutedForeground }]}
                >
                  아직 분석이 없어요
                </Text>
                <Text
                  style={[styles.emptySubText, { color: colors.mutedForeground }]}
                >
                  종목을 검색해 AI 분석을 시작하세요
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
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 4,
    marginTop: 4,
  },
  analysisRow: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  analysisMain: { flex: 1, gap: 4 },
  analysisTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  companyName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold", flex: 1 },
  industryText: { fontSize: 12 },
  analysisFooter: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  tickerText: { fontSize: 12 },
  priceText: { fontSize: 12, fontWeight: "600" },
  dateText: { fontSize: 11, marginLeft: "auto" },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  searchRow: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchRowLeft: { flex: 1, gap: 2 },
  searchName: { fontSize: 14, fontWeight: "500" },
  searchTicker: { fontSize: 12 },
  searchRowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  marketTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  marketTagText: { fontSize: 11 },
  centered: { paddingVertical: 40, alignItems: "center" },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14 },
  emptySubText: { fontSize: 13 },
});
