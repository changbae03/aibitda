import { useState, useEffect, useCallback } from "react";
import { Loader2, UserPlus, Trash2, Copy, Check, ShieldCheck, Info, AlertTriangle } from "lucide-react";
import { cn, getApiUrl } from "@/lib/utils";

interface AdminUser {
  userId: string;
  displayName: string;
  addedBy: string | null;
  addedAt: string | null;
}

interface MeData {
  isAdmin: boolean;
  userId: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AdminUsers() {
  const [me, setMe] = useState<MeData | null>(null);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUserId, setNewUserId] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const loadMe = useCallback(async () => {
    const r = await fetch(getApiUrl("/api/admin/me"), { credentials: "include" });
    if (r.ok) setMe(await r.json());
  }, []);

  const loadAdmins = useCallback(async () => {
    const r = await fetch(getApiUrl("/api/admin/users"), { credentials: "include" });
    if (r.ok) setAdmins(await r.json());
  }, []);

  useEffect(() => {
    (async () => {
      await loadMe();
      setLoading(false);
    })();
  }, [loadMe]);

  useEffect(() => {
    if (me?.isAdmin) loadAdmins();
  }, [me, loadAdmins]);

  const copyMyId = () => {
    if (!me?.userId) return;
    navigator.clipboard.writeText(me.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const bootstrapSelf = async () => {
    setBootstrapping(true);
    setError("");
    try {
      const r = await fetch(getApiUrl("/api/admin/users"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (r.ok) {
        setSuccess("관리자로 등록됐습니다! 페이지를 새로고침하세요.");
        setTimeout(() => window.location.reload(), 1500);
      } else {
        const d = await r.json();
        setError(d.error ?? "등록 실패");
      }
    } finally {
      setBootstrapping(false);
    }
  };

  const addAdmin = async () => {
    if (!newUserId.trim()) return;
    setAdding(true);
    setError("");
    try {
      const r = await fetch(getApiUrl("/api/admin/users"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: newUserId.trim(), displayName: newDisplayName.trim() }),
      });
      if (r.ok) {
        setNewUserId("");
        setNewDisplayName("");
        setSuccess("관리자가 추가됐습니다");
        setTimeout(() => setSuccess(""), 2000);
        await loadAdmins();
      } else {
        const d = await r.json();
        setError(d.error ?? "추가 실패");
      }
    } finally {
      setAdding(false);
    }
  };

  const removeAdmin = async (userId: string) => {
    setRemoving(userId);
    setError("");
    try {
      const r = await fetch(getApiUrl(`/api/admin/users/${encodeURIComponent(userId)}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (r.ok) {
        await loadAdmins();
      } else {
        const d = await r.json();
        setError(d.error ?? "삭제 실패");
      }
    } finally {
      setRemoving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> 불러오는 중…
      </div>
    );
  }

  if (!me?.userId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">로그인 후 이용하세요</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-xl font-bold text-foreground">관리자 관리</h1>
        <p className="text-sm text-muted-foreground mt-0.5">관리자를 추가하거나 제거합니다</p>
      </div>

      {/* 피드백 메시지 */}
      {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-2.5">{error}</div>}
      {success && <div className="text-sm text-green-600 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl px-4 py-2.5">{success}</div>}

      {/* 내 사용자 ID */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">내 사용자 ID</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-sm font-mono bg-background border border-border rounded-lg px-3 py-2 text-foreground truncate">
            {me.userId}
          </code>
          <button
            onClick={copyMyId}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-muted text-muted-foreground text-xs hover:bg-muted/80 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          친구에게 이 ID를 공유받으면 아래에 입력해 관리자로 등록할 수 있습니다
        </div>
      </div>

      {/* 첫 관리자 부트스트랩 */}
      {!me.isAdmin && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">관리자 미등록 상태</p>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            아직 관리자가 없거나 본인이 관리자가 아닙니다. 아래 버튼으로 본인을 첫 관리자로 등록할 수 있습니다.
          </p>
          <button
            onClick={bootstrapSelf}
            disabled={bootstrapping}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-colors disabled:opacity-50"
          >
            {bootstrapping ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            나를 관리자로 등록
          </button>
        </div>
      )}

      {/* 관리자 목록 (관리자만) */}
      {me.isAdmin && (
        <>
          {/* 관리자 추가 */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold text-foreground">관리자 추가</p>
            <div className="space-y-2">
              <input
                type="text"
                value={newUserId}
                onChange={e => setNewUserId(e.target.value)}
                placeholder="사용자 ID (예: kakao_123456789 또는 clerk_user_xxx)"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <input
                type="text"
                value={newDisplayName}
                onChange={e => setNewDisplayName(e.target.value)}
                placeholder="이름 (선택, 예: 홍길동)"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <button
              onClick={addAdmin}
              disabled={adding || !newUserId.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              관리자 추가
            </button>
          </div>

          {/* ── 위험 영역: 데이터 초기화 ── */}
          <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <p className="text-sm font-semibold text-red-700 dark:text-red-400">위험 — 분석 데이터 전체 초기화</p>
            </div>
            <p className="text-xs text-red-600 dark:text-red-400">
              모든 분석 리포트, 분석 단계, 모델 성과 기록이 영구 삭제됩니다. 되돌릴 수 없습니다.
            </p>
            {!resetConfirm ? (
              <button
                onClick={() => setResetConfirm(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-sm font-medium hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors border border-red-200 dark:border-red-700"
              >
                <Trash2 className="w-4 h-4" />
                데이터 초기화
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setResetting(true);
                    try {
                      const r = await fetch(getApiUrl("/api/admin/reset-analysis-data"), {
                        method: "POST",
                        credentials: "include",
                      });
                      if (r.ok) {
                        setSuccess("분석 데이터가 모두 삭제됐습니다.");
                      } else {
                        const e = await r.json();
                        setError(e.error ?? "초기화 실패");
                      }
                    } catch {
                      setError("네트워크 오류");
                    } finally {
                      setResetting(false);
                      setResetConfirm(false);
                    }
                  }}
                  disabled={resetting}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                >
                  {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  정말 삭제
                </button>
                <button
                  onClick={() => setResetConfirm(false)}
                  className="px-4 py-2 rounded-xl bg-muted text-muted-foreground text-sm hover:bg-muted/80 transition-colors"
                >
                  취소
                </button>
              </div>
            )}
          </div>

          {/* 관리자 목록 */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
              현재 관리자 ({admins.length}명)
            </p>
            {admins.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">등록된 관리자가 없습니다</div>
            ) : (
              admins.map(admin => (
                <div key={admin.userId} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground">
                        {admin.displayName !== admin.userId ? admin.displayName : "—"}
                      </span>
                      {admin.userId === me.userId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">나</span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate">{admin.userId}</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">추가됨: {formatDate(admin.addedAt)}</p>
                  </div>
                  <button
                    onClick={() => removeAdmin(admin.userId)}
                    disabled={!!removing}
                    className={cn(
                      "flex-shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors",
                      removing === admin.userId && "opacity-50 cursor-wait"
                    )}
                  >
                    {removing === admin.userId
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
