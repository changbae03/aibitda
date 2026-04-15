import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

const STEP_LABELS: Record<string, string> = {
  company_intro: "기업 개요",
  industry_analysis: "산업 분석",
  catalyst_analysis: "촉매 분석",
  company_analysis: "재무제표 분석",
  relative_valuation: "목표가 산출",
  market_analysis: "타점 분석",
  investment_strategy: "최종 투자 전략",
};

const STEP_COLORS: Record<string, string> = {
  company_intro: "#3b82f6",
  industry_analysis: "#10b981",
  catalyst_analysis: "#f59e0b",
  company_analysis: "#6366f1",
  relative_valuation: "#8b5cf6",
  market_analysis: "#ec4899",
  investment_strategy: "#3b82f6",
};

interface Step {
  id: number;
  stepKey: string;
  agentName: string;
  content: string;
}

interface Props {
  step: Step;
  index: number;
}

export function StepRow({ step, index }: Props) {
  const [expanded, setExpanded] = useState(false);
  const colors = useColors();
  const accent = STEP_COLORS[step.stepKey] ?? "#111";
  const label = STEP_LABELS[step.stepKey] ?? step.stepKey;

  return (
    <View style={[styles.container, { borderColor: colors.border }]}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((p) => !p)}
      >
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <View style={styles.headerText}>
          <Text style={[styles.stepNum, { color: colors.mutedForeground }]}>STEP {index + 1}</Text>
          <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        </View>
        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedForeground}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.content, { borderTopColor: colors.border }]}>
          <Text style={[styles.contentText, { color: colors.foreground }]}>
            {step.content.trim()}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerText: { flex: 1 },
  stepNum: { fontSize: 10, fontFamily: "Inter_500Medium", marginBottom: 2 },
  label: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: {
    borderTopWidth: 1,
    padding: 16,
  },
  contentText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 22,
  },
});
