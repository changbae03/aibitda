/**
 * 이벤트 리스크 점수 계산기
 * - 선반영률(30일 수익률) + RSI(14) 과열도 + 공매도 비율
 * - 세 가지 컴포넌트를 합산해 0~100 점수 반환
 */
import YahooFinance from "yahoo-finance2";
import { fetchKRXShortData } from "./krx-short-client.js";
import { correctKoreanTicker } from "./krx-cache.js";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export interface EventRiskResult {
  ticker:       string;
  score:        number;
  level:        "low" | "caution" | "warning" | "high";
  levelKo:      string;

  runUp30d:     number | null;
  runUp60d:     number | null;
  runUp90d:     number | null;
  rsi14:        number | null;
  shortRatio:   number | null;
  loanRatio:    number | null;

  runUpScore:   number;
  rsiScore:     number;
  shortScore:   number;

  warnings:     string[];
  fetchedAt:    string;
}

function calcRSI(closes: number[], window = 14): number | null {
  if (closes.length < window + 1) return null;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= window; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= window; avgLoss /= window;
  for (let i = window + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (window - 1) + g) / window;
    avgLoss = (avgLoss * (window - 1) + l) / window;
  }
  return avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(1);
}

function runUpScore(pct: number | null): number {
  if (pct == null) return 0;
  if (pct >= 100) return 35;
  if (pct >= 80)  return 28;
  if (pct >= 60)  return 20;
  if (pct >= 40)  return 12;
  if (pct >= 20)  return 6;
  if (pct >= 10)  return 3;
  return 0;
}

function rsiScore(rsi: number | null): number {
  if (rsi == null) return 0;
  if (rsi >= 85) return 30;
  if (rsi >= 80) return 25;
  if (rsi >= 75) return 20;
  if (rsi >= 70) return 15;
  if (rsi >= 65) return 8;
  return 0;
}

function shortScore(ratio: number | null): number {
  if (ratio == null) return 0;
  if (ratio >= 8)   return 35;
  if (ratio >= 5)   return 28;
  if (ratio >= 3)   return 18;
  if (ratio >= 1.5) return 10;
  if (ratio >= 0.5) return 4;
  return 0;
}

function levelFromScore(s: number): ["low" | "caution" | "warning" | "high", string] {
  if (s >= 75) return ["high",    "🔴 고위험"];
  if (s >= 50) return ["warning", "🔶 경고"];
  if (s >= 25) return ["caution", "⚠️ 주의"];
  return          ["low",    "✅ 낮음"];
}

export async function calcEventRisk(ticker: string): Promise<EventRiskResult> {
  const cleanTicker = correctKoreanTicker(ticker) ?? ticker;

  let closes: number[] = [];
  try {
    const endDate   = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 130);
    const hist = await yf.historical(cleanTicker, {
      period1: startDate.toISOString().slice(0, 10),
      period2: endDate.toISOString().slice(0, 10),
      interval: "1d",
    });
    closes = hist.filter(h => h.close != null).map(h => h.close!);
  } catch { }

  const now  = closes.at(-1) ?? null;
  const p30  = closes.length >= 31  ? closes.at(-31) ?? null  : null;
  const p60  = closes.length >= 61  ? closes.at(-61) ?? null  : null;
  const p90  = closes.length >= 91  ? closes.at(-91) ?? null  : null;

  const runUp30d = now != null && p30 != null ? +((now - p30) / p30 * 100).toFixed(2) : null;
  const runUp60d = now != null && p60 != null ? +((now - p60) / p60 * 100).toFixed(2) : null;
  const runUp90d = now != null && p90 != null ? +((now - p90) / p90 * 100).toFixed(2) : null;
  const rsi14    = calcRSI(closes);

  const rawCode  = ticker.replace(/\.(KS|KQ)$/i, "");
  const isKorean = /^\d{6}$/.test(rawCode);
  let shortRatio: number | null = null;
  let loanRatio:  number | null = null;
  if (isKorean) {
    try {
      const shortRows = await fetchKRXShortData(rawCode, 3);
      if (shortRows.length > 0) {
        shortRatio = shortRows[0].shortRatio;
        loanRatio  = shortRows[0].loanRatio;
      }
    } catch { }
  }

  const rs = runUpScore(runUp30d);
  const rsi = rsiScore(rsi14);
  const ss  = shortScore(shortRatio);
  const score = Math.min(100, rs + rsi + ss);
  const [level, levelKo] = levelFromScore(score);

  const warnings: string[] = [];
  if (runUp30d != null && runUp30d >= 80)
    warnings.push(`📈 30일 수익률 +${runUp30d}% — 호재가 주가에 이미 크게 선반영됐을 수 있습니다`);
  else if (runUp30d != null && runUp30d >= 40)
    warnings.push(`📈 30일 수익률 +${runUp30d}% — 상당한 선반영이 진행 중입니다`);
  if (rsi14 != null && rsi14 >= 75)
    warnings.push(`🌡️ RSI ${rsi14} — 심한 과열 상태, 차익실현 매물 출회 가능성 높음`);
  else if (rsi14 != null && rsi14 >= 65)
    warnings.push(`🌡️ RSI ${rsi14} — 과열 구간 진입 중`);
  if (shortRatio != null && shortRatio >= 5)
    warnings.push(`🩳 공매도 잔고비율 ${shortRatio}% — 기관 세력이 하락에 베팅 중 (호재에도 눌릴 수 있음)`);
  else if (shortRatio != null && shortRatio >= 3)
    warnings.push(`🩳 공매도 잔고비율 ${shortRatio}% — 공매도 비율이 높아 수급 부담`);
  if (score >= 75)
    warnings.push(`⚡ 이 종목은 이벤트 전후로 "뉴스에 팔아라" 패턴이 발생할 위험이 높습니다`);

  return {
    ticker, score, level, levelKo,
    runUp30d, runUp60d, runUp90d, rsi14,
    shortRatio, loanRatio,
    runUpScore: rs, rsiScore: rsi, shortScore: ss,
    warnings,
    fetchedAt: new Date().toISOString(),
  };
}
