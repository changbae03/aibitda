import { useListAnalyses, useDeleteAnalysis } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ko } from "date-fns/locale";
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Trash2,
  ChevronRight,
  BarChart2,
  Clock,
  AlertCircle,
  BookOpen,
  ExternalLink,
  Rss,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { motion } from "framer-motion";
import { useState } from "react";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────
interface SubstackItem {
  title: string;
  link: string;
  pubDate: string;
  summary: string;
  image: string | null;
  creator: string;
  categories: string[];
}

interface SubstackFeed {
  title: string;
  description: string;
  link: string;
  items: SubstackItem[];
}

// ────────────────────────────────────────────────
// Hooks
// ────────────────────────────────────────────────
function useSubstackFeed() {
  return useQuery<SubstackFeed>({
    queryKey: ["substack-feed"],
    queryFn: async () => {
      const res = await fetch("/api/feed/substack");
      if (!res.ok) throw new Error("RSS 피드를 불러오지 못했습니다");
      return res.json();
    },
    staleTime: 1000 * 60 * 15,
  });
}

// ────────────────────────────────────────────────
// Analysis status config
// ────────────────────────────────────────────────
const STATUS_LABEL: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  completed: {
    label: "분석 완료",
    color: "text-emerald-600 bg-emerald-50 border-emerald-200",
    icon: <BarChart2 className="w-3 h-3" />,
  },
  in_progress: {
    label: "분석 중",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  failed: {
    label: "오류",
    color: "text-red-500 bg-red-50 border-red-200",
    icon: <AlertCircle className="w-3 h-3" />,
  },
  pending: {
    label: "대기 중",
    color: "text-slate-500 bg-slate-50 border-slate-200",
    icon: <Clock className="w-3 h-3" />,
  },
};

function VerdictBadge({ verdict }: { verdict?: string | null }) {
  if (!verdict) return null;
  const v = verdict.toLowerCase();
  if (v.includes("매수") || v.includes("buy") || v.includes("강력매수")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
        <TrendingUp className="w-3 h-3" /> {verdict}
      </span>
    );
  }
  if (v.includes("매도") || v.includes("sell")) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-600 border border-red-200">
        <TrendingDown className="w-3 h-3" /> {verdict}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
      <Minus className="w-3 h-3" /> {verdict}
    </span>
  );
}

