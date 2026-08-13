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
/**
 * 주가와 무관한 지역·생활 행사를 걸러낸다.
 *
 * 프롬프트로 "지자체 행사는 빼라"고 해도 샌다 — "속초 대포항 야간공연 '대포야 사랑해'"에
 * 강원랜드를 붙여 내보냈다. 지시는 확률이고 규칙은 확정이라, **코드로 막는다.**
 *
 * 판정은 제목만 본다. 상장사 실적·수주를 움직이지 않는 종류의 말들이다.
 */
const CIVIC_NOISE = [
  /공연|콘서트|축제|영화제|페스티벌|불꽃놀이|야시장|플리마켓/,
  /기념식|경축식|추모|예배|미사|법회/,
  /공청회|주민설명회|간담회 개최|위원회 구성/,
  /예약\s*판매|직거래|장터|할인\s*행사|반값/,
  /등교|개학|입학|졸업식|학사일정/,
  /주차장|쓰레기|재활용|민원|복지관|도서관|체육대회/,
  /관광\s*(활성화|주간)|둘레길|트레킹/,
  // 실측으로 새어나온 것들 — 지방의회 의사일정·기념일·지역 토론회
  /조례(안)?|의회\s*(본회의|임시회|정례회)|시의회|군의회|구의회|도의회/,
  // ⚠️ 한글에는 \b(단어 경계)가 안 먹는다 — "검은 개의 날"이 그대로 통과했다.
  // 따옴표로 묶인 행사명 + "의 날/주간" 꼴을 직접 잡는다.
  /['"’”][^'"’”]{0,20}의\s*날['"’”]?|의\s*날\s*(행사|개최|기념)|주간\s*(선포|행사)|캠페인/,
  /유치\s*(전략|추진|위원회)|토론회|포럼 개최|세미나 개최/,
  /봉사|헌혈|나눔|성금|장학금|축하금|지원금 지급/,
];

/** 이 일정이 상장사 주가와 이어질 만한가. 아니면 담지 않는다. */
export function isMarketRelevant(title: string): boolean {
  const t = String(title ?? "");
  return !CIVIC_NOISE.some(re => re.test(t));
}

export function dedupeEvents(events: UpcomingEvent[]): UpcomingEvent[] {
  const seen = new Map<string, UpcomingEvent>();
  for (const e of events) {
    if (!isMarketRelevant(e.title)) continue;   // 지역·생활 행사는 여기서 끊는다
    // 공백만 지우면 "인제니아 코스닥 상장"과 "인제니아, 코스닥 상장"이 다른 것으로 남는다.
    // 쉼표·따옴표·괄호 같은 문장부호까지 걷어내야 같은 일정이 하나로 모인다.
    const key = `${e.eventDate}|${e.title.replace(/[\s,·'"“”‘’()\[\]-]/g, "").slice(0, 16)}`;
    const prev = seen.get(key);
    // 같은 이벤트면 종목이 더 많이 붙은 쪽을 남긴다(정보량이 많은 것)
    if (!prev || e.tickers.length > prev.tickers.length) seen.set(key, e);
  }
  return [...seen.values()].sort(
    (a, b) => a.eventDate.localeCompare(b.eventDate) || b.importance - a.importance,
  );
}


/**
 * 일정 날짜가 **근거 문구와 맞는가.** 안 맞으면 그 일정은 버린다.
 *
 * LLM은 날짜를 모를 때 오늘로 찍는다. 실제로 8월 10일에 **이미 열린** 민관합동
 * 점검회의가 8월 13일 일정으로 들어왔고, 사용자가 "3일 전에 했던 이벤트"라고 알려줬다.
 * 프롬프트로 "혼동하지 마세요"라고 이미 적어뒀지만 지시는 확률이다 — 서버가 센다.
 * (이 저장소가 조율·SOTP를 서버에서 검산하는 것과 같은 이유다)
 *
 * 받아주는 것: 근거에 그 날의 **일(日)** 숫자가 있는 경우, 또는 오늘·내일처럼
 * 상대 표현인 경우. 근거가 비었으면 통과시키지 않는다.
 */
export function dateEvidenceSupports(eventDate: string, evidence: string): boolean {
  const ev = String(evidence ?? "").trim();
  if (ev.length < 2) return false;
  // "오는 19일", "이달 20일", "8/19", "8월 19일" — 숫자만 모아서 본다
  const day = Number(eventDate.slice(8, 10));
  if (!Number.isFinite(day)) return false;
  const nums = (ev.match(/\d{1,2}/g) ?? []).map(Number);
  if (nums.includes(day)) return true;
  // 상대 표현은 숫자가 없다. 이건 근거로 인정한다.
  return /오늘|내일|모레|금일|익일|이번\s*주|다음\s*주|주말|당일/.test(ev);
}
