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

const SEGS = ["내일픽", "급등예비군", "스캐너"] as const;
type Seg = typeof SEGS[number];

const MARKETS = ["ALL", "KR", "US"] as const;
type Market = typeof MARKETS[number];
const MARKET_LABELS: Record<Market, string> = { ALL: "전체", KR: "한국", US: "미국" };

const UPSIDE_OPTIONS = [10, 20, 30, 50];

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const colors = useColors();
  const cfg: Record<string, { bg: string; fg: string; label: string }> = {
    high:   { bg: colors.upBg,   fg: colors.up,   label: "높음" },
    medium: { bg: "#f59e0b22",   fg: "#f59e0b",   label: "보통" },
    low:    { bg: colors.downBg, fg: colors.down,  label: "낮음" },
  };
  const c = cfg[confidence] ?? cfg.medium;
  return (
    <View style={{ backgroundColor: c.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: c.fg }}>{c.label}</Text>
    </View>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const colors = useColors();
  const isStrong = verdict.toLowerCase().includes("strong buy");
  return (
    <View style={{ backgroundColor: isStrong ? colors.upBg : "#22c55e22", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: isStrong ? colors.up : "#22c55e" }}>
        {isStrong ? "높은 상승여력" : "상승여력"}
      </Text>
    </View>
  );
}

function UpsidePill({ pct }: { pct: number }) {
  const color = pct >= 50 ? "#34d399" : pct >= 30 ? "#22c55e" : "#60a5fa";
  return (
    <View style={{ backgroundColor: color + "22", borderWidth: 1, borderColor: color + "44", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 }}>
      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color }}>+{pct.toFixed(1)}%</Text>
    </View>
  );
}

function TodayChange({ pct }: { pct: number | null }) {
  const colors = useColors();
  if (pct === null) return <Text style={{ fontSize: 12, color: colors.mutedForeground }}>-</Text>;
  const isUp = pct >= 0;
  return (
    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: isUp ? colors.up : colors.down }}>
      {isUp ? "▲" : "▼"} {Math.abs(pct).toFixed(2)}%
    </Text>
  );
}

