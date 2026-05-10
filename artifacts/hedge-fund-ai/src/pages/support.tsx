import { useState, useEffect } from "react";
import { Clock, Send, Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { getApiUrl } from "@/lib/utils";
import { useLanguage } from "@/lib/language-context";

const CATEGORIES_KO = ["서비스 문의", "분석 오류", "계정·결제", "기능 제안", "기타"];
const CATEGORIES_EN = ["Service Inquiry", "Analysis Error", "Account & Billing", "Feature Request", "Other"];

interface MyInquiry {
  id: number;
  category: string | null;
  content: string;
  status: "open" | "replied" | "closed";
  admin_reply: string | null;
  replied_at: string | null;
  created_at: string;
}

function formatDate(iso: string, isEn: boolean) {
  return new Date(iso).toLocaleString(isEn ? "en-US" : "ko-KR", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status, isEn }: { status: string; isEn: boolean }) {
  if (status === "open") return (
    <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
      <Clock className="w-3 h-3" /> {isEn ? "Awaiting reply" : "답변 대기 중"}
    </span>
  );
  if (status === "replied") return (
    <span className="flex items-center gap-1 text-[11px] font-medium text-green-600 dark:text-green-400">
      <CheckCircle2 className="w-3 h-3" /> {isEn ? "Replied" : "답변 완료"}
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <XCircle className="w-3 h-3" /> {isEn ? "Closed" : "종료"}
    </span>
  );
}

const FAQ_KO = [
  { q: "애빛다는 어떤 서비스인가요?", a: "AI가 자동으로 주식 기업분석 보고서를 생성해주는 플랫폼입니다. 코스피·코스닥·NYSE·NASDAQ 상장 기업을 대상으로 재무분석, DCF 밸류에이션, 뉴스 분석 등을 제공합니다." },
  { q: "분석 결과를 투자에 바로 활용할 수 있나요?", a: "아니요. 모든 분석은 AI가 자동 생성한 참고 자료이며, 투자 권유·추천이 아닙니다. 반드시 공시자료와 전문가 의견을 함께 확인하신 후 본인 판단 하에 투자하시기 바랍니다." },
  { q: "어떤 종목을 분석할 수 있나요?", a: "한국 코스피·코스닥 전 종목(약 2,700개)과 미국 NYSE·NASDAQ 주요 종목을 지원합니다. 종목 검색창에 회사명 또는 종목코드(예: 005930, AAPL)를 입력하세요." },
  { q: "분석 결과가 저장되나요?", a: "네. 로그인 후 분석한 결과는 '내가 본 자료' 메뉴에서 확인하실 수 있습니다." },
  { q: "로그인 없이도 사용할 수 있나요?", a: "일부 기능은 비로그인 상태에서도 이용 가능하지만, 분석 이력 저장 및 전체 기능은 카카오 소셜 로그인 후 이용하실 수 있습니다." },
  { q: "분석 결과에 오류가 있어요.", a: "AI 특성상 오류가 발생할 수 있습니다. 아래 문의 폼으로 구체적인 오류 내용을 알려주시면 서비스 개선에 반영하겠습니다." },
  { q: "개인정보는 어떻게 처리되나요?", a: "카카오 로그인 시 제공된 닉네임·프로필 이미지만 저장하며, 개인 투자 성향·자산 정보는 수집하지 않습니다. 자세한 사항은 개인정보처리방침을 확인해 주세요." },
];

const FAQ_EN = [
  { q: "What is AiBITDA?", a: "AiBITDA is a platform that automatically generates AI-powered stock research reports. It covers KOSPI, KOSDAQ, NYSE, and NASDAQ-listed companies, offering financial analysis, DCF valuation, news analysis, and more." },
  { q: "Can I use the analysis results directly for investing?", a: "No. All analyses are AI-generated reference materials and do not constitute investment advice or recommendations. Always verify with official disclosures and professional opinions before making investment decisions." },
  { q: "What stocks can I analyze?", a: "All Korean KOSPI and KOSDAQ stocks (approx. 2,700) and major US NYSE/NASDAQ stocks are supported. Enter a company name or ticker (e.g. 005930, AAPL) in the search bar." },
  { q: "Are analysis results saved?", a: "Yes. After signing in, your past analyses are accessible from the 'History' menu." },
  { q: "Can I use the service without signing in?", a: "Some features are available without sign-in, but saving analysis history and full access requires signing in with Kakao or Google." },
  { q: "There's an error in an analysis result.", a: "Errors can occur due to the nature of AI. Please describe the specific issue using the contact form below and we'll work to improve the service." },
  { q: "How is my personal data handled?", a: "We only store your nickname and profile image provided via social login. We do not collect personal investment preferences or asset information. See our Privacy Policy for details." },
];

export default function SupportPage() {
  const { isEn } = useLanguage();
  const CATEGORIES = isEn ? CATEGORIES_EN : CATEGORIES_KO;
  const FAQ = isEn ? FAQ_EN : FAQ_KO;

  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [myInquiries, setMyInquiries] = useState<MyInquiry[]>([]);
  const [myExpanded, setMyExpanded] = useState<number | null>(null);
  const [loadingMy, setLoadingMy] = useState(true);

  useEffect(() => {
    setCategory(CATEGORIES[0]);
  }, [isEn]);

  useEffect(() => {
    fetch(getApiUrl("/api/support/my"), { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setMyInquiries(d); })
      .catch(() => {})
      .finally(() => setLoadingMy(false));
  }, [submitted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (content.trim().length < 5) {
      setError(isEn ? "Please enter at least 5 characters." : "5자 이상 입력해주세요.");
      return;
    }
    setError(""); setSubmitting(true);
    try {
      const r = await fetch(getApiUrl("/api/support/inquiry"), {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, content: content.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error ?? (isEn ? "An error occurred." : "오류가 발생했습니다.")); return; }
      setSubmitted(true);
      setContent("");
    } catch {
      setError(isEn ? "A network error occurred." : "네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-1">{isEn ? "Support" : "고객센터"}</h1>
      <p className="text-sm text-muted-foreground mb-8">
        {isEn ? "Have a question or issue? Send us a message below." : "궁금한 점이나 불편한 점이 있으시면 아래에 문의해 주세요."}
      </p>

      {/* 운영 시간 */}
      <div className="flex items-start gap-2 text-sm text-muted-foreground mb-8 bg-muted/40 rounded-lg px-4 py-3">
        <Clock className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
        <span>
          {isEn
            ? "Hours: Mon–Fri 09:00–18:00 KST · Closed on weekends & holidays · Avg. response within 1–2 business days"
            : "운영 시간: 평일 09:00 – 18:00 KST · 주말·공휴일 휴무 · 평균 1–2일 내 답변"}
        </span>
      </div>

      {/* 문의 폼 */}
      <section className="mb-10">
        <h2 className="text-base font-semibold mb-4">{isEn ? "Contact Us" : "문의하기"}</h2>
        {submitted ? (
          <div className="border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 rounded-xl p-6 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
            <p className="font-medium text-green-700 dark:text-green-300">
              {isEn ? "Your inquiry has been submitted." : "문의가 접수되었습니다."}
            </p>
            <p className="text-sm text-muted-foreground">
              {isEn ? "We'll reply within 1–2 business days." : "평일 영업일 기준 1–2일 내에 답변 드리겠습니다."}
            </p>
            <button onClick={() => setSubmitted(false)} className="mt-2 text-xs text-primary hover:underline">
              {isEn ? "Submit another inquiry" : "추가 문의하기"}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 카테고리 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {isEn ? "Inquiry Type" : "문의 유형"}
              </label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map(c => (
                  <button key={c} type="button" onClick={() => setCategory(c)}
                    className={`px-3 py-1.5 text-xs rounded-full border font-medium transition-all ${
                      category === c
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/30 text-muted-foreground border-border hover:border-primary/40"
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* 내용 */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {isEn ? "Message" : "문의 내용"}
              </label>
              <textarea
                value={content}
                onChange={e => { setContent(e.target.value); setError(""); }}
                placeholder={isEn ? "Please describe your inquiry in detail. (min. 5 characters)" : "문의 내용을 자세히 적어주세요. (5자 이상)"}
                rows={5}
                className="w-full text-sm bg-muted/30 border border-border rounded-xl px-4 py-3 focus:outline-none focus:border-primary/60 resize-none transition-colors"
              />
              <div className="flex items-center justify-between mt-1">
                {error ? <p className="text-xs text-destructive">{error}</p> : <span />}
                <p className="text-xs text-muted-foreground">{content.length} / 3000</p>
              </div>
            </div>

            <button type="submit" disabled={submitting || content.trim().length < 5}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium disabled:opacity-40 transition-opacity hover:opacity-90">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isEn ? "Submit" : "문의 제출"}
            </button>
          </form>
        )}
      </section>

      {/* 내 문의 이력 */}
      {!loadingMy && myInquiries.length > 0 && (
        <section className="mb-10">
          <h2 className="text-base font-semibold mb-4">{isEn ? "My Inquiries" : "내 문의 이력"}</h2>
          <div className="space-y-2">
            {myInquiries.map(inq => {
              const isOpen = myExpanded === inq.id;
              return (
                <div key={inq.id} className="border border-border rounded-xl overflow-hidden">
                  <button className="w-full text-left px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                    onClick={() => setMyExpanded(isOpen ? null : inq.id)}>
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <StatusBadge status={inq.status} isEn={isEn} />
                      {inq.category && <span className="text-[11px] text-muted-foreground">[{inq.category}]</span>}
                      <span className="text-sm truncate">{inq.content.slice(0, 50)}{inq.content.length > 50 ? "…" : ""}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{formatDate(inq.created_at, isEn)}</span>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-border space-y-3 pt-3">
                      <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-lg p-3">{inq.content}</p>
                      {inq.admin_reply && (
                        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                          <p className="text-[11px] font-semibold text-primary mb-1">
                            {isEn ? "Admin reply" : "관리자 답변"} · {inq.replied_at ? formatDate(inq.replied_at, isEn) : ""}
                          </p>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{inq.admin_reply}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* FAQ */}
      <section>
        <h2 className="text-base font-semibold mb-4">{isEn ? "Frequently Asked Questions" : "자주 묻는 질문"}</h2>
        <div className="space-y-2">
          {FAQ.map((item, i) => (
            <div key={i} className="border border-border rounded-lg overflow-hidden">
              <button className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-muted/50 transition-colors"
                onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                <span className="text-sm font-medium">{item.q}</span>
                <span className="text-muted-foreground text-lg leading-none select-none">{faqOpen === i ? "−" : "+"}</span>
              </button>
              {faqOpen === i && (
                <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">{item.a}</div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
