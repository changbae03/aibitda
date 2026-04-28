import path from "path";
import fs from "fs/promises";
import YahooFinance from "yahoo-finance2";
import { correctKoreanTicker } from "./krx-cache.js";
import { pool } from "@workspace/db";
import { sanitizePathComponent, validateDateStr } from "./sanitize.js";

const NAVER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Referer": "https://m.stock.naver.com/",
};

// ─── Ticker Metric Cache (DB 영속 캐시) ───────────────────────────────────────
// 성공적으로 가져온 PBR 등 지표를 저장, 다음 분석 시 폴백으로 재활용 (30일 유효)

interface CachedMetrics {
  pbr: number | null;
  per_trailing: number | null;
  ev_ebitda: number | null;
  roe: number | null;
  operating_margin: number | null;
  market_cap: number | null;
  book_value: number | null;
}

async function readMetricCache(ticker: string): Promise<CachedMetrics | null> {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT pbr, per_trailing, ev_ebitda, roe, operating_margin, market_cap, book_value, updated_at
         FROM ticker_metric_cache WHERE ticker = $1`,
        [ticker]
      );
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      // 30일 이상 된 캐시는 무효화
      const ageDays = (Date.now() - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > 30) return null;
      console.log(`[metric-cache] HIT for ${ticker} (${Math.round(ageDays)}d old)`);
      return {
        pbr: row.pbr ?? null,
        per_trailing: row.per_trailing ?? null,
        ev_ebitda: row.ev_ebitda ?? null,
        roe: row.roe ?? null,
        operating_margin: row.operating_margin ?? null,
        market_cap: row.market_cap ?? null,
        book_value: row.book_value ?? null,
      };
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn(`[metric-cache] read error for ${ticker}:`, e);
    return null;
  }
}

export async function writeMetricCache(ticker: string, metrics: Partial<CachedMetrics>): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      // null이 아닌 값만 업데이트 (기존 캐시의 non-null 값을 null로 덮어쓰지 않음)
      await client.query(
        `INSERT INTO ticker_metric_cache (ticker, pbr, per_trailing, ev_ebitda, roe, operating_margin, market_cap, book_value, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         ON CONFLICT (ticker) DO UPDATE SET
           pbr             = COALESCE($2, ticker_metric_cache.pbr),
           per_trailing    = COALESCE($3, ticker_metric_cache.per_trailing),
           ev_ebitda       = COALESCE($4, ticker_metric_cache.ev_ebitda),
           roe             = COALESCE($5, ticker_metric_cache.roe),
           operating_margin= COALESCE($6, ticker_metric_cache.operating_margin),
           market_cap      = COALESCE($7, ticker_metric_cache.market_cap),
           book_value      = COALESCE($8, ticker_metric_cache.book_value),
           updated_at      = NOW()`,
        [
          ticker,
          metrics.pbr ?? null,
          metrics.per_trailing ?? null,
          metrics.ev_ebitda ?? null,
          metrics.roe ?? null,
          metrics.operating_margin ?? null,
          metrics.market_cap ?? null,
          metrics.book_value ?? null,
        ]
      );
      console.log(`[metric-cache] WRITE for ${ticker}: pbr=${metrics.pbr}`);
    } finally {
      client.release();
    }
  } catch (e) {
    console.warn(`[metric-cache] write error for ${ticker}:`, e);
  }
}

export async function fetchNaverPBR(code: string): Promise<number | null> {
  try {
    // /integration API → totalInfos 배열에서 pbr code 항목 추출
    const data = await fetch(
      `https://m.stock.naver.com/api/stock/${code}/integration`,
      { headers: NAVER_HEADERS, signal: AbortSignal.timeout(8000) }
    ).then(r => r.ok ? r.json() : null);
    if (!data) return null;

    const totalInfos: any[] = data?.totalInfos ?? [];
    const pbrItem = totalInfos.find((i: any) => i?.code === "pbr");
    if (!pbrItem?.value) return null;

    // "1.13배" → 1.13
    const raw = String(pbrItem.value).replace(/[배,\s]/g, "");
    const n = parseFloat(raw);
    return isNaN(n) || n <= 0 ? null : n;
  } catch {
    return null;
  }
}

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

