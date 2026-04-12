import { Router, type IRouter } from "express";

const router: IRouter = Router();

interface NewsItem {
  id: string;
  text: string;
  html: string;
  date: string;
  link: string;
  images: string[];
}

let cache: { items: NewsItem[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5분

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, "")).trim();
}

async function fetchTelegramNews(): Promise<NewsItem[]> {
  const url = "https://t.me/s/cbstradar";
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const items: NewsItem[] = [];

  // Extract each message block
  const messageBlockRegex =
    /<div class="tgme_widget_message_wrap[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;

  // Simpler approach: extract post IDs and their data
  const postRegex = /data-post="cbstradar\/(\d+)"/g;
  const postIds: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = postRegex.exec(html)) !== null) {
    postIds.push(m[1]);
  }

  // Split HTML by message divs
  const segments = html.split(/(?=<div class="tgme_widget_message[^_])/);

  for (const segment of segments) {
    // Get post ID
    const idMatch = segment.match(/data-post="cbstradar\/(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];

    // Get message text (with inner HTML preserved for links/bold)
    const textMatch = segment.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/
    );
    const rawHtml = textMatch ? textMatch[1] : "";
    const text = stripHtmlTags(rawHtml);
    if (!text && !segment.includes("tgme_widget_message_photo")) continue;

    // Get timestamp
    const timeMatch = segment.match(/datetime="([^"]+)"/);
    const date = timeMatch ? timeMatch[1] : new Date().toISOString();

    // Get link
    const link = `https://t.me/cbstradar/${id}`;

    // Get images (background-image in photo divs, excluding emoji/icon images)
    const images: string[] = [];
    const imgRegex = /background-image:url\('([^']+)'\)/g;
    let imgMatch: RegExpExecArray | null;
    const isContentImage = (src: string) =>
      !src.includes("telegram.org/img/emoji") &&
      !src.includes("telegram.org/img/s/") &&
      (src.includes("cdn") || src.includes("telesco") || src.includes("t.me"));
    const normalizeUrl = (src: string) =>
      src.startsWith("//") ? `https:${src}` : src;
    while ((imgMatch = imgRegex.exec(segment)) !== null) {
      const url = normalizeUrl(imgMatch[1]);
      if (isContentImage(url)) images.push(url);
    }
    // Also check <img> src within message
    const srcRegex = /<img[^>]+src="([^"]+)"/g;
    while ((imgMatch = srcRegex.exec(segment)) !== null) {
      const url = normalizeUrl(imgMatch[1]);
      if (isContentImage(url) && !images.includes(url)) images.push(url);
    }

    // Clean inner HTML for display (convert <br> to newline, preserve links/bold)
    const cleanHtml = rawHtml
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, text) => {
        const cleanText = stripHtmlTags(text);
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">${cleanText}</a>`;
      })
      .replace(/<b>([\s\S]*?)<\/b>/g, "<strong>$1</strong>")
      .replace(/<i>([\s\S]*?)<\/i>/g, "<em>$1</em>")
      .replace(/<[^>]+>/g, "")
      .trim();

    items.push({ id, text, html: cleanHtml, date, link, images });
  }

  // Return newest first, deduplicated
  const seen = new Set<string>();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .reverse()
    .slice(0, 50);
}

router.get("/news", async (req, res) => {
  try {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < CACHE_TTL) {
      res.json({ items: cache.items, cached: true });
      return;
    }

    const items = await fetchTelegramNews();
    cache = { items, fetchedAt: now };
    res.json({ items, cached: false });
  } catch (err) {
    console.error("[news] fetch error:", err);
    res.status(500).json({ error: "뉴스를 불러오지 못했습니다." });
  }
});

export default router;
