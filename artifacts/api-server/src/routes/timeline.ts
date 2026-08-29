import { Router, type IRouter } from "express";
import { GoogleGenAI } from "@google/genai";
import { verifyTimeline } from "../lib/timeline-verify.js";

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
async function fetchGoogleNewsRss(keyword: string, ticker?: string): Promise<RssItem[]> {
  try {
    const HEADERS = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };
    const TIMEOUT = { signal: AbortSignal.timeout(10000), headers: HEADERS };

    // 종목 티커가 있으면: 종목코드 단독 검색 + 회사명 검색 병렬 실행
    // 종목코드만 검색하면 증권 관련 뉴스만 반환 → 도시/지명 혼동 방지
    const requests: Promise<Response>[] = [];
    if (ticker) {
      // 종목코드로 검색 (가장 신뢰도 높음)
      requests.push(fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(ticker)}&hl=ko&gl=KR&ceid=KR:ko`, TIMEOUT));
      // 회사명 + 주식 (보조)
      requests.push(fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(keyword + " 주식")}&hl=ko&gl=KR&ceid=KR:ko`, TIMEOUT));
    } else {
      // 영어 뉴스 (글로벌 종목 대응)
      requests.push(fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`, TIMEOUT));
      requests.push(fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`, TIMEOUT));
    }

    const results = await Promise.allSettled(requests);
    const items: RssItem[] = [];
    const labels = ticker ? ["Google 뉴스(종목코드)", "Google 뉴스(KR)"] : ["Google 뉴스(KR)", "Google 뉴스(EN)"];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && r.value.ok) {
        items.push(...parseRssItems(await r.value.text(), labels[i]));
      }
    }
    return items;
  } catch { return []; }
}

