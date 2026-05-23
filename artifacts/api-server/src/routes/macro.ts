import { Router } from "express";
import { fetchECOSMacro } from "../lib/ecos-client.js";
import { fetchFREDMacro } from "../lib/fred-client.js";

const router = Router();

router.get("/macro", async (_req, res) => {
  try {
    const [ecos, fred] = await Promise.all([fetchECOSMacro(), fetchFREDMacro()]);
    res.json({ ecos, fred, fetchedAt: Date.now() });
  } catch {
    res.status(500).json({ error: "거시지표 조회 실패" });
  }
});

/* ── 매크로 뉴스 피드 ─────────────────────────────────────────────────── */

interface MacroNewsItem {
  title: string;
  source: string;
  pubDate: string; // ISO
  url: string;
}

const macroNewsCache = new Map<string, { ts: number; items: MacroNewsItem[] }>();
const MACRO_NEWS_TTL = 10 * 60 * 1000; // 10분

const RSS_SOURCES: { url: string; source: string }[] = [
  { url: "https://www.hankyung.com/feed/economy",       source: "한국경제" },
  { url: "https://www.hankyung.com/feed/international", source: "한국경제(국제)" },
  { url: "https://www.mk.co.kr/rss/30100041/",          source: "매일경제" },
];

function parseRss(xml: string, sourceFallback: string): MacroNewsItem[] {
  const items: MacroNewsItem[] = [];
  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    // title: CDATA 또는 plain
    const titleMatch =
      block.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/) ??
      block.match(/<title>([^<]{4,})<\/title>/);
    const title = titleMatch?.[1]?.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() ?? "";
    if (!title) continue;

    // link
    const linkMatch =
      block.match(/<link>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/link>/) ??
      block.match(/<link>([^<]+)<\/link>/) ??
      block.match(/<guid[^>]*>([^<]+)<\/guid>/);
    const url = linkMatch?.[1]?.trim() ?? "";

    // pubDate
    const pubMatch = block.match(/<pubDate>([^<]+)<\/pubDate>/);
    let pubDate = new Date().toISOString();
    if (pubMatch?.[1]) {
      const parsed = new Date(pubMatch[1].trim());
      if (!isNaN(parsed.getTime())) pubDate = parsed.toISOString();
    }

    // source (dc:creator or channel default)
    const srcMatch = block.match(/<source[^>]*>(?:<!\[CDATA\[)?([^\]<]+)(?:\]\]>)?<\/source>/);
    const source = srcMatch?.[1]?.trim() || sourceFallback;

    items.push({ title, source, pubDate, url });
  }
  return items;
}

async function fetchRss(url: string, source: string): Promise<MacroNewsItem[]> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const text = await r.text();
    return parseRss(text, source);
  } catch {
    return [];
  }
}

router.get("/macro/news", async (req, res) => {
  const force = req.query.force === "true";
  const cached = macroNewsCache.get("global");
  if (!force && cached && Date.now() - cached.ts < MACRO_NEWS_TTL) {
    res.json({ items: cached.items, cachedAt: new Date(cached.ts).toISOString() });
    return;
  }

  try {
    const results = await Promise.all(RSS_SOURCES.map(s => fetchRss(s.url, s.source)));
    const all = results.flat();

    // 중복 제거 (제목 앞 20자 기준)
    const seen = new Set<string>();
    const deduped: MacroNewsItem[] = [];
    for (const item of all) {
      const key = item.title.slice(0, 20);
      if (!seen.has(key)) { seen.add(key); deduped.push(item); }
    }

    // 최신순 정렬
    deduped.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
    const items = deduped.slice(0, 60);

    macroNewsCache.set("global", { ts: Date.now(), items });
    res.json({ items, cachedAt: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: "매크로 뉴스 조회 실패" });
  }
});

export default router;