// ────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────
function AnalysisList() {
  const [, setLocation] = useLocation();
  const { data: analyses, isLoading, error } = useListAnalyses();
  const { mutate: deleteAnalysis } = useDeleteAnalysis();

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (!confirm("이 보고서를 삭제하시겠습니까?")) return;
    deleteAnalysis(id);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">보고서를 불러오는 중...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-red-500">
        <AlertCircle className="w-5 h-5" />
        <span className="text-sm">보고서를 불러오지 못했습니다</span>
      </div>
    );
  }

  if (!analyses || analyses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
          <FileText className="w-7 h-7 text-slate-400" />
        </div>
        <div className="space-y-1">
          <p className="font-semibold text-foreground">아직 분석 보고서가 없습니다</p>
          <p className="text-sm text-muted-foreground">AI 기업분석을 시작하면 보고서가 여기에 저장됩니다</p>
        </div>
        <button
          onClick={() => setLocation("/analysis/new")}
          className="mt-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
        >
          첫 번째 분석 시작하기
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm text-muted-foreground pb-1">
        <span>총 <strong className="text-foreground">{analyses.length}건</strong>의 보고서</span>
        <span className="text-xs">
          {analyses.filter(a => a.status === "completed").length}건 완료 ·{" "}
          {analyses.filter(a => a.status === "in_progress").length}건 진행 중
        </span>
      </div>

      {analyses.map((analysis, i) => {
        const statusInfo = STATUS_LABEL[analysis.status] ?? STATUS_LABEL.pending;
        const completedSteps = analysis.steps?.filter((s: any) => s.content).length ?? 0;
        const totalSteps = 6;

        return (
          <motion.div
            key={analysis.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => setLocation(`/analysis/${analysis.id}`)}
            className={cn(
              "group relative bg-white border border-border rounded-xl p-5 cursor-pointer",
              "hover:border-indigo-300 hover:shadow-md transition-all duration-200"
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4 min-w-0">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center mt-0.5">
                  <span className="text-xs font-mono font-bold text-indigo-600">
                    {analysis.ticker.slice(0, 3)}
                  </span>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base text-foreground leading-tight">
                      {analysis.companyName}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">{analysis.ticker}</span>
                    {analysis.industry && (
                      <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
                        {analysis.industry}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <VerdictBadge verdict={analysis.investmentVerdict} />
                    {analysis.targetPrice && (
                      <span className="text-xs text-muted-foreground">
                        목표가{" "}
                        <strong className="text-foreground font-semibold">
                          {formatCurrency(analysis.targetPrice)}
                        </strong>
                      </span>
                    )}
                  </div>
                  {analysis.status === "in_progress" && (
                    <div className="flex items-center gap-2">
                      <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">{completedSteps}/{totalSteps} 단계</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-2">
                <span className={cn(
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                  statusInfo.color
                )}>
                  {statusInfo.icon}
                  {statusInfo.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(analysis.createdAt), "yyyy.MM.dd HH:mm", { locale: ko })}
                </span>
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={(e) => handleDelete(e, analysis.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                    title="삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-indigo-500 transition-colors" />
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function SubstackFeed() {
  const { data: feed, isLoading, error } = useSubstackFeed();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">글을 불러오는 중...</span>
      </div>
    );
  }

  if (error || !feed) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-red-500">
        <AlertCircle className="w-5 h-5" />
        <span className="text-sm">피드를 불러오지 못했습니다</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Feed header */}
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Rss className="w-4 h-4 text-orange-400" />
          <span>최신 <strong className="text-foreground">{feed.items.length}개</strong> 글</span>
        </div>
        <a
          href={feed.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
        >
          Substack 구독하기 <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {/* Cards grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {feed.items.map((item, i) => {
          let pubDate = "";
          try {
            pubDate = format(parseISO(new Date(item.pubDate).toISOString()), "yyyy.MM.dd", { locale: ko });
          } catch {
            pubDate = item.pubDate?.slice(0, 10) ?? "";
          }

          return (
            <motion.a
              key={item.link}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group bg-white border border-border rounded-xl overflow-hidden hover:border-indigo-300 hover:shadow-md transition-all duration-200 flex flex-col"
            >
              {/* Thumbnail */}
              {item.image ? (
                <div className="w-full h-40 overflow-hidden bg-slate-100 shrink-0">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                    onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
                  />
                </div>
              ) : (
                <div className="w-full h-28 bg-gradient-to-br from-indigo-50 to-slate-100 flex items-center justify-center shrink-0">
                  <BookOpen className="w-8 h-8 text-indigo-200" />
                </div>
              )}

              {/* Content */}
              <div className="p-4 flex flex-col gap-2 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{pubDate}</span>
                  {item.categories[0] && (
                    <span className="text-xs px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded font-medium">
                      {item.categories[0]}
                    </span>
                  )}
                </div>
                <h3 className="font-semibold text-sm text-foreground leading-snug group-hover:text-indigo-700 transition-colors line-clamp-2">
                  {item.title}
                </h3>
                <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed flex-1">
                  {item.summary}
                </p>
                <div className="flex items-center justify-between mt-1 pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">{item.creator}</span>
                  <span className="text-xs text-indigo-600 font-medium flex items-center gap-1 group-hover:gap-1.5 transition-all">
                    읽기 <ExternalLink className="w-3 h-3" />
                  </span>
                </div>
              </div>
            </motion.a>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────
type Tab = "analyses" | "substack";

export default function Reports() {
  const [activeTab, setActiveTab] = useState<Tab>("analyses");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "analyses", label: "AI 분석 보고서", icon: <FileText className="w-4 h-4" /> },
    { id: "substack", label: "CBST 리서치", icon: <BookOpen className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
            <FileText className="w-4 h-4 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">
            보고서
          </h1>
        </div>
        <p className="text-sm text-muted-foreground pl-[42px]">
          AI 분석 보고서와 CBST 리서치 아티클을 확인하세요
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
              activeTab === tab.id
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18 }}
      >
        {activeTab === "analyses" ? <AnalysisList /> : <SubstackFeed />}
      </motion.div>
    </div>
  );
}
