/**
 * collect-us-biz-batch.ts — 미국 10-K 본문을 미리 받아 쌓는다.
 *
 * 왜 필요한가. 이 제품의 핵심은 "몇 년치 공시를 나란히 놓고 읽기"인데,
 * 미국은 그 원문이 **7건**뿐이었다(한국은 39,651건). 요청이 올 때만 받아왔기 때문이다.
 * 그래서 미국 종목 분석은 행간 읽기 없이 재무 숫자만으로 돌았다.
 *
 * **시총 큰 순서로** 돈다. 언제 멈춰도 사람들이 실제로 찾는 종목부터 채워진다.
 * 재개는 공짜다 — `collectUSBizReports`가 2개년 이상 저장된 종목을 건너뛴다.
 *
 * 실행:
 *   pnpm exec tsx --env-file-if-exists=../../.env src/scripts/collect-us-biz-batch.ts [최대종목수]
 */

import { pool } from "@workspace/db";
import { collectUSBizReports } from "../lib/us-biz-reports.js";

// SEC는 초당 10건까지 허용한다. 막히면 그날 수집이 통째로 빈다 — 넉넉히 벌리지 않는다.
const CONCURRENCY = 3;

async function main() {
  const limit = Number(process.argv[2] ?? 10_000);

  // 이미 2개년 이상 있는 종목은 뺀다. 시총이 없는 종목은 뒤로 보낸다(NULLS LAST).
  const { rows } = await pool.query<{ ticker: string }>(
    `SELECT s.ticker FROM stocks s
      WHERE s.market = 'US'
        AND (SELECT count(*) FROM us_biz_reports r WHERE r.ticker = s.ticker) < 2
      ORDER BY s.market_cap DESC NULLS LAST
      LIMIT $1`, [limit]);

  const queue = rows.map(r => r.ticker);
  const total = queue.length;
  console.log(`[us-biz-batch] 대상 ${total}종목 (시총 큰 순서)`);

  let done = 0, ok = 0, empty = 0;
  const started = Date.now();

  const worker = async () => {
    for (;;) {
      const ticker = queue.shift();
      if (!ticker) return;
      try {
        const got = await collectUSBizReports(ticker, 4);
        if (got.length > 0) ok++; else empty++;
      } catch (e) {
        // 실패는 분석을 막지 않는다. 다만 **말 없이** 실패하지는 않는다.
        console.warn(`[us-biz-batch] ${ticker} 실패:`, (e as Error)?.message?.slice(0, 80));
        empty++;
      }
      if (++done % 50 === 0) {
        const min = ((Date.now() - started) / 60_000).toFixed(1);
        console.log(`[us-biz-batch] ${done}/${total} (성공 ${ok}, 빈손 ${empty}, ${min}분)`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`[us-biz-batch] 완료: ${done}종목 처리, 원문 확보 ${ok}, 빈손 ${empty}`);
  await pool.end();
}

main().catch(e => { console.error("[us-biz-batch] 중단:", e); process.exit(1); });
