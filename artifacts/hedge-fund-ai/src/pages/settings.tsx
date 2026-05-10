import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Monitor, Moon, Sun, Check, LogOut, User, Zap, Shield, MessageSquare, Send, ChevronDown, Trash2, Tag, Loader2, Globe } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";
import { motion, AnimatePresence } from "framer-motion";

const themes = [
  {
    value: "light",
    label: "라이트",
    icon: Sun,
    preview: {
      bg: "bg-white",
      sidebar: "bg-neutral-100",
      line: "bg-neutral-200",
    },
  },
  {
    value: "dark",
    label: "다크",
    icon: Moon,
    preview: {
      bg: "bg-[#0f172a]",
      sidebar: "bg-[#1e293b]",
      line: "bg-[#334155]",
    },
  },
  {
    value: "system",
    label: "시스템",
    icon: Monitor,
    preview: {
      bg: "bg-gradient-to-br from-white to-[#0f172a]",
      sidebar: "bg-gradient-to-b from-neutral-100 to-[#1e293b]",
      line: "bg-gradient-to-r from-neutral-200 to-[#334155]",
    },
  },
] as const;

const FEEDBACK_CATEGORIES = [
  { value: "분석 품질", label: "분석 품질" },
  { value: "UI/UX", label: "UI/UX" },
  { value: "기능 오류", label: "기능 오류" },
  { value: "기능 제안", label: "기능 제안" },
  { value: "기타", label: "기타" },
];

interface AuthUser {
  id: string;
  nickname: string;
  profileImage: string | null;
  displayName: string | null;
}

interface CreditStatus {
  dailyUsed: number;
  dailyLimit: number;
  bonusCredits: number;
  remaining: number;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest mb-3 px-1">{title}</h2>
      <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
        {children}
      </div>
    </section>
  );
}

