import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useStockSearch, apiFetch, type StockSearchResult, type AnalysisCreateResult } from "@/hooks/useApi";

type Phase = "search" | "confirm" | "creating" | "running" | "done" | "error";

const STEP_LABELS: Record<string, string> = {
  company_intro:       "기업 기본 정보 수집",
  industry_analysis:   "산업/섹터 분석",
  company_analysis:    "기업 심층 분석",
  market_analysis:     "시장 데이터 분석",
  catalyst_analysis:   "촉매제 분석",
  investment_strategy: "투자 전략 도출",
};

interface AnalysisStatus {
  id: number;
  status: string;
  currentStep: string | null;
  completedSteps?: string[];
  errorMessage?: string | null;
}

export default function NewAnalysisScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ ticker?: string; name?: string }>();

  const [phase, setPhase] = useState<Phase>(params.ticker ? "confirm" : "search");
  const [query, setQuery] = useState(params.ticker ?? "");
  const [selected, setSelected] = useState<StockSearchResult | null>(
    params.ticker ? { ticker: params.ticker, name: params.name ?? params.ticker } : null
  );
  const [context, setContext] = useState("");
  const [analysisId, setAnalysisId] = useState<number | null>(null);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const search = useStockSearch(query);
  const s = makeStyles(colors);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function pollStatus(id: number) {
    try {
      const data = await apiFetch<AnalysisStatus>(`/api/analysis/${id}`);
      setStatus(data);
      if (data.status === "completed") {
        stopPolling();
        setPhase("done");
      } else if (data.status === "error") {
        stopPolling();
        setErrorMsg(data.errorMessage ?? "분석 중 오류가 발생했습니다");
        setPhase("error");
      }
    } catch { /* ignore */ }
  }

  async function startAnalysis() {
    if (!selected) return;
    setPhase("creating");
    setErrorMsg("");

    try {
      const result = await apiFetch<AnalysisCreateResult>(`/api/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: selected.ticker,
          companyName: selected.name,
          additionalContext: context.trim() || undefined,
        }),
      });

      setAnalysisId(result.id);
      setPhase("running");

      // Kick off pipeline
      await apiFetch(`/api/analysis/${result.id}/run-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {/* ok — enqueued */});

      // Poll for completion
      pollRef.current = setInterval(() => pollStatus(result.id), 3000);
      pollStatus(result.id);
    } catch (e: any) {
      const msg = e?.message ?? "알 수 없는 오류";
      setErrorMsg(msg.includes("400") ? "지원하지 않는 종목입니다 (ETF·해외거래소 제외)" : msg);
      setPhase("error");
    }
  }

  const completedSteps = status?.completedSteps ?? [];
  const currentStep = status?.currentStep ?? null;
  const allStepKeys = Object.keys(STEP_LABELS);

  // ── Search phase ──────────────────────────────────────────────────────────
  if (phase === "search") {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={s.navRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="x" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.navTitle}>새 AI 분석</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={s.searchSection}>
          <View style={s.searchBox}>
            <Feather name="search" size={15} color={colors.mutedForeground} />
            <TextInput
              style={s.searchInput}
              placeholder="종목명 또는 티커 입력"
              placeholderTextColor={colors.mutedForeground}
              value={query}
              onChangeText={setQuery}
              autoFocus
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>
        </View>

        {search.isLoading && query.length > 0 && (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
        )}

        <ScrollView keyboardShouldPersistTaps="handled">
          {(search.data ?? []).map((item) => (
            <Pressable
              key={item.ticker}
              style={({ pressed }) => [s.resultRow, { backgroundColor: pressed ? colors.muted : "transparent" }]}
              onPress={() => { setSelected(item); setPhase("confirm"); }}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.resultTicker}>{item.ticker}</Text>
                <Text style={s.resultName}>{item.name}</Text>
                {item.sector && <Text style={s.resultSector}>{item.sector}</Text>}
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Confirm phase ──────────────────────────────────────────────────────────
  if (phase === "confirm" && selected) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={s.navRow}>
          <TouchableOpacity onPress={() => { setPhase("search"); setSelected(null); }} style={s.backBtn}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.navTitle}>분석 시작</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={s.confirmContent} keyboardShouldPersistTaps="handled">
          {/* Selected stock card */}
          <View style={s.stockCard}>
            <View style={s.stockCardInner}>
              <View style={s.stockIcon}>
                <Text style={s.stockIconText}>{selected.ticker.charAt(0)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.stockTicker}>{selected.ticker}</Text>
                <Text style={s.stockName}>{selected.name}</Text>
              </View>
              <Pressable onPress={() => { setPhase("search"); setSelected(null); }}>
                <Feather name="edit-2" size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </View>

          {/* What AI will do */}
          <View style={s.stepsPreview}>
            <Text style={s.stepsTitle}>AI가 수행할 분석</Text>
            {allStepKeys.map((key) => (
              <View key={key} style={s.stepPreviewRow}>
                <View style={[s.stepDot, { backgroundColor: colors.primary + "44" }]} />
                <Text style={s.stepPreviewText}>{STEP_LABELS[key]}</Text>
              </View>
            ))}
          </View>

          {/* Additional context */}
          <View style={s.contextSection}>
            <Text style={s.contextLabel}>추가 컨텍스트 (선택)</Text>
            <TextInput
              style={s.contextInput}
              placeholder="예: 최근 실적 서프라이즈, 특이 이슈 등..."
              placeholderTextColor={colors.mutedForeground}
              value={context}
              onChangeText={setContext}
              multiline
              numberOfLines={3}
              maxLength={500}
              textAlignVertical="top"
            />
            <Text style={s.charCount}>{context.length}/500</Text>
          </View>
        </ScrollView>

        {/* Start button */}
        <View style={s.startBtnWrap}>
          <TouchableOpacity style={s.startBtn} onPress={startAnalysis}>
            <Feather name="cpu" size={18} color="#fff" />
            <Text style={s.startBtnText}>AI 분석 시작</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Creating / Running phase ───────────────────────────────────────────────
  if (phase === "creating" || phase === "running") {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={s.navRow}>
          <View style={{ width: 36 }} />
          <Text style={s.navTitle}>분석 진행 중</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={s.runningContent}>
          <View style={s.runningHeader}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={s.runningTicker}>{selected?.ticker}</Text>
            <Text style={s.runningName}>{selected?.name}</Text>
          </View>

          {currentStep && (
            <View style={s.currentStepBadge}>
              <View style={s.pulseDot} />
              <Text style={s.currentStepText}>{STEP_LABELS[currentStep] ?? currentStep}</Text>
            </View>
          )}

          <View style={s.stepsList}>
            {allStepKeys.map((key) => {
              const done = completedSteps.includes(key);
              const active = currentStep === key;
              return (
                <View key={key} style={s.stepRow}>
                  <View style={[
                    s.stepIcon,
                    done ? { backgroundColor: colors.up } : active ? { backgroundColor: colors.primary } : { backgroundColor: colors.muted },
                  ]}>
                    {done
                      ? <Feather name="check" size={12} color="#fff" />
                      : active
                      ? <ActivityIndicator size={12} color="#fff" />
                      : <Feather name="clock" size={12} color={colors.mutedForeground} />
                    }
                  </View>
                  <Text style={[
                    s.stepText,
                    done ? { color: colors.up } : active ? { color: colors.primary } : { color: colors.mutedForeground },
                  ]}>{STEP_LABELS[key]}</Text>
                </View>
              );
            })}
          </View>

          <Text style={s.runningNote}>분석에는 1-3분 정도 소요됩니다</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Done phase ────────────────────────────────────────────────────────────
  if (phase === "done" && analysisId) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={[s.runningContent, { justifyContent: "center", alignItems: "center", flex: 1 }]}>
          <View style={[s.stepIcon, { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.up, marginBottom: 20 }]}>
            <Feather name="check" size={32} color="#fff" />
          </View>
          <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: colors.foreground, marginBottom: 8 }}>분석 완료!</Text>
          <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginBottom: 32 }}>
            {selected?.name} 분석이 완료되었습니다
          </Text>
          <TouchableOpacity
            style={s.startBtn}
            onPress={() => {
              router.back();
              setTimeout(() => router.push(`/analysis/${analysisId}`), 100);
            }}
          >
            <Feather name="file-text" size={18} color="#fff" />
            <Text style={s.startBtnText}>분석 보고서 보기</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error phase ───────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={s.navRow}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="x" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={s.navTitle}>오류 발생</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 32 }}>
          <Feather name="alert-circle" size={48} color={colors.down} style={{ marginBottom: 16 }} />
          <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 8, textAlign: "center" }}>분석을 시작할 수 없습니다</Text>
          <Text style={{ fontSize: 13, color: colors.mutedForeground, textAlign: "center", lineHeight: 20, marginBottom: 32 }}>{errorMsg}</Text>
          <TouchableOpacity style={s.startBtn} onPress={() => setPhase("confirm")}>
            <Text style={s.startBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return null;
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 },
    backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    navTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: c.foreground },
    searchSection: { paddingHorizontal: 16, marginBottom: 8 },
    searchBox: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: c.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
      borderWidth: 1, borderColor: c.border,
    },
    searchInput: { flex: 1, fontSize: 15, color: c.foreground, fontFamily: "Inter_400Regular", padding: 0 },
    resultRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    resultTicker: { fontSize: 15, fontFamily: "Inter_700Bold", color: c.foreground },
    resultName: { fontSize: 12, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    resultSector: { fontSize: 11, color: c.mutedForeground + "aa", fontFamily: "Inter_400Regular" },
    confirmContent: { padding: 16, gap: 16, paddingBottom: 100 },
    stockCard: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.border },
    stockCardInner: { flexDirection: "row", alignItems: "center", gap: 12 },
    stockIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.primary + "22", alignItems: "center", justifyContent: "center" },
    stockIconText: { fontSize: 18, fontFamily: "Inter_700Bold", color: c.primary },
    stockTicker: { fontSize: 18, fontFamily: "Inter_700Bold", color: c.foreground },
    stockName: { fontSize: 13, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    stepsPreview: { backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.border, gap: 10 },
    stepsTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.mutedForeground, marginBottom: 4 },
    stepPreviewRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    stepDot: { width: 8, height: 8, borderRadius: 4 },
    stepPreviewText: { fontSize: 13, color: c.foreground, fontFamily: "Inter_400Regular" },
    contextSection: { gap: 8 },
    contextLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: c.mutedForeground },
    contextInput: {
      backgroundColor: c.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: c.border, fontSize: 14,
      color: c.foreground, fontFamily: "Inter_400Regular", minHeight: 90,
    },
    charCount: { fontSize: 11, color: c.mutedForeground, textAlign: "right", fontFamily: "Inter_400Regular" },
    startBtnWrap: { padding: 16, paddingBottom: 32 },
    startBtn: {
      backgroundColor: c.primary, borderRadius: 14, paddingVertical: 16,
      flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    },
    startBtnText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
    runningContent: { padding: 24, gap: 24 },
    runningHeader: { alignItems: "center", gap: 12, paddingTop: 20 },
    runningTicker: { fontSize: 24, fontFamily: "Inter_700Bold", color: c.foreground },
    runningName: { fontSize: 14, color: c.mutedForeground, fontFamily: "Inter_400Regular" },
    currentStepBadge: {
      flexDirection: "row", alignItems: "center", gap: 10,
      backgroundColor: c.primary + "18", borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: c.primary + "44",
    },
    pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary },
    currentStepText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: c.primary },
    stepsList: { gap: 12, backgroundColor: c.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: c.border },
    stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    stepIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    stepText: { fontSize: 13, fontFamily: "Inter_500Medium" },
    runningNote: { textAlign: "center", color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 },
  });
}
