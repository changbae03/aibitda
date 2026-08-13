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
  // 날짜 질의("8월 15일" …)가 끌어온 생활·행정 잡음 — 실측으로 확인한 것들
  /민방위|대피\s*훈련|공습\s*대비/,
  /주택\s*추첨|온라인\s*추첨|사회주택|아파트\s*추첨/,   // ⚠️ 공모주 "청약 접수"는 진짜 재료다 — 주택 맥락으로만 막는다
  /감독\s*선거|선거권자|총회\s*선거|교단|노회/,
  /없는\s*날|창립\s*기념일|기념\s*음악회/,
  /평가전|원정|프로야구|리그\s*경기|선수\s*등록/,
  // 대회·공연·소비자 박람회 — 날짜 질의가 "개막"으로 끌어온 것들(실측)
  /대회\s*(개막|개최)|왕중왕전|씨름|육상|사이클|파크골프|마스터즈/,
  /뮤지컬|음악회|오페라|발레|미술관|박물관/,
  /베이비페어|웨딩\s*박람회|주류\s*박람회|견본주택|모델하우스/,
  /진료\s*시작|개원|학술대회/,
];

/**
 * 증시와 무관한 **매체**는 제목을 보기 전에 끊는다.
 *
 * 날짜로 훑는 질의("8월 15일" 예정)는 그날 일정이 적힌 모든 기사를 끌어온다.
 * 실측(2026-08-15): 아이돌 방송 안내(Weverse)·굿즈 발매·파리 전시(Sortir à Paris),
 * 그리고 **Vietnam.vn의 하띤 사회주택 추첨**이 그대로 일정으로 올라왔다.
 * 제목만으로 이걸 다 잡으려면 규칙이 끝없이 늘어난다 — 출처가 훨씬 정확하다.
 *
 * ⚠️ 여기에 종합지·경제지를 넣지 말 것. 같은 매체가 증시 기사도 쓴다.
 * 막는 것은 **다른 나라 지역 소식·팬 플랫폼·분야 전문지**뿐이다.
 */
const OFF_MARKET_SOURCES = [
  // 해외 지역 소식(한국어판) — 그 나라 행정·생활 일정이 그대로 올라온다
  "vietnam.vn", "insidevina", "sortiraparis", "sortir à paris",
  // 팬·커머스 플랫폼
  "weverse", "animate", "asiaartistawards", "haveagood-holiday",
  // 분야 전문지 — 증시 일정과 겹치지 않는다
  "olympics.com", "스포츠조선", "현대불교", "크리스천투데이", "법보신문",
];

/** 이 매체의 기사를 일정 후보로 쓸 것인가 */
export function isMarketRelevantSource(source: string): boolean {
  const s = String(source ?? "").toLowerCase();
  if (!s) return true;   // 출처를 못 읽었으면 막지 않는다(제목 필터가 받는다)
  return !OFF_MARKET_SOURCES.some(b => s.includes(b.toLowerCase()));
}

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
/**
 * **지금 벌어지고 있는 재료**인가 — 날짜가 아니라 사람이 와 있는 것 자체가 재료인 경우.
 *
 * 날짜 검산기는 근거에 일(日) 숫자가 없으면 버린다. 그게 옳은 경우가 대부분이지만,
 * 2026-08-13 "빌 게이츠, 소형모듈원전 협력 논의차 방한"이 그렇게 통째로 버려졌다.
 * 이런 기사에는 날짜가 안 적힌다 — 이미 와 있고, 협력 논의는 그 다음 날들에 이어진다.
 * 그날 원전·전력기기가 함께 움직이므로 미리 알아야 하는 종류다.
 *
 * ⚠️ 넓히지 말 것. "오늘로 찍힌 것을 받아준다"는 예외는 예전에 **이미 지난 회의**가
 * 오늘 일정으로 올라오게 만들었다(8/10에 열린 점검회의가 8/13에 떴다).
 * 사람이 와 있는 동안 재료가 이어지는 방문류로만 좁힌다.
 */
export function isOngoingVisit(text: string): boolean {
  const t = String(text ?? "");
  return /방한|내한|입국|순방|정상회담|국빈\s*방문/.test(t);
}

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
