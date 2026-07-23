import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator, FlatList, Pressable, RefreshControl,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useTracker, useBatchQuotes } from "@/hooks/useApi";

function verdictLabel(v: string | null) {
  if (!v) return { label: "보유", color: "#f59e0b" };
  const s = v.toLowerCase();
  if (s.includes("strong buy"))  return { label: "높은 상승여력", color: "#10b981" };
  if (s.includes("buy"))         return { label: "상승여력",     color: "#22c55e" };
  if (s.includes("strong sell")) return { label: "높은 하락여지", color: "#60a5fa" };
  if (s.includes("sell"))        return { label: "하락여지",     color: "#93c5fd" };
  return { label: "보유", color: "#f59e0b" };
}

function ProgressBar({ current, entry, target }: { current: number; entry: number | null; target: number | null }) {
  const colors = useColors();
  if (!entry || !target) return null;

  const min = Math.min(entry, target) * 0.95;
  const max = Math.max(entry, target) * 1.05;
  const range = max - min;

  const entryPct = Math.max(0, Math.min(100, ((entry - min) / range) * 100));
  const targetPct = Math.max(0, Math.min(100, ((target - min) / range) * 100));
  const currentPct = Math.max(0, Math.min(100, ((current - min) / range) * 100));

  const isUp = target > entry;
  const progress = isUp
    ? Math.max(0, Math.min(100, ((current - entry) / (target - entry)) * 100))
    : Math.max(0, Math.min(100, ((entry - current) / (entry - target)) * 100));

  return (
    <View style={{ gap: 6 }}>
      <View style={{ height: 6, backgroundColor: colors.muted, borderRadius: 3, overflow: "hidden" }}>
        <View
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${progress}%`,
            backgroundColor: isUp ? colors.up : colors.down,
            borderRadius: 3,
          }}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
          진입 {entry >= 1000 ? entry.toLocaleString("ko-KR") + "원" : "$" + entry.toFixed(2)}
        </Text>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
          목표 {target >= 1000 ? target.toLocaleString("ko-KR") + "원" : "$" + target.toFixed(2)}
        </Text>
      </View>
    </View>
  );
}

export default function TrackerScreen() {
  const colors = useColors();
  const router = useRouter();
  const tracker = useTracker();
  const items = tracker.data ?? [];
  const tickers = items.map((i) => i.ticker);
  const quotes = useBatchQuotes(tickers);

  const REFRESH = 30_000;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      quotes.refetch();
    }, REFRESH);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const s = makeStyles(colors);
  const isLoading = tracker.isLoading;

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>트래커</Text>
          <Text style={s.headerSub}>AI 분석 목표가 추적</Text>
        </View>
        <TouchableOpacity onPress={() => { tracker.refetch(); quotes.refetch(); }} style={s.refreshBtn}>
          {quotes.isFetching
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
          }
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.empty}>
          <Feather name="activity" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyTitle}>추적 중인 분석이 없습니다</Text>
          <Text style={s.emptyDesc}>AI 분석을 완료하면 자동으로 트래커에 추가됩니다</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={tracker.isFetching}
              onRefresh={() => { tracker.refetch(); quotes.refetch(); }}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => {
            const q = quotes.data?.[item.ticker];
            const currentPrice = q?.price ?? null;
            const isKR = /^\d/.test(item.ticker);
            const fmt = (p: number) =>
              isKR ? p.toLocaleString("ko-KR") + "원" : "$" + p.toFixed(2);

            const upside =
              currentPrice && item.targetPrice
                ? ((item.targetPrice - currentPrice) / currentPrice) * 100
                : null;

            const badge = verdictLabel(item.investmentVerdict);

            return (
              <Pressable style={s.card} onPress={() => router.push(`/analysis/${item.id}`)}>
                {/* Top row */}
                <View style={s.cardTop}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={s.ticker}>{item.ticker}</Text>
                      <View style={[s.verdictBadge, { backgroundColor: badge.color + "22" }]}>
                        <Text style={[s.verdictText, { color: badge.color }]}>{badge.label}</Text>
                      </View>
                    </View>
                    <Text style={s.company} numberOfLines={1}>{item.companyName}</Text>
                    {item.industry ? <Text style={s.industry}>{item.industry}</Text> : null}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {currentPrice != null ? (
                      <>
                        <Text style={s.currentPrice}>{fmt(currentPrice)}</Text>
                        {q?.change != null && (
                          <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: q.change >= 0 ? colors.up : colors.down }}>
                            {q.change >= 0 ? "▲" : "▼"} {Math.abs(q.change).toFixed(2)}%
                          </Text>
                        )}
                      </>
                    ) : (
                      <ActivityIndicator size="small" color={colors.mutedForeground} />
                    )}
                  </View>
                </View>

                {/* Progress bar */}
                {currentPrice && (
                  <ProgressBar
                    current={currentPrice}
                    entry={item.entryPrice}
                    target={item.targetPrice}
                  />
                )}

                {/* Upside */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  {upside != null && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>남은 상승여력</Text>
                      <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: upside >= 0 ? colors.up : colors.down }}>
                        {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                      </Text>
                    </View>
                  )}
                  <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
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
    headerTitle: { fontSize: 22, fontFamily: "Pretendard-Bold", color: c.foreground },
    headerSub: { fontSize: 14, color: c.mutedForeground, fontFamily: "Pretendard-Regular" },
    refreshBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    list: { padding: 16, gap: 12, paddingBottom: 40 },
    card: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.border, gap: 12 },
    cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
    ticker: { fontSize: 18, fontFamily: "Pretendard-Bold", color: c.foreground },
    company: { fontSize: 14, color: c.mutedForeground, fontFamily: "Pretendard-Regular" },
    industry: { fontSize: 13, color: c.mutedForeground + "99", fontFamily: "Pretendard-Regular" },
    currentPrice: { fontSize: 18, fontFamily: "Pretendard-Bold", color: c.foreground },
    verdictBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
    verdictText: { fontSize: 13, fontFamily: "Pretendard-SemiBold" },
    empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
    emptyTitle: { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: c.foreground },
    emptyDesc: { fontSize: 15, color: c.mutedForeground, textAlign: "center", fontFamily: "Pretendard-Regular", lineHeight: 20 },
  });
}
