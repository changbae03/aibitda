import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import {
  Copy, Check, ChevronRight, LogOut, Loader2,
  History, Briefcase, Gift, Tag, Settings, HelpCircle,
  User, Sparkles, Shield,
} from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { motion } from "framer-motion";

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface MyPageData {
  user: {
    id: string;
    fullId: string;
    nickname: string;
    profileImage: string | null;
    email: string | null;
    loginProvider: "kakao" | "clerk";
  };
  credits: {
    dailyUsed: number;
    dailyLimit: number;
    bonusCredits: number;
    remaining: number;
    tier: string;
    totalAnalyses: number;
    joinedAt: string | null;
    referralCode: string | null;
  };
}

// ─── 상수 ────────────────────────────────────────────────────────────────────

const TIER_CONFIG: Record<string, { label: string; color: string; bgColor: string; planName: string }> = {
  free:    { label: "무료",    color: "text-slate-400",  bgColor: "bg-slate-500/15 border-slate-500/30",  planName: "무료 플랜" },
  beta:    { label: "베타",    color: "text-blue-400",   bgColor: "bg-blue-500/15 border-blue-500/30",    planName: "베타 플랜" },
  premium: { label: "프리미엄", color: "text-amber-400", bgColor: "bg-amber-500/15 border-amber-500/30",  planName: "프리미엄 플랜" },
};

const PROVIDER_CONFIG: Record<string, { label: string; color: string }> = {
  kakao:  { label: "카카오", color: "bg-[#FEE500] text-[#3A1D1D]" },
  clerk:  { label: "소셜", color: "bg-primary/15 text-primary border border-primary/30" },
};

// ─── 서브 컴포넌트 ────────────────────────────────────────────────────────────

function Avatar({ src, name, size = 64 }: { src: string | null; name: string; size?: number }) {
  const initials = name.slice(0, 1).toUpperCase();
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="rounded-full object-cover shrink-0 ring-2 ring-primary/20"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 ring-2 ring-primary/20 font-black"
      style={{
        width: size, height: size,
        background: "linear-gradient(135deg, #FF8A7A, #ff6b58)",
        fontSize: size * 0.4,
        color: "#fff",
      }}
    >
      {initials}
    </div>
  );
}

