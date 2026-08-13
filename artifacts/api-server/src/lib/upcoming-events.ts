/**
 * upcoming-events.ts — "며칠에 무슨 일이 예정돼 있고, 어느 종목이 움직이나".
 *
 * 왜 필요한가. 실제로 개인 투자자는 네이버에 "12일", "13일"을 쳐서 그날 예정된 일을
 * 미리 챙긴다. 2026-08-10 대통령 메가프로젝트 민관합동 점검회의가 예고돼 있었고,
 * 다음 날 금호건설·동양파일이 상한가로 갔다 — **일정을 먼저 본 사람은 알 수 있었다.**
 *
 * 지금 "내일 종목"은 수급·기술 지표만 본다. 이벤트 축이 통째로 비어 있다.
 * 이 모듈이 그 축을 만든다: 뉴스에서 **날짜가 박힌 예정 이벤트**를 뽑아 종목과 잇는다.
 *
 * 구조는 기존 캘린더(실적·경제지표)와 같다 — 뉴스 수집 → Gemini 구조화 → DB 저장 → 조회.
 * 날짜 파싱·분류·중복 제거는 DB를 모르는 순수 함수로 빼서 테스트한다.
 */

import { GoogleGenAI } from "@google/genai";
import { pool } from "@workspace/db";
import { detectRegions, expandThemeKeywords, searchThemeStocks } from "./theme-search.js";

import {
  normalizeCategory, parseEventDate, todayKst, dedupeEvents,
  type UpcomingEvent, type EventCategory,
} from "./event-format.js";

export { normalizeCategory, parseEventDate, todayKst, dedupeEvents };
export type { UpcomingEvent, EventCategory };
export { EVENT_CATEGORIES } from "./event-format.js";

// ─── 뉴스 수집 ────────────────────────────────────────────────────────────────

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

/** 구글 뉴스 RSS 한 건 검색 → 제목 목록 */
async function searchNews(query: string, limit = 20): Promise<string[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) { console.warn(`[events] 뉴스 검색 실패 "${query}": HTTP ${res.status}`); return []; }
    const xml = await res.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const out: string[] = [];
    for (const item of items.slice(0, limit)) {
      const t = (item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/)?.[1]
        ?? item.match(/<title>([^<]+)<\/title>/)?.[1] ?? "").trim();
      const date = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1] ?? "";
      if (t) out.push(date ? `[${new Date(date).toISOString().slice(5, 10)}] ${t}` : t);
    }
    return out;
  } catch (e) {
    console.warn(`[events] 뉴스 검색 예외 "${query}":`, (e as Error)?.message?.slice(0, 60));
    return [];
  }
}

/**
 * 앞으로 며칠간의 일정을 담은 기사를 모은다.
 *
 * 사용자가 실제로 하는 방식 그대로 — 날짜를 직접 검색한다("8월 12일"). 거기에
 * 종류별 질의(임상·정책·수주)를 섞어 날짜가 안 박힌 예고 기사도 건진다.
 */