interface YahooRawData extends Partial<PeerMultiples> {
  ebitda?: number | null;
  sharesOutstanding?: number | null;
  regularMarketPrice?: number | null;
  bookValue?: number | null;
}

async function fetchYahooData(ticker: string): Promise<{
  data: YahooRawData;
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

    // PBR: quoteSummary → quote.priceToBook → quote.bookValue 기반 계산
    const pbr: number | null = ks?.priceToBook ?? q?.priceToBook ?? null;

    // PER TTM: quoteSummary → quote.trailingPE → price/EPS 계산
    let per_trailing: number | null = sd?.trailingPE ?? ks?.trailingPE ?? q?.trailingPE ?? null;
    if (per_trailing == null && q?.regularMarketPrice != null) {
      const eps = q?.epsTrailingTwelveMonths ?? null;
      if (eps != null && eps > 0) per_trailing = q.regularMarketPrice / eps;
    }

    // EV/EBITDA: Yahoo 직접 제공 값 우선, 없으면 ebitda 필드 보존해서 나중에 계산
    const ev_ebitda_direct: number | null = ks?.enterpriseToEbitda ?? null;

    // EBITDA 직접 값 (financialData에서 — 은행주는 Yahoo가 enterpriseToEbitda 미제공)
    const ebitdaRaw: number | null = fd?.ebitda ?? null;

    const sharesOutstanding: number | null = ks?.sharesOutstanding ?? pr?.sharesOutstanding ?? null;
    const regularMarketPrice: number | null = q?.regularMarketPrice ?? pr?.regularMarketPrice ?? null;
    const bookValue: number | null = q?.bookValue ?? null;

    return {
      name: pr?.longName ?? pr?.shortName ?? q?.longName ?? q?.shortName ?? null,
      data: {
        marketCap,
        totalDebt,
        totalCash,
        pbr,
        per_trailing,
        ev_ebitda: ev_ebitda_direct,
        roe: fd?.returnOnEquity != null ? fd.returnOnEquity * 100 : null,
        operating_margin: fd?.operatingMargins != null ? fd.operatingMargins * 100 : null,
        revenue: fd?.totalRevenue ?? null,
        ebitda: ebitdaRaw,
        sharesOutstanding,
        regularMarketPrice,
        bookValue,
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

      // 일반기업: 매출액 / 건설업: 공사매출·건설매출 / 은행·보험·금융: 이자수익, 영업수익
      const revenue = find(["매출액", "공사매출", "건설매출", "도급매출", "이자수익", "영업수익", "순이자이익", "보험료수익"]);
      const operating_income = find(["영업이익", "영업손실"]);
      const equity = findBS(["자본총계"]);

      // 매출 또는 영업이익 또는 자본총계 중 하나라도 있으면 반환
      if (revenue !== null || operating_income !== null || equity !== null) {
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
  // 건설업 특화 계정
  unbilledWork: number | null;          // 미청구공사
  constructionReceivables: number | null; // 공사미수금
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

        // 건설업 특화 계정 (없으면 null — 비건설사에도 무해)
        const unbilledWork             = findBS(["미청구공사"]);
        const constructionReceivables  = findBS(["공사미수금", "공사수입금"]);

        if (cash !== null || totalAssets !== null) {
          return { year, fsType: sj, cash, totalAssets, totalLiab, equity, totalDebt, unbilledWork, constructionReceivables };
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

  // Naver Finance PBR (한국주 전용, Yahoo 미제공 시 폴백)
  let naverPbr: number | null = null;
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
    // Yahoo Finance PBR이 없으면 Naver Finance에서 가져옴
    if (yahooData.pbr == null) {
      naverPbr = await fetchNaverPBR(stockCode(ticker));
      if (naverPbr != null) console.log(`[peer-collector] Naver PBR for ${ticker}: ${naverPbr}`);
    }
  }

  // Derived calculations
  const marketCap = yahooData.marketCap ?? null;
  const totalDebt = yahooData.totalDebt ?? null;
  const totalCash = yahooData.totalCash ?? null;
  const sharesOutstanding = yahooData.sharesOutstanding ?? null;
  const regularMarketPrice = yahooData.regularMarketPrice ?? null;

  const net_debt =
    totalDebt !== null && totalCash !== null ? totalDebt - totalCash : null;

  // EV (Enterprise Value)
  const ev: number | null =
    marketCap !== null
      ? marketCap + (net_debt ?? (totalDebt ?? 0) - (totalCash ?? 0))
      : null;

  // ─── PBR 계산 폴백 ────────────────────────────────────────────────────────
  let pbr: number | null = yahooData.pbr ?? naverPbr ?? null;
  if (pbr == null) {
    // 1) Yahoo bookValue 필드로 계산: PBR = price / bookValue
    if (regularMarketPrice != null && yahooData.bookValue != null && yahooData.bookValue > 0) {
      pbr = Math.round((regularMarketPrice / yahooData.bookValue) * 100) / 100;
      console.log(`[peer-collector] Calculated PBR from bookValue for ${ticker}: ${pbr}`);
    }
    // 2) DART 자본 + Yahoo 발행주식수로 계산: PBR = price / (equity / shares)
    if (pbr == null && equity != null && sharesOutstanding != null && sharesOutstanding > 0 && regularMarketPrice != null) {
      const bvps = equity / sharesOutstanding;
      if (bvps > 0) {
        pbr = Math.round((regularMarketPrice / bvps) * 100) / 100;
        console.log(`[peer-collector] Calculated PBR from DART equity for ${ticker}: ${pbr}`);
      }
    }
    // 3) DB 캐시에서 이전에 성공적으로 가져온 PBR 재활용
    if (pbr == null) {
      const cached = await readMetricCache(ticker);
      if (cached?.pbr != null) {
        pbr = cached.pbr;
        console.log(`[peer-collector] PBR from DB cache for ${ticker}: ${pbr}`);
      }
    }
  }

  // ─── EV/EBITDA 계산 폴백 ─────────────────────────────────────────────────
  let ev_ebitda: number | null = yahooData.ev_ebitda ?? null;
  if (ev_ebitda == null && ev != null) {
    // 1) Yahoo financialData.ebitda 직접 값
    const ebitdaFromYahoo = yahooData.ebitda ?? null;
    if (ebitdaFromYahoo != null && ebitdaFromYahoo > 0) {
      ev_ebitda = Math.round((ev / ebitdaFromYahoo) * 10) / 10;
      console.log(`[peer-collector] Calculated EV/EBITDA from Yahoo EBITDA for ${ticker}: ${ev_ebitda}`);
    }
    // 2) DART 영업이익으로 EBITDA 근사 (D&A 미포함이지만 폴백)
    if (ev_ebitda == null && operating_income != null && operating_income > 0) {
      ev_ebitda = Math.round((ev / operating_income) * 10) / 10;
      console.log(`[peer-collector] Approximated EV/EBITDA from operating income for ${ticker}: ${ev_ebitda} (no D&A)`);
    }
  }

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
  if (pbr !== null && (yahooData.pbr == null && naverPbr == null)) calculated.push("pbr");
  if (ev_ebitda !== null && yahooData.ev_ebitda == null) calculated.push("ev_ebitda");

  const name = dartName ?? yahooName ?? ticker;
  const per_trailing = yahooData.per_trailing ?? null;
  const roe = yahooData.roe ?? null;
  const operating_margin = yahooData.operating_margin ?? null;

  // ─── DB 캐시 저장 (non-null 지표만 업서트) ──────────────────────────────────
  // 이전 분석에서 가져온 값을 재활용할 수 있도록 성공한 지표를 저장
  writeMetricCache(ticker, {
    pbr,
    per_trailing,
    ev_ebitda,
    roe,
    operating_margin,
    market_cap: marketCap,
    book_value: yahooData.bookValue ?? null,
  }).catch(() => {});  // 캐시 쓰기 실패해도 분석 계속

  return {
    name,
    marketCap,
    totalDebt,
    totalCash,
    pbr,
    per_trailing,
    per_fwd: null,
    ev_ebitda,
    roe,
    operating_margin,
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
  const safeSubject = sanitizePathComponent(subject);
  if (!safeSubject) throw new Error(`Invalid subject for file storage: ${subject}`);
  const dir = path.join(DATA_DIR, safeSubject);
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
  const safe = sanitizePathComponent(subject);
  if (!safe) return null;
  const filePath = path.join(DATA_DIR, safe, "peers_latest.json");
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as PeerSnapshot;
  } catch {
    return null;
  }
}

export async function getPeerHistory(subject: string): Promise<string[]> {
  const safe = sanitizePathComponent(subject);
  if (!safe) return [];
  const dir = path.join(DATA_DIR, safe);
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
  const safeSubject = sanitizePathComponent(subject);
  const safeDateStr = validateDateStr(dateStr);
  if (!safeSubject || !safeDateStr) return null;
  const filePath = path.join(DATA_DIR, safeSubject, `peers_${safeDateStr}.json`);
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
  const safeSubject = sanitizePathComponent(subject);
  if (!safeSubject) return null;
  const dir = path.join(DATA_DIR, safeSubject);
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

// ─── 절대값 상한 (피어 배수 아웃라이어 필터링) ─────────────────────────────────
// "너무 차이나는 것만" 제외 원칙 — 프리미엄 글로벌 기업(ASML·KLAC 등) 정상 배수 보존
const PEER_ABSOLUTE_CAPS: Partial<Record<keyof PeerMultiples, number>> = {
  ev_ebitda: 80,    // EV/EBITDA: 반도체장비·빅테크 40~60x는 정상 범위 → 80x 초과만 이상치
  per_trailing: 120, // PER: 고성장·적자 전환 기업 100x도 존재 → 120x 초과만
  per_fwd: 120,
  ev_sales: 20,     // EV/Sales: 15x → 20x (SaaS·플랫폼 고배수 허용)
  pbr: 150,         // PBR: ASML 1271x는 이상치, KLAC 46x는 정상 → 150x 초과만
};

// Median 계산 (정렬 후 중간값)
function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 피어별 아웃라이어 태그 감지 및 중간값(median) 계산 반환
export function computePeerMedianExcludingOutliers(
  peers: Record<string, PeerMultiples>
): {
  medians: Partial<Record<keyof PeerMultiples, number | null>>;
  outlierTags: Record<string, Partial<Record<keyof PeerMultiples, string>>>;
} {
  const keys: (keyof PeerMultiples)[] = [
    "ev_ebitda", "per_trailing", "per_fwd", "ev_sales", "pbr",
  ];
  const outlierTags: Record<string, Partial<Record<keyof PeerMultiples, string>>> = {};
  const medians: Partial<Record<keyof PeerMultiples, number | null>> = {};

  for (const key of keys) {
    // 1차: 절대 상한 필터
    const validEntries: Array<[string, number]> = [];
    for (const [ticker, peer] of Object.entries(peers)) {
      const v = peer[key] as number | null;
      if (v == null || !isFinite(v) || v <= 0) continue;
      const cap = PEER_ABSOLUTE_CAPS[key];
      if (cap != null && v > cap) {
        if (!outlierTags[ticker]) outlierTags[ticker] = {};
        outlierTags[ticker][key] = `절대값 상한(${cap}x) 초과 이상치`;
        continue;
      }
      validEntries.push([ticker, v]);
    }

    if (validEntries.length === 0) {
      medians[key] = null;
      continue;
    }

    // 2차: 중간값 기준 상대 필터 (3.0배 초과만 이상치 — "너무 차이나는 것만" 원칙)
    const nums = validEntries.map(([, v]) => v);
    const med1 = median(nums);
    const finalValid: Array<[string, number]> = [];
    for (const [ticker, v] of validEntries) {
      if (v > med1 * 3.0) {
        if (!outlierTags[ticker]) outlierTags[ticker] = {};
        outlierTags[ticker][key] = `피어 중간값(${med1.toFixed(1)}x)의 3.0배 초과 이상치`;
      } else if (v < med1 * 0.2) {
        if (!outlierTags[ticker]) outlierTags[ticker] = {};
        outlierTags[ticker][key] = `피어 중간값(${med1.toFixed(1)}x)의 0.2배 미만 이상치`;
      } else {
        finalValid.push([ticker, v]);
      }
    }

    const finalNums = finalValid.map(([, v]) => v);
    medians[key] = finalNums.length > 0 ? Math.round(median(finalNums) * 100) / 100 : null;
  }

  return { medians, outlierTags };
}
