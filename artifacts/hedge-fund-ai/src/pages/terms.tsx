export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-bold mb-1">이용약관</h1>
      <p className="text-sm text-muted-foreground mb-8">시행일: 2025년 1월 1일 · 최종 수정: 2026년 4월 1일</p>

      <Section title="제1조 (목적)">
        <p>본 약관은 CBST(이하 "회사")가 제공하는 AI 기업분석 플랫폼 <strong>애빛다</strong>(이하 "서비스")의 이용 조건 및 절차, 회사와 이용자 간의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
      </Section>

      <Section title="제2조 (정의)">
        <ul className="list-disc pl-5 space-y-1">
          <li>"이용자"란 본 약관에 동의하고 서비스를 이용하는 자를 말합니다.</li>
          <li>"콘텐츠"란 AI가 생성한 기업분석 보고서, 재무 추정치, 밸류에이션 결과 등 모든 정보를 말합니다.</li>
          <li>"계정"이란 이용자가 서비스를 이용하기 위해 카카오 소셜 로그인으로 생성한 식별 정보를 말합니다.</li>
        </ul>
      </Section>

      <Section title="제3조 (약관의 효력 및 변경)">
        <p>본 약관은 서비스 화면에 게시하거나 이용자에게 고지하는 방법으로 효력이 발생합니다. 회사는 법령 변경 또는 서비스 정책에 따라 본 약관을 변경할 수 있으며, 변경 시 공지사항을 통해 7일 전에 안내합니다.</p>
      </Section>

      <Section title="제4조 (서비스 이용)">
        <p>이용자는 카카오 소셜 로그인을 통해 서비스에 가입하고 이용할 수 있습니다. 이용자는 자신의 계정 정보를 관리할 책임이 있으며, 계정 보안 사고에 대한 책임은 이용자에게 있습니다.</p>
      </Section>

      <Section title="제5조 (서비스의 중단)">
        <p>회사는 설비 점검·보수, 천재지변, 불가피한 사업상 사정 등으로 서비스 제공을 일시적으로 중단할 수 있습니다. 이 경우 사전 또는 사후에 공지합니다.</p>
      </Section>

      <Section title="제6조 (이용자의 의무)">
        <p>이용자는 다음 행위를 해서는 안 됩니다.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>서비스에서 제공하는 콘텐츠를 무단으로 복제·배포·상업적으로 이용하는 행위</li>
          <li>서비스의 정상적인 운영을 방해하는 행위</li>
          <li>타인의 개인정보를 도용하는 행위</li>
          <li>기타 관련 법령을 위반하는 행위</li>
        </ul>
      </Section>

      <Section title="제7조 (AI 콘텐츠 면책)">
        <p>서비스가 제공하는 모든 콘텐츠는 <strong>AI가 자동 생성한 참고용 정보</strong>이며, 특정 금융투자상품의 매수·매도·보유를 권유하거나 추천하지 않습니다.</p>
        <p className="mt-2">본 서비스는 자본시장법상 투자자문업·투자일임업에 해당하지 않습니다. 투자 판단의 최종 책임은 투자자 본인에게 있으며, 회사는 이용자의 투자 결과에 대해 어떠한 책임도 지지 않습니다.</p>
        <p className="mt-2">AI 분석 결과에는 오류, 누락, 시차(時差)가 있을 수 있으므로 반드시 공시 자료 및 전문가 의견을 함께 참고하시기 바랍니다.</p>
      </Section>

      <Section title="제8조 (지식재산권)">
        <p>서비스 내 UI, 로고, 브랜드 요소에 대한 지식재산권은 회사에 귀속됩니다. AI가 생성한 분석 보고서는 개인적·비상업적 용도로만 이용할 수 있습니다.</p>
      </Section>

      <Section title="제9조 (분쟁 해결)">
        <p>서비스 이용으로 발생한 분쟁은 대한민국 법령을 준거법으로 하며, 관할 법원은 민사소송법의 규정에 따릅니다.</p>
      </Section>

      <Section title="제10조 (기타)">
        <p>본 약관에서 정하지 않은 사항은 관련 법령 및 회사의 운영 정책에 따릅니다.</p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold mb-3 pb-1 border-b border-border">{title}</h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-2">{children}</div>
    </section>
  );
}
