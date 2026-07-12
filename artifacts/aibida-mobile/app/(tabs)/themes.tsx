import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Linking, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useNewsResearch, useNewsRadar, useNewsScraps } from "@/hooks/useApi";

const SEG = ["리서치", "레이더", "큐레이션"] as const;
type Seg = typeof SEG[number];

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
  외교: "#60a5fa", 경제: "#34d399", 군사: "#f87171", 시장: "#a78bfa",
  정치: "#fb923c", 에너지: "#fbbf24", 기술: "#38bdf8", 산업: "#4ade80",
};

export default function NewsTab() {
  const colors = useColors();
  const [seg, setSeg] = useState<Seg>("리서치");

  const research = useNewsResearch();
  const radar = useNewsRadar();
  const scraps = useNewsScraps();

  const isLoading =
    seg === "리서치" ? research.isLoading
    : seg === "레이더" ? radar.isLoading
    : scraps.isLoading;

  const items =
    seg === "리서치" ? research.data?.items ?? []
    : seg === "레이더" ? radar.data?.items ?? []
    : scraps.data?.items ?? [];

  function refresh() {
    research.refetch();
    radar.refetch();
    scraps.refetch();
  }

  const s = makeStyles(colors);

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <Feather name="rss" size={18} color={colors.primary} />
        <Text style={s.headerTitle}>뉴스</Text>
      </View>

      <View style={s.segRow}>
        {SEG.map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.segBtn, seg === t && s.segActive]}
            onPress={() => setSeg(t)}
          >
            <Text style={[s.segLabel, seg === t && s.segLabelActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />
          }
        >
          {items.length === 0 ? (
            <Text style={[s.errText, { textAlign: "center", marginTop: 60 }]}>뉴스가 없습니다</Text>
          ) : (
            items.map((item, i) => (
              <TouchableOpacity
                key={i}
                style={s.card}
                onPress={() => {
                  if (item.url) Linking.openURL(item.url).catch(() => null);
                }}
                activeOpacity={0.75}
              >
                <View style={s.metaRow}>
                  {item.category ? (
                    <View style={[s.catBadge, { backgroundColor: (CAT_COLOR[item.category] ?? colors.primary) + "22" }]}>
                      <Text style={[s.catText, { color: CAT_COLOR[item.category] ?? colors.primary }]}>{item.category}</Text>
                    </View>
                  ) : item.source ? (
                    <Text style={s.sourceText}>{item.source}</Text>
                  ) : <View />}
                  <Text style={s.timeText}>{timeAgo(item.pubDate ?? item.date)}</Text>
                </View>

                <Text style={s.title} numberOfLines={3}>{item.title ?? item.text ?? ""}</Text>

                {item.tags && item.tags.length > 0 && (
                  <View style={s.tagsRow}>
                    {item.tags.slice(0, 4).map((tag, j) => (
                      <View key={j} style={s.tag}>
                        <Text style={s.tagText}>#{tag}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {item.url && (
                  <View style={s.linkRow}>
                    <Feather name="external-link" size={11} color={colors.mutedForeground} />
                    <Text style={s.linkText}>원문 보기</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
    headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: c.foreground },
    segRow: { flexDirection: "row", paddingHorizontal: 16, gap: 8, marginBottom: 8 },
    segBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    segActive: { backgroundColor: c.primary + "22", borderColor: c.primary },
    segLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: c.mutedForeground },
    segLabelActive: { color: c.primary },
    list: { padding: 16, gap: 10, paddingBottom: 100 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: c.border, gap: 8 },
    metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    catBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
    catText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
    sourceText: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_500Medium" },
    timeText: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    title: { fontSize: 14, color: c.foreground, fontFamily: "Inter_500Medium", lineHeight: 20 },
    tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
    tag: { backgroundColor: c.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    tagText: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    linkRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    linkText: { fontSize: 11, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80 },
    errText: { color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 },
  });
}
