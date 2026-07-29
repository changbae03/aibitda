import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

// ── DB 마이그레이션 ────────────────────────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS earnings_estimates (
        id                  SERIAL PRIMARY KEY,
        analysis_id         INT NOT NULL,
        ticker              VARCHAR(20) NOT NULL,
        company_name        VARCHAR(120),
        est_year            INT NOT NULL,
        is_estimate         BOOLEAN NOT NULL DEFAULT TRUE,
        revenue_raw         NUMERIC,
        op_income_raw       NUMERIC,
        net_income_raw      NUMERIC,
        eps_raw             NUMERIC,
        unit_label          VARCHAR(20),
        currency            VARCHAR(5) DEFAULT 'KRW',
        unit_multiplier     BIGINT DEFAULT 1,
        revenue_won         BIGINT,
        op_income_won       BIGINT,
        net_income_won      BIGINT,
        analysis_created_at TIMESTAMPTZ,
        parsed_at           TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(analysis_id, est_year)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS earnings_accuracy (
        id                  SERIAL PRIMARY KEY,
        estimate_id         INT NOT NULL REFERENCES earnings_estimates(id) ON DELETE CASCADE,
        ticker              VARCHAR(20) NOT NULL,
        est_year            INT NOT NULL,
        est_revenue         BIGINT,
        est_op_income       BIGINT,
        est_net_income      BIGINT,
        actual_revenue      BIGINT,
        actual_op_income    BIGINT,
        actual_net_income   BIGINT,
        actual_eps          BIGINT,
        revenue_dev_pct     NUMERIC(8,2),
        op_income_dev_pct   NUMERIC(8,2),
        net_income_dev_pct  NUMERIC(8,2),
        revenue_bias        VARCHAR(10),
        op_income_bias      VARCHAR(10),
        matched_at          TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(estimate_id)
      )
    `);
  } catch { /* already exists */ }
})();

// ── 유틸리티 ──────────────────────────────────────────────────────────────────

interface ColInfo {
  year: number;
  isEstimate: boolean;
  colIdx: number;
}

interface ParsedEstimate {
  year: number;
  isEstimate: boolean;
  revenueRaw: number | null;
  opIncomeRaw: number | null;
  netIncomeRaw: number | null;
  epsRaw: number | null;
  unitLabel: string;
  currency: "KRW" | "USD";
  unitMultiplier: number;
}

function unitMultiplierOf(label: string): number {
  const l = label.toLowerCase();
  if (l.includes("조"))     return 1_000_000_000_000;
  if (l.includes("억"))     return 100_000_000;
  if (l.includes("백만"))   return 1_000_000;
  if (l.includes("천만"))   return 10_000_000;
  if (l.includes("만"))     return 10_000;
  if (l.includes("$b") || l.includes("billion")) return 1_000_000_000;
  if (l.includes("$m") || l.includes("million")) return 1_000_000;
  return 1;
}

function parseNum(cell: string): number | null {
  const s = cell.replace(/,/g, "").trim();
  if (!s || s === "—" || s === "-" || s === "N/A" || s === "n/a") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function splitTableRow(line: string): string[] {
  return line.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
}

function isHeaderRow(line: string): boolean {
  return line.startsWith("|") && /\d{4}/.test(line);
}

function isSeparatorRow(line: string): boolean {
  return line.startsWith("|") && /^[\|\-\:\s]+$/.test(line);
}

function parseAnalysisContent(content: string, createdAt: Date): ParsedEstimate[] {
  const analysisYear = createdAt.getFullYear();
  const lines = content.split("\n").map((l) => l.trim());

  const results: ParsedEstimate[] = [];

  // 테이블 시작점들 찾기 (헤더 행: 연도 컬럼 포함)
  for (let hi = 0; hi < lines.length; hi++) {
    const line = lines[hi];
    if (!isHeaderRow(line)) continue;

    const cells = splitTableRow(line);
    if (cells.length < 3) continue;

    // 연도 컬럼 파싱
    const cols: ColInfo[] = [];
    cells.forEach((cell, i) => {
      const m = cell.match(/(\d{4})/);
      if (!m) return;
      const year = parseInt(m[1]);
      if (year < 2018 || year > 2035) return;

      const hasEMarker = /\d{4}E/.test(cell) || /\d{4}년E/.test(cell);
      const hasActualMarker = cell.includes("실적") || cell.includes("A");
      const isEstimate = hasEMarker
        ? true
        : hasActualMarker
        ? false
        : year >= analysisYear;

      cols.push({ year, isEstimate, colIdx: i });
    });

    if (cols.length < 2) continue;

    // 다음 행 확인: 구분자 행 스킵, 데이터 행들 수집
    let rowStart = hi + 1;
    if (rowStart < lines.length && isSeparatorRow(lines[rowStart])) rowStart++;

    // 가까운 행에 매출/Revenue 등이 있는지 확인
    const peekRows = lines.slice(rowStart, Math.min(rowStart + 15, lines.length));
    const hasMetric = peekRows.some(
      (r) =>
        r.startsWith("|") &&
        (r.includes("매출") || /Revenue/i.test(r) || r.includes("영업이익") || /Operating/i.test(r))
    );
    if (!hasMetric) continue;

    // 단위 파악 (첫 매출 행에서)
    let unitLabel = "";
    let currency: "KRW" | "USD" = "KRW";

    // 각 열(year)에 대해 수집할 값 Map
    const perYear: Record<
      number,
      { isEstimate: boolean; rev: number | null; op: number | null; net: number | null; eps: number | null }
    > = {};
    cols.forEach(({ year, isEstimate }) => {
      perYear[year] = { isEstimate, rev: null, op: null, net: null, eps: null };
    });

    for (let ri = rowStart; ri < Math.min(rowStart + 25, lines.length); ri++) {
      const rLine = lines[ri];
      if (!rLine.startsWith("|")) break;
      if (isSeparatorRow(rLine)) continue;

      const rCells = splitTableRow(rLine);
      if (rCells.length < 2) continue;
      const label = rCells[0];

      // 단위 추출
      const unitMatch = label.match(/\(([^)]+)\)/);
      if (unitMatch && !unitLabel) {
        const u = unitMatch[1];
        if (u.includes("조") || u.includes("억") || u.includes("원") || u.includes("$")) {
          unitLabel = u;
          currency = u.includes("$") ? "USD" : "KRW";
        }
      }

      // 행 타입 판별 (퍼센트 행, YoY 행 제외)
      const isRevRow =
        (/^매출(?!\s*(성장|총이익|원가|이익률|YoY))/.test(label) || /^Revenue(?!\s*(Growth|%))/i.test(label)) &&
        !label.includes("YoY") && !label.includes("률") && !label.includes("%");
      const isOpRow =
        (/^영업이익(?!\s*(률|OPM|%|YoY))/.test(label) || /^Operating Income/i.test(label)) &&
        !label.includes("률") && !label.includes("OPM") && !label.includes("%") && !label.includes("YoY");
      const isNetRow =
        (/^(순이익|당기순이익)/.test(label) || /^Net Income/i.test(label)) &&
        !label.includes("률") && !label.includes("%");
      const isEpsRow = /^EPS/.test(label);

      if (!isRevRow && !isOpRow && !isNetRow && !isEpsRow) continue;

      cols.forEach(({ year, colIdx }) => {
        const valIdx = colIdx + 1;
        const val = parseNum(rCells[valIdx] ?? "");
        if (isRevRow) perYear[year].rev = val;
        else if (isOpRow) perYear[year].op = val;
        else if (isNetRow) perYear[year].net = val;
        else if (isEpsRow) perYear[year].eps = val;
      });
    }

    const multiplier = unitMultiplierOf(unitLabel);

    cols.forEach(({ year, isEstimate }) => {
      const py = perYear[year];
      if (!py) return;
      // 값이 하나라도 있는 경우만 수집
      if (py.rev === null && py.op === null && py.net === null && py.eps === null) return;
      results.push({
        year,
        isEstimate,
        revenueRaw: py.rev,
        opIncomeRaw: py.op,
        netIncomeRaw: py.net,
        epsRaw: py.eps,
        unitLabel: unitLabel || "",
        currency,
        unitMultiplier: multiplier,
      });
    });
  }

  // 중복 제거 (같은 연도 여러 테이블 → 추정 테이블 우선)
  const merged: Record<number, ParsedEstimate> = {};
  for (const est of results) {
    if (!merged[est.year] || est.isEstimate) {
      merged[est.year] = est;
    }
  }

  return Object.values(merged).sort((a, b) => a.year - b.year);
}

function toWon(raw: number | null, multiplier: number): bigint | null {
  if (raw === null) return null;
  return BigInt(Math.round(raw * multiplier));
}

async function storeEstimates(
  analysisId: number,
  ticker: string,
  companyName: string,
  createdAt: Date,
  estimates: ParsedEstimate[]
): Promise<number> {
  let stored = 0;
  for (const est of estimates) {
    const revWon = toWon(est.revenueRaw, est.unitMultiplier);
    const opWon  = toWon(est.opIncomeRaw, est.unitMultiplier);
    const netWon = toWon(est.netIncomeRaw, est.unitMultiplier);
    try {
      await pool.query(
        `INSERT INTO earnings_estimates
           (analysis_id, ticker, company_name, est_year, is_estimate,
            revenue_raw, op_income_raw, net_income_raw, eps_raw,
            unit_label, currency, unit_multiplier,
            revenue_won, op_income_won, net_income_won,
            analysis_created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (analysis_id, est_year) DO UPDATE SET
           revenue_raw    = EXCLUDED.revenue_raw,
           op_income_raw  = EXCLUDED.op_income_raw,
           net_income_raw = EXCLUDED.net_income_raw,
           eps_raw        = EXCLUDED.eps_raw,
           revenue_won    = EXCLUDED.revenue_won,
           op_income_won  = EXCLUDED.op_income_won,
           net_income_won = EXCLUDED.net_income_won,
           parsed_at      = NOW()`,
        [
          analysisId, ticker, companyName, est.year, est.isEstimate,
          est.revenueRaw, est.opIncomeRaw, est.netIncomeRaw, est.epsRaw,
          est.unitLabel, est.currency, est.unitMultiplier,
          revWon !== null ? revWon.toString() : null,
          opWon  !== null ? opWon.toString()  : null,
          netWon !== null ? netWon.toString() : null,
          createdAt,
        ]
      );
      stored++;
    } catch { /* skip */ }
  }
  return stored;
}

async function matchWithDart(
  estimateId: number,
  ticker: string,
  estYear: number,
  estRevenue: bigint | null,
  estOpIncome: bigint | null,
  estNetIncome: bigint | null
): Promise<boolean> {
  const isKorean = /^\d{6}$/.test(ticker);
  if (!isKorean) return false;

  // DART 사업보고서(11011) 우선, 없으면 반기(11012)
  const { rows } = await pool.query<{
    revenue: string | null;
    operating_income: string | null;
    net_income: string | null;
    eps: string | null;
  }>(
    `SELECT revenue, operating_income, net_income, eps
     FROM ticker_financials
     WHERE ticker = $1 AND bsns_year = $2
       AND reprt_code IN ('11011','11012')
       AND fs_type IN ('CFS','OFS')
     ORDER BY CASE reprt_code WHEN '11011' THEN 1 ELSE 2 END,
              CASE fs_type    WHEN 'CFS'   THEN 1 ELSE 2 END
     LIMIT 1`,
    [ticker, estYear]
  );

  if (rows.length === 0) return false;
  const dart = rows[0];

  const actRev = dart.revenue   ? BigInt(dart.revenue)           : null;
  const actOp  = dart.operating_income ? BigInt(dart.operating_income) : null;
  const actNet = dart.net_income ? BigInt(dart.net_income)       : null;
  const actEps = dart.eps       ? BigInt(dart.eps)               : null;

  function devPct(est: bigint | null, act: bigint | null): number | null {
    if (est === null || act === null || act === 0n) return null;
    return Number(((est - act) * 10000n) / act) / 100;
  }

  function bias(dev: number | null): string | null {
    if (dev === null) return null;
    if (dev > 5)  return "over";
    if (dev < -5) return "under";
    return "hit";
  }

  const rDev = devPct(estRevenue, actRev);
  const oDev = devPct(estOpIncome, actOp);
  const nDev = devPct(estNetIncome, actNet);

  await pool.query(
    `INSERT INTO earnings_accuracy
       (estimate_id, ticker, est_year,
        est_revenue, est_op_income, est_net_income,
        actual_revenue, actual_op_income, actual_net_income, actual_eps,
        revenue_dev_pct, op_income_dev_pct, net_income_dev_pct,
        revenue_bias, op_income_bias)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (estimate_id) DO UPDATE SET
       actual_revenue     = EXCLUDED.actual_revenue,
       actual_op_income   = EXCLUDED.actual_op_income,
       actual_net_income  = EXCLUDED.actual_net_income,
       actual_eps         = EXCLUDED.actual_eps,
       revenue_dev_pct    = EXCLUDED.revenue_dev_pct,
       op_income_dev_pct  = EXCLUDED.op_income_dev_pct,
       net_income_dev_pct = EXCLUDED.net_income_dev_pct,
       revenue_bias       = EXCLUDED.revenue_bias,
       op_income_bias     = EXCLUDED.op_income_bias,
       matched_at         = NOW()`,
    [
      estimateId, ticker, estYear,
      estRevenue?.toString() ?? null,
      estOpIncome?.toString() ?? null,
      estNetIncome?.toString() ?? null,
      actRev?.toString() ?? null,
      actOp?.toString()  ?? null,
      actNet?.toString() ?? null,
      actEps?.toString() ?? null,
      rDev, oDev, nDev,
      bias(rDev), bias(oDev),
    ]
  );
  return true;
}

// ── 어드민 인증 헬퍼 ──────────────────────────────────────────────────────────
async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { rows } = await pool.query(`SELECT 1 FROM admins WHERE user_id=$1`, [userId]);
  return rows.length > 0;
}

// ── POST /api/earnings-accuracy/parse-all ─────────────────────────────────────
/**
 * 실적 전망을 추출해 저장하고, DART 확정치와 대조한다.
 *
 * 예전에는 관리자 전용 POST 엔드포인트 안에만 있어서 **아무도 부르지 않았고**,
 * 게다가 질의가 존재하지 않는 컬럼(`s.status`)을 봐서 눌러도 500으로 죽었다.
 * 그래서 earnings_estimates·earnings_accuracy가 둘 다 0행이었다 — 예측 정확도를
 * 재는 장치가 있는데 한 번도 재본 적이 없는 상태였다.
 *
 * 스케줄러가 부를 수 있도록 함수로 뺐다.
 *
 * @param sinceId 이 id보다 큰 분석만 처리한다. 매일 도는 경우 증분 처리용.
 */
export async function parseAndMatchEarnings(sinceId = 0): Promise<{
  analysesProcessed: number; totalEstimates: number; totalMatched: number;
  summary: Array<{ id: number; ticker: string; estimates: number; matched: number }>;
}> {
  const { rows: analyses } = await pool.query<{
    id: number; ticker: string; company_name: string; created_at: string;
  }>(
    `SELECT a.id, a.ticker, a.company_name, a.created_at
       FROM analyses a
       JOIN analysis_steps s ON s.analysis_id = a.id AND s.step_key = 'company_analysis'
      WHERE s.content IS NOT NULL AND length(s.content) > 200
        AND a.id > $1
      ORDER BY a.id DESC`,
    [sinceId],
  );

  let totalEstimates = 0;
  let totalMatched   = 0;
  const summary: Array<{ id: number; ticker: string; estimates: number; matched: number }> = [];

  for (const analysis of analyses) {
    const { rows: steps } = await pool.query<{ content: string }>(
      `SELECT content FROM analysis_steps WHERE analysis_id=$1 AND step_key='company_analysis'`,
      [analysis.id],
    );
    if (!steps[0]?.content) continue;

    const createdAt = new Date(analysis.created_at);
    const parsed = parseAnalysisContent(steps[0].content, createdAt);
    if (parsed.length === 0) continue;

    const stored = await storeEstimates(
      analysis.id, analysis.ticker, analysis.company_name, createdAt, parsed,
    );
    totalEstimates += stored;

    // 추정치인 경우만 DART 확정치와 대조
    let matchedCount = 0;
    for (const est of parsed.filter(e => e.isEstimate)) {
      const { rows: ee } = await pool.query<{
        id: number; revenue_won: string | null; op_income_won: string | null; net_income_won: string | null;
      }>(
        `SELECT id, revenue_won, op_income_won, net_income_won
           FROM earnings_estimates WHERE analysis_id=$1 AND est_year=$2`,
        [analysis.id, est.year],
      );
      const e = ee[0];
      if (!e) continue;
      const matched = await matchWithDart(
        e.id, analysis.ticker, est.year,
        e.revenue_won    ? BigInt(e.revenue_won)    : null,
        e.op_income_won  ? BigInt(e.op_income_won)  : null,
        e.net_income_won ? BigInt(e.net_income_won) : null,
      );
      if (matched) matchedCount++;
    }
    totalMatched += matchedCount;
    summary.push({ id: analysis.id, ticker: analysis.ticker, estimates: stored, matched: matchedCount });
  }

  return { analysesProcessed: analyses.length, totalEstimates, totalMatched, summary };
}

router.post("/earnings-accuracy/parse-all", async (req, res) => {
  try {
    const uid = req.auth?.userId ?? null;
    if (!(await isAdmin(uid))) return res.status(403).json({ error: "admin only" });
    const result = await parseAndMatchEarnings();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[earnings-accuracy/parse-all]", err);
    res.status(500).json({ error: "internal" });
  }
});

// ── GET /api/earnings-accuracy/list ──────────────────────────────────────────
router.get("/earnings-accuracy/list", async (req, res) => {
  try {
    const uid = req.auth?.userId ?? null;
    if (!(await isAdmin(uid))) return res.status(403).json({ error: "admin only" });

    const { rows } = await pool.query(
      `SELECT
         ee.id, ee.analysis_id, ee.ticker, ee.company_name, ee.est_year,
         ee.is_estimate, ee.unit_label, ee.currency,
         ee.revenue_raw, ee.op_income_raw, ee.net_income_raw, ee.eps_raw,
         ee.parsed_at, ee.analysis_created_at,
         ea.actual_revenue, ea.actual_op_income, ea.actual_net_income, ea.actual_eps,
         ea.revenue_dev_pct, ea.op_income_dev_pct, ea.net_income_dev_pct,
         ea.revenue_bias, ea.op_income_bias, ea.matched_at
       FROM earnings_estimates ee
       LEFT JOIN earnings_accuracy ea ON ea.estimate_id = ee.id
       ORDER BY ee.ticker, ee.est_year DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("[earnings-accuracy/list]", err);
    res.status(500).json({ error: "internal" });
  }
});

