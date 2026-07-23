/**
 * detail-panels.tsx
 * 분석 상세 페이지용 추가 패널: 매출이익 추이, 공시, 배당, 공매도, 주주, ETF, 뉴스
 */

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Linking, Pressable,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/hooks/useApi";

const CORAL = "#FF8A7A";

// ── 공통 helpers ──────────────────────────────────────────────────────────────

function isKRTicker(ticker: string) {
  return /^\d{6}(\.KS|\.KQ)?$/.test(ticker);
}
function cleanCode(ticker: string) {
  return ticker.replace(".KS", "").replace(".KQ", "");
}

function fmtKrw(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(1)}조`;
  if (abs >= 1e8)  return `${sign}${Math.round(abs / 1e8)}억`;
  if (abs >= 1e4)  return `${sign}${Math.round(abs / 1e4)}만`;
  return `${sign}${v.toLocaleString("ko-KR")}`;
}
function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${v.toLocaleString("en-US")}`;
}
function fmtAmount(v: number | null | undefined, currency: string) {
  if (v == null) return "—";
  return currency === "KRW" ? fmtKrw(v) : fmtUsd(v);
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  const colors = useColors();
  return (
    <View style={[{
      borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border, backgroundColor: colors.card ?? colors.background,
      padding: 14, marginHorizontal: 16, marginTop: 12,
    }, style]}>
      {children}
    </View>
  );
}

function SectionTitle({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 14 }}>
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{ fontSize: 16, fontFamily: "Pretendard-Bold", color: colors.foreground, flex: 1 }}>
        {title}
      </Text>
      {sub && <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{sub}</Text>}
    </View>
  );
}

function SkeletonLine({ w = "100%", h = 13 }: { w?: any; h?: number }) {
  const colors = useColors();
  const op = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(op, { toValue: 0.85, duration: 800, useNativeDriver: true }),
      Animated.timing(op, { toValue: 0.4,  duration: 800, useNativeDriver: true }),
    ]));
    a.start(); return () => a.stop();
  }, []);
  return <Animated.View style={{ height: h, borderRadius: 6, backgroundColor: colors.muted, width: w, opacity: op }} />;
}

function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLine key={i} w={`${75 + (i * 13) % 25}%`} />
      ))}
    </View>
  );
}

function KVRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
      <Text style={{ flex: 1, fontSize: 14, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
        {label}
      </Text>
      <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold",
        color: highlight ? CORAL : colors.foreground }}>
        {value}
      </Text>
    </View>
  );
}

// ── 1. 매출이익 추이 차트 ─────────────────────────────────────────────────────

interface FinancialEntry {
  period: string; isEstimate: boolean;
  revenue: number | null; operatingIncome: number | null;
  netIncome: number | null; operatingMargin: number | null;
}
interface FinancialData {
  ticker: string; currency: string;
  annual: FinancialEntry[]; quarterly: FinancialEntry[];
}

function periodLabel(p: string, view: "annual" | "quarterly"): string {
  if (view === "annual") return p.slice(0, 4);
  const m = p.match(/^(\d{4})[-.](\d{2})$/);
  if (!m) return p;
  return `${Math.ceil(parseInt(m[2]) / 3)}Q${m[1].slice(2)}`;
}

function MiniBar({ value, max, color, width }: { value: number | null; max: number; color: string; width: number }) {
  const colors = useColors();
  const barH = 64;
  const pct  = (value != null && max > 0) ? Math.abs(value) / max : 0;
  const h    = Math.max(2, Math.round(pct * barH));
  const isNeg = (value ?? 0) < 0;
  return (
    <View style={{ width, alignItems: "center", justifyContent: "flex-end", height: barH }}>
      <View style={{
        width: width - 3, height: h,
        backgroundColor: isNeg ? "#ef4444" : color,
        borderRadius: 3, opacity: isNeg ? 0.75 : 1,
      }} />
    </View>
  );
}

