import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/lib/language-context";
import { LayoutGrid, Search, User, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { cn, getApiUrl, formatCurrency } from "@/lib/utils";

interface Holding {
  id: number;
  ticker: string;
  companyName: string;
  avgPrice: number | null;
  quantity: number | null;
  currency: string;
  note: string | null;
  addedAt: string;
}

interface UserPortfolio {
  userId: string;
  displayName: string | null;
  email: string | null;
  holdings: Holding[];
}

interface AdminPortfolioResponse {
  users: UserPortfolio[];
  totalUsers: number;
  totalHoldings: number;
}

function safeDate(str: string | null | undefined) {
  if (!str) return "—";
  try {
    return new Date(str).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function useAdminPortfolios(search: string) {
  return useQuery<AdminPortfolioResponse>({
    queryKey: ["admin-portfolios", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const res = await fetch(getApiUrl(`/api/portfolio/admin/all?${params}`), { credentials: "include" });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    staleTime: 1000 * 30,
  });
}

export default function AdminPortfolios() {
  const { isEn } = useLanguage();
  const t = (kr: string, en: string) => isEn ? en : kr;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data, isLoading, isError } = useAdminPortfolios(search);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
  }

  function toggle(userId: string) {
    setExpanded((prev) => ({ ...prev, [userId]: !prev[userId] }));
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <LayoutGrid className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">{t("유저 포트폴리오", "User Portfolios")}</h1>
          <p className="text-[12px] text-muted-foreground">
            {data
              ? t(`${data.totalUsers}명 · 종목 ${data.totalHoldings}개`, `${data.totalUsers} users · ${data.totalHoldings} holdings`)
              : t("로딩 중...", "Loading...")}
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-1.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("유저명·이메일·종목 검색", "Search user or ticker")}
            className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <button
          type="submit"
          className="px-3 py-1.5 text-[12px] font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          {t("검색", "Search")}
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearch(""); setSearchInput(""); }}
            className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-border bg-background hover:bg-muted/50 transition-colors"
          >
            {t("초기화", "Clear")}
          </button>
        )}
      </form>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">{t("불러오는 중...", "Loading...")}</span>
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-24 text-red-400 text-sm">
          {t("데이터를 불러오지 못했습니다. 관리자 권한을 확인하세요.", "Failed to load. Check admin permissions.")}
        </div>
      ) : !data?.users.length ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground text-sm">
          {t("포트폴리오를 등록한 유저가 없습니다.", "No portfolios found.")}
        </div>
      ) : (
        <div className="space-y-2">
          {data.users.map((user) => {
            const isOpen = expanded[user.userId] ?? true;
            const totalKRW = user.holdings
              .filter((h) => h.currency === "KRW" && h.avgPrice != null && h.quantity != null)
              .reduce((acc, h) => acc + (Number(h.avgPrice) * Number(h.quantity)), 0);

            return (
              <div key={user.userId} className="rounded-xl border border-border bg-background overflow-hidden">
                {/* User header */}
                <button
                  onClick={() => toggle(user.userId)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground truncate">
                        {user.displayName ?? t("이름 없음", "Unknown")}
                      </span>
                      {user.email && (
                        <span className="text-[11px] text-muted-foreground truncate">{user.email}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">
                        {t(`${user.holdings.length}종목`, `${user.holdings.length} holdings`)}
                      </span>
                      {totalKRW > 0 && (
                        <span className="text-[11px] text-muted-foreground">
                          {t("평가금액", "Value")} {formatCurrency(totalKRW, "KRW")}
                        </span>
                      )}
                    </div>
                  </div>
                  {isOpen
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {/* Holdings table */}
                {isOpen && (
                  <div className="border-t border-border">
                    {/* Desktop */}
                    <div className="hidden md:block">
                      <div className="grid grid-cols-[1fr_4rem_5rem_5rem_5rem_7rem] gap-x-3 px-4 py-2 bg-muted/40 border-b border-border">
                        {[
                          t("종목", "Company"),
                          t("코드", "Ticker"),
                          t("평단가", "Avg Price"),
                          t("수량", "Qty"),
                          t("평가금액", "Value"),
                          t("추가일", "Added"),
                        ].map((h) => (
                          <span key={h} className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide truncate">
                            {h}
                          </span>
                        ))}
                      </div>
                      <div className="divide-y divide-border/50">
                        {user.holdings.map((h) => {
                          const value = h.avgPrice != null && h.quantity != null
                            ? Number(h.avgPrice) * Number(h.quantity)
                            : null;
                          return (
                            <div
                              key={h.id}
                              className="grid grid-cols-[1fr_4rem_5rem_5rem_5rem_7rem] gap-x-3 px-4 py-2.5 items-center"
                            >
                              <div className="min-w-0">
                                <div className="text-[12px] font-medium text-foreground truncate">{h.companyName}</div>
                                {h.note && (
                                  <div className="text-[10px] text-muted-foreground/60 truncate">{h.note}</div>
                                )}
                              </div>
                              <span className="text-[11px] font-mono text-muted-foreground truncate">{h.ticker}</span>
                              <span className="text-[12px] tabular-nums text-foreground">
                                {h.avgPrice != null
                                  ? formatCurrency(Number(h.avgPrice), h.currency).replace("₩", "").replace("$", "")
                                  : "—"}
                              </span>
                              <span className="text-[12px] tabular-nums text-foreground">
                                {h.quantity != null ? Number(h.quantity).toLocaleString() : "—"}
                              </span>
                              <span className={cn("text-[12px] tabular-nums font-medium", value != null ? "text-foreground" : "text-muted-foreground/40")}>
                                {value != null ? formatCurrency(value, h.currency).replace("₩", "").replace("$", "") : "—"}
                              </span>
                              <span className="text-[10px] text-muted-foreground/60 tabular-nums">{safeDate(h.addedAt)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Mobile */}
                    <div className="md:hidden divide-y divide-border/50">
                      {user.holdings.map((h) => {
                        const value = h.avgPrice != null && h.quantity != null
                          ? Number(h.avgPrice) * Number(h.quantity)
                          : null;
                        return (
                          <div key={h.id} className="px-4 py-3 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold text-foreground truncate">{h.companyName}</span>
                                <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">{h.ticker}</span>
                              </div>
                              {h.note && (
                                <div className="text-[10px] text-muted-foreground/60 truncate">{h.note}</div>
                              )}
                              <div className="text-[10px] text-muted-foreground/50 mt-0.5">{safeDate(h.addedAt)}</div>
                            </div>
                            <div className="text-right shrink-0">
                              {h.avgPrice != null && (
                                <div className="text-[12px] tabular-nums text-foreground">
                                  {formatCurrency(Number(h.avgPrice), h.currency)}
                                </div>
                              )}
                              {value != null && (
                                <div className="text-[11px] tabular-nums text-muted-foreground">
                                  {h.quantity != null ? `${Number(h.quantity).toLocaleString()}주` : ""}{" "}
                                  {formatCurrency(value, h.currency)}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
