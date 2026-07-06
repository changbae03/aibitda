/**
 * 시장 분석 스케줄러
 * ─────────────────
 * - 장전 브리핑 갱신    : 평일 06:00 KST (= 21:00 UTC 전날) → Gemini 브리핑 캐시 초기화
 * - 장중 브리핑 갱신    : 평일 13:00 KST (= 04:00 UTC)      → Gemini 브리핑 캐시 초기화
 * - 장마감 브리핑 갱신  : 평일 16:30 KST (= 07:30 UTC)      → 브리핑 캐시 초기화
 *
 * ⚠️ ML(LSTM+GBDT) 파이프라인은 비활성화 상태
 *    리소스 절약 목적 — 필요 시 ML_ENABLED = true로 재활성화
 *
 * node-cron 없이 1분 간격 setInterval로 구현
 */
// ML 비활성화 — 아래 상수를 true로 바꾸면 재활성화됩니다
const ML_ENABLED = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mlModule: any = null;
async function getMl() {
  if (!ML_ENABLED) return null;
  if (!_mlModule) {
    _mlModule = await import("./lstm-predictor.js");
  }
  return _mlModule;
}

import { invalidateBriefCache, fetchMarketNews, refreshUsBriefInBackground } from "../routes/market-analysis.js";
import { autoRecalibrate, autoUpdateAllSectorPriors } from "../routes/performance.js";
import { pool } from "@workspace/db";

// 실행 중복 방지용 플래그
let morningBriefToday     = "";   // "YYYY-MM-DD" 형식
let middayBriefToday      = "";   // "YYYY-MM-DD" 형식
let closingBriefToday     = "";   // "YYYY-MM-DD" 형식
let weeklyRunWeek         = "";   // "YYYY-WNN" 형식
let weeklyCalibrationWeek = "";   // "YYYY-WNN" 형식
// 미국 브리핑 (KST 기준 날짜 사용 — 자정 넘어도 같은 날로 취급)
let usOpenBriefToday      = "";   // 22:30 KST 개장 브리핑
let usMidBriefToday       = "";   // 01:30 KST 장중 브리핑
let usCloseBriefToday     = "";   // 07:00 KST 마감 브리핑

function utcNow() { return new Date(); }

