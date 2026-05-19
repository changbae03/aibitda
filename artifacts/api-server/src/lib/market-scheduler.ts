/**
 * 시장 분석 스케줄러
 * ─────────────────
 * - 장전 브리핑 갱신    : 평일 08:30 KST (= 23:30 UTC 전날) → Gemini 브리핑 캐시만 초기화
 * - 장마감 증분 업데이트 : 평일 16:30 KST (= 07:30 UTC)     → LSTM+5트리 + 브리핑 캐시 초기화
 * - 월간 완전 재학습    : 매월 1일 00:00 KST (= 전날 15:00 UTC) → 5년 완전 재학습
 * - 서버 재시작 시      : tryRestoreFromDisk() → 저장 모델 즉시 복원
 *
 * node-cron 없이 1분 간격 setInterval로 구현
 * (Replit 환경에서 외부 패키지 의존 최소화)
 */
import { runPipeline, runDailyIncrementalUpdate, tryRestoreFromDisk, loadMeta } from "./lstm-predictor.js";
import { invalidateBriefCache } from "../routes/market-analysis.js";

// 실행 중복 방지용 플래그
let morningBriefToday = "";   // "YYYY-MM-DD" 형식
let dailyRunToday     = "";   // "YYYY-MM-DD" 형식
let monthlyRunMonth   = "";   // "YYYY-MM" 형식

function utcNow() { return new Date(); }

function checkAndRun() {
  const now    = utcNow();
  const utcH   = now.getUTCHours();
  const utcM   = now.getUTCMinutes();
  const dow    = now.getUTCDay();                   // 0=일, 1-5=평일, 6=토
  const dateStr  = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const monthStr = now.toISOString().slice(0, 7);  // YYYY-MM

  // ── 월간 완전 재학습: 매월 1일 00:00 KST = 전날 15:00 UTC ────────────────
  if (now.getUTCDate() === 1 && utcH === 15 && utcM === 0 && monthlyRunMonth !== monthStr) {
    monthlyRunMonth = monthStr;
    console.log("[scheduler] 월간 완전 재학습 시작");
    runPipeline(true).catch(e => console.error("[scheduler] 월간 재학습 실패:", e?.message));
    return;
  }

  // ── 장전 브리핑 갱신: 평일 06:00 KST = 전날 21:00 UTC ──────────────────
  // 미국 야간 데이터(S&P500, 나스닥, 공포지수 등) 반영한 장전 해설
  if (utcH === 21 && utcM === 0 && dow >= 0 && dow <= 4 && morningBriefToday !== dateStr) {
    // dow 0(일)~4(목): 다음날이 평일(월~금)인 경우만
    morningBriefToday = dateStr;
    console.log("[scheduler] 장전 브리핑 갱신 시작 (06:00 KST)");
    invalidateBriefCache();
  }

  // ── 장마감 증분 업데이트: 평일 16:30 KST = 07:30 UTC ────────────────────
  if (utcH === 7 && utcM === 30 && dow >= 1 && dow <= 5 && dailyRunToday !== dateStr) {
    dailyRunToday = dateStr;
    console.log("[scheduler] 장마감 증분 업데이트 시작 (16:30 KST)");
    runDailyIncrementalUpdate()
      .then(() => {
        // 학습 완료 후 브리핑 캐시도 초기화 → 당일 마감 데이터 반영
        invalidateBriefCache();
        console.log("[scheduler] 장마감 증분 업데이트 완료 — 브리핑 캐시 초기화");
      })
      .catch(e => console.error("[scheduler] 증분 업데이트 실패:", e?.message));
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
  console.log("[scheduler] 시장분석 스케줄러 등록 완료");
  console.log("  - 장전 브리핑:   평일 06:00 KST (21:00 UTC 전날)");
  console.log("  - 장마감 업데이트: 평일 16:30 KST (07:30 UTC)");
  console.log("  - 월간 재학습:   매월 1일 00:00 KST (전날 15:00 UTC)");
}

export { runDailyIncrementalUpdate, loadMeta };
