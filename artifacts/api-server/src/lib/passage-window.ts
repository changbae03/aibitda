/**
 * 사업보고서 원문을 **읽을 수 있는 형태**로 손질한다.
 *
 * 예전에는 검색어가 걸린 문장 하나만 잘라 보여줬다. "전력변환기기 산업은 전기기기
 * 산업에 속하며…" 한 줄만 나오니, 그 회사가 그 사업으로 무엇을 하는지는 알 수 없었다.
 * 앞뒤를 조금 더 붙이는 것으로는 부족하다 — 어디까지 붙일지 서버가 정하는 순간
 * 누군가에겐 늘 모자란다. **문서를 통째로 주고 사람이 스크롤하게 한다.**
 * (종목당 원문은 1만 자 안팎이라 그래도 된다.)
 *
 * 손질이 필요한 이유는 원문이 줄 단위이고 그 사이에 이미지 파일명
 * (`emb00001cd420ed.jpg`)·그림 캡션·표 셀이 한 줄씩 끼어 있기 때문이다.
 * 실제로 서전기전에서 "뒤 문맥"으로 이미지 파일명이 나왔다.
 *
 * 순수 함수라 DB 없이 테스트한다.
 */

export interface DocLine {
  text: string;
  /** 절 제목인가(`### [사업개요]`), 본문인가 */
  kind: "section" | "text";
  /** 이 줄에서 걸린 검색어들 — 화면이 여기를 표시하고 찾아간다 */
  hits: string[];
}

/** `### [사업개요]` 같은 절 표시면 그 이름을, 아니면 null */
export function sectionOf(line: string): string | null {
  const m = line.match(/^#{1,6}\s*\[([^\]]+)\]/);
  return m ? m[1]!.trim() : null;
}

/**
 * 사람이 읽을 만한 줄인가.
 *
 * 표 셀("25.8%", "5,028"), 이미지 파일명, 그림 캡션, 단위 표기처럼
 * 문맥으로 아무것도 알려주지 못하는 줄을 걸러낸다.
 */
export function isProseLine(line: string): boolean {
  const s = line.trim();
  if (s.length < 20) return false;                            // 표 셀·캡션·소제목
  if (/^#{1,6}\s/.test(s)) return false;                      // 절 표시(따로 다룬다)
  if (/\.(jpg|jpeg|png|gif|bmp)\s*$/i.test(s)) return false;  // 이미지 파일명
  if (!/[가-힣]/.test(s)) return false;                       // 한글이 없으면 표·코드 조각
  if (/^\(?(기준일|단위)\s*[::]/.test(s)) return false;        // "(기준일 : 2026년 …)"
  // 숫자·기호가 대부분이면 표가 줄로 풀린 것이다
  const hangul = (s.match(/[가-힣]/g) ?? []).length;
  return hangul / s.length >= 0.25;
}

/**
 * 원문을 화면에서 스크롤할 수 있는 줄 목록으로 바꾸고, 검색어가 걸린 줄을 표시한다.
 *
 * 걸린 줄은 `isProseLine`을 통과하지 못해도 **버리지 않는다** — 사용자가 찾던 그
 * 대목이기 때문이다(짧은 항목명에 걸리는 경우가 있다).
 */
export function buildReadableDoc(doc: string, keywords: string[]): DocLine[] {
  const kws = keywords.filter(k => k.trim().length >= 2).map(k => k.trim());
  const out: DocLine[] = [];

  for (const raw of doc.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    const hits = kws.filter(k => line.toLowerCase().includes(k.toLowerCase()));
    const section = sectionOf(line);

    if (section) { out.push({ text: section, kind: "section", hits: [] }); continue; }
    if (hits.length === 0 && !isProseLine(line)) continue;

    out.push({ text: line, kind: "text", hits });
  }

  // 표만 있던 절은 제목만 남는다 — 바로 아래에 본문이 없으면 지운다.
  return out.filter((l, i) => l.kind === "text" || out[i + 1]?.kind === "text");
}
