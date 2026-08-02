/**
 * stage-trajectory.ts — 저장된 다년치 재무를 연도별로 훑어 **국면 흐름**과 **주요 전환점**을 뽑는다.
 *
 * "현재 국면" 하나가 아니라, 이 기업이 과거부터 어떻게 흘러왔는지(성장→위축→반등→…)를
 * 연도별로 계산한다. 이게 행간 읽기의 뼈대다 — 흐름이 보여야 "무엇이 언제 바뀌었나"를 짚는다.
 *
 * 각 연도를 "그 해 시점"으로 본다: 그 해 vs 직전 해로 매출성장·마진추세를 내고, 그것으로
 * 실체(펀더멘털) 점수를 매긴다. **기대(밸류에이션) 축은 과거 시세를 저장하지 않아 뺀다**
 * — 흐름의 본체는 실체이고, 기대 프리미엄은 '현재' 판정에서만 얹는다.
 *
 * 데이터 출처: 미국 us_financials, 한국 ticker_financials(연간·매출 있는 연결 행).
 * 여기는 **DB를 모르는 순수 함수**만 둔다 — 연도별 재무를 읽어 넘기는 것은 stage-store가 한다.
 */

import { scoreSubstance, pctChange, capexTrendOf, type SubstanceResult } from "./stage-classifier.js";

/** 흐름 계산에 필요한 연도별 최소 재무 */
export interface FinYear {
  fy: number;
  revenue: number | null;
  operatingIncome: number | null;
  capex?: number | null;
  ccc?: number | null;
}

export interface StageYear {
  fy: number;
  substanceScore: number;
  substanceState: SubstanceResult["state"];
  revGrowthPct: number | null;
  opmPct: number | null;
}

export type ChangeKind =
  | "흑자전환" | "적자전환" | "성장가속" | "성장둔화"
  | "역성장전환" | "반등" | "마진급개선" | "마진급악화";

export interface MajorChange {
  fy: number;
  kind: ChangeKind;
  detail: string;
}

const opmOf = (y: FinYear): number | null =>
  y.revenue != null && y.revenue > 0 && y.operatingIncome != null ? y.operatingIncome / y.revenue : null;

/**
 * 연도별 국면 점수를 계산한다. 각 해는 직전 해 대비 신호로 실체 점수를 매기고,
 * 직전 점수를 넘겨 반등(턴어라운드)까지 이어서 본다.
 */
export function computeYearlyStages(years: FinYear[]): StageYear[] {
  const out: StageYear[] = [];
  let prevScore: number | null = null;
  for (let i = 1; i < years.length; i++) {
    const y = years[i], p = years[i - 1];
    const opmL = opmOf(y), opmP = opmOf(p);
    const sig = {
      revGrowthPct: pctChange(y.revenue, p.revenue),
      opmDeltaPp: opmL != null && opmP != null ? (opmL - opmP) * 100 : null,
      // capex는 그 해까지의 추세, ccc는 전년 대비(있으면)
      capexTrend: y.capex != null ? capexTrendOf(years.slice(0, i + 1).map(v => v.capex ?? null)) : null,
      cccDeltaDays: y.ccc != null && p.ccc != null ? y.ccc - p.ccc : null,
      priorSubstanceScore: prevScore,
    };
    const s = scoreSubstance(sig);
    out.push({
      fy: y.fy,
      substanceScore: s.score,
      substanceState: s.state,
      revGrowthPct: sig.revGrowthPct,
      opmPct: opmL != null ? opmL * 100 : null,
    });
    prevScore = s.score;
  }
  return out;
}

/**
 * 흐름에서 **주요 전환점**을 뽑는다 — 사람이 "여기서 뭔가 바뀌었다"고 볼 지점.
 * 상태 전환(성장↔위축·반등)과 큰 폭의 매출·마진·손익 변화를 잡는다.
 */