export async function collectEventNews(today: string, daysAhead = 7): Promise<string[]> {
  const base = new Date(`${today}T00:00:00Z`);
  const dateQueries: string[] = [];
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    dateQueries.push(`"${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일" 예정`);
  }
  // 주가를 움직이는 일정은 임상·정책만이 아니다. 기업의 신제품·수주, 정상급 인사의
  // 발표·순방, 산업 행사까지 넓게 훑는다 — 날짜가 정해진 재료는 미리 알 수 있어야 한다.
  const topicQueries = [
    // 기업 이벤트
    "임상 결과 발표 예정", "식약처 허가 심사 예정", "대규모 수주 계약 체결 예정",
    "신제품 공개 예정", "신차 출시 예정", "양산 시작 예정", "공장 착공 예정",
    "실적 발표 예정 상장사", "주주총회 예정", "기업설명회 IR 예정",
    "상장 예정 공모주", "인수합병 발표 예정",
    // 정부·정치 (기사보다 정책브리핑 원문이 앞선다 — 광주공항 이전이 그랬다)
    "site:korea.kr 정책브리핑 계획", "정부 국가산업단지 조성 계획 발표",
    "지역 인프라 투자 계획 발표", "메가프로젝트 점검회의",
    "대통령 회의 예정 산업", "장관 발표 예정", "국회 법안 처리 예정 산업",
    "규제 완화 시행 예정", "보조금 지원 발표 예정",
    // 해외·정상외교 (한국 증시에 즉시 반영된다)
    "트럼프 발표 예정", "미국 관세 발효 예정", "한미 정상회담 예정",
    "정상 방한 예정", "국빈 방문 일정", "수출 계약 서명식 예정",
    // 산업 행사·전시 (신기술 공개가 몰린다)
    "국제 전시회 개막 예정 반도체", "기술 컨퍼런스 개최 예정", "수주 입찰 결과 발표 예정",
    // 정책 회의체 — 날짜가 잡힌 회의는 그날 업종이 통째로 움직인다
    "관계장관회의 개최 예정", "위원회 첫 회의 개최", "민관 간담회 개최 예정",
  ];

  // ⚠️ 정책 질의에는 **업종 이름을 넣어야** 그 업종 정책이 잡힌다.
  //
  // "정부 정책 발표 예정"으로는 부동산 대책만 올라온다. 실제로 8/12 "국가바이오혁신위원회,
  // 바이오 투자 활성화 방안 논의"는 그 질의로 한 건도 안 걸렸는데, "바이오 투자 활성화
  // 방안"으로 치니 **1위로 나왔다.** 업종을 넣은 질의를 따로 돌린다.
  const SECTORS = ["바이오", "반도체", "이차전지", "방산", "조선", "원전", "AI", "로봇"];
  const sectorQueries = SECTORS.flatMap(s => [
    `${s} 투자 활성화 방안`,
    `${s} 육성 방안 발표`,
  ]);

  const all = await Promise.all(
    [...dateQueries, ...topicQueries, ...sectorQueries].map(q => searchNews(q, 10)),
  );
  const headlines = [...new Set(all.flat())];
  console.log(`[events] 뉴스 ${headlines.length}건 수집 (날짜 ${dateQueries.length} + 주제 ${topicQueries.length} + 업종정책 ${sectorQueries.length})`);
  return headlines;
}

// ─── Gemini 구조화 ────────────────────────────────────────────────────────────

