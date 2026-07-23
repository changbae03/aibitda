import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, Keyboard, Modal, Platform,
  Pressable, RefreshControl, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useStockSearch, useRecentAnalyses, usePopular, useCredits,
  apiFetch,
  type StockSearchResult, type AnalysisListItem, type PopularItem,
  type AnalysisCreateResult,
} from "@/hooks/useApi";

const CORAL = "#FF8A7A";

// ── helpers ───────────────────────────────────────────────────────────────────

function exchInfo(item: StockSearchResult) {
  const exch = item.exchange ?? item.market ?? "";
  const isKR = exch === "KOSPI" || exch === "KOSDAQ" || /\.KS|\.KQ/.test(item.ticker);
  const label =
    exch === "KOSPI" ? "코스피" : exch === "KOSDAQ" ? "코스닥"
    : exch === "NASDAQ" ? "NASDAQ" : exch === "NYSE" ? "NYSE"
    : exch || null;
  return { label, isKR };
}

function tickerCode(t: string) { return t.replace(".KS", "").replace(".KQ", ""); }
function initials(item: StockSearchResult) {
  return (item.name || tickerCode(item.ticker)).slice(0, 2).toUpperCase();
}

// ── VerdictBadge ─────────────────────────────────────────────────────────────

function VerdictBadge({ verdict }: { verdict?: string | null }) {
  if (!verdict) return null;
  const v = verdict.toLowerCase();
  const [bg, color, label] =
    v.includes("strong buy") ? ["#dcfce7", "#16a34a", "강력매수"]
    : v.includes("buy")      ? ["#dcfce7", "#16a34a", "매수"]
    : v.includes("hold")     ? ["#fef9c3", "#a16207", "보유"]
    : v.includes("sell")     ? ["#fee2e2", "#dc2626", "매도"]
    : ["#f3f4f6", "#6b7280", verdict];
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
      <Text style={{ fontSize: 13, color, fontFamily: "Pretendard-SemiBold" }}>{label}</Text>
    </View>
  );
}

// ── Status / rows ─────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colors = useColors();
  const [color, label] =
    status === "completed"                            ? [colors.success, "완료"]
    : status === "in_progress" || status === "queued" ? ["#d97706",       "진행중"]
    :                                                   [colors.destructive, "오류"];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 13, color, fontFamily: "Pretendard-Regular" }}>{label}</Text>
    </View>
  );
}

function AnalysisRow({ item }: { item: AnalysisListItem }) {
  const colors = useColors();
  const router  = useRouter();
  const isKR    = /^\d/.test(item.ticker);
  const date    = new Date(item.createdAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
  return (
    <Pressable
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.muted : colors.background,
      }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{item.ticker}</Text>
          <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: colors.mutedForeground, flex: 1 }} numberOfLines={1}>
            {item.companyName ?? item.englishName ?? ""}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusDot status={item.status} />
          {item.targetPrice != null && (
            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
              목표 {isKR ? item.targetPrice.toLocaleString("ko-KR") + "원" : "$" + item.targetPrice.toFixed(2)}
            </Text>
          )}
          <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>{date}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <VerdictBadge verdict={item.investmentVerdict} />
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