// ── GET /api/earnings-accuracy/stats ─────────────────────────────────────────
router.get("/earnings-accuracy/stats", async (req, res) => {
  try {
    const uid = req.auth?.userId ?? null;
    if (!(await isAdmin(uid))) return res.status(403).json({ error: "admin only" });

    const [totRow, matchRow, biasRow] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_estimate) AS total_estimates FROM earnings_estimates`),
      pool.query(`
        SELECT
          COUNT(*)                                                   AS matched,
          ROUND(AVG(ABS(op_income_dev_pct))::numeric, 1)            AS avg_op_dev_abs,
          ROUND(AVG(op_income_dev_pct)::numeric, 1)                 AS avg_op_dev,
          ROUND(AVG(ABS(revenue_dev_pct))::numeric, 1)              AS avg_rev_dev_abs,
          COUNT(*) FILTER (WHERE ABS(op_income_dev_pct) <= 20)      AS within_20pct,
          COUNT(*) FILTER (WHERE ABS(op_income_dev_pct) <= 10)      AS within_10pct
        FROM earnings_accuracy`),
      pool.query(`
        SELECT op_income_bias, COUNT(*) AS cnt
        FROM earnings_accuracy WHERE op_income_bias IS NOT NULL
        GROUP BY op_income_bias`),
    ]);

    const biasMap: Record<string, number> = {};
    biasRow.rows.forEach((r: any) => { biasMap[r.op_income_bias] = Number(r.cnt); });

    res.json({
      total:           Number(totRow.rows[0].total),
      totalEstimates:  Number(totRow.rows[0].total_estimates),
      matched:         Number(matchRow.rows[0].matched),
      avgOpDevAbs:     matchRow.rows[0].avg_op_dev_abs !== null ? Number(matchRow.rows[0].avg_op_dev_abs) : null,
      avgOpDev:        matchRow.rows[0].avg_op_dev     !== null ? Number(matchRow.rows[0].avg_op_dev)     : null,
      avgRevDevAbs:    matchRow.rows[0].avg_rev_dev_abs !== null ? Number(matchRow.rows[0].avg_rev_dev_abs) : null,
      within20pct:     Number(matchRow.rows[0].within_20pct),
      within10pct:     Number(matchRow.rows[0].within_10pct),
      bias: biasMap,
    });
  } catch (err) {
    console.error("[earnings-accuracy/stats]", err);
    res.status(500).json({ error: "internal" });
  }
});

export { router as earningsAccuracyRouter };