/* ── Gemini 타임라인 생성 ─────────────────────────────────────────────────── */
async function generateTimeline(keyword: string, recentArticles: RssItem[], ticker?: string): Promise<{ summary: string; timeline: TimelineEvent[] }> {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) return { summary: "Gemini API 키가 없습니다.", timeline: [] };

  const today = new Date().toISOString().slice(0, 10);

  // 종목 티커가 있으면: 도시·지명 관련 기사 비율을 계산해 오염 여부 판단
  const CITY_REGEX = /시장|군수|도지사|지자체|지방정부|공항\s*개항|해상풍력|크루즈|대산항|간척|고속도로\s*착공|면 행정|행정복지|지역개발|관광객 유치|축제|공원|도서관/;
  const isCityArticle = (a: RssItem) => CITY_REGEX.test(a.title);
  const cityCount = ticker ? recentArticles.filter(isCityArticle).length : 0;
  const cityRatio = recentArticles.length > 0 ? cityCount / recentArticles.length : 0;
  // 도시 기사가 30% 이상이면 → 오염된 것으로 판단, Gemini에 보내지 않음
  const articlesToSend = (ticker && cityRatio >= 0.3) ? [] : recentArticles.filter(a => !isCityArticle(a));

  // 최신순 정렬 후 최대 50개
  const sorted = [...articlesToSend].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  const articleSnippets = sorted.slice(0, 50).map(a => {
    const d = new Date(a.pubDate);
    const dateStr = isNaN(d.getTime()) ? a.pubDate : d.toISOString().slice(0, 10);
    return `[${dateStr}] (${a.source}) ${a.title}`;
  }).join("\n");

  const mightBeCityArticles = ticker && cityRatio >= 0.3;

  const prompt = ticker
    ? `당신은 한국 주식시장 전문 애널리스트입니다. 오늘 날짜는 ${today}입니다.

━━━ 최우선 규칙 (반드시 준수) ━━━
이 요청은 오직 종목코드 ${ticker}, 기업명 "${keyword}"인 한국 상장 주식회사(주식/법인)에 대한 것입니다.
"${keyword}"라는 이름의 도시, 지역, 행정구역, 공공기관은 이 요청과 무관합니다.

▶ 아래 제공된 기사에 이 회사의 실적/경영/공시/M&A/제품 관련 내용이 있다면 → 그 기사들만 근거로 타임라인을 생성하세요.
▶ 기사에 없는 사건을 기억으로 채우지 마세요. date는 기사 날짜를 그대로 쓰고, 수치는 기사에 적힌 것만 씁니다.
▶ 만약 이 회사에 대한 구체적인 주식 기업 정보를 알지 못한다면 → summary를 "이 기업(${ticker})에 대한 구체적인 뉴스 정보를 찾기 어렵습니다. 증권사 리포트나 DART 공시를 직접 확인하시길 권장합니다."로 설정하고 timeline은 빈 배열([])로 반환하세요.
▶ 도시/지역/지자체에 관한 내용은 어떠한 경우에도 절대 포함하지 마세요.

${articleSnippets ? `━━━ 참고 RSS 기사 (주식회사 관련 기사만 사용) ━━━\n${articleSnippets}` : ""}

━━━ 출력 형식 (JSON만, 마크다운 없이) ━━━
{
  "summary": "위 뉴스들을 종합해, 이 기업이 앞으로 어떻게 달라질지 투자자 관점에서 3~4문장으로 분석하세요. 단순 사실 나열이 아니라 '이 뉴스들이 실적/사업/주가에 어떤 변화를 가져올 것인가'를 중심으로 서술하세요. 기업 정보가 없으면 '뉴스 정보를 찾기 어렵습니다' 명시.",
  "timeline": [
    {
      "date": "YYYY-MM-DD 또는 YYYY-MM 또는 YYYY",
      "dateLabel": "2025년 3월 15일",
      "event": "핵심 기업 이슈 제목 (25자 이내)",
      "detail": "이 뉴스가 기업 실적·사업·주가에 미치는 영향 2~3문장 (단순 사실 재술 X, 투자자 관점 영향 분석)",
      "importance": "high | medium | low",
      "category": "실적/공시/M&A/제품/경영/산업/시장/기술/금융 중 하나",
      "source": "출처 (있는 경우만)",
      "url": "URL (있는 경우만)"
    }
  ]
}`
    : `당신은 경제·지정학 전문 애널리스트입니다.
오늘 날짜는 ${today}입니다. 타임라인은 반드시 오늘까지의 최신 사건을 포함해야 합니다.
키워드 "${keyword}"에 대한 이슈 타임라인을 생성해주세요.

최근 뉴스 기사 (RSS 수집, 최신순):
${articleSnippets || "(최근 기사 없음)"}

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
- 타임라인은 기사에 있는 사건을 시간순으로 정렬
- 기사에서 확인되는 굵직한 사건만 포함 (지엽적인 사건 제외). 개수를 채우려 하지 마세요.
- **위에 제공된 기사에 있는 사건만** 쓰세요. 기사에 없는 사건을 기억으로 채우지 마세요.
- 각 사건의 date는 **그 사건을 전한 기사의 날짜**를 그대로 씁니다. 날짜를 추정하지 마세요.
- 수치(매출 증가율·금액·순위)는 **기사에 적힌 것만** 쓰세요. 기억나는 숫자를 넣지 마세요.
- 기사가 없으면 timeline을 빈 배열([])로 두고 summary에 정보를 찾기 어렵다고 쓰세요.
  **적게 쓰는 것이 틀리게 쓰는 것보다 낫습니다.**
- importance: high는 시장/외교에 결정적 영향을 준 사건, medium은 주요 사건, low는 참고 사건
- 투자자 관점에서 실질적으로 중요한 흐름을 보여주세요
- 날짜를 정확히 모르는 경우 연/월 단위로 표시
- 반드시 ${today} 기준 최근 1~2주 내 뉴스가 있다면 타임라인에 포함하세요`;

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
    const summaryOut: string = parsed.summary ?? "";
    // 프롬프트로는 못 막는다 — 기사에 없는 날짜의 사건을 서버가 걸러낸다.
    const rawTimeline: TimelineEvent[] = (parsed.timeline ?? []).sort((a: TimelineEvent, b: TimelineEvent) =>
      a.date.localeCompare(b.date)
    );
    const articleDates = sorted.map(a => {
      const d = new Date(a.pubDate);
      return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
    }).filter(Boolean);
    const { kept: timelineOut, dropped } = verifyTimeline(rawTimeline, articleDates, today);
    if (dropped.length > 0) {
      console.log(`[timeline] "${keyword}" — 근거 없는 사건 ${dropped.length}건 제외: `
        + dropped.slice(0, 3).map(d => `${d.date} ${d.event}(${d.why})`).join(", "));
    }

    // 후처리: 종목 타임라인인데 도시/지자체 내용이 감지되면 빈 결과로 교체
    if (ticker) {
      const CITY_VERIFY = /시장(市長)?|군수|도지사|지자체|지방정부|공항\s*개항|해상풍력|크루즈|대산항|고속도로\s*착공|행정복지|지역개발|관광 활성화|관광객 유치|서산시|서산공항/;
      const combinedText = summaryOut + " " + timelineOut.map(e => e.event + " " + e.detail).join(" ");
      const cityHits = (combinedText.match(CITY_VERIFY) || []).length;
      // 도시 관련 키워드 3개 이상 → 도시 내용으로 판단
      if (cityHits >= 3) {
        console.warn(`[timeline] "${keyword}" (${ticker}) — 도시 내용 감지 (hit=${cityHits}), 빈 결과 반환`);
        return {
          summary: `${keyword}(${ticker})에 대한 기업 관련 뉴스 정보를 찾기 어렵습니다. DART 공시나 증권사 리포트를 직접 확인하시길 권장합니다.`,
          timeline: [],
        };
      }
    }

    return { summary: summaryOut, timeline: timelineOut };
  } catch (e: any) {
    console.error("[timeline] Gemini error:", e?.message);
    return { summary: "타임라인 생성 중 오류가 발생했습니다.", timeline: [] };
  }
}

