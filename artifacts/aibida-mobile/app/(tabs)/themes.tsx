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
import { useThemeSignals, useThemesFeed, type ThemeSignal } from "@/hooks/useApi";

function StrengthBar({ strength }: { strength?: string }) {
  const colors = useColors();
  const levels = { strong: 3, moderate: 2, weak: 1 };
  const level = levels[strength as keyof typeof levels] ?? 1;
  const barColor =
    level === 3 ? colors.up : level === 2 ? colors.warning : colors.mutedForeground;

  return (
    <View style={styles.strengthRow}>
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.strengthSegment,
            {
              backgroundColor: i <= level ? barColor : colors.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

function ThemeCard({ item }: { item: ThemeSignal }) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const tickers = item.tickers ?? item.stocks ?? [];

  return (
    <Pressable
      onPress={() => {
        setExpanded((v) => !v);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardMain}>
          <Text style={[styles.themeName, { color: colors.foreground }]}>
            {item.theme}
          </Text>
          {item.signal && (
            <Text style={[styles.signalText, { color: colors.primary }]}>
              {item.signal}
            </Text>
          )}
          {item.momentum && !item.signal && (
            <Text style={[styles.signalText, { color: colors.primary }]}>
              {item.momentum}
            </Text>
          )}
        </View>
        <View style={styles.cardMeta}>
          <StrengthBar strength={item.strength} />
          <Feather
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.mutedForeground}
          />
        </View>
      </View>

      {tickers.length > 0 && (
        <View style={styles.tickerRow}>
          {tickers.slice(0, 5).map((t, i) => (
            <View
              key={i}
              style={[styles.tickerTag, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.tickerTagText, { color: colors.mutedForeground }]}>
                {t}
              </Text>
            </View>
          ))}
          {tickers.length > 5 && (
            <Text style={[styles.moreText, { color: colors.mutedForeground }]}>
              +{tickers.length - 5}
            </Text>
          )}
        </View>
      )}

      {expanded && (item.reason || item.description) && (
        <View
          style={[styles.expandedBox, { borderTopColor: colors.border }]}
        >
          <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>
            {item.reason ?? item.description}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export default function ThemesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"signals" | "feed">("signals");

  const signalsQ = useThemeSignals();
  const feedQ = useThemesFeed();

  const current = tab === "signals" ? signalsQ : feedQ;
  const rawItems =
    tab === "signals"
      ? (signalsQ.data?.signals ?? signalsQ.data?.feed ?? [])
      : (feedQ.data?.feed ?? feedQ.data?.signals ?? []);

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
          테마
        </Text>
      </View>

      <View style={[styles.tabBar, { borderBottomColor: colors.border }]}>
        {([["signals", "시그널"], ["feed", "트렌딩"]] as const).map(([k, l]) => (
          <Pressable
            key={k}
            onPress={() => setTab(k)}
            style={[
              styles.tab,
              {
                borderBottomColor: tab === k ? colors.primary : "transparent",
              },
            ]}
          >
            <Text
              style={[
                styles.tabText,
                {
                  color: tab === k ? colors.primary : colors.mutedForeground,
                  fontWeight: tab === k ? "600" : "400",
                },
              ]}
            >
              {l}
            </Text>
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
            refreshing={!!current.isRefetching}
            onRefresh={() => current.refetch()}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {current.isLoading ? (
          <View style={{ marginTop: 16 }}>
            <SkeletonList count={5} />
          </View>
        ) : current.error ? (
          <View style={styles.emptyState}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              데이터를 불러오지 못했어요
            </Text>
            <Pressable
              onPress={() => current.refetch()}
              style={[styles.retryBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.retryText, { color: colors.foreground }]}>
                다시 시도
              </Text>
            </Pressable>
          </View>
        ) : rawItems.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="layers" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              테마 신호가 없어요
            </Text>
          </View>
        ) : (
          rawItems.map((item, i) => (
            <ThemeCard key={`${item.theme}-${i}`} item={item} />
          ))
        )}
      </ScrollView>
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
  headerTitle: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
  tabText: { fontSize: 14 },
  scroll: { flex: 1 },
  listContent: { gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardMain: { flex: 1, gap: 4 },
  themeName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  signalText: { fontSize: 12, fontWeight: "500" },
  cardMeta: { alignItems: "flex-end", gap: 6 },
  strengthRow: { flexDirection: "row", gap: 3 },
  strengthSegment: { width: 16, height: 4, borderRadius: 2 },
  tickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tickerTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tickerTagText: { fontSize: 11 },
  moreText: { fontSize: 11, alignSelf: "center" },
  expandedBox: {
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reasonText: { fontSize: 13, lineHeight: 20 },
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
