import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { VerdictBadge } from "./VerdictBadge";

interface Analysis {
  id: number;
  ticker: string;
  companyName: string;
  industry: string;
  status: string;
  investmentVerdict?: string;
  targetPrice?: number;
  createdAt: string;
}

interface Props {
  analysis: Analysis;
  onPress: () => void;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function AnalysisCard({ analysis, onPress }: Props) {
  const colors = useColors();
  const isComplete = analysis.status === "completed";

  return (
    <Pressable
      style={({ pressed }) => [styles.card, { backgroundColor: colors.card, opacity: pressed ? 0.95 : 1 }]}
      onPress={onPress}
    >
      <View style={styles.top}>
        <View style={styles.left}>
          <Text style={[styles.ticker, { color: colors.mutedForeground }]}>{analysis.ticker}</Text>
          <Text style={[styles.company, { color: colors.foreground }]} numberOfLines={1}>
            {analysis.companyName}
          </Text>
        </View>
        <View style={styles.right}>
          {isComplete && analysis.investmentVerdict ? (
            <VerdictBadge verdict={analysis.investmentVerdict} size="sm" />
          ) : (
            <View style={[styles.progressBadge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.progressText, { color: colors.mutedForeground }]}>분석 중</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.bottom}>
        <Text style={[styles.date, { color: colors.mutedForeground }]}>
          {formatDate(analysis.createdAt)}
        </Text>
        {isComplete && analysis.targetPrice ? (
          <Text style={[styles.target, { color: colors.foreground }]}>
            목표가 {analysis.targetPrice.toLocaleString()}원
          </Text>
        ) : null}
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  left: { flex: 1, marginRight: 12 },
  right: {},
  ticker: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 2 },
  company: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  bottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  date: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  target: { fontSize: 12, fontFamily: "Inter_500Medium" },
  progressBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  progressText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
