/**
 * biz-timeline-ground.ts — 출력에 적힌 숫자가 그 연도 원문에 실제로 있는지 대조한다.
 *
 * 이 제품의 전제는 하나다 — **원문에 근거하므로 틀릴 수 없다.**
 * 그런데 첫 시험에서 바로 깨졌다. 메디포스트 분석이 이렇게 썼다.
 *
 *   "2025년 유형자산은 136,795백만원으로, 2024년과 동일하게
 *    제대혈 보관탱크 취득 517백만원, 기타 생산 및 영업설비 투자 2,126백만원"
 *
 * 저 세 숫자는 **2024년 원문에만 있고 2025년 원문에는 없다.** 지어낸 것이다.
 *
 * 목표주가에는 없던 성질이 여기에 있다 — **기계가 대조할 수 있다.**
 * 목표가 24,000원이 맞는지는 1년을 기다려야 알지만, "2025년에 136,795가 있나"는
 * 지금 당장 확인된다. 그래서 이 검증기가 성립하고, 이것이 이 방향의 핵심 자산이다.
 *
 * DB를 모르는 순수 함수만 둔다.
 */

export interface YearSource {
  bsnsYear: number;
  content: string;
}

export interface UngroundedClaim {
  year: number;
  value: string;
  /** 그 숫자가 실제로 등장하는 연도들 (없으면 빈 배열) */
  foundIn: number[];
  line: string;
}

/**
 * 검증 대상 숫자의 최소 자릿수.
 *
 * 3자리 미만은 걸러낸다 — "3개년", "2상", "1위" 같은 것까지 대조하면 잡음만 는다.
 * 금액·비중처럼 원문에서 그대로 옮겨야 하는 값은 대개 쉼표가 있거나 네 자리 이상이다.
 */
const MIN_DIGITS = 3;

/** 숫자 표기를 비교용으로 통일한다 (쉼표·공백 제거) */
function normalize(n: string): string {
  return n.replace(/[,\s]/g, "");
}

/**
 * 한 줄에서 "N년 … 숫자" 형태의 주장을 뽑는다.
 *
 * 줄 안에 연도가 여럿이면(예: "2024년과 2025년") 그 줄의 숫자는 어느 해 것인지
 * 단정할 수 없으므로 **검증하지 않는다.** 틀렸다고 몰아붙이는 것보다 넘기는 편이 낫다.
 */
function claimsInLine(line: string): { year: number; values: string[] } | null {
  const years = [...new Set([...line.matchAll(/(20\d{2})\s*년/g)].map(m => Number(m[1])))];
  if (years.length !== 1) return null;

  // **단위가 붙은 수치만** 검증한다.
  //
  // 처음에는 줄 안의 모든 숫자를 대조했는데, 잡힌 것의 대부분이 날짜였다 —
  // "2022년: … 대표이사 변경(2022.08.08)" 같은 문장에서 2022년 사건을 2023년
  // 보고서가 언급하는 것은 정상인데 "연도를 잘못 붙였다"로 몰렸다.
  //
  // 반면 "2025년 유형자산 136,795백만원"처럼 **단위가 붙은 금액**은 그 해 원문에서
  // 나와야 한다. 실제로 저 값은 2024년 원문에만 있었다 — 그것이 잡아야 할 것이다.
  const values = [...line.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(백만원|억원|조원|천원|원|%|배)/g)]
    .map(m => m[1])
    .filter(v => {
      const digits = normalize(v).replace(/\./g, "");
      if (digits.length < MIN_DIGITS) return false;
      if (/^20\d{2}$/.test(digits)) return false; // 연도 자체는 제외
      return true;
    });

  return values.length ? { year: years[0], values } : null;
}

/**
 * 출력에 적힌 숫자가 해당 연도 원문에 있는지 대조한다.
 *
 * 원문에 없으면 **어느 해에 있는지**까지 알려준다 — 대개 다른 해 값을 끌어온 것이라
 * 그 사실이 곧 원인 진단이 된다.
 */
export function findUngrounded(report: string, sources: YearSource[]): UngroundedClaim[] {
  const bySource = new Map<number, string>();
  for (const s of sources) bySource.set(s.bsnsYear, normalize(s.content));

  const out: UngroundedClaim[] = [];

  for (const line of report.split("\n")) {
    const claim = claimsInLine(line);
    if (!claim) continue;
    const src = bySource.get(claim.year);
    if (src === undefined) continue; // 우리가 안 가진 연도는 판정하지 않는다

    for (const v of claim.values) {
      const nv = normalize(v);
      if (src.includes(nv)) continue;

      const foundIn = [...bySource.entries()]
        .filter(([, text]) => text.includes(nv))
        .map(([y]) => y)
        .sort();

      out.push({ year: claim.year, value: v, foundIn, line: line.trim().slice(0, 160) });
    }
  }
  return out;
}

/** 0~1. 검증 대상 중 근거가 확인된 비율 */
export function groundingScore(report: string, sources: YearSource[]): number {
  let total = 0;
  for (const line of report.split("\n")) {
    const c = claimsInLine(line);
    if (c && sources.some(s => s.bsnsYear === c.year)) total += c.values.length;
  }
  if (total === 0) return 1;
  return Math.max(0, 1 - findUngrounded(report, sources).length / total);
}

/** 사람이 읽는 보고. 문제가 없으면 null */
export function formatUngrounded(claims: UngroundedClaim[]): string | null {
  if (claims.length === 0) return null;

  const lines = [
    `⛔ 원문에서 확인되지 않는 숫자 ${claims.length}건 — 지어냈거나 다른 해 값을 끌어온 것입니다.`,
  ];
  for (const c of claims.slice(0, 20)) {
    const where = c.foundIn.length
      ? `${c.foundIn.join("·")}년 원문에는 있음 → 연도를 잘못 붙였습니다`
      : `어느 해 원문에도 없음 → 지어낸 값입니다`;
    lines.push(`· ${c.year}년 "${c.value}" — ${where}`, `    ${c.line}`);
  }
  if (claims.length > 20) lines.push(`… 외 ${claims.length - 20}건`);
  return lines.join("\n");
}
