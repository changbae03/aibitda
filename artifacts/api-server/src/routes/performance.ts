import { Router } from "express";
import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";
import { GoogleGenAI } from "@google/genai";
import { getUserId } from "../lib/credits.js";

const router = Router();
const yahooFinance = new YahooFinance();
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" });

// ── lazy migration ────────────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      ALTER TABLE model_calibration
        ADD COLUMN IF NOT EXISTS diagnosis_note TEXT,
        ADD COLUMN IF NOT EXISTS diagnosis_updated_at TIMESTAMPTZ
    `);
  } catch { /* already exists */ }
})();

(async () => {
  try {
    await pool.query(`
      ALTER TABLE sector_priors
        ADD COLUMN IF NOT EXISTS is_auto_updated  BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS auto_update_notes TEXT
    `);
  } catch { /* already exists */ }
})();

async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  const isKorean = /^\d{6}$/.test(ticker);
  if (isKorean) {
    const [ks, kq] = await Promise.allSettled([
      yahooFinance.quote(`${ticker}.KS`, { fields: ["regularMarketPrice"] }),
      yahooFinance.quote(`${ticker}.KQ`, { fields: ["regularMarketPrice"] }),
    ]);
    const ksPrice = ks.status === "fulfilled" ? (ks.value?.regularMarketPrice ?? null) : null;
    const kqPrice = kq.status === "fulfilled" ? (kq.value?.regularMarketPrice ?? null) : null;
    return ksPrice ?? kqPrice;
  } else {
    try {
      const q = await yahooFinance.quote(ticker, { fields: ["regularMarketPrice"] });
      return q?.regularMarketPrice ?? null;
    } catch {
      return null;
    }
  }
}

export function classifySector(industry: string, market: "KR" | "US"): string {
  const ind = (industry ?? "").toLowerCase();
  if (market === "KR") {
    // 바이오·제약 (semiconductor equipment보다 먼저 체크해야 "bio" 포함 오류 방지)
    if (ind.includes("biotech") || ind.includes("pharma") || ind.includes("바이오") || ind.includes("제약") || ind.includes("drug")) return "KR_BIOTECH";
    // 반도체 장비·소재 (순수 반도체보다 먼저 체크)
    if (ind.includes("semiconductor equipment") || ind.includes("semiconductor material") || ind.includes("반도체 장비") || ind.includes("반도체 소재")) return "KR_SEMICONDUCTOR_EQ";
    // 반도체·메모리
    if (ind.includes("반도체") || ind.includes("semiconductor") || ind.includes("memory") || ind.includes("foundry")) return "KR_SEMICONDUCTOR";
    // 금융
    if (ind.includes("금융") || ind.includes("은행") || ind.includes("보험") || ind.includes("증권") || ind.includes("financial") || ind.includes("bank") || ind.includes("insurance") || ind.includes("capital market")) return "KR_FINANCIAL";
    // 건설·건자재
    if (ind.includes("건설") || ind.includes("건자재") || ind.includes("construc") || ind.includes("engineering & construction")) return "KR_CONSTRUCTION";
    // 통신
    if (ind.includes("통신") || ind.includes("telecom") || ind.includes("wireless") || ind.includes("communication services")) return "KR_TELECOM";
    // 리츠·부동산
    if (ind.includes("리츠") || ind.includes("reit") || ind.includes("real estate")) return "KR_REIT";
    // 자동차·부품
    if (ind.includes("자동차") || ind.includes("automotive") || ind.includes("auto part") || ind.includes("car")) return "KR_AUTO";
    // IT·게임·플랫폼·소프트웨어
    if (ind.includes("software") || ind.includes("internet") || ind.includes("gaming") || ind.includes("multimedia") || ind.includes("platform") || ind.includes("게임") || ind.includes("it서비스")) return "KR_IT";
    // 소비재·전자
    if (ind.includes("consumer electronics") || ind.includes("소비재") || ind.includes("consumer cyclical") || ind.includes("retail")) return "KR_CONSUMER";
    // 에너지·화학
    if (ind.includes("energy") || ind.includes("oil") || ind.includes("chemical") || ind.includes("에너지") || ind.includes("화학")) return "KR_ENERGY";
    // 방산·조선·기계
    if (ind.includes("defense") || ind.includes("aerospace") || ind.includes("shipbuilding") || ind.includes("machinery")) return "KR_DEFENSE";
    return "KR_OTHER";
  } else {
    if (ind.includes("biotech") || ind.includes("pharmaceutical") || ind.includes("drug")) return "US_BIOTECH";
    if (ind.includes("semiconductor equipment") || ind.includes("semiconductor material")) return "US_SEMICONDUCTOR_EQ";
    if (ind.includes("semiconductor") || ind.includes("foundry") || ind.includes("memory")) return "US_TECH";
    if (ind.includes("software") || ind.includes("technology") || ind.includes("internet") || ind.includes("cloud")) return "US_TECH";
    if (ind.includes("bank") || ind.includes("financial") || ind.includes("insurance") || ind.includes("capital market")) return "US_FINANCIAL";
    if (ind.includes("reit") || ind.includes("real estate")) return "US_REIT";
    if (ind.includes("energy") || ind.includes("oil") || ind.includes("mining")) return "US_ENERGY";
    if (ind.includes("defense") || ind.includes("aerospace")) return "US_DEFENSE";
    if (ind.includes("telecom") || ind.includes("communication")) return "US_TELECOM";
    if (ind.includes("utilities")) return "US_UTILITIES";
    if (ind.includes("consumer") || ind.includes("retail")) return "US_CONSUMER";
    return "US_OTHER";
  }
}

function isBullishVerdict(verdict: string): boolean | null {
  const v = verdict.trim();
  if (v.includes("강력매수") || v.includes("적극매수") || v.includes("Strong Buy") || v.includes("매수") || v.includes("Buy")) return true;
  if (v.includes("매도") || v.includes("적극매도") || v.includes("Sell") || v.includes("Strong Sell")) return false;
  return null;
}

// ── 섹터 오류 원인 진단 AI 에이전트 ─────────────────────────────────────────
async function runSectorDiagnosisAgent(
  sector: string,
  directionAccuracy: number | null,
  avgPriceDeviation: number | null,
  wrongCases: Array<{ id: number; ticker: string; startPrice: number; targetPrice: number; currentPrice: number; verdict: string; deviationPct: number; directionWrong: boolean }>
): Promise<string | null> {
  try {
    // 틀린 분석들의 밸류에이션·DCF 핵심 가정 추출
    const ids = wrongCases.map(w => w.id);
    const { rows: steps } = await pool.query(
      `SELECT s.analysis_id, s.step_key, LEFT(s.content, 1500) AS content
       FROM analysis_steps s
       WHERE s.analysis_id = ANY($1::int[])
         AND s.step_key IN ('intrinsic_valuation', 'relative_valuation', 'dcf_assumptions', 'investment_strategy')
       ORDER BY s.analysis_id, s.step_key`,
      [ids]
    );

    const caseBlocks = wrongCases.map(w => {
      const relevantSteps = steps.filter((s: any) => s.analysis_id === w.id);
      const valStep = relevantSteps.find((s: any) => s.step_key === "intrinsic_valuation")?.content ?? "";
      const relStep = relevantSteps.find((s: any) => s.step_key === "relative_valuation")?.content ?? "";
      const actualReturn = ((w.currentPrice - w.startPrice) / w.startPrice * 100).toFixed(1);
      const predictedReturn = ((w.targetPrice - w.startPrice) / w.startPrice * 100).toFixed(1);
      return `
