import { useState, useEffect } from "react";
import { getApiUrl } from "@/lib/utils";
import { Bell, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

interface Notice {
  id: number;
  title: string;
  content: string;
  created_at: string;
  is_pinned: boolean;
  category: string;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const CATEGORY_COLORS: Record<string, string> = {
  "공지": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "업데이트": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "법적고지": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "점검": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "이벤트": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
};

export default function NoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(getApiUrl("/api/notices"), { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setNotices(data);
          // 필독 공지 또는 첫 번째 항목 자동 펼치기
          const pinned = data.find((n: Notice) => n.is_pinned);
          setOpenId(pinned?.id ?? data[0]?.id ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">공지사항</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">애빛다의 서비스 안내, 업데이트, 법적 고지를 확인하세요.</p>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : notices.length === 0 ? (
        <p className="text-sm text-muted-foreground">등록된 공지사항이 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {notices.map(notice => {
            const isOpen = openId === notice.id;
            const catColor = CATEGORY_COLORS[notice.category] ?? "bg-muted text-muted-foreground";
            return (
              <div key={notice.id} className={`border rounded-lg overflow-hidden transition-colors ${notice.is_pinned ? "border-primary/40 bg-primary/5" : "border-border"}`}>
                <button
                  className="w-full text-left px-4 py-3.5 flex items-start justify-between gap-3 hover:bg-muted/40 transition-colors"
                  onClick={() => setOpenId(isOpen ? null : notice.id)}
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    {notice.is_pinned && (
                      <span className="text-[10px] font-bold text-primary border border-primary/40 rounded px-1.5 py-0.5 shrink-0">필독</span>
                    )}
                    <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 shrink-0 ${catColor}`}>{notice.category}</span>
                    <span className="text-sm font-medium truncate">{notice.title}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 mt-0.5">
                    <span className="text-xs text-muted-foreground">{formatDate(notice.created_at)}</span>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>
                {isOpen && (
                  <div className="px-4 pb-5 pt-3 border-t border-border text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                    {notice.content}
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
