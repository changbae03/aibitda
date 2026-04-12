import { Router } from "express";
import Parser from "rss-parser";

const router = Router();
const parser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "contentEncoded"],
      ["dc:creator", "creator"],
    ],
  },
});

const SUBSTACK_RSS = "https://cbstresearch.substack.com/feed";
let cache: { data: any; fetchedAt: number } | null = null;
const CACHE_TTL = 1000 * 60 * 15; // 15 minutes

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractImage(html: string): string | null {
  const match = html?.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

router.get("/substack", async (_req, res) => {
  try {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL) {
      res.json(cache.data);
      return;
    }

    const feed = await parser.parseURL(SUBSTACK_RSS);

    const items = (feed.items || []).slice(0, 20).map((item) => {
      const rawHtml = (item as any).contentEncoded || item.content || item.summary || "";
      const image = extractImage(rawHtml) ?? (item as any).enclosure?.url ?? null;
      const summary = stripHtml(rawHtml).slice(0, 200) + (rawHtml.length > 200 ? "..." : "");

      return {
        title: item.title ?? "",
        link: item.link ?? "",
        pubDate: item.pubDate ?? item.isoDate ?? "",
        summary,
        image,
        creator: (item as any).creator ?? feed.title ?? "",
        categories: item.categories ?? [],
      };
    });

    const result = {
      title: feed.title,
      description: feed.description,
      link: feed.link,
      items,
    };

    cache = { data: result, fetchedAt: now };
    res.json(result);
  } catch (err: any) {
    console.error("[GET /feed/substack]", err?.message);
    res.status(502).json({ error: "RSS 피드를 가져오지 못했습니다", detail: err?.message });
  }
});

export default router;
