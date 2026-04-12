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

let cacheResearch: { items: NewsItem[]; fetchedAt: number } | null = null;
let cacheRadar: { items: NewsItem[]; fetchedAt: number } | null = null;
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
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).trim();
}

async function fetchTelegramChannel(channel: string): Promise<NewsItem[]> {
  const url = `https://t.me/s/${channel}`;
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
  const segments = html.split(/(?=<div class="tgme_widget_message[^_])/);

  for (const segment of segments) {
    const idMatch = segment.match(/data-post="[^/]+\/(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const textMatch = segment.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/
    );
    const rawHtml = textMatch ? textMatch[1] : "";
    const text = stripHtmlTags(rawHtml);
    if (!text && !segment.includes("tgme_widget_message_photo")) continue;

    const timeMatch = segment.match(/datetime="([^"]+)"/);
    const date = timeMatch ? timeMatch[1] : new Date().toISOString();

    const link = `https://t.me/${channel}/${id}`;

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
    const srcRegex = /<img[^>]+src="([^"]+)"/g;
    while ((imgMatch = srcRegex.exec(segment)) !== null) {
      const url = normalizeUrl(imgMatch[1]);
      if (isContentImage(url) && !images.includes(url)) images.push(url);
    }

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

// GET /api/news — @cbstresearch (큐레이션)
router.get("/news", async (_req, res) => {
  try {
    const now = Date.now();
    if (cacheResearch && now - cacheResearch.fetchedAt < CACHE_TTL) {
      res.json({ items: cacheResearch.items, cached: true });
      return;
    }
    const items = await fetchTelegramChannel("cbstresearch");
    cacheResearch = { items, fetchedAt: now };
    res.json({ items, cached: false });
  } catch (err) {
    console.error("[news/research] fetch error:", err);
    res.status(500).json({ error: "뉴스를 불러오지 못했습니다." });
  }
});

// GET /api/news/radar — @cbstradar (실시간 뉴스)
router.get("/news/radar", async (_req, res) => {
  try {
    const now = Date.now();
    if (cacheRadar && now - cacheRadar.fetchedAt < CACHE_TTL) {
      res.json({ items: cacheRadar.items, cached: true });
      return;
    }
    const items = await fetchTelegramChannel("cbstradar");
    cacheRadar = { items, fetchedAt: now };
    res.json({ items, cached: false });
  } catch (err) {
    console.error("[news/radar] fetch error:", err);
    res.status(500).json({ error: "레이더 뉴스를 불러오지 못했습니다." });
  }
});

export default router;
