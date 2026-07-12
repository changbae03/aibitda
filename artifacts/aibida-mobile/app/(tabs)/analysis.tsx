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
import { useStockSearch, useRecentAnalyses, usePopular, type StockSearchResult, type AnalysisListItem, type PopularItem } from "@/hooks/useApi";

const SEGS = ["최근 분석", "인기 종목"] as const;
type Seg = typeof SEGS[number];

function VerdictBadge({ verdict }: { verdict?: string | null }) {
  const colors = useColors();
  if (!verdict) return null;
  const v = verdict.toLowerCase();
  if (v.includes("strong buy")) return (
    <View style={{ backgroundColor: "#10b98122", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
      <Text style={{ fontSize: 11, color: "#10b981", fontFamily: "Inter_600SemiBold" }}>강력매수</Text>
    </View>
  );
  if (v.includes("buy")) return (
    <View style={{ backgroundColor: colors.upBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
      <Text style={{ fontSize: 11, color: colors.up, fontFamily: "Inter_600SemiBold" }}>매수</Text>
    </View>
  );
  if (v.includes("hold")) return (
    <View style={{ backgroundColor: "#f59e0b22", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
      <Text style={{ fontSize: 11, color: "#f59e0b", fontFamily: "Inter_600SemiBold" }}>보유</Text>
    </View>
  );
  if (v.includes("sell")) return (
    <View style={{ backgroundColor: colors.downBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 }}>
      <Text style={{ fontSize: 11, color: colors.down, fontFamily: "Inter_600SemiBold" }}>매도</Text>
    </View>
  );
  return null;
}

function StatusDot({ status }: { status: string }) {
  const colors = useColors();
  const color =
    status === "completed" ? colors.up
    : status === "in_progress" || status === "queued" ? "#f59e0b"
    : colors.down;
  const label = status === "completed" ? "완료" : status === "in_progress" ? "진행중" : status === "queued" ? "대기" : "오류";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color, fontFamily: "Inter_400Regular" }}>{label}</Text>
    </View>
  );
}

function AnalysisCard({ item }: { item: AnalysisListItem }) {
  const colors = useColors();
  const router = useRouter();
  const s = makeStyles(colors);
  const isKR = /^\d/.test(item.ticker);
  const date = new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });

  return (
    <Pressable style={s.card} onPress={() => router.push(`/analysis/${item.id}`)}>
      <View style={s.cardRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.ticker}>{item.ticker}</Text>
          <Text style={s.name} numberOfLines={1}>{item.companyName ?? item.englishName ?? ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <VerdictBadge verdict={item.investmentVerdict} />
          <StatusDot status={item.status} />
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {item.targetPrice != null && (
            <Text style={s.meta}>
              목표 {isKR ? item.targetPrice.toLocaleString("ko-KR") + "원" : "$" + item.targetPrice.toLocaleString("en-US")}
            </Text>
          )}
        </View>
        <Text style={s.date}>{date}</Text>
      </View>
    </Pressable>
  );
}

function PopularCard({ item }: { item: PopularItem }) {
  const colors = useColors();
  const router = useRouter();
  const s = makeStyles(colors);
  const isKR = /^\d/.test(item.ticker);
  const outcome = item.outcome;
  const outcomeColor =
    outcome === "hit_target" ? colors.up
    : outcome === "hit_stop" ? colors.down
    : colors.mutedForeground;
  const outcomeLabel =
    outcome === "hit_target" ? "목표달성"
    : outcome === "hit_stop" ? "손절"
    : "진행중";

  return (
    <Pressable style={s.card} onPress={() => router.push(`/analysis/${item.id}`)}>
      <View style={s.cardRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.ticker}>{item.ticker}</Text>
          <Text style={s.name} numberOfLines={1}>{item.companyName}</Text>
          {item.industry ? <Text style={s.industry}>{item.industry}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 5 }}>
          <VerdictBadge verdict={item.investmentVerdict} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: outcomeColor }} />
            <Text style={{ fontSize: 11, color: outcomeColor, fontFamily: "Inter_400Regular" }}>{outcomeLabel}</Text>
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 16 }}>
        {item.targetPrice != null && (
          <Text style={s.meta}>
            목표 {isKR ? item.targetPrice.toLocaleString("ko-KR") + "원" : "$" + item.targetPrice.toLocaleString("en-US")}
          </Text>
        )}
        {item.priceReturn != null && (
          <Text style={[s.meta, { color: item.priceReturn >= 0 ? colors.up : colors.down }]}>
            수익률 {item.priceReturn >= 0 ? "+" : ""}{item.priceReturn.toFixed(1)}%
          </Text>
        )}
        {item.daysElapsed != null && (
          <Text style={s.meta}>{item.daysElapsed}일 경과</Text>
        )}
      </View>
    </Pressable>
  );
}

