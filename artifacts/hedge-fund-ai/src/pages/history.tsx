import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useListAnalyses, useDeleteAnalysis, getListAnalysesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { Loader2, Inbox, ArrowRight, CheckCircle2, Clock, Trash2, History as HistoryIcon, Pencil, Check, X, TrendingUp, TrendingDown, RefreshCw, Target } from "lucide-react";
import { cn, formatCurrency, getApiUrl } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface QuoteResult {
  price: number | null;
  currency: string;
  change: number | null;
}

function isUSTicker(t: string) {
  return !/^\d{5,6}/.test(t.split(".")[0]);
}

const STORAGE_KEY = "avitda-recent-analyses";
const MEMO_KEY = "avitda-memos";

function getLocalRecents(): any[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function removeLocalRecent(id: number) {
  try {
    const stored = getLocalRecents().filter((x: any) => x.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {}
}

function getAllMemos(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(MEMO_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveMemo(id: number, text: string) {
  try {
    const memos = getAllMemos();
    if (text.trim()) {
      memos[String(id)] = text.trim();
    } else {
      delete memos[String(id)];
    }
    localStorage.setItem(MEMO_KEY, JSON.stringify(memos));
  } catch {}
}

function getMemo(id: number): string {
  return getAllMemos()[String(id)] || "";
}

function toKoreanVerdict(verdict: string): string {
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return "높은 상승여력";
  if (s.includes("buy"))         return "상승여력";
  if (s.includes("strong sell")) return "높은 하락여지";
  if (s.includes("sell"))        return "하락여지";
  return "적정 수준";
}

function verdictStyle(verdict: string): string {
  const s = verdict.toLowerCase();
  if (s.includes("strong buy"))  return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s.includes("buy"))         return "bg-green-50 text-green-700 border-green-200";
  if (s.includes("strong sell")) return "bg-red-50 text-red-700 border-red-300";
  if (s.includes("sell"))        return "bg-red-50 text-red-600 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function verdictBadge(verdict?: string) {
  if (!verdict) return null;
  const label = toKoreanVerdict(verdict);
  const cls = verdictStyle(verdict);
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border", cls)}>
      {label}
    </span>
  );
}

function MemoInline({ id }: { id: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(() => getMemo(id));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(saved);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [editing]);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    saveMemo(id, draft);
    setSaved(draft.trim());
    setEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(false);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    saveMemo(id, "");
    setSaved("");
  };

  if (editing) {
    return (
      <div
        className="mt-2.5 flex flex-col gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="이 보고서에 대한 메모를 입력하세요..."
          rows={2}
          className="w-full text-[12px] text-neutral-700 placeholder-neutral-300 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-300 leading-relaxed"
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              saveMemo(id, draft);
              setSaved(draft.trim());
              setEditing(false);
            }
          }}
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-400 hover:bg-amber-500 text-white text-[11px] font-semibold transition-colors"
          >
            <Check className="w-3 h-3" /> 저장
          </button>
          <button
            onClick={handleCancel}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-500 text-[11px] font-semibold transition-colors"
          >
            <X className="w-3 h-3" /> 취소
          </button>
          <span className="text-[10px] text-neutral-300 ml-1">⌘Enter로 저장</span>
        </div>
      </div>
    );
  }

  if (saved) {
    return (
      <div
        className="mt-2 flex items-start gap-1.5 group/memo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 text-[12px] text-neutral-500 leading-relaxed bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 whitespace-pre-wrap break-words">
          {saved}
        </div>
        <div className="shrink-0 mt-0.5 flex items-center gap-0.5 opacity-0 group-hover/memo:opacity-100 transition-opacity">
          <button
            onClick={handleEdit}
            className="p-1 rounded text-neutral-300 hover:text-amber-500 hover:bg-amber-50 transition-colors"
            title="메모 수정"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={handleDelete}
            className="p-1 rounded text-neutral-300 hover:text-red-400 hover:bg-red-50 transition-colors"
            title="메모 삭제"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleEdit}
      className="mt-1.5 flex items-center gap-1 text-[11px] text-neutral-300 hover:text-amber-500 transition-colors opacity-0 group-hover:opacity-100"
    >
      <Pencil className="w-3 h-3" />
      메모 추가
    </button>
  );
}

