/**
 * select-model.ts — 업종 감지 결과로 밸류에이션 모델 하나를 고른다.
 *
 * 예전에는 17개 모델 블록이 모든 종목의 프롬프트에 전부 들어갔다. 삼성전자를
 * 분석하면서 리츠 Cap Rate·은행 CCAR·광산 AISC 규칙을 함께 읽는 구조였다.
 * 여기서 하나만 고르고, 고른 것만 주입한다.
 *
 * ⚠️ 순서가 의미를 갖는다. 한 종목이 여러 조건에 걸릴 수 있으므로 **더 좁은 규칙이
 * 먼저** 와야 한다. 예: 한화시스템은 이름에 "한화"가 있어 SOTP 조건에 걸리지만
 * 실제로는 방산 사업회사다. 반대로 SK스퀘어는 진짜 지주회사라 SOTP가 맞다.
 * 그래서 구조가 확실한 것(리츠·금융·MLP 등)을 위에 두고, 포괄적인 SOTP를 아래에 둔다.
 */

import type { ValuationModel, ValuationModelKey } from "./model-registry.js";
import { DCF, RNPV_KR, SOTP, REIT_KR, PB_ROE, RESOURCE_NAV, RNAV_PBV, RAB, EV_OPFCF } from "./models-kr.js";
import { RNPV_US, SOTP_BIGTECH, REIT_US, TBV_ROTCE, DEFENSE_US, MLP, BDC, ROYALTY } from "./models-us.js";

export const ALL_MODELS: Record<ValuationModelKey, ValuationModel> = {
  dcf: DCF,
  rnpv_kr: RNPV_KR,
  rnpv_us: RNPV_US,
  sotp: SOTP,
  sotp_bigtech: SOTP_BIGTECH,
  reit_kr: REIT_KR,
  reit_us: REIT_US,
  pb_roe: PB_ROE,
  tbv_rotce: TBV_ROTCE,
  resource_nav: RESOURCE_NAV,
  rnav_pbv: RNAV_PBV,
  rab: RAB,
  ev_opfcf: EV_OPFCF,
  mlp: MLP,
  bdc: BDC,
  royalty: ROYALTY,
  defense_us: DEFENSE_US,
};

/** buildPrompt가 이미 계산해 둔 업종 감지 결과 */
export interface SectorFlags {
  sotp?: boolean;
  reit?: boolean;
  usReit?: boolean;
  financial?: boolean;
  usBank?: boolean;
  korBiotech?: boolean;
  usBiotech?: boolean;
  resources?: boolean;
  construction?: boolean;
  utility?: boolean;
  telecom?: boolean;
  mlp?: boolean;
  bdc?: boolean;
  royalty?: boolean;
  bigTech?: boolean;
  usDefense?: boolean;
}

/**
 * 우선순위대로 훑어 첫 번째로 걸리는 모델을 쓴다.
 * 어디에도 안 걸리면 일반 사업회사로 보고 DCF.
 */
const PRIORITY: Array<[keyof SectorFlags, ValuationModelKey]> = [
  // ── 구조가 명확해 다른 방법론이 아예 안 맞는 것부터 ──
  ["mlp", "mlp"],                 // 패스스루 — EPS 개념 자체가 없음
  ["bdc", "bdc"],                 // 대출 포트폴리오
  ["royalty", "royalty"],         // 운영 없이 로열티만 수취
  ["usBank", "tbv_rotce"],        // CCAR·TBVPS 체계
  ["financial", "pb_roe"],        // 한국 금융 — P/B-ROE
  ["usReit", "reit_us"],          // AFFO·서브섹터 Cap Rate
  ["reit", "reit_kr"],            // 한국 리츠
  ["usBiotech", "rnpv_us"],       // PDUFA 이벤트
  ["korBiotech", "rnpv_kr"],      // 임상단계 rNPV
  ["resources", "resource_nav"],  // 매장량 NAV
  ["utility", "rab"],             // 규제자산
  ["telecom", "ev_opfcf"],        // 높은 D&A
  ["construction", "rnav_pbv"],   // 분양자산 RNAV
  ["usDefense", "defense_us"],    // EAC 정상화
  ["bigTech", "sotp_bigtech"],    // 세그먼트 SOTP + SBC 조정
  // ── 가장 포괄적인 규칙은 마지막 ──
  ["sotp", "sotp"],               // 복합기업·지주사
];

export function selectValuationModel(flags: SectorFlags): ValuationModel {
  for (const [flag, modelKey] of PRIORITY) {
    if (flags[flag]) return ALL_MODELS[modelKey];
  }
  return DCF;
}
