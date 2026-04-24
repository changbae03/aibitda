import { pool } from "@workspace/db";
import { checkAndDeductCredit } from "./credits.js";

export const SCHEDULER_TOKEN = "internal-scheduler-cbst-2024";

export type ScheduleFrequency = "weekly" | "biweekly" | "monthly";

export function calcNextRun(frequency: ScheduleFrequency): Date {
  const now = new Date();
  const days = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : 30;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function runDueSchedules(port: number): Promise<void> {
  let schedules: any[] = [];
  try {
    const r = await pool.query(
      `SELECT * FROM analysis_schedules
       WHERE enabled = true AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 10`
    );
    schedules = r.rows;
  } catch (e: any) {
    console.error("[SCHEDULER] 스케줄 조회 오류:", e?.message);
    return;
  }

  if (schedules.length === 0) return;
  console.log(`[SCHEDULER] 재실행 대상: ${schedules.length}개 스케줄`);

  for (const sch of schedules) {
    try {
      // 크레딧 확인 및 차감
      const credit = await checkAndDeductCredit(sch.user_id);
      if (!credit.ok) {
        console.log(`[SCHEDULER] 크레딧 부족 스킵: ${sch.ticker} (${sch.user_id}) — 1시간 후 재시도`);
        await pool.query(
          `UPDATE analysis_schedules SET next_run_at = NOW() + INTERVAL '1 hour' WHERE id = $1`,
          [sch.id]
        );
        continue;
      }

      // 내부 HTTP로 분석 생성 트리거
      const resp = await fetch(`http://localhost:${port}/api/analysis/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Scheduler-Token": SCHEDULER_TOKEN,
          "X-Scheduler-User-Id": sch.user_id,
        },
        body: JSON.stringify({
          ticker: sch.ticker,
          companyName: sch.company_name,
          industry: sch.industry ?? undefined,
          additionalContext: sch.additional_context ?? undefined,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        console.error(`[SCHEDULER] 분석 생성 실패: ${sch.ticker}`, errBody);
        // 다음 주기로 미룸
        await pool.query(
          `UPDATE analysis_schedules SET next_run_at = $1 WHERE id = $2`,
          [calcNextRun(sch.frequency), sch.id]
        );
        continue;
      }

      const data = await resp.json();
      const newId: number | null = data?.id ?? null;
      const nextRun = calcNextRun(sch.frequency);

      await pool.query(
        `UPDATE analysis_schedules
         SET last_run_at = NOW(), last_analysis_id = $1, next_run_at = $2
         WHERE id = $3`,
        [newId, nextRun, sch.id]
      );

      console.log(
        `[SCHEDULER] 재실행 완료: ${sch.company_name}(${sch.ticker}) → analysis#${newId}, 다음 실행: ${nextRun.toLocaleDateString("ko-KR")}`
      );
    } catch (e: any) {
      console.error(`[SCHEDULER] 스케줄 실행 오류 (id=${sch.id}):`, e?.message);
    }
  }
}