function buildPrompt(headlines: string[], today: string, daysAhead: number): string {
  return `오늘은 ${today}(한국 시간)입니다. 아래는 최근 뉴스 헤드라인입니다.

여기서 **앞으로 ${daysAhead}일 안에 예정된 일정**만 골라 구조화하세요.
개인 투자자가 "며칠에 무슨 일이 있고, 어느 종목이 움직일까"를 미리 챙기려는 목적입니다.

[고를 것] — 주가와 이을 수 있으면 넓게 담으세요. 하루에 5~15건은 나와야 정상입니다.
- 기업: 신제품·신차 공개, 양산·가동 시작, 공장 착공·준공, 대형 계약·수주, 실적 발표,
  주주총회·IR, 상장(IPO)·보호예수 해제, 인수합병·분할
- 바이오: 임상 결과 발표, 허가 심사·승인, 학회 발표, 기술수출 계약
- 정부·정치: 대통령·장관 발표와 회의, 정책·법안 시행, 규제 완화, 보조금·예산 집행,
  국가산단·인프라 계획
- 해외·외교: 트럼프 등 정상급 발표, 관세 발효, 정상회담, 국빈 방한, 수출 계약 서명식
- 산업 행사: 국제 전시회·컨퍼런스 개막, 입찰 결과 발표
- 시장: 지수 편입·리밸런싱, 금리 결정, 주요 경제지표 발표

[제외할 것]
- 이미 지난 일 (과거형 서술)
- 날짜를 특정할 수 없는 것
- 특정 산업·종목과 연결되지 않는 일반 뉴스
- 사고·소송 등 부정적 이벤트만 있는 것 (투자자가 챙기려는 건 '재료'입니다)
- **한국 증시와 무관한 것** — 해외 소비재 신제품 출시, 지역 행사, 한국에 상장되지
  않았고 한국 종목과도 연결이 없는 해외 소형주 일정. 이 서비스 사용자는 한국 투자자입니다.
- ⛔ **지자체 생활 행정·지역 행사** — 공청회, 주민설명회, 축제·영화제·기념식, 공영주차장·
  할인 정책, 농산물 예약판매, 학사일정, 지역 공연. 상장사 매출을 움직이지 않습니다.
  이런 데에 농심·CJ ENM·강원랜드처럼 **억지로 종목을 붙이면 안 됩니다.**
- 판단 기준 하나: "이 일정 때문에 특정 상장사의 실적이나 수주가 달라지는가?"
  아니라면 담지 마세요. **적게 담는 편이 낫습니다.**

[date 필드 — 가장 중요]
헤드라인 앞의 [MM-DD]는 **기사가 나온 날**이지 일정 날짜가 아닙니다. 혼동하지 마세요.
본문이 "8월 13일 발표"라고 하면 date는 반드시 "2026-08-13"입니다. 요약에 적은 날짜와
date 필드가 **반드시 같아야** 합니다 — 다르면 사용자가 하루 전에 놓칩니다.

[importance — 반드시 구분해서 매기세요. 전부 2로 주면 쓸모가 없습니다]
- 3: 시장 전체·대형주가 움직임 (정부 대형 정책, 대표기업 실적·수주, 금리 결정)
- 2: 해당 섹터가 움직임 (업종 정책, 중형주 임상 결과, 지수 리밸런싱)
- 1: 참고 수준 (소형 이벤트, 간접 영향)

[중요] 종목은 **뉴스에 실제로 언급됐거나 그 산업의 대표 종목**만 적으세요.
억지로 채우지 말고, 확실하지 않으면 종목 대신 섹터만 적으세요. 지어내면 안 됩니다.

JSON 배열만 출력하세요(다른 텍스트 없이):
[
  {
    "date": "2026-08-12",
    "title": "간결한 일정 제목 (30자 이내)",
    "category": "임상·허가|정부·정책|계약·수주|실적|지수·수급|기타",
    "summary": "무슨 일인지 한 문장. 왜 주가에 영향을 주는지 포함",
    "sectors": ["건설", "인프라"],
    "tickers": [{ "name": "금호건설", "ticker": "002990", "why": "메가프로젝트 수혜 대표주" }],
    "importance": 3
  }
]
importance: 3=시장 전체가 주목, 2=해당 섹터 주목, 1=참고

[뉴스 헤드라인]
${headlines.slice(0, 320).join("\n")}`;
}

