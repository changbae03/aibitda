import { Router } from "express";
import { pool } from "@workspace/db";
import { getCalibrationContext, classifySector } from "./performance.js";

const router = Router();

// GET /api/ticker-notes — 메모가 있는 전체 종목 목록 (company_name 포함)
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT tn.ticker, tn.memo, tn.auto_learning, tn.updated_at,
              a.company_name
       FROM ticker_notes tn
       LEFT JOIN LATERAL (
         SELECT company_name FROM analyses
         WHERE ticker = tn.ticker AND company_name IS NOT NULL
         ORDER BY created_at DESC LIMIT 1
       ) a ON true
       ORDER BY tn.updated_at DESC NULLS LAST`
    );
    res.json(result.rows.map(r => ({
      ticker: r.ticker,
      companyName: r.company_name ?? null,
      memo: r.memo ?? "",
      autoLearning: r.auto_learning ?? "",
      updatedAt: r.updated_at ?? null,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// GET /api/ticker-notes/:ticker/prompt-injection — 실제 프롬프트 주입 내용 미리보기 (반드시 /:ticker보다 먼저 등록)
router.get("/:ticker/prompt-injection", async (req, res) => {
  const ticker = (req.params.ticker ?? "").toUpperCase();
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  try {
    // ① 종목 메모 + auto_learning
    const noteResult = await pool.query(
      `SELECT tn.memo, tn.auto_learning,
              a.company_name, a.industry
       FROM ticker_notes tn
       LEFT JOIN LATERAL (
         SELECT company_name, industry FROM analyses
         WHERE ticker = $1 AND status = 'completed'
         ORDER BY created_at DESC LIMIT 1
       ) a ON true
       WHERE tn.ticker = $1`,
      [ticker]
    );
    const row = noteResult.rows[0];
    const memo: string = row?.memo ?? "";
    const rawLearning = row?.auto_learning;
    const industry: string = row?.industry ?? "";
    const companyName: string = row?.company_name ?? ticker;

    // ② sectorCalibration
    const market: "KR" | "US" = /^\d{6}$/.test(ticker) ? "KR" : "US";
    const sectorKey = classifySector(industry, market);
    const sectorCalibration = await getCalibrationContext(sectorKey);

    // ③ auto_learning 주입 텍스트 재현
    type LearningEntry = {
      date: string; verdict: string; targetPrice: number;
      entryPrice: number; upsidePct: number;
      priceAtAnalysis?: number; predictedEps?: number | null;
      directionMatch?: boolean | null; actualReturn?: number;
      daysElapsed?: number;
    };
    const learningData = rawLearning as { history?: LearningEntry[] } | null;
    let autoLearningInjected: string | null = null;
    const hist = learningData?.history ?? [];

    if (hist.length >= 2) {
      const avgUpside = hist.reduce((s, h) => s + h.upsidePct, 0) / hist.length;
      const bullishCount = hist.filter(h => ["Strong Buy", "Buy"].includes(h.verdict)).length;
      const bullishPct = Math.round((bullishCount / hist.length) * 100);
      const upsides = hist.map(h => `${h.date.slice(0, 7)}: ${h.upsidePct > 0 ? "+" : ""}${h.upsidePct}%`).join(", ");

      let dirCorrect = 0, dirTotal = 0;
      for (let i = 0; i < hist.length; i++) {
        const entry = hist[i];
        if (entry.directionMatch !== undefined && entry.directionMatch !== null) {
          if (entry.directionMatch === true) dirCorrect++;
          dirTotal++;
        } else if (i + 1 < hist.length) {
          const p0 = entry.priceAtAnalysis ?? entry.entryPrice;
          const p1 = hist[i + 1].priceAtAnalysis ?? hist[i + 1].entryPrice;
          if (!p0 || !p1) continue;
          if ((hist[i + 1].priceAtAnalysis ?? hist[i + 1].entryPrice) > p0 === ["Strong Buy", "Buy"].includes(entry.verdict)) dirCorrect++;
          dirTotal++;
        }
      }
      const dirStr = dirTotal >= 1
        ? `방향 정확도: ${dirCorrect}/${dirTotal}회 일치 (${Math.round((dirCorrect / dirTotal) * 100)}%)`
        : "";

      const actualReturns: string[] = [];
      for (let i = 0; i < hist.length; i++) {
        const e = hist[i];
        if (e.actualReturn !== undefined) {
          const label = e.daysElapsed ? `(${e.daysElapsed}일 경과)` : "";
          actualReturns.push(`${e.date.slice(0, 7)}${label}: 예측 ${e.upsidePct > 0 ? "+" : ""}${e.upsidePct}% → 실제 ${e.actualReturn >= 0 ? "+" : ""}${e.actualReturn}%`);
        } else if (i + 1 < hist.length) {
          const p0 = e.priceAtAnalysis ?? e.entryPrice;
          const p1 = hist[i + 1].priceAtAnalysis ?? hist[i + 1].entryPrice;
          if (!p0 || !p1) continue;
          const ret = ((p1 - p0) / p0) * 100;
          actualReturns.push(`${e.date.slice(0, 7)}: 예측 ${e.upsidePct > 0 ? "+" : ""}${e.upsidePct}% → 실제(추정) ${ret > 0 ? "+" : ""}${ret.toFixed(1)}%`);
        }
      }

      const biasNote = avgUpside > 40
        ? "\n⚠️ 낙관 편향 감지: 과거 평균 upside가 +40%를 초과합니다."
        : avgUpside < -20
        ? "\n⚠️ 비관 편향 감지: 과거 평균 upside가 -20%를 하회합니다."
        : "";

      autoLearningInjected = `[📊 ${ticker} 밸류에이션 누적 통계 — ${hist.length}회 분석 기반]`
        + `\n- 평균 upside: ${avgUpside > 0 ? "+" : ""}${avgUpside.toFixed(1)}% | 매수 판정 비율: ${bullishPct}%`
        + `\n- 회차별 upside: ${upsides}`
        + (actualReturns.length > 0 ? `\n- 예측 vs 실제: ${actualReturns.join(" / ")}` : "")
        + (dirStr ? `\n- ${dirStr}` : "")
        + biasNote
        + `\n- 위 통계를 바탕으로 낙관/비관 편향이 있었다면 이번 분석에서 의식적으로 보정하세요.`;
    }

    res.json({
      ticker,
      companyName,
      industry,
      sectorKey,
      blocks: [
        memo ? { type: "memo", label: "관리자 보정 메모", content: memo } : null,
        autoLearningInjected ? { type: "autoLearning", label: `종목 자동학습 통계 (${hist.length}회 분석)`, content: autoLearningInjected } : null,
        sectorCalibration ? { type: "sectorCalibration", label: `섹터 보정 (${sectorKey})`, content: sectorCalibration } : null,
      ].filter(Boolean),
      historyCount: hist.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// GET /api/ticker-notes/:ticker — 종목별 관리자 메모 조회
router.get("/:ticker", async (req, res) => {
  const ticker = (req.params.ticker ?? "").toUpperCase();
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  try {
    const result = await pool.query(
      `SELECT memo, updated_at FROM ticker_notes WHERE ticker = $1`,
      [ticker]
    );
    const row = result.rows[0];
    res.json({ ticker, memo: row?.memo ?? "", updatedAt: row?.updated_at ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

// PUT /api/ticker-notes/:ticker — 종목별 관리자 메모 저장/수정
router.put("/:ticker", async (req, res) => {
  const ticker = (req.params.ticker ?? "").toUpperCase();
  const memo: string = req.body?.memo ?? "";
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  try {
    await pool.query(
      `INSERT INTO ticker_notes (ticker, memo, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (ticker) DO UPDATE SET memo = $2, updated_at = NOW()`,
      [ticker, memo.trim()]
    );
    res.json({ ok: true, ticker, memo: memo.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "failed" });
  }
});

export default router;