export default function History() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: serverAnalyses, isLoading } = useListAnalyses();
  const { mutate: deleteAnalysis } = useDeleteAnalysis();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [localItems, setLocalItems] = useState<any[]>(() => getLocalRecents());
  const [quotes, setQuotes] = useState<Record<string, QuoteResult>>({});
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesUpdatedAt, setQuotesUpdatedAt] = useState<Date | null>(null);

  const list = useMemo(() => {
    const serverList = serverAnalyses ?? [];
    const serverIds = new Set(serverList.map((a: any) => a.id));
    const localOnly = localItems.filter((x) => !serverIds.has(x.id));
    return [...serverList, ...localOnly];
  }, [serverAnalyses, localItems]);

  const fetchQuotes = useCallback(async (items: any[]) => {
    const tickers = [...new Set(
      items.filter((a) => a.status === "completed" && a.targetPrice != null).map((a) => a.ticker)
    )];
    if (tickers.length === 0) return;
    setQuotesLoading(true);
    try {
      const r = await fetch(getApiUrl("/api/market-data/batch-quotes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers }),
      });
      if (r.ok) {
        setQuotes(await r.json());
        setQuotesUpdatedAt(new Date());
      }
    } catch {}
    setQuotesLoading(false);
  }, []);

  useEffect(() => {
    if (list.length > 0) fetchQuotes(list);
  }, [list.length]);

  const handleDelete = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmId(id);
  };

  const confirmDelete = (id: number, isLocalOnly: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingId(id);
    setConfirmId(null);
    if (isLocalOnly) {
      removeLocalRecent(id);
      setLocalItems(getLocalRecents());
      setDeletingId(null);
    } else {
      deleteAnalysis(id, {
        onSuccess: () => {
          removeLocalRecent(id);
          setLocalItems(getLocalRecents());
          setDeletingId(null);
        },
        onError: () => setDeletingId(null),
      });
    }
  };

  const cancelConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmId(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-300" />
      </div>
    );
  }

  const serverIds = new Set((serverAnalyses ?? []).map((a: any) => a.id));

  // ─── 업사이드 / 정확도 계산 ───────────────────────────────────────────────
  const statsItems = list.filter(
    (a) => a.status === "completed" && a.targetPrice != null && quotes[a.ticker]?.price != null
  );
  const upsides = statsItems.map((a) => {
    const q = quotes[a.ticker];
    const current = q!.price!;
    const upside = ((a.targetPrice - current) / current) * 100;
    const verdict = (a.investmentVerdict ?? "").toLowerCase();
    const isBuy  = verdict.includes("buy");
    const isSell = verdict.includes("sell");
    const returnPct = a.entryPrice ? ((current - a.entryPrice) / a.entryPrice) * 100 : null;
    const correct = returnPct != null
      ? (isBuy ? returnPct > 0 : isSell ? returnPct < 0 : null)
      : null;
    return { upside, returnPct, correct, isBuy, isSell };
  });

  const trackedCount = statsItems.length;
  const avgUpside   = trackedCount > 0 ? upsides.reduce((s, u) => s + u.upside, 0) / trackedCount : null;
  const judged      = upsides.filter((u) => u.correct !== null);
  const accuracy    = judged.length > 0 ? (judged.filter((u) => u.correct).length / judged.length) * 100 : null;
  const avgReturn   = (() => {
    const with_ret = upsides.filter((u) => u.returnPct != null);
    return with_ret.length > 0 ? with_ret.reduce((s, u) => s + u.returnPct!, 0) / with_ret.length : null;
  })();
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1
          className="text-[22px] font-black tracking-tight text-neutral-900"
          style={{ fontFamily: "'Spoqa Han Sans Neo', sans-serif" }}
        >
          내가 본 자료
        </h1>
        {trackedCount > 0 && (
          <button
            onClick={() => fetchQuotes(list)}
            disabled={quotesLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-100 hover:bg-neutral-200 transition-colors text-xs font-medium text-neutral-500 disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3 h-3", quotesLoading && "animate-spin")} />
            현재가 갱신
          </button>
        )}
      </div>

      {/* 실시간 통계 요약 */}
      {trackedCount > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          {/* 업사이드 */}
          <div className="bg-white border border-neutral-100 rounded-2xl p-4 shadow-sm">
            <p className="text-[11px] font-semibold text-neutral-400 mb-1 uppercase tracking-wide">평균 업사이드</p>
            {quotesLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
            ) : avgUpside != null ? (
              <p className={cn("text-[22px] font-black leading-none",
                avgUpside >= 10 ? "text-emerald-600" : avgUpside >= 0 ? "text-green-600" : "text-red-500"
              )}>
                {avgUpside >= 0 ? "+" : ""}{avgUpside.toFixed(1)}%
              </p>
            ) : <p className="text-neutral-300 text-sm">—</p>}
            <p className="text-[10px] text-neutral-300 mt-1">현재가 기준 잔여 업사이드</p>
          </div>

          {/* 실현 수익률 */}
          <div className="bg-white border border-neutral-100 rounded-2xl p-4 shadow-sm">
            <p className="text-[11px] font-semibold text-neutral-400 mb-1 uppercase tracking-wide">평균 수익률</p>
            {quotesLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
            ) : avgReturn != null ? (
              <p className={cn("text-[22px] font-black leading-none",
                avgReturn >= 5 ? "text-emerald-600" : avgReturn >= 0 ? "text-green-600" : "text-red-500"
              )}>
                {avgReturn >= 0 ? "+" : ""}{avgReturn.toFixed(1)}%
              </p>
            ) : <p className="text-neutral-300 text-sm">—</p>}
            <p className="text-[10px] text-neutral-300 mt-1">분석 당시 vs 현재가</p>
          </div>

          {/* AI 방향성 정확도 */}
          <div className="bg-white border border-neutral-100 rounded-2xl p-4 shadow-sm">
            <p className="text-[11px] font-semibold text-neutral-400 mb-1 uppercase tracking-wide">AI 방향성 정확도</p>
            {quotesLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
            ) : accuracy != null ? (
              <p className={cn("text-[22px] font-black leading-none",
                accuracy >= 70 ? "text-emerald-600" : accuracy >= 50 ? "text-amber-600" : "text-red-500"
              )}>
                {accuracy.toFixed(0)}%
              </p>
            ) : <p className="text-neutral-300 text-sm">—</p>}
            <p className="text-[10px] text-neutral-300 mt-1">매수↑·매도↓ 방향 일치율 ({judged.length}건)</p>
          </div>
        </div>
      )}
      {quotesUpdatedAt && trackedCount > 0 && (
        <p className="text-[10px] text-neutral-300 -mt-3 mb-4">
          마지막 업데이트: {quotesUpdatedAt.toLocaleTimeString("ko-KR")}
        </p>
      )}

      {list.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <Inbox className="w-10 h-10 text-neutral-200" />
          <p className="text-[15px] font-medium text-neutral-400">아직 분석한 기업이 없어요</p>
          <p className="text-[13px] text-neutral-300">
            AI 기업분석 메뉴에서 종목을 검색해 분석을 시작해보세요
          </p>
          <button
            onClick={() => setLocation("/analysis/new")}
            className="mt-2 px-4 py-2 rounded-md text-[13px] font-medium bg-[#1d4ed8] text-white hover:bg-blue-700 transition-colors"
          >
            분석 시작하기
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {list.map((a) => {
              const isConfirming = confirmId === a.id;
              const isThisDeleting = deletingId === a.id;
              const isLocalOnly = !serverIds.has(a.id);

              return (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: isThisDeleting ? 0.4 : 1, y: 0 }}
                  exit={{ opacity: 0, x: -24, transition: { duration: 0.22 } }}
                  transition={{ duration: 0.18 }}
                  className="group relative flex gap-4 px-5 py-4 rounded-xl border border-neutral-100 hover:border-neutral-200 hover:bg-neutral-50 transition-all cursor-pointer"
                  onClick={() => !isConfirming && !isThisDeleting && setLocation(`/analysis/${a.id}`)}
                >
                  {/* Status icon */}
                  <div className="shrink-0 pt-0.5">
                    {isThisDeleting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-neutral-300" />
                    ) : a.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400" />
                    )}
                  </div>

                  {/* Main info + memo */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[15px] font-semibold text-neutral-900 truncate">
                        {a.companyName}
                      </span>
                      <span className="text-[12px] text-neutral-400 font-mono">{a.ticker}</span>
                      {verdictBadge(a.investmentVerdict)}
                      {isLocalOnly && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-neutral-300 border border-neutral-100 rounded px-1.5 py-0.5">
                          <HistoryIcon className="w-2.5 h-2.5" /> 방문 기록
                        </span>
                      )}
                    </div>
                    {/* 메타 라인 */}
                    <div className="flex items-center gap-2 mt-1 text-[11px] text-neutral-400 flex-wrap">
                      <span>{a.industry || "—"}</span>
                      <span className="text-neutral-200">|</span>
                      <span>{format(new Date(a.createdAt), "yyyy.MM.dd", { locale: ko })}</span>
                    </div>

                    {/* 적정주가 달성 현황 */}
                    {(() => {
                      const q = quotes[a.ticker];
                      const cur = q?.price ?? null;
                      const tgt = a.targetPrice;
                      const entry = a.entryPrice;
                      const currency = q?.currency ?? (isUSTicker(a.ticker) ? "USD" : "KRW");
                      const dayChange = q?.change ?? null;
                      const isBuy = (a.investmentVerdict ?? "").toLowerCase().includes("buy");
                      const isSell = (a.investmentVerdict ?? "").toLowerCase().includes("sell");

                      if (!cur || !tgt) {
                        if (tgt) return (
                          <div className="mt-2 text-[11px] text-neutral-400">
                            적정주가 <span className="font-semibold text-neutral-600">{formatCurrency(tgt, currency)}</span>
                            <span className="text-neutral-300 ml-1.5">· 현재가 로딩 중</span>
                          </div>
                        );
                        return null;
                      }

                      const upside = ((tgt - cur) / cur) * 100;

                      // 상태 판단
                      const exceeded = isBuy ? cur >= tgt : isSell ? cur <= tgt : false;
                      const approaching = !exceeded && (isBuy ? (dayChange ?? 0) > 0 : isSell ? (dayChange ?? 0) < 0 : (dayChange ?? 0) > 0);
                      const diverging = !exceeded && !approaching && dayChange !== null;

                      let statusLabel = "";
                      let statusCls = "";
                      if (exceeded) {
                        statusLabel = "목표 돌파 ✓";
                        statusCls = "bg-emerald-100 text-emerald-700";
                      } else if (approaching) {
                        statusLabel = "목표 접근 중 ↑";
                        statusCls = "bg-blue-50 text-blue-600";
                      } else if (diverging) {
                        statusLabel = "목표 이탈 중 ↓";
                        statusCls = "bg-red-50 text-red-500";
                      } else {
                        statusLabel = `업사이드 ${upside >= 0 ? "+" : ""}${upside.toFixed(1)}%`;
                        statusCls = upside >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500";
                      }

                      // 프로그레스 바
                      let progressPct: number | null = null;
                      if (entry && tgt !== entry) {
                        progressPct = Math.min(Math.max(((cur - entry) / (tgt - entry)) * 100, 0), 100);
                      } else {
                        // entry 없으면 upside 기반으로 반대로 그려줌
                        // target 기준으로 current가 얼마나 왔는지
                        progressPct = Math.min(Math.max(100 - Math.abs(upside), 0), 100);
                      }

                      return (
                        <div className="mt-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                          {/* 가격 레일 */}
                          {entry != null && (
                            <div className="relative">
                              <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                                <motion.div
                                  className={cn("h-full rounded-full",
                                    exceeded ? "bg-emerald-500" : approaching ? "bg-blue-400" : diverging ? "bg-red-400" : "bg-neutral-300"
                                  )}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${progressPct ?? 0}%` }}
                                  transition={{ duration: 0.6, ease: "easeOut" }}
                                />
                              </div>
                              {/* 레이블 */}
                              <div className="flex justify-between mt-0.5 text-[10px]">
                                <span className="text-neutral-400">분석 시 <span className="font-medium text-neutral-500">{formatCurrency(entry, currency)}</span></span>
                                <span className="text-neutral-400">목표 <span className="font-semibold text-neutral-600">{formatCurrency(tgt, currency)}</span></span>
                              </div>
                            </div>
                          )}

                          {/* 상태 + 현재가 */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", statusCls)}>
                              {statusLabel}
                            </span>
                            <span className="text-[11px] text-neutral-500">
                              현재가 <span className="font-semibold text-neutral-700">{formatCurrency(cur, currency)}</span>
                            </span>
                            {entry == null && (
                              <span className="text-[11px] text-neutral-400">
                                목표 <span className="font-semibold text-neutral-600">{formatCurrency(tgt, currency)}</span>
                              </span>
                            )}
                            {dayChange != null && (
                              <span className={cn("text-[10px] font-medium", dayChange >= 0 ? "text-green-500" : "text-red-400")}>
                                오늘 {dayChange >= 0 ? "+" : ""}{dayChange.toFixed(2)}%
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Memo */}
                    <MemoInline id={a.id} />
                  </div>

                  {/* Right side: delete confirm or arrow */}
                  <div className="shrink-0 flex items-center gap-2 self-start pt-0.5">
                    <AnimatePresence mode="wait">
                      {isConfirming ? (
                        <motion.div
                          key="confirm"
                          initial={{ opacity: 0, scale: 0.92 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.92 }}
                          transition={{ duration: 0.12 }}
                          className="flex items-center gap-1.5"
                          onClick={cancelConfirm}
                        >
                          <span className="text-[12px] text-neutral-500 mr-0.5">삭제할까요?</span>
                          <button
                            onClick={(e) => confirmDelete(a.id, isLocalOnly, e)}
                            className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[11px] font-semibold hover:bg-red-600 transition-colors"
                          >
                            삭제
                          </button>
                          <button
                            onClick={cancelConfirm}
                            className="px-2.5 py-1 rounded-lg bg-neutral-100 text-neutral-600 text-[11px] font-semibold hover:bg-neutral-200 transition-colors"
                          >
                            취소
                          </button>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="default"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.1 }}
                          className="flex items-center gap-2"
                        >
                          <button
                            onClick={(e) => handleDelete(a.id, e)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-neutral-300 hover:text-red-400 hover:bg-red-50"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-500 transition-colors" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
