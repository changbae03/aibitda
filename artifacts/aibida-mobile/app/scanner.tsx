import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState, useCallback, useEffect } from "react";
import {
  ActivityIndicator, FlatList, Platform, Pressable,
  RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/hooks/useApi";

interface ScannerItem {
  id: number;
  ticker: string;
  companyName: string;
  englishName: string | null;
  industry: string | null;
  investmentVerdict: string;
  targetPrice: number;
  startPrice: number | null;
  currentPrice: number | null;
  upside: number | null;
  todayChangePct: number | null;
  analysisDate: string;
}

type Market = "ALL" | "KR" | "US";
type SortBy = "upside" | "today" | "recent";

const MARKET_TABS: { key: Market; label: string }[] = [
  { key: "ALL", label: "전체" },
  { key: "KR",  label: "한국" },
  { key: "US",  label: "미국" },
];

const UPSIDE_OPTIONS = [
  { value: 10, label: "10%+" },
  { value: 20, label: "20%+" },
  { value: 30, label: "30%+" },
  { value: 50, label: "50%+" },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "upside",  label: "상승여력순" },
  { value: "today",   label: "오늘 낙폭순" },
  { value: "recent",  label: "최신 분석순" },
];

function isKRTicker(t: string) { return /^\d{5,6}$/.test(t); }

function fmtPrice(price: number, isKR: boolean) {
  if (isKR) return price.toLocaleString("ko-KR") + "원";
  return "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function UpsideBadge({ pct, colors }: { pct: number; colors: any }) {
  const bg = pct >= 50 ? "#10b981" : pct >= 30 ? "#22c55e" : "#3b82f6";
  return (
    <View style={{ backgroundColor: bg + "22", borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: bg + "44" }}>
      <Text style={{ fontSize: 14, fontFamily: "Pretendard-Bold", color: bg }}>+{pct.toFixed(1)}%</Text>
    </View>
  );
}

function TodayChange({ pct, colors }: { pct: number | null; colors: any }) {
  if (pct == null) return <Text style={{ fontSize: 13, color: colors.mutedForeground }}>-</Text>;
  const isUp = pct >= 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      <Feather name={isUp ? "trending-up" : "trending-down"} size={10} color={isUp ? "#ef4444" : "#3b82f6"} />
      <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: isUp ? "#ef4444" : "#3b82f6" }}>
        {isUp ? "+" : ""}{pct.toFixed(2)}%
      </Text>
    </View>
  );
}

function VerdictBadge({ verdict, colors }: { verdict: string; colors: any }) {
  const isStrong = verdict === "Strong Buy";
  const bg = isStrong ? "#10b981" : "#22c55e";
  const label = isStrong ? "높은 상승여력" : "상승여력";
  return (
    <View style={{ backgroundColor: bg + "22", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: bg + "44" }}>
      <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: bg }}>{label}</Text>
    </View>
  );
}

function ScannerRow({ item, colors }: { item: ScannerItem; colors: any }) {
  const router = useRouter();
  const isKR = isKRTicker(item.ticker);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.muted : colors.card, borderBottomColor: colors.border }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      {/* 좌측: 종목 정보 */}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{item.companyName}</Text>
          <View style={{
            backgroundColor: isKR ? "#3b82f620" : "#8b5cf620",
            borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
          }}>
            <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: isKR ? "#3b82f6" : "#8b5cf6" }}>
              {isKR ? "KR" : "US"}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: colors.mutedForeground, fontVariant: ["tabular-nums"] }}>
            {item.ticker}
          </Text>
          {item.industry ? (
            <>
              <Text style={{ fontSize: 12, color: colors.mutedForeground + "60" }}>·</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }} numberOfLines={1}>{item.industry}</Text>
            </>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 }}>
          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
            현재 {item.currentPrice != null ? fmtPrice(item.currentPrice, isKR) : "–"}
          </Text>
          <Text style={{ fontSize: 12, color: colors.mutedForeground + "60" }}>→</Text>
          <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: colors.primary }}>
            목표 {fmtPrice(item.targetPrice, isKR)}
          </Text>
        </View>
      </View>

      {/* 우측: 뱃지 */}
      <View style={{ alignItems: "flex-end", gap: 5, marginLeft: 8 }}>
        {item.upside != null && <UpsideBadge pct={item.upside} colors={colors} />}
        <TodayChange pct={item.todayChangePct} colors={colors} />
        <VerdictBadge verdict={item.investmentVerdict} colors={colors} />
      </View>

      <Feather name="chevron-right" size={14} color={colors.mutedForeground + "60"} style={{ marginLeft: 6 }} />
    </Pressable>
  );
}

