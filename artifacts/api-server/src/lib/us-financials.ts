/**
 * us-financials.ts — 미국 종목의 다년치 재무를 SEC EDGAR XBRL에서 뽑는다.
 *
 * 한국이 DART(fnlttSinglAcntAll)로 구조화 재무를 받듯, 미국은 SEC companyfacts
 * API가 US-GAAP 태그별 다년치 값을 준다. yahoo(2~4년, 얕음)보다 정확하고 길다.
 *
 *   data.sec.gov/api/xbrl/companyfacts/CIK{10자리}.json
 *   → facts["us-gaap"][태그].units["USD"] = [{end, val, fy, fp, form, frame}, …]
 *
 * 연간(fp="FY", form="10-K") 값만 회계연도별로 집는다. 같은 개념을 여러 태그로
 * 공시하는 회사가 있어(예: Revenues vs RevenueFromContractWithCustomer…) 우선순위
 * 목록으로 병합한다.
 *
 * 네트워크는 얇게(fetch 하나), 계산은 순수 함수로 분리한다.
 */

import { pool } from "@workspace/db";
import { getCik } from "./sec-edgar-content.js";
import { pctChange, capexTrendOf, type StageSignals } from "./stage-classifier.js";

const SEC_DATA = "https://data.sec.gov";
const USER_AGENT = "AiBITDA Research ai@aibitda.com";

/** 같은 개념을 공시하는 US-GAAP 태그 후보(우선순위 순) */
const TAGS = {
  revenue: [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
  ],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  rnd: ["ResearchAndDevelopmentExpense"],
  inventory: ["InventoryNet"],
  receivables: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"],
  payables: ["AccountsPayableCurrent", "AccountsPayableTradeCurrent"],
  cogs: ["CostOfGoodsAndServicesSold", "CostOfRevenue"],
} as const;

export interface USFinYear {
  fy: number;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  capex: number | null;
  rnd: number | null;
  inventory: number | null;
  receivables: number | null;
  payables: number | null;
  cogs: number | null;
}

type FactUnit = { end: string; val: number; fy: number; fp: string; form: string };

/** 한 개념의 연간(FY·10-K) 값을 회계연도별로 뽑는다. 같은 fy는 가장 최근 종료일을 택한다. */
function annualByTag(gaap: Record<string, any>, tag: string): Map<number, number> {
  const units: FactUnit[] | undefined = gaap?.[tag]?.units?.["USD"];
  const out = new Map<number, { end: string; val: number }>();
  if (!units) return new Map();
  for (const u of units) {
    // 10-K(미국 기업) + 20-F(외국 기업 ADR, 예: TSM) 둘 다 연간보고서다.
    if (u.fp === "FY" && (u.form === "10-K" || u.form === "20-F") && u.val != null && Number.isFinite(u.fy)) {
      const cur = out.get(u.fy);
      if (!cur || u.end > cur.end) out.set(u.fy, { end: u.end, val: u.val });
    }
  }
  return new Map([...out].map(([fy, v]) => [fy, v.val]));
}

/** 태그 후보를 우선순위로 병합 — 연도별로 먼저 나온 태그 값을 쓴다. */
function mergeTags(gaap: Record<string, any>, tags: readonly string[]): Map<number, number> {
  const merged = new Map<number, number>();
  for (const tag of tags) {
    for (const [fy, val] of annualByTag(gaap, tag)) {
      if (!merged.has(fy)) merged.set(fy, val);
    }
  }
  return merged;
}

/**
 * 미국 종목의 최근 연간 재무를 SEC에서 받아 회계연도 오름차순으로 돌려준다.
 * CIK를 못 찾거나 응답이 없으면 빈 배열(수집 실패는 분석을 막지 않는다).
 */
