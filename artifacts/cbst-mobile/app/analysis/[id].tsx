import React, { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useGetAnalysis } from "@workspace/api-client-react";
import { VerdictBadge } from "@/components/VerdictBadge";
import { StepRow } from "@/components/StepRow";

const STEP_ORDER = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "relative_valuation",
  "market_analysis",
  "investment_strategy",
];

const STEP_LABELS: Record<string, string> = {
  company_intro: "기업 개요",
  industry_analysis: "산업 분석",
  catalyst_analysis: "촉매 분석",
  company_analysis: "재무제표 분석",
  relative_valuation: "목표가 산출",
  market_analysis: "타점 분석",
  investment_strategy: "최종 투자 전략",
};

const ACTIVE_MESSAGES: Record<string, string> = {
  company_intro: "기업 개요 작성 중...",
  industry_analysis: "산업 분석 중...",
  catalyst_analysis: "촉매 분석 중...",
  company_analysis: "재무제표 분석 중...",
  relative_valuation: "목표주가 산출 중...",
  market_analysis: "기술적 분석 중...",
  investment_strategy: "최종 전략 수립 중...",
};

export default function AnalysisDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pulseAnim = useRef(new Animated.Value(0.4)).current;

  const numId = Number(id);
  const { data: analysis, isLoading } = useGetAnalysis(numId, {
    query: {
      refetchInterval: (q) => q.state.data?.status === "in_progress" ? 3000 : false,
      enabled: !isNaN(numId),
    },
  });

  useEffect(() => {
    if (analysis?.status !== "in_progress") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [analysis?.status]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (isLoading || !analysis) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.foreground} />
      </View>
    );
  }

  const completedSteps = (analysis.steps ?? []).sort(
    (a, b) => STEP_ORDER.indexOf(a.stepKey) - STEP_ORDER.indexOf(b.stepKey)
  );
  const completedKeys = new Set(completedSteps.map((s) => s.stepKey));
  const activeStep = STEP_ORDER.find((k) => !completedKeys.has(k));
  const isInProgress = analysis.status === "in_progress";
  const progress = completedSteps.length / STEP_ORDER.length;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Back */}
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Feather name="arrow-left" size={20} color={colors.foreground} />
      </Pressable>

      {/* Header */}
      <View style={styles.headerBlock}>
        <Text style={[styles.ticker, { color: colors.mutedForeground }]}>{analysis.ticker}</Text>
        <Text style={[styles.company, { color: colors.foreground }]}>{analysis.companyName}</Text>
        <Text style={[styles.industry, { color: colors.mutedForeground }]}>{analysis.industry}</Text>
      </View>

      {/* Progress */}
      <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.progressHeader}>
          <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
            {isInProgress ? "분석 진행 중" : "분석 완료"}
          </Text>
          <Text style={[styles.progressCount, { color: colors.foreground }]}>
            {completedSteps.length} / {STEP_ORDER.length}
          </Text>
        </View>
        <View style={[styles.progressBar, { backgroundColor: colors.muted }]}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` as any, backgroundColor: colors.foreground }]} />
        </View>
        {isInProgress && activeStep && (
          <Animated.View style={{ opacity: pulseAnim }}>
            <Text style={[styles.activeMsg, { color: colors.mutedForeground }]}>
              {ACTIVE_MESSAGES[activeStep] ?? "분석 중..."}
            </Text>
          </Animated.View>
        )}
      </View>

      {/* Verdict card (if complete) */}
      {!isInProgress && analysis.investmentVerdict && (
        <View style={[styles.verdictCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.verdictTop}>
            <Text style={[styles.verdictLabel, { color: colors.mutedForeground }]}>최종 투자 의견</Text>
            <VerdictBadge verdict={analysis.investmentVerdict} />
          </View>
          <View style={styles.verdictNumbers}>
            {analysis.targetPrice ? (
              <View style={styles.numItem}>
                <Text style={[styles.numLabel, { color: colors.mutedForeground }]}>목표가</Text>
                <Text style={[styles.numValue, { color: colors.foreground }]}>{analysis.targetPrice.toLocaleString()}원</Text>
              </View>
            ) : null}
            {analysis.entryPrice ? (
              <View style={styles.numItem}>
                <Text style={[styles.numLabel, { color: colors.mutedForeground }]}>진입가</Text>
                <Text style={[styles.numValue, { color: colors.foreground }]}>{analysis.entryPrice.toLocaleString()}원</Text>
              </View>
            ) : null}
            {analysis.stopLoss ? (
              <View style={styles.numItem}>
                <Text style={[styles.numLabel, { color: colors.mutedForeground }]}>손절가</Text>
                <Text style={[styles.numValue, { color: colors.destructive }]}>{analysis.stopLoss.toLocaleString()}원</Text>
              </View>
            ) : null}
          </View>
        </View>
      )}

      {/* Steps */}
      {completedSteps.length > 0 && (
        <View style={styles.stepsSection}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>분석 단계</Text>
          {completedSteps.map((step, idx) => (
            <StepRow key={step.id} step={step} index={STEP_ORDER.indexOf(step.stepKey)} />
          ))}
        </View>
      )}

      {/* Empty pending steps */}
      {isInProgress && STEP_ORDER.filter((k) => !completedKeys.has(k)).map((stepKey) => (
        <View key={stepKey} style={[styles.pendingStep, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <View style={styles.pendingLeft}>
            <View style={[styles.pendingDot, { backgroundColor: colors.muted }]} />
            <View>
              <Text style={[styles.pendingNum, { color: colors.border }]}>STEP {STEP_ORDER.indexOf(stepKey) + 1}</Text>
              <Text style={[styles.pendingLabel, { color: colors.mutedForeground }]}>{STEP_LABELS[stepKey]}</Text>
            </View>
          </View>
          {stepKey === activeStep ? (
            <ActivityIndicator size="small" color={colors.mutedForeground} />
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backBtn: { marginBottom: 20 },
  headerBlock: { marginBottom: 24 },
  ticker: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  company: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginBottom: 4 },
  industry: { fontSize: 13, fontFamily: "Inter_400Regular" },
  progressCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  progressLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  progressCount: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  progressBar: { height: 4, borderRadius: 2, overflow: "hidden", marginBottom: 12 },
  progressFill: { height: "100%", borderRadius: 2 },
  activeMsg: { fontSize: 12, fontFamily: "Inter_400Regular" },
  verdictCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
    gap: 16,
  },
  verdictTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  verdictLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  verdictNumbers: { flexDirection: "row", gap: 24 },
  numItem: { gap: 4 },
  numLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  numValue: { fontSize: 16, fontFamily: "Inter_700Bold" },
  stepsSection: { marginBottom: 8 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 },
  pendingStep: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 10,
  },
  pendingLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  pendingDot: { width: 8, height: 8, borderRadius: 4 },
  pendingNum: { fontSize: 10, fontFamily: "Inter_500Medium", marginBottom: 2 },
  pendingLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
