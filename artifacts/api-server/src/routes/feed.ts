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

function decodeEntities(text: string): string {
  if (!text) return "";
  let decoded = text;
  // Decode named entities first (&amp; must come last to avoid double-decode)
  decoded = decoded
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&amp;/g, "&");

  // Decode numeric decimal entities: &#12345;
  decoded = decoded.replace(/&#(\d+);/g, (_, code) =>
    String.fromCodePoint(parseInt(code, 10))
  );
  // Decode numeric hex entities: &#x1F4C4;
  decoded = decoded.replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
    String.fromCodePoint(parseInt(code, 16))
  );

  // Second pass — handles double-encoded like &amp;#8217; → &#8217; → '
  decoded = decoded
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));

  return decoded;
}

function stripHtml(html: string): string {
  if (!html) return "";
  const noScript = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  const noTags = noScript.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return decodeEntities(noTags);
}

function extractImage(html: string): string | null {
  if (!html) return null;
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
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
      const strippedText = stripHtml(rawHtml);
      const summary = strippedText.length > 200
        ? strippedText.slice(0, 200) + "…"
        : strippedText;

      return {
        title: decodeEntities(item.title ?? ""),
        link: item.link ?? "",
        pubDate: item.pubDate ?? item.isoDate ?? "",
        summary,
        image,
        creator: decodeEntities((item as any).creator ?? feed.title ?? ""),
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