[종목: ${w.ticker}]
- 투자의견: ${w.verdict}
- 분석 시 시작가: ${w.startPrice.toLocaleString()}
- 목표주가: ${w.targetPrice.toLocaleString()} (예측 수익률 ${predictedReturn}%)
- 현재 실제가격: ${w.currentPrice.toLocaleString()} (실제 수익률 ${actualReturn}%)
- 목표가 괴리: ${w.deviationPct > 0 ? "+" : ""}${w.deviationPct.toFixed(1)}%p ${w.directionWrong ? "[방향 오류]" : ""}
- 내재가치 분석 핵심 가정 (일부):
${valStep.slice(0, 800) || "(없음)"}
- 상대가치 분석 핵심 가정 (일부):
${relStep.slice(0, 600) || "(없음)"}`;
    }).join("\n\n---\n");

    const accStr = directionAccuracy !== null ? `${Math.round(directionAccuracy)}%` : "N/A";
    const devStr = avgPriceDeviation !== null
      ? `${avgPriceDeviation > 0 ? "+" : ""}${avgPriceDeviation.toFixed(1)}%p (${avgPriceDeviation > 0 ? "과대평가" : "과소평가"} 경향)`
      : "N/A";

    const prompt = `당신은 주식 리서치 모델의 체계적 오류를 진단하는 전문가입니다.

아래는 ${sector} 섹터에서 실제로 틀린 분석 사례들입니다.

## 섹터 전체 오류 지표
- 방향 예측 정확도: ${accStr} (62% 미만이면 문제)
- 목표주가 평균 괴리: ${devStr} (±15%p 초과면 문제)

## 틀린 분석 사례 (${wrongCases.length}건)
${caseBlocks}

## 요청
위 사례들을 분석하여 **이 섹터에서 반복되는 체계적 방법론 오류**를 진단하세요.

출력 형식 (반드시 아래 형식 준수):
1. [오류 유형 1]: 구체적 진단 (예: "DCF 성장률 3년차 이후 수렴 미적용 — Year 3+ 성장률이 Year 1과 동일하게 유지됨")
2. [오류 유형 2]: 구체적 진단
3. ...

그 다음 줄:
→ 다음 분석 시 반드시 적용할 보정 지침 (3~5항목, 구체적 수치 포함):
• 보정 지침 1
• 보정 지침 2
...

주의: 일반론 금지. 이 섹터의 실제 수치에서 확인된 패턴만 기술하세요.
최대 600자 이내로 작성하세요.`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 700 },
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    return text.length > 50 ? text : null;
  } catch (e) {
    console.error("[diagnosis-agent] 실패:", (e as Error)?.message ?? e);
    return null;
  }
}

// ── 섹터 선행 지식 자동 업데이트 (Gemini가 실적 기반으로 지침 재작성) ────────────────

async function runSectorPriorUpdateAgent(
  sector: string,
  currentPrior: { waccRange: string; terminalG: string; peersNote: string; biasRisk: string; specificLevers: string[] } | null,
  directionAccuracy: number | null,
  avgDeviation: number | null,
  sampleCount: number,
  diagnosisNote: string | null,
): Promise<{ prior: { waccRange: string; terminalG: string; peersNote: string; biasRisk: string; specificLevers: string[] }; notes: string } | null> {
  try {
    const p = currentPrior ?? { waccRange: "", terminalG: "", peersNote: "", biasRisk: "", specificLevers: [] };
    const accStr = directionAccuracy !== null ? `${Math.round(directionAccuracy)}%` : "N/A";
    const devStr = avgDeviation !== null
      ? `${avgDeviation > 0 ? "+" : ""}${avgDeviation.toFixed(1)}%p (${avgDeviation > 0 ? "과대평가" : "과소평가"} 경향)`
      : "N/A";

    const prompt = `당신은 AI 주식 분석 시스템의 섹터 밸류에이션 보정 전문가입니다.

[섹터: ${sector}] [분석 이력: ${sampleCount}건]

