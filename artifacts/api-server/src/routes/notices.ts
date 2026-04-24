import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";

const router = Router();

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
    CREATE TABLE IF NOT EXISTS notices (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '공지',
      is_pinned BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
  // 기본 테스트 기간 공지 시드 (최초 1회)
  const count = await q(`SELECT COUNT(*)::int AS n FROM notices`);
  if (count[0]?.n === 0) {
    await q(`
      INSERT INTO notices (title, content, category, is_pinned) VALUES
      ($1, $2, $3, $4),
      ($5, $6, $7, $8),
      ($9, $10, $11, $12)
    `, [
      "[중요] 현재 테스트·개발 기간 운영 중입니다",
      "안녕하세요, 애빛다입니다.\n\n현재 애빛다는 정식 오픈 전 테스트 및 개발 기간으로 운영 중입니다.\n\n• 서비스 내용, UI, 기능은 예고 없이 변경될 수 있습니다.\n• AI 분석 결과의 정확도·안정성이 아직 완성 단계가 아닐 수 있습니다.\n• 분석 크레딧 등 정책은 정식 오픈 시 변경될 수 있습니다.\n• 테스트 기간 중 생성한 데이터(분석 이력 등)는 정식 오픈 시 초기화될 수 있습니다.\n\n불편을 드려 죄송하며, 더 나은 서비스로 빠르게 정식 오픈하겠습니다.\n\n문의: 고객센터 (support@cbst.kr)\n감사합니다.",
      "공지",
      true,
      "[안내] AI 분석 면책고지 (자본시장법·AI기본법)",
      "애빛다 서비스 이용 전 반드시 확인해 주세요.\n\n• 본 서비스의 모든 분석 결과는 AI가 자동 생성한 참고용 정보입니다.\n• 특정 종목의 매수·매도를 권유하지 않습니다.\n• 본 서비스는 자본시장법상 투자자문업·투자일임업에 해당하지 않습니다.\n• 인공지능 기본법에 따라 AI 생성 콘텐츠임을 고지합니다.\n\n투자 판단의 최종 책임은 투자자 본인에게 있습니다.",
      "법적고지",
      false,
      "[업데이트] 실적 캘린더 Gemini 실시간 연동",
      "실적 발표 캘린더가 더욱 정확해졌습니다.\n\n• 한국 종목 실적발표일: Gemini AI + Google 실시간 검색으로 Yahoo Finance 대비 정확도 개선\n• KST 기준 날짜 표시 정확도 향상\n• 미국 종목: Yahoo Finance 기존 방식 유지",
      "업데이트",
      false,
    ]);
  }
}

// GET /api/notices — 공개 조회
router.get("/notices", async (req, res) => {
  await ensureTable();
  try {
    const rows = await q(`SELECT * FROM notices ORDER BY is_pinned DESC, created_at DESC`);
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/admin/notices — 공지 작성 (관리자)
router.post("/admin/notices", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { title, content, category = "공지", is_pinned = false } = req.body as {
    title?: string; content?: string; category?: string; is_pinned?: boolean;
  };
  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: "제목과 내용을 입력해주세요." }); return;
  }
  try {
    const rows = await q(
      `INSERT INTO notices (title, content, category, is_pinned) VALUES ($1,$2,$3,$4) RETURNING *`,
      [title.trim(), content.trim(), category, !!is_pinned]
    );
    res.json(rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// PATCH /api/admin/notices/:id — 공지 수정 (관리자)
router.patch("/admin/notices/:id", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }

  const { title, content, category, is_pinned } = req.body as {
    title?: string; content?: string; category?: string; is_pinned?: boolean;
  };
  try {
    const rows = await q(
      `UPDATE notices SET
        title = COALESCE($1, title),
        content = COALESCE($2, content),
        category = COALESCE($3, category),
        is_pinned = COALESCE($4, is_pinned),
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [title?.trim() ?? null, content?.trim() ?? null, category ?? null, is_pinned ?? null, req.params.id]
    );
    res.json(rows[0] ?? { error: "not found" });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// DELETE /api/admin/notices/:id — 공지 삭제 (관리자)
router.delete("/admin/notices/:id", async (req, res) => {
  await ensureTable();
  const userId = getUserId(req);
  if (!(await isAdmin(userId))) { res.status(403).json({ error: "관리자 전용" }); return; }
  try {
    await q(`DELETE FROM notices WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
