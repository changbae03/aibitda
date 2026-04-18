import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Flame, Loader2, ChevronRight,
  TrendingUp, TrendingDown, Target, Minus,
  BarChart2, CheckCircle2, AlertTriangle, ArrowUpRight,
} from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import { motion } from "framer-motion";

interface PopularItem {
  id: number;
  ticker: string;
  companyName: string;
  industry: string;
  investmentVerdict: string | null;
  targetPrice: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  createdAt: string;
  currentPrice: number | null;
  priceReturn: number | null;
  outcome: string | null;
  daysElapsed: number | null;
}

interface TickerStat {
  ticker: string;
  companyName: string;
  count: number;
}

const INDUSTRY_KO: Record<string, string> = {
  "Semiconductors": "반도체", "Software—Application": "소프트웨어", "Biotechnology": "바이오",
  "Drug Manufacturers—Specialty & Generic": "제약", "Consumer Electronics": "가전·전자",
  "Auto Manufacturers": "자동차", "Banks—Regional": "지방은행", "Banks—Diversified": "종합은행",
  "Internet Content & Information": "인터넷", "Electric Vehicles": "전기차",
  "Capital Markets": "자본시장", "Insurance—Life": "생명보험", "Aerospace & Defense": "항공우주·방산",
  "Specialty Chemicals": "정밀화학", "Electronic Components": "전자부품",
  "Scientific & Technical Instruments": "계측기기", "Medical Devices": "의료기기",
  "Oil & Gas E&P": "석유·가스", "Solar": "태양광", "Telecom Services": "통신",
};

function toKoIndustry(s: string) {
  return INDUSTRY_KO[s] ?? s;
}

function isUSTicker(t: string) {
  return !/^\d{5,6}/.test(t.split(".")[0]);
}