function UsageBar({ used, limit, color = "#FF8A7A" }: { used: number; limit: number; color?: string }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden mt-2">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

function MenuRow({
  icon: Icon, label, sublabel, href, onClick, destructive, extra,
}: {
  icon: React.ElementType;
  label: string;
  sublabel?: string;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  extra?: React.ReactNode;
}) {
  const inner = (
    <div className={cn(
      "flex items-center gap-3.5 px-4 py-3.5 transition-colors",
      destructive
        ? "hover:bg-red-500/5 active:bg-red-500/10"
        : "hover:bg-muted/50 active:bg-muted",
    )}>
      <div className={cn(
        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
        destructive ? "bg-red-500/10" : "bg-muted",
      )}>
        <Icon className={cn("w-4 h-4", destructive ? "text-red-400" : "text-muted-foreground")} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-[14px] font-medium", destructive ? "text-red-400" : "text-foreground")}>{label}</p>
        {sublabel && <p className="text-[11px] text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
      {extra ?? (
        href && <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
      )}
    </div>
  );

  if (href) return <Link href={href}>{inner}</Link>;
  if (onClick) return <button className="w-full text-left" onClick={onClick}>{inner}</button>;
  return inner;
}

// ─── 메인 ────────────────────────────────────────────────────────────────────

export default function MyPage() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<MyPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<"id" | "referral" | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch(getApiUrl("/api/mypage"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const copyText = (text: string, key: "id" | "referral") => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const applyPromo = async () => {
    if (!promoInput.trim() || promoLoading) return;
    setPromoLoading(true);
    setPromoMsg(null);
    try {
      const r = await fetch(getApiUrl("/api/promo/redeem"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoInput.trim().toUpperCase() }),
      });
      const d = await r.json();
      if (r.ok) {
        setPromoMsg({ type: "ok", text: d.message ?? "코드가 적용됐습니다!" });
        setPromoInput("");
        // 데이터 새로고침
        const rd = await fetch(getApiUrl("/api/mypage"), { credentials: "include" });
        if (rd.ok) setData(await rd.json());
      } else {
        setPromoMsg({ type: "err", text: d.error ?? "코드 적용에 실패했습니다" });
      }
    } catch {
      setPromoMsg({ type: "err", text: "네트워크 오류가 발생했습니다" });
    } finally {
      setPromoLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await fetch(getApiUrl("/api/auth/logout"), { method: "POST", credentials: "include" }).catch(() => {});
    window.location.href = "/";
  };

  // ── 미로그인 ─────────────────────────────────────────────────────────────
  if (!loading && !data) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold">로그인이 필요합니다</h2>
        <p className="text-sm text-muted-foreground text-center">마이페이지를 보려면 먼저 로그인해주세요</p>
        <button
          onClick={() => setLocation("/login")}
          className="px-6 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          로그인하기
        </button>
      </div>
    );
  }

  const tierCfg = TIER_CONFIG[data?.credits.tier ?? "free"] ?? TIER_CONFIG.free;
  const providerCfg = PROVIDER_CONFIG[data?.user.loginProvider ?? "kakao"] ?? PROVIDER_CONFIG.kakao;
  const dailyRemaining = data ? Math.max(0, data.credits.dailyLimit - data.credits.dailyUsed) : 0;
  const joinYear = data?.credits.joinedAt
    ? new Date(data.credits.joinedAt).getFullYear()
    : null;

  return (
    <div className="max-w-md mx-auto pb-12 space-y-3 px-0 sm:px-2">

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : data && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-3"
        >
          {/* ── 프로필 카드 ── */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-4">
              <Avatar src={data.user.profileImage} name={data.user.nickname} size={62} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-[17px] font-black text-foreground leading-tight">{data.user.nickname}</h2>
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", providerCfg.color)}>
                    {providerCfg.label}
                  </span>
                </div>
                {data.user.email && (
                  <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{data.user.email}</p>
                )}
                <div className="flex items-center gap-1 mt-1">
                  <p className="text-[11px] text-muted-foreground/50 font-mono">ID: {data.user.id}</p>
                  <button
                    onClick={() => copyText(data.user.fullId, "id")}
                    className="p-0.5 rounded hover:bg-muted transition-colors"
                  >
                    {copied === "id"
                      ? <Check className="w-3 h-3 text-green-400" />
                      : <Copy className="w-3 h-3 text-muted-foreground/40 hover:text-muted-foreground" />
                    }
                  </button>
                </div>
              </div>
            </div>
            {joinYear && (
              <p className="text-[10.5px] text-muted-foreground/40 mt-3">
                {joinYear}년부터 함께한 멤버
              </p>
            )}
          </div>

          {/* ── 사용 현황 3칸 ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden grid grid-cols-3 divide-x divide-border">
            <div className="py-4 px-2 text-center">
              <p className="text-[22px] font-black tabular-nums text-primary leading-none">{dailyRemaining}</p>
              <p className="text-[10.5px] text-muted-foreground mt-1">남은 횟수</p>
            </div>
            <div className="py-4 px-2 text-center flex flex-col items-center justify-center gap-1">
              <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full border", tierCfg.bgColor, tierCfg.color)}>
                {tierCfg.label}
              </span>
              <p className="text-[10.5px] text-muted-foreground">등급</p>
            </div>
            <div className="py-4 px-2 text-center">
              <p className="text-[22px] font-black tabular-nums text-foreground leading-none">{data.credits.totalAnalyses.toLocaleString()}</p>
              <p className="text-[10.5px] text-muted-foreground mt-1">누적 분석</p>
            </div>
          </div>

          {/* ── 사용 중인 플랜 ── */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <Shield className="w-3 h-3" />
              사용 중인 플랜
            </p>

            {/* 일일 분석 이용권 */}
            <div className="rounded-xl bg-muted/30 px-3.5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{tierCfg.planName}</span>
                  {data.credits.dailyUsed < data.credits.dailyLimit && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30">
                      사용중
                    </span>
                  )}
                </div>
                <span className="text-[12px] font-bold tabular-nums text-muted-foreground">
                  {data.credits.dailyUsed}/{data.credits.dailyLimit}회
                </span>
              </div>
              <UsageBar used={data.credits.dailyUsed} limit={data.credits.dailyLimit} />
            </div>

            {/* 보너스 크레딧 */}
            {data.credits.bonusCredits > 0 && (
              <div className="rounded-xl bg-muted/30 px-3.5 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground">보너스 크레딧</span>
                  </div>
                  <span className="text-[12px] font-bold tabular-nums text-primary">
                    {data.credits.bonusCredits}개 남음
                  </span>
                </div>
                <UsageBar
                  used={10 - data.credits.bonusCredits}
                  limit={10}
                  color="#6ee7b7"
                />
              </div>
            )}
          </div>

          {/* ── 프로모 코드 입력 (접이식) ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <button
              onClick={() => setPromoOpen(v => !v)}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-muted/50 transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <Tag className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="flex-1 text-left text-[14px] font-medium text-foreground">프로모 코드 등록</span>
              <ChevronRight className={cn("w-4 h-4 text-muted-foreground/40 transition-transform", promoOpen && "rotate-90")} />
            </button>
            {promoOpen && (
              <div className="px-4 pb-4 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={e => setPromoInput(e.target.value.toUpperCase())}
                    onKeyDown={e => e.key === "Enter" && applyPromo()}
                    placeholder="코드를 입력하세요"
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono tracking-widest uppercase"
                  />
                  <button
                    onClick={applyPromo}
                    disabled={!promoInput.trim() || promoLoading}
                    className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {promoLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "적용"}
                  </button>
                </div>
                {promoMsg && (
                  <p className={cn("text-xs px-1", promoMsg.type === "ok" ? "text-green-400" : "text-red-400")}>
                    {promoMsg.text}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── 메뉴 리스트 ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
            <MenuRow
              icon={Sparkles}
              label="AI 기업분석 시작"
              sublabel="새 보고서 생성"
              href="/analysis/new"
            />
            <MenuRow
              icon={History}
              label="내가 본 자료"
              sublabel="분석 히스토리"
              href="/history"
            />
            <MenuRow
              icon={Briefcase}
              label="내 포트폴리오"
              sublabel="보유 종목 관리"
              href="/portfolio"
            />
            {data.credits.referralCode && (
              <MenuRow
                icon={Gift}
                label="친구 초대 코드"
                sublabel={data.credits.referralCode}
                onClick={() => copyText(data.credits.referralCode!, "referral")}
                extra={
                  <div className="flex items-center gap-1.5">
                    {copied === "referral" && (
                      <span className="text-[11px] text-green-400 font-medium">복사됨</span>
                    )}
                    {copied === "referral"
                      ? <Check className="w-4 h-4 text-green-400 shrink-0" />
                      : <Copy className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                    }
                  </div>
                }
              />
            )}
            <MenuRow
              icon={HelpCircle}
              label="고객 문의"
              href="/support"
            />
            <MenuRow
              icon={Settings}
              label="설정"
              sublabel="닉네임·테마·언어"
              href="/settings"
            />
          </div>

          {/* ── 로그아웃 ── */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <MenuRow
              icon={LogOut}
              label="로그아웃"
              onClick={handleLogout}
              destructive
              extra={loggingOut ? <Loader2 className="w-4 h-4 animate-spin text-red-400" /> : undefined}
            />
          </div>

          {/* 버전 */}
          <p className="text-center text-[10.5px] text-muted-foreground/30 pt-1">
            애빛다 · AI로 기업가치를 밝히다
          </p>
        </motion.div>
      )}
    </div>
  );
}