export function detectMajorChanges(years: FinYear[], stages: StageYear[]): MajorChange[] {
  const changes: MajorChange[] = [];
  const byFy = new Map(years.map(y => [y.fy, y]));

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i], prev = stages[i - 1];
    const y = byFy.get(s.fy)!;
    const p = years[years.findIndex(v => v.fy === s.fy) - 1];

    // 손익 부호 전환 (흑자전환/적자전환)
    if (p && y.operatingIncome != null && p.operatingIncome != null) {
      if (p.operatingIncome < 0 && y.operatingIncome >= 0)
        changes.push({ fy: s.fy, kind: "흑자전환", detail: `영업이익 적자 → 흑자 (${s.fy})` });
      else if (p.operatingIncome >= 0 && y.operatingIncome < 0)
        changes.push({ fy: s.fy, kind: "적자전환", detail: `영업이익 흑자 → 적자 (${s.fy})` });
    }

    // 매출 급변
    if (s.revGrowthPct != null) {
      if (s.revGrowthPct >= 40) changes.push({ fy: s.fy, kind: "성장가속", detail: `매출 +${s.revGrowthPct.toFixed(0)}% 급증` });
      else if (s.revGrowthPct <= -15) changes.push({ fy: s.fy, kind: "역성장전환", detail: `매출 ${s.revGrowthPct.toFixed(0)}% 급감` });
    }

    // 마진 급변(전년 대비 5%p 이상)
    if (prev && s.opmPct != null && prev.opmPct != null) {
      const d = s.opmPct - prev.opmPct;
      if (d >= 5) changes.push({ fy: s.fy, kind: "마진급개선", detail: `OPM ${prev.opmPct.toFixed(0)}% → ${s.opmPct.toFixed(0)}%` });
      else if (d <= -5) changes.push({ fy: s.fy, kind: "마진급악화", detail: `OPM ${prev.opmPct.toFixed(0)}% → ${s.opmPct.toFixed(0)}%` });
    }

    // 국면 상태 전환
    if (prev && prev.substanceState !== s.substanceState) {
      if (s.substanceState === "rebounding") changes.push({ fy: s.fy, kind: "반등", detail: `위축에서 반등으로 (실체 ${prev.substanceScore}→${s.substanceScore})` });
      else if (s.substanceState === "contracting" && prev.substanceState !== "contracting") changes.push({ fy: s.fy, kind: "성장둔화", detail: `실체 위축 국면 진입 (${prev.substanceState}→위축)` });
    }
  }
  // 같은 해 중복 종류 제거
  const seen = new Set<string>();
  return changes.filter(c => { const k = `${c.fy}:${c.kind}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export interface Trajectory {
  years: StageYear[];
  changes: MajorChange[];
}

const STATE_KO: Record<SubstanceResult["state"], string> = {
  strong: "성장", slowing: "둔화", contracting: "위축", rebounding: "반등",
};

/**
 * 국면 흐름과 전환점을 프롬프트 블록으로 만든다. **LLM은 이 흐름을 근거로
 * "성장·쇠퇴·턴어라운드 중 어디인가"를 서술한다** — 숫자는 서버가 이미 계산했다.
 */
export function renderTrajectory(tj: Trajectory): string {
  if (tj.years.length < 2) return "";
  const flow = tj.years
    .map(y => `${y.fy} ${STATE_KO[y.substanceState]}${y.revGrowthPct != null ? `(매출 ${y.revGrowthPct >= 0 ? "+" : ""}${y.revGrowthPct.toFixed(0)}%)` : ""}`)
    .join(" → ");
  const lines = [
    "",
    "[📈 사업 국면 흐름 — 서버가 연도별 재무로 계산한 실체 궤적]",
    `· ${flow}`,
  ];
  if (tj.changes.length > 0) {
    lines.push("", "[⚡ 주요 전환점 — 코드가 짚은 '무엇이 언제 바뀌었나']");
    for (const c of tj.changes) lines.push(`· ${c.fy} [${c.kind}] ${c.detail}`);
  }
  lines.push(
    "",
    "⚠️ 이 흐름은 재무로 계산한 **실체(펀더멘털)** 궤적입니다. 이걸 근거로 이 기업이",
    "   성장·쇠퇴·턴어라운드 중 어디에 있는지, 최근 변화가 추세인지 일시적인지 서술하세요.",
  );
  return lines.join("\n");
}

/** 연도별 재무(오름차순)로부터 궤적 + 전환점을 한 번에. DB 로딩은 stage-store가 한다. */
export function buildTrajectory(fin: FinYear[]): Trajectory {
  if (fin.length < 2) return { years: [], changes: [] };
  const years = computeYearlyStages(fin);
  const changes = detectMajorChanges(fin, years);
  return { years, changes };
}
