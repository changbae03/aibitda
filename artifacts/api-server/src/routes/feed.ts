import { Router } from "express";

const router = Router();

const SUBSTACK_BASE = "https://cbstresearch.substack.com";
let cache: { data: any; fetchedAt: number } | null = null;
const CACHE_TTL = 1000 * 60 * 15; // 15 minutes

interface SubstackPost {
  id: number;
  title: string;
  subtitle?: string;
  canonical_url: string;
  post_date: string;
  cover_image?: string;
  truncated_body_text?: string;
  postTags?: { name: string; slug: string }[];
  publishedBylines?: { name: string }[];
  type: string;
}

async function fetchAllPosts(): Promise<SubstackPost[]> {
  const all: SubstackPost[] = [];
  let offset = 0;
  const limit = 12;

  while (true) {
    const url = `${SUBSTACK_BASE}/api/v1/posts?limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CBST-Bot/1.0)",
        Accept: "application/json",
      },
    });

    if (!res.ok) throw new Error(`Substack API error: HTTP ${res.status}`);

    const batch: SubstackPost[] = await res.json();
    if (!batch || batch.length === 0) break;

    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return all;
}

router.get("/substack", async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL) {
      res.json(cache.data);
      return;
    }

    const posts = await fetchAllPosts();

    const items = posts
      .filter((p) => p.type === "newsletter") // exclude podcasts/videos
      .map((p) => {
        const tag = p.postTags?.[0]?.name ?? null;
        const creator = p.publishedBylines?.[0]?.name ?? "CBST Research";
        const summary = p.truncated_body_text?.trim().slice(0, 200) ?? "";

        return {
          title: p.title,
          link: p.canonical_url,
          pubDate: p.post_date,
          summary: summary.length === 200 ? summary + "…" : summary,
          image: p.cover_image ?? null,
          creator,
          tag,
        };
      });

    const result = {
      title: "CBST Research",
      link: SUBSTACK_BASE,
      items,
    };

    cache = { data: result, fetchedAt: now };
    res.json(result);
  } catch (err: any) {
    console.error("[GET /feed/substack]", err?.message);
    res.status(502).json({ error: "Substack 데이터를 가져오지 못했습니다", detail: err?.message });
  }
});

export default router;
