import { Router, type IRouter } from "express";
import { normalizeTicker, isKoreanTicker } from "@workspace/shared";
import { fetchAnnualAllRows } from "../lib/dart-store.js";
import { fetchEmployeeCounts } from "../lib/dart-store.js";
import { computeCapex, computeWorkingCapital } from "../lib/working-capital.js";
import { aggregateEmployees } from "../lib/company-facts.js";
import { getBizTimeline } from "../lib/biz-timeline.js";
import { extractMetrics } from "../lib/biz-metrics.js";
import { getUSFinancials } from "../lib/us-financials.js";

/**
 * 종목별 지표 시계열 API — 상세 페이지의 지표 차트(CapEx·R&D·인력·운전자본)가 읽는다.
 *
 * 값은 백엔드가 이미 계산한다(working-capital·company-facts·us-financials·biz-metrics).
 * 여기서는 그 계산을 모아 연도별 시계열로 돌려준다. 시각화는 프론트가 recharts로.
 *
 * 한·미가 데이터 출처가 다르므로 시장별로 채운다. 없는 계열은 빈 배열([]).
 */
const router: IRouter = Router();

export interface MetricSeries {
  currency: "KRW" | "USD";
  capex: Array<{ year: number; capex: number | null; capexToRevenue: number | null }>;
  rnd: Array<{ year: number; amount: number | null; ratio: number | null }>;
  headcount: Array<{ year: number; total: number; regular: number; contract: number; avgTenure: number | null }>;
  workingCapital: Array<{ year: number; dio: number | null; dso: number | null; dpo: number | null; ccc: number | null }>;
}

const num = (v: any): number | null => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const days = (stock: number | null, flow: number | null): number | null =>
  stock != null && flow != null && flow > 0 ? stock / (flow / 365) : null;

async function krMetrics(ticker: string): Promise<MetricSeries> {
  const out: MetricSeries = { currency: "KRW", capex: [], rnd: [], headcount: [], workingCapital: [] };

  // CapEx + 운전자본 — 전체 재무제표 한 보고서에서 3개년
  const all = await fetchAnnualAllRows(ticker).catch(() => null);
  if (all) {
    out.capex = computeCapex(all.rows, all.bsnsYear)
      .map(c => ({ year: c.year, capex: c.capex, capexToRevenue: c.capexToRevenue }));
    out.workingCapital = computeWorkingCapital(all.rows, all.bsnsYear)
      .map(w => ({ year: w.year, dio: w.dio, dso: w.dso, dpo: w.dpo, ccc: w.ccc }));
  }

  // 인력 — 직원현황 API
  const emp = await fetchEmployeeCounts(ticker).catch(() => []);
  out.headcount = emp
    .map(e => aggregateEmployees(e.rows, e.year))
    .filter((x): x is NonNullable<typeof x> => x != null)
    .map(h => ({ year: h.year, total: h.total, regular: h.regular, contract: h.contract, avgTenure: h.avgTenure }));

  // R&D — 사업보고서 연간에서 코드가 뽑은 값(백만원, 매출대비%)
  const tl = await getBizTimeline(ticker).catch(() => []);
  const rndByYear = new Map<number, { amount: number | null; ratio: number | null }>();
  for (const t of tl.filter(t => t.quarter === 4)) {
    const hits = extractMetrics(t.content);
    const total = hits.find(h => h.key === "rndTotal")?.values?.[0] ?? null;
    const ratio = hits.find(h => h.key === "rndRatio")?.values?.[0] ?? null;
    if (total != null || ratio != null) rndByYear.set(t.bsnsYear, { amount: total, ratio });
  }
  out.rnd = [...rndByYear.entries()].sort((a, b) => a[0] - b[0])
    .map(([year, v]) => ({ year, amount: v.amount, ratio: v.ratio }));

  return out;
}

async function usMetrics(ticker: string): Promise<MetricSeries> {
  const out: MetricSeries = { currency: "USD", capex: [], rnd: [], headcount: [], workingCapital: [] };
  const years = await getUSFinancials(ticker).catch(() => []);
  for (const y of years) {
    const rev = num(y.revenue);
    out.capex.push({
      year: y.fy, capex: num(y.capex),
      capexToRevenue: y.capex != null && rev ? (Number(y.capex) / rev) * 100 : null,
    });
    out.rnd.push({
      year: y.fy, amount: num(y.rnd),
      ratio: y.rnd != null && rev ? (Number(y.rnd) / rev) * 100 : null,
    });
    const dio = days(num(y.inventory), num(y.cogs));
    const dso = days(num(y.receivables), rev);
    const dpo = days(num(y.payables), num(y.cogs));
    out.workingCapital.push({
      year: y.fy, dio, dso, dpo,
      ccc: dio != null && dso != null && dpo != null ? dio + dso - dpo : null,
    });
  }
  // 미국은 직원현황(empSttus)이 없다 — headcount는 빈 채로 둔다.
  return out;
}

router.get("/:ticker", async (req, res) => {
  try {
    const ticker = normalizeTicker(req.params.ticker);
    const data = isKoreanTicker(ticker) ? await krMetrics(ticker) : await usMetrics(ticker);
    res.json({ ticker, ...data });
  } catch (e) {
    console.warn("[company-metrics] 조회 실패:", (e as Error)?.message?.slice(0, 80));
    res.status(500).json({ error: "metrics_lookup_failed" });
  }
});

export default router;
