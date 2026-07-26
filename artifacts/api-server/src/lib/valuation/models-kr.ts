/**
 * models-kr.ts — 한국 시장 및 공통 밸류에이션 모델 정의.
 *
 * 각 모델의 도메인 지식(금지 사항·산출 절차·배수 범위)은 기존 프롬프트에서
 * 그대로 옮겼다. 반복되던 조율 절차와 FINAL_VALUATION_DATA 매핑만 공통 뼈대로
 * 빼내 model-registry.ts가 렌더링한다.
 *
 * 가중치(absWeight) 기준:
 *   0.7 — 자산 실물이 뒷받침하는 NAV 계열(리츠·자원). 상대가치보다 근거가 단단하다.
 *   0.6 — 추정이 많이 들어가는 현금흐름·합산 계열(DCF·SOTP).
 *   0.55 — 절대·상대 모두 회계 지표에 의존해 신뢰도 차이가 작은 경우(금융).
 */

import type { ValuationModel } from "./model-registry.js";

export const DCF: ValuationModel = {
  key: "dcf",
  label: "DCF",
  absName: "DCF 내재가치",
  relName: "피어 멀티플 목표가",
  absWeight: 0.6,
  absProcedure: `- FCFF 기반 DCF로 내재가치를 산출하세요(가정 표는 위 모델 가정 섹션 참조).
- 주당 내재가치 = (기업가치 − 순차입금) ÷ 발행주식수 = __(현지통화/주)`,
  relProcedure: `- 피어 그룹의 EV/EBITDA·PER·PBR 중 사업 구조에 맞는 배수를 적용하세요.
- 적용 배수와 피어 중앙값 대비 할인·프리미엄 근거를 1줄로 명시하세요.
- 피어 멀티플 목표가 = __(현지통화/주)`,
  bands: `Bear: 매출 성장 둔화·마진 압박 시나리오 = __(현지통화)
Bull: 핵심 촉매 실현 시나리오 = __(현지통화)`,
};

export const RNPV_KR: ValuationModel = {
  key: "rnpv_kr",
  label: "rNPV",
  rationale: `⛔ 영업적자 임상단계 바이오텍은 DCF 사용 금지 — rNPV(위험조정 순현재가치)만 사용합니다.
⛔ 한국 허가 완료 제품에 임상 PoS를 다시 적용하는 이중할인 금지.`,
  absName: "rNPV Sum of Parts 주당가치",
  relName: "피어 멀티플(EV/Sales 또는 PBR) 목표가",
  absWeight: 0.7,
  absProcedure: `- 파이프라인 자산별 rNPV를 합산하세요(팀장 검수 체크리스트 반영 후 값 사용).
- WACC 고정: Phase 1 18% / Phase 2 16% / Phase 3 14% / 국내 허가완료 12%.
  CAPM·Beta 계산 과정을 서술하지 마세요. 선택 근거 1줄만 기재합니다.
- 완전희석 주식수(CB·BW·스톡옵션 전환 포함) 기준으로 주당가치를 산출하세요.
- rNPV 주당가치 = __(현지통화/주)`,
  relProcedure: `- 코스닥 바이오 피어의 EV/Sales 중앙값(3~8x) 또는 PBR을 적용하세요.
- 피어 목표가 = __(현지통화/주)`,
  bands: `Bear: 핵심 파이프라인 PoS 하향 시나리오 = __(현지통화)
Bull: 급여 등재·기술수출 등 촉매 실현 시나리오 = __(현지통화)
⚠️ Bull은 Bear의 5배를 초과할 수 없습니다. 초과 시 Bull 가정(Peak Sales 또는 PoS)을
   하향 조정하세요. 이 제약은 현재가와 무관하게 Bear 절대값 기준으로 적용됩니다.`,
  crossCheck: `EV/Sales 현실성 앵커: 최근 연간 매출 × 코스닥 바이오 피어 EV/Sales 중앙값(3~8x)으로
'앵커 시가총액'을 구하세요. rNPV 합산이 앵커의 10배 이상이면 Peak Sales 또는 PoS 가정을
낮춰 재계산하고, 그 결과를 최종 밸류에이션으로 사용합니다.`,
};

