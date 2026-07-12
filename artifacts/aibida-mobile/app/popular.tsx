import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { usePopular, type PopularItem } from "@/hooks/useApi";

const SORT_OPTIONS = [
  { key: "recent", label: "최신순" },
  { key: "return",  label: "수익률순" },
] as const;
type SortKey = "recent" | "return";

function VerdictBadge({ verdict }: { verdict: string | null }) {
  const colors = useColors();
  if (!verdict) return null;
  const v = verdict.toLowerCase();
  if (v.includes("strong buy"))
    return <View style={{ backgroundColor: "#10b98122", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: "#10b981", fontFamily: "Inter_600SemiBold" }}>강력매수</Text>
    </View>;
  if (v.includes("buy"))
    return <View style={{ backgroundColor: colors.upBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, color: colors.up, fontFamily: "Inter_600SemiBold" }}>매수</Text>
    </View>;
  return null;
}

function OutcomeBadge({ outcome, ret }: { outcome: string | null; ret: number | null }) {
  const colors = useColors();
  if (!outcome || outcome === "pending") return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#f59e0b" }} />
      <Text style={{ fontSize: 11, color: "#f59e0b", fontFamily: "Inter_400Regular" }}>진행중</Text>
    </View>
  );
  if (outcome === "hit_target") return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Feather name="target" size={11} color={colors.up} />
      <Text style={{ fontSize: 11, color: colors.up, fontFamily: "Inter_600SemiBold" }}>목표달성</Text>
      {ret != null && <Text style={{ fontSize: 11, color: colors.up, fontFamily: "Inter_700Bold" }}>+{ret.toFixed(1)}%</Text>}
    </View>
  );
  if (outcome === "hit_stop") return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Feather name="shield" size={11} color={colors.down} />
      <Text style={{ fontSize: 11, color: colors.down, fontFamily: "Inter_600SemiBold" }}>손절</Text>
      {ret != null && <Text style={{ fontSize: 11, color: colors.down, fontFamily: "Inter_700Bold" }}>{ret.toFixed(1)}%</Text>}
    </View>
  );
  return null;
}

export default function PopularScreen() {
  const colors = useColors();
  const router = useRouter();
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const popular = usePopular();

  const s = makeStyles(colors);
  const items = (popular.data ?? []).slice().sort((a, b) => {
    if (sortBy === "return") {
      const ra = a.priceReturn ?? -999;
      const rb = b.priceReturn ?? -999;
      return rb - ra;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const hitCount = items.filter((i) => i.outcome === "hit_target").length;
  const totalOutcome = items.filter((i) => i.outcome && i.outcome !== "pending").length;
  const winRate = totalOutcome > 0 ? Math.round((hitCount / totalOutcome) * 100) : null;

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>인기 분석</Text>
          <Text style={s.headerSub}>AI 추천 공개 분석 목록</Text>
        </View>
      </View>

      {/* Stats bar */}
      {!popular.isLoading && items.length > 0 && (
        <View style={s.statsBar}>
          <View style={s.statItem}>
            <Text style={s.statVal}>{items.length}개</Text>
            <Text style={s.statLabel}>총 분석</Text>
          </View>
          <View style={s.statSep} />
          <View style={s.statItem}>
            <Text style={s.statVal}>{hitCount}개</Text>
            <Text style={s.statLabel}>목표 달성</Text>
          </View>
          {winRate != null && (
            <>
              <View style={s.statSep} />
              <View style={s.statItem}>
                <Text style={[s.statVal, { color: winRate >= 50 ? colors.up : colors.down }]}>
                  {winRate}%
                </Text>
                <Text style={s.statLabel}>승률</Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* Sort */}
      <View style={s.sortRow}>
        {SORT_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[s.sortBtn, sortBy === opt.key && s.sortActive]}
            onPress={() => setSortBy(opt.key)}
          >
            <Text style={[s.sortLabel, sortBy === opt.key && s.sortLabelActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {popular.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={popular.isFetching} onRefresh={() => popular.refetch()} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <Text style={s.empty}>인기 분석이 없습니다</Text>
          }
          renderItem={({ item }: { item: PopularItem }) => {
            const isKR = /^\d/.test(item.ticker);
            return (
              <Pressable style={s.card} onPress={() => router.push(`/analysis/${item.id}`)}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={s.ticker}>{item.ticker}</Text>
                      <VerdictBadge verdict={item.investmentVerdict} />
                    </View>
                    <Text style={s.company} numberOfLines={1}>{item.companyName}</Text>
                    {item.industry ? <Text style={s.industry}>{item.industry}</Text> : null}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    <OutcomeBadge outcome={item.outcome} ret={item.priceReturn} />
                    {item.daysElapsed != null && (
                      <Text style={s.elapsed}>{item.daysElapsed}일 경과</Text>
                    )}
                  </View>
                </View>

                <View style={s.cardBottom}>
                  {item.targetPrice != null && (
                    <View style={s.metaItem}>
                      <Text style={s.metaLabel}>목표가</Text>
                      <Text style={s.metaVal}>
                        {isKR
                          ? item.targetPrice.toLocaleString("ko-KR") + "원"
                          : "$" + item.targetPrice.toFixed(2)}
                      </Text>
                    </View>
                  )}
                  {item.entryPrice != null && (
                    <View style={s.metaItem}>
                      <Text style={s.metaLabel}>진입가</Text>
                      <Text style={s.metaVal}>
                        {isKR
                          ? item.entryPrice.toLocaleString("ko-KR") + "원"
                          : "$" + item.entryPrice.toFixed(2)}
                      </Text>
                    </View>
                  )}
                  <Text style={s.date}>
                    {new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: c.foreground },
    headerSub: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    statsBar: {
      flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 10,
      backgroundColor: c.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border,
    },
    statItem: { flex: 1, alignItems: "center", gap: 2 },
    statVal: { fontSize: 16, fontFamily: "Inter_700Bold", color: c.foreground },
    statLabel: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    statSep: { width: 1, height: 30, backgroundColor: c.border },
    sortRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 8 },
    sortBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    sortActive: { backgroundColor: c.primary + "22", borderColor: c.primary },
    sortLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.mutedForeground },
    sortLabelActive: { color: c.primary },
    list: { padding: 16, gap: 10, paddingBottom: 40 },
    card: { backgroundColor: c.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border, gap: 12 },
    cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
    ticker: { fontSize: 16, fontFamily: "Inter_700Bold", color: c.foreground },
    company: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    industry: { fontSize: 11, color: c.mutedForeground + "99", fontFamily: "Inter_400Regular" },
    elapsed: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    cardBottom: { flexDirection: "row", alignItems: "center", gap: 16 },
    metaItem: { gap: 1 },
    metaLabel: { fontSize: 10, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    metaVal: { fontSize: 13, color: c.foreground, fontFamily: "Inter_600SemiBold" },
    date: { marginLeft: "auto", fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    empty: { textAlign: "center", color: c.mutedForeground, marginTop: 60, fontFamily: "Inter_400Regular", fontSize: 14 },
  });
}
