import { Router } from "express";
import { pool } from "@workspace/db";
import { getUserId } from "../lib/credits.js";

const router = Router();

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_scraps (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT NOT NULL,
      source      TEXT NOT NULL DEFAULT '',
      url         TEXT NOT NULL,
      pub_date    TIMESTAMPTZ,
      category    TEXT DEFAULT '기타',
      tags        TEXT[] DEFAULT '{}',
      topic       TEXT DEFAULT '기타',
      note        TEXT DEFAULT '',
      scrapped_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_news_scraps_user
      ON news_scraps(user_id, scrapped_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_scraps_topic
      ON news_scraps(user_id, topic, scrapped_at DESC);
  `);
}

ensureTable().catch(console.error);

/* ── 주제 자동 분류 ─────────────────────────────────────────────────────── */

const TOPIC_MAP: { topic: string; keywords: string[] }[] = [
  {
    topic: "금리·통화정책",
    keywords: ["금리", "FOMC", "연준", "Fed", "기준금리", "통화정책", "피벗", "금통위", "한국은행", "국고채", "채권", "양적완화", "긴축"],
  },
  {
    topic: "반도체·AI",
    keywords: ["반도체", "AI", "인공지능", "엔비디아", "NVIDIA", "하이닉스", "SK하이닉스", "삼성전자", "TSMC", "HBM", "칩", "GPU", "파운드리"],
  },
  {
    topic: "무역·관세",
    keywords: ["관세", "무역", "수출", "수입", "미중", "트럼프", "보호무역", "무역분쟁", "무역수지", "통상"],
  },
  {
    topic: "부동산",
    keywords: ["부동산", "아파트", "집값", "전세", "주택", "분양", "청약", "건설", "리츠", "DSR", "LTV"],
  },
  {
    topic: "기업실적",
    keywords: ["실적", "영업이익", "매출", "어닝", "흑자", "적자", "공시", "사업보고서", "분기", "연간", "배당", "자사주"],
  },
  {
    topic: "에너지·원자재",
    keywords: ["유가", "원유", "에너지", "리튬", "구리", "금", "원자재", "WTI", "천연가스", "석유", "원전", "핵"],
  },
  {
    topic: "2차전지·EV",
    keywords: ["배터리", "전기차", "2차전지", "리튬이온", "LFP", "EV", "충전", "배터리주"],
  },
  {
    topic: "바이오·헬스케어",
    keywords: ["바이오", "제약", "의료", "임상", "신약", "헬스케어", "FDA", "허가"],
  },
  {
    topic: "글로벌 거시",
    keywords: ["GDP", "경기침체", "물가", "인플레이션", "경제성장", "CPI", "PMI", "실업률", "고용", "ISM", "OECD"],
  },
  {
    topic: "증시·ETF",
    keywords: ["코스피", "코스닥", "나스닥", "S&P", "다우", "ETF", "외국인", "기관", "매수", "매도", "주가지수"],
  },
];

function classifyTopic(title: string): string {
  let best = { topic: "기타", score: 0 };
  for (const { topic, keywords } of TOPIC_MAP) {
    const score = keywords.filter((k) => title.includes(k)).length;
    if (score > best.score) best = { topic, score };
  }
  return best.topic;
}

/* ── GET /api/news/scraps ───────────────────────────────────────────────── */

router.get("/news/scraps", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT id, title, source, url, pub_date, category, tags, topic, note, scrapped_at
       FROM news_scraps
       WHERE user_id = $1
       ORDER BY scrapped_at DESC
       LIMIT 200`,
      [userId],
    );
    res.json({ scraps: rows });
  } catch (e: any) {
    console.error("[GET /news/scraps]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── POST /api/news/scraps ──────────────────────────────────────────────── */

router.post("/news/scraps", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  const { title, source, url, pubDate, category, tags } = req.body as {
    title?: string; source?: string; url?: string;
    pubDate?: string; category?: string; tags?: string[];
  };

  if (!title || !url) { res.status(400).json({ error: "title, url 필수" }); return; }

  const topic = classifyTopic(title);

  try {
    const { rows } = await pool.query(
      `INSERT INTO news_scraps (user_id, title, source, url, pub_date, category, tags, topic)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, url) DO UPDATE
         SET scrapped_at = NOW(), topic = EXCLUDED.topic
       RETURNING id, title, source, url, pub_date, category, tags, topic, note, scrapped_at`,
      [
        userId,
        title,
        source ?? "",
        url,
        pubDate ?? null,
        category ?? "기타",
        tags ?? [],
        topic,
      ],
    );
    res.json({ scrap: rows[0] });
  } catch (e: any) {
    console.error("[POST /news/scraps]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── DELETE /api/news/scraps/:id ────────────────────────────────────────── */

router.delete("/news/scraps/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "유효하지 않은 id" }); return; }

  try {
    await pool.query(
      `DELETE FROM news_scraps WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    res.json({ ok: true });
  } catch (e: any) {
    console.error("[DELETE /news/scraps]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── GET /api/news/scraps/timeline ──────────────────────────────────────── */

router.get("/news/scraps/timeline", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "로그인이 필요합니다" }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT id, title, source, url, pub_date, category, tags, topic, note, scrapped_at
       FROM news_scraps
       WHERE user_id = $1
       ORDER BY topic, scrapped_at DESC`,
      [userId],
    );

    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      const t = row.topic ?? "기타";
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(row);
    }

    const timeline = Object.entries(grouped)
      .map(([topic, items]) => ({
        topic,
        count: items.length,
        latestAt: items[0]?.scrapped_at ?? null,
        items,
      }))
      .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());

    res.json({ timeline, total: rows.length });
  } catch (e: any) {
    console.error("[GET /news/scraps/timeline]", e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