// ── Pick card ──────────────────────────────────────────────────────────────
function PickCard({ item, type }: { item: TomorrowPick | PresurgePick; type: "tomorrow" | "presurge" }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const s = makeStyles(colors);
  return (
    <Pressable
      style={s.card}
      onPress={() => {
        if (Platform.OS !== "web") Haptics.selectionAsync();
        setExpanded((v) => !v);
      }}
    >
      <View style={s.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.ticker}>{item.ticker}</Text>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {type === "tomorrow"
            ? <ConfidenceBadge confidence={(item as TomorrowPick).confidence} />
            : <View style={s.scoreBadge}>
                <Text style={s.scoreText}>{(item as PresurgePick).score?.toFixed(1) ?? "-"}</Text>
              </View>
          }
        </View>
      </View>
      {expanded && (
        <View style={s.expand}>
          <Text style={s.reason}>{item.reason}</Text>
          {item.themes && item.themes.length > 0 && (
            <View style={s.tags}>
              {item.themes.map((t, i) => (
                <View key={i} style={s.tag}><Text style={s.tagText}>{t}</Text></View>
              ))}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

// ── Scanner card ──────────────────────────────────────────────────────────
function ScannerCard({ item }: { item: ScannerItem }) {
  const colors = useColors();
  const router = useRouter();
  const s = makeStyles(colors);
  return (
    <Pressable
      style={s.card}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      <View style={s.cardHeader}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.ticker}>{item.ticker}</Text>
          <Text style={s.name} numberOfLines={1}>{item.companyName}</Text>
          {item.industry && <Text style={s.industry}>{item.industry}</Text>}
        </View>
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          {item.upside != null && <UpsidePill pct={item.upside} />}
          <VerdictBadge verdict={item.investmentVerdict} />
        </View>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {item.currentPrice != null && (
            <Text style={s.price}>
              {item.currentPrice >= 1000
                ? item.currentPrice.toLocaleString("ko-KR") + "원"
                : "$" + item.currentPrice.toLocaleString("en-US")}
            </Text>
          )}
          <TodayChange pct={item.todayChangePct} />
        </View>
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
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

  const s = makeStyles(colors);

  function refresh() {
    tomorrow.refetch();
    presurge.refetch();
    if (seg === "스캐너") scanner.refetch();
  }

  const isLoading =
    seg === "내일픽" ? tomorrow.isLoading
    : seg === "급등예비군" ? presurge.isLoading
    : scanner.isLoading;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Feather name="trending-up" size={18} color={colors.primary} />
        <Text style={s.headerTitle}>종목 신호</Text>
      </View>

      {/* Segments */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.segRow}>
        {SEGS.map((t) => (
          <TouchableOpacity
            key={t} style={[s.segBtn, seg === t && s.segActive]}
            onPress={() => setSeg(t)}
          >
            <Text style={[s.segLabel, seg === t && s.segLabelActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Scanner filters */}
      {seg === "스캐너" && (
        <View style={s.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
            {MARKETS.map((m) => (
              <TouchableOpacity
                key={m} style={[s.filterChip, market === m && s.filterActive]}
                onPress={() => setMarket(m)}
              >
                <Text style={[s.filterText, market === m && s.filterTextActive]}>{MARKET_LABELS[m]}</Text>
              </TouchableOpacity>
            ))}
            <View style={s.divider} />
            {UPSIDE_OPTIONS.map((v) => (
              <TouchableOpacity
                key={v} style={[s.filterChip, minUpside === v && s.filterActive]}
                onPress={() => setMinUpside(v)}
              >
                <Text style={[s.filterText, minUpside === v && s.filterTextActive]}>{v}%+</Text>
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
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 80 }]}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />}
        >
          {seg === "내일픽" && (
            <>
              {(tomorrow.data?.picks ?? []).length === 0
                ? <Text style={s.empty}>내일 픽이 없습니다</Text>
                : (tomorrow.data?.picks ?? []).map((p, i) => <PickCard key={i} item={p} type="tomorrow" />)
              }
            </>
          )}
          {seg === "급등예비군" && (
            <>
              {(presurge.data?.picks ?? []).length === 0
                ? <Text style={s.empty}>급등 예비군이 없습니다</Text>
                : (presurge.data?.picks ?? []).map((p, i) => <PickCard key={i} item={p} type="presurge" />)
              }
            </>
          )}
          {seg === "스캐너" && (
            <>
              {scanner.isLoading
                ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
                : scanner.isError
                ? <Text style={s.empty}>스캐너 데이터를 불러올 수 없습니다</Text>
                : (scanner.data ?? []).length === 0
                ? <Text style={s.empty}>조건에 맞는 종목이 없습니다</Text>
                : (scanner.data ?? []).map((item) => <ScannerCard key={item.id} item={item} />)
              }
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: c.foreground },
    segRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
    segBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    segActive: { backgroundColor: c.primary + "22", borderColor: c.primary },
    segLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.mutedForeground },
    segLabelActive: { color: c.primary },
    filterRow: { marginBottom: 8 },
    filterChip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    filterActive: { backgroundColor: c.primary + "22", borderColor: c.primary },
    filterText: { fontSize: 12, fontFamily: "Inter_500Medium", color: c.mutedForeground },
    filterTextActive: { color: c.primary },
    divider: { width: 1, backgroundColor: c.border, marginHorizontal: 4 },
    list: { padding: 16, gap: 10 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, gap: 10 },
    cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    ticker: { fontSize: 15, fontFamily: "Inter_700Bold", color: c.foreground },
    name: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    industry: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    price: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.foreground },
    scoreBadge: { backgroundColor: c.primary + "22", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
    scoreText: { fontSize: 12, fontFamily: "Inter_700Bold", color: c.primary },
    expand: { gap: 8, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 10 },
    reason: { fontSize: 13, color: c.foreground, fontFamily: "Inter_400Regular", lineHeight: 19 },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    tag: { backgroundColor: c.muted, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
    tagText: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    empty: { textAlign: "center", color: c.mutedForeground, marginTop: 60, fontFamily: "Inter_400Regular", fontSize: 14 },
  });
}
