/**
 * stock-registry.ts — "이 종목을 우리가 알고 있는가"를 책임지는 단일 창구
 *
 * 종목 마스터는 시장별로 테이블이 나뉘어 있다(krx_stocks / us_stocks).
 * 호출부가 매번 "한국인가 미국인가"를 판단해 다른 테이블에 넣게 두면 빠뜨리는 곳이
 * 생기므로, 등록은 이 파일 하나를 거치게 한다.
 *
 * 왜 자가 치유가 필요한가:
 * 목록을 어디서 받아오든 빈틈이 남는다. 실측(2026-07-25) 결과 분석된 종목 23개가
 * 마스터에 없었고, SEC 공식 목록으로 19개는 메워지지만 나머지는 여전히 빠진다.
 *   · NTDOY  — 장외 ADR이라 SEC 티커 목록에 없음
 *   · 005935 — 한국 우선주. KRX 목록 적재분에 빠져 있음
 *   · CISCO  — 잘못된 티커(CSCO 오타)가 분석에 들어온 흔적
 * 목록을 키우는 방식으로는 이 틈이 계속 생기므로, 실제로 분석하는 순간 등록해 버린다.
 */

import { pool } from "@workspace/db";
import { normalizeTicker, isKoreanTicker } from "@workspace/shared";

/**
 * 분석 대상 종목이 마스터에 없으면 등록한다.
 *
 * 지표(PER·시총 등)는 채우지 않는다 — 수집기가 나중에 채운다. 여기서는 "존재한다"는
 * 사실만 남겨 수집 대상에 오르게 하는 것이 목적이다.
 * 분석 흐름을 막으면 안 되므로 어떤 실패도 삼키고 로그만 남긴다.
 */
export async function ensureStockRegistered(ticker: string, name?: string | null): Promise<void> {
  const t = normalizeTicker(ticker);
  if (!t) return;

  const displayName = (name ?? t).slice(0, 200);

  try {
    if (isKoreanTicker(t)) {
      // krx_stocks.exchange는 NOT NULL이다. 어느 시장인지는 수집기가 확정하므로
      // 여기서는 자리만 잡아 둔다.
      await pool.query(
        `INSERT INTO krx_stocks (code, name, exchange)
         VALUES ($1, $2, 'UNKNOWN')
         ON CONFLICT (code) DO NOTHING`,
        [t, displayName]
      );
    } else {
      await pool.query(
        `INSERT INTO us_stocks (ticker, name, exchange)
         VALUES ($1, $2, 'UNKNOWN')
         ON CONFLICT (ticker) DO NOTHING`,
        [t, displayName]
      );
    }
  } catch (err: any) {
    console.warn(`[stock-registry] 자가 등록 실패 ${t}:`, err?.message?.slice(0, 80));
  }
}
