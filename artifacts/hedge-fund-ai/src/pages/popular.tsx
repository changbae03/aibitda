import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Flame, Loader2, ChevronRight, TrendingUp, TrendingDown } from "lucide-react";
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
  createdAt: string;
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

function upsidePct(target: number | null, entry: number | null) {
  if (!target || !entry || entry === 0) return null;
  return ((target - entry) / entry) * 100;
}

export default function Popular() {
  const [, setLocation] = useLocation();
  const [items, setItems] = useState<PopularItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(getApiUrl("/api/analysis/popular"), { credentials: "include" });
        if (r.ok) setItems(await r.json());
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
        <div className="space-y-3">
          {items.map((item, i) => {
            const badge = verdictStyle(item.investmentVerdict);
            const currency = isUSTicker(item.ticker) ? "USD" : "KRW";
            const upside = upsidePct(item.targetPrice, item.entryPrice);
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

                    {/* Price info */}
                    <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-neutral-500">
                      {item.targetPrice != null && (
                        <span>
                          적정주가{" "}
                          <span className="font-semibold text-neutral-700">
                            {formatCurrency(item.targetPrice, currency)}
                          </span>
                        </span>
                      )}
                      {upside != null && (
                        <span className={cn("flex items-center gap-0.5 font-semibold",
                          upside >= 0 ? "text-green-600" : "text-red-500"
                        )}>
                          {upside >= 0
                            ? <TrendingUp className="w-3 h-3" />
                            : <TrendingDown className="w-3 h-3" />
                          }
                          {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                        </span>
                      )}
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
      )}
    </div>
  );
}
