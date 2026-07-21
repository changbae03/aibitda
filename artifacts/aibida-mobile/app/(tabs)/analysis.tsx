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
      <Text style={{ fontSize: 11, color: "#16a34a", fontFamily: "Pretendard-SemiBold" }}>강력매수</Text>
    </View>
  );
  if (v.includes("buy")) return (
    <View style={{ backgroundColor: "#dcfce7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#16a34a", fontFamily: "Pretendard-SemiBold" }}>매수</Text>
    </View>
  );
  if (v.includes("hold")) return (
    <View style={{ backgroundColor: "#fef9c3", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#a16207", fontFamily: "Pretendard-SemiBold" }}>보유</Text>
    </View>
  );
  if (v.includes("sell")) return (
    <View style={{ backgroundColor: "#fee2e2", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#dc2626", fontFamily: "Pretendard-SemiBold" }}>매도</Text>
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
      <Text style={{ fontSize: 11, color, fontFamily: "Pretendard-Regular" }}>{label}</Text>
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
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.muted : colors.background,
      }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      <View style={{ flex: 1, gap: 3 }}>
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
  const inputRef = React.useRef<TextInput>(null);
  const [seg, setSeg] = useState<"최근 분석" | "인기 종목">("최근 분석");
  const [query, setQuery] = useState("");
  const [showDrop, setShowDrop] = useState(false);
  const [selected, setSelected] = useState<StockSearchResult | null>(null);

  const search = useStockSearch(query);
  const recent = useRecentAnalyses();
  const popular = usePopular();

  function pickStock(item: StockSearchResult) {
    setSelected(item);
    setQuery(item.ticker);
    setShowDrop(false);
    inputRef.current?.blur();
  }

  function clearSelection() {
    setSelected(null);
    setQuery("");
    setShowDrop(false);
  }

  function goAnalyze() {
    const target = selected ?? search.data?.[0] ?? null;
    if (!target) return;
    router.push({ pathname: "/new-analysis", params: { ticker: target.ticker, name: target.name } });
  }

  const canStart = !!(selected ?? (query.trim() && search.data && search.data.length > 0));
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
        <View style={[styles.searchRow, {
          backgroundColor: colors.card,
          borderColor: selected ? colors.primary : showDrop ? colors.primary + "88" : colors.border,
        }]}>
          <Feather
            name={selected ? "check-circle" : "search"}
            size={15}
            color={selected ? colors.primary : colors.mutedForeground}
            style={{ marginLeft: 14 }}
          />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="삼성전자, NVDA, 005930, AAPL..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              setSelected(null);
              setShowDrop(v.trim().length > 0);
            }}
            onFocus={() => { if (query.trim().length > 0) setShowDrop(true); }}
            returnKeyType="search"
            onSubmitEditing={goAnalyze}
          />
          {query.length > 0 ? (
            <Pressable onPress={clearSelection} style={styles.searchClear}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.searchBtn, { backgroundColor: canStart ? colors.primary : colors.primary + "44" }]}
            onPress={goAnalyze}
            disabled={!canStart}
          >
            <Text style={[styles.searchBtnText, { color: "#fff" }]}>분석 시작  →</Text>
          </Pressable>
        </View>

        {/* Selected stock name hint */}
        {selected ? (
          <Text style={[styles.heroHint, { color: colors.primary }]}>
            ✓ {selected.name}{selected.sector ? ` · ${selected.sector}` : ""}
          </Text>
        ) : (
          <Text style={[styles.heroHint, { color: colors.mutedForeground }]}>
            ⏱ 평균 3분 만에 리포트 완성
          </Text>
        )}
      </View>

      {/* Dropdown */}
      {showDrop && query.trim().length >= 1 ? (
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
              style={{ maxHeight: 260 }}
              renderItem={({ item }) => (
                <Pressable
                  style={({ pressed }) => [
                    styles.searchResultRow,
                    { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
                  ]}
                  onPress={() => pickStock(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.srTicker, { color: colors.foreground }]}>{item.ticker}</Text>
                    <Text style={[styles.srName, { color: colors.mutedForeground }]}>{item.name}</Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                </Pressable>
              )}
            />
          )}
        </View>
      ) : (
        <>
          {/* Segment */}
          <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
            {(["최근 분석", "인기 종목"] as const).map((t) => (
              <Pressable
                key={t}
                style={({ pressed }) => [{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                  backgroundColor: seg === t ? colors.primary + "12" : "transparent",
                  opacity: pressed ? 0.7 : 1,
                }]}
                onPress={() => setSeg(t)}
              >
                <Text style={{ fontSize: 13, fontFamily: seg === t ? "Pretendard-SemiBold" : "Pretendard-Regular", color: seg === t ? colors.primary : colors.mutedForeground }}>{t}</Text>
              </Pressable>
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
  heroTitle: { fontSize: 30, fontFamily: "Pretendard-Bold", lineHeight: 38 },
  heroSub: { fontSize: 13, lineHeight: 19, fontFamily: "Pretendard-Regular" },
  searchRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 12, borderWidth: 1, overflow: "hidden",
    marginTop: 6,
  },
  searchInput: {
    flex: 1, fontSize: 14, fontFamily: "Pretendard-Regular",
    paddingVertical: 13, paddingHorizontal: 10, padding: 0,
  },
  searchClear: { padding: 10 },
  searchBtn: {
    paddingHorizontal: 14, paddingVertical: 13,
    alignItems: "center", justifyContent: "center",
  },
  searchBtnText: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
  heroHint: { fontSize: 11, fontFamily: "Pretendard-Regular", textAlign: "center" },
  dropdown: {
    marginHorizontal: 16, borderRadius: 12, borderWidth: 1, overflow: "hidden", marginBottom: 8,
  },
  searchResultRow: {
    padding: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  srTicker: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  srName: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },
  emptySearch: { padding: 16, textAlign: "center", fontFamily: "Pretendard-Regular" },
  segRow: {
    flexDirection: "row", paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 0,
  },
  list: { paddingTop: 4 },
  row: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTicker: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  rowName: { fontSize: 12, fontFamily: "Pretendard-Regular", flex: 1 },
  rowMeta: { fontSize: 11, fontFamily: "Pretendard-Regular" },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  emptySub: { fontSize: 13, fontFamily: "Pretendard-Regular", lineHeight: 20 },
});
