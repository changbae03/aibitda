import { Feather } from "@expo/vector-icons";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, TextInput, Linking,
  Platform, Pressable, Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiFetch, useNewsScraps } from "@/hooks/useApi";
import { useAuth } from "@clerk/expo";

// ── Types ──────────────────────────────────────────────────────────────────

interface MacroNewsItem {
  title: string;
  source: string;
  pubDate: string;
  url: string;
  category: string;
  tags: string[];
}

interface TimelineEvent {
  date: string;
  dateLabel: string;
  event: string;
  detail: string;
  importance: "high" | "medium" | "low";
  category: string;
  source?: string;
  url?: string;
}
interface TimelineData {
  keyword: string;
  summary: string;
  timeline: TimelineEvent[];
  generatedAt: number;
}

// ── 날짜 유틸 ─────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return "방금";
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  } catch { return ""; }
}

function dateLabel(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const DAY_KO = ["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
    const label = `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY_KO[d.getDay()]}`;
    if (target.getTime() === today.getTime()) return `오늘, ${label}`;
    if (target.getTime() === yesterday.getTime()) return `어제, ${label}`;
    return label;
  } catch { return ""; }
}

function timeStr(iso: string): string {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

// ── 속보 감지 ──────────────────────────────────────────────────────────────

const BREAKING_KEYWORDS = [
  "속보","긴급","[속보]","[긴급]","폭등","폭락","급등","급락","서킷브레이커",
  "파산","부도","디폴트","뱅크런","금리 인상","금리 인하","FOMC 결정","금통위 결정",
  "피벗","쇼크","관세 폭탄","전쟁 선포","계엄","전격",
];
const BREAKING_RE = new RegExp(BREAKING_KEYWORDS.join("|"));
function isBreaking(title: string) { return BREAKING_RE.test(title); }
function isVeryNew(iso: string) { return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000; }

// ── 이슈 타임라인 프리셋 키워드 ─────────────────────────────────────────

const PRESET_KEYWORDS = [
  "이란","미중갈등","연준 금리","반도체","트럼프 관세",
  "우크라이나","엔비디아","삼성전자","원/달러","OPEC",
];

const IMPORTANCE_COLOR: Record<string, { dot: string; badge: string; label: string }> = {
  high:   { dot: "#EF4444", badge: "#FEE2E2", label: "핵심" },
  medium: { dot: "#F59E0B", badge: "#FEF3C7", label: "주요" },
  low:    { dot: "#94a3b8", badge: "#F1F5F9", label: "참고" },
};

const PAGE = 40;
type Tab = "feed" | "scraps" | "timeline";

// ── 뉴스 아이템 행 ──────────────────────────────────────────────────────────

function NewsRow({ item, colors }: { item: MacroNewsItem; colors: any }) {
  const breaking = isBreaking(item.title);
  const veryNew  = isVeryNew(item.pubDate);
  const dotColor = breaking ? "#f97316" : veryNew ? "#fdba74" : colors.border;
  const relT = relTime(item.pubDate);

  return (
    <Pressable
      style={[s.newsRow, { borderBottomColor: colors.border }]}
      onPress={() => Linking.openURL(item.url)}
    >
      {/* 불릿 */}
      <View style={{ paddingTop: 6, paddingRight: 10 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dotColor }} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        {/* 시간 + 속보 뱃지 */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{
            fontSize: 12,
            color: veryNew ? "#f97316" : colors.mutedForeground,
            fontFamily: veryNew ? "Inter_600SemiBold" : "Inter_400Regular",
          }}>{relT}</Text>
          {breaking && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#FFF1EE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>
              <Feather name="zap" size={9} color="#f97316" />
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#f97316" }}>속보</Text>
            </View>
          )}
        </View>
        {/* 헤드라인 */}
        <Text style={[s.newsTitle, {
          color: colors.foreground,
          fontFamily: (breaking || veryNew) ? "Inter_600SemiBold" : "Inter_500Medium",
        }]} numberOfLines={3}>
          {item.title}
        </Text>
        {/* 출처 */}
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          {item.source}
        </Text>
      </View>
    </Pressable>
  );
}

// ── 속보 배너 ──────────────────────────────────────────────────────────────

