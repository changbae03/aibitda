import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Keyboard, Platform,
  Pressable, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useStockSearch, apiFetch, type StockSearchResult, type AnalysisCreateResult } from "@/hooks/useApi";

// ── types ─────────────────────────────────────────────────────────────────────

type Phase = "search" | "confirm" | "creating" | "running" | "done" | "error";

interface CreditStatus { remaining: number; dailyLimit: number; dailyUsed: number; }

interface AnalysisStatus {
  id: number;
  status: string;
  currentStep: string | null;
  completedSteps?: string[];
  errorMessage?: string | null;
}

// ── constants ─────────────────────────────────────────────────────────────────

const STEP_LABELS: Record<string, string> = {
  company_intro:       "기업 기본 정보 수집",
  industry_analysis:   "산업·섹터 분석",
  company_analysis:    "기업 심층 분석",
  catalyst_analysis:   "촉매제·수급 분석",
  relative_valuation:  "밸류에이션 산출",
  market_analysis:     "기술적 분석",
  investment_strategy: "투자 전략 도출",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function exchInfo(item: StockSearchResult): { label: string | null; isKR: boolean } {
  const exch = item.exchange ?? item.market ?? "";
  const isKR = exch === "KOSPI" || exch === "KOSDAQ" || /\.KS|\.KQ/.test(item.ticker);
  const label =
    exch === "KOSPI" ? "코스피"
    : exch === "KOSDAQ" ? "코스닥"
    : exch === "NASDAQ" ? "나스닥"
    : exch === "NYSE" ? "NYSE"
    : exch || null;
  return { label, isKR };
}

function tickerCode(item: StockSearchResult) {
  return item.ticker.replace(".KS", "").replace(".KQ", "");
}

function initials(item: StockSearchResult) {
  const code = tickerCode(item);
  return (item.name || code).slice(0, 2).toUpperCase();
}

// ── sub-components ────────────────────────────────────────────────────────────

function CreditBadge({ credit }: { credit: CreditStatus | null }) {
  const colors = useColors();
  if (!credit) return null;
  const rem = Math.max(0, credit.remaining ?? credit.dailyLimit - credit.dailyUsed);
  const low = rem <= 3;
  return (
    <View style={[styles.creditBadge, {
      backgroundColor: low ? "#fef3c7" : colors.card,
      borderColor: low ? "#fde68a" : colors.border,
    }]}>
      <Feather name="star" size={11} color={low ? "#d97706" : colors.primary} />
      <Text style={[styles.creditText, { color: low ? "#92400e" : colors.mutedForeground }]}>
        크레딧 {rem.toLocaleString()}개 남음
      </Text>
    </View>
  );
}

function StockRow({
  item,
  onPress,
  style,
}: {
  item: StockSearchResult;
  onPress: () => void;
  style?: any;
}) {
  const colors = useColors();
  const { label, isKR } = exchInfo(item);
  const code = tickerCode(item);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.stockRow,
        { borderBottomColor: colors.border, backgroundColor: pressed ? colors.accent : "transparent" },
        style,
      ]}
    >
      {/* Avatar */}
      <View style={[styles.stockAvatar, { backgroundColor: isKR ? "#dbeafe" : "#fef9c3" }]}>
        <Text style={[styles.stockAvatarText, { color: isKR ? "#1d4ed8" : "#b45309" }]}>
          {initials(item)}
        </Text>
      </View>

      {/* Name + badge */}
      <View style={styles.stockMeta}>
        <View style={styles.stockNameRow}>
          <Text style={[styles.stockName, { color: colors.foreground }]} numberOfLines={1}>
            {item.name || code}
          </Text>
          {label && (
            <View style={[styles.exchBadge, { backgroundColor: isKR ? "#dbeafe" : "#fef9c3" }]}>
              <Text style={[styles.exchBadgeText, { color: isKR ? "#1d4ed8" : "#b45309" }]}>
                {label}
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.stockCode, { color: colors.mutedForeground }]}>{code}</Text>
      </View>

      <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
    </Pressable>
  );
}

// ── Search / Select screen ────────────────────────────────────────────────────

