/**
 * kis-industry-backfill.ts — 한국 종목의 KIS 표준산업분류를 채운다.
 *
 * 왜 별도 작업인가.
 * `krx-full-harvester`도 수집하면서 kis_industry를 함께 쓰지만, 그쪽은 야후 지표를
 * 다시 받는 무거운 작업이라 주 1회(REFRESH_DAYS=7) 주기로 돈다. 반면 업종 분류가
 * 비어 있으면 그동안 계속 야후 industry 단독으로 판정되고, 그 판정은 한국 종목에서
 * 자주 틀린다 — 한화시스템이 야후 기준 "Aerospace & Defense"라 미국 뉴스페이스
 * 규칙(EV/Sales 20~60x)을 받았던 것이 그 사례다. KIS로는 "전자부품 제조업"이다.
 *
 * 이 작업은 KIS 한 번만 부르고 컬럼 두 개만 갱신하므로 가볍다. 실측으로 2,800종목이
 * 30초쯤 걸린다(동시 10, 성공률 93%). 남는 7%는 지주사·신규상장처럼 KIS에도
 * 표준분류가 없는 종목이라 재시도해도 채워지지 않는다.
 */

import { pool } from "@workspace/db";
import { fetchKISStockNames } from "./kis-client.js";
import { classifySector } from "./sector-taxonomy.js";

const CONCURRENCY = 10;

export interface BackfillResult {
  /** 시도한 종목 수 */
  processed: number;
  /** KIS가 표준분류를 준 종목 수 */
  filled: number;
  /** 분류가 바뀐 종목 수 (야후 단독 판정 → KIS 보정) */
  reclassified: number;
}

/**
 * kis_industry가 비어 있는 종목을 채운다.
 *
 * @param limit 한 번에 처리할 최대 종목 수. 스케줄러에서 부담을 나누고 싶을 때 쓴다.
 */
export async function backfillKisIndustry(limit = 5000): Promise<BackfillResult> {
  const { rows: pending } = await pool.query<{
    code: string;
    industry: string | null;
    sector: string | null;
  }>(
    `SELECT code, industry, sector FROM krx_stocks
      WHERE kis_industry IS NULL
      ORDER BY market_cap DESC NULLS LAST
      LIMIT $1`,
    [limit],
  );

  if (pending.length === 0) {
    console.log("[kis-industry] 채울 종목 없음");
    return { processed: 0, filled: 0, reclassified: 0 };
  }

  console.log(`[kis-industry] ${pending.length}개 종목 분류 수집 시작`);

  let filled = 0;
  let reclassified = 0;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);

    await Promise.all(
      chunk.map(async (s) => {
        const names = await fetchKISStockNames(s.code).catch(() => null);
        const kisIndustry = names?.stdIndustry ?? null;
        if (!kisIndustry) return;

        // 분류가 바뀔 수 있으므로 sector도 함께 다시 계산한다.
        // 이 값을 안 고치면 kis_industry만 채워지고 판정은 옛 값에 머문다.
        const sector = classifySector(s.industry, "KR", kisIndustry);

        await pool.query(
          `UPDATE krx_stocks SET kis_industry = $2, sector = $3 WHERE code = $1`,
          [s.code, kisIndustry, sector],
        );

        filled++;
        if (sector !== s.sector) reclassified++;
      }),
    );
  }

  console.log(
    `[kis-industry] 완료 — ${filled}/${pending.length}개 채움, 업종 재판정 ${reclassified}개`,
  );
  return { processed: pending.length, filled, reclassified };
}
