/**
 * 타임라인 사건이 **실제 기사에 근거하는지** 서버가 검산한다.
 *
 * 프롬프트는 "제공된 기사를 최우선 반영, 그 외 Gemini 학습 데이터로 보완"이라고
 * 적혀 있었다. 지어내도 된다고 허락한 것이다. 그 결과 리센느 타임라인에
 * 실재하지 않는 연도·수상명·매출 증가율이 나왔다. 연도 하나가 틀리면 나머지도
 * 못 믿는다 — 타임라인은 날짜가 전부인 화면이다.
 *
 * 프롬프트로는 못 막는다(이 저장소에서 여러 번 확인했다). 서버가 센다.
 * 순수 함수라 DB 없이 테스트한다.
 */

export interface VerifiableEvent {
  date: string;        // "YYYY-MM-DD" | "YYYY-MM" | "YYYY"
  event: string;
}

export interface VerifyResult<T> {
  kept: T[];
  /** 왜 뺐는지 — 조용히 사라지면 고칠 수 없다 */
  dropped: Array<{ event: string; date: string; why: string }>;
}

/** "2026-08-27" → 정밀도와 함께 파싱. 형식이 아니면 null */
function parseDate(raw: string): { y: number; m: number | null; d: number | null } | null {
  const s = String(raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { y: +m[1]!, m: +m[2]!, d: +m[3]! };
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return { y: +m[1]!, m: +m[2]!, d: null };
  m = s.match(/^(\d{4})$/);
  if (m) return { y: +m[1]!, m: null, d: null };
  return null;
}

/**
 * 기사 날짜 목록에 비추어 사건을 거른다.
 *
 * - 형식이 아닌 날짜 → 뺀다
 * - 오늘보다 미래 → 뺀다 (아직 안 일어난 일이다)
 * - 뒷받침하는 기사가 없는 날짜 → 뺀다
 *
 * 날짜 정밀도가 낮으면(연·월) 그 범위 안에 기사가 하나라도 있으면 통과시킨다.
 */
export function verifyTimeline<T extends VerifiableEvent>(
  events: T[],
  articleDates: string[],
  today: string,
): VerifyResult<T> {
  const arts = articleDates
    .map(parseDate)
    .filter((x): x is { y: number; m: number | null; d: number | null } => x != null && x.m != null && x.d != null);

  const now = parseDate(today);
  const kept: T[] = [];
  const dropped: VerifyResult<T>["dropped"] = [];

  for (const ev of events) {
    const p = parseDate(ev.date);
    if (!p) { dropped.push({ event: ev.event, date: String(ev.date), why: "날짜 형식 아님" }); continue; }

    if (now) {
      const future = p.y > now.y
        || (p.y === now.y && p.m != null && now.m != null && p.m > now.m)
        || (p.y === now.y && p.m === now.m && p.d != null && now.d != null && p.d > now.d);
      if (future) { dropped.push({ event: ev.event, date: ev.date, why: "미래 날짜" }); continue; }
    }

    // 기사가 하나도 없으면 검산할 근거가 없다 — 통째로 못 믿으므로 전부 뺀다.
    if (arts.length === 0) { dropped.push({ event: ev.event, date: ev.date, why: "근거 기사 없음" }); continue; }

    const backed = arts.some(a =>
      a.y === p.y
      && (p.m == null || a.m === p.m)
      && (p.d == null || a.d === p.d),
    );
    if (!backed) { dropped.push({ event: ev.event, date: ev.date, why: "그 날짜의 기사가 없음" }); continue; }

    kept.push(ev);
  }

  return { kept, dropped };
}
