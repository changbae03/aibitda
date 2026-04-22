import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Monitor, Moon, Sun, Check, LogOut, User, Zap, Shield, MessageSquare, Send, ChevronDown } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";
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
        setNicknameMsg({ type: "ok", text: "닉네임이 저장됐습니다" });
      } else {
        setNicknameMsg({ type: "err", text: d.error ?? "저장에 실패했습니다" });
      }
    } catch {
      setNicknameMsg({ type: "err", text: "네트워크 오류가 발생했습니다" });
    } finally {
      setNicknameSaving(false);
      setTimeout(() => setNicknameMsg(null), 3000);
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
        setFbError(d.error ?? "전송에 실패했습니다. 다시 시도해주세요.");
      }
    } catch {
      setFbError("네트워크 오류가 발생했습니다.");
    } finally {
      setFbSubmitting(false);
    }
  };

  const dailyUsed = credits?.dailyUsed ?? 0;
  const dailyLimit = credits?.dailyLimit ?? 3;
  const usagePct = Math.min(100, (dailyUsed / dailyLimit) * 100);

  return (
    <div className="max-w-xl space-y-8 pb-20">
      <div>
        <h1 className="text-xl font-bold text-foreground">설정</h1>
        <p className="text-sm text-muted-foreground mt-1">계정 및 앱 환경을 관리합니다</p>
      </div>

      {/* ── 계정 ── */}
      <Section title="계정">
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
                    <span className="text-[11px] text-muted-foreground">카카오: {user.nickname}</span>
                  )}
                  {!user.displayName && (
                    <span className="text-[11px] text-muted-foreground">카카오 로그인</span>
                  )}
                  {isAdmin && (
                    <span className="flex items-center gap-0.5 text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                      <Shield className="w-2.5 h-2.5" />관리자
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 닉네임 설정 */}
            <div className="px-4 py-3.5 space-y-2.5 border-t border-border">
              <p className="text-[12px] font-medium text-foreground/70">닉네임 설정</p>
              <p className="text-[11px] text-muted-foreground/60">카카오 이름 대신 서비스 내에서 사용할 이름을 설정합니다. 최대 20자.</p>
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
                  저장
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
                {loggingOut ? "로그아웃 중..." : "로그아웃"}
              </button>
            </Row>
          </>
        ) : (
          <Row>
            <button
              onClick={() => setLocation("/login")}
              className="text-[13px] font-medium text-primary hover:underline"
            >
              카카오로 로그인하기 →
            </button>
          </Row>
        )}
      </Section>

      {/* ── 오늘의 분석 현황 ── */}
      {user && credits && (
        <Section title="오늘의 분석 현황">
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary" />
                <span className="text-[13px] font-medium text-foreground">
                  {isAdmin ? "무제한 (관리자)" : `오늘 ${dailyUsed}회 사용 / ${dailyLimit}회`}
                </span>
              </div>
              {!isAdmin && (
                <span className={cn(
                  "text-[12px] font-semibold",
                  credits.remaining === 0 ? "text-red-500" : credits.remaining <= 1 ? "text-amber-500" : "text-emerald-600"
                )}>
                  {credits.remaining}회 남음
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
              {isAdmin ? "관리자 계정은 분석 횟수 제한이 없습니다." : "매일 자정(KST) 기준으로 횟수가 초기화됩니다."}
            </p>
          </div>
        </Section>
      )}

      {/* ── 테마 ── */}
      <Section title="테마">
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
              ? "OS의 다크/라이트 설정을 자동으로 따릅니다."
              : mounted && theme === "dark"
              ? "다크 모드가 활성화되어 있습니다."
              : "라이트 모드가 활성화되어 있습니다."}
          </p>
        </div>
      </Section>

      {/* ── 피드백 보내기 ── */}
      <Section title="피드백">
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-4 h-4 text-primary" />
            <p className="text-[13px] font-medium text-foreground">의견 보내기</p>
          </div>
          <p className="text-[12px] text-muted-foreground/70 leading-relaxed">
            분석 품질, 불편한 점, 기능 제안 등 무엇이든 알려주세요. 서비스 개선에 반영됩니다.
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
                <p className="text-[13px] font-semibold text-foreground">의견을 전달했습니다</p>
                <p className="text-[12px] text-muted-foreground">소중한 피드백 감사합니다.</p>
                <button
                  onClick={() => setFbDone(false)}
                  className="mt-1 text-[12px] text-primary hover:underline"
                >
                  다시 보내기
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
                  placeholder="불편한 점, 개선 아이디어, 칭찬 등 자유롭게 작성해주세요..."
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
                        전송 중
                      </>
                    ) : (
                      <>
                        <Send className="w-3.5 h-3.5" />
                        보내기
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
      <Section title="서비스 정보">
        <Row label="서비스">
          <span className="text-[13px] text-muted-foreground">애빛다 · CBST</span>
        </Row>
        <Row label="버전">
          <span className="text-[13px] text-muted-foreground font-mono">v1.0.0</span>
        </Row>
        <Row label="문의">
          <a href="mailto:support@cbst.ai" className="text-[13px] text-primary hover:underline">
            support@cbst.ai
          </a>
        </Row>
      </Section>

      {/* ── 법적 고지 ── */}
      <Section title="법적 고지">
        <Row>
          <a href="#" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">개인정보처리방침</a>
        </Row>
        <Row>
          <a href="#" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">이용약관</a>
        </Row>
        <Row>
          <a href="#" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">투자 유의사항</a>
        </Row>
      </Section>
    </div>
  );
}