function SearchScreen({
  onSelect,
  onClose,
}: {
  onSelect: (item: StockSearchResult) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [credit, setCredit] = useState<CreditStatus | null>(null);
  const search = useStockSearch(query);
  const showDrop = query.trim().length >= 1;

  useEffect(() => {
    apiFetch<CreditStatus>("/api/credits")
      .then(setCredit)
      .catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 120);
  }, []);

  const canStart = showDrop && (search.data?.length ?? 0) > 0;

  function handleStart() {
    const first = search.data?.[0];
    if (!first) return;
    Keyboard.dismiss();
    onSelect(first);
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={["top"]}>
      {/* Close button */}
      <Pressable style={styles.closeBtn} onPress={onClose}>
        <Feather name="x" size={20} color={colors.mutedForeground} />
      </Pressable>

      {/* Hero */}
      <View style={styles.hero}>
        <Text style={[styles.heroTitle, { color: colors.foreground }]}>
          어떤 종목을{"\n"}분석할까요?
        </Text>
        <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
          코스피·코스닥·NYSE·NASDAQ 종목코드 또는 회사명으로{"\n"}검색하면 AI 에이전트가 즉시 심층 분석을 시작합니다
        </Text>

        {/* Credit badge */}
        <CreditBadge credit={credit} />

        {/* Search bar */}
        <View style={[styles.searchBar, {
          backgroundColor: colors.card,
          borderColor: showDrop ? colors.primary : colors.border,
        }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} style={{ marginLeft: 14 }} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="삼성전자, NVDA, 005930..."
            placeholderTextColor={colors.mutedForeground}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={handleStart}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} style={styles.clearBtn}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
          <Pressable
            style={[styles.startBtn, { backgroundColor: canStart ? colors.primary : colors.primary + "55" }]}
            onPress={handleStart}
            disabled={!canStart}
          >
            <Text style={styles.startBtnText}>분석 시작  →</Text>
          </Pressable>
        </View>

        {/* Hint */}
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          ⏱ 평균 3분 만에 리포트 완성
        </Text>
      </View>

      {/* Dropdown */}
      {showDrop && (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Dropdown header */}
          <View style={[styles.dropHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.dropHeaderTitle, { color: colors.mutedForeground }]}>종목 선택</Text>
            <Text style={[styles.dropHeaderHint, { color: colors.mutedForeground + "88" }]}>
              Enter 선택
            </Text>
          </View>

          {search.isLoading ? (
            <View style={styles.dropLoading}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          ) : (search.data ?? []).length === 0 ? (
            <View style={styles.dropEmpty}>
              <Text style={[styles.dropEmptyText, { color: colors.mutedForeground }]}>
                검색 결과가 없습니다
              </Text>
            </View>
          ) : (
            <FlatList
              data={search.data ?? []}
              keyExtractor={(item) => item.ticker}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 280 }}
              renderItem={({ item, index }) => (
                <StockRow
                  item={item}
                  onPress={() => { Keyboard.dismiss(); onSelect(item); }}
                  style={index === (search.data?.length ?? 0) - 1 ? { borderBottomWidth: 0 } : undefined}
                />
              )}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ── Confirm screen ────────────────────────────────────────────────────────────

function ConfirmScreen({
  selected,
  onBack,
  onStart,
}: {
  selected: StockSearchResult;
  onBack: () => void;
  onStart: (context: string) => void;
}) {
  const colors = useColors();
  const [context, setContext] = useState("");
  const { label, isKR } = exchInfo(selected);
  const code = tickerCode(selected);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={["top"]}>
      {/* Nav */}
      <View style={styles.navRow}>
        <Pressable style={styles.navBackBtn} onPress={onBack}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>분석 설정</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Stock card */}
      <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.confirmCardInner}>
          <View style={[styles.stockAvatar, styles.stockAvatarLg, { backgroundColor: isKR ? "#dbeafe" : "#fef9c3" }]}>
            <Text style={[styles.stockAvatarText, styles.stockAvatarTextLg, { color: isKR ? "#1d4ed8" : "#b45309" }]}>
              {initials(selected)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Text style={[styles.confirmName, { color: colors.foreground }]}>{selected.name || code}</Text>
              {label && (
                <View style={[styles.exchBadge, { backgroundColor: isKR ? "#dbeafe" : "#fef9c3" }]}>
                  <Text style={[styles.exchBadgeText, { color: isKR ? "#1d4ed8" : "#b45309" }]}>{label}</Text>
                </View>
              )}
            </View>
            <Text style={[styles.confirmCode, { color: colors.mutedForeground }]}>{code}</Text>
          </View>
          <Pressable onPress={onBack} style={{ padding: 4 }}>
            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      {/* AI steps preview */}
      <View style={[styles.stepsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.stepsTitle, { color: colors.mutedForeground }]}>AI가 수행할 분석</Text>
        <View style={styles.stepsGrid}>
          {Object.values(STEP_LABELS).map((label) => (
            <View key={label} style={styles.stepItem}>
              <View style={[styles.stepDot, { backgroundColor: colors.primary + "44" }]} />
              <Text style={[styles.stepItemText, { color: colors.foreground }]}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Context input */}
      <View style={styles.contextWrap}>
        <Text style={[styles.contextLabel, { color: colors.mutedForeground }]}>추가 컨텍스트 (선택)</Text>
        <TextInput
          style={[styles.contextInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          placeholder="예: 최근 실적 서프라이즈, 특이 이슈 등..."
          placeholderTextColor={colors.mutedForeground}
          value={context}
          onChangeText={setContext}
          multiline
          numberOfLines={3}
          maxLength={500}
          textAlignVertical="top"
        />
        <Text style={[styles.charCount, { color: colors.mutedForeground }]}>{context.length}/500</Text>
      </View>

      {/* Start button */}
      <View style={styles.startBtnWrap}>
        <TouchableOpacity
          style={[styles.startBtnFull, { backgroundColor: colors.primary }]}
          onPress={() => onStart(context.trim())}
          activeOpacity={0.85}
        >
          <Feather name="cpu" size={18} color="#fff" />
          <Text style={styles.startBtnFullText}>AI 분석 시작</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Running screen ────────────────────────────────────────────────────────────

function RunningScreen({ selected, status }: { selected: StockSearchResult; status: AnalysisStatus | null }) {
  const colors = useColors();
  const completedSteps = status?.completedSteps ?? [];
  const currentStep = status?.currentStep ?? null;
  const allStepKeys = Object.keys(STEP_LABELS);
  const doneCount = completedSteps.length;
  const total = allStepKeys.length;
  const pct = total > 0 ? (doneCount / total) * 100 : 0;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={styles.runningRoot}>
        {/* Header */}
        <View style={styles.runningHeader}>
          <View style={[styles.runningSpinnerWrap, { backgroundColor: colors.primary + "18" }]}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
          <Text style={[styles.runningName, { color: colors.foreground }]}>{selected.name || tickerCode(selected)}</Text>
          <Text style={[styles.runningTicker, { color: colors.mutedForeground }]}>{tickerCode(selected)}</Text>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: colors.primary }]} />
        </View>
        <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
          {doneCount}/{total} 단계 완료
        </Text>

        {/* Current step badge */}
        {currentStep && (
          <View style={[styles.currentBadge, { backgroundColor: colors.primary + "14", borderColor: colors.primary + "44" }]}>
            <View style={[styles.pulseDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.currentBadgeText, { color: colors.primary }]}>
              {STEP_LABELS[currentStep] ?? currentStep}
            </Text>
          </View>
        )}

        {/* Steps list */}
        <View style={[styles.stepsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {allStepKeys.map((key) => {
            const done = completedSteps.includes(key);
            const active = currentStep === key;
            return (
              <View key={key} style={styles.stepsListRow}>
                <View style={[
                  styles.stepIcon,
                  { backgroundColor: done ? colors.up : active ? colors.primary : colors.muted },
                ]}>
                  {done
                    ? <Feather name="check" size={11} color="#fff" />
                    : active
                    ? <ActivityIndicator size={11} color="#fff" />
                    : <Feather name="clock" size={11} color={colors.mutedForeground} />
                  }
                </View>
                <Text style={[
                  styles.stepsListText,
                  { color: done ? colors.up : active ? colors.primary : colors.mutedForeground },
                ]}>
                  {STEP_LABELS[key]}
                </Text>
              </View>
            );
          })}
        </View>

        <Text style={[styles.runningNote, { color: colors.mutedForeground }]}>
          분석에는 1–3분 정도 소요됩니다
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ── Done screen ───────────────────────────────────────────────────────────────

function DoneScreen({ selected, analysisId, onView }: { selected: StockSearchResult; analysisId: number; onView: () => void }) {
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={styles.doneRoot}>
        <View style={[styles.doneIconWrap, { backgroundColor: "#dcfce7" }]}>
          <Feather name="check" size={36} color="#16a34a" />
        </View>
        <Text style={[styles.doneTitle, { color: colors.foreground }]}>분석 완료!</Text>
        <Text style={[styles.doneSub, { color: colors.mutedForeground }]}>
          {selected.name || tickerCode(selected)} 분석이 완료되었습니다
        </Text>
        <TouchableOpacity style={[styles.startBtnFull, { backgroundColor: colors.primary, marginTop: 32 }]} onPress={onView}>
          <Feather name="file-text" size={18} color="#fff" />
          <Text style={styles.startBtnFullText}>분석 보고서 보기</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Error screen ──────────────────────────────────────────────────────────────

function ErrorScreen({ msg, onRetry, onClose }: { msg: string; onRetry: () => void; onClose: () => void }) {
  const colors = useColors();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={["top"]}>
      <View style={styles.navRow}>
        <Pressable style={styles.navBackBtn} onPress={onClose}>
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>오류</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.doneRoot}>
        <Feather name="alert-circle" size={48} color={colors.destructive} />
        <Text style={[styles.doneTitle, { color: colors.foreground, marginTop: 16 }]}>분석을 시작할 수 없습니다</Text>
        <Text style={[styles.doneSub, { color: colors.mutedForeground }]}>{msg}</Text>
        <TouchableOpacity style={[styles.startBtnFull, { backgroundColor: colors.primary, marginTop: 32 }]} onPress={onRetry}>
          <Text style={styles.startBtnFullText}>다시 시도</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function NewAnalysisScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ticker?: string; name?: string }>();

  const [phase, setPhase] = useState<Phase>(params.ticker ? "confirm" : "search");
  const [selected, setSelected] = useState<StockSearchResult | null>(
    params.ticker ? { ticker: params.ticker, name: params.name ?? params.ticker } : null
  );
  const [analysisId, setAnalysisId] = useState<number | null>(null);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function pollStatus(id: number) {
    try {
      const data = await apiFetch<AnalysisStatus>(`/api/analysis/${id}`);
      setStatus(data);
      if (data.status === "completed") { stopPolling(); setPhase("done"); }
      else if (data.status === "error") {
        stopPolling();
        setErrorMsg(data.errorMessage ?? "분석 중 오류가 발생했습니다");
        setPhase("error");
      }
    } catch { /**/ }
  }

  async function startAnalysis(context: string) {
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
          additionalContext: context || undefined,
        }),
      });
      setAnalysisId(result.id);
      setPhase("running");
      await apiFetch(`/api/analysis/${result.id}/run-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
      pollRef.current = setInterval(() => pollStatus(result.id), 3000);
      pollStatus(result.id);
    } catch (e: any) {
      const msg = e?.message ?? "알 수 없는 오류";
      setErrorMsg(msg.includes("400") ? "지원하지 않는 종목입니다 (ETF·해외거래소 제외)" : msg);
      setPhase("error");
    }
  }

  if (phase === "search") {
    return (
      <SearchScreen
        onSelect={(item) => { setSelected(item); setPhase("confirm"); }}
        onClose={() => router.back()}
      />
    );
  }

  if ((phase === "confirm") && selected) {
    return (
      <ConfirmScreen
        selected={selected}
        onBack={() => { setPhase("search"); setSelected(null); }}
        onStart={(ctx) => startAnalysis(ctx)}
      />
    );
  }

  if ((phase === "creating" || phase === "running") && selected) {
    return <RunningScreen selected={selected} status={status} />;
  }

  if (phase === "done" && analysisId && selected) {
    return (
      <DoneScreen
        selected={selected}
        analysisId={analysisId}
        onView={() => {
          router.back();
          setTimeout(() => router.push(`/analysis/${analysisId}`), 100);
        }}
      />
    );
  }

  if (phase === "error") {
    return (
      <ErrorScreen
        msg={errorMsg}
        onRetry={() => setPhase("confirm")}
        onClose={() => router.back()}
      />
    );
  }

  return null;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Search screen
  closeBtn: {
    position: "absolute",
    top: Platform.OS === "web" ? 16 : 54,
    right: 16,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  hero: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "web" ? 60 : 90,
    paddingBottom: 24,
    gap: 12,
  },
  heroTitle: {
    fontSize: 36,
    fontFamily: "Pretendard-Bold",
    lineHeight: 42,
    letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: 15,
    lineHeight: 20,
    fontFamily: "Pretendard-Regular",
  },

  // Credit badge
  creditBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  creditText: { fontSize: 14, fontFamily: "Pretendard-Medium" },

  // Search bar
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: "hidden",
    marginTop: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 17,
    fontFamily: "Pretendard-Regular",
    paddingVertical: 15,
    paddingHorizontal: 10,
    padding: 0,
  },
  clearBtn: { padding: 10 },
  startBtn: {
    paddingHorizontal: 16,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  startBtnText: {
    fontSize: 15,
    fontFamily: "Pretendard-Bold",
    color: "#fff",
  },
  hint: {
    fontSize: 14,
    fontFamily: "Pretendard-Regular",
    textAlign: "center",
  },

  // Dropdown
  dropdown: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  dropHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropHeaderTitle: {
    fontSize: 13,
    fontFamily: "Pretendard-SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dropHeaderHint: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  dropLoading: { padding: 20, alignItems: "center" },
  dropEmpty: { padding: 20, alignItems: "center" },
  dropEmptyText: { fontSize: 15, fontFamily: "Pretendard-Regular" },

  // Stock row (dropdown + confirm)
  stockRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  stockAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stockAvatarLg: { width: 48, height: 48, borderRadius: 14 },
  stockAvatarText: { fontSize: 16, fontFamily: "Pretendard-Bold" },
  stockAvatarTextLg: { fontSize: 18 },
  stockMeta: { flex: 1 },
  stockNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  stockName: { fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  stockCode: { fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 2 },
  exchBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  exchBadgeText: { fontSize: 12, fontFamily: "Pretendard-SemiBold" },

  // Nav
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  navBackBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: { fontSize: 19, fontFamily: "Pretendard-SemiBold" },

  // Confirm
  confirmCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  confirmCardInner: { flexDirection: "row", alignItems: "center", gap: 12 },
  confirmName: { fontSize: 20, fontFamily: "Pretendard-Bold" },
  confirmCode: { fontSize: 15, fontFamily: "Pretendard-Regular", marginTop: 2 },

  stepsCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  stepsTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },
  stepsGrid: { gap: 8 },
  stepItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepItemText: { fontSize: 15, fontFamily: "Pretendard-Regular" },

  contextWrap: { paddingHorizontal: 16, gap: 8 },
  contextLabel: { fontSize: 15, fontFamily: "Pretendard-SemiBold" },
  contextInput: {
    borderRadius: 12, padding: 14, borderWidth: 1,
    fontSize: 16, fontFamily: "Pretendard-Regular", minHeight: 90,
  },
  charCount: { fontSize: 13, textAlign: "right", fontFamily: "Pretendard-Regular" },

  startBtnWrap: { padding: 16, paddingBottom: 32, marginTop: "auto" },
  startBtnFull: {
    borderRadius: 14, paddingVertical: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
  },
  startBtnFullText: { fontSize: 18, fontFamily: "Pretendard-Bold", color: "#fff" },

  // Running
  runningRoot: { flex: 1, padding: 24, gap: 20, paddingTop: 40 },
  runningHeader: { alignItems: "center", gap: 14 },
  runningSpinnerWrap: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: "center", justifyContent: "center",
  },
  runningName: { fontSize: 26, fontFamily: "Pretendard-Bold" },
  runningTicker: { fontSize: 16, fontFamily: "Pretendard-Regular" },
  progressTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },
  progressLabel: { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center" },
  currentBadge: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, padding: 14, borderWidth: 1,
  },
  pulseDot: { width: 8, height: 8, borderRadius: 4 },
  currentBadgeText: { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  stepsList: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 12 },
  stepsListRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepsListText: { fontSize: 15, fontFamily: "Pretendard-Medium" },
  runningNote: { fontSize: 15, textAlign: "center", fontFamily: "Pretendard-Regular" },

  // Done / Error
  doneRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  doneIconWrap: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  doneTitle: { fontSize: 26, fontFamily: "Pretendard-Bold", marginTop: 4 },
  doneSub: { fontSize: 16, fontFamily: "Pretendard-Regular", textAlign: "center", lineHeight: 22, marginTop: 8 },
});
