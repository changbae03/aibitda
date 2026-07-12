import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Linking, ActivityIndicator, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useNewsResearch, useNewsRadar, useNewsScraps } from "@/hooks/useApi";

const SEG = ["피드", "레이더", "큐레이션"] as const;
type Seg = typeof SEG[number];

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function isUrlOnly(text: string): boolean {
  return /^https?:\/\/\S+$/.test(text.trim());
}

function cleanTitle(raw?: string | null): string | null {
  if (!raw) return null;
  if (isUrlOnly(raw)) return null;
  const decoded = decodeHtmlEntities(raw);
  if (!decoded || decoded.length < 5) return null;
  return decoded;
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "방금";
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  } catch {
    return "";
  }
}

const CAT_COLOR: Record<string, string> = {
  외교: "#60a5fa", 경제: "#10b981", 군사: "#f87171", 시장: "#a78bfa",
  정치: "#fb923c", 에너지: "#fbbf24", 기술: "#38bdf8", 산업: "#4ade80",
  반도체: "#818cf8", 바이오: "#34d399",
};

export default function NewsTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [seg, setSeg] = useState<Seg>("피드");

  const research = useNewsResearch();
  const radar = useNewsRadar();
  const scraps = useNewsScraps();

  const isLoading =
    seg === "피드" ? research.isLoading
    : seg === "레이더" ? radar.isLoading
    : scraps.isLoading;

  const rawItems =
    seg === "피드" ? research.data?.items ?? []
    : seg === "레이더" ? radar.data?.items ?? []
    : scraps.data?.items ?? [];

  const items = rawItems.filter((item) => {
    const title = cleanTitle(item.title) ?? cleanTitle(item.text);
    return title !== null;
  });

  const latestItem = items[0];

  function refresh() {
    research.refetch();
    radar.refetch();
    scraps.refetch();
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <Text style={[styles.breakingBadge, { backgroundColor: colors.foreground, color: colors.card }]}>속보</Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>⚡ 주요뉴스</Text>
        </View>
        {items.length > 0 && (
          <Text style={[styles.headerCount, { color: colors.mutedForeground }]}>
            {items.length}건
          </Text>
        )}
      </View>

      {/* Tab row */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        {SEG.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabBtn, seg === t && { borderBottomColor: colors.foreground }]}
            onPress={() => setSeg(t)}
          >
            <Text style={[styles.tabLabel, { color: seg === t ? colors.foreground : colors.mutedForeground }]}>
              {t === "피드" ? "📰 피드" : t === "레이더" ? "📡 레이더" : "🔖 큐레이션"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Breaking news ticker */}
      {latestItem && !isLoading && (
        <TouchableOpacity
          style={[styles.tickerRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
          onPress={() => latestItem.url && Linking.openURL(latestItem.url).catch(() => null)}
          activeOpacity={0.7}
        >
          <View style={[styles.tickerDot, { backgroundColor: colors.up }]} />
          <Text style={[styles.tickerLabel, { color: colors.up }]}>속보</Text>
          <Text style={[styles.tickerText, { color: colors.foreground }]} numberOfLines={1}>
            {cleanTitle(latestItem.title) ?? cleanTitle(latestItem.text) ?? ""}
          </Text>
          <Text style={[styles.tickerTime, { color: colors.mutedForeground }]}>
            {timeAgo(latestItem.pubDate ?? latestItem.date)}
          </Text>
        </TouchableOpacity>
      )}

      {/* Content */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />
          }
        >
          {items.length === 0 ? (
            <View style={styles.center}>
              <Feather name="inbox" size={36} color={colors.border} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>뉴스가 없습니다</Text>
            </View>
          ) : (
            items.map((item, i) => {
              const title = cleanTitle(item.title) ?? cleanTitle(item.text) ?? "";
              return (
                <TouchableOpacity
                  key={`${item.url ?? item.title ?? ""}-${i}`}
                  style={[styles.newsRow, { borderBottomColor: colors.border }]}
                  onPress={() => item.url && Linking.openURL(item.url).catch(() => null)}
                  activeOpacity={0.7}
                >
                  {/* Left: dot indicator */}
                  <View style={styles.dotCol}>
                    <View style={[styles.newsDot, { backgroundColor: i === 0 ? colors.up : colors.border }]} />
                    {i < items.length - 1 && (
                      <View style={[styles.dotLine, { backgroundColor: colors.border }]} />
                    )}
                  </View>

                  {/* Right: content */}
                  <View style={styles.newsContent}>
                    <View style={styles.newsMetaRow}>
                      <Text style={[styles.newsTime, { color: colors.mutedForeground }]}>
                        {timeAgo(item.pubDate ?? item.date)}
                      </Text>
                      {item.category ? (
                        <View style={[styles.catBadge, { backgroundColor: (CAT_COLOR[item.category] ?? colors.primary) + "18" }]}>
                          <Text style={[styles.catText, { color: CAT_COLOR[item.category] ?? colors.primary }]}>{item.category}</Text>
                        </View>
                      ) : item.source ? (
                        <Text style={[styles.sourceText, { color: colors.mutedForeground }]}>{item.source}</Text>
                      ) : null}
                    </View>

                    <Text style={[styles.newsTitle, { color: colors.foreground }]} numberOfLines={3}>
                      {title}
                    </Text>

                    {item.tags && item.tags.length > 0 && (
                      <View style={styles.tagsRow}>
                        {item.tags.slice(0, 3).map((tag, j) => (
                          <Text key={`tag-${j}`} style={[styles.tagText, { color: colors.mutedForeground }]}>#{tag}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  breakingBadge: {
    fontSize: 11, fontFamily: "Inter_700Bold",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  headerCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  tabRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabBtn: {
    flex: 1, paddingVertical: 12, alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  tickerRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tickerDot: { width: 7, height: 7, borderRadius: 4 },
  tickerLabel: { fontSize: 11, fontFamily: "Inter_700Bold" },
  tickerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  tickerTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  newsRow: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingRight: 16,
  },
  dotCol: { width: 44, alignItems: "center", paddingTop: 4 },
  newsDot: { width: 8, height: 8, borderRadius: 4 },
  dotLine: { width: 1, flex: 1, marginTop: 4 },
  newsContent: { flex: 1, gap: 5 },
  newsMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  newsTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
  catBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  catText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  sourceText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  newsTitle: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 21 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