function PopularRow({ item }: { item: PopularItem }) {
  const colors = useColors();
  const router  = useRouter();
  const [outcomeColor, outcomeLabel] =
    item.outcome === "hit_target" ? [colors.success,     "목표달성"]
    : item.outcome === "hit_stop" ? [colors.destructive, "손절"]
    :                               [colors.mutedForeground, "진행중"];
  return (
    <Pressable
      style={({ pressed }) => [{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 16, paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
        backgroundColor: pressed ? colors.muted : colors.background,
      }]}
      onPress={() => router.push(`/analysis/${item.id}`)}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: colors.foreground }}>{item.ticker}</Text>
          <Text style={{ fontSize: 14, fontFamily: "Pretendard-Regular", color: colors.mutedForeground, flex: 1 }} numberOfLines={1}>
            {item.companyName}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: outcomeColor }} />
            <Text style={{ fontSize: 13, color: outcomeColor, fontFamily: "Pretendard-Regular" }}>{outcomeLabel}</Text>
          </View>
          {item.priceReturn != null && (
            <Text style={{ fontSize: 13, fontFamily: "Pretendard-Regular", color: item.priceReturn >= 0 ? colors.success : colors.destructive }}>
              {item.priceReturn >= 0 ? "+" : ""}{item.priceReturn.toFixed(1)}%
            </Text>
          )}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <VerdictBadge verdict={item.investmentVerdict} />
        <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  visible, stock, credits, onCancel, onConfirm,
}: {
  visible: boolean;
  stock: StockSearchResult | null;
  credits: number | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useColors();
  if (!stock) return null;
  const { label, isKR } = exchInfo(stock);
  const code = tickerCode(stock.ticker);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={[styles.confirmCard, { backgroundColor: colors.card }]} onPress={() => {}}>
          {/* Header label */}
          <Text style={[styles.confirmLabel, { color: colors.mutedForeground }]}>AI 기업분석</Text>

          {/* Company row */}
          <View style={styles.confirmCompanyRow}>
            <View style={[styles.avatar, { backgroundColor: isKR ? "#dbeafe" : "#fef9c3" }]}>
              <Text style={[styles.avatarText, { color: isKR ? "#1d4ed8" : "#b45309" }]}>
                {initials(stock)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.confirmName, { color: colors.foreground }]}>{stock.name || code}</Text>
              <Text style={[styles.confirmCode, { color: colors.mutedForeground }]}>{code}</Text>
            </View>
            {label && (
              <View style={[styles.exchBadge, { backgroundColor: isKR ? "#dbeafe" : "#fef9c3" }]}>
                <Text style={[styles.exchBadgeText, { color: isKR ? "#1d4ed8" : "#b45309" }]}>{label}</Text>
              </View>
            )}
          </View>

          {/* Description */}
          <Text style={[styles.confirmDesc, { color: CORAL }]}>
            애빛다의 AI 애널리스트 팀이
          </Text>
          <Text style={[styles.confirmDescMain, { color: colors.foreground }]}>
            7단계 심층 분석을 시작합니다.
          </Text>
          <Text style={[styles.confirmDescSub, { color: colors.mutedForeground }]}>
            평균 3분 소요 · DCF/NPV 등 밸류에이션 자동 선정
          </Text>

          {/* Credit */}
          {credits != null && (
            <Text style={[styles.confirmCredit, { color: colors.mutedForeground }]}>
              오늘 {credits.toLocaleString()}회 사용 가능
            </Text>
          )}

          {/* Buttons */}
          <View style={styles.confirmBtns}>
            <TouchableOpacity
              style={[styles.confirmBtnCancel, { borderColor: colors.border }]}
              onPress={onCancel}
              activeOpacity={0.7}
            >
              <Text style={[styles.confirmBtnCancelText, { color: colors.foreground }]}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtnStart, { backgroundColor: CORAL }]}
              onPress={onConfirm}
              activeOpacity={0.85}
            >
              <Text style={styles.confirmBtnStartText}>분석 시작  →</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Disclaimer Modal ──────────────────────────────────────────────────────────

const DISCLAIMER_TEXT =
  "매크로·재무·밸류에이션·기술적 분석·투자 촉매 전문 AI 에이전트 7명이 협업해 작성한 결과물입니다. 본 서비스는 투자 자문이 아니며, 모든 투자 판단과 그 결과에 대한 책임은 사용자 본인에게 있습니다.";

