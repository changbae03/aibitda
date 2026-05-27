import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";

const router: IRouter = Router();

/* ── 타입 ────────────────────────────────────────────────────────────────── */
interface RssSource { url: string; source: string; }
interface RssItem { title: string; pubDate: string; url: string; source: string; }

interface TimelineEvent {
  date: string;          // YYYY-MM-DD or YYYY-MM or YYYY
  dateLabel: string;     // 표시용 날짜 (ex: "2024년 4월 1일")
  event: string;         // 핵심 헤드라인 (30자 이내)
  detail: string;        // 상세 설명 (2-3문장)
  importance: "high" | "medium" | "low";
  category: string;      // 외교/경제/군사/시장 등
  source?: string;       // 출처 뉴스사
  url?: string;          // 원문 링크
}

interface TimelineResult {
  keyword: string;
  summary: string;
  timeline: TimelineEvent[];
  generatedAt: number;
}

/* ── RSS 소스 ─────────────────────────────────────────────────────────────── */
const RSS_SOURCES: RssSource[] = [
  { url: "https://www.hankyung.com/feed/economy",       source: "한국경제" },
  { url: "https://www.hankyung.com/feed/international", source: "한국경제(국제)" },
  { url: "https://www.mk.co.kr/rss/30100041/",          source: "매일경제" },
  { url: "https://www.yna.co.kr/rss/economy.xml",       source: "연합뉴스" },
  { url: "https://www.yna.co.kr/rss/international.xml", source: "연합뉴스(국제)" },
  { url: "https://www.newsis.com/RSS/economy.xml",      source: "뉴시스" },
  { url: "https://www.sedaily.com/RSS/Economy",         source: "서울경제" },
];

/* ── 캐시 (키워드별 30분) ────────────────────────────────────────────────── */
const _cache = new Map<string, { data: TimelineResult; expiresAt: number }>();
const CACHE_TTL = 30 * 60 * 1000;

/* ── RSS 파싱 ─────────────────────────────────────────────────────────────── */
function parseRssItems(xml: string, source: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const titleMatch =
      b.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/) ??
      b.match(/<title>([^<]{4,})<\/title>/);
    const title = titleMatch?.[1]
      ?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"').trim() ?? "";
    if (!title || title.length < 5) continue;

    const linkMatch = b.match(/<link>\s*([^<]+)\s*<\/link>/) ??
                      b.match(/<guid[^>]*>\s*(https?:\/\/[^<]+)\s*<\/guid>/);
    const url = linkMatch?.[1]?.trim() ?? "";

    const dateMatch = b.match(/<pubDate>([^<]+)<\/pubDate>/);
    const pubDate = dateMatch?.[1]?.trim() ?? new Date().toISOString();

    items.push({ title, pubDate, url, source });
  }
  return items;
}

async function fetchRss(src: RssSource): Promise<RssItem[]> {
  try {
    const res = await fetch(src.url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AiBITDA/1.0)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, src.source);
  } catch { return []; }
}

/* ── Gemini 타임라인 생성 ─────────────────────────────────────────────────── */
async function generateTimeline(keyword: string, recentArticles: RssItem[]): Promise<{ summary: string; timeline: TimelineEvent[] }> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) return { summary: "Gemini API 키가 없습니다.", timeline: [] };

  const articleSnippets = recentArticles.slice(0, 30).map(a => {
    const d = new Date(a.pubDate);
    const dateStr = isNaN(d.getTime()) ? a.pubDate : d.toISOString().slice(0, 10);
    return `[${dateStr}] (${a.source}) ${a.title}`;
  }).join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `당신은 경제·지정학 전문 애널리스트입니다.
오늘 날짜는 ${today}입니다. 타임라인은 반드시 오늘까지의 최신 사건을 포함해야 합니다.
키워드 "${keyword}"에 대한 이슈 타임라인을 생성해주세요.

최근 뉴스 기사 (RSS 수집):
${articleSnippets || "(최근 기사 없음 — Gemini 학습 데이터 기반으로 생성)"}

다음 JSON 형식으로만 응답하세요 (설명 없이):
{
  "summary": "이 이슈의 전체 흐름을 3~4문장으로 요약 (한국어)",
  "timeline": [
    {
      "date": "YYYY-MM-DD 또는 YYYY-MM 또는 YYYY (사건 발생일)",
      "dateLabel": "2025년 3월 15일 또는 2025년 3월 또는 2024년",
      "event": "핵심 사건 제목 (25자 이내)",
      "detail": "이 사건의 배경·의미·시장 영향 (2~3문장, 한국어)",
      "importance": "high 또는 medium 또는 low",
      "category": "외교/경제/군사/시장/정치/에너지/기술/금융 중 하나",
      "source": "출처 뉴스사 (최근 뉴스인 경우만)",
      "url": "기사 URL (최근 뉴스인 경우만)"
    }
  ]
}

규칙:
- 타임라인은 이 이슈가 처음 주목받은 시점부터 현재까지 시간순으로 정렬
- 총 8~15개의 굵직한 사건만 포함 (지엽적인 사건 제외)
- 최근 제공된 뉴스 기사를 우선 반영, 그 외 Gemini 학습 데이터로 보완
- importance: high는 시장/외교에 결정적 영향을 준 사건, medium은 주요 사건, low는 참고 사건
- 투자자 관점에서 실질적으로 중요한 흐름을 보여주세요
- 날짜를 정확히 모르는 경우 연/월 단위로 표시
`;

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const resp = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const text = resp.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { summary: "타임라인 생성 실패", timeline: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      summary: parsed.summary ?? "",
      timeline: (parsed.timeline ?? []).sort((a: TimelineEvent, b: TimelineEvent) =>
        a.date.localeCompare(b.date)
      ),
    };
  } catch (e: any) {
    console.error("[timeline] Gemini error:", e?.message);
    return { summary: "타임라인 생성 중 오류가 발생했습니다.", timeline: [] };
  }
}

/* ── GET /api/news/timeline ───────────────────────────────────────────────── */
router.get("/news/timeline", async (req, res) => {
  const keyword = (req.query.keyword as string ?? "").trim();
  const force   = req.query.force === "true";
  if (!keyword) return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });

  const cacheKey = keyword.toLowerCase();
  const cached = _cache.get(cacheKey);
  if (!force && cached && Date.now() < cached.expiresAt) {
    return res.json(cached.data);
  }

  try {
    console.log(`[timeline] 키워드 "${keyword}" 타임라인 생성 시작`);

    // 1. 모든 RSS 병렬 수집
    const allResults = await Promise.allSettled(RSS_SOURCES.map(s => fetchRss(s)));
    const allArticles = allResults.flatMap(r => r.status === "fulfilled" ? r.value : []);

    // 2. 키워드 필터 (제목에 포함)
    const kwLower = keyword.toLowerCase();
    const matching = allArticles.filter(a =>
      a.title.toLowerCase().includes(kwLower) ||
      a.title.includes(keyword)
    ).sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

    console.log(`[timeline] RSS 수집 ${allArticles.length}건 → 키워드 일치 ${matching.length}건`);

    // 3. Gemini 타임라인 생성
    const { summary, timeline } = await generateTimeline(keyword, matching);

    const result: TimelineResult = {
      keyword,
      summary,
      timeline,
      generatedAt: Date.now(),
    };

    _cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL });
    console.log(`[timeline] "${keyword}" 완료 — 이벤트 ${timeline.length}개`);
    return res.json(result);
  } catch (e: any) {
    console.error("[timeline] error:", e?.message);
    return res.status(500).json({ error: e?.message ?? "타임라인 생성 실패" });
  }
});

export default router;
