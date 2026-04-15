import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useListAnalyses, useStartAnalysis } from "@workspace/api-client-react";
import { AnalysisCard } from "@/components/AnalysisCard";

const QUICK_PICKS = [
  { ticker: "005930", name: "삼성전자" },
  { ticker: "000660", name: "SK하이닉스" },
  { ticker: "035420", name: "NAVER" },
  { ticker: "005380", name: "현대차" },
];

const STEP_ORDER = [
  "company_intro",
  "industry_analysis",
  "catalyst_analysis",
  "company_analysis",
  "relative_valuation",
  "market_analysis",
  "investment_strategy",
];

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  const { data: analyses } = useListAnalyses();
  const { mutateAsync: startAnalysis, isPending } = useStartAnalysis();

  const runPipeline = async (analysisId: number) => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    for (const stepKey of STEP_ORDER) {
      try {
        await fetch(`https://${domain}/api/analysis/${analysisId}/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepKey }),
        });
      } catch {}
    }
  };

  const handleStart = async (ticker: string) => {
    const t = ticker.trim().toUpperCase();
    if (!t) { setError("종목코드를 입력하세요"); return; }
    setError("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const analysis = await startAnalysis({ ticker: t });
      router.push(`/analysis/${analysis.id}`);
      runPipeline(analysis.id);
    } catch {
      setError("분석을 시작할 수 없습니다. 종목코드를 확인해주세요.");
    }
  };

  const recentAnalyses = (analyses ?? []).slice(0, 3);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <FlatList
      data={recentAnalyses}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={[styles.container, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 80 }]}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View>
          {/* Header */}
          <View style={styles.brand}>
            <View style={[styles.brandDot, { backgroundColor: colors.foreground }]} />
            <Text style={[styles.brandText, { color: colors.foreground }]}>CBST</Text>
          </View>
          <Text style={[styles.headline, { color: colors.foreground }]}>어떤 종목을{"\n"}분석할까요?</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            코스피·코스닥 종목코드 입력
          </Text>

          {/* Search */}
          <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
              placeholder="예: 005930"
              placeholderTextColor={colors.mutedForeground}
              value={input}
              onChangeText={(t) => { setInput(t); setError(""); }}
              returnKeyType="search"
              onSubmitEditing={() => handleStart(input)}
              autoCapitalize="characters"
              keyboardType="default"
            />
            <Pressable
              style={({ pressed }) => [styles.searchBtn, { backgroundColor: colors.primary, opacity: pressed || isPending ? 0.8 : 1 }]}
              onPress={() => handleStart(input)}
              disabled={isPending}
            >
              {isPending ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
              )}
            </Pressable>
          </View>
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          {/* Quick picks */}
          <View style={styles.quickRow}>
            {QUICK_PICKS.map((p) => (
              <Pressable
                key={p.ticker}
                style={({ pressed }) => [styles.chip, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
                onPress={() => handleStart(p.ticker)}
              >
                <Text style={[styles.chipText, { color: colors.foreground }]}>{p.name}</Text>
              </Pressable>
            ))}
          </View>

          {recentAnalyses.length > 0 && (
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>최근 분석</Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <AnalysisCard analysis={item} onPress={() => router.push(`/analysis/${item.id}`)} />
      )}
      ListEmptyComponent={null}
    />
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  brand: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 24 },
  brandDot: { width: 8, height: 8, borderRadius: 4 },
  brandText: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 3 },
  headline: { fontSize: 34, fontFamily: "Inter_700Bold", lineHeight: 42, marginBottom: 8, letterSpacing: -0.5 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 28 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 10,
    marginBottom: 8,
  },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  searchBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  error: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 12 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 36 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 14 },
});
