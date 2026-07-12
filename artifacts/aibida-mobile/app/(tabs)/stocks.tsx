import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Platform, Pressable, RefreshControl, ScrollView,
  StyleSheet, Text, TouchableOpacity, View, ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SkeletonList } from "@/components/SkeletonCard";
import { useColors } from "@/hooks/useColors";
import {
  usePresurge, useTomorrowPicks, useScanner,
  type PresurgePick, type TomorrowPick, type ScannerItem,
} from "@/hooks/useApi";

const SEGS = ["내일픽", "급등예비군", "저평가 스캐너"] as const;
type Seg = typeof SEGS[number];

const MARKETS = ["ALL", "KR", "US"] as const;
type Market = typeof MARKETS[number];
const MARKET_LABELS: Record<Market, string> = { ALL: "전체", KR: "한국", US: "미국" };
const UPSIDE_OPTIONS = [10, 20, 30, 50];

function MarketBadge({ ticker }: { ticker: string }) {
  const isKR = /^\d/.test(ticker);
  return (
    <View style={{ backgroundColor: isKR ? "#eff6ff" : "#f0fdf4", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
      <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: isKR ? "#3b82f6" : "#16a34a" }}>
        {isKR ? "KR" : "US"}
      </Text>
    </View>
  );
}

function UpsidePill({ pct }: { pct: number }) {
  const color = pct >= 50 ? "#059669" : pct >= 30 ? "#16a34a" : "#22c55e";
  return (
    <View style={{ backgroundColor: "#dcfce7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color }}>+{pct.toFixed(1)}%</Text>
    </View>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const isStrong = verdict.toLowerCase().includes("strong buy");
  const bgColor = isStrong ? "#dcfce7" : "#d1fae5";
  const textColor = isStrong ? "#059669" : "#16a34a";
  const label = isStrong ? "높은 상승여력" : "상승여력";
  return (
    <View style={{ backgroundColor: bgColor, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: textColor }}>{label}</Text>
    </View>
  );
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    high:   { bg: "#dcfce7", fg: "#16a34a", label: "신뢰도 높음" },
    medium: { bg: "#fef9c3", fg: "#a16207", label: "신뢰도 보통" },
    low:    { bg: "#fee2e2", fg: "#dc2626", label: "신뢰도 낮음" },
  };
  const c = cfg[confidence] ?? cfg.medium;
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.fg }}>{c.label}</Text>
    </View>
  );
}

function TodayChange({ pct }: { pct: number | null }) {
  const colors = useColors();
  if (pct === null) return <Text style={{ fontSize: 12, color: colors.mutedForeground }}>-</Text>;
  const isUp = pct >= 0;
  return (
    <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: isUp ? colors.up : colors.down }}>
      {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
    </Text>
  );
}