/** 헤드라인 묶음 → 구조화된 예정 이벤트. 실패하면 빈 배열(분석을 막지 않는다) */
export async function extractEvents(
  headlines: string[], today: string, daysAhead = 7,
): Promise<UpcomingEvent[]> {
  if (headlines.length === 0) { console.warn("[events] 헤드라인이 없어 추출 생략"); return []; }
  const key = process.env["GEMINI_API_KEY"];
  if (!key) { console.warn("[events] GEMINI_API_KEY 없음 — 추출 생략"); return []; }

  try {
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: buildPrompt(headlines, today, daysAhead) }] }],
      config: {
        // 사실 정리이므로 온도를 낮춘다. 지어내면 안 되는 작업이다.
        temperature: 0.15, maxOutputTokens: 16000,
        // gemini-2.5-flash는 기본으로 thinking 토큰을 쓰는데 그게 출력 예산을 먹어
        // JSON이 중간에 잘린다("Unterminated string"). 구조화 추출엔 사고가 필요 없다.
        thinkingConfig: { thinkingBudget: 0 },
        // 스키마를 주고 JSON으로 받는다. 자유 서술로 받으면 제목 안의 따옴표 하나에
        // 파싱이 통째로 실패한다 — 실제로 첫 실행이 그렇게 빈손이 됐다.
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: { type: "string" },
              title: { type: "string" },
              category: { type: "string" },
              summary: { type: "string" },
              sectors: { type: "array", items: { type: "string" } },
              tickers: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" }, ticker: { type: "string" }, why: { type: "string" },
                  },
                  required: ["name"],
                },
              },
              importance: { type: "integer" },
            },
            required: ["date", "title", "category"],
          },
        } as any,
      },
    });
    const text = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const json = text.startsWith("[") ? text : text.match(/\[[\s\S]*\]/)?.[0];
    if (!json) { console.warn(`[events] JSON 배열을 못 찾음 (응답 ${text.length}자)`); return []; }

    let raw: any[];
    try {
      raw = JSON.parse(json) as any[];
    } catch (parseErr) {
      // 잘린 응답이면 마지막 온전한 객체까지만 살린다 — 전부 버리는 것보다 낫다.
      const salvaged = json.slice(0, json.lastIndexOf("},") + 1) + "]";
      try {
        raw = JSON.parse(salvaged) as any[];
        console.warn(`[events] 응답이 잘려 ${raw.length}건만 복구 (원본 ${text.length}자)`);
      } catch {
        console.warn(`[events] JSON 파싱 실패 (${text.length}자):`, (parseErr as Error)?.message?.slice(0, 80));
        return [];
      }
    }
    const out: UpcomingEvent[] = [];
    for (const r of raw) {
      const date = parseEventDate(String(r?.date ?? ""), today, daysAhead + 3);
      const title = String(r?.title ?? "").trim();
      if (!date || title.length < 3) continue;   // 날짜·제목 없으면 쓸모없다
      out.push({
        eventDate: date,
        title: title.slice(0, 80),
        category: normalizeCategory(r?.category),
        summary: r?.summary ? String(r.summary).slice(0, 300) : null,
        tickers: Array.isArray(r?.tickers)
          ? r.tickers.filter((t: any) => t?.name).slice(0, 6).map((t: any) => ({
              ticker: t.ticker ? String(t.ticker).trim() : undefined,
              name: String(t.name).trim(),
              why: t.why ? String(t.why).slice(0, 80) : undefined,
            }))
          : [],
        sectors: Array.isArray(r?.sectors) ? r.sectors.map((x: any) => String(x)).slice(0, 4) : [],
        importance: [1, 2, 3].includes(Number(r?.importance)) ? Number(r.importance) : 2,
        source: "news",
      });
    }
    const deduped = dedupeEvents(out);
    console.log(`[events] 추출 ${raw.length}건 → 유효 ${out.length}건 → 중복제거 ${deduped.length}건`);
    return deduped;
  } catch (e) {
    console.warn("[events] Gemini 추출 실패:", (e as Error)?.message?.slice(0, 100));
    return [];
  }
}

// ─── 저장·조회 ────────────────────────────────────────────────────────────────

export async function saveEvents(events: UpcomingEvent[]): Promise<number> {
  let n = 0;
  for (const e of events) {
    try {
      await pool.query(
        `INSERT INTO upcoming_events (event_date, title, category, summary, tickers, sectors, importance, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (event_date, title) DO UPDATE SET
           summary = EXCLUDED.summary, tickers = EXCLUDED.tickers,
           sectors = EXCLUDED.sectors, importance = EXCLUDED.importance`,
        [e.eventDate, e.title, e.category, e.summary,
         JSON.stringify(e.tickers), JSON.stringify(e.sectors), e.importance, e.source],
      );
      n++;
    } catch (err) {
      console.warn(`[events] 저장 실패 "${e.title}":`, (err as Error)?.message?.slice(0, 60));
    }
  }
  return n;
}

/** 오늘부터 daysAhead일까지의 일정 (날짜 오름차순, 중요도 높은 순) */
export async function getUpcomingEvents(daysAhead = 7): Promise<UpcomingEvent[]> {
  const today = todayKst();
  const { rows } = await pool.query(
    `SELECT event_date, title, category, summary, tickers, sectors, importance, source
       FROM upcoming_events
      WHERE event_date >= $1::date AND event_date <= $1::date + $2::int
      ORDER BY event_date ASC, importance DESC`,
    [today, daysAhead],
  );
  // ⚠️ DATE 컬럼은 pg가 **로컬 자정** Date로 준다. toISOString()을 걸면 UTC로 되돌아가
  // 하루가 깎인다(8/11 00:00 KST → 8/10T15:00Z → "2026-08-10"). 로컬 연·월·일로 찍는다.
  const isoLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const list = rows.map((r: any) => ({
    eventDate: r.event_date instanceof Date ? isoLocal(r.event_date) : String(r.event_date).slice(0, 10),
    title: r.title,
    category: normalizeCategory(r.category),
    summary: r.summary,
    tickers: Array.isArray(r.tickers) ? r.tickers : [],
    sectors: Array.isArray(r.sectors) ? r.sectors : [],
    importance: Number(r.importance),
    source: r.source,
  }));

  // 조회할 때도 한 번 더 걸러낸다. DB 유니크는 (날짜, 제목 그대로)라서 "인제니아 코스닥
  // 상장"과 "인제니아, 코스닥 상장"이 각각 저장돼 있다 — 이미 쌓인 행은 지울 수 없으니
  // 읽을 때 합친다.
  return dedupeEvents(list);
}