/* ── GET /api/news/timeline ───────────────────────────────────────────────── */
router.get("/news/timeline", async (req, res) => {
  const keyword = (req.query.keyword as string ?? "").trim();
  const ticker  = (req.query.ticker  as string ?? "").trim() || undefined;
  const force   = req.query.force === "true";
  if (!keyword) return res.status(400).json({ error: "keyword 파라미터가 필요합니다." });

  // ticker가 있으면 캐시 키에 포함 (같은 키워드라도 ticker 유무에 따라 다른 결과)
  const cacheKey = ticker ? `${keyword.toLowerCase()}__${ticker}` : keyword.toLowerCase();
  const cached = _cache.get(cacheKey);
  if (!force && cached && Date.now() < cached.expiresAt) {
    return res.json(cached.data);
  }

  try {
    console.log(`[timeline] 키워드 "${keyword}"${ticker ? ` (${ticker})` : ""} 타임라인 생성 시작`);

    // 1. 일반 RSS + Google News RSS 병렬 수집
    const [generalResults, googleItems] = await Promise.all([
      Promise.allSettled(RSS_SOURCES.map(s => fetchRss(s))),
      fetchGoogleNewsRss(keyword, ticker),
    ]);
    const generalArticles = generalResults.flatMap(r => r.status === "fulfilled" ? r.value : []);

    // 2. 일반 RSS → 키워드 필터
    const kwLower = keyword.toLowerCase();
    const filteredGeneral = generalArticles.filter(a =>
      a.title.toLowerCase().includes(kwLower) || a.title.includes(keyword)
    );

    // 3. 종목 티커가 있으면: 도시·지자체 관련 기사 제거 (시장·군수·도지사·지역개발 등)
    const CITY_PATTERNS = /시장|군수|도지사|시의회|군의회|도의회|행정구역|지자체|지방정부|공항\s*개항|해상풍력단지|크루즈|대산항|간척|고속도로\s*착공|면 행정복지센터/;
    const dedupeCity = (items: RssItem[]): RssItem[] => {
      if (!ticker) return items;
      return items.filter(a => !CITY_PATTERNS.test(a.title));
    };

    const allMatching = dedupeCity([...googleItems, ...filteredGeneral]);

    console.log(`[timeline] Google뉴스 ${googleItems.length}건 + 일반RSS 키워드일치 ${filteredGeneral.length}건 = 총 ${allMatching.length}건`);

    // 4. Gemini 타임라인 생성
    const { summary, timeline } = await generateTimeline(keyword, allMatching, ticker);

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
