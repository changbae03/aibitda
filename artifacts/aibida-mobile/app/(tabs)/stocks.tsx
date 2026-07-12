import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SkeletonList } from "@/components/SkeletonCard";
import { useColors } from "@/hooks/useColors";
import { useScanner, type ScannerItem } from "@/hooks/useApi";

const MARKETS = ["ALL", "KR", "US"] as const;
type Market = typeof MARKETS[number];
const MARKET_LABELS: Record<Market, string> = { ALL: "전체", KR: "한국", US: "미국" };
const UPSIDE_OPTIONS = [10, 20, 30, 50];

const SORT_OPTIONS = [
  { value: "upside",  label: "상승여력순" },
  { value: "today",   label: "오늘 낙폭순" },
  { value: "recent",  label: "최신 분석순" },
] as const;
type SortBy = typeof SORT_OPTIONS[number]["value"];

function MarketBadge({ ticker }: { ticker: string }) {
  const isKR = /^\d/.test(ticker);
  return (
    <View style={{
      backgroundColor: isKR ? "#eff6ff" : "#f0fdf4",
      paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
    }}>
      <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: isKR ? "#3b82f6" : "#16a34a" }}>
        {isKR ? "KR" : "US"}
      </Text>
    </View>
  );
}

function UpsidePill({ pct }: { pct: number }) {
  const color = pct >= 50 ? "#059669" : pct >= 30 ? "#16a34a" : "#2563eb";
  const bg    = pct >= 50 ? "#dcfce7" : pct >= 30 ? "#d1fae5" : "#dbeafe";
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color }}>+{pct.toFixed(1)}%</Text>
    </View>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const isStrong = verdict.toLowerCase().includes("strong");
  return (
    <View style={{
      backgroundColor: isStrong ? "#dcfce7" : "#d1fae5",
      paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
      borderWidth: 1, borderColor: isStrong ? "#86efac" : "#6ee7b7",
    }}>
      <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: isStrong ? "#059669" : "#16a34a" }}>
        {isStrong ? "높은 상승여력" : "상승여력"}
      </Text>
    </View>
  );
}

function TodayChange({ pct }: { pct: number | null }) {
  const colors = useColors();
  if (pct === null) return <Text style={{ fontSize: 12, color: colors.mutedForeground }}>-</Text>;
  const isUp = pct >= 0;
  return (
    <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: isUp ? "#EF4444" : "#3B82F6" }}>
      {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
    </Text>
  );
}

