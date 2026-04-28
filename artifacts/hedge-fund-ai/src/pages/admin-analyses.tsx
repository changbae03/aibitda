import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  FileText, Search, TrendingUp, TrendingDown, Minus,
  Clock, CheckCircle2, XCircle, Loader2, ChevronLeft, ChevronRight, User,
} from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { ko } from "date-fns/locale";

interface AnalysisRow {
  id: number;
  ticker: string;
  company_name: string;
  english_name: string | null;
  investment_verdict: string | null;
  target_price: number | null;
  start_price: number | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  industry: string | null;
  current_step: string | null;
  user_display_name: string | null;
  user_email: string | null;
}

interface ReportResponse {
  data: AnalysisRow[];
  total: number;
  limit: number;
  offset: number;
}

const VERDICT_MAP: Record<string, { label: string; color: string }> = {
  strong_buy: { label: "강력매수", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  buy:        { label: "매수",     color: "text-blue-700 bg-blue-50 border-blue-200" },
  hold:       { label: "보유",     color: "text-amber-700 bg-amber-50 border-amber-200" },
  sell:       { label: "매도",     color: "text-red-600 bg-red-50 border-red-200" },
  strong_sell:{ label: "강력매도", color: "text-red-700 bg-red-50 border-red-200" },
};

const STEP_LABEL: Record<string, string> = {
  company_intro: "기업 브리핑",
  industry_analysis: "산업 분석",
  financial_analysis: "재무 분석",
  valuation: "적정주가 산출",
  technical_analysis: "기술적 분석",
  risk_analysis: "리스크 분석",
  investment_thesis: "종합 의견",
};

const PAGE_SIZE = 50;

function useAllReports(page: number, status: string, search: string) {
  return useQuery<ReportResponse>({
    queryKey: ["admin-all-reports", page, status, search],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (status && status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      const res = await fetch(getApiUrl(`/api/analysis/all-reports?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 1000 * 30,
  });
}

export default function AdminAnalyses() {
  const [, setLocation] = useLocation();
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const { data, isLoading, isFetching } = useAllReports(page, statusFilter, search);

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(0);
  }

  function handleStatusChange(s: string) {
    setStatusFilter(s);
    setPage(0);
  }

  function upside(row: AnalysisRow) {
    if (!row.target_price || !row.start_price) return null;
    return ((row.target_price - row.start_price) / row.start_price) * 100;
  }

  return (
    <div className="space-y-4 pb-10">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">전체 보고서 목록</h1>
          <p className="text-[12px] text-muted-foreground">
            {data ? `총 ${data.total.toLocaleString()}건` : "로딩 중..."}
          </p>
        </div>
      </div>

      {/* 필터 & 검색 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 bg-muted rounded-lg p-0.5">
          {[
            { value: "all", label: "전체" },
            { value: "completed", label: "완료" },
            { value: "in_progress", label: "진행중" },
            { value: "failed", label: "실패" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleStatusChange(opt.value)}
              className={cn(
                "text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors",
                statusFilter === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex gap-1.5 flex-1 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="종목명·코드 검색"
              className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-[12px] font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            검색
          </button>
        </form>
      </div>

      {/* 테이블 (데스크톱) / 카드 목록 (모바일) */}
      <div className="rounded-xl border border-border bg-background overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">불러오는 중...</span>
          </div>
        ) : !data?.data.length ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
            해당하는 보고서가 없습니다.
          </div>
        ) : (
          <>
            {/* ─── 데스크톱 테이블 (md 이상) ─── */}
            <div className={cn("hidden md:block", isFetching && "opacity-60 pointer-events-none")}>
              <div className="grid grid-cols-[2rem_1fr_6rem_5.5rem_5.5rem_5rem_7rem] gap-x-3 px-4 py-2.5 border-b border-border bg-muted/40">
                {["#", "기업", "상태", "투자의견", "목표가", "상승여력", "분석일시"].map((h) => (
                  <span key={h} className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide truncate">
                    {h}
                  </span>
                ))}
              </div>
              <div className="divide-y divide-border/60">
                {data.data.map((row) => {
                  const verdict = row.investment_verdict ? VERDICT_MAP[row.investment_verdict] : null;
                  const up = upside(row);
                  const isCompleted = row.status === "completed";
                  const isInProgress = row.status === "in_progress";

                  return (
                    <div
                      key={row.id}
                      onClick={() => setLocation(`/analysis/${row.id}`)}
                      className="grid grid-cols-[2rem_1fr_6rem_5.5rem_5.5rem_5rem_7rem] gap-x-3 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors items-center"
                    >
                      <span className="text-[11px] font-mono text-muted-foreground/60">{row.id}</span>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[13px] font-semibold text-foreground truncate">{row.company_name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{row.ticker}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {row.user_display_name ? (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <User className="w-3 h-3" />
                              {row.user_display_name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/40">익명</span>
                          )}
                          {row.industry && (
                            <span className="text-[10px] text-muted-foreground/50 truncate">{row.industry}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {isCompleted ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        ) : isInProgress ? (
                          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                        )}
                        <span className="text-[11px] text-muted-foreground truncate">
                          {isCompleted ? "완료" : isInProgress
                            ? (STEP_LABEL[row.current_step ?? ""] ?? "진행중")
                            : "실패"}
                        </span>
                      </div>

                      <div>
                        {verdict ? (
                          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", verdict.color)}>
                            {verdict.label}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40">—</span>
                        )}
                      </div>

                      <div className="text-right">
                        {row.target_price != null ? (
                          <span className="text-[12px] font-bold tabular-nums text-foreground">
                            {formatCurrency(row.target_price, row.ticker.includes(".") ? undefined : "KRW").replace("₩", "")}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40">—</span>
                        )}
                      </div>

                      <div className="text-right">
                        {up != null ? (
                          <span className={cn(
                            "text-[12px] font-bold tabular-nums",
                            up >= 0 ? "text-red-500" : "text-blue-500"
                          )}>
                            {up >= 0 ? "+" : ""}{up.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground/40">—</span>
                        )}
                      </div>

                      <div className="text-right">
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {format(parseISO(row.created_at), "MM.dd HH:mm", { locale: ko })}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ─── 모바일 카드 목록 (md 미만) ─── */}
            <div className={cn("md:hidden divide-y divide-border/60", isFetching && "opacity-60 pointer-events-none")}>
              {data.data.map((row) => {
                const verdict = row.investment_verdict ? VERDICT_MAP[row.investment_verdict] : null;
                const up = upside(row);
                const isCompleted = row.status === "completed";
                const isInProgress = row.status === "in_progress";

                return (
                  <div
                    key={row.id}
                    onClick={() => setLocation(`/analysis/${row.id}`)}
                    className="px-4 py-3.5 hover:bg-muted/30 cursor-pointer transition-colors active:bg-muted/50"
                  >
                    {/* 상단: 기업명 + 상태 */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-semibold text-foreground truncate">{row.company_name}</span>
                          <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{row.ticker}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {row.user_display_name ? (
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <User className="w-3 h-3" />
                              {row.user_display_name}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground/40">익명</span>
                          )}
                          {row.industry && (
                            <span className="text-[10px] text-muted-foreground/50 truncate max-w-[100px]">{row.industry}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isCompleted ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        ) : isInProgress ? (
                          <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-400" />
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {isCompleted ? "완료" : isInProgress
                            ? (STEP_LABEL[row.current_step ?? ""] ?? "진행중")
                            : "실패"}
                        </span>
                      </div>
                    </div>

                    {/* 하단: 투자의견 + 목표가 + 상승여력 + 날짜 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {verdict ? (
                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", verdict.color)}>
                          {verdict.label}
                        </span>
                      ) : null}
                      {row.target_price != null && (
                        <span className="text-[11px] font-bold tabular-nums text-foreground">
                          {formatCurrency(row.target_price, row.ticker.includes(".") ? undefined : "KRW").replace("₩", "")}
                        </span>
                      )}
                      {up != null && (
                        <span className={cn(
                          "text-[11px] font-bold tabular-nums",
                          up >= 0 ? "text-red-500" : "text-blue-500"
                        )}>
                          {up >= 0 ? "+" : ""}{up.toFixed(1)}%
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/60 ml-auto tabular-nums">
                        {format(parseISO(row.created_at), "MM.dd HH:mm", { locale: ko })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-lg border border-border bg-background hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            이전
          </button>
          <span className="text-[12px] text-muted-foreground tabular-nums">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium rounded-lg border border-border bg-background hover:bg-muted/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            다음
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