/** 수집 → 추출 → 저장 한 번에. 스케줄러·수동 실행 공통 진입점. */
/**
 * 지역이 걸린 일정에 **사업보고서 기반 관련주**를 더 붙인다.
 *
 * Gemini는 기사에 이름이 나온 종목만 안다. "광주 반도체 클러스터" 같은 계획에서
 * 정작 움직이는 건 그 지역에 공장이 있는 건설·건자재 회사들인데, 기사에는 안 나온다.
 * 그건 공시가 알고 있다 — theme-search가 지역 근접 매칭으로 찾아준다.
 *
 * Gemini 호출이 붙으므로 **지역이 잡힌 일정에만**, 한 번에 3건까지만 한다.
 */
async function enrichRegionalEvents(events: UpcomingEvent[]): Promise<void> {
  const targets = events
    .filter(e => detectRegions(`${e.title} ${e.summary ?? ""}`).length > 0)
    .slice(0, 3);
  if (targets.length === 0) return;

  for (const e of targets) {
    try {
      const text = `${e.title} ${e.summary ?? ""}`;
      const regions = detectRegions(text);
      const kws = await expandThemeKeywords(e.title);
      const hits = await searchThemeStocks(kws, 8, regions);
      // 그 지역에 시설이 있다고 적어놓은 회사만 — 단순히 말이 겹친 건 재료가 아니다.
      const picked = hits.filter(h => h.regionMatch && h.name).slice(0, 4);
      if (picked.length === 0) continue;

      const known = new Set(e.tickers.map(t => t.ticker ?? t.name));
      for (const h of picked) {
        if (known.has(h.ticker) || known.has(h.name!)) continue;
        e.tickers.push({
          ticker: h.ticker, name: h.name!,
          why: `${regions[0]} 인근 생산시설 (사업보고서)`,
        });
      }
      console.log(`[events] "${e.title.slice(0, 20)}" 지역 관련주 ${picked.length}개 추가`);
    } catch (err) {
      console.warn("[events] 지역 관련주 확장 실패:", (err as Error)?.message?.slice(0, 60));
    }
  }
}

export async function refreshUpcomingEvents(daysAhead = 7): Promise<number> {
  const today = todayKst();
  const headlines = await collectEventNews(today, daysAhead);
  const events = await extractEvents(headlines, today, daysAhead);
  if (events.length === 0) { console.warn("[events] 추출된 일정이 없다 — 저장 생략"); return 0; }

  // 지역 산업 계획은 이 기능이 가장 잘 하는 일이다 — "8월 10일 광주 반도체 클러스터"
  // 하나로 그 지역 건설·건자재 기업이 부각될 걸 미리 잡을 수 있다. 그런데 Gemini는
  // 기사에 이름이 나온 한두 종목만 붙인다. **그 지역에 실제로 공장이 있는 회사**는
  // 사업보고서가 알고 있으므로, 지역이 걸린 일정에는 공시로 관련주를 더 찾아 붙인다.
  await enrichRegionalEvents(events);

  // 이 기간은 **매번 새로 쓴다**. 안 그러면 예전 실행에서 들어온 잡음이 계속 남는다 —
  // 걸러내는 규칙을 고쳐도 이미 저장된 "고흥군 햅쌀 예약판매" 같은 행이 그대로 보였다.
  // 새로 뽑은 것이 있을 때만 지우므로, 수집이 실패한 날 화면이 비지는 않는다.
  await pool.query(
    `DELETE FROM upcoming_events WHERE event_date >= $1::date AND event_date <= $1::date + $2::int`,
    [today, daysAhead],
  ).catch(e => console.warn("[events] 기존 기간 정리 실패:", (e as Error)?.message?.slice(0, 60)));

  const saved = await saveEvents(events);
  console.log(`[events] ${saved}건 저장 완료 (${today} ~ +${daysAhead}일)`);
  return saved;
}