function ScannerRow({ item }: { item: ScannerItem }) {
  const colors = useColors();
  const router = useRouter();
  const isKR   = /^\d/.test(item.ticker);
  const fmtPrice = (v: number) =>
    isKR
      ? `${v.toLocaleString("ko-KR")}원`
      : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <Pressable
      style={[s.scannerRow, { borderBottomColor: colors.border }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      {/* 종목 정보 */}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[s.companyName, { color: colors.foreground }]}>{item.companyName}</Text>
          <MarketBadge ticker={item.ticker} />
        </View>
        <Text style={[s.ticker, { color: colors.mutedForeground }]}>
          {item.ticker}{item.industry ? `  ·  ${item.industry}` : ""}
        </Text>
        {/* 현재가 → 목표가 */}
        {item.currentPrice != null && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Text style={[s.priceText, { color: colors.foreground }]}>{fmtPrice(item.currentPrice)}</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>→</Text>
            <Text style={[s.priceText, { color: "#FF8A7A" }]}>{fmtPrice(item.targetPrice)}</Text>
            <TodayChange pct={item.todayChangePct} />
          </View>
        )}
      </View>

      {/* 우측: 상승여력 + 버딧 */}
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        {item.upside != null && <UpsidePill pct={item.upside} />}
        <VerdictBadge verdict={item.investmentVerdict} />
      </View>

      <Feather name="chevron-right" size={16} color={colors.border} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

export default function StocksTab() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const [market, setMarket]       = useState<Market>("ALL");
  const [minUpside, setMinUpside] = useState(10);
  const [sortBy, setSortBy]       = useState<SortBy>("upside");

  const scanner = useScanner(market, minUpside);
  const topPad  = Platform.OS === "web" ? 67 : insets.top;

  const sorted = [...(scanner.data ?? [])].sort((a, b) => {
    if (sortBy === "upside") return (b.upside ?? 0) - (a.upside ?? 0);
    if (sortBy === "today")  return (a.todayChangePct ?? 0) - (b.todayChangePct ?? 0);
    return new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime();
  });

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* 헤더 */}
      <View style={[s.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
          <Text style={{ fontSize: 18 }}>⚡</Text>
          <Text style={[s.headerTitle, { color: colors.foreground }]}>저평가 스캐너</Text>
          {scanner.data && (
            <Text style={[s.countLabel, { color: colors.mutedForeground }]}>{sorted.length}개 발굴됨</Text>
          )}
        </View>
        <Text style={[s.headerSub, { color: colors.mutedForeground }]}>
          AI 적정주가 대비 현재가가 낮은 종목 발굴 · 5분 캐시
        </Text>
      </View>

      {/* 시장 필터 탭 */}
      <View style={[s.filterRow, { borderBottomColor: colors.border }]}>
        <View style={[s.marketTabs, { backgroundColor: colors.muted }]}>
          {MARKETS.map(m => (
            <TouchableOpacity
              key={m}
              onPress={() => setMarket(m)}
              style={[s.marketTab, market === m && { backgroundColor: colors.background }]}
            >
              <Text style={[s.marketTabLabel, {
                color: market === m ? colors.foreground : colors.mutedForeground,
                fontFamily: market === m ? "Inter_600SemiBold" : "Inter_400Regular",
              }]}>
                {MARKET_LABELS[m]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 상승여력 + 정렬 필터 */}
      <View style={[s.filterRow2, { borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 6, paddingVertical: 8 }}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular", alignSelf: "center", marginRight: 2 }}>최소 상승여력</Text>
          {UPSIDE_OPTIONS.map(v => (
            <TouchableOpacity
              key={v}
              onPress={() => setMinUpside(v)}
              style={[s.chip, {
                backgroundColor: minUpside === v ? "#FFF1EE" : colors.card,
                borderColor: minUpside === v ? "#FF8A7A" : colors.border,
              }]}
            >
              <Text style={[s.chipText, { color: minUpside === v ? "#FF8A7A" : colors.foreground }]}>{v}%+</Text>
            </TouchableOpacity>
          ))}
          {/* 구분선 */}
          <View style={{ width: 1, backgroundColor: colors.border, marginHorizontal: 4 }} />
          {SORT_OPTIONS.map(opt => (
            <TouchableOpacity
              key={opt.value}
              onPress={() => setSortBy(opt.value)}
              style={[s.chip, {
                backgroundColor: sortBy === opt.value ? colors.foreground : colors.card,
                borderColor: sortBy === opt.value ? colors.foreground : colors.border,
              }]}
            >
              <Text style={[s.chipText, { color: sortBy === opt.value ? colors.card : colors.foreground }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* 리스트 */}
      {scanner.isLoading ? (
        <SkeletonList count={6} />
      ) : scanner.isError ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Feather name="alert-circle" size={32} color={colors.border} />
          <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            데이터를 불러올 수 없습니다
          </Text>
          <TouchableOpacity
            style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: "#FF8A7A" }}
            onPress={() => scanner.refetch()}
          >
            <Text style={{ fontSize: 13, color: "#FF8A7A", fontFamily: "Inter_600SemiBold" }}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : sorted.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Feather name="search" size={32} color={colors.border} />
          <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            조건에 맞는 종목이 없습니다
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
          refreshControl={
            <RefreshControl refreshing={scanner.isFetching} onRefresh={() => scanner.refetch()} tintColor="#FF8A7A" />
          }
        >
          {sorted.map(item => <ScannerRow key={item.id} item={item} />)}
          <Text style={{ fontSize: 10, color: colors.mutedForeground, textAlign: "center", paddingVertical: 16, fontFamily: "Inter_400Regular" }}>
            최근 6개월 내 AI 분석 기준 · 투자 판단의 최종 책임은 투자자 본인에게 있습니다
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  headerSub:   { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  countLabel:  { fontSize: 12, fontFamily: "Inter_400Regular" },
  filterRow:   { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  filterRow2:  { borderBottomWidth: StyleSheet.hairlineWidth },
  marketTabs:  { flexDirection: "row", padding: 3, borderRadius: 10, alignSelf: "flex-start" },
  marketTab:   { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  marketTabLabel: { fontSize: 13 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  scannerRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  companyName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  ticker: { fontSize: 11, fontFamily: "Inter_400Regular" },
  priceText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
