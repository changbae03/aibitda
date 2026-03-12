export type AgentKey =
  | "industry_analysis"
  | "company_analysis"
  | "market_analysis"
  | "catalyst_analysis"
  | "investment_strategy";

export interface AgentInfo {
  name: string;
  role: string;
  number: string;
}

export const AGENTS: Record<AgentKey, AgentInfo> = {
  industry_analysis: {
    name: "Macro & Industry Analyst",
    role: "에이전트 1",
    number: "1",
  },
  company_analysis: {
    name: "Fundamental & Valuation Analyst",
    role: "에이전트 2",
    number: "2",
  },
  market_analysis: {
    name: "Market & Technical Analyst",
    role: "에이전트 3",
    number: "3",
  },
  catalyst_analysis: {
    name: "Catalyst & Smart Money Analyst",
    role: "에이전트 4",
    number: "4",
  },
  investment_strategy: {
    name: "Lead Portfolio Strategist",
    role: "팀장",
    number: "0",
  },
};

export const STEP_ORDER: AgentKey[] = [
  "industry_analysis",
  "company_analysis",
  "market_analysis",
  "catalyst_analysis",
  "investment_strategy",
];

export function buildPrompt(
  stepKey: AgentKey,
  ticker: string,
  companyName: string,
  industry: string,
  additionalContext: string | null | undefined,
  previousSteps: Array<{ stepKey: string; agentName: string; content: string }>
): { systemPrompt: string; userPrompt: string } {
  const baseContext = `종목: ${ticker} (${companyName})
산업: ${industry}${additionalContext ? `\n추가 컨텍스트: ${additionalContext}` : ""}`;

  const previousContext =
    previousSteps.length > 0
      ? `\n\n이전 분석 결과:\n${previousSteps
          .map((s) => `[${s.agentName}]\n${s.content}`)
          .join("\n\n---\n\n")}`
      : "";

  const COMMON_RULES = `출력 형식 규칙 (반드시 준수):
- 마크다운 형식으로 작성하세요
- 섹션 제목은 ## (이모지 포함), 소제목은 ### 을 사용하세요. 예: ## 🏭 산업 구조
- 섹션 제목(##) 뒤에 반드시 빈 줄을 하나 추가하세요
- 핵심 수치, 중요 용어, 결론은 **굵게** 표시하세요
- 일반 설명은 문장으로, 세부 항목은 - 로 구분하세요 (제목과 항목을 동일하게 - 로 쓰지 마세요)
- 섹션 사이에는 반드시 빈 줄을 넣어 가독성을 높이세요
- 사용자에게 추가 입력을 요청하지 말 것
- 컨텍스트에 Yahoo Finance 실제 재무 데이터가 제공됩니다. 수치는 반드시 이 데이터에서 직접 인용하세요
- 데이터가 없는 항목은 "데이터 없음"으로 표시하고 추측하지 마세요`;

  const prompts: Record<AgentKey, { systemPrompt: string; userPrompt: string }> = {
    industry_analysis: {
      systemPrompt: `당신은 AI 헤지펀드 리서치 팀의 Macro & Industry Analyst(에이전트 1)입니다.
역할: 산업 구조, 성장률, 정책 환경, 경쟁 구도, 매크로 리스크를 분석합니다.
${COMMON_RULES}`,
      userPrompt: `${baseContext}${previousContext}

아래 항목을 분석하세요:

1. 산업 구조 및 성장성
   - 시장 규모(TAM), 성장률(CAGR)
   - 밸류체인 핵심 구조
   - 기술 변화 트렌드

2. 경쟁 구도
   - 주요 경쟁사 및 시장 점유율
   - Porter's Five Forces 요약
   - ${companyName}의 경쟁 우위

3. 정책 및 매크로 환경
   - 금리, 유동성 환경이 이 산업에 미치는 영향
   - 관련 정부 정책, 규제 방향
   - 지정학 리스크

4. 산업 사이클 위치
   - 현재 사이클 단계 판단
   - 투자 관점 시사점`,
    },

    company_analysis: {
      systemPrompt: `당신은 AI 헤지펀드 리서치 팀의 Fundamental & Valuation Analyst(에이전트 2)입니다.
역할: 사업 구조, 재무 분석, 밸류에이션, 적정 주가를 산출합니다.
${COMMON_RULES}
중요: 컨텍스트의 Yahoo Finance 실제 수치(P/E, P/B, EV/EBITDA, EPS, ROE, FCF 등)를 반드시 그대로 인용하여 분석하세요. 수치 없이 서술만 하는 것은 금지입니다.`,
      userPrompt: `${baseContext}${previousContext}

컨텍스트에 제공된 Yahoo Finance 재무 데이터를 기반으로 아래 항목을 분석하세요:

1. 사업 구조 및 재무 현황
   - 매출·이익 추이 (연간 실적 데이터 직접 인용)
   - 이익률 구조: 매출총이익률, 영업이익률, 순이익률 (실제 수치 기입)
   - FCF, 영업현금흐름 분석

2. 핵심 재무 지표 (실제 수치 기입)
   - ROE, ROA (실제 수치 및 업계 평균 대비 평가)
   - 부채비율(D/E), 유동비율, 당좌비율
   - 보유 현금 vs 총 부채 비교

3. 밸류에이션 (반드시 실제 멀티플 수치 인용)
   - P/E(TTM), P/E(Forward), P/B, EV/EBITDA, EV/매출 (모두 실제 수치 기입)
   - 피어 그룹 평균 멀티플과 비교한 할인/프리미엄 판단
   - DCF 또는 적정 멀티플 기반 Bear / Base / Bull 시나리오별 적정 주가 산출
   - 현재가 대비 상승/하락 여력 (%)

4. EPS 전망 및 성장성
   - 애널리스트 컨센서스 EPS 추정치 인용
   - 매출 성장률, 이익 성장률 트렌드
   - PEG 기반 성장가치 평가`,
    },

    market_analysis: {
      systemPrompt: `당신은 AI 헤지펀드 리서치 팀의 Market & Technical Analyst(에이전트 3)입니다.
역할: 수급 구조, 차트 분석, 진입/목표/손절 전략을 제시합니다.
${COMMON_RULES}`,
      userPrompt: `${baseContext}${previousContext}

아래 항목을 분석하세요:

1. 수급 분석
   - 기관, 외국인 최근 순매수/매도 추이
   - 공매도 비중, 대차잔고 동향
   - 대주주 지분 변동 여부
   - 수급 강도 평가 (강/중/약)

2. 기술적 분석
   - 장기(월봉), 중기(주봉), 단기(일봉) 추세
   - 핵심 지지선 및 저항선
   - RSI, MACD, 볼린저밴드 현황
   - 거래량 패턴

3. 진입 전략
   - 구체적 매수 가격 구간
   - 손절 기준 및 근거
   - 기술적 목표 가격`,
    },

    catalyst_analysis: {
      systemPrompt: `당신은 AI 헤지펀드 리서치 팀의 Catalyst & Smart Money Analyst(에이전트 4)입니다.
역할: 주가 촉매 이벤트, 기관/세력 움직임, 주도주 가능성을 분석합니다.
${COMMON_RULES}`,
      userPrompt: `${baseContext}${previousContext}

아래 항목을 분석하세요:

1. 주가 촉매 이벤트
   - 단기(1-3개월): 실적 발표, 신제품 출시 등
   - 중기(3-12개월): 정책 이벤트, 계약, 구조적 변화
   - 역촉매(리스크 이벤트): 주가 하락 요인

2. 세력 및 스마트머니 움직임
   - 기관 매집 패턴 여부
   - 블록딜 현황
   - 거래대금 이상 패턴

3. 주도주 가능성
   - 테마/섹터 주도주 판단
   - 시장이 아직 반영하지 못한 정보 비대칭
   - 투자 Edge 요약`,
    },

    investment_strategy: {
      systemPrompt: `당신은 AI 헤지펀드 리서치 팀의 Lead Portfolio Strategist(팀장)입니다.
역할: 모든 에이전트 분석을 통합하여 최종 투자 전략을 JSON으로 도출합니다.
원칙:
- 컨텍스트에 Yahoo Finance 실제 재무 데이터가 제공됩니다. 수치는 반드시 이 데이터에서 직접 인용하세요
- 사용자에게 추가 입력을 요청하지 말 것
- 반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트 및 마크다운 금지.`,
      userPrompt: `${baseContext}${previousContext}

모든 에이전트 분석을 검토하고 최종 투자 전략을 도출하세요.

반드시 아래 JSON 형식으로만 응답하세요. 코드블록 없이 순수 JSON만 출력하세요:

{
  "verdict": "Strong Buy / Buy / Hold / Sell / Strong Sell 중 하나",
  "confidence": "높음 / 중간 / 낮음 중 하나",
  "summary": "핵심 투자 논거를 3-4문장으로 요약 (마크다운 볼드 없이)",
  "entry_price": "구체적 진입 가격 또는 가격 구간",
  "target_price": "목표 가격 (업사이드 근거 포함)",
  "stop_loss": "손절 가격 (근거 포함)",
  "investment_period": "단기 / 중기 / 장기",
  "risk_reward": "리스크/리워드 비율 (예: 1:3.5)",
  "risks": [
    "핵심 리스크 1",
    "핵심 리스크 2",
    "핵심 리스크 3"
  ],
  "hypothesis": "투자 가설 1문장 요약",
  "monitoring_indicators": [
    "모니터링 지표 1",
    "모니터링 지표 2",
    "모니터링 지표 3"
  ]
}`,
    },
  };

  return prompts[stepKey];
}
