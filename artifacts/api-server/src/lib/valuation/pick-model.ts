/**
 * pick-model.ts — "이 종목은 어떤 밸류에이션 모델로 보는가"를 정하는 **유일한 창구**.
 *
 * 왜 따로 두는가. 이 판정이 필요한 곳이 둘 이상이다.
 *   · 프롬프트 조립 — 어떤 모델 블록과 서식을 넣을지
 *   · QC 조율 검산 — 절대·상대 가중치가 얼마여야 하는지
 *
 * 예전에 pipeline과 ai-agents가 업종을 각자 판정했다가, 삼성바이오로직스가 한쪽에서는
 * "rNPV 필수"를 받고 다른 쪽에서는 DCF를 배정받는 일이 있었다. 같은 실수를 반복하지
 * 않도록 판정은 여기 하나만 둔다.
 *
 * 감지 함수(needsXxx)는 ai-agents가 소유하므로 그쪽에서 주입받는다 — 순환 참조를
 * 피하려고 감지 결과(SectorFlags)를 인자로 받는 형태가 아니라, ai-agents가 이 파일의
 * setDetectors()로 감지기를 등록하는 방식을 썼다.
 */

import { selectValuationModel, type SectorFlags } from "./select-model.js";
import type { ValuationModel } from "./model-registry.js";

/** (industry, companyName, ticker, opm) → 업종 감지 결과 */
export type FlagDetector = (
  industry: string,
  companyName: string,
  ticker?: string,
  opm?: number | null,
) => SectorFlags;

let detect: FlagDetector | null = null;

/**
 * 감지기를 등록한다. ai-agents가 모듈 적재 시 한 번 부른다.
 * 이 방향(ai-agents → pick-model)이라야 순환 참조가 생기지 않는다.
 */
export function setFlagDetector(fn: FlagDetector): void {
  detect = fn;
}

/**
 * 종목에 맞는 모델 하나를 고른다.
 * 감지기가 아직 등록되지 않았으면(테스트에서 ai-agents를 안 불러온 경우) DCF로 둔다 —
 * 판정을 못 한다고 분석을 막지는 않는다.
 */
export function pickModel(
  industry: string,
  companyName: string,
  ticker?: string,
  opm?: number | null,
): ValuationModel {
  const flags = detect ? detect(industry, companyName, ticker, opm) : {};
  return selectValuationModel(flags);
}
