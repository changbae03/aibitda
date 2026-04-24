import { useState, useEffect } from "react";
import { getApiUrl } from "@/lib/utils";
import { Bell, ChevronDown, ChevronUp } from "lucide-react";

interface Notice {
  id: number;
  title: string;
  content: string;
  created_at: string;
  is_pinned: boolean;
  category: string;
}

const STATIC_NOTICES: Notice[] = [
  {
    id: 1,
    title: "[서비스 안내] 애빛다 정식 서비스 개시",
    content: "안녕하세요, 애빛다입니다.\n\nAI 기업분석 플랫폼 애빛다가 정식 서비스를 시작합니다.\n\n주요 기능:\n• 코스피·코스닥·NYSE·NASDAQ 종목 AI 분석\n• DCF / rNPV / P/B-ROE 밸류에이션\n• 7단계 AI 파이프라인 분석 보고서\n• 실적 발표 캘린더\n\n서비스 이용 중 문의사항은 고객센터(support@cbst.kr)로 연락해 주세요.\n\n감사합니다.",
    created_at: "2026-04-01T09:00:00.000Z",
    is_pinned: true,
    category: "공지",
  },
  {
    id: 2,
    title: "[업데이트] 실적 캘린더 Gemini 실시간 연동 업데이트",
    content: "실적 발표 캘린더가 더욱 정확해졌습니다.\n\n• 한국 종목 실적발표일: Gemini AI + Google 실시간 검색으로 Yahoo Finance 대비 정확도 개선\n• KST 기준 날짜 표시 정확도 향상\n• 미국 종목: Yahoo Finance 기존 방식 유지\n\n더욱 정확한 실적 일정으로 투자 일정을 관리하세요.",
    created_at: "2026-04-24T09:00:00.000Z",
    is_pinned: false,
    category: "업데이트",
  },
  {
    id: 3,
    title: "[안내] AI 분석 면책고지 (자본시장법·AI기본법)",
    content: "애빛다 서비스 이용 전 반드시 확인해 주세요.\n\n• 본 서비스의 모든 분석 결과는 AI가 자동 생성한 참고용 정보입니다.\n• 특정 종목의 매수·매도를 권유하지 않습니다.\n• 본 서비스는 자본시장법상 투자자문업·투자일임업에 해당하지 않습니다.\n• 인공지능 기본법에 따라 AI 생성 콘텐츠임을 고지합니다.\n\n투자 판단의 최종 책임은 투자자 본인에게 있습니다.",
    created_at: "2026-04-01T09:00:00.000Z",
    is_pinned: false,
    category: "법적고지",
  },
];

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const CATEGORY_COLORS: Record<string, string> = {
  "공지": "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "업데이트": "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "법적고지": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "점검": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export default function NoticesPage() {
  const [notices, setNotices] = useState<Notice[]>(STATIC_NOTICES);
  const [openId, setOpenId] = useState<number | null>(STATIC_NOTICES[0]?.id ?? null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 서버에서 공지사항을 가져오는 경우 확장 가능
    fetch(getApiUrl("/api/admin/notices"), { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setNotices(data);
          setOpenId(data[0]?.id ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const pinned = notices.filter(n => n.is_pinned);
  const rest = notices.filter(n => !n.is_pinned);
  const sorted = [...pinned, ...rest];

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center gap-2 mb-1">
        <Bell className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">공지사항</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">애빛다의 서비스 안내, 업데이트, 법적 고지를 확인하세요.</p>

      {sorted.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">등록된 공지사항이 없습니다.</p>
      )}

      <div className="space-y-2">
        {sorted.map(notice => {
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
    </div>
  );
}
