import { useEffect, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useDeleteAnalysis, useAnalysis } from "@/hooks/use-analyses";
import { formatCurrency, toKoreanVerdict, toKoreanIndustry } from "@/lib/formatters";
import { Briefcase, Clock } from "lucide-react";

export default function AnalysisDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = params.id!;
  const { data: analysis } = useAnalysis(id);
  const { mutate: deleteAnalysis } = useDeleteAnalysis();

  useEffect(() => {
    if (!analysis) return;
  }, [analysis]);

  const isComplete = useMemo(() => Boolean(analysis?.investmentVerdict), [analysis]);

  if (!analysis) return null;

  const handleDelete = () => {
    if (!confirm("이 분석을 삭제하시겠습니까?")) return;
    deleteAnalysis(id, { onSuccess: () => setLocation("/") });
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{analysis.companyName}</h1>
          {analysis.englishName && <p className="text-sm text-muted-foreground mt-0.5 mb-1 font-normal">{analysis.englishName}</p>}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-2">
            <span className="flex items-center gap-1.5"><Briefcase className="w-3.5 h-3.5" /> {toKoreanIndustry(analysis.industry)}</span>
            <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {new Date(analysis.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-col items-start md:items-end gap-3 print:hidden w-full md:w-auto">
          {false && (
            <button onClick={handleDelete} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg transition-colors border border-transparent hover:border-destructive/20 self-end" title="분석 삭제">
              삭제
            </button>
          )}
        </div>
      </div>

      {isComplete && analysis.investmentVerdict && (
        <div className="bg-primary/5 border border-primary/20 p-5 rounded-xl w-full md:min-w-[250px] md:w-auto">
          <div className="text-[11px] font-mono text-primary/70 mb-1 uppercase tracking-widest">최종 투자 의견</div>
          <div className="text-xl font-bold text-foreground mb-3">{toKoreanVerdict(analysis.investmentVerdict)}</div>
          <div className="space-y-1.5 font-mono text-xs">
            <div className="flex justify-between items-center border-b border-border pb-1.5">
              <span className="text-muted-foreground">적정주가</span>
              <span className="text-success font-bold">{formatCurrency(analysis.targetPrice)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