export function FinancialChartPanel({ ticker }: { ticker: string }) {
  const colors = useColors();
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"annual" | "quarterly">("annual");

  useEffect(() => {
    apiFetch<FinancialData>(`/api/market-data/financials/${encodeURIComponent(ticker)}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!loading && !data) return null;
  const entries = (view === "annual" ? data?.annual : data?.quarterly) ?? [];
  const visible = entries.slice(-6);
  const currency = data?.currency ?? "KRW";

  const maxRev = Math.max(...visible.map(e => Math.abs(e.revenue ?? 0)), 1);
  const maxOp  = Math.max(...visible.map(e => Math.abs(e.operatingIncome ?? 0)), 1);
  const maxNet = Math.max(...visible.map(e => Math.abs(e.netIncome ?? 0)), 1);
  const globalMax = Math.max(maxRev, 1);

  const BAR_W = 44;

  return (
    <Card>
      <SectionTitle icon="📊" title="매출·이익 추이" />

      {/* 탭 */}
      <View style={{ flexDirection: "row", backgroundColor: colors.muted, borderRadius: 8, padding: 3, marginBottom: 14 }}>
        {(["annual", "quarterly"] as const).map(v => (
          <TouchableOpacity key={v} onPress={() => setView(v)}
            style={{ flex: 1, alignItems: "center", paddingVertical: 6, borderRadius: 6,
              backgroundColor: view === v ? colors.background : "transparent" }}>
            <Text style={{ fontSize: 13, fontFamily: view === v ? "Pretendard-SemiBold" : "Pretendard-Regular",
              color: view === v ? colors.foreground : colors.mutedForeground }}>
              {v === "annual" ? "연간" : "분기"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <SkeletonCard rows={4} /> : (
        <>
          {/* 범례 */}
          <View style={{ flexDirection: "row", gap: 12, marginBottom: 10 }}>
            {[["#2563eb", "매출"], [CORAL, "영업이익"], ["#16a34a", "순이익"]].map(([c, l]) => (
              <View key={l} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c }} />
                <Text style={{ fontSize: 11, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>{l}</Text>
              </View>
            ))}
          </View>

          {/* 막대 차트 */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
              {visible.map((e, i) => (
                <View key={i} style={{ alignItems: "center", width: BAR_W }}>
                  {/* 3개 막대 그룹 */}
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
                    <MiniBar value={e.revenue}         max={globalMax} color="#2563eb" width={12} />
                    <MiniBar value={e.operatingIncome} max={globalMax} color={CORAL}    width={12} />
                    <MiniBar value={e.netIncome}       max={globalMax} color="#16a34a"  width={12} />
                  </View>
                  {/* 기간 레이블 */}
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 4,
                    fontFamily: "Pretendard-Regular" }}>
                    {periodLabel(e.period, view)}
                    {e.isEstimate ? "E" : ""}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* 최신 수치 요약 */}
          {visible.length > 0 && (() => {
            const last = visible[visible.length - 1];
            const margin = last.operatingMargin != null ? `${last.operatingMargin.toFixed(1)}%` : "—";
            return (
              <View style={{ marginTop: 12, backgroundColor: colors.muted, borderRadius: 10, padding: 10,
                flexDirection: "row", justifyContent: "space-between" }}>
                {[
                  ["매출", fmtAmount(last.revenue, currency)],
                  ["영업이익", fmtAmount(last.operatingIncome, currency)],
                  ["OPM", margin],
                ].map(([l, v]) => (
                  <View key={l} style={{ alignItems: "center" }}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{l}</Text>
                    <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: colors.foreground, marginTop: 2 }}>{v}</Text>
                  </View>
                ))}
              </View>
            );
          })()}
        </>
      )}
    </Card>
  );
}

// ── 2. 주요 공시 ──────────────────────────────────────────────────────────────

interface Disclosure { reportName: string; date: string; dartUrl: string; submitter?: string; }

function disclosureBadge(name: string): { label: string; bg: string; color: string } | null {
  if (/잠정|실적/.test(name))   return { label: "실적", bg: "#dcfce7", color: "#16a34a" };
  if (/유상증자|무상증자/.test(name)) return { label: "증자", bg: "#fee2e2", color: "#dc2626" };
  if (/자사주/.test(name))       return { label: "자사주", bg: "#dbeafe", color: "#2563eb" };
  if (/배당/.test(name))         return { label: "배당", bg: "#fef9c3", color: "#b45309" };
  if (/감사/.test(name))         return { label: "감사", bg: "#f3f4f6", color: "#6b7280" };
  return null;
}

export function DisclosurePanel({ ticker }: { ticker: string }) {
  const colors = useColors();
  const [items, setItems] = useState<Disclosure[]>([]);
  const [loading, setLoading] = useState(true);
  const isKR = isKRTicker(ticker);

  useEffect(() => {
    if (!isKR) { setLoading(false); return; }
    apiFetch<Disclosure[]>(`/api/market-data/dart-disclosures?ticker=${encodeURIComponent(cleanCode(ticker))}`)
      .then(d => { setItems(d ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker, isKR]);

  if (!isKR || (!loading && items.length === 0)) return null;

  return (
    <Card>
      <SectionTitle icon="📋" title="주요 공시" sub="최근 90일 · DART" />
      {loading ? <SkeletonCard rows={4} /> : (
        <View>
          {items.slice(0, 10).map((item, i) => {
            const badge = disclosureBadge(item.reportName);
            const parts = item.date.split("-");
            const dateLabel = parts.length === 3 ? `${parts[1]}/${parts[2]}` : item.date;
            return (
              <TouchableOpacity key={i} onPress={() => item.dartUrl && Linking.openURL(item.dartUrl)}
                style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, gap: 8,
                  borderBottomWidth: i < items.length - 1 ? StyleSheet.hairlineWidth : 0,
                  borderBottomColor: colors.border }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, fontFamily: "Pretendard-Regular", width: 30 }}>
                  {dateLabel}
                </Text>
                <Text style={{ flex: 1, fontSize: 13, color: colors.foreground,
                  fontFamily: "Pretendard-Regular", lineHeight: 18 }} numberOfLines={2}
                  lineBreakStrategyIOS="hangul-word">
                  {item.reportName}
                </Text>
                {badge && (
                  <View style={{ backgroundColor: badge.bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 }}>
                    <Text style={{ fontSize: 11, color: badge.color, fontFamily: "Pretendard-SemiBold" }}>
                      {badge.label}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </Card>
  );
}

// ── 3. 배당 정보 ──────────────────────────────────────────────────────────────

interface DividendInfo {
  dividendYield: number | null; dividendRate: number | null;
  exDividendDate: string | null; payoutRatio: number | null;
  fiveYearAvgDividendYield: number | null;
  history: { date: string; amount: number }[];
}

export function DividendPanel({ ticker }: { ticker: string }) {
  const colors = useColors();
  const [info, setInfo] = useState<DividendInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<DividendInfo>(`/api/market-data/dividend-info?ticker=${encodeURIComponent(ticker)}`)
      .then(d => { setInfo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!loading && (info == null || info.dividendYield == null)) return null;

  const fmtPct = (v: number | null) => v != null ? `${(v * 100).toFixed(2)}%` : "—";
  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const p = d.split("T")[0].split("-");
    return p.length === 3 ? `${p[0]}.${p[1]}.${p[2]}` : d;
  };
  const fmtDiv = (v: number | null) => v != null ? (isKRTicker(ticker) ? `${v.toLocaleString("ko-KR")}원` : `$${v.toFixed(2)}`) : "—";

  return (
    <Card>
      <SectionTitle icon="💰" title="배당 정보" />
      {loading ? <SkeletonCard rows={3} /> : info ? (
        <>
          {/* 시가배당률 하이라이트 */}
          {info.dividendYield != null && (
            <View style={{ backgroundColor: "#dcfce7", borderRadius: 10, padding: 12,
              flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <Text style={{ fontSize: 14, color: "#15803d", fontFamily: "Pretendard-Regular" }}>시가배당률</Text>
              <Text style={{ fontSize: 22, color: "#15803d", fontFamily: "Pretendard-Bold" }}>
                {fmtPct(info.dividendYield)}
              </Text>
            </View>
          )}
          <View>
            {[
              ["연간 배당금",    fmtDiv(info.dividendRate)],
              ["배당락일",       fmtDate(info.exDividendDate)],
              ["배당성향",       fmtPct(info.payoutRatio)],
              ["5년 평균수익률", fmtPct(info.fiveYearAvgDividendYield)],
            ].map(([l, v]) => <KVRow key={l} label={l} value={v} />)}
          </View>
          {/* 배당 이력 인라인 바 */}
          {info.history && info.history.length > 0 && (() => {
            const maxAmt = Math.max(...info.history.map(h => h.amount), 1);
            return (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginBottom: 8 }}>배당 이력</Text>
                <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
                  {info.history.slice(-6).map((h, i) => {
                    const pct = h.amount / maxAmt;
                    return (
                      <View key={i} style={{ flex: 1, alignItems: "center" }}>
                        <View style={{ height: 32, justifyContent: "flex-end", width: "100%" }}>
                          <View style={{ height: Math.max(3, Math.round(pct * 32)),
                            backgroundColor: "#16a34a", borderRadius: 3, opacity: 0.7 }} />
                        </View>
                        <Text style={{ fontSize: 9, color: colors.mutedForeground, marginTop: 3 }}>
                          {h.date.slice(0, 4)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })()}
        </>
      ) : null}
    </Card>
  );
}

// ── 4. 공매도 현황 ────────────────────────────────────────────────────────────

interface ShortInfo {
  shortRatio: number | null; shortAmt: number | null;
  canShort: boolean | null; shortPct: number | null;
}

export function ShortInfoPanel({ ticker }: { ticker: string }) {
  const colors = useColors();
  const [info, setInfo] = useState<ShortInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const isKR = isKRTicker(ticker);

  useEffect(() => {
    if (!isKR) { setLoading(false); return; }
    apiFetch<ShortInfo>(`/api/market-data/short-info?ticker=${encodeURIComponent(cleanCode(ticker))}`)
      .then(d => { setInfo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker, isKR]);

  if (!isKR || (!loading && info == null)) return null;

  const ratio = info?.shortRatio ?? 0;
  const isHigh = ratio >= 2;
  const fmtShortAmt = (v: number | null) => {
    if (v == null) return "—";
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}조원`;
    if (v >= 1e8)  return `${Math.round(v / 1e8)}억원`;
    return `${v.toLocaleString("ko-KR")}원`;
  };

  return (
    <Card>
      <SectionTitle icon="📉" title="공매도 현황" />
      {loading ? <SkeletonCard rows={3} /> : info ? (
        <View>
          {[
            { label: "공매도 잔고율",   value: info.shortRatio != null ? `${info.shortRatio.toFixed(2)}%` : "—", hl: isHigh },
            { label: "공매도 잔고금액", value: fmtShortAmt(info.shortAmt), hl: false },
            { label: "공매도 가능",     value: info.canShort == null ? "—" : info.canShort ? "가능" : "불가", hl: info.canShort === false },
          ].map(({ label, value, hl }) => (
            <View key={label} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10,
              borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
              <Text style={{ flex: 1, fontSize: 14, color: colors.mutedForeground, fontFamily: "Pretendard-Regular" }}>
                {label}
              </Text>
              <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold",
                color: hl ? "#dc2626" : colors.foreground }}>
                {value}
              </Text>
            </View>
          ))}
          {isHigh && (
            <View style={{ marginTop: 10, backgroundColor: "#fee2e2", borderRadius: 8, padding: 10 }}>
              <Text style={{ fontSize: 13, color: "#dc2626", fontFamily: "Pretendard-Regular", lineHeight: 18 }}>
                ⚠️ 공매도 잔고율 2% 이상 — 공매도 압력이 높습니다
              </Text>
            </View>
          )}
        </View>
      ) : null}
    </Card>
  );
}