export default function ScannerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [market, setMarket]     = useState<Market>("ALL");
  const [minUpside, setMinUpside] = useState(10);
  const [sortBy, setSortBy]     = useState<SortBy>("upside");
  const [items, setItems]       = useState<ScannerItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data: ScannerItem[] = await apiFetch(`/api/analysis/scanner?market=${market}&minUpside=${minUpside}`);
      setItems(data);
      setRefreshedAt(new Date());
    } catch (e: any) {
      setError(e.message ?? "불러오기 실패");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [market, minUpside]);

  useEffect(() => { load(); }, [load]);

  const sorted = [...items].sort((a, b) => {
    if (sortBy === "upside") return (b.upside ?? 0) - (a.upside ?? 0);
    if (sortBy === "today")  return (a.todayChangePct ?? 0) - (b.todayChangePct ?? 0);
    return new Date(b.analysisDate).getTime() - new Date(a.analysisDate).getTime();
  });

  const topPad = Platform.OS === "web" ? 16 : insets.top;
  const botPad = Platform.OS === "web" ? 84 : insets.bottom + 80;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: topPad + 10, borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="zap" size={16} color={colors.primary} />
            <Text style={{ fontSize: 19, fontFamily: "Pretendard-Bold", color: colors.foreground }}>저평가 스캐너</Text>
          </View>
          <TouchableOpacity onPress={() => load(true)} style={{ marginLeft: "auto" }} hitSlop={12}>
            <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", marginTop: 4 }}>
          AI 적정주가 대비 현재가가 낮은 종목 발굴 · 5분 캐시
        </Text>
      </View>

      {/* 필터 */}
      <View style={[styles.filterWrap, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        {/* 시장 탭 */}
        <View style={{ flexDirection: "row", gap: 6, padding: 8, backgroundColor: colors.muted + "60", borderRadius: 10, alignSelf: "flex-start" }}>
          {MARKET_TABS.map(t => (
            <TouchableOpacity
              key={t.key}
              onPress={() => setMarket(t.key)}
              style={{
                paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
                backgroundColor: market === t.key ? colors.card : "transparent",
              }}
            >
              <Text style={{
                fontSize: 14, fontFamily: market === t.key ? "Pretendard-SemiBold" : "Pretendard-Regular",
                color: market === t.key ? colors.foreground : colors.mutedForeground,
              }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 최소 상승여력 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>최소 상승여력</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {UPSIDE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setMinUpside(opt.value)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                  backgroundColor: minUpside === opt.value ? colors.primary + "22" : "transparent",
                  borderColor: minUpside === opt.value ? colors.primary + "66" : colors.border,
                }}
              >
                <Text style={{
                  fontSize: 13, fontFamily: "Pretendard-Medium",
                  color: minUpside === opt.value ? colors.primary : colors.mutedForeground,
                }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 정렬 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>정렬</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setSortBy(opt.value)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
                  backgroundColor: sortBy === opt.value ? colors.muted : "transparent",
                  borderColor: sortBy === opt.value ? colors.border : colors.border + "80",
                }}
              >
                <Text style={{
                  fontSize: 13, fontFamily: "Pretendard-Medium",
                  color: sortBy === opt.value ? colors.foreground : colors.mutedForeground,
                }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* 결과 개수 */}
      {!loading && (
        <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 14, color: colors.mutedForeground }}>
            {sorted.length}개 종목 발굴됨
            {refreshedAt ? (
              <Text style={{ opacity: 0.6 }}>
                {" "}· {refreshedAt.getHours().toString().padStart(2, "0")}:{refreshedAt.getMinutes().toString().padStart(2, "0")} 기준
              </Text>
            ) : null}
          </Text>
        </View>
      )}

      {/* 리스트 */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ fontSize: 15, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>현재가 조회 중…</Text>
          <Text style={{ fontSize: 13, color: colors.mutedForeground + "80", fontFamily: "Pretendard-Regular" }}>종목별 시세를 실시간으로 가져오고 있습니다</Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Feather name="alert-circle" size={32} color={colors.destructive} />
          <Text style={{ fontSize: 16, color: colors.destructive }}>{error}</Text>
          <TouchableOpacity onPress={() => load()} style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.primary + "22", borderRadius: 8 }}>
            <Text style={{ color: colors.primary, fontFamily: "Pretendard-Medium" }}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: botPad }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
          renderItem={({ item }) => <ScannerRow item={item} colors={colors} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
              <Feather name="search" size={36} color={colors.border} />
              <Text style={{ fontSize: 17, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>
                조건에 맞는 종목이 없습니다
              </Text>
              <Text style={{ fontSize: 15, color: colors.mutedForeground }}>
                상승여력 기준을 낮춰보세요
              </Text>
            </View>
          }
          ListFooterComponent={
            sorted.length > 0 ? (
              <Text style={{ fontSize: 12, color: colors.mutedForeground + "60", textAlign: "center", paddingVertical: 16, fontFamily: "Pretendard-Regular" }}>
                최근 6개월 내 AI 분석 기준 · 투자 판단의 최종 책임은 투자자 본인에게 있습니다
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterWrap: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
