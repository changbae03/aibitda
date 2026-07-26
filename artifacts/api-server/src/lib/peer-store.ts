/**
 * peer-store.ts — 종목별 피어그룹 저장·조회.
 *
 * 설계 요지: 피어의 지표는 외부 API가 아니라 우리 종목 마스터(stocks 뷰)에서 조인해 온다.
 *
 * 예전에는 피어 5개를 비교하려면 야후·네이버를 5~15회 두드려야 했다. 느리고,
 * 실패가 잦고, 분석마다 값이 달라져 비교가 흔들렸다. 종목 마스터에는 이미
 * 한국 2,800 + 미국 10,400여 종목의 PER·PBR·ROE·시총이 정리돼 있으므로
 * 같은 숫자를 한 번의 질의로 가져올 수 있다.
 *
 * 티커는 반드시 표준형(005930 / NVDA)으로 저장한다 — stocks 뷰와 조인해야 하므로
 * 표기가 어긋나면 지표가 통째로 비어 버린다(지표 캐시 0% 사건과 같은 유형).
 */

import { pool } from "@workspace/db";
import { normalizeTicker } from "@workspace/shared";
import type { PeerWithMetrics } from "./peer-format.js";

// 표기 규칙은 peer-format.ts가 소유한다(DB 없이 테스트하기 위해 분리).
// 기존 호출부가 peer-store에서 계속 가져다 쓸 수 있도록 재수출한다.
export { formatPeerTable, metric, formatCap } from "./peer-format.js";
export type { PeerWithMetrics } from "./peer-format.js";

export interface PeerInput {
  ticker: string;
  name?: string | null;
  reason?: string | null;
}

/**
 * 피어그룹을 저장한다. 같은 (종목, 피어) 조합은 덮어쓴다.
 * 표준형으로 바꿀 수 없는 티커나 자기 자신은 조용히 건너뛴다.
 */
export async function savePeers(
  ticker: string,
  peers: PeerInput[],
  opts: { source?: string; analysisId?: number | null } = {},
): Promise<number> {
  const base = normalizeTicker(ticker);
  if (!base || peers.length === 0) return 0;

  const source = opts.source ?? "ai";
  const analysisId = opts.analysisId ?? null;
  let saved = 0;

  for (let i = 0; i < peers.length; i++) {
    const p = peers[i];
    const peerTicker = normalizeTicker(p.ticker);
    if (!peerTicker || peerTicker === base) continue;

    try {
      await pool.query(
        `INSERT INTO stock_peers (ticker, peer_ticker, peer_name, rank, reason, source, selected_by_analysis_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (ticker, peer_ticker) DO UPDATE SET
           peer_name  = COALESCE(EXCLUDED.peer_name, stock_peers.peer_name),
           rank       = EXCLUDED.rank,
           reason     = COALESCE(EXCLUDED.reason, stock_peers.reason),
           source     = EXCLUDED.source,
           selected_by_analysis_id = COALESCE(EXCLUDED.selected_by_analysis_id, stock_peers.selected_by_analysis_id),
           updated_at = NOW()`,
        [base, peerTicker, p.name ?? null, i, p.reason ?? null, source, analysisId],
      );
      saved++;
    } catch (e: any) {
      console.warn(`[peer-store] 저장 실패 ${base}→${peerTicker}: ${e?.message}`);
    }
  }

  if (saved > 0) console.log(`[peer-store] ${base} 피어 ${saved}개 저장 (source=${source})`);
  return saved;
}

/**
 * 저장된 피어그룹을 지표와 함께 한 번의 질의로 읽는다.
 * 마스터에 없는 피어도 행은 돌려준다(지표만 null) — 이름·선정이유는 여전히 쓸모가 있다.
 */
export async function getPeersWithMetrics(ticker: string, limit = 8): Promise<PeerWithMetrics[]> {
  const base = normalizeTicker(ticker);
  if (!base) return [];

  const { rows } = await pool.query(
    `SELECT p.peer_ticker, COALESCE(p.peer_name, s.name) AS name, p.rank, p.reason, p.source,
            s.market, s.sector, s.per, s.pbr, s.roe, s.opm, s.market_cap, s.current_price
       FROM stock_peers p
       LEFT JOIN stocks s ON s.ticker = p.peer_ticker
      WHERE p.ticker = $1
      ORDER BY p.rank ASC, p.updated_at DESC
      LIMIT $2`,
    [base, limit],
  );

  return rows.map((r: any) => ({
    ticker: r.peer_ticker,
    name: r.name ?? null,
    rank: r.rank ?? 0,
    reason: r.reason ?? null,
    source: r.source ?? "ai",
    market: r.market ?? null,
    sector: r.sector ?? null,
    per: r.per ?? null,
    pbr: r.pbr ?? null,
    roe: r.roe ?? null,
    opm: r.opm ?? null,
    marketCap: r.market_cap ?? null,
    currentPrice: r.current_price ?? null,
  }));
}

/**
 * 같은 업종에서 시가총액이 가까운 종목을 피어 후보로 뽑는다.
 * AI 선정이 실패했을 때의 대비책이자, krx_peer_data(0행이라 늘 빈손이던 표)의 대체다.
 * 시총이 비슷한 쪽이 비교 대상으로 타당하므로 로그 거리로 정렬한다.
 */
export async function getSectorPeers(ticker: string, limit = 6): Promise<PeerWithMetrics[]> {
  const base = normalizeTicker(ticker);
  if (!base) return [];

  const { rows } = await pool.query(
    `WITH me AS (
       SELECT sector, market, market_cap FROM stocks WHERE ticker = $1
     )
     SELECT s.ticker AS peer_ticker, s.name, s.market, s.sector,
            s.per, s.pbr, s.roe, s.opm, s.market_cap, s.current_price
       FROM stocks s, me
      WHERE s.ticker <> $1
        AND s.sector IS NOT NULL
        AND s.sector = me.sector
        AND s.market = me.market
        AND s.market_cap IS NOT NULL
      ORDER BY CASE
                 WHEN me.market_cap IS NULL OR me.market_cap <= 0 THEN s.market_cap
                 ELSE ABS(LN(GREATEST(s.market_cap, 1)::numeric) - LN(GREATEST(me.market_cap, 1)::numeric))
               END ASC
      LIMIT $2`,
    [base, limit],
  );

  return rows.map((r: any, i: number) => ({
    ticker: r.peer_ticker,
    name: r.name ?? null,
    rank: i,
    reason: "같은 업종·유사 시가총액 (자동 선정)",
    source: "sector",
    market: r.market ?? null,
    sector: r.sector ?? null,
    per: r.per ?? null,
    pbr: r.pbr ?? null,
    roe: r.roe ?? null,
    opm: r.opm ?? null,
    marketCap: r.market_cap ?? null,
    currentPrice: r.current_price ?? null,
  }));
}