function Row({ label, children, className }: { label?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between px-4 py-3.5 gap-4", className)}>
      {label && <span className="text-[13.5px] text-foreground/80 font-medium shrink-0">{label}</span>}
      <div className="flex-1 flex justify-end">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [, setLocation] = useLocation();
  const [mounted, setMounted] = useState(false);
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [credits, setCredits] = useState<CreditStatus | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [nicknameInput, setNicknameInput] = useState("");
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameMsg, setNicknameMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [fbCategory, setFbCategory] = useState("기타");
  const [fbContent, setFbContent] = useState("");
  const [fbSubmitting, setFbSubmitting] = useState(false);
  const [fbDone, setFbDone] = useState(false);
  const [fbError, setFbError] = useState("");
  const [showCatMenu, setShowCatMenu] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteInputRef = useRef<HTMLInputElement>(null);

  const [promoCode, setPromoCode] = useState("");
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoResult, setPromoResult] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const { language, setLanguage: ctxSetLanguage, isEn } = useLanguage();
  const [langSaving, setLangSaving] = useState(false);
  const [langMsg, setLangMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    fetch(getApiUrl("/api/auth/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const u = d?.user ?? null;
        setUser(u);
        if (u?.displayName) setNicknameInput(u.displayName);
      })
      .catch(() => setUser(null));

    fetch(getApiUrl("/api/credits"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setCredits(d))
      .catch(() => {});

    fetch(getApiUrl("/api/admin/me"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.isAdmin) setIsAdmin(true); })
      .catch(() => {});

  }, []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch(getApiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
      window.location.href = "/";
    } finally {
      setLoggingOut(false);
    }
  };

  const saveNickname = async () => {
    if (nicknameSaving) return;
    setNicknameSaving(true);
    try {
      const r = await fetch(getApiUrl("/api/profile"), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: nicknameInput }),
      });
      const d = await r.json();
      if (r.ok) {
        setUser(prev => prev ? { ...prev, displayName: d.displayName } : prev);
        setNicknameMsg({ type: "ok", text: isEn ? "Display name saved" : "닉네임이 저장됐습니다" });
      } else {
        setNicknameMsg({ type: "err", text: d.error ?? (isEn ? "Failed to save" : "저장에 실패했습니다") });
      }
    } catch {
      setNicknameMsg({ type: "err", text: isEn ? "Network error" : "네트워크 오류가 발생했습니다" });
    } finally {
      setNicknameSaving(false);
      setTimeout(() => setNicknameMsg(null), 3000);
    }
  };

  const applyPromo = async () => {
    const code = promoCode.trim();
    if (!code || promoApplying) return;
    setPromoApplying(true);
    setPromoResult(null);
    try {
      const r = await fetch(getApiUrl("/api/credits/promo"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      if (r.ok) {
        setPromoResult({ type: "ok", text: d.message ?? "코드가 적용됐습니다!" });
        setPromoCode("");
        // 크레딧 갱신
        fetch(getApiUrl("/api/credits"), { credentials: "include" })
          .then(res => res.ok ? res.json() : null)
          .then(data => setCredits(data))
          .catch(() => {});
      } else {
        setPromoResult({ type: "err", text: d.error ?? (isEn ? "Failed to apply code" : "코드 적용에 실패했습니다") });
      }
    } catch {
      setPromoResult({ type: "err", text: "네트워크 오류가 발생했습니다" });
    } finally {
      setPromoApplying(false);
      setTimeout(() => setPromoResult(null), 5000);
    }
  };

  const openDeleteModal = () => {
    setDeleteInput("");
    setDeleteError("");
    setShowDeleteModal(true);
    setTimeout(() => deleteInputRef.current?.focus(), 100);
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== "탈퇴" || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const r = await fetch(getApiUrl("/api/profile/account"), {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        window.location.href = "/";
      } else {
        const d = await r.json().catch(() => ({}));
        setDeleteError(d.error ?? "탈퇴 처리 중 오류가 발생했습니다.");
      }
    } catch {
      setDeleteError("네트워크 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const saveLanguage = async (lang: "ko" | "en") => {
    if (langSaving) return;
    setLangSaving(true);
    setLangMsg(null);
    try {
      await ctxSetLanguage(lang);
      setLangMsg({ type: "ok", text: lang === "en" ? "English mode enabled. New analyses will be written in English." : "한국어 모드로 변경됐습니다. 새 분석부터 적용됩니다." });
    } catch {
      setLangMsg({ type: "err", text: isEn ? "Failed to save" : "저장에 실패했습니다" });
    } finally {
      setLangSaving(false);
      setTimeout(() => setLangMsg(null), 4000);
    }
  };

  const handleFeedbackSubmit = async () => {
    if (fbSubmitting || fbDone) return;
    if (fbContent.trim().length < 5) {
      setFbError("5자 이상 입력해주세요.");
      return;
    }
    setFbError("");
    setFbSubmitting(true);
    try {
      const r = await fetch(getApiUrl("/api/feedback"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: fbCategory, content: fbContent.trim() }),
      });
      if (r.ok) {
        setFbDone(true);
        setFbContent("");
      } else {
        const d = await r.json().catch(() => ({}));
        setFbError(d.error ?? (isEn ? "Failed to send. Please try again." : "전송에 실패했습니다. 다시 시도해주세요."));
      }
    } catch {
      setFbError(isEn ? "Network error. Please try again." : "네트워크 오류가 발생했습니다.");
    } finally {
      setFbSubmitting(false);
    }
  };

  const dailyUsed = credits?.dailyUsed ?? 0;
  const dailyLimit = credits?.dailyLimit ?? 3;
  const usagePct = Math.min(100, (dailyUsed / dailyLimit) * 100);

  const t = (ko: string, en: string) => isEn ? en : ko;

  return (
    <div className="max-w-xl space-y-8 pb-20">
      <div>
        <h1 className="text-xl font-bold text-foreground">{t("설정", "Settings")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("계정 및 앱 환경을 관리합니다", "Manage your account and app settings")}</p>
      </div>

      {/* ── 계정 ── */}
      <Section title={t("계정", "Account")}>
        {user === undefined ? (
          <Row>
            <div className="h-4 w-32 bg-muted animate-pulse rounded" />
          </Row>
        ) : user ? (
          <>
            <div className="flex items-center gap-3 px-4 py-4">
              {user.profileImage ? (
                <img src={user.profileImage} alt="" className="w-10 h-10 rounded-full object-cover border border-border" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-foreground truncate">
                  {user.displayName ?? user.nickname}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {user.displayName && (
                    <span className="text-[11px] text-muted-foreground">{isEn ? `Kakao: ${user.nickname}` : `카카오: ${user.nickname}`}</span>
                  )}
                  {!user.displayName && (
                    <span className="text-[11px] text-muted-foreground">{t("카카오 로그인", "Kakao Login")}</span>
                  )}
                  {isAdmin && (
                    <span className="flex items-center gap-0.5 text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                      <Shield className="w-2.5 h-2.5" />{t("관리자", "Admin")}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 닉네임 설정 */}
            <div className="px-4 py-3.5 space-y-2.5 border-t border-border">
              <p className="text-[12px] font-medium text-foreground/70">{t("닉네임 설정", "Display Name")}</p>
              <p className="text-[11px] text-muted-foreground/60">{t("카카오 이름 대신 서비스 내에서 사용할 이름을 설정합니다. 최대 20자.", "Set a custom name to use in the app instead of your Kakao name. Max 20 chars.")}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nicknameInput}
                  onChange={e => setNicknameInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && saveNickname()}
                  placeholder={user.nickname}
                  maxLength={20}
                  className="flex-1 px-3 py-2 text-[13px] bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={saveNickname}
                  disabled={nicknameSaving}
                  className="px-3 py-2 rounded-lg bg-primary text-white text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-1.5 shrink-0"
                >
                  {nicknameSaving ? (
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                      className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
                  ) : <Check className="w-3.5 h-3.5" />}
                  {t("저장", "Save")}
                </button>
              </div>
              {nicknameMsg && (
                <p className={cn("text-[12px]", nicknameMsg.type === "ok" ? "text-emerald-600" : "text-red-500")}>
                  {nicknameMsg.text}
                </p>
              )}
            </div>

            <Row>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex items-center gap-2 text-[13px] font-medium text-red-500 hover:text-red-600 transition-colors disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                {loggingOut ? t("로그아웃 중...", "Signing out...") : t("로그아웃", "Sign Out")}
              </button>
            </Row>
          </>
        ) : (
          <Row>
            <button
              onClick={() => setLocation("/login")}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              {t("카카오로 로그인하기 →", "Sign in with Kakao →")}
            </button>
          </Row>
        )}
      </Section>

      {/* ── 오늘의 분석 현황 ── */}
      {user && credits && (
        <Section title={t("오늘의 분석 현황", "Today's Usage")}>
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-[13px] font-medium text-foreground">
                  {isAdmin
                    ? t("무제한 (관리자)", "Unlimited (Admin)")
                    : isEn ? `Used ${dailyUsed} / ${dailyLimit} today` : `오늘 ${dailyUsed}회 사용 / ${dailyLimit}회`}
                </span>
              </div>
              {!isAdmin && (
                <span className={cn(
                  "text-[12px] font-semibold",
                  credits.remaining === 0 ? "text-red-500" : credits.remaining <= 1 ? "text-amber-500" : "text-emerald-600"
                )}>
                  {isEn ? `${credits.remaining} left` : `${credits.remaining}회 남음`}
                </span>
              )}
            </div>
            {!isAdmin && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <motion.div
                  className={cn(
                    "h-full rounded-full",
                    usagePct >= 100 ? "bg-red-500" : usagePct >= 66 ? "bg-amber-400" : "bg-emerald-500"
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${usagePct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            )}
            <p className="text-[11px] text-muted-foreground/60">
              {isAdmin
                ? t("관리자 계정은 분석 횟수 제한이 없습니다.", "Admin accounts have unlimited analyses.")
                : t("매일 자정(KST) 기준으로 횟수가 초기화됩니다.", "Resets daily at midnight KST.")}
            </p>
          </div>
        </Section>
      )}

      {/* ── 프로모 코드 ── */}
      {user && (
        <Section title={t("프로모 코드", "Promo Code")}>
          <div className="px-4 py-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">
              {t("프로모 코드를 입력하면 크레딧 추가 또는 등급 업그레이드 혜택을 받을 수 있습니다.", "Enter a promo code to receive bonus credits or a tier upgrade.")}
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={promoCode}
                  onChange={e => setPromoCode(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === "Enter" && applyPromo()}
                  placeholder={t("코드 입력 (예: AIVIT2026)", "Enter code (e.g. AIVIT2026)")}
                  className="w-full pl-9 pr-3 py-2.5 text-[13px] font-mono rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 placeholder:text-muted-foreground/40 uppercase tracking-widest"
                />
              </div>
              <button
                onClick={applyPromo}
                disabled={!promoCode.trim() || promoApplying}
                className={cn(
                  "px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-all shrink-0",
                  promoCode.trim() && !promoApplying
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {promoApplying ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : t("적용", "Apply")}
              </button>
            </div>
            <AnimatePresence>
              {promoResult && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    "flex items-center gap-2 text-[12px] font-medium px-3 py-2 rounded-lg",
                    promoResult.type === "ok"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                      : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                  )}
                >
                  {promoResult.type === "ok"
                    ? <Check className="w-3.5 h-3.5 shrink-0" />
                    : <span className="shrink-0">✕</span>
                  }
                  {promoResult.text}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Section>
      )}

      {/* ── 언어 / Language ── */}
      <Section title="언어 / Language">
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-primary" />
            <p className="text-[13px] font-medium text-foreground">{t("분석 리포트 언어", "Analysis Report Language")}</p>
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            {t("영어(English) 선택 시 새로 시작하는 분석 리포트가 전체 영어로 작성됩니다. 기존 분석에는 영향을 주지 않습니다.", "Choosing English will write all new analysis reports in English. Existing reports are not affected.")}
          </p>
          <div className="grid grid-cols-2 gap-2.5">
            {(["ko", "en"] as const).map((lang) => {
              const isSelected = language === lang;
              return (
                <motion.button
                  key={lang}
                  onClick={() => saveLanguage(lang)}
                  disabled={langSaving}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    "relative flex flex-col items-center gap-1.5 p-3.5 rounded-xl border-2 transition-all duration-200 disabled:opacity-50",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40 hover:bg-accent/50"
                  )}
                >
                  <span className="text-2xl">{lang === "ko" ? "🇰🇷" : "🇺🇸"}</span>
                  <span className={cn("text-[13px] font-semibold", isSelected ? "text-foreground" : "text-muted-foreground")}>
                    {lang === "ko" ? "한국어" : "English"}
                  </span>
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-primary-foreground" />
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
          {langMsg && (
            <p className={cn("text-[12px]", langMsg.type === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
              {langMsg.text}
            </p>
          )}
        </div>
      </Section>

      {/* ── 테마 ── */}
      <Section title={t("테마", "Theme")}>
        <div className="px-4 py-4">
          <div className="grid grid-cols-3 gap-2.5">
            {themes.map((t) => {
              const isSelected = mounted && theme === t.value;
              const Icon = t.icon;
              return (
                <motion.button
                  key={t.value}
                  onClick={() => setTheme(t.value)}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    "relative flex flex-col items-center gap-2.5 p-3 rounded-xl border-2 transition-all duration-200",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40 hover:bg-accent/50"
                  )}
                >
                  <div className="w-full h-12 rounded-lg overflow-hidden border border-border/50 flex">
                    <div className={cn("w-5 h-full", t.preview.sidebar)} />
                    <div className={cn("flex-1 p-1.5 flex flex-col gap-1", t.preview.bg)}>
                      <div className={cn("h-1 w-3/4 rounded-full", t.preview.line)} />
                      <div className={cn("h-1 w-1/2 rounded-full", t.preview.line)} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("w-3.5 h-3.5", isSelected ? "text-primary" : "text-muted-foreground")} />
                    <span className={cn("text-[12px] font-semibold", isSelected ? "text-foreground" : "text-muted-foreground")}>
                      {t.label}
                    </span>
                  </div>
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-primary-foreground" />
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground/60 mt-3">
            {mounted && theme === "system"
              ? t("OS의 다크/라이트 설정을 자동으로 따릅니다.", "Follows your OS dark/light setting.")
              : mounted && theme === "dark"
              ? t("다크 모드가 활성화되어 있습니다.", "Dark mode is active.")
              : t("라이트 모드가 활성화되어 있습니다.", "Light mode is active.")}
          </p>
        </div>
      </Section>

      {/* ── 피드백 보내기 ── */}
      <Section title={t("피드백", "Feedback")}>
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-primary" />
            <p className="text-[13px] font-medium text-foreground">{t("의견 보내기", "Send Feedback")}</p>
          </div>
          <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
            {t("분석 품질, 불편한 점, 기능 제안 등 무엇이든 알려주세요. 서비스 개선에 반영됩니다.", "Tell us anything — analysis quality, issues, or feature requests. We read every message.")}
          </p>

          <AnimatePresence mode="wait">
            {fbDone ? (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-2 py-6"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-[13px] font-semibold text-foreground">{t("의견을 전달했습니다", "Feedback sent!")}</p>
                <p className="text-[12px] text-muted-foreground">{t("소중한 피드백 감사합니다.", "Thank you for your feedback.")}</p>
                <button
                  onClick={() => setFbDone(false)}
                  className="mt-1 text-[12px] text-primary hover:underline"
                >
                  {t("다시 보내기", "Send another")}
                </button>
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5">
                {/* 카테고리 선택 */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowCatMenu((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-background text-[13px] text-foreground hover:border-primary/50 transition-colors"
                  >
                    <span>{fbCategory}</span>
                    <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", showCatMenu && "rotate-180")} />
                  </button>
                  <AnimatePresence>
                    {showCatMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-10 top-full mt-1 left-0 right-0 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
                      >
                        {FEEDBACK_CATEGORIES.map((c) => (
                          <button
                            key={c.value}
                            type="button"
                            onClick={() => { setFbCategory(c.value); setShowCatMenu(false); }}
                            className={cn(
                              "w-full text-left px-3 py-2.5 text-[13px] hover:bg-accent transition-colors",
                              fbCategory === c.value ? "font-semibold text-primary" : "text-foreground"
                            )}
                          >
                            {c.label}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* 내용 입력 */}
                <textarea
                  value={fbContent}
                  onChange={(e) => { setFbContent(e.target.value); if (fbError) setFbError(""); }}
                  placeholder={t("불편한 점, 개선 아이디어, 칭찬 등 자유롭게 작성해주세요...", "Share any issues, ideas, or praise...")}
                  rows={4}
                  maxLength={2000}
                  className="w-full text-[13px] text-foreground placeholder:text-muted-foreground/50 bg-background border border-border rounded-lg px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all leading-relaxed"
                />

                {fbError && (
                  <p className="text-[12px] text-red-500">{fbError}</p>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground/50">{fbContent.length} / 2000</span>
                  <button
                    onClick={handleFeedbackSubmit}
                    disabled={fbSubmitting || fbContent.trim().length < 5}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all",
                      fbContent.trim().length >= 5 && !fbSubmitting
                        ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    {fbSubmitting ? (
                      <>
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                          className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full"
                        />
                        {t("전송 중", "Sending...")}
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        {t("보내기", "Send")}
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Section>

      {/* ── 서비스 정보 ── */}
      <Section title={t("서비스 정보", "About")}>
        <Row label={t("서비스", "Service")}>
          <span className="text-[13px] text-muted-foreground">애빛다 · CBST</span>
        </Row>
        <Row label={t("버전", "Version")}>
          <span className="text-[13px] text-muted-foreground font-mono">
            v{__APP_VERSION__}
            <span className="ml-1.5 text-[11px] text-muted-foreground/60">({__BUILD_DATE__})</span>
          </span>
        </Row>
        <Row label={t("문의", "Contact")}>
          <a href="mailto:support@cbst.ai" className="text-[13px] text-primary hover:underline">
            support@cbst.ai
          </a>
        </Row>
      </Section>

      {/* ── 계정 탈퇴 ── */}
      {user && (
        <Section title={t("위험 구역", "Danger Zone")}>
          <div className="px-4 py-4 space-y-2">
            <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
              {t("탈퇴하면 모든 분석 내역과 계정 정보가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.", "Deleting your account will permanently remove all analyses and account data. This cannot be undone.")}
            </p>
            <button
              onClick={openDeleteModal}
              className="flex items-center gap-2 text-[13px] font-medium text-red-500 hover:text-red-600 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("계정 탈퇴", "Delete Account")}
            </button>
          </div>
        </Section>
      )}

      {/* ── 탈퇴 확인 모달 ── */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            key="delete-modal-bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.18 }}
              className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-5 space-y-4">
                {/* 경고 아이콘 */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                    <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                  </div>
                  <div>
                    <p className="text-[14px] font-bold text-foreground">{t("정말 탈퇴하시겠습니까?", "Delete your account?")}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{t("이 작업은 되돌릴 수 없습니다", "This action cannot be undone")}</p>
                  </div>
                </div>

                {/* 안내 */}
                <ul className="text-[12px] text-muted-foreground space-y-1 list-disc list-inside bg-muted/50 rounded-lg px-3 py-2.5">
                  <li>{t("모든 분석 리포트 및 내역 삭제", "All analysis reports and history")}</li>
                  <li>{t("계정 정보 및 크레딧 삭제", "Account info and credits")}</li>
                  <li>{t("추천인 코드 및 보너스 삭제", "Referral codes and bonuses")}</li>
                </ul>

                {/* 확인 입력 */}
                <div className="space-y-1.5">
                  <p className="text-[12px] text-foreground/70">
                    {isEn ? <>Type <span className="font-bold text-red-500">DELETE</span> to confirm</> : <>확인을 위해 <span className="font-bold text-red-500">탈퇴</span>를 입력하세요</>}
                  </p>
                  <input
                    ref={deleteInputRef}
                    type="text"
                    value={deleteInput}
                    onChange={e => { setDeleteInput(e.target.value); setDeleteError(""); }}
                    onKeyDown={e => e.key === "Enter" && handleDeleteAccount()}
                    placeholder={t("탈퇴", "DELETE")}
                    className="w-full px-3 py-2 text-[13px] bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400"
                  />
                  {deleteError && (
                    <p className="text-[12px] text-red-500">{deleteError}</p>
                  )}
                </div>

                {/* 버튼 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteModal(false)}
                    className="flex-1 px-3 py-2.5 text-[13px] font-medium rounded-xl border border-border text-foreground hover:bg-accent transition-colors"
                  >
                    {t("취소", "Cancel")}
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteInput !== (isEn ? "DELETE" : "탈퇴") || deleting}
                    className={cn(
                      "flex-1 px-3 py-2.5 text-[13px] font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5",
                      deleteInput === (isEn ? "DELETE" : "탈퇴") && !deleting
                        ? "bg-red-500 text-white hover:bg-red-600"
                        : "bg-muted text-muted-foreground cursor-not-allowed"
                    )}
                  >
                    {deleting ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
                        className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"
                      />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                    {deleting ? t("처리 중...", "Processing...") : t("탈퇴하기", "Delete Account")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
