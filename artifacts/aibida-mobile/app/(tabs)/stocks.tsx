import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SkeletonList } from "@/components/SkeletonCard";
import { useColors } from "@/hooks/useColors";
import {
  usePresurge,
  useTomorrowPicks,
  type PresurgePick,
  type TomorrowPick,
} from "@/hooks/useApi";

const TABS = [
  { key: "picks", label: "내일 픽" },
  { key: "presurge", label: "급등 예비군" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function ConfidenceBadge({ confidence }: { confidence: "high" | "medium" | "low" }) {
  const colors = useColors();
  const map = {
    high: { label: "고신뢰", bg: colors.success + "22", color: colors.success },
    medium: { label: "중", bg: colors.warning + "22", color: colors.warning },
    low: { label: "저", bg: colors.mutedForeground + "22", color: colors.mutedForeground },
  };
  const c = map[confidence] ?? map.low;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const colors = useColors();
  const map: Record<string, { label: string; color: string }> = {
    confluence: { label: "교차", color: colors.primary },
    theme: { label: "테마", color: "#a78bfa" },
    signal: { label: "시그널", color: "#38bdf8" },
  };
  const c = map[category] ?? { label: category, color: colors.mutedForeground };
  return (
    <View style={[styles.badge, { backgroundColor: c.color + "22" }]}>
      <Text style={[styles.badgeText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

function PickRow({ item, rank }: { item: TomorrowPick; rank: number }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      onPress={() => {
        setExpanded((v) => !v);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.rankBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.rankText, { color: colors.mutedForeground }]}>
            {rank}
          </Text>
        </View>
        <View style={styles.rowInfo}>
          <Text style={[styles.stockName, { color: colors.foreground }]}>
            {item.name}
          </Text>
          <Text style={[styles.ticker, { color: colors.mutedForeground }]}>
            {item.ticker}
          </Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <CategoryBadge category={item.category} />
        <ConfidenceBadge confidence={item.confidence} />
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.mutedForeground}
        />
      </View>
      {expanded && (
        <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
          <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>
            {item.reason}
          </Text>
          {item.themes && item.themes.length > 0 && (
            <View style={styles.tags}>
              {item.themes.slice(0, 4).map((t, i) => (
                <View key={i} style={[styles.tag, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
                    {t}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

function PresurgeRow({ item, rank }: { item: PresurgePick; rank: number }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const score = Math.round((item.score ?? 0) * 10) / 10;

  return (
    <Pressable
      onPress={() => {
        setExpanded((v) => !v);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.rankBadge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.rankText, { color: colors.mutedForeground }]}>
            {rank}
          </Text>
        </View>
        <View style={styles.rowInfo}>
          <Text style={[styles.stockName, { color: colors.foreground }]}>
            {item.name}
          </Text>
          <Text style={[styles.ticker, { color: colors.mutedForeground }]}>
            {item.ticker}
          </Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <View style={[styles.scorePill, { backgroundColor: colors.primary + "22" }]}>
          <Text style={[styles.scoreText, { color: colors.primary }]}>
            {score}점
          </Text>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.mutedForeground}
        />
      </View>
      {expanded && (
        <View style={[styles.expandedContent, { borderTopColor: colors.border }]}>
          <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>
            {item.reason}
          </Text>
          {item.signals && item.signals.length > 0 && (
            <View style={styles.tags}>
              {item.signals.slice(0, 4).map((s, i) => (
                <View key={i} style={[styles.tag, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
                    {s}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

export default function StocksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>("picks");

  const picks = useTomorrowPicks();
  const presurge = usePresurge();

  const isLoading =
    activeTab === "picks" ? picks.isLoading : presurge.isLoading;
  const isRefetching =
    activeTab === "picks" ? picks.isRefetching : presurge.isRefetching;

  function handleRefresh() {
    if (activeTab === "picks") picks.refetch();
    else presurge.refetch();
  }

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
          종목 신호
        </Text>
      </View>

      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[
              styles.tab,
              {
                borderBottomColor:
                  activeTab === t.key ? colors.primary : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color:
                    activeTab === t.key ? colors.primary : colors.mutedForeground,
                  fontWeight: activeTab === t.key ? "600" : "400",
                },
              ]}
            >
              {t.label}
            </Text>
            {activeTab === "picks" && t.key === "picks" && picks.data && (
              <View
                style={[styles.countBadge, { backgroundColor: colors.primary }]}
              >
                <Text style={styles.countText}>
                  {picks.data.picks.length}
                </Text>
              </View>
            )}
            {activeTab === "presurge" && t.key === "presurge" && presurge.data && (
              <View
                style={[styles.countBadge, { backgroundColor: colors.primary }]}
              >
                <Text style={styles.countText}>
                  {presurge.data.picks?.length ?? 0}
                </Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.listContent,
          {
            paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 100,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={{ marginTop: 16 }}>
            <SkeletonList count={6} />
          </View>
        ) : activeTab === "picks" ? (
          picks.error ? (
            <ErrorState onRetry={() => picks.refetch()} />
          ) : picks.data?.picks.length === 0 ? (
            <EmptyState label="아직 내일 픽이 없어요" icon="trending-up" />
          ) : (
            picks.data?.picks.map((item, i) => (
              <PickRow key={item.ticker} item={item} rank={i + 1} />
            ))
          )
        ) : presurge.error ? (
          <ErrorState onRetry={() => presurge.refetch()} />
        ) : (presurge.data?.picks?.length ?? 0) === 0 ? (
          <EmptyState label="급등 예비군이 없어요" icon="activity" />
        ) : (
          presurge.data?.picks?.map((item, i) => (
            <PresurgeRow key={item.ticker} item={item} rank={i + 1} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

function EmptyState({ label, icon }: { label: string; icon: string }) {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <Feather name={icon as any} size={32} color={colors.mutedForeground} />
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      <Feather name="alert-circle" size={32} color={colors.destructive} />
      <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
        데이터를 불러오지 못했어요
      </Text>
      <Pressable
        onPress={onRetry}
        style={[styles.retryBtn, { backgroundColor: colors.accent }]}
      >
        <Text style={[styles.retryText, { color: colors.foreground }]}>
          다시 시도
        </Text>
      </Pressable>
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
  headerTitle: {
    fontSize: 22,
    fontWeight: "700",
    fontFamily: "Inter_700Bold",
  },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: 2,
  },
  tabText: { fontSize: 14 },
  countBadge: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  scroll: { flex: 1 },
  listContent: { gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  row: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: { fontSize: 12, fontWeight: "600" },
  rowInfo: { gap: 2, flex: 1 },
  stockName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  ticker: { fontSize: 12 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "600" },
  scorePill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6 },
  scoreText: { fontSize: 12, fontWeight: "600" },
  expandedContent: {
    width: "100%",
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  reasonText: { fontSize: 13, lineHeight: 20 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11 },
  emptyState: { alignItems: "center", paddingVertical: 60, gap: 10 },
  emptyText: { fontSize: 14 },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryText: { fontSize: 14, fontWeight: "600" },
});
