/**
 * company-facts.ts — 사업보고서에서 읽히는 **사람·고객 관련 사실**을 코드가 뽑는다.
 *
 * 두 가지를 담당한다. 둘 다 예전엔 프롬프트가 "공시 미확인"으로 비워 두던 자리다.
 *
 *  1. 임직원 수 추이 — DART 직원현황(empSttus) API. 부문·성별로 나뉜 행을 합친다.
 *     인력 증감은 "성장 단계 판정"(제조업 아닌 회사)과 사업 확장·구조조정의 직접 신호다.
 *
 *  2. 고객 집중도 — 재무제표 주석의 K-IFRS 표준 공시("단일 외부고객 매출이 전체의 10%
 *     상회"). 회사가 고객명은 안 밝혀도 **집중도는 금액으로 공시**한다. SK하이닉스는
 *     주요고객(가) 매출이 전기 10.9조 → 당기 23.3조로 두 배가 됐다 — 큰 신호다.
 *
 * DB·네트워크를 모르는 순수 함수만 둔다(집계·추출·렌더). 수집은 호출부가 한다.
 */

// ─── 임직원 수 (empSttus) ────────────────────────────────────────────────────

/** empSttus 한 행. 부문(fo_bbm)·성별(sexdstn)로 쪼개져 온다. */
export interface EmpRow {
  sexdstn?: string;   // 남/여
  fo_bbm?: string;    // 사업부문
  rgllbr_co?: string; // 정규직 수
  cnttk_co?: string;  // 계약직 수
  sm?: string;        // 합계
  avrg_cnwk_sdytrn?: string; // 평균 근속연수
}

export interface HeadcountYear {
  year: number;
  label?: string;     // 표시용. 분기 포인트는 "2026 1분기"처럼. 없으면 "{year}년"
  total: number;      // 전체 직원 수
  regular: number;    // 정규직
  contract: number;   // 계약직
  avgTenure: number | null; // 인원 가중 평균 근속연수
}

function num(s: unknown): number {
  const n = Number(String(s ?? "").replace(/[,\s명]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** 한 해의 empSttus 행들을 합쳐 총원·정규·계약·가중평균 근속을 낸다. */
export function aggregateEmployees(rows: EmpRow[], year: number, label?: string): HeadcountYear | null {
  if (!rows.length) return null;
  let total = 0, regular = 0, contract = 0, tenureWeighted = 0, tenureBase = 0;
  for (const r of rows) {
    const sm = num(r.sm);
    total += sm;
    regular += num(r.rgllbr_co);
    contract += num(r.cnttk_co);
    const t = Number(String(r.avrg_cnwk_sdytrn ?? "").replace(/[^\d.]/g, ""));
    if (Number.isFinite(t) && t > 0 && sm > 0) { tenureWeighted += t * sm; tenureBase += sm; }
  }
  if (total === 0) return null;
  return {
    year, label, total, regular, contract,
    avgTenure: tenureBase > 0 ? tenureWeighted / tenureBase : null,
  };
}

/** 임직원 수 추이 표. 계산 가능한 해가 없으면 빈 문자열. */
export function renderHeadcount(years: HeadcountYear[]): string {
  const ys = years.filter(Boolean).sort((a, b) => a.year - b.year);
  if (ys.length === 0) return "";
  const n = (v: number) => v.toLocaleString();
  const lines = [
    "",
    "[👥 임직원 수 추이 — DART 직원현황 공시]",
    "⚠️ 코드가 직접 집계한 값입니다. 인력 증감을 사업 확장·구조조정·생산성 변화의 신호로 해석하세요.",
    "",
    "| 연도 | 총원 | 정규직 | 계약직 | 평균근속(년) |",
    "|---|---|---|---|---|",
  ];
  for (const y of ys) {
    lines.push(`| ${y.label ?? `${y.year}년`} | ${n(y.total)} | ${n(y.regular)} | ${n(y.contract)} | ${y.avgTenure == null ? "—" : y.avgTenure.toFixed(1)} |`);
  }
  return lines.join("\n");
}

// ─── 고객 집중도 (재무제표 주석) ──────────────────────────────────────────────

export interface CustomerConcentration {
  /** 당기 주요고객 매출액 (원) */
  thisAmount: number;
  /** 전기 주요고객 매출액 (원), 있으면 */
  priorAmount: number | null;
  /** 원문 그대로의 근거 문장(요약) */
  note: string;
}

/**
 * 재무제표 주석의 K-IFRS 표준 고객집중도 공시를 뽑는다.
 *
 * 표준 문구: "단일 외부고객으로부터의 매출액이 … 10%를 상회하는 고객 (가)로부터
 * 발생한 매출액은 [금액]백만원". 회사마다 문구가 조금씩 달라 금액 앞뒤를 넓게 잡는다.
 * 못 찾으면 null — 그런 고객이 없거나(집중도 낮음) 공시하지 않은 것이다.
 */
export function extractCustomerConcentration(rawText: string): CustomerConcentration | null {
  // 문장 단위로 "10%(이상|초과|상회)" + "고객" + "매출액 … 백만원"을 찾는다.
  const flat = rawText.replace(/\s+/g, " ");
  const m = flat.match(/단일[^.]*?고객[^.]*?10\s*%[^.]*?매출액[^.]*?([\d,]+)\s*백만원/);
  if (!m) return null;
  const thisAmount = Number(m[1].replace(/,/g, "")) * 1e6;
  if (!Number.isFinite(thisAmount) || thisAmount <= 0) return null;
  // 전기 금액이 이어지면 함께 잡는다
  const prior = flat.slice(m.index ?? 0).match(/전기[^.]*?([\d,]{6,})\s*백만원/);
  const priorAmount = prior ? Number(prior[1].replace(/,/g, "")) * 1e6 : null;
  return {
    thisAmount,
    priorAmount: priorAmount && priorAmount > 0 ? priorAmount : null,
    note: m[0].slice(0, 200),
  };
}

/** 고객 집중도 블록. 매출액을 함께 받아 비중(%)을 낸다. 못 찾으면 빈 문자열. */
export function renderCustomerConcentration(c: CustomerConcentration | null, revenue: number | null): string {
  if (!c) return "";
  const 조 = (v: number) => `${(v / 1e12).toFixed(1)}조원`;
  const share = revenue && revenue > 0 ? ` (전체 매출의 약 ${((c.thisAmount / revenue) * 100).toFixed(0)}%)` : "";
  const lines = [
    "",
    "[🎯 고객 집중도 — 재무제표 주석 공시(고객명은 익명)]",
    "⚠️ 회사가 고객명은 안 밝혀도 단일 대형고객 매출을 금액으로 공시한 것입니다. 집중도 리스크·거래 확대를 해석하세요.",
    `· 주요고객(가) 당기 매출: ${조(c.thisAmount)}${share}`,
  ];
  if (c.priorAmount != null) {
    const dir = c.thisAmount > c.priorAmount ? "증가" : "감소";
    lines.push(`· 전기 대비: ${조(c.priorAmount)} → ${조(c.thisAmount)} (${dir})`);
  }
  return lines.join("\n");
}
