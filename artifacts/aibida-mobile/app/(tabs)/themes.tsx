import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Platform, Pressable,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import TickerLogo from "@/components/TickerLogo";
import {
  useTomorrowPicks, usePresurge, useThemeSignals, useLiveGainers, useInstitutionPicks,
  apiFetch,
  type TomorrowPick, type PresurgePick, type ThemeSignal, type LiveGainerItem, type InstitutionPick,
} from "@/hooks/useApi";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeedStock {
  ticker: string;
  name: string;
  market: "KR" | "US";
  sector?: string;
  rationale: string;
  priceChange?: number;
  volumeRatio?: number;
  isLeader?: boolean;
  institutionAek?: number;
  foreignAek?: number;
  smartMoneyAek?: number;
}

type ThemePhase = "hot" | "momentum" | "emerging" | "quiet";

interface ThemeFeedItem {
  id: string;
  name: string;
  description: string;
  emoji: string;
  summary: string;
  stocks: FeedStock[];
  phase?: ThemePhase;
  themeSmartMoney?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stockForceScore(s: FeedStock) {
  return (s.priceChange ?? 0) * 0.6 + ((s.volumeRatio ?? 1) - 1) * 0.4;
}

function computeThemeForce(stocks: FeedStock[]) {
  const w = stocks.filter(s => s.priceChange != null);
  if (!w.length) return null;
  const scores = w.map(stockForceScore);
  return { avg: scores.reduce((a, b) => a + b, 0) / scores.length, max: Math.max(...scores) };
}

function phaseMeta(phase?: ThemePhase, avg?: number | null) {
  if (phase === "hot")      return { label: "강세",      color: "#EF4444", bg: "#FEE2E2", dot: "#EF4444" };
  if (phase === "momentum") return { label: "상승 중",   color: "#F97316", bg: "#FFF1EE", dot: "#F97316" };
  if (phase === "emerging") return { label: "수급 형성", color: "#7C3AED", bg: "#EDE9FE", dot: "#7C3AED" };
  const a = avg ?? 0;
  if (a >= 2) return { label: "상승 중", color: "#F97316", bg: "#FFF1EE", dot: "#F97316" };
  if (a >= 0) return { label: "보합",    color: "#94a3b8", bg: "#F1F5F9", dot: "#94a3b8" };
  return       { label: "조정",     color: "#94a3b8", bg: "#F1F5F9", dot: "#94a3b8" };
}

function momentumInfo(s: FeedStock): { text: string; color: string } {
  const sm = s.smartMoneyAek;
  const inst = s.institutionAek ?? 0;
  const fore = s.foreignAek ?? 0;
  if (sm != null) {
    if (inst > 0 && fore > 0) return { text: "기관+외인 동시", color: "#7C3AED" };
    if (inst > 10)             return { text: `기관 +${inst.toFixed(0)}억`, color: "#7C3AED" };
    if (inst > 0)              return { text: "기관 매집",      color: "#8B5CF6" };
    if (fore > 10)             return { text: `외인 +${fore.toFixed(0)}억`, color: "#0EA5E9" };
    if (fore > 0)              return { text: "외인 유입",      color: "#0EA5E9" };
    if (inst < -10)            return { text: "기관 매도",      color: "#EF4444" };
  }
  if (s.priceChange == null) return { text: "조회 중", color: "#94a3b8" };
  const up = s.priceChange > 0.5;
  const vol = (s.volumeRatio ?? 1) >= 1.3;
  if (up && vol)  return { text: "거래량↑ 상승", color: "#16a34a" };
  if (up && !vol) return { text: "상승",         color: "#ca8a04" };
  if (!up && vol) return { text: "거래량↑",      color: "#F97316" };
  return               { text: "관망",            color: "#94a3b8" };
}

const TABS = ["테마 분석", "내일 종목", "수급 레이더"] as const;
type Tab = typeof TABS[number];

// ── 테마별 수급 강도 랭킹 ──────────────────────────────────────────────────────

function ThemeForceRanking({ feed, colors }: { feed: ThemeFeedItem[]; colors: any }) {
  const phaseRank: Record<string, number> = { hot: 4, momentum: 3, emerging: 2, quiet: 1 };
  const ranked = [...feed]
    .map(item => ({ ...item, force: computeThemeForce(item.stocks) }))
    .sort((a, b) => {
      const pr = (phaseRank[b.phase ?? "quiet"] ?? 1) - (phaseRank[a.phase ?? "quiet"] ?? 1);
      return pr !== 0 ? pr : (b.themeSmartMoney ?? 0) - (a.themeSmartMoney ?? 0);
    });
  if (!ranked.length) return null;
  const absMax = Math.max(...ranked.map(r => Math.abs(r.force?.avg ?? 0)), 0.1);

  return (
    <View style={[rs.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* 헤더 */}
      <View style={rs.sectionHeader}>
        <View style={[rs.iconWrap, { backgroundColor: "#eef2ff" }]}>
          <Feather name="activity" size={13} color="#6366f1" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[rs.sectionTitle, { color: colors.foreground }]}>테마별 수급 강도</Text>
          <Text style={[rs.sectionSub, { color: colors.mutedForeground }]}>돈이 쏠리는 순서</Text>
        </View>
      </View>

      {/* 랭킹 rows */}
      {ranked.map((item, i) => {
        const force = item.force;
        const meta = phaseMeta(item.phase, force?.avg);
        const barPct = Math.max(4, (Math.abs(force?.avg ?? 0) / absMax) * 100);
        const isTop3 = i < 3;

        return (
          <View key={item.id} style={[rs.rankRow, i === ranked.length - 1 && { borderBottomWidth: 0 }, { borderBottomColor: colors.border }]}>
            {/* 순위 번호 */}
            <Text style={[rs.rankNum, { color: isTop3 ? colors.foreground : colors.mutedForeground, fontFamily: isTop3 ? "Pretendard-Bold" : "Pretendard-Regular" }]}>
              {i + 1}
            </Text>

            {/* 이모지 */}
            <Text style={rs.rankEmoji}>{item.emoji}</Text>

            {/* 이름 */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[rs.rankName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
              {item.phase === "emerging" && (item.themeSmartMoney ?? 0) > 0 && (
                <Text style={rs.rankSm}>
                  스마트머니 +{item.themeSmartMoney!.toFixed(0)}억
                </Text>
              )}
            </View>

            {/* 바 */}
            <View style={[rs.barTrack, { backgroundColor: colors.border }]}>
              <View style={[rs.barFill, { width: `${barPct}%` as any, backgroundColor: meta.dot }]} />
            </View>

            {/* 상태 뱃지 */}
            <View style={[rs.phaseBadge, { backgroundColor: meta.bg }]}>
              <Text style={[rs.phaseText, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── 종목 행 (테마 카드 내부) ───────────────────────────────────────────────────

function StockRow({ stock, onAnalyze, colors }: { stock: FeedStock; onAnalyze: (t: string, n: string) => void; colors: any }) {
  const change = stock.priceChange;
  const momentum = momentumInfo(stock);
  const isKR = stock.market === "KR";
  const sm = stock.smartMoneyAek ?? 0;
  const isAccumulating = stock.smartMoneyAek != null && sm > 0 && Math.abs(change ?? 0) < 3;

  return (
    <View style={[rs.stockRow, { borderBottomColor: colors.border }]}>
      {/* 로고 */}
      <TickerLogo ticker={stock.ticker} name={stock.name} size={38} borderRadius={10} />

      {/* 왼쪽 컨텐츠 */}
      <View style={{ flex: 1, gap: 4, marginLeft: 10 }}>
        {/* 1행: 배지들 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {stock.isLeader && (
            <View style={[rs.badge, { backgroundColor: "#FEF3C7" }]}>
              <Text style={[rs.badgeText, { color: "#D97706" }]}>주도주</Text>
            </View>
          )}
          {isAccumulating && (
            <View style={[rs.badge, { backgroundColor: "#EDE9FE" }]}>
              <Text style={[rs.badgeText, { color: "#7C3AED" }]}>매집 중</Text>
            </View>
          )}
          <View style={[rs.badge, { backgroundColor: isKR ? "#EFF6FF" : "#F0FDF4" }]}>
            <Text style={[rs.badgeText, { color: isKR ? "#3B82F6" : "#16A34A" }]}>{stock.market}</Text>
          </View>
        </View>

        {/* 2행: 종목명 + 등락 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[rs.stockName, { color: colors.foreground }]}>{stock.name}</Text>
          {change != null && (
            <Text style={[rs.stockChange, { color: change >= 0 ? "#EF4444" : "#3B82F6" }]}>
              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
            </Text>
          )}
          <Text style={[rs.stockMomentum, { color: momentum.color }]}>{momentum.text}</Text>
        </View>

        {/* 3행: 투자 근거 */}
        <Text style={[rs.stockRationale, { color: colors.mutedForeground }]} numberOfLines={2}>
          {stock.rationale}
        </Text>
      </View>

      {/* 분석 버튼 */}
      <TouchableOpacity
        style={rs.analyzeBtn}
        onPress={() => onAnalyze(stock.ticker, stock.name)}
        activeOpacity={0.75}
      >
        <Text style={rs.analyzeBtnText}>분석</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── 테마 카드 ──────────────────────────────────────────────────────────────────

function ThemeCard({ item, idx, onAnalyze, colors }: {
  item: ThemeFeedItem; idx: number;
  onAnalyze: (t: string, n: string) => void; colors: any;
}) {
  const [expanded, setExpanded] = useState(idx === 0);
  const force = computeThemeForce(item.stocks);
  const meta = phaseMeta(item.phase, force?.avg);
  const isEmerging = item.phase === "emerging";
  const isHot = item.phase === "hot";
  const sm = item.themeSmartMoney;

  return (
    <View style={[rs.themeCard, {
      backgroundColor: colors.card,
      borderColor: isEmerging ? "#C4B5FD" : isHot ? "#FECACA" : colors.border,
      borderWidth: (isEmerging || isHot) ? 1.5 : StyleSheet.hairlineWidth,
    }]}>
      {/* 수급 형성 배너 */}
      {isEmerging && (
        <View style={[rs.emergingBanner, { borderBottomColor: "#C4B5FD" }]}>
          <Text style={rs.emergingEmoji}>📡</Text>
          <Text style={rs.emergingTitle}>수급 형성 중</Text>
          {sm != null && sm > 0 && (
            <Text style={rs.emergingSm}>스마트머니 +{sm.toFixed(0)}억 유입 · 가격 반영 전</Text>
          )}
        </View>
      )}

      {/* 헤더 행 (탭해서 펼침) */}
      <TouchableOpacity
        style={rs.themeHeader}
        onPress={() => setExpanded(v => !v)}
        activeOpacity={0.7}
      >
        {/* 이모지 아바타 */}
        <View style={[rs.themeEmoji, { backgroundColor: meta.bg }]}>
          <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
        </View>

        {/* 이름 + 상태 */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            <Text style={[rs.themeName, { color: colors.foreground }]}>{item.name}</Text>
            <View style={[rs.phaseBadge, { backgroundColor: meta.bg }]}>
              <Text style={[rs.phaseText, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>
          <Text style={[rs.themeStockCount, { color: colors.mutedForeground }]}>
            종목 {item.stocks.length}개
          </Text>
        </View>

        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
      </TouchableOpacity>

      {/* 펼쳐진 내용 */}
      {expanded && (
        <View style={[rs.themeBody, { borderTopColor: colors.border }]}>
          {/* 테마 요약 */}
          {item.summary ? (
            <Text style={[rs.themeSummary, { color: colors.mutedForeground }]}>{item.summary}</Text>
          ) : null}

          {/* 종목 목록 */}
          {item.stocks.map((stock, i) => (
            <StockRow
              key={`${stock.ticker}-${i}`}
              stock={stock}
              onAnalyze={onAnalyze}
              colors={colors}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── 카테고리 메타 ─────────────────────────────────────────────────────────────

const CAT_META: Record<string, { label: string; dot: string; bg: string; barColor: string }> = {
  confluence: { label: "복합 신호",   dot: "#EF4444", bg: "#FEE2E2", barColor: "#EF4444" },
  laggard:    { label: "테마 미반영", dot: "#10b981", bg: "#DCFCE7", barColor: "#10b981" },
  volume:     { label: "거래량 집중", dot: "#7C3AED", bg: "#EDE9FE", barColor: "#7C3AED" },
  momentum:   { label: "상승 모멘텀", dot: "#F97316", bg: "#FFF1EE", barColor: "#F97316" },
  theme:      { label: "테마 신호",   dot: "#6366f1", bg: "#EEF2FF", barColor: "#6366f1" },
  signal:     { label: "수급 신호",   dot: "#0EA5E9", bg: "#E0F2FE", barColor: "#0EA5E9" },
};

const CONF_META: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: "신뢰 높음", color: "#16a34a", bg: "#dcfce7" },
  medium: { label: "신뢰 보통", color: "#ca8a04", bg: "#fef9c3" },
  low:    { label: "신뢰 낮음", color: "#dc2626", bg: "#fee2e2" },
};

// ── 내일 상승 후보 카드 ───────────────────────────────────────────────────────

function TomorrowPickCard({ item, idx, colors, onAnalyze }: {
  item: TomorrowPick; idx: number; colors: any;
  onAnalyze: (ticker: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cat = item.category ?? "laggard";
  const catMeta = CAT_META[cat] ?? CAT_META.laggard;
  const confMeta = CONF_META[item.confidence ?? "low"];
  const pct = Math.round((item.finalScore ?? 0) * 100);
  const changeUp = (item.priceChange ?? 0) >= 0;
  const rationale = item.rationale ?? item.reason ?? "";
  const isTop3 = idx < 3;

  return (
    <View style={[rs.pickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setExpanded(v => !v)} activeOpacity={0.7} style={rs.pickHeader}>
        {/* 로고 + 순위 */}
        <View style={{ alignItems: "center", gap: 2 }}>
          <TickerLogo ticker={item.ticker} name={item.name} size={36} borderRadius={10} />
          <Text style={[rs.pickRank, { color: colors.mutedForeground, fontSize: 10, fontFamily: "Pretendard-Regular" }]}>{idx + 1}</Text>
        </View>

        {/* 종목 정보 */}
        <View style={{ flex: 1, marginLeft: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[rs.pickName, { color: colors.foreground }]}>{item.name}</Text>
            <Text style={[rs.pickTicker, { color: colors.mutedForeground }]}>{item.ticker}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
            <View style={[rs.dot, { backgroundColor: catMeta.dot }]} />
            <Text style={[rs.catLabel, { color: colors.mutedForeground }]}>{catMeta.label}</Text>
            {item.confidence !== "low" && (
              <View style={[rs.badge, { backgroundColor: confMeta.bg }]}>
                <Text style={[rs.badgeText, { color: confMeta.color }]}>{confMeta.label}</Text>
              </View>
            )}
            {item.themeEmoji ? <Text style={{ fontSize: 13 }}>{item.themeEmoji}</Text> : null}
            {item.theme ? (
              <Text style={[rs.themeTag, { color: colors.mutedForeground }]} numberOfLines={1}>{item.theme}</Text>
            ) : null}
          </View>
        </View>

        {/* 등락 */}
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {item.priceChange != null && (
            <Text style={[rs.changeText, { color: changeUp ? "#EF4444" : "#3B82F6" }]}>
              {changeUp ? "+" : ""}{item.priceChange.toFixed(1)}%
            </Text>
          )}
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
        </View>
      </TouchableOpacity>

      {/* 신호 + 갭 — 항상 표시 */}
      {((item.laggardGap ?? 0) > 0.5 || (item.signals ?? []).length > 0) && (
        <View style={[rs.signalRow, { paddingLeft: 38 }]}>
          {(item.laggardGap ?? 0) > 0.5 && (
            <Text style={rs.laggardGap}>갭 {item.laggardGap!.toFixed(1)}%p</Text>
          )}
          {(item.themeHeat ?? 0) > 0 && (
            <Text style={[rs.signalChip, { color: colors.mutedForeground }]}>테마 +{item.themeHeat!.toFixed(1)}%</Text>
          )}
          {(item.signals ?? []).map((sig, i) => (
            <Text key={i} style={[rs.signalChip, { color: colors.mutedForeground }]}>· {sig}</Text>
          ))}
        </View>
      )}

      {/* 근거 */}
      {rationale ? (
        <Text style={[rs.pickRationale, { color: colors.mutedForeground, paddingLeft: 38 }]} numberOfLines={expanded ? undefined : 2}>
          {rationale}
        </Text>
      ) : null}

      {/* 펼침: 분석 버튼 */}
      {expanded && (
        <View style={[rs.pickBody, { borderTopColor: colors.border }]}>
          <TouchableOpacity style={rs.pickAnalyzeBtn} onPress={() => onAnalyze(item.ticker, item.name)} activeOpacity={0.75}>
            <Feather name="cpu" size={13} color="#6366f1" />
            <Text style={rs.pickAnalyzeBtnText}>AI 분석 시작</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 점수 바 */}
      <View style={[rs.scoreBar, { backgroundColor: colors.border }]}>
        <View style={[rs.scoreBarFill, { width: `${pct}%` as any, backgroundColor: catMeta.barColor }]} />
      </View>
    </View>
  );
}

// ── 장중 급등 순위 카드 ───────────────────────────────────────────────────────

function LiveGainerCard({ item, idx, colors, onAnalyze }: {
  item: LiveGainerItem; idx: number; colors: any;
  onAnalyze: (ticker: string, name: string) => void;
}) {
  const isUpperLimit = item.change >= 28.5;
  const isMomentum   = item.change >= 15;
  const accentColor  = isUpperLimit ? "#DC2626" : isMomentum ? "#EA580C" : "#EF4444";
  const accentBg     = isUpperLimit ? "#FEF2F2" : isMomentum ? "#FFF7ED" : "#FFF1EE";

  return (
    <View style={[rs.pickCard, { backgroundColor: colors.card, borderColor: isUpperLimit ? "#FECACA" : isMomentum ? "#FED7AA" : colors.border, borderWidth: isUpperLimit ? 1.5 : 1 }]}>
      <View style={rs.pickHeader}>
        {/* 순위 */}
        <Text style={[rs.pickRank, {
          color: idx < 3 ? accentColor : colors.mutedForeground,
          fontFamily: idx < 3 ? "Pretendard-Bold" : "Pretendard-Regular",
        }]}>{idx + 1}</Text>

        {/* 종목 정보 */}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={[rs.pickName, { color: colors.foreground }]}>{item.name}</Text>
            <Text style={[rs.pickTicker, { color: colors.mutedForeground }]}>{item.ticker}</Text>
            {isUpperLimit && (
              <View style={[rs.badge, { backgroundColor: "#FEF2F2" }]}>
                <Text style={[rs.badgeText, { color: "#DC2626", fontFamily: "Pretendard-SemiBold" }]}>🔴 상한가</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 4, alignItems: "center" }}>
            <Text style={[rs.metricLabel, { color: colors.mutedForeground }]}>
              {item.price.toLocaleString()}원
            </Text>
            {item.tradingValue > 0 && (
              <Text style={[rs.metricLabel, { color: colors.mutedForeground }]}>
                거래대금 {item.tradingValue}억
              </Text>
            )}
          </View>
        </View>

        {/* 등락률 + 분석 */}
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text style={[rs.changeText, { color: accentColor, fontSize: 18, fontFamily: "Pretendard-Bold" }]}>
            +{item.change.toFixed(2)}%
          </Text>
          <TouchableOpacity
            style={[rs.pickAnalyzeBtn, { paddingHorizontal: 8, paddingVertical: 4 }]}
            onPress={() => onAnalyze(item.ticker, item.name)}
            activeOpacity={0.75}
          >
            <Feather name="cpu" size={12} color="#6366f1" />
            <Text style={[rs.pickAnalyzeBtnText, { fontSize: 13 }]}>AI 분석</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ── 기관·외인 매집 카드 ────────────────────────────────────────────────────────

function InstitutionPickCard({ item, idx, colors, onAnalyze }: {
  item: InstitutionPick; idx: number; colors: any;
  onAnalyze: (ticker: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isTop3 = idx < 3;
  const changeUp = item.change >= 0;

  const typeColor =
    item.type === "both"        ? "#7C3AED"
    : item.type === "institution" ? "#0EA5E9"
    : "#F97316";
  const typeBg =
    item.type === "both"        ? "#EDE9FE"
    : item.type === "institution" ? "#E0F2FE"
    : "#FFF7ED";
  const typeLabel =
    item.type === "both"        ? "기관+외인"
    : item.type === "institution" ? "기관 매집"
    : "외인 매집";

  const marketLabel = item.market === "KOSPI" ? "코스피" : "코스닥";

  return (
    <View style={[rs.pickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setExpanded(v => !v)} activeOpacity={0.7} style={rs.pickHeader}>
        {/* 로고 + 순위 */}
        <View style={{ alignItems: "center", gap: 2 }}>
          <TickerLogo ticker={item.ticker} name={item.name} size={36} borderRadius={10} />
          <Text style={[rs.pickRank, { color: colors.mutedForeground, fontSize: 10, fontFamily: "Pretendard-Regular" }]}>{idx + 1}</Text>
        </View>

        <View style={{ flex: 1, marginLeft: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[rs.pickName, { color: colors.foreground }]}>{item.name}</Text>
            <Text style={[rs.pickTicker, { color: colors.mutedForeground }]}>{item.ticker}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
            <View style={[rs.badge, { backgroundColor: typeBg }]}>
              <Text style={[rs.badgeText, { color: typeColor }]}>{typeLabel}</Text>
            </View>
            <Text style={[rs.catLabel, { color: colors.mutedForeground }]}>{marketLabel}</Text>
            {item.institution > 0 && (
              <Text style={[rs.signalChip, { color: "#0EA5E9" }]}>기관 +{item.institution}억</Text>
            )}
            {item.foreign > 0 && (
              <Text style={[rs.signalChip, { color: "#F97316" }]}>외인 +{item.foreign}억</Text>
            )}
          </View>
        </View>

        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={[rs.changeText, { color: changeUp ? "#EF4444" : "#3B82F6" }]}>
            {changeUp ? "+" : ""}{item.change.toFixed(1)}%
          </Text>
          <Text style={{ fontSize: 12, fontFamily: "Pretendard-SemiBold", color: typeColor }}>
            +{item.combined}억
          </Text>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[rs.pickBody, { borderTopColor: colors.border }]}>
          <View style={{ flexDirection: "row", gap: 16, marginBottom: 10 }}>
            <View>
              <Text style={[rs.catLabel, { color: colors.mutedForeground }]}>종가</Text>
              <Text style={[rs.pickName, { color: colors.foreground }]}>{item.close.toLocaleString()}원</Text>
            </View>
            <View>
              <Text style={[rs.catLabel, { color: colors.mutedForeground }]}>합산 순매수</Text>
              <Text style={[rs.pickName, { color: typeColor }]}>+{item.combined}억</Text>
            </View>
          </View>
          <TouchableOpacity style={rs.pickAnalyzeBtn} onPress={() => onAnalyze(item.ticker, item.name)} activeOpacity={0.75}>
            <Feather name="cpu" size={13} color="#6366f1" />
            <Text style={rs.pickAnalyzeBtnText}>AI 분석 시작</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={[rs.scoreBar, { backgroundColor: colors.border }]}>
        <View style={[rs.scoreBarFill, { width: `${Math.min(item.combined, 100)}%` as any, backgroundColor: typeColor }]} />
      </View>
    </View>
  );
}

// ── 급등 예비군 카드 ──────────────────────────────────────────────────────────

// 카테고리 메타
const PRESURGE_CATEGORY = {
  accumulation:   { label: "거래량 매집", color: "#059669", bg: "#D1FAE5", icon: "💚" },
  sector_laggard: { label: "테마 후발주", color: "#7C3AED", bg: "#EDE9FE", icon: "🎯" },
  presurge:       { label: "전조 패턴",   color: "#D97706", bg: "#FEF3C7", icon: "⚡" },
  // 구버전 호환 (상한가·모멘텀은 이제 "지금 급등 중" 섹션에서 표시)
  upper_limit:    { label: "상한가 연속", color: "#DC2626", bg: "#FEF2F2", icon: "🔴" },
  momentum:       { label: "급등 모멘텀", color: "#EA580C", bg: "#FFF7ED", icon: "🟠" },
} as const;

function PresurgeCard({ item, idx, colors, onAnalyze }: {
  item: PresurgePick; idx: number; colors: any;
  onAnalyze: (ticker: string, name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const change = item.change ?? 0;
  const changeUp = change >= 0;
  const isKR = !item.market || item.market === "KOSPI" || item.market === "KOSDAQ";
  const marketLabel = item.market === "KOSPI" ? "코스피" : item.market === "KOSDAQ" ? "코스닥" : item.market ?? "KR";
  const pct = Math.min(100, Math.max(0, ((item.score ?? 0) / 100) * 100));
  const catKey = (item.category ?? "presurge") as keyof typeof PRESURGE_CATEGORY;
  const cat = PRESURGE_CATEGORY[catKey] ?? PRESURGE_CATEGORY.presurge;

  // 카테고리별 핵심 지표 태그
  const tags: string[] = [];
  if (catKey === "accumulation") {
    if ((item.volExpansion ?? 0) >= 2)  tags.push(`거래량 ×${item.volExpansion!.toFixed(1)}`);
    if ((item as any).candleStrength >= 0.8) tags.push("위꼬리 없는 강한 종가");
    else if ((item as any).candleStrength >= 0.6) tags.push("강한 캔들");
    if (item.maAligned)                 tags.push("이평선 정배열");
    if (Math.abs(change) <= 3)          tags.push("당일 소폭 변동");
  } else if (catKey === "sector_laggard") {
    if ((item as any).sector)           tags.push(`${(item as any).sector} 섹터`);
    if ((item.volExpansion ?? 0) >= 1.5) tags.push(`거래량 ×${item.volExpansion!.toFixed(1)}`);
    if (item.maAligned)                 tags.push("이평선 정배열");
    tags.push("섹터 미상승 후발주");
  } else if (catKey === "upper_limit") {
    tags.push("상한가 달성");
    if ((item.volExpansion ?? 0) >= 2)  tags.push(`거래량 ×${item.volExpansion!.toFixed(1)}`);
  } else if (catKey === "momentum") {
    if ((item.volExpansion ?? 0) >= 2)  tags.push(`거래량 ×${item.volExpansion!.toFixed(1)}`);
    if ((item.momentum3d ?? 0) > 0)     tags.push(`당일 +${change.toFixed(1)}%`);
  } else {
    if ((item.volExpansion ?? 0) >= 2)   tags.push(`거래량 ×${item.volExpansion!.toFixed(1)}`);
    if ((item.volDryupDays ?? 0) >= 3)   tags.push(`${item.volDryupDays}일 거래량 수축`);
    if (item.maAligned)                  tags.push("이평선 정배열");
    if ((item.nearHighPct ?? 0) >= 95)   tags.push("신고가 근접");
    if ((item.momentum3d ?? 0) > 0)      tags.push(`3일 모멘텀 +${item.momentum3d!.toFixed(1)}%`);
  }

  return (
    <View style={[rs.pickCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={() => setExpanded(v => !v)} activeOpacity={0.7} style={rs.pickHeader}>
        {/* 로고 + 순위 */}
        <View style={{ alignItems: "center", gap: 2 }}>
          <TickerLogo ticker={item.ticker} name={item.name} size={36} borderRadius={10} />
          <Text style={[rs.pickRank, { color: colors.mutedForeground, fontSize: 10, fontFamily: "Pretendard-Regular" }]}>{idx + 1}</Text>
        </View>

        {/* 종목 정보 */}
        <View style={{ flex: 1, marginLeft: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={[rs.pickName, { color: colors.foreground }]}>{item.name}</Text>
            <Text style={[rs.pickTicker, { color: colors.mutedForeground }]}>{item.ticker}</Text>
            <View style={[rs.badge, { backgroundColor: isKR ? "#EFF6FF" : "#F0FDF4" }]}>
              <Text style={[rs.badgeText, { color: isKR ? "#3B82F6" : "#16A34A" }]}>{marketLabel}</Text>
            </View>
            {/* 카테고리 배지 */}
            <View style={[rs.badge, { backgroundColor: cat.bg }]}>
              <Text style={[rs.badgeText, { color: cat.color, fontFamily: "Pretendard-SemiBold" }]}>
                {cat.label}
              </Text>
            </View>
          </View>
          {/* 핵심 지표 태그 */}
          {tags.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
              {tags.map((t, i) => (
                <View key={i} style={[rs.badge, { backgroundColor: catKey === "upper_limit" ? "#FEE2E2" : catKey === "momentum" ? "#FFEDD5" : "#fef9c3" }]}>
                  <Text style={[rs.badgeText, { color: catKey === "upper_limit" ? "#991B1B" : catKey === "momentum" ? "#C2410C" : "#b45309" }]}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 등락 + 점수 */}
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={[rs.changeText, { color: changeUp ? "#EF4444" : "#3B82F6" }]}>
            {changeUp ? "+" : ""}{change.toFixed(1)}%
          </Text>
          {catKey !== "upper_limit" && (
            <Text style={[rs.scoreLabel, { color: colors.mutedForeground }]}>
              {item.score?.toFixed(0)}점
            </Text>
          )}
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
        </View>
      </TouchableOpacity>

      {/* 펼침 */}
      {expanded && (
        <View style={[rs.pickBody, { borderTopColor: colors.border }]}>
          {/* 상세 지표 */}
          <View style={rs.metricsGrid}>
            {item.close != null && (
              <View style={rs.metricItem}>
                <Text style={[rs.metricLabel, { color: colors.mutedForeground }]}>현재가</Text>
                <Text style={[rs.metricValue, { color: colors.foreground }]}>{item.close.toLocaleString()}원</Text>
              </View>
            )}
            {item.volExpansion != null && (
              <View style={rs.metricItem}>
                <Text style={[rs.metricLabel, { color: colors.mutedForeground }]}>거래량 팽창</Text>
                <Text style={[rs.metricValue, { color: "#7C3AED" }]}>×{item.volExpansion.toFixed(1)}</Text>
              </View>
            )}
            {item.bbWidthPct != null && (
              <View style={rs.metricItem}>
                <Text style={[rs.metricLabel, { color: colors.mutedForeground }]}>BB폭</Text>
                <Text style={[rs.metricValue, { color: colors.foreground }]}>{item.bbWidthPct.toFixed(1)}%</Text>
              </View>
            )}
            {item.nearHighPct != null && (
              <View style={rs.metricItem}>
                <Text style={[rs.metricLabel, { color: colors.mutedForeground }]}>52주 고가</Text>
                <Text style={[rs.metricValue, { color: (item.nearHighPct ?? 0) >= 95 ? "#EF4444" : colors.foreground }]}>
                  {item.nearHighPct.toFixed(1)}%
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={rs.pickAnalyzeBtn} onPress={() => onAnalyze(item.ticker, item.name)} activeOpacity={0.75}>
            <Feather name="cpu" size={13} color="#6366f1" />
            <Text style={rs.pickAnalyzeBtnText}>AI 분석 시작</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 점수 바 */}
      <View style={[rs.scoreBar, { backgroundColor: colors.border }]}>
        <View style={[rs.scoreBarFill, { width: `${pct}%` as any, backgroundColor: "#EF4444" }]} />
      </View>
    </View>
  );
}

// ── 수급 신호 카드 ────────────────────────────────────────────────────────────

function SignalCard({ signal, colors }: { signal: ThemeSignal; colors: any }) {
  const [expanded, setExpanded] = useState(false);
  const strength = signal.strength;
  const strengthMap: Record<string, { color: string; bg: string; label: string }> = {
    strong:   { color: "#EF4444", bg: "#FEE2E2", label: "강한 신호" },
    moderate: { color: "#F97316", bg: "#FFF1EE", label: "보통 신호" },
    weak:     { color: "#94a3b8", bg: "#F1F5F9", label: "약한 신호" },
  };
  const sm = strengthMap[strength ?? "weak"] ?? strengthMap.weak;
  const tickers = signal.tickers ?? signal.stocks ?? [];

  return (
    <TouchableOpacity
      style={[rs.signalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => setExpanded(v => !v)}
      activeOpacity={0.7}
    >
      <View style={rs.signalHeader}>
        {/* 강도 인디케이터 */}
        <View style={[rs.signalDot, { backgroundColor: sm.color }]} />

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 3 }}>
            <Text style={[rs.signalTheme, { color: colors.foreground }]}>{signal.theme}</Text>
            <View style={[rs.badge, { backgroundColor: sm.bg }]}>
              <Text style={[rs.badgeText, { color: sm.color }]}>{sm.label}</Text>
            </View>
          </View>
          {signal.signal && (
            <Text style={[rs.signalText, { color: colors.mutedForeground }]} numberOfLines={expanded ? undefined : 2}>
              {signal.signal}
            </Text>
          )}
        </View>

        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
      </View>

      {expanded && (
        <View style={[rs.signalBody, { borderTopColor: colors.border }]}>
          {(signal.reason ?? signal.description) && (
            <Text style={[rs.signalReason, { color: colors.foreground }]}>
              {signal.reason ?? signal.description}
            </Text>
          )}
          {tickers.length > 0 && (
            <View style={rs.tagRow}>
              {tickers.map((t, i) => (
                <View key={i} style={[rs.tag, { backgroundColor: "#eef2ff" }]}>
                  <Text style={[rs.tagText, { color: "#6366f1", fontFamily: "Pretendard-SemiBold" }]}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ── 섹션 헤더 ─────────────────────────────────────────────────────────────────

function SectionHeader({ emoji, title, badge, badgeColor, badgeBg, sub }: {
  emoji: string; title: string;
  badge?: string; badgeColor?: string; badgeBg?: string;
  sub?: string;
}) {
  const colors = useColors();
  return (
    <View style={rs.listSectionHeader}>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Text style={[rs.listSectionTitle, { color: colors.foreground }]}>{title}</Text>
          {badge && (
            <View style={[rs.badge, { backgroundColor: badgeBg ?? "#eef2ff" }]}>
              <Text style={[rs.badgeText, { color: badgeColor ?? "#6366f1" }]}>{badge}</Text>
            </View>
          )}
        </View>
        {sub && <Text style={[rs.listSectionSub, { color: colors.mutedForeground }]}>{sub}</Text>}
      </View>
    </View>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ text, colors }: { text: string; colors: any }) {
  return (
    <View style={rs.emptyState}>
      <Feather name="inbox" size={28} color={colors.border} />
      <Text style={[rs.emptyText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function ThemesTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("테마 분석");

  const [feed, setFeed] = useState<ThemeFeedItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState(false);
  const [feedCachedAt, setFeedCachedAt] = useState<string | null>(null);

  const tomorrow = useTomorrowPicks();
  const presurge = usePresurge();
  const signals = useThemeSignals();
  const liveGainers = useLiveGainers();
  const institutionPicks = useInstitutionPicks();

  const loadFeed = useCallback(async (attempt = 0) => {
    setFeedLoading(true);
    setFeedError(false);
    try {
      const raw = await apiFetch<any>(`/api/themes/trending-feed`);
      const data: ThemeFeedItem[] = Array.isArray(raw) ? raw : (raw.feed ?? []);
      const cachedAt: string | null = Array.isArray(raw) ? null : (raw.cachedAt ?? null);
      if (data.length > 0) {
        setFeed(data);
        if (cachedAt) setFeedCachedAt(cachedAt);
      } else if (attempt < 6) {
        setTimeout(() => loadFeed(attempt + 1), 5000);
        return;
      } else {
        setFeedError(true);
      }
    } catch {
      setFeedError(true);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  function onAnalyze(ticker: string, name: string) {
    router.push(`/new-analysis?ticker=${encodeURIComponent(ticker)}&name=${encodeURIComponent(name)}`);
  }

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const botPad = (Platform.OS === "web" ? 84 : insets.bottom) + 80;

  const tabColors: Record<Tab, string> = {
    "테마 분석": "#6366f1",
    "내일 종목": "#10b981",
    "수급 레이더": colors.foreground,
  };

  function onRefresh() {
    if (activeTab === "테마 분석") loadFeed();
    if (activeTab === "내일 종목") {
      apiFetch(`/api/market/tomorrow-picks?refresh=1`).catch(() => {}).finally(() => tomorrow.refetch());
      presurge.refetch();
      institutionPicks.refetch();
    }
    if (activeTab === "수급 레이더") signals.refetch();
  }

  const isRefreshing =
    activeTab === "내일 종목" ? (tomorrow.isFetching || presurge.isFetching || institutionPicks.isFetching)
    : activeTab === "수급 레이더" ? signals.isFetching
    : false;

  return (
    <View style={[rs.root, { backgroundColor: colors.background }]}>
      {/* ── 헤더 ── */}
      <View style={[rs.header, { paddingTop: topPad + 14, borderBottomColor: colors.border }]}>
        <View style={rs.headerTop}>
          <View>
            <Text style={[rs.headerTitle, { color: colors.foreground }]}>테마 · 수급</Text>
            <Text style={[rs.headerSub, { color: colors.mutedForeground }]}>AI 기관 수급 · 테마 분석</Text>
          </View>
        </View>

        {/* 탭 */}
        <View style={rs.tabRow}>
          {TABS.map(tab => {
            const isActive = activeTab === tab;
            const activeColor = tabColors[tab];
            return (
              <Pressable
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={({ pressed }) => [{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                  backgroundColor: isActive ? activeColor + "16" : "transparent",
                  opacity: pressed ? 0.7 : 1,
                }]}
              >
                <Text style={{
                  fontSize: 15,
                  fontFamily: isActive ? "Pretendard-SemiBold" : "Pretendard-Regular",
                  color: isActive ? activeColor : colors.mutedForeground,
                }}>
                  {tab}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* ── 테마 분석 탭 ── */}
      {activeTab === "테마 분석" && (
        feedLoading ? (
          <View style={rs.center}>
            <ActivityIndicator size="small" color="#6366f1" />
            <Text style={[rs.loadingText, { color: colors.mutedForeground }]}>
              AI가 관련주를 분석하는 중… (약 10초)
            </Text>
          </View>
        ) : feedError ? (
          <View style={rs.center}>
            <Feather name="alert-circle" size={32} color={colors.border} />
            <Text style={[rs.loadingText, { color: colors.mutedForeground }]}>피드를 불러오지 못했습니다</Text>
            <TouchableOpacity style={[rs.retryBtn, { borderColor: "#6366f1" }]} onPress={() => loadFeed()}>
              <Text style={{ fontSize: 15, color: "#6366f1", fontFamily: "Pretendard-SemiBold" }}>다시 시도</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: botPad }}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => loadFeed()} tintColor="#6366f1" />}
            showsVerticalScrollIndicator={false}
          >
            {/* 갱신 시각 */}
            <Text style={[rs.feedMeta, { color: colors.mutedForeground }]}>
              최근 3일 기관·외국인 순매수 집중 테마 분석 · 3시간마다 갱신
              {feedCachedAt ? ` · ${new Date(feedCachedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 갱신` : ""}
            </Text>

            <ThemeForceRanking feed={feed} colors={colors} />

            {[...feed]
              .sort((a, b) => {
                const fa = computeThemeForce(a.stocks)?.avg ?? -Infinity;
                const fb = computeThemeForce(b.stocks)?.avg ?? -Infinity;
                return fb - fa;
              })
              .map((item, idx) => (
                <ThemeCard key={item.id} item={item} idx={idx} onAnalyze={onAnalyze} colors={colors} />
              ))}
          </ScrollView>
        )
      )}

      {/* ── 내일 종목 탭 ── */}
      {activeTab === "내일 종목" && (
        (institutionPicks.isLoading && presurge.isLoading && tomorrow.isLoading) ? (
          <View style={rs.center}>
            <ActivityIndicator size="small" color="#10b981" />
            <Text style={[rs.loadingText, { color: colors.mutedForeground }]}>분석 중…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingBottom: botPad }}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor="#10b981" />}
            showsVerticalScrollIndicator={false}
          >
            {/* 안내 카드 */}
            <View style={[rs.conceptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[rs.conceptTitle, { color: colors.foreground }]}>🏦 기관·외인 매집 종목 스크리너</Text>
              <Text style={[rs.conceptDesc, { color: colors.mutedForeground }]}>
                아직 안 오른 종목 중 기관·외국인이 조용히 사 모으는 종목을 실시간으로 찾습니다.
              </Text>
              <View style={{ gap: 8, marginTop: 10 }}>
                {([
                  { n: "①", color: "#7C3AED", bg: "#EDE9FE", title: "기관·외인 매집", desc: "KOSPI·KOSDAQ 전 종목 순매수 스캔 · 주가 5% 미만 상승" },
                  { n: "②", color: "#10b981", bg: "#DCFCE7", title: "급등 예비군",   desc: "기술적 전조 패턴 · 거래량 매집 · 박스권 돌파 전조" },
                  { n: "③", color: "#6366f1", bg: "#E0E7FF", title: "내일 상승 후보",     desc: "테마·검색 트렌드 · 순환매 지연 포착" },
                ] as const).map(({ n, color, bg, title, desc }) => (
                  <View key={n} style={[rs.conceptRow, { backgroundColor: colors.muted }]}>
                    <View style={[rs.conceptNum, { backgroundColor: bg }]}>
                      <Text style={[rs.conceptNumText, { color }]}>{n}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[rs.conceptRowTitle, { color }]}>{title}</Text>
                      <Text style={[rs.conceptRowDesc, { color: colors.mutedForeground }]}>{desc}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* 기관·외인 매집 */}
            <SectionHeader
              emoji="🏦"
              title="기관·외인 매집"
              badge={institutionPicks.data ? `${(institutionPicks.data.picks ?? []).length}종목` : "스캔 중"}
              badgeColor="#7C3AED"
              badgeBg="#EDE9FE"
              sub="KOSPI·KOSDAQ 전 종목 · 기관+외인 순매수 ≥ 3억 · 주가등락 5% 미만"
            />
            <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 8 }}>
              {institutionPicks.isLoading
                ? <ActivityIndicator size="small" color="#7C3AED" style={{ paddingVertical: 20 }} />
                : (institutionPicks.data?.picks ?? []).length === 0
                ? <EmptyState text="매집 종목이 없습니다 (장 마감 후 갱신)" colors={colors} />
                : (institutionPicks.data?.picks ?? []).map((p, i) => (
                    <InstitutionPickCard key={`inst-${p.ticker}-${i}`} item={p} idx={i} colors={colors} onAnalyze={onAnalyze} />
                  ))}
              {institutionPicks.data?.cachedAt && (
                <Text style={[rs.listSectionSub, { color: colors.mutedForeground, textAlign: "center", marginTop: 4 }]}>
                  {new Date(institutionPicks.data.cachedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 기준
                </Text>
              )}
            </View>

            {/* 급등 예비군 */}
            <SectionHeader
              emoji="⚡"
              title="급등 예비군"
              badge="기술적 패턴 스캔"
              badgeColor="#059669"
              badgeBg="#D1FAE5"
              sub="오늘 안 오른 종목 중 내일 급등 전조 · 거래량 매집 · 박스권 전조"
            />
            <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 8 }}>
              {presurge.isLoading
                ? <ActivityIndicator size="small" color="#EF4444" style={{ paddingVertical: 20 }} />
                : (presurge.data?.picks ?? []).length === 0
                ? <EmptyState text="급등 예비군이 없습니다" colors={colors} />
                : (presurge.data?.picks ?? []).map((p, i) => (
                    <PresurgeCard key={`presurge-${p.ticker}-${i}`} item={p} idx={i} colors={colors} onAnalyze={onAnalyze} />
                  ))}
            </View>

            {/* 내일 상승 후보 */}
            <SectionHeader
              emoji="🎯"
              title="내일 상승 후보"
              badge={`${(tomorrow.data?.picks ?? []).length}종목`}
              badgeColor="#6366f1"
              badgeBg="#EEF2FF"
              sub="테마·검색 트렌드 · 순환매 지연·화제성 포착"
            />
            <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 8 }}>
              {tomorrow.isLoading
                ? <ActivityIndicator size="small" color="#6366f1" style={{ paddingVertical: 20 }} />
                : (tomorrow.data?.picks ?? []).length === 0
                ? <EmptyState text="내일 픽이 없습니다" colors={colors} />
                : (tomorrow.data?.picks ?? []).map((p, i) => (
                    <TomorrowPickCard key={`tomorrow-${p.ticker}-${i}`} item={p} idx={i} colors={colors} onAnalyze={onAnalyze} />
                  ))}
            </View>
          </ScrollView>
        )
      )}

      {/* ── 수급 레이더 탭 ── */}
      {activeTab === "수급 레이더" && (
        signals.isLoading ? (
          <View style={rs.center}>
            <ActivityIndicator size="small" color={colors.foreground} />
            <Text style={[rs.loadingText, { color: colors.mutedForeground }]}>신호 분석 중…</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: botPad }}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.foreground} />}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[rs.feedMeta, { color: colors.mutedForeground }]}>
              기관·외국인 수급 신호 실시간 분석
            </Text>
            {(() => {
              const all = signals.data?.signals ?? signals.data?.feed ?? [];
              if (!all.length) return <EmptyState text="수급 신호가 없습니다" colors={colors} />;
              return [...all]
                .sort((a, b) => ({ strong: 0, moderate: 1, weak: 2 }[a.strength ?? "weak"] ?? 2) - ({ strong: 0, moderate: 1, weak: 2 }[b.strength ?? "weak"] ?? 2))
                .map((sig, i) => <SignalCard key={`${sig.theme}-${i}`} signal={sig} colors={colors} />);
            })()}
          </ScrollView>
        )
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const rs = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  headerTitle: { fontSize: 24, fontFamily: "Pretendard-Bold" },
  headerSub: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 1 },
  tabRow: { flexDirection: "row", gap: 2 },

  // Section card (랭킹)
  section: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 10 },
  iconWrap: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 16, fontFamily: "Pretendard-Bold" },
  sectionSub: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 1 },

  // Rank row
  rankRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rankNum: { fontSize: 14, width: 16, textAlign: "right" },
  rankEmoji: { fontSize: 18, width: 22, textAlign: "center" },
  rankName: { fontSize: 15, fontFamily: "Pretendard-Medium" },
  rankSm: { fontSize: 12, color: "#7C3AED", fontFamily: "Pretendard-Regular", marginTop: 1 },
  barTrack: { width: 72, height: 7, borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4 },
  phaseBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  phaseText: { fontSize: 12, fontFamily: "Pretendard-SemiBold" },

  // Theme card
  themeCard: { borderRadius: 16, overflow: "hidden" },
  emergingBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: "#F5F3FF", borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emergingEmoji: { fontSize: 15 },
  emergingTitle: { fontSize: 14, fontFamily: "Pretendard-Bold", color: "#7C3AED" },
  emergingSm: { fontSize: 13, color: "#8B5CF6", fontFamily: "Pretendard-Regular", flex: 1 },
  themeHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  themeEmoji: {
    width: 42, height: 42, borderRadius: 13,
    alignItems: "center", justifyContent: "center",
  },
  themeName: { fontSize: 17, fontFamily: "Pretendard-Bold" },
  themeStockCount: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 3 },
  themeBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  themeSummary: {
    fontSize: 15, fontFamily: "Pretendard-Regular",
    lineHeight: 26, paddingHorizontal: 14, paddingVertical: 12,
  },

  // Stock row
  stockRow: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 14, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth, gap: 10,
  },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  badgeText: { fontSize: 12, fontFamily: "Pretendard-SemiBold" },
  stockName: { fontSize: 17, fontFamily: "Pretendard-SemiBold" },
  stockChange: { fontSize: 14, fontFamily: "Pretendard-SemiBold" },
  stockMomentum: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  stockRationale: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 23 },
  analyzeBtn: {
    backgroundColor: "#eef2ff", paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 9, alignSelf: "flex-start", marginTop: 18,
  },
  analyzeBtnText: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#6366f1" },

  // Pick / Presurge card
  pickCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  pickHeader: { flexDirection: "row", alignItems: "flex-start", padding: 14, gap: 10 },
  pickRank: { fontSize: 14, width: 16, textAlign: "right", marginTop: 2 },
  pickName: { fontSize: 16, fontFamily: "Pretendard-SemiBold" },
  pickTicker: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  pickReasonPreview: { fontSize: 14, fontFamily: "Pretendard-Regular", marginTop: 3 },
  pickBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  pickRationale: {
    fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 24,
    paddingHorizontal: 14, paddingBottom: 10, color: "#64748b",
  },
  pickReason: { fontSize: 15, fontFamily: "Pretendard-Regular", lineHeight: 26 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  tagText: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  pickAnalyzeBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    alignSelf: "flex-start", paddingHorizontal: 14, paddingVertical: 9,
    backgroundColor: "#eef2ff", borderRadius: 10,
  },
  pickAnalyzeBtnText: { fontSize: 15, fontFamily: "Pretendard-SemiBold", color: "#6366f1" },

  // Category / confidence
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  catLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  themeTag: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  changeText: { fontSize: 15, fontFamily: "Pretendard-Bold" },

  // Signal row (신호 칩)
  signalRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
  laggardGap: { fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#10b981" },
  signalChip: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  // Score bar
  scoreBar: { height: 3 },
  scoreBarFill: { height: "100%" },
  scoreLabel: { fontSize: 13, fontFamily: "Pretendard-Regular" },

  // Metrics grid (presurge 펼침)
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricItem: { minWidth: 80, gap: 2 },
  metricLabel: { fontSize: 12, fontFamily: "Pretendard-Regular" },
  metricValue: { fontSize: 16, fontFamily: "Pretendard-Bold" },

  // Signal card
  signalCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  signalHeader: { flexDirection: "row", alignItems: "flex-start", padding: 14, gap: 10 },
  signalDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  signalTheme: { fontSize: 16, fontFamily: "Pretendard-Bold" },
  signalText: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 24 },
  signalBody: { borderTopWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  signalReason: { fontSize: 15, fontFamily: "Pretendard-Regular", lineHeight: 26 },

  // Section header (내일 종목 섹션 구분)
  listSectionHeader: {
    flexDirection: "row", alignItems: "center",
    gap: 10, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10,
  },
  listSectionTitle: { fontSize: 18, fontFamily: "Pretendard-Bold" },
  listSectionSub: { fontSize: 13, fontFamily: "Pretendard-Regular", marginTop: 2 },

  // Concept card
  conceptCard: { margin: 16, marginBottom: 0, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  conceptTitle: { fontSize: 16, fontFamily: "Pretendard-Bold", marginBottom: 5 },
  conceptDesc: { fontSize: 14, fontFamily: "Pretendard-Regular", lineHeight: 24 },
  conceptRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 11 },
  conceptNum: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  conceptNumText: { fontSize: 13, fontFamily: "Pretendard-Bold" },
  conceptRowTitle: { fontSize: 14, fontFamily: "Pretendard-Bold" },
  conceptRowDesc: { fontSize: 12, fontFamily: "Pretendard-Regular", marginTop: 1 },

  // Misc
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { fontSize: 15, fontFamily: "Pretendard-Regular" },
  retryBtn: { borderWidth: 1, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 10 },
  feedMeta: { fontSize: 13, fontFamily: "Pretendard-Regular" },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 15, fontFamily: "Pretendard-Regular" },
});