// ── Pick card ──────────────────────────────────────────────────────────────
function PickRow({ item, type }: { item: TomorrowPick | PresurgePick; type: "tomorrow" | "presurge" }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  return (
    <Pressable
      style={[styles.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
      onPress={() => {
        if (Platform.OS !== "web") Haptics.selectionAsync();
        setExpanded((v) => !v);
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.ticker, { color: colors.foreground }]}>{item.ticker}</Text>
          <MarketBadge ticker={item.ticker} />
          <Text style={[styles.name, { color: colors.mutedForeground }]} numberOfLines={1}>{item.name}</Text>
        </View>
        {expanded && (
          <View style={{ gap: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 6 }}>
            <Text style={[styles.reason, { color: colors.foreground }]}>{item.reason}</Text>
            {item.themes && item.themes.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                {item.themes.map((t, i) => (
                  <View key={i} style={{ backgroundColor: colors.muted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        {type === "tomorrow"
          ? <ConfidenceBadge confidence={(item as TomorrowPick).confidence} />
          : (
            <View style={{ backgroundColor: colors.primary + "22", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: colors.primary }}>
                {(item as PresurgePick).score?.toFixed(1) ?? "-"}</Text>
            </View>
          )
        }
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

// ── Scanner row ──────────────────────────────────────────────────────────
function ScannerRow({ item }: { item: ScannerItem }) {
  const colors = useColors();
  const router = useRouter();
  const isKR = item.currentPrice != null && item.currentPrice >= 1000;
  const fmt = (v: number) => isKR ? v.toLocaleString("ko-KR") + "원" : "$" + v.toLocaleString("en-US");

  return (
    <Pressable
      style={[styles.scannerRow, { borderBottomColor: colors.border }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      {/* Left info */}
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[styles.ticker, { color: colors.foreground }]}>{item.companyName}</Text>
          <MarketBadge ticker={item.ticker} />
        </View>
        <Text style={[styles.name, { color: colors.mutedForeground }]}>
          {item.ticker}{item.industry ? `  ·  ${item.industry}` : ""}
        </Text>
        {item.currentPrice != null && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.price, { color: colors.foreground }]}>{fmt(item.currentPrice)}</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground }}>→</Text>
            {item.targetPrice != null && (
              <Text style={[styles.price, { color: colors.success }]}>{fmt(item.targetPrice)}</Text>
            )}
            <TodayChange pct={item.todayChangePct} />
          </View>
        )}
      </View>

      {/* Right: upside + verdict */}
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        {item.upside != null && <UpsidePill pct={item.upside} />}
        <VerdictBadge verdict={item.investmentVerdict} />
      </View>
    </Pressable>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function StocksTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Seg>("내일픽");
  const [market, setMarket] = useState<Market>("ALL");
  const [minUpside, setMinUpside] = useState(10);

  const tomorrow = useTomorrowPicks();
  const presurge = usePresurge();
  const scanner = useScanner(market, minUpside);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const isLoading =
    seg === "내일픽" ? tomorrow.isLoading
    : seg === "급등예비군" ? presurge.isLoading
    : scanner.isLoading;

  function refresh() {
    tomorrow.refetch();
    presurge.refetch();
    if (seg === "저평가 스캐너") scanner.refetch();
  }

  const isScannerSeg = seg === "저평가 스캐너";

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {isScannerSeg ? "⚡ 저평가 스캐너" : "종목 신호"}
          </Text>
          {isScannerSeg && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              AI 적정주가 대비 현재가가 낮은 종목 발굴 · 5분 캐시
            </Text>
          )}
        </View>
        {isScannerSeg && scanner.data && (
          <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
            {scanner.data.length}개 발굴됨
          </Text>
        )}
      </View>

      {/* Segment row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.segScroll, { borderBottomColor: colors.border }]}>
        <View style={styles.segInner}>
          {SEGS.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.segBtn, seg === t && { borderBottomColor: colors.foreground }]}
              onPress={() => setSeg(t)}
            >
              <Text style={[styles.segLabel, { color: seg === t ? colors.foreground : colors.mutedForeground }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Scanner filters */}
      {isScannerSeg && (
        <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 14, gap: 6, paddingVertical: 10 }}>
            {MARKETS.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.chip, { backgroundColor: market === m ? colors.foreground : colors.card, borderColor: colors.border }]}
                onPress={() => setMarket(m)}
              >
                <Text style={[styles.chipText, { color: market === m ? colors.card : colors.foreground }]}>{MARKET_LABELS[m]}</Text>
              </TouchableOpacity>
            ))}
            <View style={[styles.chipDivider, { backgroundColor: colors.border }]} />
            {UPSIDE_OPTIONS.map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.chip, { backgroundColor: minUpside === v ? colors.primary : colors.card, borderColor: minUpside === v ? colors.primary : colors.border }]}
                onPress={() => setMinUpside(v)}
              >
                <Text style={[styles.chipText, { color: minUpside === v ? "#fff" : colors.foreground }]}>{v}%+</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Content */}
      {isLoading ? (
        <SkeletonList count={6} />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />}
        >
          {seg === "내일픽" && (
            (tomorrow.data?.picks ?? []).length === 0
              ? <EmptyState icon="trending-up" text="내일 픽이 없습니다" />
              : (tomorrow.data?.picks ?? []).map((p, i) => <PickRow key={i} item={p} type="tomorrow" />)
          )}
          {seg === "급등예비군" && (
            (presurge.data?.picks ?? []).length === 0
              ? <EmptyState icon="zap" text="급등 예비군이 없습니다" />
              : (presurge.data?.picks ?? []).map((p, i) => <PickRow key={i} item={p} type="presurge" />)
          )}
          {isScannerSeg && (
            scanner.isError
              ? <EmptyState icon="alert-circle" text="스캐너 데이터를 불러올 수 없습니다" />
              : (scanner.data ?? []).length === 0
              ? <EmptyState icon="search" text="조건에 맞는 종목이 없습니다" />
              : (scanner.data ?? []).map((item) => <ScannerRow key={item.id} item={item} />)
          )}
        </ScrollView>
      )}
    </View>
  );
}

function EmptyState({ icon, text }: { icon: any; text: string }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
      <Feather name={icon} size={36} color={colors.border} />
      <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  countLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  segScroll: { borderBottomWidth: StyleSheet.hairlineWidth },
  segInner: { flexDirection: "row", paddingHorizontal: 16 },
  segBtn: {
    paddingVertical: 12, paddingHorizontal: 4, marginRight: 18,
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  segLabel: { fontSize: 14, fontFamily: "Inter_500Medium" },
  filterRow: { borderBottomWidth: StyleSheet.hairlineWidth },
  chip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, borderWidth: 1,
  },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  chipDivider: { width: 1, marginHorizontal: 4, marginVertical: 2 },
  row: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scannerRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: "transparent",
  },
  ticker: { fontSize: 15, fontFamily: "Inter_700Bold" },
  name: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  price: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  reason: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
});
