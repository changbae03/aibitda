import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useStockSearch, useRecentAnalyses, usePopular,
  type StockSearchResult, type AnalysisListItem, type PopularItem,
} from "@/hooks/useApi";

function VerdictBadge({ verdict }: { verdict?: string | null }) {
  const colors = useColors();
  if (!verdict) return null;
  const v = verdict.toLowerCase();
  if (v.includes("strong buy")) return (
    <View style={{ backgroundColor: "#dcfce7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#16a34a", fontFamily: "Inter_600SemiBold" }}>강력매수</Text>
    </View>
  );
  if (v.includes("buy")) return (
    <View style={{ backgroundColor: "#dcfce7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#16a34a", fontFamily: "Inter_600SemiBold" }}>매수</Text>
    </View>
  );
  if (v.includes("hold")) return (
    <View style={{ backgroundColor: "#fef9c3", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#a16207", fontFamily: "Inter_600SemiBold" }}>보유</Text>
    </View>
  );
  if (v.includes("sell")) return (
    <View style={{ backgroundColor: "#fee2e2", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#dc2626", fontFamily: "Inter_600SemiBold" }}>매도</Text>
    </View>
  );
  return null;
}

function StatusDot({ status }: { status: string }) {
  const colors = useColors();
  const color =
    status === "completed" ? colors.success
    : status === "in_progress" || status === "queued" ? "#d97706"
    : colors.destructive;
  const label =
    status === "completed" ? "완료"
    : status === "in_progress" ? "진행중"
    : status === "queued" ? "대기"
    : "오류";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color, fontFamily: "Inter_400Regular" }}>{label}</Text>
    </View>
  );
}

function AnalysisRow({ item }: { item: AnalysisListItem }) {
  const colors = useColors();
  const router = useRouter();
  const date = new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  const isKR = /^\d/.test(item.ticker);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.rowTicker, { color: colors.foreground }]}>{item.ticker}</Text>
          <Text style={[styles.rowName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.companyName ?? item.englishName ?? ""}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusDot status={item.status} />
          {item.targetPrice != null && (
            <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>
              목표 {isKR ? item.targetPrice.toLocaleString("ko-KR") + "원" : "$" + item.targetPrice.toFixed(2)}
            </Text>
          )}
          <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>{date}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <VerdictBadge verdict={item.investmentVerdict} />
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

function PopularRow({ item }: { item: PopularItem }) {
  const colors = useColors();
  const router = useRouter();
  const isKR = /^\d/.test(item.ticker);
  const outcomeColor =
    item.outcome === "hit_target" ? colors.success
    : item.outcome === "hit_stop" ? colors.destructive
    : colors.mutedForeground;
  const outcomeLabel =
    item.outcome === "hit_target" ? "목표달성"
    : item.outcome === "hit_stop" ? "손절"
    : "진행중";
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.rowTicker, { color: colors.foreground }]}>{item.ticker}</Text>
          <Text style={[styles.rowName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.companyName}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: outcomeColor }} />
            <Text style={[styles.rowMeta, { color: outcomeColor }]}>{outcomeLabel}</Text>
          </View>
          {item.priceReturn != null && (
            <Text style={[styles.rowMeta, { color: item.priceReturn >= 0 ? colors.success : colors.destructive }]}>
              {item.priceReturn >= 0 ? "+" : ""}{item.priceReturn.toFixed(1)}%
            </Text>
          )}
          {item.daysElapsed != null && (
            <Text style={[styles.rowMeta, { color: colors.mutedForeground }]}>{item.daysElapsed}일 경과</Text>
          )}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <VerdictBadge verdict={item.investmentVerdict} />
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function AnalysisTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [seg, setSeg] = useState<"최근 분석" | "인기 종목">("최근 분석");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const search = useStockSearch(query);
  const recent = useRecentAnalyses();
  const popular = usePopular();

  function handleSelect(item: StockSearchResult) {
    setSearching(false);
    setQuery("");
    router.push({ pathname: "/new-analysis", params: { ticker: item.ticker, name: item.name } });
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Hero section */}
      <View style={[styles.hero, { paddingTop: topPad + 20 }]}>
        <Text style={[styles.heroTitle, { color: colors.foreground }]}>
          어떤 종목을{"\n"}분석할까요?
        </Text>
        <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
          코스피·코스닥·NYSE·NASDAQ 종목코드 또는{"\n"}회사명으로 검색하면 AI가 심층 분석합니다
        </Text>

        {/* Search row */}
        <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} style={{ marginLeft: 14 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="삼성전자, NVDA, 005930, AAPL..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={(v) => { setQuery(v); setSearching(true); }}
            onFocus={() => setSearching(true)}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => { setQuery(""); setSearching(false); }} style={styles.searchClear}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.searchBtn, { backgroundColor: colors.primary + (query.trim() ? "ff" : "55") }]}
            onPress={() => {
              const first = search.data?.[0];
              if (first) handleSelect(first);
            }}
            disabled={!query.trim()}
          >
            <Text style={[styles.searchBtnText, { color: "#fff" }]}>분석 시작  →</Text>
          </Pressable>
        </View>
        <Text style={[styles.heroHint, { color: colors.mutedForeground }]}>
          ⏱ 평균 3분 만에 리포트 완성
        </Text>
      </View>

      {/* Search results */}
      {searching && query.trim().length >= 1 ? (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {search.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ padding: 20 }} />
          ) : (search.data ?? []).length === 0 ? (
            <Text style={[styles.emptySearch, { color: colors.mutedForeground }]}>검색 결과 없음</Text>
          ) : (
            <FlatList
              data={search.data ?? []}
              keyExtractor={(item) => item.ticker}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 280 }}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [styles.searchResultRow, { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" }]}
                  onPress={() => handleSelect(item)}
                >
                  <Text style={[styles.srTicker, { color: colors.foreground }]}>{item.ticker}</Text>
                  <Text style={[styles.srName, { color: colors.mutedForeground }]}>{item.name}</Text>
                </Pressable>
              )}
            />
          )}
        </View>
      ) : (
        <>
          {/* Quick links */}
          <View style={[styles.quickRow, { borderTopColor: colors.border }]}>
            <TouchableOpacity style={[styles.quickBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push("/tracker")}>
              <Feather name="activity" size={14} color={colors.primary} />
              <Text style={[styles.quickLabel, { color: colors.foreground }]}>실시간 트래커</Text>
              <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.quickBtn, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push("/popular")}>
              <Feather name="award" size={14} color={colors.primary} />
              <Text style={[styles.quickLabel, { color: colors.foreground }]}>인기 분석</Text>
              <Feather name="chevron-right" size={13} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* Segment */}
          <View style={[styles.segRow, { borderBottomColor: colors.border }]}>
            {(["최근 분석", "인기 종목"] as const).map((t) => (
              <TouchableOpacity key={t} style={[styles.segBtn, seg === t && { borderBottomColor: colors.foreground }]} onPress={() => setSeg(t)}>
                <Text style={[styles.segLabel, { color: seg === t ? colors.foreground : colors.mutedForeground }]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* List */}
          {seg === "최근 분석" ? (
            recent.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={recent.data ?? []}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={[styles.list, { paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }]}
                renderItem={({ item }) => <AnalysisRow item={item} />}
                refreshControl={<RefreshControl refreshing={recent.isFetching} onRefresh={() => recent.refetch()} tintColor={colors.primary} />}
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <Feather name="cpu" size={36} color={colors.border} />
                    <Text style={[styles.emptyTitle, { color: colors.foreground }]}>아직 분석이 없습니다</Text>
                    <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>위에서 종목을 검색해 분석을 시작하세요</Text>
                  </View>
                }
              />
            )
          ) : (
            popular.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={popular.data ?? []}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={[styles.list, { paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }]}
                renderItem={({ item }) => <PopularRow item={item} />}
                refreshControl={<RefreshControl refreshing={popular.isFetching} onRefresh={() => popular.refetch()} tintColor={colors.primary} />}
                ListEmptyComponent={<Text style={[styles.emptySub, { color: colors.mutedForeground, textAlign: "center", marginTop: 60 }]}>인기 분석이 없습니다</Text>}
              />
            )
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  hero: { paddingHorizontal: 20, paddingBottom: 20, gap: 10 },
  heroTitle: { fontSize: 30, fontFamily: "Inter_700Bold", lineHeight: 38 },
  heroSub: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 12, borderWidth: 1, overflow: "hidden",
    marginTop: 6,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: "Inter_400Regular",
    paddingVertical: 13, paddingHorizontal: 10, padding: 0,
  },
  searchClear: { padding: 10 },
  searchBtn: {
    paddingHorizontal: 14, paddingVertical: 13,
    alignItems: "center", justifyContent: "center",
  },
  searchBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  heroHint: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center" },
  dropdown: {
    marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: "hidden", marginBottom: 8,
  },
  searchResultRow: {
    padding: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  srTicker: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  srName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  emptySearch: { padding: 16, textAlign: "center", fontFamily: "Inter_400Regular" },
  quickRow: {
    flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12,
  },
  quickBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  quickLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  segRow: {
    flexDirection: "row", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
  },
  segBtn: {
    paddingVertical: 10, paddingHorizontal: 4, marginRight: 20,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  segLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  list: { paddingTop: 4 },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTicker: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rowName: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  rowMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
