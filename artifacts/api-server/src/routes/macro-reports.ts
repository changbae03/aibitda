import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";
import { GoogleGenAI } from "@google/genai";
import { fetchFREDMacro } from "../lib/fred-client.js";
import { fetchECOSMacro } from "../lib/ecos-client.js";

const router = Router();

const geminiApiKey = process.env.GEMINI_API_KEY ?? process.env.AI_INTEGRATIONS_GEMINI_API_KEY!;
const ai = new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(process.env.GEMINI_API_KEY ? {} : {
    httpOptions: { baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL! },
  }),
});

async function q(sql: string, params: any[] = []) {
  const client = await pool.connect();
  try { return (await client.query(sql, params)).rows; }
  finally { client.release(); }
}

async function isAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return (await q(`SELECT 1 FROM admins WHERE user_id = $1 LIMIT 1`, [userId])).length > 0;
}

async function ensureTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS macro_reports (
      id          SERIAL PRIMARY KEY,
      title       TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT '기타',
      summary     TEXT,
      content     TEXT NOT NULL,
      is_published BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

// GET /api/macro-reports — 공개 목록 조회
router.get("/macro-reports", async (req, res) => {
  await ensureTable();
  try {
    const rows = await q(
      `SELECT id, title, category, summary, is_published, created_at, updated_at FROM macro_reports WHERE is_published = true ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/macro-reports/:id — 단건 전체 조회
router.get("/macro-reports/:id", async (req, res) => {
  await ensureTable();
  try {
    const rows = await q(`SELECT * FROM macro_reports WHERE id = $1 AND is_published = true LIMIT 1`, [req.params.id]);
    if (!rows[0]) { res.status(404).json({ error: "not found" }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/admin/macro-reports — 보고서 직접 작성 (관리자)
router.post("/admin/macro-reports", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { title, category = "기타", summary = "", content, is_published = true } = req.body as {
    title?: string; category?: string; summary?: string; content?: string; is_published?: boolean;
  };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: "제목과 본문을 입력해주세요." }); return;
  }
  try {
    const rows = await q(
      `INSERT INTO macro_reports (title, category, summary, content, is_published) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title.trim(), category, summary?.trim() ?? "", content.trim(), !!is_published]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/admin/macro-reports/generate — AI 자동 보고서 생성 (관리자)
// body: { topic?: string }  — topic 없으면 오늘의 핵심 이슈 자동 선정
router.post("/admin/macro-reports/generate", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { topic } = req.body as { topic?: string };

  try {
    const [fredResult, ecosResult] = await Promise.allSettled([
      fetchFREDMacro(),
      fetchECOSMacro(),
    ]);

    const fred = fredResult.status === "fulfilled" ? fredResult.value : null;
    const ecos = ecosResult.status === "fulfilled" ? ecosResult.value : null;

    const today = new Date().toLocaleDateString("ko-KR", {
      year: "numeric", month: "long", day: "numeric", weekday: "long",
      timeZone: "Asia/Seoul",
    });

    const macroCtx = [
      fred?.fedTargetUpper != null && fred?.fedTargetLower != null
        ? `미국 연방기금금리 목표 ${fred.fedTargetLower}~${fred.fedTargetUpper}%`
        : fred?.fedFundsRate != null ? `미국 연방기금금리 ${fred.fedFundsRate}%` : null,
      fred?.t10y != null ? `미국 10년 국채수익률 ${fred.t10y}%` : null,
      fred?.t2y  != null ? `미국 2년 국채수익률 ${fred.t2y}%` : null,
      fred?.yieldSpread != null ? `장단기 스프레드(10Y-2Y) ${fred.yieldSpread > 0 ? "+" : ""}${fred.yieldSpread.toFixed(2)}%p` : null,
      fred?.cpiYoY != null ? `미국 CPI ${fred.cpiYoY.toFixed(2)}% (YoY)` : null,
      fred?.gdpGrowth != null ? `미국 실질GDP 성장률 ${fred.gdpGrowth}% (전기대비 연율)` : null,
      fred?.unemploymentRate != null ? `미국 실업률 ${fred.unemploymentRate}%` : null,
      fred?.wtiCrude != null ? `WTI 유가 $${fred.wtiCrude}/배럴` : null,
      ecos?.baseRate != null ? `한국 기준금리 ${ecos.baseRate}%` : null,
      ecos?.cpiYoY  != null ? `한국 CPI ${ecos.cpiYoY}% (YoY)` : null,
      ecos?.usdKrw  != null ? `원/달러 환율 ${ecos.usdKrw.toLocaleString()}원` : null,
      ecos?.bondYield3Y != null ? `한국 국고채 3년 ${ecos.bondYield3Y}%` : null,
      ecos?.bondYield10Y != null ? `한국 국고채 10년 ${ecos.bondYield10Y}%` : null,
    ].filter(Boolean).join("\n");

    const topicLine = topic?.trim()
      ? `\n분석 주제: 관리자가 다음 주제로 보고서를 요청했습니다 → **"${topic.trim()}"**\n위 주제를 중심으로 현재 거시경제 환경과 연결하여 심층 분석하세요.`
      : `\n지금 시점에서 가장 중요한 매크로 이슈 1가지를 직접 선정하여 분석하세요.`;

    const prompt = `당신은 글로벌 헤지펀드 소속의 매크로 전략 수석 애널리스트입니다.
오늘 날짜: ${today}
${topicLine}

현재 주요 거시경제 지표 (참고 데이터):
${macroCtx || "(지표 데이터 없음)"}

다음 4개 섹션 구조로 보고서를 작성하세요. 각 섹션은 **굵은 제목**으로 구분합니다.
핵심만 담고 간결하게 — 각 섹션은 2~3문단을 넘지 않도록 합니다.

**이슈 배경**
왜 지금 이 이슈가 중요한가? 역사적·구조적 맥락을 핵심만 짚어 서술.

**현황 데이터**
최근 발표된 주요 지표와 수치를 팩트 중심으로 간결하게 서술. 구체적인 숫자와 날짜 포함.

**시장 파급 효과**
이 이슈가 주식·채권·외환·원자재 시장에 미치는 영향. 수혜/피해 섹터를 명확히 구분.

**결론**
투자자 관점의 핵심 시사점. "그래서 뭘 해야 하는가"를 명확하게 제시.

전문적이고 분석적인 톤으로, 구체적 수치를 포함하되 전체 700~1,000자 내외로 간결하게 작성하세요.
마지막에 아래 JSON을 출력하세요:
<JSON>
{"title": "보고서 제목(이슈 핵심을 담은 15자 내외)", "summary": "카드 미리보기용 요약 2문장(100자 내외)"}
</JSON>`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.7, maxOutputTokens: 8192 },
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const jsonMatch = raw.match(/<JSON>\s*([\s\S]*?)\s*<\/JSON>/);
    let title = `매크로 분석 — ${today}`;
    let summary = "";
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.title)   title   = parsed.title;
        if (parsed.summary) summary = parsed.summary;
      } catch {}
    }

    const content = raw.replace(/<JSON>[\s\S]*?<\/JSON>/g, "").trim();

    const rows = await q(
      `INSERT INTO macro_reports (title, category, summary, content, is_published) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [title, "AI", summary, content, true]
    );

    console.log(`[macro-reports] AI 보고서 생성 완료: "${title}" (${content.length}자)`);
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[macro-reports] AI 생성 오류:", err?.message);
    res.status(500).json({ error: err?.message ?? "AI 보고서 생성 실패" });
  }
});

// PATCH /api/admin/macro-reports/:id — 보고서 수정 (관리자)
router.patch("/admin/macro-reports/:id", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { title, category, summary, content, is_published } = req.body as {
    title?: string; category?: string; summary?: string; content?: string; is_published?: boolean;
  };
  try {
    const rows = await q(
      `UPDATE macro_reports SET
        title        = COALESCE($1, title),
        category     = COALESCE($2, category),
        summary      = COALESCE($3, summary),
        content      = COALESCE($4, content),
        is_published = COALESCE($5, is_published),
        updated_at   = NOW()
       WHERE id = $6 RETURNING *`,
      [title?.trim() ?? null, category ?? null, summary?.trim() ?? null, content?.trim() ?? null, is_published ?? null, req.params.id]
    );
    if (!rows[0]) { res.status(404).json({ error: "not found" }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// DELETE /api/admin/macro-reports/:id — 보고서 삭제 (관리자)
router.delete("/admin/macro-reports/:id", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }
  try {
    await q(`DELETE FROM macro_reports WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
