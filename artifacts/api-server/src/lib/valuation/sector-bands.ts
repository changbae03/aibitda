/**
 * sector-bands.ts — 업종별 배수 밴드를 우리 종목 DB에서 실측해 적재·조회한다.
 *
 * 배경: 프롬프트에 들어가는 "업종 PER/PBR 범위"가 performance.ts·pipeline.ts·
 * ai-agents.ts 세 곳에 손으로 적혀 있었고, 값이 서로 달랐으며, 무엇보다 적어둔
 * 시점에 멈춰 있었다. 2026-07 실측 대조:
 *
 *   한국 방산  코드 "PER 12~28x"   vs  실제 중앙값 26.4x, 상위25% 34.8x
 *   한국 건설  코드 "PBR 0.3~0.6x"  vs  실제 중앙값 0.57x, 상위25% 1.00x
 *
 * 미국 종목 목록을 358개 하드코딩에서 SEC 실시간으로 바꿨던 것과 같은 처방이다.
 * 손으로 적은 숫자는 반드시 낡는다.
 */

import { pool } from "@workspace/db";
import { classifySector } from "../sector-taxonomy.js";
import {
  toStat,
  isUsablePer,
  isUsablePbr,
  isUsablePsr,
  renderBandBlock,
  type SectorBand,
} from "./band-format.js";

/**
 * 메모리 캐시. 집계는 하루 한 번이면 충분한데 프롬프트는 분석마다 읽으므로
 * 매번 DB를 때리지 않는다. 서버가 재시작하면 비지만 표는 DB에 남아 있다.
 */
let cache: { at: number; bands: Map<string, SectorBand> } | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * stocks 뷰를 훑어 섹터별 분포를 다시 계산하고 표를 갈아끼운다.
 *
 * 섹터 분류는 SQL로 표현할 수 없다(classifySector가 야후 industry·KIS 분류·
 * 종목명을 함께 본다). 그래서 종목을 다 읽어와 TS에서 묶는다. 전체 1만여 건이라
 * 한 번에 읽어도 부담이 없다.
 */
export async function refreshSectorBands(): Promise<{ sectors: number; stocks: number }> {
  const { rows } = await pool.query<{
    market: string | null;
    industry: string | null;
    kis_industry: string | null;
    per: number | null;
    pbr: number | null;
    market_cap: string | null;
    revenue: string | null;
  }>(`SELECT market, industry, kis_industry, per, pbr, market_cap, revenue
        FROM stocks WHERE industry IS NOT NULL`);

  type Group = { market: string; count: number; per: number[]; pbr: number[]; psr: number[] };
  const grouped = new Map<string, Group>();

  for (const s of rows) {
    const market = s.market === "KR" ? "KR" : "US";
    const sector = classifySector(s.industry ?? "", market, s.kis_industry);
    let g = grouped.get(sector);
    if (!g) {
      g = { market, count: 0, per: [], pbr: [], psr: [] };
      grouped.set(sector, g);
    }
    g.count++;
    if (isUsablePer(s.per)) g.per.push(Number(s.per));
    if (isUsablePbr(s.pbr)) g.pbr.push(Number(s.pbr));

    // market_cap·revenue는 bigint라 드라이버가 문자열로 준다 — Number로 옮겨야 나눗셈이 된다.
    const cap = Number(s.market_cap);
    const rev = Number(s.revenue);
    if (Number.isFinite(cap) && Number.isFinite(rev) && rev > 0) {
      const psr = cap / rev;
      if (isUsablePsr(psr)) g.psr.push(psr);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [sector, g] of grouped) {
      const per = toStat(g.per);
      const pbr = toStat(g.pbr);
      const psr = toStat(g.psr);
      await client.query(
        `INSERT INTO sector_multiple_bands
           (sector, market, stock_count, per_n, per_p25, per_p50, per_p75,
            pbr_n, pbr_p25, pbr_p50, pbr_p75,
            psr_n, psr_p25, psr_p50, psr_p75, computed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW())
         ON CONFLICT (sector) DO UPDATE SET
           market = EXCLUDED.market, stock_count = EXCLUDED.stock_count,
           per_n = EXCLUDED.per_n, per_p25 = EXCLUDED.per_p25,
           per_p50 = EXCLUDED.per_p50, per_p75 = EXCLUDED.per_p75,
           pbr_n = EXCLUDED.pbr_n, pbr_p25 = EXCLUDED.pbr_p25,
           pbr_p50 = EXCLUDED.pbr_p50, pbr_p75 = EXCLUDED.pbr_p75,
           psr_n = EXCLUDED.psr_n, psr_p25 = EXCLUDED.psr_p25,
           psr_p50 = EXCLUDED.psr_p50, psr_p75 = EXCLUDED.psr_p75,
           computed_at = NOW()`,
        [sector, g.market, g.count,
         per.n, per.p25, per.p50, per.p75,
         pbr.n, pbr.p25, pbr.p50, pbr.p75,
         psr.n, psr.p25, psr.p50, psr.p75],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  cache = null; // 다음 조회 때 새로 읽는다
  console.log(`[sector-bands] ${grouped.size}개 섹터 갱신 (종목 ${rows.length}건 집계)`);
  return { sectors: grouped.size, stocks: rows.length };
}

async function loadAll(): Promise<Map<string, SectorBand>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.bands;

  const { rows } = await pool.query(`SELECT * FROM sector_multiple_bands`);
  const bands = new Map<string, SectorBand>();
  for (const r of rows) {
    bands.set(r.sector, {
      sector: r.sector,
      market: r.market,
      stockCount: Number(r.stock_count),
      per: { n: Number(r.per_n), p25: r.per_p25, p50: r.per_p50, p75: r.per_p75 },
      pbr: { n: Number(r.pbr_n), p25: r.pbr_p25, p50: r.pbr_p50, p75: r.pbr_p75 },
      psr: { n: Number(r.psr_n), p25: r.psr_p25, p50: r.psr_p50, p75: r.psr_p75 },
      computedAt: new Date(r.computed_at),
    });
  }
  cache = { at: Date.now(), bands };
  return bands;
}

export async function getSectorBand(sector: string): Promise<SectorBand | null> {
  const bands = await loadAll();
  return bands.get(sector) ?? null;
}

/**
 * 프롬프트에 넣을 밴드 블록.
 *
 * 종목 마스터에서 industry와 KIS 분류를 직접 읽는다. 호출부가 industry만 들고
 * 있을 때가 많은데, 야후 industry 단독으로는 분류가 틀어진다 — 한화시스템은
 * 야후 기준 "Aerospace & Defense"라 미국 뉴스페이스와 같은 칸에 들어갔고,
 * 그 결과 EV/Sales 20~60x 지시를 받았다(실제 3.4x). KIS는 "전자부품 제조업"으로
 * 정확히 준다.
 *
 * 실패해도 분석은 계속돼야 하므로 절대 던지지 않는다.
 */
export async function buildSectorBandBlock(
  ticker: string,
  fallbackIndustry: string,
  market: "KR" | "US",
): Promise<string> {
  try {
    const { rows } = await pool.query<{ industry: string | null; kis_industry: string | null }>(
      `SELECT industry, kis_industry FROM stocks WHERE ticker = $1 LIMIT 1`,
      [ticker],
    );
    const industry = rows[0]?.industry ?? fallbackIndustry;
    const sector = classifySector(industry, market, rows[0]?.kis_industry);
    return renderBandBlock(await getSectorBand(sector), sector);
  } catch (e) {
    console.warn(`[sector-bands] ${ticker} 밴드 조회 실패 — 생략하고 진행:`, e);
    return "";
  }
}