export async function fetchUSAnnualFinancials(ticker: string): Promise<USFinYear[]> {
  const cik = await getCik(ticker);
  if (cik == null) return [];
  let facts: any;
  try {
    const res = await fetch(
      `${SEC_DATA}/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20000) },
    );
    if (!res.ok) return [];
    facts = await res.json();
  } catch {
    return [];
  }
  const gaap = facts?.facts?.["us-gaap"];
  if (!gaap) return [];

  const rev = mergeTags(gaap, TAGS.revenue);
  const oi = mergeTags(gaap, TAGS.operatingIncome);
  const ni = mergeTags(gaap, TAGS.netIncome);
  const capex = mergeTags(gaap, TAGS.capex);
  const rnd = mergeTags(gaap, TAGS.rnd);
  const inv = mergeTags(gaap, TAGS.inventory);
  const rec = mergeTags(gaap, TAGS.receivables);
  const pay = mergeTags(gaap, TAGS.payables);
  const cogs = mergeTags(gaap, TAGS.cogs);

  const years = [...rev.keys()].sort((a, b) => a - b).slice(-5);
  return years.map(fy => ({
    fy,
    revenue: rev.get(fy) ?? null,
    operatingIncome: oi.get(fy) ?? null,
    netIncome: ni.get(fy) ?? null,
    capex: capex.get(fy) ?? null,
    rnd: rnd.get(fy) ?? null,
    inventory: inv.get(fy) ?? null,
    receivables: rec.get(fy) ?? null,
    payables: pay.get(fy) ?? null,
    cogs: cogs.get(fy) ?? null,
  }));
}

// ─── DB 저장·조회 (한국 ticker_financials에 대응) ─────────────────────────────

/** 미국 연간 재무를 us_financials에 upsert한다. cik는 조회 재사용을 위해 함께 저장. */
export async function saveUSFinancials(ticker: string, years: USFinYear[], cik: number | null): Promise<void> {
  for (const y of years) {
    await pool.query(
      `INSERT INTO us_financials
         (ticker, fy, revenue, operating_income, net_income, capex, rnd,
          inventory, receivables, payables, cogs, cik, fetched_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (ticker, fy) DO UPDATE SET
         revenue=EXCLUDED.revenue, operating_income=EXCLUDED.operating_income,
         net_income=EXCLUDED.net_income, capex=EXCLUDED.capex, rnd=EXCLUDED.rnd,
         inventory=EXCLUDED.inventory, receivables=EXCLUDED.receivables,
         payables=EXCLUDED.payables, cogs=EXCLUDED.cogs, cik=EXCLUDED.cik, fetched_at=NOW()`,
      [ticker, y.fy, y.revenue, y.operatingIncome, y.netIncome, y.capex, y.rnd,
       y.inventory, y.receivables, y.payables, y.cogs, cik],
    ).catch((e) => console.warn(`[us-financials] 저장 실패 ${ticker} FY${y.fy}:`, (e as Error)?.message?.slice(0, 60)));
  }
}

/** 저장된 미국 연간 재무를 회계연도 오름차순으로 읽는다. */
export async function getUSFinancials(ticker: string): Promise<USFinYear[]> {
  const { rows } = await pool.query(
    `SELECT fy, revenue, operating_income, net_income, capex, rnd,
            inventory, receivables, payables, cogs
       FROM us_financials WHERE ticker = $1 ORDER BY fy ASC`,
    [ticker],
  );
  const n = (v: any) => (v == null ? null : Number(v));
  return rows.map((r: any) => ({
    fy: Number(r.fy),
    revenue: n(r.revenue), operatingIncome: n(r.operating_income), netIncome: n(r.net_income),
    capex: n(r.capex), rnd: n(r.rnd), inventory: n(r.inventory),
    receivables: n(r.receivables), payables: n(r.payables), cogs: n(r.cogs),
  }));
}

/**
 * 저장 우선. 저장된 게 있으면 그대로 쓰고, 없으면 SEC에서 받아 저장한 뒤 돌려준다.
 * 분석 경로(pipeline)와 배치 러너가 함께 쓴다.
 */
export async function collectUSFinancials(ticker: string): Promise<USFinYear[]> {
  const cached = await getUSFinancials(ticker).catch(() => []);
  if (cached.length >= 2) return cached;
  const cik = await getCik(ticker);
  const years = await fetchUSAnnualFinancials(ticker);
  if (years.length > 0) await saveUSFinancials(ticker, years, cik);
  return years;
}

const days = (stock: number | null, flow: number | null): number | null =>
  stock != null && flow != null && flow > 0 ? stock / (flow / 365) : null;

function ccc(y: USFinYear): number | null {
  const dio = days(y.inventory, y.cogs);
  const dso = days(y.receivables, y.revenue);
  const dpo = days(y.payables, y.cogs);
  return dio != null && dso != null && dpo != null ? dio + dso - dpo : null;
}

/**
 * 미국 연간 재무에서 국면 신호를 뽑는다(한국 경로와 같은 StageSignals).
 * CapEx·CCC까지 나오므로 한국과 동일한 신호 밀도다. 인력·부문은 XBRL에 없어 뺀다.
 */
export function usStageSignals(years: USFinYear[]): Partial<StageSignals> {
  const sig: Partial<StageSignals> = {};
  if (years.length < 2) return sig;
  const last = years[years.length - 1], prev = years[years.length - 2];

  sig.revGrowthPct = pctChange(last.revenue, prev.revenue);
  const opmL = last.revenue && last.operatingIncome != null && last.revenue > 0 ? last.operatingIncome / last.revenue : null;
  const opmP = prev.revenue && prev.operatingIncome != null && prev.revenue > 0 ? prev.operatingIncome / prev.revenue : null;
  if (opmL != null && opmP != null) sig.opmDeltaPp = (opmL - opmP) * 100;

  sig.capexTrend = capexTrendOf(years.map(y => y.capex));

  const cLast = ccc(last), cPrev = ccc(prev);
  if (cLast != null && cPrev != null) sig.cccDeltaDays = cLast - cPrev;

  return sig;
}