function SearchResult({ item, onPress }: { item: StockSearchResult; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.muted : "transparent",
      })}
    >
      <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>{item.ticker}</Text>
      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{item.name}</Text>
    </Pressable>
  );
}

export default function AnalysisTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [seg, setSeg] = useState<Seg>("최근 분석");
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const search = useStockSearch(query);
  const recent = useRecentAnalyses();
  const popular = usePopular();

  const s = makeStyles(colors);

  function handleSelectStock(item: StockSearchResult) {
    setShowSearch(false);
    setQuery("");
    router.push({ pathname: "/new-analysis", params: { ticker: item.ticker, name: item.name } });
  }

  const recentData = recent.data ?? [];
  const popularData = popular.data ?? [];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Feather name="cpu" size={18} color={colors.primary} />
        </View>
        <Text style={s.headerTitle}>AI 분석</Text>
        <View style={{ flex: 1 }} />
      </View>

      {/* New analysis CTA */}
      <View style={s.ctaSection}>
        <View style={s.searchBox}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            placeholder="종목명 또는 티커 검색..."
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

        {/* Quick action buttons */}
        {!showSearch && (
          <View style={s.quickRow}>
            <TouchableOpacity
              style={s.quickBtn}
              onPress={() => router.push("/tracker")}
            >
              <Feather name="activity" size={16} color={colors.primary} />
              <Text style={s.quickLabel}>트래커</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.quickBtn}
              onPress={() => router.push("/popular")}
            >
              <Feather name="award" size={16} color={colors.primary} />
              <Text style={s.quickLabel}>인기 분석</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Search results dropdown */}
      {showSearch && query.trim().length >= 1 && (
        <View style={s.dropdown}>
          {search.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ padding: 16 }} />
          ) : (search.data ?? []).length === 0 ? (
            <Text style={s.emptySearch}>검색 결과 없음</Text>
          ) : (
            <FlatList
              data={search.data ?? []}
              keyExtractor={(item) => item.ticker}
              renderItem={({ item }) => (
                <SearchResult item={item} onPress={() => handleSelectStock(item)} />
              )}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 300 }}
            />
          )}
        </View>
      )}

      {/* Segment tabs */}
      {(!showSearch || query.trim().length === 0) && (
        <>
          <View style={s.segRow}>
            {SEGS.map((t) => (
              <TouchableOpacity
                key={t}
                style={[s.segBtn, seg === t && s.segActive]}
                onPress={() => setSeg(t)}
              >
                <Text style={[s.segLabel, seg === t && s.segLabelActive]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Content */}
          {seg === "최근 분석" ? (
            recent.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={recentData}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
                renderItem={({ item }) => <AnalysisCard item={item} />}
                refreshControl={
                  <RefreshControl refreshing={recent.isFetching} onRefresh={() => recent.refetch()} tintColor={colors.primary} />
                }
                ListEmptyComponent={<Text style={s.empty}>아직 분석이 없습니다{"\n"}위에서 종목을 검색해 분석을 시작하세요</Text>}
              />
            )
          ) : (
            popular.isLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={popularData}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
                renderItem={({ item }) => <PopularCard item={item} />}
                refreshControl={
                  <RefreshControl refreshing={popular.isFetching} onRefresh={() => popular.refetch()} tintColor={colors.primary} />
                }
                ListEmptyComponent={<Text style={s.empty}>인기 분석이 없습니다</Text>}
              />
            )
          )}
        </>
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10 },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: c.foreground },
    ctaSection: { paddingHorizontal: 16, gap: 10, marginBottom: 12 },
    searchBox: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: c.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
      borderWidth: 1, borderColor: c.border,
    },
    searchInput: { flex: 1, fontSize: 14, color: c.foreground, fontFamily: "Inter_400Regular", padding: 0 },
    quickRow: { flexDirection: "row", gap: 10 },
    quickBtn: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
      backgroundColor: c.card, borderWidth: 1, borderColor: c.primary + "44",
      paddingVertical: 10, borderRadius: 12,
    },
    quickLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.primary },
    dropdown: {
      marginHorizontal: 16, backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.border, overflow: "hidden", marginBottom: 8,
    },
    emptySearch: { padding: 16, color: c.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" },
    segRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 8 },
    segBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    segActive: { backgroundColor: c.primary + "22", borderColor: c.primary },
    segLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.mutedForeground },
    segLabelActive: { color: c.primary },
    list: { padding: 16, gap: 10 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, gap: 10 },
    cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    ticker: { fontSize: 15, fontFamily: "Inter_700Bold", color: c.foreground },
    name: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    industry: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    meta: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    date: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    empty: { textAlign: "center", color: c.mutedForeground, marginTop: 60, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22 },
  });
}
