import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useMarketBrief, useMarketSessions, type Session } from "@/hooks/useApi";
import { SkeletonCard } from "@/components/SkeletonCard";

const SESSION_LABELS: Record<string, string> = {
  premarket: "장전",
  intraday1: "장중 1부",
  intraday2: "장중 2부",
  close: "장마감",
  weekend: "주말 브리핑",
  "장전": "장전",
  "장중1차": "장중 1부",
  "장중2차": "장중 2부",
  "장마감": "장마감",
  "주말": "주말 브리핑",
  morning: "장전",
  afternoon: "장중",
};

function sessionLabel(s: Session) {
  return s.sessionLabel || SESSION_LABELS[s.session] || s.session;
}

function SessionCard({
  session,
  selected,
  onPress,
}: {
  session: Session;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const isDone = session.status === "done";
  const isGen = session.status === "generating";
  const borderColor = selected ? colors.primary : colors.border;
  const bgColor = selected ? colors.primary + "18" : colors.card;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.sessionCard,
        {
          backgroundColor: bgColor,
          borderColor,
          borderWidth: selected ? 1.5 : 1,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <View style={styles.sessionStatus}>
        {isDone ? (
          <View
            style={[styles.statusDot, { backgroundColor: colors.success }]}
          />
        ) : isGen ? (
          <ActivityIndicator size={10} color={colors.warning} />
        ) : (
          <View
            style={[
              styles.statusDot,
              { backgroundColor: colors.mutedForeground },
            ]}
          />
        )}
        <Text
          style={[styles.sessionStatusText, { color: colors.mutedForeground }]}
        >
          {isDone ? "완료" : isGen ? "생성 중" : "대기"}
        </Text>
      </View>
      <Text
        style={[
          styles.sessionName,
          { color: selected ? colors.primary : colors.foreground },
        ]}
      >
        {sessionLabel(session)}
      </Text>
      {session.generatedAt && (
        <Text
          style={[styles.sessionTime, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          {new Date(session.generatedAt).toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      )}
    </Pressable>
  );
}

function BriefContent({ content }: { content: string }) {
  const colors = useColors();
  const lines = content.split("\n").filter(Boolean);

  return (
    <View style={styles.briefContainer}>
      {lines.map((line, i) => {
        const isHeader = line.startsWith("##") || line.startsWith("**");
        const isSection = line.startsWith("#");
        const cleaned = line.replace(/^#+\s*/, "").replace(/\*\*/g, "");
        return (
          <Text
            key={i}
            style={[
              styles.briefLine,
              {
                color: isHeader
                  ? colors.foreground
                  : isSection
                  ? colors.primary
                  : colors.mutedForeground,
                fontWeight: isHeader || isSection ? "600" : "400",
                fontSize: isSection ? 15 : 14,
                marginTop: isSection || isHeader ? 12 : 4,
              },
            ]}
          >
            {cleaned}
          </Text>
        );
      })}
    </View>
  );
}

export default function MarketScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [market, setMarket] = useState<"kr" | "us">("kr");
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const {
    data: sessionsData,
    isLoading,
    refetch,
    isRefetching,
  } = useMarketSessions(market);

  const { data: briefData, isLoading: briefLoading } = useMarketBrief(
    market,
    selectedSession
  );

  const sessions = sessionsData?.sessions ?? [];
  const autoSelected =
    selectedSession ??
    sessionsData?.currentSession ??
    sessions.find((s) => s.status === "done")?.session ??
    null;

  const activeBrief = useMarketBrief(market, autoSelected);

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
          시장 분석
        </Text>
        <View style={[styles.toggle, { backgroundColor: colors.accent }]}>
          {(["kr", "us"] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => {
                setMarket(m);
                setSelectedSession(null);
              }}
              style={[
                styles.toggleBtn,
                {
                  backgroundColor:
                    market === m ? colors.primary : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.toggleText,
                  {
                    color:
                      market === m ? colors.primaryForeground : colors.mutedForeground,
                    fontWeight: market === m ? "600" : "400",
                  },
                ]}
              >
                {m === "kr" ? "한국" : "미국"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 100,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {sessionsData?.marketDate && (
          <Text style={[styles.dateLabel, { color: colors.mutedForeground }]}>
            {sessionsData.marketDate}
          </Text>
        )}

        {isLoading ? (
          <View style={styles.sessionGrid}>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard
                key={i}
                height={88}
                width="48%"
                style={{ marginBottom: 8 }}
              />
            ))}
          </View>
        ) : sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="moon" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              오늘은 브리핑이 없어요
            </Text>
          </View>
        ) : (
          <View style={styles.sessionGrid}>
            {sessions.map((s) => (
              <SessionCard
                key={s.session}
                session={s}
                selected={(selectedSession ?? autoSelected) === s.session}
                onPress={() =>
                  setSelectedSession(
                    selectedSession === s.session ? null : s.session
                  )
                }
              />
            ))}
          </View>
        )}

        <View
          style={[
            styles.briefSection,
            { borderTopColor: colors.border },
          ]}
        >
          {activeBrief.isLoading && !!autoSelected ? (
            <View style={styles.briefLoading}>
              <ActivityIndicator color={colors.primary} />
              <Text
                style={[styles.briefLoadingText, { color: colors.mutedForeground }]}
              >
                브리핑 불러오는 중…
              </Text>
            </View>
          ) : activeBrief.data?.content ? (
            <>
              <View style={styles.briefHeader}>
                <Text
                  style={[styles.briefHeaderText, { color: colors.primary }]}
                >
                  {sessions.find(
                    (s) =>
                      s.session === (selectedSession ?? autoSelected)
                  )
                    ? sessionLabel(
                        sessions.find(
                          (s) =>
                            s.session === (selectedSession ?? autoSelected)
                        )!
                      )
                    : ""}{" "}
                  브리핑
                </Text>
                {activeBrief.data.cachedAt && (
                  <Text
                    style={[
                      styles.briefTime,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {new Date(activeBrief.data.cachedAt).toLocaleTimeString(
                      "ko-KR",
                      { hour: "2-digit", minute: "2-digit" }
                    )}
                  </Text>
                )}
              </View>
              <BriefContent content={activeBrief.data.content} />
            </>
          ) : autoSelected ? (
            <View style={styles.emptyState}>
              <Feather
                name="file-text"
                size={28}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                브리핑을 불러올 수 없어요
              </Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Feather
                name="bar-chart-2"
                size={28}
                color={colors.mutedForeground}
              />
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                세션을 선택해 브리핑을 확인하세요
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontWeight: "700", fontFamily: "Inter_700Bold" },
  toggle: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 3,
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 6,
  },
  toggleText: { fontSize: 13 },
  scroll: { flex: 1 },
  dateLabel: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  sessionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 16,
    justifyContent: "space-between",
  },
  sessionCard: {
    width: "48%",
    padding: 14,
    borderRadius: 12,
    gap: 6,
  },
  sessionStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  sessionStatusText: { fontSize: 11 },
  sessionName: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  sessionTime: { fontSize: 11 },
  briefSection: {
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
    paddingHorizontal: 16,
    minHeight: 120,
  },
  briefHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  briefHeaderText: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  briefTime: { fontSize: 11 },
  briefContainer: { gap: 2 },
  briefLine: { lineHeight: 22 },
  briefLoading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 24 },
  briefLoadingText: { fontSize: 14 },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: { fontSize: 14 },
});
