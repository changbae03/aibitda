/**
 * biz-timeline-analyze.ts — 연도별 사업보고서를 나란히 놓고 "무엇이 달라졌나"를 쓴다.
 *
 * 목표주가·실적 전망과 결정적으로 다른 점: **예측을 하지 않는다.**
 * 모든 문장이 공시 원문에 근거해야 하고, 근거를 못 대면 쓰지 않는다.
 * 그래서 틀릴 수가 없고, 반박하려면 원문으로 해야 한다.
 *
 * 비교 축을 코드가 정한다. 정하지 않고 맡기면 회사마다 실행마다 다른 것을 말한다 —
 * 이 저장소에서 밸류에이션이 흔들린 이유가 정확히 그것이었다.
 */

import { ai, geminiSemaphore } from "./analysis/gemini.js";
import { getBizTimeline, type BizReportYear } from "./biz-timeline.js";

/**
 * 비교 축. 순서가 곧 보고서 목차다.
 *
 * 전부 "무엇이 바뀌었나"를 묻는다. "좋은가 나쁜가"를 묻지 않는 것이 중요하다 —
 * 평가를 시키면 근거 없는 형용사가 나오고, 변화를 물으면 원문을 찾아온다.
 */
const AXES = `
① 사업 구성의 이동
   부문별·제품별 매출 비중이 연도별로 어떻게 변했나. 표로 정리하되 **원문에 있는 숫자만** 쓸 것.
   비중이 안 나와 있으면 "공시에 비중 미기재"라고 적고 넘어갈 것.

② 새로 등장한 것 / 사라진 것
   작년 보고서엔 없던 제품·사업·계약·법인이 올해 생겼나. 반대로 언급이 끊긴 것은?
   각 항목에 **처음 등장한 연도**를 붙일 것. 이게 이 분석의 핵심이다.

③ 매출처·고객 집중도
   주요 매출처 수와 비중이 어떻게 변했나. 집중도가 오르면 위험, 내리면 분산이다.
   원문에 매출처가 익명("A사")으로만 나오면 그대로 쓸 것.

④ 투자의 방향
   연구개발비·설비투자가 어느 부문에 몰리나. **회사가 말이 아니라 돈으로 무엇에 베팅하는지**를 본다.
   연구개발 과제명이 연도별로 어떻게 바뀌었는지도 볼 것.

⑤ 회사가 스스로를 설명하는 방식의 변화
   "사업의 개요"나 "회사의 현황" 서술이 연도별로 어떻게 달라졌나.
   강조점이 옮겨가거나 표현이 조심스러워지면 그 자체가 신호다. 원문을 짧게 인용할 것.

⑥ 그래서 이 회사는 지금 어느 단계인가
   위 ①~⑤를 근거로 하나만 고를 것 — 확장기 / 전환기 / 성숙기 / 정체기 / 재편기.
   반드시 **①~⑤ 중 어느 근거로 그렇게 봤는지** 번호를 달아 밝힐 것.
`;

const RULES = `
[지켜야 할 것]
· 이 문서는 **예측이 아니라 서술**이다. 목표주가·투자의견·매수매도 판단을 쓰지 말 것.
· 앞으로 어떻게 될지 전망하지 말 것. "~할 것으로 보인다"는 금지. 무엇이 바뀌었는지만 쓴다.
· 모든 문장은 아래 원문에 근거해야 한다. **원문에 없는 숫자·사실을 지어내지 말 것.**
· 근거가 부족하면 "공시에서 확인되지 않음"이라고 적을 것. 추측으로 메우지 말 것.
· 연도를 반드시 명시할 것 — "매출이 늘었다"가 아니라 "2023년 X억 → 2025년 Y억".
· 표현은 담백하게. 감탄사·형용사 남발 금지.
`;

export interface TimelineReport {
  ticker: string;
  companyName: string;
  years: number[];
  content: string;
}

/**
 * 연도별 원문을 프롬프트로 조립한다.
 *
 * 오래된 해부터 넣는다 — LLM이 시간 순으로 읽어야 변화를 잡는다.
 */
function buildPrompt(companyName: string, timeline: BizReportYear[]): string {
  const body = timeline
    .map(y => `\n═══════════ ${y.bsnsYear}년 사업보고서 ═══════════\n${y.content}`)
    .join("\n");

  const span = `${timeline[0].bsnsYear}~${timeline[timeline.length - 1].bsnsYear}`;

  return `당신은 기업 공시를 오래 읽어온 애널리스트입니다.
${companyName}의 사업보고서 ${timeline.length}개년(${span})을 나란히 놓고,
**이 회사가 어디에서 어디로 옮겨가고 있는지**를 정리하세요.

${RULES}

[정리할 축 — 이 순서대로, 이 번호를 제목으로]
${AXES}

[원문 — 오래된 해부터]
${body}

이제 위 ①~⑥ 순서로 작성하세요. 각 항목은 3~6문장 또는 표 하나로 짧게.
마지막에 "한 줄 요약"을 붙이되, 그것도 서술이어야 합니다(전망 금지).`;
}

/**
 * 사업 흐름 분석을 생성한다. 최소 2개년이 있어야 비교가 성립한다.
 */
export async function analyzeBizTimeline(
  ticker: string,
  companyName: string,
): Promise<TimelineReport | null> {
  const timeline = await getBizTimeline(ticker);
  if (timeline.length < 2) {
    console.warn(`[biz-timeline] ${ticker} 비교할 연도가 ${timeline.length}개뿐 — 분석 생략`);
    return null;
  }

  const prompt = buildPrompt(companyName, timeline);
  console.log(`[biz-timeline] ${ticker} 분석 시작 — ${timeline.length}개년, 프롬프트 ${(prompt.length / 1000).toFixed(0)}k자`);

  await geminiSemaphore.acquire();
  try {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      // 사실 서술이므로 온도를 낮춘다. 창의적일 필요가 없다.
      config: { temperature: 0.2, maxOutputTokens: 8000 },
    });
    const content = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    if (content.length < 200) {
      console.warn(`[biz-timeline] ${ticker} 응답이 너무 짧다 (${content.length}자)`);
      return null;
    }
    return {
      ticker, companyName,
      years: timeline.map(t => t.bsnsYear),
      content,
    };
  } finally {
    geminiSemaphore.release();
  }
}