// ── 5. 주요 주주 ──────────────────────────────────────────────────────────────

interface MajorShareholders {
  insidersPercent: number | null; institutionsPercent: number | null;
  institutionsCount: number | null;
  dartHolders: { name: string; relate: string; pct: number }[];
  topHolders: { name: string; pct: number; shares: number }[];
}

function relateLabel(r: string): string {
  if (r.includes("최대주주 본인")) return "최대주주";
  if (r.includes("특수관계인"))    return "특수관계인";
  if (r.includes("계열회사"))      return "계열사";
  if (r.includes("5%"))            return "5% 이상";
  if (r.includes("임원"))          return "임원";
  return r.slice(0, 6);
}

export function MajorShareholdersPanel({ ticker }: { ticker: string }) {
  const colors = useColors();
  const [info, setInfo] = useState<MajorShareholders | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<MajorShareholders>(`/api/market-data/major-shareholders?ticker=${encodeURIComponent(ticker)}`)
      .then(d => { setInfo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!loading && info == null) return null;

  const holders = info?.dartHolders?.length ? info.dartHolders : (info?.topHolders ?? []);
  const retail = info
    ? Math.max(0, 100 - (info.insidersPercent ?? 0) * 100 - (info.institutionsPercent ?? 0) * 100)
    : 0;

  return (
    <Card>
      <SectionTitle icon="👥" title="주요 주주 현황"
        sub={info?.institutionsCount ? `${info.institutionsCount.toLocaleString()}개 기관` : undefined} />
      {loading ? <SkeletonCard rows={4} /> : (
        <>
          {/* 소유 구조 바 */}
          {info?.institutionsPercent != null && (
            <View style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden",
                backgroundColor: colors.muted }}>
                {(info.insidersPercent ?? 0) > 0 && (
                  <View style={{ width: `${(info.insidersPercent ?? 0) * 100}%` as any, backgroundColor: "#2563eb" }} />
                )}
                {(info.institutionsPercent ?? 0) > 0 && (
                  <View style={{ width: `${(info.institutionsPercent ?? 0) * 100}%` as any, backgroundColor: CORAL }} />
                )}
                {retail > 0 && (
                  <View style={{ flex: 1, backgroundColor: "#94a3b8" }} />
                )}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                {[
                  { l: "내부자", v: `${((info.insidersPercent ?? 0) * 100).toFixed(1)}%`, c: "#2563eb" },
                  { l: "기관",   v: `${((info.institutionsPercent ?? 0) * 100).toFixed(1)}%`, c: CORAL },
                  { l: "소액주주", v: `${retail.toFixed(1)}%`, c: "#94a3b8" },
                ].map(({ l, v, c }) => (
                  <View key={l} style={{ alignItems: "center" }}>
                    <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{l}</Text>
                    <Text style={{ fontSize: 13, fontFamily: "Pretendard-SemiBold", color: c }}>{v}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* 주주 목록 */}
          {holders.slice(0, 8).map((h: any, i: number) => {
            const pct = h.pct ?? 0;
            return (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 8,
                borderBottomWidth: i < Math.min(holders.length, 8) - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: "Pretendard-Regular" }} numberOfLines={1}>
                    {h.name}
                  </Text>
                  {h.relate && (
                    <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{relateLabel(h.relate)}</Text>
                  )}
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: colors.foreground }}>
                    {pct.toFixed(2)}%
                  </Text>
                  <View style={{ width: 60, height: 4, backgroundColor: colors.muted, borderRadius: 2 }}>
                    <View style={{ width: `${Math.min(pct, 50) * 2}%` as any, height: 4,
                      backgroundColor: "#2563eb", borderRadius: 2 }} />
                  </View>
                </View>
              </View>
            );
          })}
        </>
      )}
    </Card>
  );
}

