/**
 * collect-biz-batch.ts — 사업보고서 시계열을 **시총 순으로, 재개 가능하게** 대량 수집한다.
 *
 * 왜 배치가 따로 필요한가. `collectBizTimeline`은 종목 하나를 받는다. 전 종목(2,802)을
 * 돌리려면 순서·throttle·DART 일일 한도 감지·중단 후 재개가 필요하다. 그 껍데기다.
 *
 * 재개는 공짜다 — `collectBizTimeline`이 이미 받은 (종목·연도·분기)를 건너뛴다.
 * 그래서 몇 번을 다시 돌려도 중복 수집이 없고, 멈춘 자리에서 이어진다.
 *
 * 실행:
 *   tsx --env-file-if-exists=../../.env ./src/scripts/collect-biz-batch.ts
 * 환경변수:
 *   BATCH_LIMIT  이번 실행에서 처리할 종목 수 (기본 500)
 *   BATCH_DELAY  종목 사이 지연 ms (기본 250) — DART에 예의
 */

import { pool } from "@workspace/db";
import { collectBizTimeline } from "../lib/biz-timeline.js";
import { lookupCorpCode } from "../lib/dart-store.js";

const DART_API = "https://opendart.fss.or.kr/api";
const LIMIT = Number(process.env["BATCH_LIMIT"] ?? 500);
const DELAY = Number(process.env["BATCH_DELAY"] ?? 250);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * DART 일일 한도를 넘겼는지 싸게 확인한다. 삼성전자 corp로 목록을 한 번 조회해
 * status를 본다 — "020"이 요청제한 초과다. 넘겼으면 계속 때려봐야 전부 실패하니 멈춘다.
 */
async function isRateLimited(key: string): Promise<boolean> {
  try {
    const corp = await lookupCorpCode("005930");
    if (!corp) return false;
    const res = await fetch(
      `${DART_API}/list.json?crtfc_key=${key}&corp_code=${corp}` +
      `&bgn_de=20240101&end_de=20241231&pblntf_ty=A&page_count=1`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const data = await res.json() as any;
    // 020=사용한도 초과, 021=조회제한(분당). 둘 다 잠시 멈춰야 한다.
    return data.status === "020" || data.status === "021";
  } catch {
    return false; // 확인 자체가 실패하면 계속 진행(개별 실패로 처리)
  }
}

async function main() {
  const key = process.env["DART_API_KEY"];
  if (!key) { console.error("DART_API_KEY 없음 — 중단"); process.exit(1); }

  // 시총 큰 순 = 사람들이 실제로 찾는 종목 먼저. 시총 없는 종목은 뒤로.
  const { rows } = await pool.query<{ ticker: string; name: string }>(
    `SELECT ticker, name FROM stocks
      WHERE market = 'KR'
      ORDER BY market_cap DESC NULLS LAST, ticker`,
  );
  console.log(`대상 ${rows.length}개 중 이번 실행 최대 ${LIMIT}개`);

  let processed = 0, collectedStocks = 0, totalPeriods = 0, zeroStreak = 0;
  const t0 = Date.now();

  for (const { ticker, name } of rows) {
    if (processed >= LIMIT) { console.log(`\n이번 실행 한도(${LIMIT}) 도달 — 정상 종료`); break; }

    // 25개마다 한도 점검
    if (processed > 0 && processed % 25 === 0 && await isRateLimited(key)) {
      console.log(`\n⛔ DART 일일/분당 한도 감지 — 여기서 멈춤. 나중에 다시 실행하면 이어짐.`);
      break;
    }

    try {
      const r = await collectBizTimeline(ticker, 4);
      processed++;
      if (r.collected > 0) {
        collectedStocks++; totalPeriods += r.collected; zeroStreak = 0;
        console.log(`[${processed}] ${ticker} ${name} — 신규 ${r.collected} (누적기간 ${r.periods.length})`);
      } else if (r.skipped > 0) {
        zeroStreak = 0; // 이미 수집된 종목 — 정상
      } else {
        // corp_code 없거나 정기공시 없음 or 한도. 연속으로 쌓이면 한도일 가능성.
        zeroStreak++;
        if (zeroStreak >= 30) {
          console.log(`\n⚠️ 빈손 30연속 — 한도 또는 장애로 보고 멈춤. 재실행하면 이어짐.`);
          break;
        }
      }
    } catch (e) {
      console.warn(`[${processed}] ${ticker} 예외: ${(e as Error).message?.slice(0, 80)}`);
    }
    await sleep(DELAY);
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const done = await pool.query(`SELECT count(DISTINCT ticker)::int n FROM dart_biz_reports`);
  console.log(
    `\n=== 종료 (${mins}분) ===\n` +
    `이번 실행 처리 ${processed}개 · 신규수집 ${collectedStocks}개 · 신규기간 ${totalPeriods}개\n` +
    `전체 수집된 종목: ${done.rows[0].n} / ${rows.length}`,
  );
  await pool.end();
}

main().catch(async e => { console.error("치명적 오류:", e); await pool.end(); process.exit(1); });