/** ISO 주 번호 계산 (YYYY-WNN) */
function getISOWeekStr(d: Date): string {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function checkAndRun() {
  const now      = utcNow();
  const utcH     = now.getUTCHours();
  const utcM     = now.getUTCMinutes();
  const dow      = now.getUTCDay();
  const dateStr  = now.toISOString().slice(0, 10);
  const weekStr  = getISOWeekStr(now);

  // ── ML 주간 완전 재학습 (비활성화 시 스킵) ───────────────────────────────
  if (ML_ENABLED && dow === 0 && utcH === 1 && utcM === 0 && weeklyRunWeek !== weekStr) {
    weeklyRunWeek = weekStr;
    getMl().then(ml => {
      if (!ml) return;
      console.log("[scheduler] ML 주간 재학습 시작 (일요일 10:00 KST)");
      ml.runPipeline(true).catch((e: Error) => console.error("[scheduler] ML 주간 재학습 실패:", e?.message));
    });
  }

  // ── 주간 딥 캘리브레이션: 매주 일요일 02:00 UTC (= 일요일 11:00 KST) ──────
  if (dow === 0 && utcH === 2 && utcM === 0 && weeklyCalibrationWeek !== weekStr) {
    weeklyCalibrationWeek = weekStr;
    console.log("[scheduler] 주간 딥 캘리브레이션 시작 (일요일 11:00 KST)");
    (async () => {
      try {
        const r = await autoRecalibrate();
        console.log(`[scheduler] 딥 캘리브레이션 완료 — ${r.analysesProcessed}건 분석, ${r.sectorsUpdated}개 섹터 업데이트`);
        if (r.sectorsUpdated > 0) {
          await autoUpdateAllSectorPriors();
          console.log("[scheduler] sector_priors 자동 업데이트 완료");
        }
      } catch (e) {
        console.error("[scheduler] 주간 딥 캘리브레이션 실패:", (e as Error)?.message ?? e);
      }
    })();
    return;
  }

  // ── 장전 브리핑 갱신: 평일 06:00 KST = 전날 21:00 UTC ──────────────────
  if (utcH === 21 && utcM === 0 && dow >= 0 && dow <= 4 && morningBriefToday !== dateStr) {
    morningBriefToday = dateStr;
    console.log("[scheduler] 장전 브리핑 갱신 (06:00 KST)");
    invalidateBriefCache();
  }

  // ── 장중 브리핑 갱신: 평일 13:00 KST = 04:00 UTC ────────────────────────
  if (utcH === 4 && utcM === 0 && dow >= 1 && dow <= 5 && middayBriefToday !== dateStr) {
    middayBriefToday = dateStr;
    console.log("[scheduler] 장중 브리핑 갱신 (13:00 KST)");
    invalidateBriefCache();
  }

  // ── 미국 개장 브리핑: 평일 22:30 KST = 13:30 UTC ────────────────────────
  if (utcH === 13 && utcM === 30 && dow >= 1 && dow <= 5 && usOpenBriefToday !== dateStr) {
    usOpenBriefToday = dateStr;
    console.log("[scheduler] 미국 개장 브리핑 갱신 (22:30 KST)");
    refreshUsBriefInBackground("스케줄-개장");
  }

  // ── 미국 장중 브리핑: 평일 01:30 KST = 16:30 UTC ────────────────────────
  if (utcH === 16 && utcM === 30 && dow >= 1 && dow <= 5 && usMidBriefToday !== dateStr) {
    usMidBriefToday = dateStr;
    console.log("[scheduler] 미국 장중 브리핑 갱신 (01:30 KST)");
    refreshUsBriefInBackground("스케줄-장중");
  }

  // ── 미국 마감 브리핑: 평일 07:00 KST = 22:00 UTC ─────────────────────────
  if (utcH === 22 && utcM === 0 && dow >= 1 && dow <= 5 && usCloseBriefToday !== dateStr) {
    usCloseBriefToday = dateStr;
    console.log("[scheduler] 미국 마감 브리핑 갱신 (07:00 KST)");
    refreshUsBriefInBackground("스케줄-마감");
  }

  // ── 장마감 브리핑 갱신: 평일 16:30 KST = 07:30 UTC ──────────────────────
  if (utcH === 7 && utcM === 30 && dow >= 1 && dow <= 5 && closingBriefToday !== dateStr) {
    closingBriefToday = dateStr;
    console.log("[scheduler] 장마감 브리핑 갱신 (16:30 KST)");
    invalidateBriefCache();

    // ML 활성 시: 증분 업데이트 + AI 오버레이
    if (ML_ENABLED) {
      getMl().then(ml => {
        if (!ml) return;
        ml.runDailyIncrementalUpdate()
          .then(() => {
            console.log("[scheduler] ML 증분 업데이트 완료");
            fetchMarketNews()
              .then((news: string) => ml.runAIOverlay(news))
              .catch((e: Error) => console.error("[scheduler] AI 오버레이 실패:", e?.message));
          })
          .catch((e: Error) => console.error("[scheduler] ML 증분 업데이트 실패:", e?.message));
      });
    }

    // 일별 섹터 재보정 (ML 여부 무관)
    autoRecalibrate()
      .then(async (r) => {
        console.log(`[scheduler] 일별 섹터 재보정 완료 — ${r.analysesProcessed}건, ${r.sectorsUpdated}개 섹터`);
        if (r.sectorsUpdated > 0) await autoUpdateAllSectorPriors();
      })
      .catch(e => console.error("[scheduler] 일별 재보정 실패:", e?.message));
  }
}

export function startMarketScheduler() {
  // ML이 꺼진 경우 간단히 시작
  if (!ML_ENABLED) {
    console.log("[scheduler] ML 비활성화 — 브리핑 스케줄만 구동");
  } else {
    // ML 활성 시: DB/디스크 복원 시도
    (async () => {
      const ml = await getMl();
      if (!ml) return;
      console.log("[scheduler] ML 활성 — DB 예측 캐시 로드 시도...");
      const dbOk = await ml.tryRestoreFromDB();
      if (dbOk) {
        console.log("[scheduler] ML DB 캐시 복원 성공");
        setTimeout(async () => {
          const diskOk = await ml.tryRestoreFromDisk(true);
          if (diskOk) console.log("[scheduler] ML 디스크 복원 완료");
        }, 5_000);
      } else {
        const diskOk = await ml.tryRestoreFromDisk(false);
        if (!diskOk) {
          console.log("[scheduler] ML 모델 없음 — 60초 후 초기 학습");
          setTimeout(() => ml.runPipeline(false).catch(() => {}), 60_000);
        }
      }
    })();
  }

  // model_calibration 초기 보정 (ML 여부 무관)
  setTimeout(async () => {
    try {
      const { rowCount } = await pool.query(`SELECT 1 FROM model_calibration LIMIT 1`);
      if ((rowCount ?? 0) === 0) {
        console.log("[scheduler] model_calibration 비어있음 — 즉시 섹터 재보정");
        const r = await autoRecalibrate();
        if (r.sectorsUpdated > 0) await autoUpdateAllSectorPriors();
      }
    } catch (e) {
      console.error("[scheduler] 초기 섹터 재보정 실패:", (e as Error)?.message ?? e);
    }
  }, 8_000);

  // 1분마다 스케줄 조건 확인
  setInterval(checkAndRun, 60_000);
  console.log("[scheduler] 시장분석 스케줄러 등록 완료");
  console.log(`  - ML 학습:         ${ML_ENABLED ? "활성 (주간 일요일 10:00 KST)" : "비활성화"}`);
  console.log("  [KR] 장전 브리핑:   평일 06:00 KST");
  console.log("  [KR] 장중 브리핑:   평일 13:00 KST");
  console.log("  [KR] 장마감 브리핑: 평일 16:30 KST");
  console.log("  [US] 개장 브리핑:   평일 22:30 KST");
  console.log("  [US] 장중 브리핑:   평일 01:30 KST");
  console.log("  [US] 마감 브리핑:   평일 07:00 KST");
  console.log("  - 섹터 재보정:      평일 16:30 KST");
  console.log("  - 딥 캘리브레이션:  매주 일요일 11:00 KST");
}

export { getMl as _getMlModule };
// ML 재활성화 시 필요한 타입 내보내기 (dead-code 방지)
export type { };
