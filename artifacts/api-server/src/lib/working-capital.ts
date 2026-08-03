/**
 * working-capital.ts — 재무제표에서 **운전자본 효율성(DIO·DSO·DPO·CCC)을 코드가 계산한다.**
 *
 * 예전엔 프롬프트가 LLM에게 "재고자산 ÷ (매출원가 ÷ 365)로 DIO를 계산하라"고 시켰다.
 * 그런데 재고자산·매출원가 값 자체를 프롬프트에 안 줬으니 LLM은 "공시 미확인"만 반복했다.
 * 이 프로젝트 원칙대로 **코드가 숫자를 뽑아 계산하고, LLM은 추세의 의미만 해석**하게 한다.
 *
 * 핵심 이점: DART 전체 재무제표(fnlttSinglAcntAll) 한 보고서가 당기·전기·전전기
 * **3개년을 함께** 준다. 한 번 호출로 3년치 운전자본 추이가 나온다.
 *
 * 계정은 IFRS 표준 account_id로 잡는다(한글명은 회사마다 달라 불안정하다 — dart-balance와
 * 같은 이유). DB·네트워크를 모르는 순수 함수만 둔다(테스트 가능).
 */

/** ifrs-full_ / dart_ 접두사를 뗀 account_id */
function shortId(id: unknown): string {
  return String(id ?? "").replace(/^ifrs-full_/, "").replace(/^dart_/, "");
}
function amount(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

type WCKey = "inventory" | "receivables" | "payables" | "cogs" | "revenue";

/** 운전자본 계정의 IFRS 코드. 회사마다 세부 코드가 달라 후보를 여럿 둔다. */
const IDS: Record<WCKey, readonly string[]> = {
  inventory:   ["Inventories"],
  receivables: ["CurrentTradeReceivables", "TradeAndOtherCurrentReceivables", "ShortTermTradeReceivable"],
  payables:    ["TradeAndOtherCurrentPayablesToTradeSuppliers", "TradeAndOtherCurrentPayables", "CurrentTradePayables"],
  cogs:        ["CostOfSales"],
  revenue:     ["Revenue"],
};

/** 코드가 비었을 때의 한글명 대비책 (정확 일치 우선) */
const NAMES: Record<WCKey, readonly string[]> = {
  inventory:   ["재고자산"],
  receivables: ["매출채권", "매출채권및기타채권"],
  payables:    ["매입채무", "매입채무및기타채무"],
  cogs:        ["매출원가"],
  revenue:     ["매출액", "수익(매출액)", "영업수익"],
};

export interface DartRow {
  sj_div?: string;
  account_id?: string;
  account_nm?: string;
  thstrm_amount?: string;
  frmtrm_amount?: string;
  bfefrmtrm_amount?: string;
}

// ─── 재무 건전성(부채비율·ROE) — 같은 전체 재무제표 rows에서 파생 ───────────────
type HealthKey = "equity" | "liabilities" | "netIncome";
const HEALTH_IDS: Record<HealthKey, readonly string[]> = {
  equity:      ["Equity"],
  liabilities: ["Liabilities"],
  netIncome:   ["ProfitLoss", "ProfitLossAttributableToOwnersOfParent"],
};
const HEALTH_NAMES: Record<HealthKey, readonly string[]> = {
  equity:      ["자본총계"],
  liabilities: ["부채총계"],
  netIncome:   ["당기순이익", "당기순이익(손실)", "연결당기순이익"],
};

type Term = "thstrm_amount" | "frmtrm_amount" | "bfefrmtrm_amount";

/** 한 계정군의 값을 한 term에서 찾는다. 코드 우선, 없으면 한글명 정확 일치. */
function pick(rows: DartRow[], key: WCKey, term: Term): number | null {
  for (const r of rows) {
    if (IDS[key].includes(shortId(r.account_id))) {
      const v = amount(r[term]);
      if (v !== 0) return v;
    }
  }
  const norm = (s: unknown) => String(s ?? "").replace(/\s/g, "");
  for (const nm of NAMES[key]) {
    const r = rows.find(x => norm(x.account_nm) === nm);
    if (r) { const v = amount(r[term]); if (v !== 0) return v; }
  }
  return null;
}

/** 건전성 계정 pick — pick과 같은 규칙(코드 우선, 한글명 대비책) */
function pickH(rows: DartRow[], key: HealthKey, term: Term): number | null {
  for (const r of rows) {
    if (HEALTH_IDS[key].includes(shortId(r.account_id))) {
      const v = amount(r[term]);
      if (v !== 0) return v;
    }
  }
  const norm = (s: unknown) => String(s ?? "").replace(/\s/g, "");
  for (const nm of HEALTH_NAMES[key]) {
    const r = rows.find(x => norm(x.account_nm) === nm);
    if (r) { const v = amount(r[term]); if (v !== 0) return v; }
  }
  return null;
}

export interface HealthYear {
  year: number;
  /** 부채비율 = 부채총계 ÷ 자기자본 (%) */
  debtRatio: number | null;
  /** ROE = 당기순이익 ÷ 자기자본 (%) */
  roe: number | null;
}

/** 전체 재무제표 rows(한 연간 보고서)에서 3개년 건전성을 계산한다(자본총계 기준). */
export function computeHealth(rows: DartRow[], bsnsYear: number): HealthYear[] {
  const terms: Array<[Term, number]> = [
    ["thstrm_amount", bsnsYear],
    ["frmtrm_amount", bsnsYear - 1],
    ["bfefrmtrm_amount", bsnsYear - 2],
  ];
  const out: HealthYear[] = [];
  for (const [term, year] of terms) {
    const eq = pickH(rows, "equity", term);
    if (eq == null || eq === 0) continue; // 자기자본 없으면 비율 계산 불가
    const liab = pickH(rows, "liabilities", term);
    const ni = pickH(rows, "netIncome", term);
    out.push({
      year,
      debtRatio: liab != null ? (liab / eq) * 100 : null,
      roe: ni != null ? (ni / eq) * 100 : null,
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** 건전성 추이 표. 최신값이 아니라 흐름을 서술하도록 지시를 붙인다. */
export function renderHealthTrend(years: HealthYear[]): string {
  const ys = years.filter(y => y.debtRatio != null || y.roe != null);
  if (ys.length < 2) return "";
  const p = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}%`);
  const lines = [
    "",
    "[📊 서버 제공 · 재무 건전성 추이 — 최신값이 아니라 **과거부터의 흐름(개선/악화)**을 서술하세요]",
    "| 연도 | 부채비율 | ROE |",
    "|---|---|---|",
  ];
  for (const y of ys) lines.push(`| ${y.year}년 | ${p(y.debtRatio)} | ${p(y.roe)} |`);
  return lines.join("\n");
}

export interface WorkingCapitalYear {
  year: number;
  /** 표시용 라벨. 분기 포인트는 "2026 1분기(연율)" 처럼 준다. 없으면 "{year}년" */
  label?: string;
  inventory: number | null;
  receivables: number | null;
  payables: number | null;
  cogs: number | null;
  revenue: number | null;
  /** 재고자산 회전일수 = 재고 ÷ (매출원가/365) */
  dio: number | null;
  /** 매출채권 회전일수 = 매출채권 ÷ (매출액/365) */
  dso: number | null;
  /** 매입채무 회전일수 = 매입채무 ÷ (매출원가/365) */
  dpo: number | null;
  /** 현금전환주기 = DIO + DSO − DPO */
  ccc: number | null;
}

const days = (stock: number | null, flow: number | null): number | null =>
  stock != null && flow != null && flow > 0 ? (stock / (flow / 365)) : null;

/**
 * 전체 재무제표 rows(한 연간 보고서)에서 3개년 운전자본을 뽑아 계산한다.
 * thstrm=보고연도, frmtrm=−1, bfefrmtrm=−2.
 */
export function computeWorkingCapital(rows: DartRow[], bsnsYear: number): WorkingCapitalYear[] {
  const terms: Array<[Term, number]> = [
    ["thstrm_amount", bsnsYear],
    ["frmtrm_amount", bsnsYear - 1],
    ["bfefrmtrm_amount", bsnsYear - 2],
  ];
  const out: WorkingCapitalYear[] = [];
  for (const [term, year] of terms) {
    const inventory = pick(rows, "inventory", term);
    const receivables = pick(rows, "receivables", term);
    const payables = pick(rows, "payables", term);
    const cogs = pick(rows, "cogs", term);
    const revenue = pick(rows, "revenue", term);
    // 재고·매출원가·매출액 중 하나도 없으면 이 해는 계산 불가(금융업 등)
    if (revenue == null && cogs == null && inventory == null) continue;
    const dio = days(inventory, cogs);
    const dso = days(receivables, revenue);
    const dpo = days(payables, cogs);
    const ccc = dio != null && dso != null && dpo != null ? dio + dso - dpo : null;
    out.push({ year, inventory, receivables, payables, cogs, revenue, dio, dso, dpo, ccc });
  }
  return out.sort((a, b) => a.year - b.year);
}

/**
 * 최신 **분기** 보고서에서 운전자본 한 포인트를 계산한다.
 * 재고·매출채권·매입채무는 분기말 시점값이라 그대로, 매출·매출원가는 분기 누적이라
 * flowFactor(1Q=4·반기=2·3Q=4/3)로 **연율화**해 연간 회전일수와 같은 기준으로 맞춘다.
 */
export function computeQuarterWC(
  rows: DartRow[], year: number, label: string, flowFactor: number,
): WorkingCapitalYear | null {
  const inventory = pick(rows, "inventory", "thstrm_amount");
  const receivables = pick(rows, "receivables", "thstrm_amount");
  const payables = pick(rows, "payables", "thstrm_amount");
  const cogsQ = pick(rows, "cogs", "thstrm_amount");
  const revQ = pick(rows, "revenue", "thstrm_amount");
  if (revQ == null && cogsQ == null && inventory == null) return null;
  const cogs = cogsQ != null ? cogsQ * flowFactor : null;   // 연율화
  const revenue = revQ != null ? revQ * flowFactor : null;  // 연율화
  const dio = days(inventory, cogs);
  const dso = days(receivables, revenue);
  const dpo = days(payables, cogs);
  const ccc = dio != null && dso != null && dpo != null ? dio + dso - dpo : null;
  return { year, label, inventory, receivables, payables, cogs, revenue, dio, dso, dpo, ccc };
}

// ─── CapEx(설비투자) — 같은 전체 재무제표 rows에서 파생 ────────────────────────
//
// 현금흐름표의 유형·무형자산 취득이 CapEx다. 투자 방향(확장 vs 수확 vs 방어)을
// 읽는 핵심 지표인데, 예전엔 프롬프트가 값을 안 줘서 "공시 미확인"으로 비어 있었다.

const CAPEX_IDS: readonly string[] = [
  "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",
  "PurchaseOfPropertyPlantAndEquipment",
  "PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities",
  "PurchaseOfIntangibleAssets",
];
const CAPEX_NAMES: readonly string[] = ["유형자산의취득", "무형자산의취득", "유형자산취득", "무형자산취득"];

export interface CapexYear {
  year: number;
  capex: number | null;          // 유형+무형 취득 합 (원)
  capexToRevenue: number | null; // CapEx ÷ 매출액 (%)
}

/** 한 term에서 CapEx(유형+무형 취득) 합을 구한다. 없으면 null. */
function pickCapex(rows: DartRow[], term: Term): number | null {
  let sum = 0, found = false;
  const norm = (s: unknown) => String(s ?? "").replace(/\s/g, "");
  for (const r of rows) {
    const id = shortId(r.account_id);
    const nm = norm(r.account_nm);
    if (CAPEX_IDS.includes(id) || CAPEX_NAMES.includes(nm)) {
      const v = Math.abs(amount(r[term])); // 유출이라 음수로 오기도 한다
      if (v > 0) { sum += v; found = true; }
    }
  }
  return found ? sum : null;
}

export function computeCapex(rows: DartRow[], bsnsYear: number): CapexYear[] {
  const terms: Array<[Term, number]> = [
    ["thstrm_amount", bsnsYear],
    ["frmtrm_amount", bsnsYear - 1],
    ["bfefrmtrm_amount", bsnsYear - 2],
  ];
  const out: CapexYear[] = [];
  for (const [term, year] of terms) {
    const capex = pickCapex(rows, term);
    if (capex == null) continue;
    const revenue = pick(rows, "revenue", term);
    const capexToRevenue = revenue && revenue > 0 ? (capex / revenue) * 100 : null;
    out.push({ year, capex, capexToRevenue });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** CapEx 표. 억원 단위. 계산 가능한 해가 없으면 빈 문자열. */
export function renderCapex(years: CapexYear[]): string {
  const usable = years.filter(y => y.capex != null);
  if (usable.length === 0) return "";
  const 억 = (v: number | null) => (v == null ? "—" : Math.round(v / 1e8).toLocaleString());
  const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
  const lines = [
    "",
    "[🏗️ CapEx(설비투자) — 서버가 현금흐름표에서 계산 (유형+무형자산 취득)]",
    "⚠️ 아래는 코드가 직접 뽑은 값입니다. 이 값으로 투자 방향(확장 vs 수확 vs 방어)을 해석하세요.",
    "",
    "| 연도 | CapEx(억원) | CapEx/매출 |",
    "|---|---|---|",
  ];
  for (const y of usable) lines.push(`| ${y.year}년 | ${억(y.capex)} | ${pct(y.capexToRevenue)} |`);
  return lines.join("\n");
}

const r0 = (v: number | null) => (v == null ? "—" : Math.round(v).toLocaleString());

/**
 * 운전자본 지표를 표로 만든다. 계산 가능한 해가 없으면 빈 문자열(잡음 방지).
 * **LLM은 이 표만 보고 추세의 의미를 해석한다** — 다시 계산하지 않는다.
 */
export function renderWorkingCapital(years: WorkingCapitalYear[]): string {
  const usable = years.filter(y => y.ccc != null || y.dio != null);
  if (usable.length === 0) return "";

  const lines = [
    "",
    "[💧 운전자본 효율성 — 서버가 재무제표에서 계산한 값 (단위: 일)]",
    "⚠️ 아래 DIO·DSO·DPO·CCC는 코드가 재고자산·매출채권·매입채무·매출원가·매출액으로 직접 계산했습니다.",
    "⚠️ **다시 계산하지 말고** 이 값으로 추세의 의미만 해석하세요. CCC 상승=운전자본 잠식, 하락=현금창출 개선.",
    "",
    "| 연도 | DIO(재고) | DSO(매출채권) | DPO(매입채무) | CCC(현금전환) |",
    "|---|---|---|---|---|",
  ];
  for (const y of usable) {
    lines.push(`| ${y.label ?? `${y.year}년`} | ${r0(y.dio)} | ${r0(y.dso)} | ${r0(y.dpo)} | ${r0(y.ccc)} |`);
  }
  return lines.join("\n");
}
