/**
 * market-regime-updater.ts
 *
 * 매일 KOSPI/코스닥 수익률·트렌드를 읽어 시장 레짐 컨텍스트를 생성하고
 * market_regime 테이블에 저장한다. 한국 주식 분석 시 enrichedContext에 주입됨.
 *
 * 실행 흐름:
 *   index.ts 스케줄러 → updateMarketRegime() → market_regime 테이블
 *   executeStep() → getLatestMarketRegime() → enrichedContext 주입
 */

import { GoogleGenAI } from "@google/genai";
import YahooFinance from "yahoo-finance2";
import { pool } from "@workspace/db";

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });
const yahooFinance = new YahooFinance();

const KOSPI_TICKER  = "^KS11";
const KOSDAQ_TICKER = "^KQ11";

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_regime (
      id              SERIAL PRIMARY KEY,
      date            DATE NOT NULL UNIQUE,
      kospi_5d_return  NUMERIC,
      kospi_20d_return NUMERIC,
      kosdaq_5d_return  NUMERIC,
      kosdaq_20d_return NUMERIC,
      regime_type     VARCHAR(20),
      context_note    TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function fetchReturn(ticker: string, days: number): Promise<number | null> {
  try {
    const endDate   = new Date();
    const startDate = new Date(endDate.getTime() - (days + 10) * 86400_000);
    const history   = await (yahooFinance as any).historical(ticker, {
      period1:  startDate.toISOString().slice(0, 10),
      period2:  endDate.toISOString().slice(0, 10),
      interval: "1d",
    });
    if (!history || history.length < 2) return null;
    const sorted = [...history].sort(
      (a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    const recent = sorted[sorted.length - 1].close;
    const start  = sorted[Math.max(0, sorted.length - days - 1)].close;
    if (!recent || !start || start === 0) return null;
    return ((recent - start) / start) * 100;
  } catch {
    return null;
  }
}

async function alreadyUpdatedToday(): Promise<boolean> {
  try {
    await ensureTable();
    const today = new Date().toISOString().slice(0, 10);
    const r = await pool.query(`SELECT 1 FROM market_regime WHERE date = $1`, [today]);
    return (r.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function updateMarketRegime(): Promise<void> {
  if (await alreadyUpdatedToday()) {
    console.log("[market-regime] 오늘 이미 업데이트됨, 스킵");
    return;
  }

  await ensureTable();

  const [kospi5d, kospi20d, kosdaq5d, kosdaq20d] = await Promise.all([
    fetchReturn(KOSPI_TICKER, 5),
    fetchReturn(KOSPI_TICKER, 20),
    fetchReturn(KOSDAQ_TICKER, 5),
    fetchReturn(KOSDAQ_TICKER, 20),
  ]);

  let regimeType = "sideways";
  if ((kospi20d ?? 0) > 3)  regimeType = "bull";
  if ((kospi20d ?? 0) < -3) regimeType = "bear";

  // 최근 30일 KRW 분석 섹터별 강세도 집계
  let sectorSummary = "";
  try {
    const sr = await pool.query(`
      SELECT industry,
             COUNT(*)::int AS cnt,
             AVG(CASE
               WHEN investment_verdict ILIKE '%strong buy%' OR investment_verdict ILIKE '%강력매수%' THEN 1.0
               WHEN investment_verdict ILIKE '%buy%'       OR investment_verdict ILIKE '%매수%'     THEN 0.7
               WHEN investment_verdict ILIKE '%sell%'      OR investment_verdict ILIKE '%매도%'     THEN 0.2
               ELSE 0.5
             END) AS avg_bullish
      FROM analyses
      WHERE created_at >= NOW() - INTERVAL '30 days'
        AND status = 'completed'
        AND ticker ~ '^[0-9]{6}$'
        AND industry IS NOT NULL
      GROUP BY industry
      ORDER BY cnt DESC
      LIMIT 8
    `);
    if (sr.rows.length > 0) {
      sectorSummary = sr.rows
        .map((r: any) =>
          `  ${r.industry}: ${r.cnt}건, 강세도 ${(parseFloat(r.avg_bullish) * 100).toFixed(0)}%`
        )
        .join("\n");
    }
  } catch { /* 실패해도 계속 */ }

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `당신은 한국 주식시장 전문 분석가입니다.
아래 시장 데이터를 바탕으로 현재 한국 주식시장의 레짐(국면)과 분석 시 유의해야 할 핵심 맥락을 작성하세요.

## 시장 데이터 (${today} 기준)
- KOSPI  5일 수익률:  ${kospi5d  != null ? kospi5d.toFixed(2)  + "%" : "데이터 없음"}
- KOSPI 20일 수익률:  ${kospi20d != null ? kospi20d.toFixed(2) + "%" : "데이터 없음"}
- 코스닥  5일 수익률: ${kosdaq5d  != null ? kosdaq5d.toFixed(2)  + "%" : "데이터 없음"}
- 코스닥 20일 수익률: ${kosdaq20d != null ? kosdaq20d.toFixed(2) + "%" : "데이터 없음"}
- 레짐 판정: ${regimeType === "bull" ? "상승장(Bull)" : regimeType === "bear" ? "하락장(Bear)" : "횡보장(Sideways)"}

## 최근 30일 애빛다 분석 섹터별 강세도
${sectorSummary || "  (데이터 없음)"}

---

출력 규칙:
- 4~5문장, 한국어 평문, 마크다운 없이
- 문장1: 현재 시장 레짐을 수치 포함 한 문장 요약
- 문장2~3: 강세/약세 섹터 구체적 언급
- 문장4~5: 지금 밸류에이션·목표주가 분석 시 특별히 주의해야 할 점`;

  let contextNote = "";
  try {
    const resp = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.4, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 0 } },
    });
    contextNote = resp.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  } catch (e: any) {
    console.error("[market-regime] Gemini 호출 실패:", e?.message);
    contextNote = [
      `KOSPI ${kospi20d != null ? kospi20d.toFixed(1) + "%" : "N/A"} (20일),`,
      `코스닥 ${kosdaq20d != null ? kosdaq20d.toFixed(1) + "%" : "N/A"} (20일),`,
      `레짐: ${regimeType}`,
    ].join(" ");
  }

  await pool.query(`
    INSERT INTO market_regime
      (date, kospi_5d_return, kospi_20d_return, kosdaq_5d_return, kosdaq_20d_return, regime_type, context_note)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (date) DO UPDATE SET
      kospi_5d_return  = $2, kospi_20d_return  = $3,
      kosdaq_5d_return = $4, kosdaq_20d_return = $5,
      regime_type  = $6,
      context_note = $7
  `, [today, kospi5d, kospi20d, kosdaq5d, kosdaq20d, regimeType, contextNote]);

  console.log(`[market-regime] 완료 — ${regimeType}, KOSPI 20d: ${kospi20d?.toFixed(2) ?? "N/A"}%`);
}

export async function getLatestMarketRegime(): Promise<string | null> {
  try {
    await ensureTable();
    const r = await pool.query(`
      SELECT regime_type, context_note, date
      FROM market_regime
      ORDER BY date DESC
      LIMIT 1
    `);
    const row = r.rows[0];
    if (!row?.context_note) return null;
    const dateStr = row.date instanceof Date
      ? row.date.toISOString().slice(0, 10)
      : String(row.date).slice(0, 10);
    return `[🌏 한국 시장 레짐 컨텍스트 (${dateStr} 기준, 레짐: ${row.regime_type}) — KRW 종목 분석 시 아래 시장 맥락을 반드시 반영하세요]\n${row.context_note}`;
  } catch {
    return null;
  }
}
