import path from "path";
import fs from "fs/promises";
import YahooFinance from "yahoo-finance2";
import { correctKoreanTicker } from "./krx-cache.js";

const yahooFinance = new YahooFinance();
const DATA_DIR = path.join(process.cwd(), "data", "peers");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PeerMultiples {
  name: string;
  // Yahoo Finance
  marketCap: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  pbr: number | null;
  per_trailing: number | null;
  ev_ebitda: number | null;
  roe: number | null;
  operating_margin: number | null;
  // DART (한국주 전용) 또는 Yahoo fallback
  revenue: number | null;
  operating_income: number | null;
  equity: number | null;
  // Calculated
  net_debt: number | null;
  ev_sales: number | null;
  // Manual (수동 입력, 수집 시 null 유지)
  per_fwd: number | null;
  // Source tracking
  _sources?: {
    yahoo: boolean;
    dart: boolean;
    calculated: string[];
  };
}

export interface PeerSnapshot {
  subject: string;
  subject_name: string;
  collected_at: string;
  peers: Record<string, PeerMultiples>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isKorean(ticker: string): boolean {
  return /\.(KS|KQ)$/.test(ticker);
}

function stockCode(ticker: string): string {
  return ticker.replace(/\.(KS|KQ)$/, "");
}

// ─── Yahoo Finance ────────────────────────────────────────────────────────────

async function fetchYahooData(ticker: string): Promise<{
  data: Partial<PeerMultiples>;
  name: string | null;
}> {
  try {
    const [summaryResult, quoteResult] = await Promise.allSettled([
      yahooFinance.quoteSummary(ticker, {
        modules: ["financialData", "defaultKeyStatistics", "summaryDetail", "price"] as any,
      }),
      yahooFinance.quote(ticker),
    ]);

    const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {};
    const q: any = quoteResult.status === "fulfilled" ? quoteResult.value : {};

    const fd = (summary as any).financialData as any ?? {};
    const ks = (summary as any).defaultKeyStatistics as any ?? {};
    const sd = (summary as any).summaryDetail as any ?? {};
    const pr = (summary as any).price as any ?? {};

    const marketCap: number | null = q?.marketCap ?? pr?.marketCap ?? sd?.marketCap ?? null;
    const totalDebt: number | null = fd?.totalDebt ?? null;
    const totalCash: number | null = fd?.totalCash ?? null;

    // PBR: quoteSummary → quote.priceToBook
    const pbr: number | null = ks?.priceToBook ?? q?.priceToBook ?? null;

    // PER TTM: quoteSummary → quote.trailingPE → price/EPS 계산
    let per_trailing: number | null = sd?.trailingPE ?? ks?.trailingPE ?? q?.trailingPE ?? null;
    if (per_trailing == null && q?.regularMarketPrice != null) {
      const eps = q?.epsTrailingTwelveMonths ?? null;
      if (eps != null && eps > 0) per_trailing = q.regularMarketPrice / eps;
    }

    return {
      name: pr?.longName ?? pr?.shortName ?? q?.longName ?? q?.shortName ?? null,
      data: {
        marketCap,
        totalDebt,
        totalCash,
        pbr,
        per_trailing,
        ev_ebitda: ks?.enterpriseToEbitda ?? null,
        roe: fd?.returnOnEquity != null ? fd.returnOnEquity * 100 : null,
        operating_margin: fd?.operatingMargins != null ? fd.operatingMargins * 100 : null,
        // Yahoo revenue as fallback (if DART unavailable)
        revenue: fd?.totalRevenue ?? null,
      },
    };
  } catch (err) {
    console.warn(`[peer-collector] Yahoo failed for ${ticker}:`, (err as Error).message);
    return { data: {}, name: null };
  }
}

// ─── DART API ─────────────────────────────────────────────────────────────────

async function fetchDartCorpCode(code: string): Promise<string | null> {
  const key = process.env["DART_API_KEY"];
  if (!key) return null;
  try {
    const url = `https://opendart.fss.or.kr/api/company.json?crtfc_key=${key}&stock_code=${code}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data.status !== "000") return null;
    return data.corp_code ?? null;
  } catch {
    return null;
  }
}

async function fetchDartFinancials(corpCode: string): Promise<{
  revenue: number | null;
  operating_income: number | null;
  equity: number | null;
  name: string | null;
}> {
  const key = process.env["DART_API_KEY"];
  if (!key) return { revenue: null, operating_income: null, equity: null, name: null };

  const year = new Date().getFullYear() - 1; // 전년도 사업보고서

  for (const sj of ["CFS", "OFS"]) { // 연결 우선, 개별 fallback
    try {
      const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${key}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11011&fs_div=${sj}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const data = await res.json() as any;
      if (data.status !== "000" || !data.list?.length) continue;

      const list: any[] = data.list;
      const find = (names: string[]): number | null => {
        for (const name of names) {
          const item = list.find((r: any) =>
            r.sj_div === "IS" && r.account_nm?.replace(/\s/g, "").includes(name)
          );
          if (item) {
            const raw = String(item.thstrm_amount ?? "").replace(/,/g, "");
            const n = Number(raw);
            return isNaN(n) ? null : n;
          }
        }
        return null;
      };
      const findBS = (names: string[]): number | null => {
        for (const name of names) {
          const item = list.find((r: any) =>
            r.sj_div === "BS" && r.account_nm?.replace(/\s/g, "").includes(name)
          );
          if (item) {
            const raw = String(item.thstrm_amount ?? "").replace(/,/g, "");
            const n = Number(raw);
            return isNaN(n) ? null : n;
          }
        }
        return null;
      };

      const revenue = find(["매출액"]);
      const operating_income = find(["영업이익", "영업손실"]);
      const equity = findBS(["자본총계"]);

      if (revenue !== null || operating_income !== null) {
        return { revenue, operating_income, equity, name: null };
      }
    } catch {
      continue;
    }
  }
  return { revenue: null, operating_income: null, equity: null, name: null };
}

// ─── Subject company DART balance sheet (exported for main analysis pipeline) ─

export interface DartSubjectBalance {
  year: number;
  fsType: "CFS" | "OFS";
  cash: number | null;
  totalAssets: number | null;
  totalLiab: number | null;
  equity: number | null;
  totalDebt: number | null;
}

export async function fetchDartSubjectBalance(stockCode: string): Promise<DartSubjectBalance | null> {
  const key = process.env["DART_API_KEY"];
  if (!key) return null;

  const corpCode = await fetchDartCorpCode(stockCode);
  if (!corpCode) return null;

  const currentYear = new Date().getFullYear();

  for (const year of [currentYear - 1, currentYear - 2]) {
    for (const sj of ["CFS", "OFS"] as const) {
      try {
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${key}&corp_code=${corpCode}&bsns_year=${year}&reprt_code=11011&fs_div=${sj}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) continue;
        const data = await res.json() as any;
        if (data.status !== "000" || !data.list?.length) continue;

        const list: any[] = data.list;
        const findBS = (names: string[]): number | null => {
          for (const name of names) {
            const item = list.find((r: any) =>
              r.sj_div === "BS" && r.account_nm?.replace(/\s/g, "").includes(name)
            );
            if (item) {
              const raw = String(item.thstrm_amount ?? "").replace(/,/g, "");
              const n = Number(raw);
              return isNaN(n) ? null : n;
            }
          }
          return null;
        };

        const cash       = findBS(["현금및현금성자산", "현금및단기금융상품", "현금성자산", "현금및현금성자산등"]);
        const totalAssets = findBS(["자산총계"]);
        const totalLiab  = findBS(["부채총계"]);
        const equity     = findBS(["자본총계"]);

        // 금융부채 항목 포괄 수집 (단기차입금·사채·리스부채 등)
        const shortTermDebt      = findBS(["단기차입금"]);
        const longTermDebt       = findBS(["장기차입금", "장기차입"]);
        const shortTermBond      = findBS(["단기사채"]);
        const longTermBond       = findBS(["사채"]);           // 장기 사채
        const currentPortionLT   = findBS(["유동성장기부채", "유동성장기차입금"]);
        const convertibleBond    = findBS(["전환사채", "교환사채", "신주인수권부사채"]);
        const leaseLiab          = findBS(["리스부채", "금융리스부채"]);
        const shortFinLiab       = findBS(["단기금융부채", "유동금융부채"]);
        const longFinLiab        = findBS(["장기금융부채", "비유동금융부채"]);

        const debtItems = [
          shortTermDebt, longTermDebt, shortTermBond, longTermBond,
          currentPortionLT, convertibleBond, leaseLiab,
          shortFinLiab, longFinLiab,
        ].filter((v): v is number => v != null);
        const totalDebt = debtItems.length > 0 ? debtItems.reduce((a, b) => a + b, 0) : null;

        if (cash !== null || totalAssets !== null) {
          return { year, fsType: sj, cash, totalAssets, totalLiab, equity, totalDebt };
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ─── Collect single peer ──────────────────────────────────────────────────────

async function collectPeer(ticker: string): Promise<PeerMultiples> {
  const { data: yahooData, name: yahooName } = await fetchYahooData(ticker);

  let revenue = yahooData.revenue ?? null;
  let operating_income: number | null = null;
  let equity: number | null = null;
  let dartName: string | null = null;
  let dartUsed = false;

  if (isKorean(ticker)) {
    const corpCode = await fetchDartCorpCode(stockCode(ticker));
    if (corpCode) {
      const dartData = await fetchDartFinancials(corpCode);
      if (dartData.revenue !== null) {
        revenue = dartData.revenue;
        dartUsed = true;
      }
      operating_income = dartData.operating_income;
      equity = dartData.equity;
      dartName = dartData.name;
    }
  }

  // Derived calculations
  const marketCap = yahooData.marketCap ?? null;
  const totalDebt = yahooData.totalDebt ?? null;
  const totalCash = yahooData.totalCash ?? null;

  const net_debt =
    totalDebt !== null && totalCash !== null ? totalDebt - totalCash : null;

  // EV/Sales = (시총 + 순차입금) / 매출
  let ev_sales: number | null = null;
  if (marketCap !== null && net_debt !== null && revenue !== null && revenue > 0) {
    ev_sales = (marketCap + net_debt) / revenue;
    ev_sales = Math.round(ev_sales * 100) / 100;
  } else if (marketCap !== null && revenue !== null && revenue > 0) {
    // net_debt unknown, use EV ≈ market cap only
    ev_sales = Math.round((marketCap / revenue) * 100) / 100;
  }

  const calculated: string[] = [];
  if (net_debt !== null) calculated.push("net_debt");
  if (ev_sales !== null) calculated.push("ev_sales");

  const name = dartName ?? yahooName ?? ticker;

  return {
    name,
    marketCap,
    totalDebt,
    totalCash,
    pbr: yahooData.pbr ?? null,
    per_trailing: yahooData.per_trailing ?? null,
    per_fwd: null,
    ev_ebitda: yahooData.ev_ebitda ?? null,
    roe: yahooData.roe ?? null,
    operating_margin: yahooData.operating_margin ?? null,
    revenue,
    operating_income,
    equity,
    net_debt,
    ev_sales,
    _sources: { yahoo: true, dart: dartUsed, calculated },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function collectPeers(
  subject: string,
  subjectName: string,
  peerTickers: string[]
): Promise<PeerSnapshot> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const results: Record<string, PeerMultiples> = {};

  await Promise.allSettled(
    peerTickers.map(async (rawTicker) => {
      // KRX 캐시로 한국 티커 교정 (.KS/.KQ 오류 방지)
      const ticker = correctKoreanTicker(rawTicker);
      if (ticker !== rawTicker) {
        console.log(`[peer-collector] Ticker corrected: ${rawTicker} → ${ticker}`);
      }
      try {
        console.log(`[peer-collector] Collecting ${ticker}...`);
        const data = await collectPeer(ticker);
        results[ticker] = data;
        console.log(`[peer-collector] Done ${ticker}: ${data.name}`);
      } catch (err) {
        console.warn(`[peer-collector] Skip ${ticker}:`, (err as Error).message);
      }
    })
  );

  const snapshot: PeerSnapshot = {
    subject,
    subject_name: subjectName,
    collected_at: new Date().toISOString(),
    peers: results,
  };

  // Save dated file
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const dir = path.join(DATA_DIR, subject);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `peers_${dateStr}.json`),
    JSON.stringify(snapshot, null, 2)
  );
  // Save latest (overwrite)
  await fs.writeFile(
    path.join(dir, "peers_latest.json"),
    JSON.stringify(snapshot, null, 2)
  );

  return snapshot;
}

export async function getLatestPeers(subject: string): Promise<PeerSnapshot | null> {
  const filePath = path.join(DATA_DIR, subject, "peers_latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PeerSnapshot;
  } catch {
    return null;
  }
}

export async function getPeerHistory(subject: string): Promise<string[]> {
  const dir = path.join(DATA_DIR, subject);
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((f) => f.startsWith("peers_") && f.endsWith(".json") && f !== "peers_latest.json")
      .map((f) => f.replace("peers_", "").replace(".json", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function getPeersByDate(
  subject: string,
  dateStr: string
): Promise<PeerSnapshot | null> {
  const filePath = path.join(DATA_DIR, subject, `peers_${dateStr}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PeerSnapshot;
  } catch {
    return null;
  }
}

// Merge manual overrides (per_fwd, etc.) into collected data
export async function updateManualFields(
  subject: string,
  peerTicker: string,
  fields: Partial<Pick<PeerMultiples, "per_fwd">>
): Promise<PeerSnapshot | null> {
  const snapshot = await getLatestPeers(subject);
  if (!snapshot || !snapshot.peers[peerTicker]) return null;
  snapshot.peers[peerTicker] = { ...snapshot.peers[peerTicker], ...fields };
  const dir = path.join(DATA_DIR, subject);
  await fs.writeFile(
    path.join(dir, "peers_latest.json"),
    JSON.stringify(snapshot, null, 2)
  );
  return snapshot;
}

// Compute averages (null-excluded)
export function computePeerAverages(
  peers: Record<string, PeerMultiples>
): Partial<PeerMultiples> {
  const vals = Object.values(peers);
  const avg = (key: keyof PeerMultiples): number | null => {
    const nums = vals
      .map((p) => p[key] as number | null)
      .filter((v): v is number => v !== null && isFinite(v));
    if (!nums.length) return null;
    return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
  };
  return {
    name: "피어 평균",
    marketCap: avg("marketCap"),
    pbr: avg("pbr"),
    per_trailing: avg("per_trailing"),
    ev_ebitda: avg("ev_ebitda"),
    ev_sales: avg("ev_sales"),
    roe: avg("roe"),
    operating_margin: avg("operating_margin"),
    revenue: avg("revenue"),
    net_debt: avg("net_debt"),
    per_fwd: avg("per_fwd"),
  };
}