export const SOTP: ValuationModel = {
  key: "sotp",
  label: "SOTP",
  rationale: `SOTP는 **절대가치 산출 방법**입니다. 복합기업은 사업부별 특성이 달라 단일 배수로는
평가할 수 없으므로 SOTP를 절대가치의 Lead로 쓰지만, 상대가치(피어)와 조율하는 절차는
다른 모델과 동일하게 거칩니다. 시장이 이 회사를 어떻게 보는지도 목표주가에 반영되어야 합니다.`,
  absName: "SOTP 절대가치",
  relName: "피어 멀티플 목표가",
  absWeight: 0.6,
  absProcedure: `- 사업부·자회사별로 매출·영업이익과 적용 모델·배수를 표로 정리하고 EV를 산출하세요.
  ⚠️ EV = 배수 × 기준값입니다. EV/Sales는 매출에, EV/EBITDA는 EBITDA에 곱하세요.
     자릿수를 반드시 확인하세요 — 서버가 이 산수를 검산하며 어긋나면 반려됩니다.
- SOTP 주당 NAV(할인 전) = (사업부 EV 합계 − 순차입금) ÷ 발행주식수 = __(현지통화/주)
- 지주할인율 적용: NAV × (1 − __%할인) = __(현지통화/주)  ← SOTP 절대가치
  ※ 지주할인율은 순수 지주회사(자회사 지분가치가 대부분)에만 적용합니다.
    사업부를 직접 영위하는 복합기업은 할인 없음(0%)이 기본이며, 적용 시 근거 1줄 필수.`,
  relProcedure: `- 매출·이익 비중이 가장 큰 주력 사업의 피어를 기준으로 멀티플 목표가를 산출하세요.
  ⛔ "복합기업이라 비교 불가"로 생략하는 것을 금지합니다.
- 피어 멀티플 목표가 = __(현지통화/주)`,
  bands: `Bear/Bull: 사업부별 실적·배수 시나리오를 반영해 산출하세요.
(SOTP NAV에 할인율 상·하단만 적용하는 단순 방식은 순수 지주회사에만 허용)`,
  crossCheck: `순수 투자지주(SK스퀘어·삼성물산 등 보유지분이 가치 전체인 경우):
- DCF는 적용 불가(본체 영업현금흐름이 배당 수입뿐이라 신뢰도가 극히 낮음).
- 상대가치는 동종 지주회사 P/NAV 중앙값으로 산출하세요(한국 통상 40~70%,
  피어 데이터가 없으면 중앙값 55% 사용 후 근거 명시).
- P/NAV = 현재주가 ÷ 주당 NAV × 100. 100% 미만이면 할인 거래 중(몇 % 할인인지 명시).
- 지주할인율과 피어 P/NAV는 같은 현상의 다른 표현이므로 두 값이 20% 이내로 수렴하는 것이
  정상입니다. 크게 벌어지면 할인율 가정을 재검토하세요.`,
};

export const REIT_KR: ValuationModel = {
  key: "reit_kr",
  label: "NAV+P/FFO",
  rationale: `⛔ 리츠는 일반 DCF 단독 목표주가 사용 금지 (D&A가 비현금 → 순이익·EBITDA 왜곡).`,
  absName: "NAV 기반 목표주가",
  relName: "P/FFO 기반 목표주가",
  absWeight: 0.6,
  absProcedure: `[NAV 방법론 — 단위 변환 필수]
① NOI(억원) = 임대수익 − 운영비 (이자·세금 제외)
② 부동산 공정가치(억원) = NOI ÷ 적용 Cap Rate
   Cap Rate 기준: 물류 3~5%, 오피스 4~6%, 리테일 5~8%, 주거 3~5%
③ NAV(억원) = 부동산 공정가치 합계 − 총차입금 + 현금
④ 주당 NAV(원) = NAV(억원) × 100,000,000 ÷ 발행주식수
⑤ P/NAV = 현재주가 ÷ 주당NAV (할인/프리미엄 % 명시)`,
  relProcedure: `[P/FFO 방법론 — 단위 변환 필수]
① FFO(억원) = 순이익 + 감가상각 + 부동산 처분손실 − 부동산 처분이익
② AFFO(억원) = FFO − 유지보수 CapEx
③ 주당 FFO(원) = FFO(억원) × 100,000,000 ÷ 발행주식수
④ 적용 P/FFO 배수: __x (한국 리츠 피어 중앙값 8~12x, 이유 1줄)
⑤ P/FFO 기반 목표주가(원) = 주당FFO × 적용배수`,
  bands: `Bear: Cap Rate +1%p 적용 NAV × (1 − 보수적 P/NAV할인) = __원
Bull: Cap Rate −0.5%p 적용 NAV × (1 + 적정 P/NAV프리미엄) = __원`,
  crossCheck: `배당 지속성: FFO Payout Ratio = 주당배당 ÷ 주당FFO × 100(%)
  90% 이하 안정 | 91~100% 주의 | 100% 초과 지급 불가 리스크 경고`,
};

