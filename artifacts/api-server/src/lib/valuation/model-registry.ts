/**
 * model-registry.ts — 밸류에이션 모델 정의와 선택.
 *
 * 왜 만들었나: 모델별 지시 블록 17개(654줄)가 **모든 종목의 프롬프트에 무조건**
 * 들어가고 있었다. 삼성전자를 분석하면서 리츠 Cap Rate 규칙, 은행 CCAR 규칙,
 * 광산 AISC 규칙을 함께 읽는 구조였다. 프롬프트 안내문에는 "아래 두 형식 중
 * 하나를 선택하세요"라고 적혀 있는데 실제로는 17개였다 — 업종을 늘려오며 쌓인 흔적이다.
 *
 * 구조:
 *   ① 업종 감지 → 모델 1개 선택 (선택된 것만 프롬프트에 주입)
 *   ② 절대가치·상대가치가 무엇인지와 가중치만 모델별로 다르게 둔다
 *   ③ 조율 절차·FINAL_VALUATION_DATA 매핑은 공통 뼈대 1벌로 통일
 *
 * 예전에는 조율 규칙이 모델마다 제각각이었다 — 60:40, 70:30, 50:40:10, 40:40:20이
 * 근거 없이 섞였고 괴리 처리가 있는 블록과 없는 블록이 공존했다. SOTP는 3-way를
 * 금지하는데 유틸리티는 3-way를 시키기도 했다. 이제 2자 조율로 통일하고,
 * 세 번째 방법이 필요한 업종은 `crossCheck`(보조 검증)로 분리한다.
 */

export type ValuationModelKey =
  | "dcf"            // 기본값 — 일반 사업회사
  | "rnpv_kr"        // 한국 바이오
  | "rnpv_us"        // 미국 바이오 (FDA 이벤트)
  | "sotp"           // 복합기업·지주사
  | "sotp_bigtech"   // 빅테크 세그먼트 SOTP
  | "reit_kr"        // 한국 리츠
  | "reit_us"        // 미국 리츠
  | "pb_roe"         // 한국 금융
  | "tbv_rotce"      // 미국 은행
  | "resource_nav"   // 자원·광산
  | "rnav_pbv"       // 건설·주택개발
  | "rab"            // 유틸리티·공기업
  | "ev_opfcf"       // 통신
  | "mlp"            // MLP
  | "bdc"            // BDC
  | "royalty"        // 로열티·스트리밍
  | "defense_us";    // 미국 방산

export interface ValuationModel {
  key: ValuationModelKey;
  /** 프롬프트 제목에 쓰는 이름 */
  label: string;
  /** 이 모델을 쓰는 이유와 금지 사항. 없으면 생략 */
  rationale?: string;
  /** 절대가치 방법 이름 (예: "DCF 내재가치") */
  absName: string;
  /** 상대가치 방법 이름 (예: "피어 멀티플 목표가") */
  relName: string;
  /**
   * 조율 시 절대가치 가중치(0~1). 절대가치 방법의 신뢰도가 높을수록 크다.
   * 자산 실물이 뒷받침하는 NAV 계열은 0.7, 추정이 많이 들어가는 현금흐름 계열은 0.6.
   */
  absWeight: number;
  /** 절대가치 산출 절차 (모델 고유 도메인 지식) */
  absProcedure: string;
  /** 상대가치 산출 절차 */
  relProcedure: string;
  /** 시나리오 밴드 산출 지침 */
  bands: string;
  /** 조율에 넣지 않고 별도로 확인만 하는 보조 지표. 예전 3-way의 세 번째 방법 */
  crossCheck?: string;
}

/** 조율 절차 — 모든 모델이 같은 형식을 쓴다 */
export function renderReconciliation(m: ValuationModel): string {
  const a = Math.round(m.absWeight * 100);
  const r = 100 - a;
  return `[③ 조율 — 절대가치와 상대가치를 맞춘다]
- ${m.absName}: __(현지통화/주)  |  ${m.relName}: __(현지통화/주)
- 괴리율: __%

괴리율 20% 이내: 가중평균 (${m.absName} ${a}% + ${m.relName} ${r}%)
  = __ × ${(m.absWeight).toFixed(1)} + __ × ${(1 - m.absWeight).toFixed(1)} = **__(현지통화)**

괴리율 20% 초과: 아래 형식으로 **한 번만** 작성하세요 (별도 섹션 추가 금지):
1. 괴리 원인 진단: ${m.absName} 입장 1~2문장 + ${m.relName} 입장 1~2문장
2. 가중치 조정 및 최종 조율가: (${m.absName} × a% + ${m.relName} × b%) = **최종 목표가 __(현지통화)**

⚠️ 괴리율 30% 초과 시: 어느 방법론에 더 신뢰를 두는지 논리적 근거를 2~3문장으로 명시 의무.
⛔ 3개 이상 방법론의 단순 평균 금지 — 절대가치 1개, 상대가치 1개로 확정한 뒤 2자 조율하세요.`;
}

/** FINAL_VALUATION_DATA 매핑 — 모델마다 반복하던 것을 한 곳으로 */
export function renderJsonMapping(m: ValuationModel): string {
  return `⚠️ FINAL_VALUATION_DATA JSON 작성 시:
  - base/bear/bull = **조율 후** 최종 목표주가 (한쪽 방법론의 값이 아님)
  - abs_base/abs_bear/abs_bull = ${m.absName} 산출값
  - rel_base/rel_bear/rel_bull = ${m.relName} 산출값
  - abs_model = "${m.label}"
  - current = 현재 주가
  ✅ abs와 rel은 서로 다른 값이 정상입니다 — 각 방법론의 실제 산출값을 넣으세요.
  ❌ 같은 값을 복사해 넣는 것을 금지합니다(조율 과정이 사라져 검증이 불가능해집니다).`;
}

/** 선택된 모델 하나만 프롬프트로 만든다 */
export function renderModelBlock(m: ValuationModel): string {
  return [
    `## ⚖️ 밸류에이션 모델: ${m.label}`,
    m.rationale ? `\n${m.rationale}` : "",
    `\n[① 절대가치 — ${m.absName}]\n${m.absProcedure}`,
    `\n[② 상대가치 — ${m.relName}]\n${m.relProcedure}`,
    `\n${renderReconciliation(m)}`,
    `\n[④ 시나리오 밴드]\n${m.bands}`,
    m.crossCheck ? `\n[보조 검증 — 조율에는 넣지 않고 확인만]\n${m.crossCheck}` : "",
    `\n${renderJsonMapping(m)}`,
  ].filter(Boolean).join("\n");
}
