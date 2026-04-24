import { AlertTriangle } from "lucide-react";

export default function DisclaimerPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center gap-3 mb-1">
        <AlertTriangle className="w-6 h-6 text-amber-500" />
        <h1 className="text-2xl font-bold">투자 유의사항</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">반드시 읽어보시기 바랍니다.</p>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-8">
        <p className="text-sm font-medium text-amber-800 dark:text-amber-300 leading-relaxed">
          애빛다는 <strong>투자 권유·추천 서비스가 아닙니다.</strong> 모든 콘텐츠는 AI가 자동 생성한 참고용 정보이며, 투자 판단의 최종 책임은 투자자 본인에게 있습니다.
        </p>
      </div>

      <Section title="1. 서비스 성격">
        <p>애빛다가 제공하는 모든 분석 보고서, 재무 추정치, 밸류에이션 결과, 뉴스 요약, 실적 캘린더 등 모든 정보는 <strong>AI(인공지능)가 자동으로 생성한 참고용 자료</strong>입니다.</p>
        <p>본 서비스는 자본시장과 금융투자업에 관한 법률(자본시장법)에서 규정하는 <strong>투자자문업 또는 투자일임업에 해당하지 않습니다.</strong></p>
        <p>인공지능 기본법에 따라 본 서비스의 콘텐츠가 AI에 의해 생성된 것임을 고지합니다.</p>
      </Section>

      <Section title="2. AI 분석의 한계">
        <ul className="list-disc pl-5 space-y-1">
          <li>AI 모델의 특성상 <strong>사실 오류, 수치 오류, 논리적 오류</strong>가 포함될 수 있습니다.</li>
          <li>학습 데이터의 시점 제한으로 최신 정보가 반영되지 않을 수 있습니다.</li>
          <li>DCF, rNPV, P/B-ROE 등 밸류에이션 모델은 다양한 가정을 전제하며, 실제 기업가치와 다를 수 있습니다.</li>
          <li>AI가 제시하는 목표주가, EPS 추정치 등은 참고용이며 보증되지 않습니다.</li>
          <li>분석 결과는 공시된 재무제표, 공식 IR 자료, 전문 애널리스트 의견 등과 함께 종합적으로 판단하시기 바랍니다.</li>
        </ul>
      </Section>

      <Section title="3. 투자 위험">
        <ul className="list-disc pl-5 space-y-1">
          <li>주식 투자는 원금 손실의 위험이 있습니다.</li>
          <li>과거의 수익률이 미래의 수익률을 보장하지 않습니다.</li>
          <li>해외 주식 투자는 환율 변동 위험을 추가로 수반합니다.</li>
          <li>바이오·신약 분야의 rNPV 분석은 임상 성공 확률에 대한 추정을 포함하며 불확실성이 매우 높습니다.</li>
        </ul>
      </Section>

      <Section title="4. 정보 출처 및 정확성">
        <p>본 서비스는 Yahoo Finance, Google Finance, 한국거래소(KRX), 금융감독원 전자공시(DART) 등 공개 데이터를 활용하나, 이들 데이터의 정확성·완전성을 보증하지 않습니다.</p>
        <p>투자 전 해당 종목의 공시자료(사업보고서, 잠정실적 공시 등)를 직접 확인하시기 바랍니다.</p>
      </Section>

      <Section title="5. 책임 제한">
        <p>CBST 및 애빛다는 본 서비스의 정보를 이용한 투자 결정으로 발생하는 손실·손해에 대해 어떠한 법적 책임도 지지 않습니다. 서비스 이용은 이용자 본인의 판단과 책임 하에 이루어집니다.</p>
      </Section>

      <Section title="6. 전문가 상담 권고">
        <p>투자 전 공인된 금융투자 전문가(투자자문사, 증권사 리서치센터 등)의 의견을 참고하시기 권고합니다. 세금, 법적 사항 등은 관련 전문가와 상담하시기 바랍니다.</p>
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