function verdictStyle(verdict: string | null) {
  if (!verdict) return { label: "—", cls: "bg-neutral-100 text-neutral-500" };
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return { label: "강력 매수", cls: "bg-emerald-100 text-emerald-700" };
  if (s.includes("buy"))         return { label: "매수",     cls: "bg-green-100 text-green-700" };
  if (s.includes("strong sell")) return { label: "강력 매도", cls: "bg-red-100 text-red-700" };
  if (s.includes("sell"))        return { label: "매도",     cls: "bg-red-100 text-red-600" };
  return { label: "중립", cls: "bg-amber-100 text-amber-700" };
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3_600_000;
  if (h < 1)  return `${Math.round(diff / 60_000)}분 전`;
  if (h < 24) return `${Math.floor(h)}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function calcUpsideFromCurrent(target: number | null, current: number | null) {
  if (!target || !current || current === 0) return null;
  return ((target - current) / current) * 100;
}

function calcUpsideFromEntry(target: number | null, entry: number | null) {
  if (!target || !entry || entry === 0) return null;
  return ((target - entry) / entry) * 100;
}

function priceStatus(item: PopularItem): { label: string; cls: string; icon: React.ReactNode } {
  const { currentPrice, targetPrice, entryPrice, stopLoss, outcome } = item;

  if (outcome === "hit_target") {
    return { label: "목표가 도달", cls: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="w-3 h-3" /> };
  }
  if (outcome === "hit_stoploss") {
    return { label: "손절선 도달", cls: "bg-red-100 text-red-600", icon: <AlertTriangle className="w-3 h-3" /> };
  }

  if (!currentPrice || !targetPrice) return { label: "추적 전", cls: "bg-neutral-100 text-neutral-400", icon: <Minus className="w-3 h-3" /> };

  const upsideCurrent = calcUpsideFromCurrent(targetPrice, currentPrice);
  const upsideEntry = calcUpsideFromEntry(targetPrice, entryPrice);

  // stopLoss 접근
  if (stopLoss && currentPrice <= stopLoss * 1.05) {
    return { label: "손절선 근접", cls: "bg-orange-100 text-orange-600", icon: <AlertTriangle className="w-3 h-3" /> };
  }

  // 이미 목표가의 97% 이상
  if (upsideCurrent !== null && upsideCurrent <= 3) {
    return { label: "목표가 임박", cls: "bg-emerald-100 text-emerald-700", icon: <Target className="w-3 h-3" /> };
  }

  // 진입가 기준으로 절반 이상 왔는지
  if (upsideCurrent !== null && upsideEntry !== null) {
    const progress = upsideEntry > 0 ? (upsideEntry - upsideCurrent) / upsideEntry : 0;
    if (progress >= 0.5) {
      return { label: "목표 향해 전진 중", cls: "bg-blue-100 text-blue-700", icon: <ArrowUpRight className="w-3 h-3" /> };
    }
  }

  // 현재가가 진입가보다 낮을 때
  if (entryPrice && currentPrice < entryPrice * 0.95) {
    return { label: "업사이드 확대 중", cls: "bg-amber-100 text-amber-700", icon: <TrendingDown className="w-3 h-3" /> };
  }

  return { label: "진행 중", cls: "bg-neutral-100 text-neutral-500", icon: <Minus className="w-3 h-3" /> };
}

export default function Popular() {
  const [, setLocation] = useLocation();
  const [items, setItems] = useState<PopularItem[]>([]);
  const [tickerStats, setTickerStats] = useState<TickerStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(getApiUrl("/api/analysis/popular"), { credentials: "include" });
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data)) {
            setItems(data);
          } else {
            setItems(data.items ?? []);
            setTickerStats(data.tickerStats ?? []);
          }
        }
      } catch {}
      setLoading(false);
    })();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Flame className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-neutral-800">최신 분석 피드</h1>
          <p className="text-sm text-neutral-500">애빛다 AI가 완료한 최신 기업 분석 리포트</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-neutral-400">불러오는 중…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <Flame className="w-12 h-12 text-neutral-200 mx-auto mb-3" />
          <p className="text-neutral-400 text-sm">아직 공개된 분석이 없습니다.</p>
        </div>
      ) : (
        <>
          {/* ── 종목별 분석 건수 집계 ── */}
          {tickerStats.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white border border-neutral-100 rounded-2xl shadow-sm p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="w-4 h-4 text-neutral-400" />
                <p className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">많이 분석된 종목</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {tickerStats.map((ts) => (
                  <button
                    key={ts.ticker}
                    onClick={() => {
                      const found = items.find((i) => i.ticker === ts.ticker);
                      if (found) setLocation(`/analysis/${found.id}`);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-neutral-50 hover:bg-primary/5 border border-neutral-200 rounded-full transition-colors group"
                  >
                    <span className="text-[10px] font-mono text-neutral-400">{ts.ticker}</span>
                    <span className="text-[11px] font-semibold text-neutral-700">{ts.companyName}</span>
                    <span className="text-[10px] font-bold text-white bg-primary rounded-full px-1.5 py-0.5 leading-none">
                      {ts.count}
                    </span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── 피드 카드 목록 ── */}
          <div className="space-y-3">
            {items.map((item, i) => {
              const badge = verdictStyle(item.investmentVerdict);
              const currency = isUSTicker(item.ticker) ? "USD" : "KRW";
              const status = priceStatus(item);
              const upsideCurrent = calcUpsideFromCurrent(item.targetPrice, item.currentPrice);
              const upsideEntry = calcUpsideFromEntry(item.targetPrice, item.entryPrice);

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="bg-white border border-neutral-100 rounded-2xl shadow-sm p-4 cursor-pointer hover:border-neutral-200 hover:shadow-md transition-all group"
                  onClick={() => setLocation(`/analysis/${item.id}`)}
                >
                  <div className="flex items-start gap-3">
                    {/* AI badge */}
                    <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center">
                      <span className="text-primary text-[11px] font-bold">AI</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Top row */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold text-neutral-400 font-mono uppercase tracking-wide">
                          {item.ticker}
                        </span>
                        <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", badge.cls)}>
                          {badge.label}
                        </span>
                        <span className="text-[10px] text-neutral-300">{toKoIndustry(item.industry)}</span>
                      </div>

                      {/* Company name */}
                      <p className="text-[15px] font-semibold text-neutral-800 mt-0.5 leading-snug">
                        {item.companyName}
                      </p>

                      {/* Price row */}
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {/* 현재가 */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-neutral-400 uppercase tracking-wider">현재가</span>
                          <span className="text-[12px] font-semibold text-neutral-700 font-mono">
                            {item.currentPrice != null
                              ? formatCurrency(item.currentPrice, currency)
                              : <span className="text-neutral-300">—</span>
                            }
                          </span>
                          {item.daysElapsed != null && (
                            <span className="text-[9px] text-neutral-300">{item.daysElapsed}일 전 기준</span>
                          )}
                        </div>

                        {/* 적정주가 */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-neutral-400 uppercase tracking-wider">적정주가</span>
                          <span className="text-[12px] font-semibold text-neutral-700 font-mono">
                            {item.targetPrice != null
                              ? formatCurrency(item.targetPrice, currency)
                              : <span className="text-neutral-300">—</span>
                            }
                          </span>
                          {upsideEntry != null && (
                            <span className="text-[9px] text-neutral-300">분석 시 +{upsideEntry.toFixed(1)}%</span>
                          )}
                        </div>

                        {/* 현재 업사이드 */}
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[9px] text-neutral-400 uppercase tracking-wider">현재 업사이드</span>
                          {upsideCurrent != null ? (
                            <span className={cn(
                              "text-[13px] font-bold font-mono flex items-center gap-0.5",
                              upsideCurrent >= 0 ? "text-emerald-600" : "text-red-500"
                            )}>
                              {upsideCurrent >= 0
                                ? <TrendingUp className="w-3 h-3" />
                                : <TrendingDown className="w-3 h-3" />
                              }
                              {upsideCurrent >= 0 ? "+" : ""}{upsideCurrent.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[12px] text-neutral-300 font-mono">—</span>
                          )}
                          {item.priceReturn != null && (
                            <span className={cn(
                              "text-[9px] font-medium",
                              item.priceReturn >= 0 ? "text-emerald-500" : "text-red-400"
                            )}>
                              진입 후 {item.priceReturn >= 0 ? "+" : ""}{item.priceReturn.toFixed(1)}%
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status badge */}
                      <div className="mt-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full",
                          status.cls
                        )}>
                          {status.icon}
                          {status.label}
                        </span>
                      </div>
                    </div>

                    {/* Right: time + arrow */}
                    <div className="shrink-0 flex flex-col items-end gap-2 ml-1">
                      <span className="text-[10px] text-neutral-400">{relativeTime(item.createdAt)}</span>
                      <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-400 transition-colors" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
