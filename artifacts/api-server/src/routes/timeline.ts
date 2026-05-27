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

/* ── 고정 RSS 소스 (일반 경제 뉴스) ─────────────────────────────────────── */
const RSS_SOURCES: RssSource[] = [
  { url: "https://www.hankyung.com/feed/economy",       source: "한국경제" },
  { url: "https://www.hankyung.com/feed/international", source: "한국경제(국제)" },
  { url: "https://www.mk.co.kr/rss/30100041/",          source: "매일경제" },
  { url: "https://www.yna.co.kr/rss/economy.xml",       source: "연합뉴스" },
  { url: "https://www.yna.co.kr/rss/international.xml", source: "연합뉴스(국제)" },
  { url: "https://www.newsis.com/RSS/economy.xml",      source: "뉴시스" },
  { url: "https://www.sedaily.com/RSS/Economy",         source: "서울경제" },
];

/* ── 캐시 (키워드별 15분) ────────────────────────────────────────────────── */
const _cache = new Map<string, { data: TimelineResult; expiresAt: number }>();
const CACHE_TTL = 15 * 60 * 1000;

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

/* ── Google News RSS (키워드 특화) ──────────────────────────────────────── */
async function fetchGoogleNewsRss(keyword: string): Promise<RssItem[]> {
  try {
    // 한국어 뉴스
    const krUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;
    // 영어 뉴스 (글로벌 종목 대응)
    const enUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`;

    const [krRes, enRes] = await Promise.allSettled([
      fetch(krUrl, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } }),
      fetch(enUrl, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } }),
    ]);

    const items: RssItem[] = [];
    if (krRes.status === "fulfilled" && krRes.value.ok) {
      items.push(...parseRssItems(await krRes.value.text(), "Google 뉴스(KR)"));
    }
    if (enRes.status === "fulfilled" && enRes.value.ok) {
      items.push(...parseRssItems(await enRes.value.text(), "Google 뉴스(EN)"));
    }
    return items;
  } catch { return []; }
}

/* ── Gemini 타임라인 생성 ─────────────────────────────────────────────────── */
async function generateTimeline(keyword: string, recentArticles: RssItem[]): Promise<{ summary: string; timeline: TimelineEvent[] }> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) return { summary: "Gemini API 키가 없습니다.", timeline: [] };

  // 최신순 정렬 후 50개 사용 (기존 30개 → 50개)
  const sorted = [...recentArticles].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  const articleSnippets = sorted.slice(0, 50).map(a => {
    const d = new Date(a.pubDate);
    const dateStr = isNaN(d.getTime()) ? a.pubDate : d.toISOString().slice(0, 10);
    return `[${dateStr}] (${a.source}) ${a.title}`;
  }).join("\n");

  const today = new Date().toISOString().slice(0, 10);

  const prompt = `당신은 경제·지정학 전문 애널리스트입니다.
오늘 날짜는 ${today}입니다. 타임라인은 반드시 오늘까지의 최신 사건을 포함해야 합니다.
키워드 "${keyword}"에 대한 이슈 타임라인을 생성해주세요.

최근 뉴스 기사 (RSS 수집, 최신순):
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
- 타임라인은 이 이슈가 처음 주목받은 시점부터 현재(${today})까지 시간순으로 정렬
- 총 10~15개의 굵직한 사건만 포함 (지엽적인 사건 제외)
- 제공된 최신 뉴스 기사를 최우선 반영, 그 외 Gemini 학습 데이터로 보완
- importance: high는 시장/외교에 결정적 영향을 준 사건, medium은 주요 사건, low는 참고 사건
- 투자자 관점에서 실질적으로 중요한 흐름을 보여주세요
- 날짜를 정확히 모르는 경우 연/월 단위로 표시
- 반드시 ${today} 기준 최근 1~2주 내 뉴스가 있다면 타임라인에 포함하세요
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

    // 1. 일반 RSS + Google News RSS 병렬 수집
    const [generalResults, googleItems] = await Promise.all([
      Promise.allSettled(RSS_SOURCES.map(s => fetchRss(s))),
      fetchGoogleNewsRss(keyword),
    ]);
    const generalArticles = generalResults.flatMap(r => r.status === "fulfilled" ? r.value : []);

    // 2. 일반 RSS → 키워드 필터
    const kwLower = keyword.toLowerCase();
    const filteredGeneral = generalArticles.filter(a =>
      a.title.toLowerCase().includes(kwLower) || a.title.includes(keyword)
    );

    // 3. Google News는 이미 키워드 특화 → 바로 합산
    const allMatching = [...googleItems, ...filteredGeneral];

    console.log(`[timeline] Google뉴스 ${googleItems.length}건 + 일반RSS 키워드일치 ${filteredGeneral.length}건 = 총 ${allMatching.length}건`);

    // 4. Gemini 타임라인 생성
    const { summary, timeline } = await generateTimeline(keyword, allMatching);

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
