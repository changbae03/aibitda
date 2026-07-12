import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useGetAnalysis } from "@workspace/api-client-react";

const STEP_LABELS: Record<string, string> = {
  company_intro: "기업 소개",
  industry_analysis: "산업 분석",
  company_analysis: "기업 분석",
  market_analysis: "시장 분석",
  catalyst_analysis: "촉매 분석",
  investment_strategy: "투자 전략",
};

const INFO_COLORS: Record<string, string> = {
  confirmed_fact: "#22c55e",
  data_based_estimate: "#f59e0b",
  hypothesis: "#64748b",
};

const INFO_LABELS: Record<string, string> = {
  confirmed_fact: "확인된 사실",
  data_based_estimate: "데이터 추정",
  hypothesis: "가설",
};

function VerdictBadge({ verdict }: { verdict?: string }) {
  const colors = useColors();
  if (!verdict) return null;
  const map: Record<string, { color: string; label: string }> = {
    BUY: { color: colors.up, label: "매수" },
    SELL: { color: colors.down, label: "매도" },
    HOLD: { color: colors.warning, label: "보유" },
    WATCH: { color: colors.mutedForeground, label: "관찰" },
  };
  const v = verdict.toUpperCase();
  const c = map[v] ?? { color: colors.mutedForeground, label: verdict };
  return (
    <View style={[styles.verdictBadge, { backgroundColor: c.color + "22", borderColor: c.color + "44" }]}>
      <Text style={[styles.verdictText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

export default function AnalysisDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: analysis, isLoading, error } = useGetAnalysis(Number(id));

  const botPad = Platform.OS === "web" ? 34 : insets.bottom + 16;

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !analysis) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, justifyContent: "center", alignItems: "center", gap: 12 }]}>
        <Feather name="alert-circle" size={36} color={colors.destructive} />
        <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
          분석을 불러오지 못했어요
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: botPad }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.topCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.topRow}>
          <View style={styles.topLeft}>
            <Text style={[styles.companyName, { color: colors.foreground }]}>
              {analysis.companyName}
            </Text>
            <Text style={[styles.ticker, { color: colors.mutedForeground }]}>
              {analysis.ticker} · {analysis.industry}
            </Text>
          </View>
          <VerdictBadge verdict={analysis.investmentVerdict} />
        </View>

        {(analysis.targetPrice || analysis.entryPrice || analysis.stopLoss) && (
          <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
            {analysis.entryPrice && (
              <View style={styles.priceItem}>
                <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>
                  진입가
                </Text>
                <Text style={[styles.priceValue, { color: colors.foreground }]}>
                  {analysis.entryPrice.toLocaleString("ko-KR")}
                </Text>
              </View>
            )}
            {analysis.targetPrice && (
              <View style={styles.priceItem}>
                <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>
                  목표가
                </Text>
                <Text style={[styles.priceValue, { color: colors.up }]}>
                  {analysis.targetPrice.toLocaleString("ko-KR")}
                </Text>
              </View>
            )}
            {analysis.stopLoss && (
              <View style={styles.priceItem}>
                <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>
                  손절가
                </Text>
                <Text style={[styles.priceValue, { color: colors.down }]}>
                  {analysis.stopLoss.toLocaleString("ko-KR")}
                </Text>
              </View>
            )}
            {analysis.riskRewardRatio && (
              <View style={styles.priceItem}>
                <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>
                  R/R
                </Text>
                <Text style={[styles.priceValue, { color: colors.primary }]}>
                  {analysis.riskRewardRatio.toFixed(1)}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.stepsContainer}>
        {(analysis.steps ?? []).map((step) => (
          <View
            key={step.id}
            style={[styles.stepCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.stepHeader}>
              <Text style={[styles.stepTitle, { color: colors.primary }]}>
                {STEP_LABELS[step.stepKey] ?? step.stepKey}
              </Text>
              <View
                style={[
                  styles.infoBadge,
                  { backgroundColor: (INFO_COLORS[step.informationType] ?? colors.mutedForeground) + "22" },
                ]}
              >
                <Text
                  style={[
                    styles.infoBadgeText,
                    { color: INFO_COLORS[step.informationType] ?? colors.mutedForeground },
                  ]}
                >
                  {INFO_LABELS[step.informationType] ?? step.informationType}
                </Text>
              </View>
            </View>
            <Text style={[styles.agentName, { color: colors.mutedForeground }]}>
              {step.agentName} · {step.agentRole}
            </Text>
            <Text style={[styles.stepContent, { color: colors.foreground }]}>
              {step.content}
            </Text>
            {step.validationNotes && (
              <View style={[styles.validationBox, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                <Text style={[styles.validationLabel, { color: colors.mutedForeground }]}>
                  검증 노트
                </Text>
                <Text style={[styles.validationText, { color: colors.mutedForeground }]}>
                  {step.validationNotes}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topCard: {
    margin: 16,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 0,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  topLeft: { flex: 1, gap: 4 },
  companyName: { fontSize: 20, fontWeight: "700", fontFamily: "Inter_700Bold" },
  ticker: { fontSize: 13 },
  verdictBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  verdictText: { fontSize: 14, fontWeight: "700", fontFamily: "Inter_700Bold" },
  priceRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  priceItem: { alignItems: "center", gap: 4 },
  priceLabel: { fontSize: 11 },
  priceValue: { fontSize: 15, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  stepsContainer: { paddingHorizontal: 16, gap: 12 },
  stepCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  stepHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  stepTitle: { fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  infoBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  infoBadgeText: { fontSize: 10, fontWeight: "600" },
  agentName: { fontSize: 11 },
  stepContent: { fontSize: 14, lineHeight: 22 },
  validationBox: {
    marginTop: 4,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  validationLabel: { fontSize: 10, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  validationText: { fontSize: 12, lineHeight: 18 },
  errorText: { fontSize: 15 },
});