## 현재 밸류에이션 보정 지침
WACC 범위: ${p.waccRange || "(없음)"}
Terminal g: ${p.terminalG || "(없음)"}
피어 선택 기준: ${p.peersNote || "(없음)"}
주요 편향 위험: ${p.biasRisk || "(없음)"}
핵심 조정 레버:
${(p.specificLevers ?? []).map(l => `• ${l}`).join("\n") || "(없음)"}

## AI 실적 데이터 (${sampleCount}건)
방향 예측 정확도: ${accStr}
목표주가 편향: ${devStr}

## 실패 사례 오류 진단
${diagnosisNote || "(아직 없음)"}

## 요청
위 실적 데이터와 오류 진단을 바탕으로, 보정 지침을 개선하세요.
아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만 출력하세요:

{
  "waccRange": "...",
  "terminalG": "...",
  "peersNote": "...",
  "biasRisk": "...",
  "specificLevers": ["...", "...", "..."],
  "updateNotes": "주요 변경 사항 요약 (2~3문장, 한국어)"
}

규칙:
1. 편향이 크면(|편향| > 10%p) WACC 범위 상단을 0.5~1.5%p 조정
2. 방향 정확도 < 55%이면 biasRisk에 투자의견 보수화 지침 강화
3. 진단 메모에서 반복 패턴 발견 시 specificLevers에 해당 교정 레버 추가
4. 기존 지침이 여전히 유효하면 그대로 유지
5. updateNotes: 무엇을 왜 바꿨는지 구체적으로 (아무것도 안 바꿨으면 "기존 지침이 유효하여 변경 없음")`;

    const response = await genai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 800 },
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.waccRange || !parsed.terminalG) return null;

    return {
      prior: {
        waccRange:      parsed.waccRange      ?? p.waccRange,
        terminalG:      parsed.terminalG      ?? p.terminalG,
        peersNote:      parsed.peersNote      ?? p.peersNote,
        biasRisk:       parsed.biasRisk       ?? p.biasRisk,
        specificLevers: parsed.specificLevers ?? p.specificLevers,
      },
      notes: parsed.updateNotes ?? "",
    };
  } catch (e) {
    console.error("[prior-update-agent] 실패:", (e as Error)?.message ?? e);
    return null;
  }
}

export async function autoUpdateAllSectorPriors(): Promise<{ updated: number; skipped: number }> {
  const { rows: qualifying } = await pool.query(
    `SELECT sector, direction_accuracy, avg_price_deviation, sample_count, diagnosis_note
     FROM model_calibration
     WHERE sample_count >= 5
     ORDER BY sample_count DESC`
  );

  if (qualifying.length === 0) {
    console.log("[prior-update] 조건 충족 섹터 없음 (sample_count >= 5)");
    return { updated: 0, skipped: 0 };
  }

  let updated = 0;
  let skipped = 0;

  for (const row of qualifying) {
    const sector = row.sector as string;
    try {
      const priorRow = await pool.query(`SELECT * FROM sector_priors WHERE sector = $1`, [sector]);
      const dbPrior = priorRow.rows[0];
      const currentPrior = dbPrior ? {
        waccRange:      dbPrior.wacc_range      as string,
        terminalG:      dbPrior.terminal_g      as string,
        peersNote:      dbPrior.peers_note      as string,
        biasRisk:       dbPrior.bias_risk       as string,
        specificLevers: (dbPrior.specific_levers as string[]) ?? [],
      } : SECTOR_PRIORS[sector] ?? null;

      const result = await runSectorPriorUpdateAgent(
        sector, currentPrior,
        row.direction_accuracy as number | null,
        row.avg_price_deviation as number | null,
        row.sample_count as number,
        row.diagnosis_note as string | null,
      );

      if (!result) { skipped++; continue; }

      await pool.query(
        `INSERT INTO sector_priors (sector, wacc_range, terminal_g, peers_note, bias_risk, specific_levers, is_auto_updated, auto_update_notes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, TRUE, $7, NOW())
         ON CONFLICT (sector) DO UPDATE SET
           wacc_range        = EXCLUDED.wacc_range,
           terminal_g        = EXCLUDED.terminal_g,
           peers_note        = EXCLUDED.peers_note,
           bias_risk         = EXCLUDED.bias_risk,
           specific_levers   = EXCLUDED.specific_levers,
           is_auto_updated   = TRUE,
           auto_update_notes = EXCLUDED.auto_update_notes,
           updated_at        = NOW()`,
        [sector, result.prior.waccRange, result.prior.terminalG, result.prior.peersNote,
         result.prior.biasRisk, JSON.stringify(result.prior.specificLevers ?? []), result.notes]
      );

      console.log(`[prior-update] ${sector} 자동 업데이트 완료: ${result.notes.slice(0, 60)}`);
      updated++;
    } catch (e) {
      console.error(`[prior-update] ${sector} 실패:`, (e as Error)?.message ?? e);
      skipped++;
    }
  }

  console.log(`[prior-update] 완료 — ${updated}개 업데이트, ${skipped}개 스킵`);
  return { updated, skipped };
}

// ── 자동 재보정 핵심 로직 (스케줄러 + 어드민 라우트 공용) ─────────────────────────
export async function autoRecalibrate(): Promise<{
  analysesProcessed: number;
  sectorsUpdated: number;
  sectors: Record<string, { directionAccuracy: number | null; avgPriceDeviation: number | null; sampleCount: number }>;
}> {
  // 30일 이상 된 완료 분석만 대상 (현재가와 비교 의미 있는 범위)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const { rows: analyses } = await pool.query(
    `SELECT id, ticker, industry, investment_verdict, start_price, target_price, created_at
     FROM analyses
     WHERE status = 'completed'
       AND start_price IS NOT NULL
       AND target_price IS NOT NULL
       AND investment_verdict IS NOT NULL
       AND created_at < $1
     ORDER BY created_at DESC`,
    [cutoff]
  );

  if (analyses.length === 0) {
    return { analysesProcessed: 0, sectorsUpdated: 0, sectors: {} };
  }

  // 유니크 종목 현재가 일괄 조회
  const uniqueTickers = [...new Set(analyses.map((r: any) => r.ticker as string))];
  const priceMap = new Map<string, number | null>();
  await Promise.all(
    uniqueTickers.map(async (ticker) => {
      const price = await fetchCurrentPrice(ticker);
      priceMap.set(ticker, price);
    })
  );

  const sectorStats = new Map<string, {
    market: "KR" | "US";
    directionCorrect: number;
    directionTotal: number;
    deviationSum: number;
    deviationCount: number;
    wrongAnalysisIds: Array<{ id: number; ticker: string; startPrice: number; targetPrice: number; currentPrice: number; verdict: string; deviationPct: number; directionWrong: boolean }>;
  }>();

  for (const row of analyses) {
    const ticker = row.ticker as string;
    const industry = row.industry as string;
    const verdict = row.investment_verdict as string;
    const startPrice = parseFloat(row.start_price);
    const targetPrice = parseFloat(row.target_price);
    const currentPrice = priceMap.get(ticker);

    if (!currentPrice || isNaN(startPrice) || isNaN(targetPrice) || startPrice === 0) continue;

    const market: "KR" | "US" = /^\d{6}$/.test(ticker) ? "KR" : "US";
    const sector = classifySector(industry, market);

    if (!sectorStats.has(sector)) {
      sectorStats.set(sector, { market, directionCorrect: 0, directionTotal: 0, deviationSum: 0, deviationCount: 0, wrongAnalysisIds: [] });
    }
    const stats = sectorStats.get(sector)!;

    const bullish = isBullishVerdict(verdict);
    let directionWrong = false;
    if (bullish !== null) {
      const actualUp = currentPrice > startPrice;
      if ((bullish && actualUp) || (!bullish && !actualUp)) {
        stats.directionCorrect++;
      } else {
        directionWrong = true;
      }
      stats.directionTotal++;
    }

    const deviationPct = ((targetPrice - currentPrice) / startPrice) * 100;
    stats.deviationSum += deviationPct;
    stats.deviationCount++;

    // 방향 틀렸거나 목표가 괴리 20%p 초과 → 진단 대상으로 수집 (최대 8건)
    if ((directionWrong || Math.abs(deviationPct) > 20) && stats.wrongAnalysisIds.length < 8) {
      stats.wrongAnalysisIds.push({ id: row.id as number, ticker, startPrice, targetPrice, currentPrice, verdict, deviationPct, directionWrong });
    }
  }

  let updatedSectors = 0;
  for (const [sector, stats] of sectorStats.entries()) {
    const directionAccuracy = stats.directionTotal > 0
      ? (stats.directionCorrect / stats.directionTotal) * 100
      : null;
    const avgPriceDeviation = stats.deviationCount > 0
      ? stats.deviationSum / stats.deviationCount
      : null;

    await pool.query(
      `INSERT INTO model_calibration (sector, market, direction_accuracy, avg_price_deviation, sample_count, last_recalc_at, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (sector) DO UPDATE SET
         market = EXCLUDED.market,
         direction_accuracy = EXCLUDED.direction_accuracy,
         avg_price_deviation = EXCLUDED.avg_price_deviation,
         sample_count = EXCLUDED.sample_count,
         last_recalc_at = NOW()`,
      [sector, stats.market, directionAccuracy, avgPriceDeviation, stats.deviationCount]
    );
    updatedSectors++;

    // ── 편향 임계치 초과 섹터: 원인 진단 실행 ──────────────────────────────
    const needsDiagnosis =
      (directionAccuracy !== null && directionAccuracy < 62) ||
      (avgPriceDeviation !== null && Math.abs(avgPriceDeviation) > 15);

    if (needsDiagnosis && stats.wrongAnalysisIds.length >= 2) {
      runSectorDiagnosisAgent(sector, directionAccuracy, avgPriceDeviation, stats.wrongAnalysisIds)
        .then(async (note) => {
          if (!note) return;
          await pool.query(
            `UPDATE model_calibration
             SET diagnosis_note = $1, diagnosis_updated_at = NOW()
             WHERE sector = $2`,
            [note, sector]
          );
          console.log(`[diagnosis] ${sector} 진단 저장 완료 (${note.length}자)`);
        })
        .catch((e) => console.error(`[diagnosis] ${sector} 진단 실패:`, e?.message ?? e));
    }
  }

  // 히스토리 스냅샷 저장 (추세 추적용)
  for (const [sector, stats] of sectorStats.entries()) {
    const directionAccuracy = stats.directionTotal > 0
      ? (stats.directionCorrect / stats.directionTotal) * 100
      : null;
    const avgPriceDeviation = stats.deviationCount > 0
      ? stats.deviationSum / stats.deviationCount
      : null;
    await pool.query(
      `INSERT INTO calibration_history (sector, market, direction_accuracy, avg_price_deviation, sample_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [sector, stats.market, directionAccuracy, avgPriceDeviation, stats.deviationCount]
    );
  }

  const sectors = Object.fromEntries(
    Array.from(sectorStats.entries()).map(([k, v]) => [
      k,
      {
        directionAccuracy: v.directionTotal > 0 ? Math.round((v.directionCorrect / v.directionTotal) * 100) : null,
        avgPriceDeviation: v.deviationCount > 0 ? Math.round((v.deviationSum / v.deviationCount) * 10) / 10 : null,
        sampleCount: v.deviationCount,
      }
    ])
  );

  console.log(`[auto-recalibrate] 완료 — ${analyses.length}건 분석, ${updatedSectors}개 섹터 갱신`);
  return { analysesProcessed: analyses.length, sectorsUpdated: updatedSectors, sectors };
}