export const PB_ROE: ValuationModel = {
  key: "pb_roe",
  label: "P/B-ROE",
  rationale: `⛔ EV/EBITDA 사용 금지 (이자비용이 영업비용 → EBITDA 개념 무의미).`,
  absName: "Justified P/B × BPS",
  relName: "피어 P/B 비교 목표가",
  absWeight: 0.55,
  absProcedure: `[Justified P/B 산출]
① rf = 국고채 10년물 수익률: __%
② β (업종 평균): __  |  ERP (한국 5~6% 적용): __%
③ CoE = rf + β × ERP = __%
④ ROE (Forward 추정): __%  |  g (장기 성장률): __%
⑤ Justified P/B = (ROE − g) ÷ (CoE − g) = __x  (또는 단순 P/B = ROE ÷ CoE)
[목표주가 — 단위 변환 필수]
- BPS(주당순자산): __원 (최신 분기 자본총계 ÷ 발행주식수)
- 목표주가 = Justified P/B × BPS = __x × __원 = **__원**`,
  relProcedure: `- 피어 P/B 중앙값: __x → 비교 후 할인·프리미엄 이유를 명시하세요.
- 피어 P/B 기반 목표주가 = 적용 P/B × BPS = __원`,
  bands: `Bear: ROE 하락 시나리오 P/B __x × BPS = __원
Bull: ROE 개선 시나리오 P/B __x × BPS = __원`,
  crossCheck: `ROE-CoE 스프레드 해석:
- 양수(ROE > CoE): 초과수익 창출 → P/B > 1x 정당화
- 음수(ROE < CoE): 자본 훼손 → P/B < 1x 합리적
- 스프레드 변화 방향이 멀티플 재평가의 핵심 트리거입니다.`,
};

export const RESOURCE_NAV: ValuationModel = {
  key: "resource_nav",
  label: "자산NAV",
  rationale: `⛔ 스팟 원자재 가격 기반 단순 EV/EBITDA 사용 금지 (사이클 왜곡).`,
  absName: "자산 NAV 기반 목표주가",
  relName: "Mid-cycle EV/EBITDA 목표주가",
  absWeight: 0.7,
  absProcedure: `① 핵심 가격 가정: [원자재명] 장기 균형가격 = $__/톤 (컨센서스 또는 AISC + 적정마진 근거)
② AISC = $__/톤 (현금비용 + 유지CapEx + G&A + 탐사비 포함)
③ 연간 생산량: __만톤 × 광산 수명 __년
④ NAV = Σ((장기가격 − AISC) × 생산량) ÷ WACC(__%) − 개발비 − 순부채
⑤ 주당 NAV(원) = NAV(억원) × 100,000,000 ÷ 발행주식수 = __원
⑥ P/NAV 배수: __x (탐사 upside 프리미엄 또는 운영 리스크 할인 이유 1줄)
⑦ NAV 기반 목표주가 = 주당NAV × 적용 P/NAV = __원`,
  relProcedure: `① 정상화 EBITDA = 장기 균형가격 적용 시 예상 EBITDA (스팟가 EBITDA 아님)
② 피어 Mid-cycle EV/EBITDA 배수: __x
③ 목표주가 = (정상화 EBITDA × 배수 − 순부채) ÷ 주식수 = __원`,
  bands: `Bear: 장기가격 −20% 가정 NAV = __원
Bull: 장기가격 +15% + P/NAV 프리미엄 확대 = __원`,
};

