import { Mail, MessageSquare, Clock, ExternalLink } from "lucide-react";
import { useState } from "react";

const FAQ = [
  {
    q: "애빛다는 어떤 서비스인가요?",
    a: "애빛다는 AI가 자동으로 주식 기업분석 보고서를 생성해주는 플랫폼입니다. 코스피·코스닥·NYSE·NASDAQ 상장 기업을 대상으로 재무분석, DCF 밸류에이션, 뉴스 분석 등을 제공합니다.",
  },
  {
    q: "분석 결과를 투자에 바로 활용할 수 있나요?",
    a: "아니요. 모든 분석은 AI가 자동 생성한 참고 자료이며, 투자 권유·추천이 아닙니다. 반드시 공시자료와 전문가 의견을 함께 확인하신 후 본인 판단 하에 투자하시기 바랍니다.",
  },
  {
    q: "어떤 종목을 분석할 수 있나요?",
    a: "한국 코스피·코스닥 전 종목(약 2,700개)과 미국 NYSE·NASDAQ 주요 종목을 지원합니다. 종목 검색창에 회사명 또는 종목코드(예: 005930, AAPL)를 입력하세요.",
  },
  {
    q: "분석 결과가 저장되나요?",
    a: "네. 로그인 후 분석한 결과는 '내가 본 자료' 메뉴에서 확인하실 수 있습니다.",
  },
  {
    q: "로그인 없이도 사용할 수 있나요?",
    a: "일부 기능은 비로그인 상태에서도 이용 가능하지만, 분석 이력 저장 및 전체 기능은 카카오 소셜 로그인 후 이용하실 수 있습니다.",
  },
  {
    q: "분석 결과에 오류가 있어요.",
    a: "AI 특성상 오류가 발생할 수 있습니다. 구체적인 오류 내용을 아래 이메일로 제보해 주시면 서비스 개선에 반영하겠습니다.",
  },
  {
    q: "개인정보는 어떻게 처리되나요?",
    a: "카카오 로그인 시 제공된 닉네임·프로필 이미지만 저장하며, 개인 투자 성향·자산 정보는 수집하지 않습니다. 자세한 사항은 개인정보처리방침을 확인해 주세요.",
  },
];

export default function SupportPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-1">고객센터</h1>
      <p className="text-sm text-muted-foreground mb-8">궁금한 점이나 불편한 점이 있으시면 언제든지 연락해 주세요.</p>

      {/* 연락처 카드 */}
      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        <ContactCard
          icon={<Mail className="w-5 h-5 text-primary" />}
          title="이메일 문의"
          desc="평일 영업일 기준 1–2일 내 회신"
          action={{ label: "support@cbst.kr", href: "mailto:support@cbst.kr" }}
        />
        <ContactCard
          icon={<Clock className="w-5 h-5 text-primary" />}
          title="운영 시간"
          desc={<>평일 09:00 – 18:00 KST<br />(점심 12:00 – 13:00 제외)<br />주말·공휴일 휴무</>}
        />
      </div>

      {/* FAQ */}
      <h2 className="text-base font-semibold mb-4">자주 묻는 질문</h2>
      <div className="space-y-2">
        {FAQ.map((item, i) => (
          <div key={i} className="border border-border rounded-lg overflow-hidden">
            <button
              className="w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-muted/50 transition-colors"
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
            >
              <span className="text-sm font-medium">{item.q}</span>
              <span className="text-muted-foreground text-lg leading-none select-none">{openIdx === i ? "−" : "+"}</span>
            </button>
            {openIdx === i && (
              <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border pt-3">
                {item.a}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 추가 링크 */}
      <div className="mt-10 p-4 bg-muted/40 rounded-lg">
        <p className="text-sm text-muted-foreground">
          <MessageSquare className="inline w-4 h-4 mr-1 -mt-0.5" />
          더 빠른 피드백을 원하신다면 이메일 제목에 <strong>[버그]</strong>, <strong>[제안]</strong>, <strong>[오류]</strong> 등을 포함해 주시면 우선 처리합니다.
        </p>
      </div>
    </div>
  );
}

function ContactCard({
  icon, title, desc, action,
}: {
  icon: React.ReactNode;
  title: string;
  desc: React.ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <div className="border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="font-medium text-sm">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
      {action && (
        <a
          href={action.href}
          className="inline-flex items-center gap-1 mt-3 text-sm text-primary hover:underline"
        >
          {action.label}
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
}
