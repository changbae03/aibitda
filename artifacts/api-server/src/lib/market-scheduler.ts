/**
 * 시장 분석 스케줄러
 * ─────────────────
 * - 장전 브리핑 갱신    : 평일 06:00 KST (= 21:00 UTC 전날) → Gemini 브리핑 생성
 * - 장중 1차 브리핑 갱신: 평일 11:00 KST (= 02:00 UTC)      → Gemini 브리핑 생성 (midday)
 * - 장중 2차 브리핑 갱신: 평일 14:00 KST (= 05:00 UTC)      → Gemini 브리핑 생성 (afternoon)
 * - 장마감 브리핑 갱신  : 평일 16:30 KST (= 07:30 UTC)      → Gemini 브리핑 생성
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

import { invalidateBriefCache, refreshBriefInBackground, fetchMarketNews, refreshUsBriefInBackground } from "../routes/market-analysis.js";
import { autoRecalibrate, autoUpdateAllSectorPriors } from "../routes/performance.js";
import { pool } from "@workspace/db";
import { collectTodayWinners, syncPresurgeHitResults } from "./daily-winners.js";
import { triggerSignalsRefresh } from "../routes/themes.js";
import { triggerBackgroundScan as triggerPresurgeScan } from "../routes/presurge.js";
import { triggerBackgroundRefresh as triggerTomorrowPicksRefresh } from "../routes/tomorrow-picks.js";

// 실행 중복 방지용 플래그
let morningBriefToday     = "";   // 06:00 KST 장전 브리핑
let winnersCollectedToday = "";   // 16:40 KST 급등 종목 수집
let middayBriefToday      = "";   // 11:00 KST 장중 1차 브리핑
let afternoonBriefToday   = "";   // 14:00 KST 장중 2차 브리핑
let eveningBriefToday     = "";   // 22:00 KST 야간 브리핑
let closingBriefToday     = "";   // 16:30 KST 장마감 브리핑
let weeklyRunWeek         = "";   // "YYYY-WNN" 형식
let weeklyCalibrationWeek = "";   // "YYYY-WNN" 형식
// 미국 브리핑 (KST 기준 날짜 사용 — 자정 넘어도 같은 날로 취급)
let usPremarketBriefToday = "";   // 17:00 KST 개장 전 브리핑 (프리마켓 시작)
let usOpenBriefToday      = "";   // 23:30 KST 장중 1차 브리핑 (개장 1시간 후)
let usMidBriefToday       = "";   // 02:00 KST 장중 2차 브리핑
let usCloseBriefToday     = "";   // 05:30 KST 마감 브리핑 (정규장 마감 직후)

// 장중 30분 동기 갱신 — 수급 폭발·급등 예비군·내일 상승 후보를 같은 시각에 갱신
// "YYYY-MM-DD-HH-MM" 형식으로 슬롯 중복 방지
let lastIntraday30Slot    = "";   // 09:00~15:30 KST 매 30분 슬롯

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
    refreshBriefInBackground("스케줄-장전");
  }

  // ── 장중 1차 브리핑 갱신: 평일 11:00 KST = 02:00 UTC (midday 세션) ─────────
  if (utcH === 2 && utcM === 0 && dow >= 1 && dow <= 5 && middayBriefToday !== dateStr) {
    middayBriefToday = dateStr;
    console.log("[scheduler] 장중 1차 브리핑 갱신 (11:00 KST)");
    refreshBriefInBackground("스케줄-장중1차");
  }

  // ── 장중 2차 브리핑 갱신: 평일 14:00 KST = 05:00 UTC (afternoon 세션) ────────
  if (utcH === 5 && utcM === 0 && dow >= 1 && dow <= 5 && afternoonBriefToday !== dateStr) {
    afternoonBriefToday = dateStr;
    console.log("[scheduler] 장중 2차 브리핑 갱신 (14:00 KST)");
    refreshBriefInBackground("스케줄-장중2차");
  }

  // ── 야간 KR 브리핑: 평일 22:00 KST = 13:00 UTC (야간 장세·미국 개장 전 정리) ──
  if (utcH === 13 && utcM === 0 && dow >= 1 && dow <= 5 && eveningBriefToday !== dateStr) {
    eveningBriefToday = dateStr;
    console.log("[scheduler] KR 야간 브리핑 갱신 (22:00 KST)");
    refreshBriefInBackground("스케줄-야간");
  }

  // ── 미국 개장 전 브리핑: 평일 17:00 KST = 08:00 UTC (프리마켓 시작) ─────────
  if (utcH === 8 && utcM === 0 && dow >= 1 && dow <= 5 && usPremarketBriefToday !== dateStr) {
    usPremarketBriefToday = dateStr;
    console.log("[scheduler] 미국 개장 전 브리핑 갱신 (17:00 KST)");
    refreshUsBriefInBackground("스케줄-개장전");
  }

  // ── 미국 장중 1차 브리핑: 평일 23:30 KST = 14:30 UTC (개장 1시간 후) ────────
  if (utcH === 14 && utcM === 30 && dow >= 1 && dow <= 5 && usOpenBriefToday !== dateStr) {
    usOpenBriefToday = dateStr;
    console.log("[scheduler] 미국 장중 1차 브리핑 갱신 (23:30 KST)");
    refreshUsBriefInBackground("스케줄-장중1차");
  }

  // ── 미국 장중 2차 브리핑: 평일 02:00 KST = 17:00 UTC ────────────────────
  if (utcH === 17 && utcM === 0 && dow >= 1 && dow <= 5 && usMidBriefToday !== dateStr) {
    usMidBriefToday = dateStr;
    console.log("[scheduler] 미국 장중 2차 브리핑 갱신 (02:00 KST)");
    refreshUsBriefInBackground("스케줄-장중2차");
  }

  // ── 미국 마감 브리핑: 평일 05:30 KST = 20:30 UTC (정규장 마감 직후) ─────────
  if (utcH === 20 && utcM === 30 && dow >= 1 && dow <= 5 && usCloseBriefToday !== dateStr) {
    usCloseBriefToday = dateStr;
    console.log("[scheduler] 미국 마감 브리핑 갱신 (05:30 KST)");
    refreshUsBriefInBackground("스케줄-마감");
  }

  // ── 장마감 브리핑 갱신: 평일 16:30 KST = 07:30 UTC ──────────────────────
  if (utcH === 7 && utcM === 30 && dow >= 1 && dow <= 5 && closingBriefToday !== dateStr) {
    closingBriefToday = dateStr;
    console.log("[scheduler] 장마감 브리핑 갱신 (16:30 KST)");
    refreshBriefInBackground("스케줄-장마감");

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

  // ── 오늘 급등 종목 수집 (피드백 루프): 평일 16:40 KST = 07:40 UTC ──────────
  // 장 마감 10분 후 — OHLCV 확정 직후, 기관/외인 수급 집계 포함
  if (utcH === 7 && utcM === 40 && dow >= 1 && dow <= 5 && winnersCollectedToday !== dateStr) {
    winnersCollectedToday = dateStr;
    console.log("[scheduler] 오늘 급등 종목 수집 시작 (16:40 KST)");
    collectTodayWinners()
      .then(result => {
        console.log(`[scheduler] 급등 종목 수집 완료: ${result.winners}개 (${result.date})`);
        return syncPresurgeHitResults();
      })
      .then(() => console.log("[scheduler] presurge 적중 결과 동기화 완료"))
      .catch(e => console.error("[scheduler] 급등 종목 수집 실패:", e?.message));
  }

  // ── 장중 30분 동기 갱신: 09:00~15:30 KST = 00:00~06:30 UTC (평일) ──────────
  // 수급 폭발·급등 예비군·내일 상승 후보를 동일 시각에 일괄 갱신
  // 09:00 KST = 00:00 UTC, 09:30 = 00:30, ..., 15:00 = 06:00, 15:30 = 06:30
  const utcTotalMin = utcH * 60 + utcM;
  const isIntraday30 = dow >= 1 && dow <= 5
    && (utcM === 0 || utcM === 30)
    && utcTotalMin >= 0 && utcTotalMin <= 390; // 00:00~06:30 UTC
  const slotKey30 = `${dateStr}-${utcH}-${utcM}`;
  if (isIntraday30 && lastIntraday30Slot !== slotKey30) {
    lastIntraday30Slot = slotKey30;
    const kstH = (utcH + 9) % 24;
    const kstM = utcM;
    console.log(`[scheduler] 장중 30분 동기 갱신 시작 (${String(kstH).padStart(2, "0")}:${String(kstM).padStart(2, "0")} KST)`);
    // 수급 폭발 (signals)
    try { triggerSignalsRefresh(); } catch (e) { console.error("[scheduler] signals 갱신 실패:", e); }
    // 급등 예비군 (presurge) — 스캔이 무거우므로 09:00·12:00·15:00 KST만 실행
    const isPresurgeSlot = utcTotalMin === 0 || utcTotalMin === 180 || utcTotalMin === 360;
    if (isPresurgeSlot) {
      try { triggerPresurgeScan(); } catch (e) { console.error("[scheduler] presurge 갱신 실패:", e); }
    }
    // 내일 상승 후보 (tomorrow picks)
    try { triggerTomorrowPicksRefresh(); } catch (e) { console.error("[scheduler] tomorrow-picks 갱신 실패:", e); }
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

  // model_calibration 초기 보정은 main-server 스케줄러(16:30 KST)가 담당.
  // market-server 시작 직후 autoRecalibrate()를 실행하면 수백 개의 Yahoo Finance
  // 동시 호출이 발생해 Node.js event loop를 점유, brief 엔드포인트가 응답 불가해짐.
  // → 시작 직후 재보정은 비활성화.

  // 1분마다 스케줄 조건 확인
  setInterval(checkAndRun, 60_000);
  console.log("[scheduler] 시장분석 스케줄러 등록 완료");
  console.log(`  - ML 학습:            ${ML_ENABLED ? "활성 (주간 일요일 10:00 KST)" : "비활성화"}`);
  console.log("  [KR] 장전 브리핑:     평일 06:00 KST (= 전날 21:00 UTC)");
  console.log("  [KR] 장중 1차 브리핑: 평일 11:00 KST (= 02:00 UTC)");
  console.log("  [KR] 장중 2차 브리핑: 평일 14:00 KST (= 05:00 UTC)");
  console.log("  [KR] 장마감 브리핑:   평일 16:30 KST (= 07:30 UTC)");
  console.log("  [KR] 야간 브리핑:     평일 22:00 KST (= 13:00 UTC)");
  console.log("  [US] 개장 전 브리핑: 평일 17:00 KST");
  console.log("  [US] 장중 1차 브리핑: 평일 23:30 KST");
  console.log("  [US] 장중 2차 브리핑: 평일 02:00 KST");
  console.log("  [US] 마감 브리핑:   평일 05:30 KST");
  console.log("  - 섹터 재보정:      평일 16:30 KST");
  console.log("  - 딥 캘리브레이션:  매주 일요일 11:00 KST");
  console.log("  [내일종목] 30분 동기 갱신: 평일 09:00~15:30 KST (signals·tomorrow-picks 매 30분, presurge 09:00·12:00·15:00 KST)");
}

export { getMl as _getMlModule };
// ML 재활성화 시 필요한 타입 내보내기 (dead-code 방지)
export type { };