export const RNAV_PBV: ValuationModel = {
  key: "rnav_pbv",
  label: "RNAV+P/BV",
  rationale: `⛔ RNAV 산출은 컨텍스트에 분양 예정 사업의 현장명·세대수·분양가가 명시된 경우에만 합니다.
   해당 데이터가 없으면 RNAV를 건너뛰고 P/BV를 절대가치로 사용하세요.
   "RNAV 산출 불가"라는 문장을 쓰는 것도 금지합니다 — 그냥 P/BV로 시작하세요.`,
  absName: "RNAV 기반 목표주가",
  relName: "피어 P/BV 비교 목표가",
  absWeight: 0.6,
  absProcedure: `[RNAV(주택자산재평가) — 단위 변환 필수]
① 분양 예정 사업 목록 (컨텍스트에 명시된 현장만 — 추정 불가 사업 제외):
   | 현장명 | 세대수 | 분양가(3.3m²당) | 수익률 가정 | 성적률 가정 | 할인율 | PV 기여(억원) |
② RNAV 합계(억원) = Σ 각 현장 PV 기여값
③ 보유 토지 공정가치(억원) (데이터 없으면 장부가 사용)
④ 조정 NAV(억원) = RNAV + 토지 공정가치 − 순부채 − PF 보증 예상 손실 충당금
⑤ 주당 RNAV(원) = 조정 NAV × 100,000,000 ÷ 발행주식수
⑥ 적정 P/RNAV 배수: __x (대형 우량 0.8~1.3x, 중소 0.4~0.8x, 이유 1줄)
⑦ RNAV 기반 목표주가 = 주당RNAV × P/RNAV 배수 = **__원**`,
  relProcedure: `- 피어 P/BV 중앙값(대형 0.4~1.0x)을 적용해 목표가를 산출하세요.
- 피어 P/BV 기반 목표주가 = 적용 P/BV × BPS = __원`,
  bands: `Bear: 분양 성적률 −20%p 시나리오 = __원
Bull: 분양 성적률 정상 + 토지가치 추가 상승 = __원`,
  crossCheck: `수주잔고 Coverage = 수주잔고 ÷ 연간매출 (2.0배 이상 안정, 1.5배 이하 수주 부진)
미청구공사 ÷ 매출 = __% (10% 초과 시 대손 가능성 → RNAV 보정)`,
};

export const RAB: ValuationModel = {
  key: "rab",
  label: "EV/EBITDA+배당",
  rationale: `⛔ 단기 PER 사용 금지 (연료비 급등 시 일시 대규모 손실로 왜곡).`,
  absName: "정상화 EV/EBITDA 목표주가",
  relName: "배당수익률 역산 목표주가",
  absWeight: 0.6,
  absProcedure: `- 정상화 EBITDA = 연료비 정상화 적용 EBITDA = __억원 (연료비 급등 효과 제거)
- 피어 EV/EBITDA 배수: __x (한국 유틸리티 6~10x)
- 목표주가 = (정상화 EBITDA × 배수 − 순부채) ÷ 주식수 = __원`,
  relProcedure: `- 기대 DPS = __원 (배당성향·FCF 기반)
- 목표 배당수익률 = 국고채 10년(__%) + 유틸리티 리스크 프리미엄(__%) = __%
- 배당 역산 목표주가 = DPS ÷ 목표 배당수익률 = __원`,
  bands: `Bear: 요금 동결 + 연료비 추가 상승 = __원
Bull: 요금 인상 승인 + 연료비 정상화 = __원`,
  crossCheck: `[RAB(규제자산기반) 점검]
① RAB = 정부 인가 규제자산 규모 (공시 또는 재무제표 유형자산 기준)
② 규제 허용 ROE = __% (정부 고시 허용 수익률)
③ 요금 단가 __원/kWh(or MJ) vs 원가 단가 __원 → 갭 = __(원가초과/이익)
④ 연료비 민감도: LNG $10/MMBtu 변화 시 영업이익 ±__억원
⑤ EV/RAB 피어 배수 __x 로 환산한 참고 목표주가 = __원`,
};

export const EV_OPFCF: ValuationModel = {
  key: "ev_opfcf",
  label: "EV/EBITDA+EV/OpFCF",
  rationale: `⛔ 높은 D&A로 PER 단독 사용 금지.`,
  absName: "EV/OpFCF 목표주가",
  relName: "피어 EV/EBITDA 목표주가",
  absWeight: 0.6,
  absProcedure: `[OpFCF(영업잉여현금) 산출]
① EBITDA = 영업이익 + 감가상각(D&A) = __억원
② CapEx = __억원 (5G 인프라 투자 포함)
③ OpFCF = EBITDA − CapEx = __억원
④ OpFCF Yield = OpFCF ÷ EV × 100 = __%
- 피어 EV/OpFCF 배수 __x (한국 통신 8~14x) → 목표주가 = __원`,
  relProcedure: `- 피어 EV/EBITDA 배수 __x → EV 추정 → 순차입금 차감 → 목표주가 = __원`,
  bands: `Bear: ARPU 하락 + CapEx 증가 = __원
Bull: 신사업 ARPU 기여 + CapEx 절감 = __원`,
  crossCheck: `ARPU 추이 __원 (YoY ±__%) | 해지율 __% (전년 __% 대비 __bp 변동)
배당수익률 역산 참고: DPS __원 ÷ 목표 배당수익률 __% = __원`,
};
