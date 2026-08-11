/**
 * event-format.ts — 다가오는 일정의 **순수 판정 로직**. DB·네트워크를 모른다.
 *
 * 날짜를 잘못 읽으면 지난 일이 "내일 일정"으로 뜬다 — 이 기능에서 가장 치명적인
 * 오류라 따로 떼어 테스트한다(peer-format·input-format과 같은 이유).
 */

export const EVENT_CATEGORIES = [
  "임상·허가", "정부·정책", "계약·수주", "실적", "지수·수급", "기타",
] as const;
export type EventCategory = typeof EVENT_CATEGORIES[number];

/** Gemini가 뭐라 적든 우리 분류 중 하나로 맞춘다. 못 맞추면 "기타" */
export function normalizeCategory(raw: unknown): EventCategory {
  const s = String(raw ?? "").trim();
  if (EVENT_CATEGORIES.includes(s as EventCategory)) return s as EventCategory;
  if (/임상|허가|승인|FDA|식약처|학회/.test(s)) return "임상·허가";
  if (/정부|정책|국회|대통령|부처|규제|예산/.test(s)) return "정부·정책";
  if (/계약|수주|납품|공급|MOU|협약/.test(s)) return "계약·수주";
  if (/실적|공시|컨콜|어닝/.test(s)) return "실적";
  if (/지수|편입|리밸런싱|MSCI|공모|상장|수급/.test(s)) return "지수·수급";
  return "기타";
}

/** 오늘(KST) 기준 ISO 날짜 문자열 */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * "8월 12일" · "12일" · "2026-08-12" 같은 표기를 ISO 날짜로 바꾼다.
 *
 * 일(日)만 있는 표기는 **가장 가까운 미래**로 해석한다 — 뉴스가 "12일 회의"라고 쓸 때
 * 그건 지난 12일이 아니라 다가올 12일이다. 월이 넘어가면 다음 달로 넘긴다.
 * 범위(today ~ today+maxAhead) 밖이면 null — 엉뚱한 과거·먼 미래를 걸러낸다.
 */
export function parseEventDate(raw: string, today: string, maxAheadDays = 30): string | null {
  const s = String(raw ?? "").trim();
  const base = new Date(`${today}T00:00:00Z`);
  const inRange = (d: Date): string | null => {
    const iso = d.toISOString().slice(0, 10);
    const diff = (d.getTime() - base.getTime()) / 86400000;
    return diff >= 0 && diff <= maxAheadDays ? iso : null;
  };

  const iso = s.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (iso) return inRange(new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])));

  const md = s.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const y = base.getUTCFullYear();
    const cand = new Date(Date.UTC(y, +md[1] - 1, +md[2]));
    // 연말·연초 경계: 1월 일정이 12월에 보도되면 다음 해다
    if (cand.getTime() < base.getTime() - 86400000 * 3) cand.setUTCFullYear(y + 1);
    return inRange(cand);
  }

  const dOnly = s.match(/^(\d{1,2})\s*일$/);
  if (dOnly) {
    const day = +dOnly[1];
    for (const addMonth of [0, 1]) {
      const c = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + addMonth, day));
      const hit = inRange(c);
      if (hit) return hit;
    }
  }
  return null;
}

export interface UpcomingEvent {
  eventDate: string;
  title: string;
  category: EventCategory;
  summary: string | null;
  tickers: Array<{ ticker?: string; name: string; why?: string }>;
  sectors: string[];
  importance: number;
  source: string | null;
}

/** 같은 날 같은 일을 여러 기사가 다르게 쓴다. 날짜+제목 앞부분으로 하나만 남긴다. */
export function dedupeEvents(events: UpcomingEvent[]): UpcomingEvent[] {
  const seen = new Map<string, UpcomingEvent>();
  for (const e of events) {
    const key = `${e.eventDate}|${e.title.replace(/\s/g, "").slice(0, 18)}`;
    const prev = seen.get(key);
    // 같은 이벤트면 종목이 더 많이 붙은 쪽을 남긴다(정보량이 많은 것)
    if (!prev || e.tickers.length > prev.tickers.length) seen.set(key, e);
  }
  return [...seen.values()].sort(
    (a, b) => a.eventDate.localeCompare(b.eventDate) || b.importance - a.importance,
  );
}

