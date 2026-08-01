/**
 * collect-us-financials-batch.ts — 미국 전 종목의 연간 재무를 **시총 순, 재개 가능하게**
 * SEC EDGAR(companyfacts)에서 대량 수집해 us_financials에 저장한다.
 *
 * 한국의 collect-biz-batch(DART)에 대응하는 미국판이다. `collectUSFinancials`가 이미
 * 저장된 종목(연도 2개 이상)은 SEC를 다시 치지 않고 건너뛰므로 재개가 공짜다.
 *
 * SEC는 DART 같은 일일 한도가 없고 "초당 10회"가 규칙이다 — DELAY로 지킨다.
 * 상당수 미국 티커(ETF·소형 ADR)는 10-K/XBRL이 없어 빈손이 정상이다.
 *
 * 실행:
 *   tsx --env-file-if-exists=../../.env ./src/scripts/collect-us-financials-batch.ts
 * 환경변수:
 *   BATCH_LIMIT  이번 실행 처리 종목 수 (기본 1000)
 *   BATCH_DELAY  종목 사이 지연 ms (기본 160 ≈ 6/초, SEC 10/초 규칙 이내)
 */

import { pool } from "@workspace/db";
import { collectUSFinancials } from "../lib/us-financials.js";

const LIMIT = Number(process.env["BATCH_LIMIT"] ?? 1000);
const DELAY = Number(process.env["BATCH_DELAY"] ?? 160);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  // 시총 큰 순 = 사람들이 실제로 찾는 종목 먼저.
  const { rows } = await pool.query<{ ticker: string; name: string }>(
    `SELECT ticker, name FROM stocks
      WHERE market = 'US'
      ORDER BY market_cap DESC NULLS LAST, ticker`,
  );
  console.log(`대상 ${rows.length}개(미국) 중 이번 실행 최대 ${LIMIT}개`);

  let processed = 0, collectedStocks = 0, totalYears = 0, emptyStreak = 0;
  const t0 = Date.now();

  for (const { ticker, name } of rows) {
    if (processed >= LIMIT) { console.log(`\n이번 실행 한도(${LIMIT}) 도달 — 정상 종료`); break; }
    try {
      const years = await collectUSFinancials(ticker);
      processed++;
      if (years.length >= 2) {
        collectedStocks++; totalYears += years.length; emptyStreak = 0;
        if (processed % 25 === 0 || collectedStocks <= 20) {
          console.log(`[${processed}] ${ticker} ${name} — ${years.length}개년 (${years[years.length - 1].fy} 매출 ${years[years.length - 1].revenue ? (years[years.length - 1].revenue! / 1e9).toFixed(1) + "B" : "—"})`);
        }
      } else {
        // XBRL 없음(ETF·소형) 또는 일시 장애. 연속으로 쌓이면 SEC 차단일 수 있다.
        emptyStreak++;
        if (emptyStreak >= 50) {
          console.log(`\n⚠️ 빈손 50연속 — SEC 차단/장애 가능. 멈춤(재실행하면 이어짐).`);
          break;
        }
      }
    } catch (e) {
      console.warn(`[${processed}] ${ticker} 예외: ${(e as Error).message?.slice(0, 80)}`);
    }
    await sleep(DELAY);
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const done = await pool.query(`SELECT count(DISTINCT ticker)::int n FROM us_financials`);
  console.log(
    `\n=== 종료 (${mins}분) ===\n` +
    `이번 실행 처리 ${processed}개 · 신규수집 ${collectedStocks}개 · 총 연-행 ${totalYears}\n` +
    `전체 저장된 미국 종목: ${done.rows[0].n} / ${rows.length}`,
  );
  await pool.end();
}

main().catch(async e => { console.error("치명적 오류:", e); await pool.end(); process.exit(1); });