function BreakingBanner({ items, colors }: { items: MacroNewsItem[]; colors: any }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => setIdx(v => (v + 1) % items.length), 4000);
    return () => clearInterval(t);
  }, [items.length]);
  const item = items[idx];
  if (!item) return null;
  return (
    <Pressable
      style={[s.breakingBanner, { borderColor: "#f97316" + "33", backgroundColor: "#FFF1EE" }]}
      onPress={() => Linking.openURL(item.url)}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ backgroundColor: "#f97316", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>속보</Text>
        </View>
        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: "#c2410c", flex: 1 }} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={{ fontSize: 11, color: "#f9731680", fontFamily: "Inter_400Regular" }}>
          {idx + 1}/{items.length}
        </Text>
      </View>
    </Pressable>
  );
}

// ── 메인 ─────────────────────────────────────────────────────────────────

export default function NewsTab() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isSignedIn } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ── 탭 ──
  const [tab, setTab] = useState<Tab>("feed");

  // ── 피드 ──
  const [items, setItems] = useState<MacroNewsItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // ── 검색 ──
  const [searchQuery, setSearchQuery] = useState("");

  // ── 이슈 타임라인 ──
  const [tlInput, setTlInput]     = useState("");
  const [tlKeyword, setTlKeyword] = useState("");
  const [tlData, setTlData]       = useState<TimelineData | null>(null);
  const [tlLoading, setTlLoading] = useState(false);
  const [tlError, setTlError]     = useState<string | null>(null);
  const [tlExpandedIdx, setTlExpandedIdx] = useState<number | null>(null);

  const loadFeed = useCallback(async (force = false) => {
    setFeedLoading(true);
    setExpanded(false);
    try {
      const d = await apiFetch<{ items: MacroNewsItem[]; cachedAt: string }>(
        `/api/macro/news${force ? "?force=true" : ""}`
      );
      if (d?.items) { setItems(d.items); setCachedAt(d.cachedAt); }
    } catch {
      try {
        // fallback to /api/news
        const d2 = await apiFetch<{ items: MacroNewsItem[]; cachedAt?: string }>("/api/news");
        if (d2?.items) { setItems(d2.items); setCachedAt(d2.cachedAt ?? null); }
      } catch {}
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  const fetchTimeline = useCallback(async (kw: string) => {
    if (!kw.trim()) return;
    Keyboard.dismiss();
    setTlLoading(true);
    setTlError(null);
    setTlData(null);
    setTlKeyword(kw.trim());
    setTlExpandedIdx(null);
    try {
      const data = await apiFetch<TimelineData>(`/api/news/timeline?keyword=${encodeURIComponent(kw.trim())}`);
      setTlData(data);
    } catch (e: any) {
      setTlError(e?.message ?? "타임라인 생성 실패");
    } finally {
      setTlLoading(false);
    }
  }, []);

  // ── 피드 그룹화 ──
  const q = searchQuery.trim().toLowerCase();
  const filtered = q ? items.filter(i => i.title.toLowerCase().includes(q) || i.source.toLowerCase().includes(q)) : items;
  const breakingItems = filtered.filter(i => isBreaking(i.title) && isVeryNew(i.pubDate));
  const visible = q ? filtered : (expanded ? filtered : filtered.slice(0, PAGE));

  type Group = { label: string; items: MacroNewsItem[] };
  const grouped: Group[] = [];
  for (const item of visible) {
    const lbl = dateLabel(item.pubDate);
    const last = grouped[grouped.length - 1];
    if (last?.label === lbl) last.items.push(item);
    else grouped.push({ label: lbl, items: [item] });
  }

  const cachedTime = cachedAt ? timeStr(cachedAt) : null;

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      {/* ── 헤더 ── */}
      <View style={[s.header, { paddingTop: topPad + 12, borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={[s.headerMain, { color: colors.foreground }]}>속보</Text>
            <Feather name="zap" size={18} color="#f97316" style={{ marginHorizontal: -2 }} />
            <Text style={[s.headerSub, { color: colors.foreground + "66" }]}>주요뉴스</Text>
          </View>
          {tab === "feed" && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {cachedTime && !feedLoading && (
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{cachedTime} 기준</Text>
              )}
              <TouchableOpacity onPress={() => loadFeed(true)} disabled={feedLoading} style={{ padding: 4 }}>
                <Feather name="refresh-cw" size={16} color={feedLoading ? colors.border : colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        {/* 굵은 구분선 */}
        <View style={{ height: 2, backgroundColor: colors.foreground + "CC", marginBottom: 12 }} />

        {/* 탭 버튼 */}
        <View style={[s.tabBar, { backgroundColor: colors.muted + "60", borderColor: colors.border }]}>
          {([
            { key: "feed",     label: "피드",        icon: "list" },
            { key: "scraps",   label: "스크랩",      icon: "bookmark" },
            { key: "timeline", label: "이슈 타임라인", icon: "clock" },
          ] as const).map(({ key, label, icon }) => (
            <TouchableOpacity
              key={key}
              style={[s.tabBtn, tab === key && { backgroundColor: colors.background }]}
              onPress={() => { setTab(key as Tab); setSearchQuery(""); }}
            >
              <Feather name={icon} size={12} color={tab === key ? colors.foreground : colors.mutedForeground} />
              <Text style={[s.tabLabel, { color: tab === key ? colors.foreground : colors.mutedForeground,
                fontFamily: tab === key ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── 피드 탭 ── */}
      {tab === "feed" && (
        <ScrollView
          contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
          refreshControl={<RefreshControl refreshing={feedLoading} onRefresh={() => loadFeed(true)} tintColor="#f97316" />}
          keyboardShouldPersistTaps="handled"
        >
          {/* 검색바 */}
          <View style={[s.searchRow, { backgroundColor: colors.muted + "50", borderColor: colors.border }]}>
            <Feather name="search" size={14} color={colors.mutedForeground} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="키워드로 뉴스 검색..."
              placeholderTextColor={colors.mutedForeground}
              style={[s.searchInput, { color: colors.foreground }]}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            )}
          </View>

          {/* 속보 배너 */}
          {breakingItems.length > 0 && !feedLoading && (
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              <BreakingBanner items={breakingItems} colors={colors} />
            </View>
          )}

          {/* 검색 결과 수 */}
          {q && !feedLoading && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingTop: 10 }}>
              <Feather name="search" size={12} color={colors.mutedForeground} />
              <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>"{searchQuery}"</Text>
                {" "}검색 결과{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold", color: "#f97316" }}>{filtered.length}건</Text>
              </Text>
            </View>
          )}

          {/* 뉴스 목록 */}
          {feedLoading && items.length === 0 ? (
            <View style={{ paddingVertical: 24, gap: 1 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <View key={i} style={[s.skeletonRow, { borderBottomColor: colors.border }]}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border, marginTop: 6 }} />
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={{ height: 12, backgroundColor: colors.muted, borderRadius: 4, width: "30%" }} />
                    <View style={{ height: 15, backgroundColor: colors.muted, borderRadius: 4, width: "90%" }} />
                    <View style={{ height: 15, backgroundColor: colors.muted, borderRadius: 4, width: "70%" }} />
                    <View style={{ height: 11, backgroundColor: colors.muted, borderRadius: 4, width: "20%" }} />
                  </View>
                </View>
              ))}
            </View>
          ) : grouped.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="inbox" size={32} color={colors.border} />
              <Text style={{ fontSize: 14, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                {q ? `"${searchQuery}"에 해당하는 뉴스가 없습니다` : "뉴스를 불러오지 못했습니다"}
              </Text>
              {q && (
                <TouchableOpacity onPress={() => setSearchQuery("")}>
                  <Text style={{ fontSize: 12, color: "#f97316", fontFamily: "Inter_400Regular" }}>검색 초기화</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {grouped.map(group => (
                <View key={group.label}>
                  {/* 날짜 헤더 */}
                  <View style={[s.dateHeader, { backgroundColor: colors.muted + "40", borderBottomColor: colors.border }]}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground + "BB" }}>
                      {group.label}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                      {group.items.length}건
                    </Text>
                  </View>
                  {group.items.map((item, i) => (
                    <NewsRow key={`${item.url}-${i}`} item={item} colors={colors} />
                  ))}
                </View>
              ))}
              {/* 더보기 */}
              {!q && items.length > PAGE && (
                <TouchableOpacity
                  style={{ paddingVertical: 16, alignItems: "center" }}
                  onPress={() => setExpanded(v => !v)}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Feather name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                    <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                      {expanded ? "접기" : `${items.length - PAGE}건 더보기`}
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
              <Text style={{ fontSize: 10, color: colors.mutedForeground + "66", textAlign: "center", paddingVertical: 12, paddingHorizontal: 20, fontFamily: "Inter_400Regular" }}>
                본 뉴스피드는 각 언론사 RSS를 통해 제공되며, 투자 권유가 아닙니다.
              </Text>
            </>
          )}
        </ScrollView>
      )}

      {/* ── 스크랩 탭 ── */}
      {tab === "scraps" && (
        isSignedIn ? (
          <ScrapsList colors={colors} insets={insets} searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
        ) : (
          <View style={s.emptyState}>
            <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
              <Feather name="bookmark" size={24} color={colors.mutedForeground} />
            </View>
            <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>로그인이 필요합니다</Text>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" }}>
              스크랩 기능은 로그인 후 이용할 수 있습니다
            </Text>
          </View>
        )
      )}

      {/* ── 이슈 타임라인 탭 ── */}
      {tab === "timeline" && (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            키워드로 처음부터 지금까지의 흐름을 한눈에 · 애빛다가 찾아줍니다
          </Text>

          {/* 검색 폼 */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={[s.tlSearchBox, { backgroundColor: colors.background, borderColor: colors.border, flex: 1 }]}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                value={tlInput}
                onChangeText={setTlInput}
                placeholder="키워드 입력 (예: 이란, 엔비디아, 미중갈등...)"
                placeholderTextColor={colors.mutedForeground}
                style={[s.searchInput, { color: colors.foreground, flex: 1 }]}
                returnKeyType="search"
                onSubmitEditing={() => fetchTimeline(tlInput)}
              />
            </View>
            <TouchableOpacity
              style={[s.tlSearchBtn, { backgroundColor: "#f97316", opacity: tlLoading || !tlInput.trim() ? 0.5 : 1 }]}
              onPress={() => fetchTimeline(tlInput)}
              disabled={tlLoading || !tlInput.trim()}
            >
              <Feather name="star" size={14} color="#fff" />
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>검색</Text>
            </TouchableOpacity>
          </View>

          {/* 트렌딩 키워드 칩 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {PRESET_KEYWORDS.map(kw => (
                <TouchableOpacity
                  key={kw}
                  style={[s.kwChip, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  onPress={() => { setTlInput(kw); fetchTimeline(kw); }}
                >
                  <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: "Inter_400Regular" }}>{kw}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* 타임라인 결과 */}
          {tlLoading ? (
            <View style={{ alignItems: "center", gap: 12, paddingVertical: 40 }}>
              <ActivityIndicator size="large" color="#f97316" />
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                "{tlInput}" 타임라인 생성 중…
              </Text>
            </View>
          ) : tlError ? (
            <View style={{ alignItems: "center", gap: 8, paddingVertical: 24 }}>
              <Feather name="alert-circle" size={28} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground }}>{tlError}</Text>
              <TouchableOpacity onPress={() => fetchTimeline(tlKeyword)}>
                <Text style={{ fontSize: 12, color: "#f97316" }}>다시 시도</Text>
              </TouchableOpacity>
            </View>
          ) : tlData ? (
            <View style={{ gap: 10 }}>
              <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, marginBottom: 6 }}>
                  "{tlData.keyword}" 요약
                </Text>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 18 }}>
                  {tlData.summary}
                </Text>
              </View>
              {tlData.timeline.map((ev, i) => {
                const imp = IMPORTANCE_COLOR[ev.importance] ?? IMPORTANCE_COLOR.low;
                const isOpen = tlExpandedIdx === i;
                return (
                  <Pressable
                    key={i}
                    style={[s.tlEvent, { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: imp.dot }]}
                    onPress={() => setTlExpandedIdx(isOpen ? null : i)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
                          <View style={{ backgroundColor: imp.badge, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: imp.dot }}>{imp.label}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                            {ev.dateLabel ?? ev.date}
                          </Text>
                          {ev.category && (
                            <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{ev.category}</Text>
                          )}
                        </View>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: colors.foreground, lineHeight: 18 }}>
                          {ev.event}
                        </Text>
                        {isOpen && (
                          <View style={{ marginTop: 8, gap: 6 }}>
                            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
                              {ev.detail}
                            </Text>
                            {ev.url && (
                              <TouchableOpacity onPress={() => Linking.openURL(ev.url!)}>
                                <Text style={{ fontSize: 11, color: "#f97316", fontFamily: "Inter_400Regular" }}>
                                  {ev.source ?? "원문 보기"} →
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                      <Feather name={isOpen ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
                    </View>
                  </Pressable>
                );
              })}
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", gap: 4, justifyContent: "center", paddingVertical: 4 }}
                onPress={() => fetchTimeline(tlKeyword)}
              >
                <Feather name="refresh-cw" size={13} color={colors.mutedForeground} />
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>새로고침</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 10, paddingVertical: 40 }}>
              <Feather name="clock" size={32} color={colors.border} />
              <Text style={{ fontSize: 13, color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" }}>
                키워드를 입력하면 AI가{"\n"}관련 이슈 타임라인을 만들어줍니다
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── 스크랩 목록 컴포넌트 ──────────────────────────────────────────────────

interface ScrapItem {
  id: number;
  title: string;
  source: string;
  url: string;
  pub_date: string | null;
  category: string;
  tags: string[];
  topic: string;
  note: string;
  scrapped_at: string;
}

function ScrapsList({ colors, insets, searchQuery, setSearchQuery }: {
  colors: any; insets: any; searchQuery: string; setSearchQuery: (v: string) => void;
}) {
  const [scraps, setScraps] = useState<ScrapItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ scraps: ScrapItem[] }>("/api/news/scraps")
      .then(d => { if (d?.scraps) setScraps(d.scraps); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const filtered = q ? scraps.filter(s => s.title.toLowerCase().includes(q)) : scraps;

  if (loading) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="small" color="#f97316" />
    </View>
  );

  if (scraps.length === 0) return (
    <View style={s.emptyState}>
      <Feather name="bookmark" size={32} color={colors.border} />
      <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>스크랩한 기사가 없습니다</Text>
      <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" }}>
        피드에서 기사를 스크랩하면 주제별로 정리됩니다
      </Text>
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: (Platform.OS === "web" ? 84 : insets.bottom) + 80 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[s.searchRow, { backgroundColor: colors.muted + "50", borderColor: colors.border }]}>
        <Feather name="search" size={14} color={colors.mutedForeground} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="스크랩 검색..."
          placeholderTextColor={colors.mutedForeground}
          style={[s.searchInput, { color: colors.foreground }]}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
          총 <Text style={{ fontFamily: "Inter_700Bold", color: colors.foreground }}>{q ? filtered.length : scraps.length}건</Text>
        </Text>
      </View>
      {filtered.map(item => (
        <Pressable
          key={item.id}
          style={[s.newsRow, { borderBottomColor: colors.border }]}
          onPress={() => Linking.openURL(item.url)}
        >
          <View style={{ paddingTop: 6, paddingRight: 10 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border }} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            {item.topic && (
              <View style={{ alignSelf: "flex-start", backgroundColor: "#FFF1EE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                <Text style={{ fontSize: 10, color: "#f97316", fontFamily: "Inter_600SemiBold" }}>{item.topic}</Text>
              </View>
            )}
            <Text style={[s.newsTitle, { color: colors.foreground, fontFamily: "Inter_500Medium" }]} numberOfLines={3}>
              {item.title}
            </Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>{item.source}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// ── StyleSheet ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  headerMain: { fontSize: 22, fontFamily: "Inter_900Black" },
  headerSub:  { fontSize: 22, fontFamily: "Inter_900Black" },
  tabBar: {
    flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 4, gap: 2,
  },
  tabBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingVertical: 8, borderRadius: 8,
  },
  tabLabel: { fontSize: 12 },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    margin: 12, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", padding: 0 },
  newsRow: {
    flexDirection: "row", alignItems: "flex-start",
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  newsTitle: { fontSize: 15, lineHeight: 21 },
  dateHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  breakingBanner: {
    borderRadius: 10, borderWidth: 1, padding: 10, marginBottom: 6,
  },
  skeletonRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyState: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32,
  },
  tlSearchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 12, borderWidth: 1,
  },
  tlSearchBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
  },
  kwChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1,
  },
  tlEvent: {
    borderRadius: 12, borderWidth: 1, borderLeftWidth: 3,
    padding: 14,
  },
});