function DisclaimerModal({
  visible, stock, onClose,
}: {
  visible: boolean;
  stock: StockSearchResult | null;
  onClose: () => void;
}) {
  const colors = useColors();
  const [countdown, setCountdown] = useState(5);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!visible) { setCountdown(5); return; }
    setCountdown(5);
    timerRef.current = setInterval(() => {
      setCountdown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [visible]);

  useEffect(() => {
    if (visible && countdown === 0) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      onClose();
    }
  }, [countdown, visible]);

  if (!stock) return null;
  const code = tickerCode(stock.ticker);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.disclaimerCard, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={styles.disclaimerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.disclaimerTicker, { color: colors.mutedForeground }]}>
                {code}  {stock.name || code}
              </Text>
              <Text style={[styles.disclaimerTitle, { color: colors.foreground }]}>
                참고용 리포트입니다
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.disclaimerClose}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Body */}
          <Text style={[styles.disclaimerBody, { color: colors.foreground }]}>
            {DISCLAIMER_TEXT}
          </Text>

          {/* Warning */}
          <View style={[styles.disclaimerWarning, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Text style={[styles.disclaimerWarningText, { color: colors.mutedForeground }]}>
              △ AI 특성상 수치나 판단에 오류가 포함될 수 있습니다. 핵심 수치는 반드시 직접 확인 후 참고하세요.
            </Text>
          </View>

          {/* Confirm button */}
          <TouchableOpacity
            style={styles.disclaimerBtn}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.disclaimerBtnText}>확인했습니다</Text>
          </TouchableOpacity>

          {/* Auto-close hint */}
          <Text style={[styles.disclaimerAuto, { color: colors.mutedForeground }]}>
            {countdown > 0 ? `잠시 후 자동으로 닫힙니다 (${countdown})` : "닫는 중…"}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

// ── Main Tab ──────────────────────────────────────────────────────────────────

export default function AnalysisTab() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const inputRef = useRef<TextInput>(null);

  const [seg, setSeg]             = useState<"최근 분석" | "인기 종목">("최근 분석");
  const [query, setQuery]         = useState("");
  const [showDrop, setShowDrop]   = useState(false);
  const [confirmStock, setConfirmStock] = useState<StockSearchResult | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [starting, setStarting]   = useState(false);

  const search  = useStockSearch(query);
  const recent  = useRecentAnalyses();
  const popular = usePopular();
  const { data: creditData } = useCredits();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const remaining = creditData?.remaining ?? null;

  // ── open confirm modal ────────────────────────────────────────────────────
  function selectStock(item: StockSearchResult) {
    Keyboard.dismiss();
    setShowDrop(false);
    setConfirmStock(item);
    setShowConfirm(true);
  }

  function handleSearchStart() {
    const first = search.data?.[0];
    if (!first) return;
    selectStock(first);
  }

  // ── confirm → disclaimer ──────────────────────────────────────────────────
  function handleConfirmed() {
    setShowConfirm(false);
    setTimeout(() => setShowDisclaimer(true), 200);
  }

  // ── disclaimer closed → start analysis ───────────────────────────────────
  async function handleDisclaimerClose() {
    setShowDisclaimer(false);
    if (!confirmStock) return;
    setStarting(true);
    try {
      const result = await apiFetch<AnalysisCreateResult>("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: confirmStock.ticker,
          companyName: confirmStock.name,
        }),
      });
      await apiFetch(`/api/analysis/${result.id}/run-pipeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
      router.push(`/analysis/${result.id}`);
    } catch (e: any) {
      // show inline error
    } finally {
      setStarting(false);
      setConfirmStock(null);
    }
  }

  function cancelConfirm() {
    setShowConfirm(false);
    setConfirmStock(null);
  }

  const canStart = query.trim().length > 0 && (search.data?.length ?? 0) > 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* ── Hero / Search ─────────────────────────────────────────────── */}
      <View style={[styles.hero, { paddingTop: topPad + 28 }]}>
        <Text style={[styles.heroTitle, { color: colors.foreground }]}>
          어떤 종목을{"\n"}분석할까요?
        </Text>
        <View style={{ gap: 4, marginTop: 2 }}>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]} lineBreakStrategyIOS="hangul-word">
            코스피·코스닥·NYSE·NASDAQ 종목을 검색하면
          </Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]} lineBreakStrategyIOS="hangul-word">
            AI 에이전트가 즉시 심층 분석을 시작합니다
          </Text>
        </View>

        {/* 크레딧 배지 */}
        {remaining != null && (
          <View style={styles.creditBadge}>
            <Feather name="zap" size={12} color={CORAL} />
            <Text style={[styles.creditText, { color: CORAL }]}>
              크레딧 {remaining.toLocaleString()}개 남음
            </Text>
          </View>
        )}

        {/* 검색 바 */}
        <View style={[styles.searchRow, {
          backgroundColor: colors.card,
          borderColor: showDrop ? CORAL + "88" : colors.border,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
          elevation: 2,
        }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} style={{ marginLeft: 14 }} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="삼성전자, NVDA, 005930, AAPL..."
            placeholderTextColor={colors.mutedForeground + "99"}
            value={query}
            onChangeText={(v) => { setQuery(v); setShowDrop(v.trim().length > 0); }}
            onFocus={() => { if (query.trim().length > 0) setShowDrop(true); }}
            returnKeyType="search"
            onSubmitEditing={handleSearchStart}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <Pressable onPress={() => { setQuery(""); setShowDrop(false); }} style={styles.searchClear}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          )}
          <Pressable
            style={[styles.searchBtn, { backgroundColor: canStart ? CORAL : CORAL + "55" }]}
            onPress={handleSearchStart}
            disabled={!canStart || starting}
          >
            {starting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.searchBtnText}>분석 시작  →</Text>
            }
          </Pressable>
        </View>

        {/* 힌트 */}
        <Text style={[styles.heroHint, { color: colors.mutedForeground + "88" }]}>
          © 평균 3분 안에 리포트 완성
        </Text>
      </View>

      {/* ── 검색 드롭다운 ─────────────────────────────────────────────── */}
      {showDrop && query.trim().length >= 1 ? (
        <View style={[styles.dropdown, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* 헤더 */}
          <View style={[styles.dropHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.dropHeaderTitle, { color: colors.mutedForeground }]}>종목 선택</Text>
            <Text style={[styles.dropHeaderHint, { color: colors.mutedForeground + "88" }]}>
              ↑↓ 이동 · Enter 선택
            </Text>
          </View>

          {search.isLoading ? (
            <ActivityIndicator color={CORAL} style={{ padding: 20 }} />
          ) : (search.data ?? []).length === 0 ? (
            <Text style={[styles.dropEmpty, { color: colors.mutedForeground }]}>검색 결과 없음</Text>
          ) : (
            <FlatList
              data={search.data ?? []}
              keyExtractor={(item) => item.ticker}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 280 }}
              renderItem={({ item }) => {
                const { label: exchLabel, isKR } = exchInfo(item);
                const code = tickerCode(item.ticker);
                return (
                  <Pressable
                    style={({ pressed }) => [
                      styles.dropRow,
                      { borderBottomColor: colors.border, backgroundColor: pressed ? colors.muted : "transparent" },
                    ]}
                    onPress={() => selectStock(item)}
                  >
                    <View style={[styles.dropAvatar, { backgroundColor: isKR ? "#dbeafe" : "#fef9c3" }]}>
                      <Text style={[styles.dropAvatarText, { color: isKR ? "#2563eb" : "#b45309" }]}>
                        {initials(item)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Text style={[styles.dropName, { color: colors.foreground }]}>{item.name || code}</Text>
                        {exchLabel && (
                          <View style={{ backgroundColor: isKR ? "#dbeafe" : "#fef9c3", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 }}>
                            <Text style={{ fontSize: 11, fontFamily: "Pretendard-SemiBold", color: isKR ? "#2563eb" : "#b45309" }}>
                              {exchLabel}
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.dropCode, { color: colors.mutedForeground }]}>{code}</Text>
                    </View>
                    <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      ) : (
        <>
          {/* ── 탭 ─────────────────────────────────────────────────────── */}
          <View style={[styles.segRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
            {(["최근 분석", "인기 종목"] as const).map((t) => (
              <Pressable
                key={t}
                style={({ pressed }) => [{
                  paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
                  backgroundColor: seg === t ? CORAL + "12" : "transparent",
                  opacity: pressed ? 0.7 : 1,
                }]}
                onPress={() => setSeg(t)}
              >
                <Text style={{
                  fontSize: 15,
                  fontFamily: seg === t ? "Pretendard-SemiBold" : "Pretendard-Regular",
                  color: seg === t ? CORAL : colors.mutedForeground,
                }}>{t}</Text>
              </Pressable>
            ))}
          </View>

          {/* ── 리스트 ─────────────────────────────────────────────────── */}
          {seg === "최근 분석" ? (
            recent.isLoading ? (
              <ActivityIndicator color={CORAL} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={recent.data ?? []}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
                renderItem={({ item }) => <AnalysisRow item={item} />}
                refreshControl={<RefreshControl refreshing={recent.isFetching} onRefresh={() => recent.refetch()} tintColor={CORAL} />}
                ListEmptyComponent={
                  <View style={{ alignItems: "center", paddingVertical: 60, gap: 10 }}>
                    <Feather name="cpu" size={36} color={colors.border} />
                    <Text style={{ fontSize: 18, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>아직 분석이 없습니다</Text>
                    <Text style={{ fontSize: 15, fontFamily: "Pretendard-Regular", color: colors.mutedForeground }}>위에서 종목을 검색해 분석을 시작하세요</Text>
                  </View>
                }
              />
            )
          ) : (
            popular.isLoading ? (
              <ActivityIndicator color={CORAL} style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={popular.data ?? []}
                keyExtractor={(item) => String(item.id)}
                contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
                renderItem={({ item }) => <PopularRow item={item} />}
                refreshControl={<RefreshControl refreshing={popular.isFetching} onRefresh={() => popular.refetch()} tintColor={CORAL} />}
                ListEmptyComponent={<Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 60, fontFamily: "Pretendard-Regular" }}>인기 분석이 없습니다</Text>}
              />
            )
          )}
        </>
      )}

      {/* ── Confirm Modal ──────────────────────────────────────────────── */}
      <ConfirmModal
        visible={showConfirm}
        stock={confirmStock}
        credits={remaining}
        onCancel={cancelConfirm}
        onConfirm={handleConfirmed}
      />

      {/* ── Disclaimer Modal ───────────────────────────────────────────── */}
      <DisclaimerModal
        visible={showDisclaimer}
        stock={confirmStock}
        onClose={handleDisclaimerClose}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  /* hero */
  hero:      { paddingHorizontal: 24, paddingBottom: 20, gap: 12 },
  heroTitle: { fontSize: 34, fontFamily: "Pretendard-Bold", lineHeight: 42 },
  heroSub:   { fontSize: 15, lineHeight: 24, fontFamily: "Pretendard-Regular" },

  creditBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start", backgroundColor: "#FFF0EE",
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: "#FFCFC9",
  },
  creditText: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },

  searchRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, borderWidth: 1, overflow: "hidden", marginTop: 4,
  },
  searchInput: {
    flex: 1, fontSize: 16, fontFamily: "Pretendard-Regular",
    paddingVertical: 14, paddingHorizontal: 10,
  },
  searchClear: { padding: 10 },
  searchBtn: {
    paddingHorizontal: 16, paddingVertical: 14,
    alignItems: "center", justifyContent: "center", minWidth: 90,
  },
  searchBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  heroHint:  { fontSize: 13, fontFamily: "Pretendard-Regular", textAlign: "center" },

  /* dropdown */
  dropdown: { marginHorizontal: 16, borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 8 },
  dropHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropHeaderTitle: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  dropHeaderHint:  { fontSize: 13, fontFamily: "Pretendard-Regular" },
  dropRow: {
    flexDirection: "row", alignItems: "center", padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  dropAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dropAvatarText: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  dropName:  { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  dropCode:  { fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 1 },
  dropEmpty: { padding: 20, textAlign: "center", fontFamily: "Pretendard-Regular" },

  /* tabs */
  segRow: {
    flexDirection: "row", paddingHorizontal: 12, paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  /* confirm modal */
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center", alignItems: "center", padding: 24,
  },
  confirmCard: {
    width: "100%", borderRadius: 20, padding: 24,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18, shadowRadius: 24, elevation: 12,
  },
  confirmLabel:      { fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 14 },
  confirmCompanyRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  avatar:            { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText:        { fontSize: 18, fontFamily: "Pretendard-Bold" },
  confirmName:       { fontSize: 20, fontFamily: "Pretendard-Bold" },
  confirmCode:       { fontSize: 15, fontFamily: "Pretendard-Regular", marginTop: 2 },
  exchBadge:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  exchBadgeText:     { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  confirmDesc:       { fontSize: 16, fontFamily: "Pretendard-SemiBold", marginBottom: 2 },
  confirmDescMain:   { fontSize: 18, fontFamily: "Pretendard-Bold", marginBottom: 6 },
  confirmDescSub:    { fontSize: 15, fontFamily: "Pretendard-Regular", lineHeight: 20 },
  confirmCredit:     { fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 12, textAlign: "right" },
  confirmBtns:       { flexDirection: "row", gap: 10, marginTop: 24 },
  confirmBtnCancel: {
    flex: 1, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, alignItems: "center", justifyContent: "center",
  },
  confirmBtnCancelText: { fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  confirmBtnStart: {
    flex: 1.4, paddingVertical: 14, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  confirmBtnStartText:  { fontSize: 17, fontFamily: "Pretendard-SemiBold", color: "#fff" },

  /* disclaimer modal */
  disclaimerCard: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 36,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12, shadowRadius: 16, elevation: 12,
  },
  disclaimerHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  disclaimerClose:  { padding: 4 },
  disclaimerTicker: { fontSize: 14, fontFamily: "Pretendard-Regular", marginBottom: 4 },
  disclaimerTitle:  { fontSize: 22, fontFamily: "Pretendard-Bold" },
  disclaimerBody:   { fontSize: 16, lineHeight: 22, fontFamily: "Pretendard-Regular", marginBottom: 16 },
  disclaimerWarning: {
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 20,
  },
  disclaimerWarningText: { fontSize: 14, lineHeight: 18, fontFamily: "Pretendard-Regular" },
  disclaimerBtn: {
    backgroundColor: "#111", borderRadius: 14, paddingVertical: 16,
    alignItems: "center", justifyContent: "center",
  },
  disclaimerBtnText: { fontSize: 18, fontFamily: "Pretendard-SemiBold", color: "#fff" },
  disclaimerAuto:    { fontSize: 14, fontFamily: "Pretendard-Regular", textAlign: "center", marginTop: 12 },
});
