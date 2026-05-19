/**
 * 시장 분석 스케줄러
 * ─────────────────
 * - 일일 증분 업데이트  : 평일 16:30 KST (= 07:30 UTC)  → +5 트리 추가
 * - 월간 완전 재학습    : 매월 1일 00:00 KST (= 전날 15:00 UTC) → 5년 완전 재학습
 * - 서버 재시작 시      : tryRestoreFromDisk() → 저장 모델 즉시 복원
 *
 * node-cron 없이 1분 간격 setInterval로 구현
 * (Replit 환경에서 외부 패키지 의존 최소화)
 */
import { runPipeline, runDailyIncrementalUpdate, tryRestoreFromDisk, loadMeta } from "./lstm-predictor.js";

// 실행 중복 방지용 플래그
let dailyRunToday   = "";   // "YYYY-MM-DD" 형식
let monthlyRunMonth = "";   // "YYYY-MM" 형식

function utcNow() { return new Date(); }

function checkAndRun() {
  const now = utcNow();
  const utcH   = now.getUTCHours();
  const utcM   = now.getUTCMinutes();
  const dow    = now.getUTCDay();           // 0=일, 1-5=평일, 6=토
  const dateStr  = now.toISOString().slice(0, 10);       // YYYY-MM-DD
  const monthStr = now.toISOString().slice(0, 7);        // YYYY-MM

  // ── 월간 완전 재학습: 매월 1일 00:00 KST = 전날 15:00 UTC ────────────────
  // (KST = UTC+9) → 1일 00:00 KST = 전날 23일 15:00 UTC
  // 단순하게: UTC 기준 매월 1일 15시 0분에 실행 (KST 1일 자정)
  if (now.getUTCDate() === 1 && utcH === 15 && utcM === 0 && monthlyRunMonth !== monthStr) {
    monthlyRunMonth = monthStr;
    console.log("[scheduler] 월간 완전 재학습 시작");
    runPipeline(true).catch(e => console.error("[scheduler] 월간 재학습 실패:", e?.message));
    return;
  }

  // ── 일일 증분 업데이트: 평일 16:30 KST = 07:30 UTC ─────────────────────
  if (utcH === 7 && utcM === 30 && dow >= 1 && dow <= 5 && dailyRunToday !== dateStr) {
    dailyRunToday = dateStr;
    console.log("[scheduler] 일일 증분 업데이트 시작 (16:30 KST)");
    runDailyIncrementalUpdate().catch(e => console.error("[scheduler] 증분 업데이트 실패:", e?.message));
  }
}

export function startMarketScheduler() {
  // 1. 서버 시작 시 저장된 모델 복원 시도 (재학습 없이 빠른 복구)
  console.log("[scheduler] 시작 — 저장 모델 복원 시도 중...");
  tryRestoreFromDisk().then(restored => {
    if (restored) {
      const meta = loadMeta();
      console.log(`[scheduler] 모델 복원 성공 (last_trained=${meta?.lastTrained ?? "?"})`);
    } else {
      console.log("[scheduler] 저장 모델 없음 — API 첫 호출 시 완전 학습 실행");
    }
  });

  // 2. 1분마다 스케줄 조건 확인
  setInterval(checkAndRun, 60_000);
  console.log("[scheduler] 시장분석 스케줄러 등록 완료 (일일 07:30 UTC / 월간 1일 15:00 UTC)");
}

export { runDailyIncrementalUpdate, loadMeta };