router.post("/performance/recalculate", async (req, res) => {
  try {
    const userId = getUserId(req);
    const adminCheck = await pool.query(
      `SELECT 1 FROM admins WHERE user_id = $1`,
      [userId]
    );
    if (!userId || adminCheck.rowCount === 0) {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    const result = await autoRecalibrate();
    if (result.analysesProcessed === 0) {
      return res.json({ message: "보정 가능한 데이터가 없습니다. 30일 이상 된 분석이 필요합니다.", count: 0 });
    }
    return res.json({ message: "모델 보정 완료", ...result });
  } catch (err) {
    console.error("[performance/recalculate] error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/performance/calibration-history", async (req, res) => {
  const { sector } = req.query as { sector?: string };
  try {
    const { rows } = await pool.query(
      `SELECT sector, market, direction_accuracy, avg_price_deviation, sample_count,
              TO_CHAR(recorded_at AT TIME ZONE 'Asia/Seoul', 'MM/DD') AS label,
              recorded_at
       FROM calibration_history
       ${sector ? "WHERE sector = $1" : ""}
       ORDER BY recorded_at ASC
       LIMIT 200`,
      sector ? [sector] : []
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/performance/calibration", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sector, market, direction_accuracy, avg_price_deviation, sample_count, last_recalc_at
       FROM model_calibration
       ORDER BY sector`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── 섹터별 도메인 지식 사전 보정값 ─────────────────────────────────────────────
// 실적 데이터 30건 누적 전에도 항상 적용되는 한국 시장 특성 기반 사전 보정
export const SECTOR_PRIORS: Record<string, {
  waccRange: string;
  terminalG: string;
  peersNote: string;
  biasRisk: string;
  specificLevers: string[];
}> = {
  KR_SEMICONDUCTOR: {
    waccRange: "WACC 12.0~15.0% (한국 반도체: 시장위험 + HBM 사이클 리스크 반영. 기본값 13.0%)",
    terminalG: "Terminal g ≤ 1.5% (반도체는 기술 진부화 리스크로 장기 성장 보수적 적용)",
    peersNote: "피어: 삼성전자 반도체부문·SK하이닉스·Micron·Samsung Foundry(비상장 추정) 순서로 우선. EV/EBITDA 한국 벤치마크(6~14x)와 미국 Damodaran(23.9x) 차이 주의 — 한국 주식이면 한국 멀티플 우선. Damodaran 23.9x 직접 적용 금지.",
    biasRisk: "⛔ 과대평가 위험 CRITICAL: 2026년 분석 다수에서 목표가 300~480% 괴리 발생 확인. DCF 성장률 하드캡 미준수가 원인. Year 3 이후 성장률을 컨센서스 수준(8~12%)으로 반드시 수렴. 목표주가 = 시작가 × 1.8 초과 시 분석 무효 처리 후 WACC 2%p 상향 재계산 필수.",
    specificLevers: [
      "⛔ HARD CAP: 목표주가가 시작가의 180% 초과 금지 — 초과 시 WACC 최소 2%p 상향 후 재계산",
      "Year 1 매출성장률 상한: +50% (HBM 최대 호황 가정)",
      "Year 2 성장률 = Year 1의 최대 40% (예: Y1 +50% → Y2 최대 +20%)",
      "Year 3~5 성장률 = 컨센서스 기준 8~15%로 수렴",
      "10년 매출 CAGR이 15% 초과 시 과성장 가정 — 즉시 컨센서스로 하향",
      "OPM 상한: Year 1~2 최대 40%, Year 3~5 최대 32%, Year 6~10 최대 25%",
      "FCFF/매출 상한: Year 1~5 최대 12%, Year 6~10 최대 10%",
      "EV/EBITDA 최대 14x (한국 반도체 역사적 상단) 크로스체크 필수",
    ],
  },
  KR_BIOTECH: {
    waccRange: "WACC 12.0~16.0% (임상 단계별 차등: 3상 12~13%, 2상 14~15%, 1상/전임상 15~16%)",
    terminalG: "Terminal g ≤ 2.0% (상업화 후 성숙기 기준)",
    peersNote: "피어 rNPV PoS 기준: 3상 40~65%, 2상 15~30%, 1상 5~15%, 전임상 1~5%. 이미 허가·판매 중인 제품은 PoS=100% 고정(DCF).",
    biasRisk: "과소평가 위험: AI가 rNPV 계산 시 글로벌 파이프라인 전체를 낮은 PoS로 일괄 할인하는 경향. 허가 완료 제품과 임상 파이프라인 분리 평가 필수.",
    specificLevers: [
      "허가 완료 제품(한국·해외 허가): PoS=100% DCF로 별도 산정 후 합산",
      "rNPV 계산 시 할인율과 PoS를 이중 적용하지 말 것 (PoS는 현금흐름에, 할인율은 TV에만 적용)",
      "목표주가가 현재주가 -50% 이하면 허가 완료 제품 DCF 누락 가능성 재검토",
      "한국 임상 바이오 평균 PBR 4~12x 참조하여 rNPV 하한선 크로스체크 필수",
    ],
  },
  KR_FINANCIAL: {
    waccRange: "자기자본비용(CoE) 9.0~12.0% (금융주는 WACC 대신 Gordon Growth P/B 모델 사용)",
    terminalG: "g = 장기 GDP 성장률 수준 2.0~3.0%",
    peersNote: "피어: KB금융·신한지주·하나금융·우리금융 (국내 4대 금융지주 기준). PBR 0.4~0.9x 범위 — 코스피 대비 할인 반영.",
    biasRisk: "주의: 금융주 DDM 시 배당 성장률 과대평가 경향. 한국 금융주는 배당 규제로 DDM 과소평가 → Gordon P/B 모델 우선.",
    specificLevers: [
      "적정 P/B = (ROE - g) / (CoE - g) 공식 적용",
      "ROE 10~14% (최근 4대 금융지주 평균) 기준 적용",
      "BPS에 자사주·우선주 조정 반영",
    ],
  },
  KR_CONSTRUCTION: {
    waccRange: "WACC 9.0~12.0% (건설: 프로젝트 리스크 반영)",
    terminalG: "Terminal g ≤ 1.5%",
    peersNote: "피어: 삼성물산 건설부문·현대건설·GS건설·대우건설. EV/EBITDA 4~8x, PBR 0.3~0.6x 범위.",
    biasRisk: "주의: 삼성물산 등 복합기업은 SOTP 적용 필수. 건설부문 + 상사부문 + 투자부문 분리 평가. 단순 DCF 사용 시 지배구조 할인 미반영 오류.",
    specificLevers: [
      "SOTP 적용 시 각 사업부문 독립 멀티플 사용",
      "건설수주잔고 기반 매출 인식 확인 (잔고 소진율 반영)",
      "PF(프로젝트 파이낸싱) 우발부채 리스크 할인 반영",
    ],
  },
  KR_AUTO: {
    waccRange: "WACC 9.5~12.5%",
    terminalG: "Terminal g ≤ 1.5% (자동차: 전기차 전환 리스크 반영)",
    peersNote: "피어: 현대차·기아·Toyota·Volkswagen·BMW. PER 6~14x, EV/EBITDA 3~8x 범위.",
    biasRisk: "EV 전환 비용 과소평가 경향. R&D·Capex 증가 반영하여 FCFF 하향 압력 적용.",
    specificLevers: [
      "전기차 전환 비용: 연간 Capex 20~30% 증가 반영 (2026~2030)",
      "배터리 원가 하락 효과와 수익성 개선 균형 조정",
    ],
  },
  KR_REIT: {
    waccRange: "Cap Rate 4.5~7.0% (리츠 유형별: 물류 4.5~5.5%, 리테일 6~7%, 오피스 5~6%)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 롯데리츠·ESR켄달스퀘어·SK리츠. FFO 기반 P/FFO 12~18x 우선.",
    biasRisk: "NAV 계산 시 감정평가 기반 자산가치 사용 — 시장 거래 Cap Rate와의 차이 주의.",
    specificLevers: [
      "FFO = 순이익 + 감가상각 - 자산매각이익 (GAAP 순이익 사용 금지)",
      "NAV 할인율: 코스피 상장 리츠 평균 NAV 대비 10~20% 할인 적용",
    ],
  },
  KR_TELECOM: {
    waccRange: "WACC 7.5~9.5% (통신: 안정적 현금흐름 반영)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: SK텔레콤·KT·LG유플러스. EV/EBITDA 4~7x, PER 10~18x 범위.",
    biasRisk: "5G 투자 부담으로 단기 FCF 압박 → FCFF 과대평가 주의.",
    specificLevers: [
      "5G Capex 피크(2024~2026) 이후 감소 경로 반영",
      "배당 안정성 높아 DDM 보조 모델로 크로스체크 권장",
    ],
  },
  US_TECH: {
    waccRange: "WACC 9.0~13.0% (미국 테크: 성장 단계별 차등)",
    terminalG: "Terminal g ≤ 3.0%",
    peersNote: "Damodaran US Semiconductor: EV/EBITDA 23.9x, EV/Sales 7.1x 참조.",
    biasRisk: "미국 테크주: AI 관련 성장 프리미엄 과대반영 경향. 수익성 전환 시점 보수적 추정.",
    specificLevers: [
      "SBC(주식보상비용) 반드시 비용으로 처리 (adjusted EBITDA 사용 금지)",
      "FCF Yield 방법으로 크로스체크: 현재주가 기준 FCF Yield 2~5% 정상 범위",
    ],
  },
  US_BIOTECH: {
    waccRange: "WACC 10.0~14.0% (임상 단계별 차등)",
    terminalG: "Terminal g ≤ 2.5%",
    peersNote: "rNPV PoS 기준: FDA 3상 45~65%, 2상 20~35%, 1상 8~18%.",
    biasRisk: "FDA 심사 타임라인 과낙관 경향. PDUFA 날짜 기반 현금흐름 타이밍 조정 필수.",
    specificLevers: [
      "상업화 매출 반영: FDA 허가 후 12~18개월 시장 침투 지연 반영",
      "특허 만료 시점 반드시 DCF 기간에 포함",
    ],
  },
  KR_SEMICONDUCTOR_EQ: {
    waccRange: "WACC 10.0~13.0% (반도체 장비·소재: 고객 집중 리스크 반영)",
    terminalG: "Terminal g ≤ 1.5%",
    peersNote: "피어: ASML·Lam Research·Applied Materials·원익IPS·피에스케이·동진쎄미켐. EV/Sales 2~6x (한국), EV/EBITDA 8~20x.",
    biasRisk: "고객(삼성·SK하이닉스) 투자사이클에 연동된 매출 변동성 높음. 수주잔고·장비납기 사이클 감안하여 연도별 성장률 차등화 필수.",
    specificLevers: [
      "수주잔고 기반 단기(Y1~Y2) 매출 추정 우선, 분기별 공시 확인",
      "반도체 고객의 Capex 사이클(2026~2027 피크 예상)에 연동한 성장률 모델링",
      "한미반도체처럼 독점 제품은 20~30% 프리미엄 멀티플 적용 가능하나 고객 집중 리스크 할인",
    ],
  },
  KR_IT: {
    waccRange: "WACC 9.0~12.0% (IT·게임·플랫폼)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 카카오·넷마블·크래프톤·엔씨소프트·펄어비스 (게임), 네이버·카카오 (플랫폼). PER 15~35x, EV/Sales 2~5x.",
    biasRisk: "게임주: 신작 흥행 여부 불확실성 과소평가 경향. 플랫폼주: 광고 매출 사이클 변동성 고려.",
    specificLevers: [
      "신작 게임: 오픈 후 12개월 이내 매출 집중, 이후 급감 곡선 모델링",
      "플랫폼: MAU 성장률 둔화 감안하여 ARPU 개선 여부 별도 분석",
      "SBC 반드시 비용 처리",
    ],
  },
  KR_CONSUMER: {
    waccRange: "WACC 8.5~11.0% (소비재·전자)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 삼성전자(소비자 가전부문)·LG전자·애플·Sony. EV/EBITDA 5~12x, PER 12~20x.",
    biasRisk: "삼성전자 등 복합 대기업은 반도체·가전·모바일 부문 분리 분석 필수. 소비자 가전만 분석 시 과대평가 주의.",
    specificLevers: [
      "삼성전자 분석 시: 반도체(DS) + 가전(CE) + MX 부문 SOTP 또는 통합 DCF로 전체 기업 분석 필수",
      "가전 부문 OPM 상한: 8~12% (반도체 OPM과 혼용 금지)",
      "WM(웨어러블·스마트홈) 성장 가정 보수적 적용",
    ],
  },
  KR_ENERGY: {
    waccRange: "WACC 8.0~11.0% (에너지·화학)",
    terminalG: "Terminal g ≤ 1.5%",
    peersNote: "피어: SK이노베이션·GS칼텍스·롯데케미칼·LG화학. EV/EBITDA 4~8x, PBR 0.5~1.2x.",
    biasRisk: "유가·화학 스프레드 사이클 변동성 과소평가 경향. 중기(2~3년) 정상화 가정 사용.",
    specificLevers: [
      "유가 가정: WTI 70~85$/bbl 범위 내 기준 케이스 사용",
      "배터리 소재(양극재·음극재) 포함 시 별도 성장 모델 추가",
    ],
  },
  KR_DEFENSE: {
    waccRange: "WACC 8.0~10.5% (방산·조선·기계)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 한화에어로스페이스·LIG넥스원·현대로템·HD현대중공업. EV/EBITDA 8~20x (방산 프리미엄), PER 12~25x.",
    biasRisk: "수출 수주 지속성 불확실성 과소평가 경향. 폴란드·루마니아 등 대규모 계약의 이행 리스크 반영 필수.",
    specificLevers: [
      "수출 계약: 이행 단계별 매출 인식(납품 일정 기반) 모델링",
      "방산 업체: 장기 수주잔고 기반 매출 예측 가능성 높음 → DCF 신뢰도 우수",
      "조선: 수주단가 vs 철강 원가 스프레드 모델링 필수",
    ],
  },
};

// ── 데이터 기반 보정: 관측된 편향을 WACC·성장률 레버로 변환 ─────────────────────
function biasToLeverGuidance(devRounded: number, sector: string): string[] {
  const lines: string[] = [];
  const isKR = sector.startsWith("KR_");

  if (devRounded > 20) {
    // 심각한 과대평가
    lines.push(`⛔ 심각한 과대평가 편향(+${devRounded}%p) 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 1.5~2.0%p 상향하세요`);
    lines.push(`  2. Terminal g를 0.5%p 하향하세요 (상한: ${isKR ? "1.5" : "2.5"}%)`);
    lines.push(`  3. DCF 가중치를 줄이고 피어 멀티플 가중치를 높이세요 (DCF 40% / 피어 60%)`);
    lines.push(`  4. Bear 시나리오 가중치를 30%로 높이세요`);
  } else if (devRounded > 10) {
    lines.push(`⚠️ 중간 수준 과대평가(+${devRounded}%p) 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 1.0%p 상향하세요`);
    lines.push(`  2. Year 6~10 성장률을 0.5%p 하향 조정하세요`);
    lines.push(`  3. Bear 시나리오 가중치를 20~25%로 높이세요`);
  } else if (devRounded > 5) {
    lines.push(`⚠️ 소폭 과대평가(+${devRounded}%p) 감지:`);
    lines.push(`  1. 하단 시나리오(Bear) 가중치를 15%로 상향하세요`);
    lines.push(`  2. 피어 멀티플에서 하위 사분위수(P25) 기준값을 함께 제시하세요`);
  } else if (devRounded < -20) {
    // 심각한 과소평가
    lines.push(`⛔ 심각한 과소평가(${devRounded}%p) 편향 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 1.0~1.5%p 하향하세요`);
    lines.push(`  2. 허가 완료 제품·기존 수익 자산의 가치를 재확인하세요 (DCF 누락 가능성)`);
    lines.push(`  3. Bull 시나리오 가중치를 30%로 높이세요`);
  } else if (devRounded < -10) {
    lines.push(`⚠️ 중간 수준 과소평가(${devRounded}%p) 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 0.5~1.0%p 하향하세요`);
    lines.push(`  2. 상단 시나리오(Bull) 가중치를 25%로 높이세요`);
  }

  return lines;
}

export async function getCalibrationContext(sector: string): Promise<string | null> {
  try {
    // ── Part 1: 섹터 도메인 사전 지식 (DB 우선, 없으면 하드코딩 fallback) ──────
    const priorRow = await pool.query(
      `SELECT * FROM sector_priors WHERE sector = $1`, [sector]
    );
    const prior = priorRow.rows.length > 0 ? {
      waccRange:      priorRow.rows[0].wacc_range      as string,
      terminalG:      priorRow.rows[0].terminal_g      as string,
      peersNote:      priorRow.rows[0].peers_note      as string,
      biasRisk:       priorRow.rows[0].bias_risk       as string,
      specificLevers: (priorRow.rows[0].specific_levers as string[]) ?? [],
    } : SECTOR_PRIORS[sector] ?? null;

    // ── Part 2: 실적 데이터 기반 편향 보정 (3건 이상 있을 때) ──────────────
    const { rows } = await pool.query(
      `SELECT direction_accuracy, avg_price_deviation, sample_count, sector_benchmarks,
              diagnosis_note, diagnosis_updated_at
       FROM model_calibration
       WHERE sector = $1`,
      [sector]
    );

    const hasStat = rows.length > 0 && (rows[0].sample_count as number) >= 3;
    const cal = hasStat ? rows[0] : null;
    const dirAcc = cal ? (cal.direction_accuracy as number | null) : null;
    const dev = cal ? (cal.avg_price_deviation as number | null) : null;
    const n = cal ? (cal.sample_count as number) : 0;
    const diagnosisNote: string | null = rows[0]?.diagnosis_note ?? null;
    const diagnosisUpdatedAt: string | null = rows[0]?.diagnosis_updated_at ?? null;

    // sector_benchmarks: market-harvester가 수집한 실시장 중간값
    const benchRow = rows[0]?.sector_benchmarks ?? null;
    const bm = benchRow as {
      medianPer: number | null;
      medianPbr: number | null;
      medianRoe: number | null;
      medianOpm: number | null;
      medianRevGrowth: number | null;
      sampleCount: number;
      updatedAt: string;
    } | null;
    const hasBenchmark = bm != null && bm.sampleCount >= 5;

    // 사전 지식도, 데이터도, 시장 벤치마크도 없으면 null
    if (!prior && !hasStat && !hasBenchmark) return null;

    const lines: string[] = [];

    // ── 사전 지식 섹션 ─────────────────────────────────────────────────────
    if (prior) {
      lines.push(`[🧠 섹터 밸류에이션 보정 지침 — ${sector}]`);
      lines.push(`이 섹터의 한국 시장 특성 및 데이터 학습 결과를 반드시 반영하세요:\n`);
      lines.push(`▶ 적정 WACC 범위: ${prior.waccRange}`);
      lines.push(`▶ Terminal g: ${prior.terminalG}`);
      lines.push(`▶ 피어 선택: ${prior.peersNote}`);
      lines.push(`▶ 주요 편향 위험: ${prior.biasRisk}`);
      if (prior.specificLevers.length > 0) {
        lines.push(`▶ 핵심 조정 레버:`);
        for (const lever of prior.specificLevers) {
          lines.push(`  • ${lever}`);
        }
      }
    }

    // ── 데이터 기반 보정 섹션 ─────────────────────────────────────────────
    if (hasStat) {
      lines.push(`\n[📊 실적 데이터 보정 — 과거 ${n}건 분석 학습]`);

      if (dirAcc !== null) {
        const accLabel = dirAcc < 50
          ? "⚠️ 불확실 (방향 예측 무작위 수준)"
          : dirAcc < 60 ? "보통" : "양호";
        lines.push(`• 방향 예측 정확도: ${Math.round(dirAcc)}% (${accLabel})`);
        if (dirAcc < 50) {
          lines.push(`  → 투자의견 보정: 이 섹터는 매수/매도 단정 대신 중립 + 조건부 논리를 우선 사용하세요`);
        }
      }

      if (dev !== null) {
        const devRounded = Math.round(dev * 10) / 10;
        const biasLabel = devRounded > 0
          ? `+${devRounded}%p 과대평가 경향`
          : `${devRounded}%p 과소평가 경향`;
        lines.push(`• 목표주가 편향: ${biasLabel}`);
        const leverLines = biasToLeverGuidance(devRounded, sector);
        lines.push(...leverLines);
      }
    }

    // ── Part 2-B: AI 오류 원인 진단 (틀린 사례 패턴 분석 결과) ──────────────
    if (diagnosisNote && diagnosisNote.trim().length > 30) {
      const diagDate = diagnosisUpdatedAt
        ? new Date(diagnosisUpdatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
        : "최근";
      lines.push(`\n[🔍 실제 오류 사례 AI 진단 — ${sector} 섹터, ${diagDate} 갱신]`);
      lines.push(`⛔ 아래는 이 섹터에서 실제로 틀린 분석들의 방법론 오류를 AI가 진단한 결과입니다.`);
      lines.push(`   동일한 실수를 반복하지 않도록 반드시 숙지하고 이번 분석에 반영하세요:\n`);
      lines.push(diagnosisNote);
    }

    // ── Part 3: 시장 실데이터 벤치마크 (market-harvester 수집, 주 1회 갱신) ──
    if (hasBenchmark && bm) {
      const fmt = (v: number | null, decimals = 1) =>
        v != null ? v.toFixed(decimals) : "N/A";
      const updatedDate = bm.updatedAt
        ? new Date(bm.updatedAt).toLocaleDateString("ko-KR", { month: "short", day: "numeric" })
        : "최근";
      lines.push(`\n[📈 시장 실데이터 섹터 벤치마크 — ${bm.sampleCount}개 종목 중간값, ${updatedDate} 기준]`);
      lines.push(`이 수치는 하드코딩이 아닌 KRX 실시장 데이터에서 주 1회 자동 수집됩니다. 피어 멀티플 평가 시 아래 기준값을 우선 참조하세요.`);
      lines.push(`• 섹터 중간 PER: ${fmt(bm.medianPer)}배`);
      lines.push(`• 섹터 중간 PBR: ${fmt(bm.medianPbr)}배`);
      lines.push(`• 섹터 중간 ROE: ${fmt(bm.medianRoe)}%`);
      lines.push(`• 섹터 중간 영업이익률: ${bm.medianOpm != null ? fmt(bm.medianOpm) + "%" : "N/A (흑자 기업 기준)"}`);
      if (bm.medianRevGrowth != null) {
        lines.push(`• 섹터 중간 매출성장률(YoY): ${bm.medianRevGrowth >= 0 ? "+" : ""}${fmt(bm.medianRevGrowth)}%`);
      }
      lines.push(`→ 분석 대상 종목의 PER·PBR·ROE가 위 중간값 대비 크게 벗어날 경우 프리미엄/디스카운트 사유를 명시하세요.`);
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

export { router as performanceRouter };
export default router;