// ── 6. 편입 ETF 현황 ──────────────────────────────────────────────────────────

interface ETFItem { etfName: string; etfTicker: string; weight: number; aum?: number; }

export function ETFInclusionPanel({ ticker }: { ticker: string }) {
  const colors = useColors();
  const [items, setItems] = useState<ETFItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<ETFItem[]>(`/api/market-data/etf-inclusion/${encodeURIComponent(ticker)}`)
      .then(d => { setItems(d ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (!loading && items.length === 0) return null;

  const maxW = Math.max(...items.map(e => e.weight), 0.01);

  return (
    <Card>
      <SectionTitle icon="📦" title="편입 ETF 현황"
        sub={!loading && items.length > 0 ? `${items.length}개` : undefined} />
      {loading ? <SkeletonCard rows={4} /> : (
        <View>
          {items.slice(0, 10).map((e, i) => (
            <View key={i} style={{ paddingVertical: 9, gap: 4,
              borderBottomWidth: i < Math.min(items.length, 10) - 1 ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 14, color: colors.foreground, fontFamily: "Pretendard-Regular", flex: 1 }}
                  numberOfLines={1}>
                  {e.etfName}
                </Text>
                <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: "#2563eb", marginLeft: 8 }}>
                  {e.weight.toFixed(2)}%
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{e.etfTicker}</Text>
                <View style={{ flex: 1, height: 3, backgroundColor: colors.muted, borderRadius: 2 }}>
                  <View style={{ width: `${(e.weight / maxW) * 100}%` as any, height: 3,
                    backgroundColor: "#2563eb", borderRadius: 2, opacity: 0.6 }} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

// ── 7. 뉴스 타임라인 ─────────────────────────────────────────────────────────

interface NewsItem {
  date: string; title: string; summary: string;
  sentiment?: "positive" | "negative" | "neutral";
  url?: string;
}

export function NewsTimelinePanel({ ticker, keyword }: { ticker: string; keyword?: string }) {
  const colors = useColors();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const kw = keyword || ticker;

  useEffect(() => {
    const url = `/api/news/timeline?keyword=${encodeURIComponent(kw)}&ticker=${encodeURIComponent(ticker)}`;
    apiFetch<{ items?: NewsItem[]; timeline?: NewsItem[] } | NewsItem[]>(url)
      .then(d => {
        const list = Array.isArray(d) ? d : (d as any).items ?? (d as any).timeline ?? [];
        setItems(list);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ticker, kw]);

  if (!loading && items.length === 0) return null;

  const sentimentColor = (s?: string) =>
    s === "positive" ? "#16a34a" : s === "negative" ? "#dc2626" : colors.mutedForeground;
  const sentimentDot = (s?: string) =>
    s === "positive" ? "#16a34a" : s === "negative" ? "#dc2626" : "#94a3b8";

  return (
    <Card>
      <SectionTitle icon="📰" title="뉴스 타임라인" />
      {loading ? (
        <View style={{ alignItems: "center", paddingVertical: 20, gap: 8 }}>
          <ActivityIndicator color={CORAL} size="small" />
          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>AI가 뉴스를 분석 중…</Text>
        </View>
      ) : (
        <View>
          {items.slice(0, 8).map((item, i) => {
            const parts = (item.date ?? "").split("T")[0].split("-");
            const dateLabel = parts.length === 3 ? `${parts[1]}/${parts[2]}` : item.date ?? "";
            return (
              <View key={i} style={{ flexDirection: "row", paddingVertical: 10,
                borderBottomWidth: i < Math.min(items.length, 8) - 1 ? StyleSheet.hairlineWidth : 0,
                borderBottomColor: colors.border, gap: 10 }}>
                {/* 타임라인 선 */}
                <View style={{ alignItems: "center", width: 16 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sentimentDot(item.sentiment), marginTop: 3 }} />
                  {i < Math.min(items.length, 8) - 1 && (
                    <View style={{ width: 1, flex: 1, backgroundColor: colors.border, marginTop: 3 }} />
                  )}
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{dateLabel}</Text>
                  <TouchableOpacity onPress={() => item.url && Linking.openURL(item.url)}>
                    <Text style={{ fontSize: 14, fontFamily: "Pretendard-SemiBold", color: colors.foreground,
                      lineHeight: 20 }} lineBreakStrategyIOS="hangul-word" numberOfLines={2}>
                      {item.title}
                    </Text>
                  </TouchableOpacity>
                  {item.summary && (
                    <Text style={{ fontSize: 13, color: colors.mutedForeground, lineHeight: 18 }}
                      lineBreakStrategyIOS="hangul-word" numberOfLines={3}>
                      {item.summary}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}
