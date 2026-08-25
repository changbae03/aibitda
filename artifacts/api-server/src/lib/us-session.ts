/**
 * 미국 브리핑의 세션 설명과 시제 규칙 — 순수 함수라 DB 없이 테스트할 수 있다.
 *
 * 프롬프트 안에 삼항 연쇄로 박아뒀더니 `us_midday`가 빠져 **장중 2차(KST 02~05시)가
 * "주말 휴장"으로** 설명됐다. 기본값으로 조용히 떨어지는 종류라 아무도 몰랐다.
 * 세션을 늘릴 때 여기 한 곳만 고치면 되고, 빠뜨리면 테스트가 잡는다.
 */
export type UsSession =
  | "us_premarket" | "us_open" | "us_midday"
  | "us_afterhours" | "us_overnight" | "us_weekend";

export const US_SESSIONS: UsSession[] = [
  "us_premarket", "us_open", "us_midday", "us_afterhours", "us_overnight", "us_weekend",
];

const DESC: Record<UsSession, string> = {
  us_premarket:  "미국 증시 개장 전 (프리마켓)",
  us_open:       "미국 증시 정규 거래 시간 (개장 1시간 경과, 마감까지 5시간 남음)",
  us_midday:     "미국 증시 정규 거래 시간 (마감까지 3시간 남음)",
  us_afterhours: "미국 증시 장 마감 후 (애프터마켓)",
  us_overnight:  "미국 증시 휴장 중 (한국 낮 시간)",
  us_weekend:    "미국 증시 주말 휴장",
};

/** 지금 장이 도는 중인가 — 프리마켓 포함(아직 하루가 안 끝났다는 뜻) */
export function isUsSessionInProgress(session: string): boolean {
  return session === "us_premarket" || session === "us_open" || session === "us_midday";
}

export function describeUsSession(session: string): string {
  return DESC[session as UsSession] ?? DESC.us_weekend;
}

/**
 * 문장의 시제를 지키는 규칙.
 *
 * 장중 1차 브리핑에 "관망세가 짙었던 하루였어요"가 나왔다. 한창 거래 중인데 하루를
 * 정산한 말투다. 지표는 실시간 값인데 문장만 마감 뒤로 쓰이면, 읽는 사람은 이미 끝난
 * 장을 복기하는 글로 받아들인다.
 */
export function usTenseRule(session: string): string {
  return isUsSessionInProgress(session)
    ? `\n⏱️ 시제 — 지금은 **장이 돌아가는 중**입니다. **모든 문장을 진행형으로** 쓰세요.

이것이 이 브리핑에서 가장 중요한 규칙입니다. 과거형으로 쓰면 이미 끝난 장을 복기하는
글이 되어, 지금 시장을 보고 있는 독자에게 쓸모가 없어집니다.

문장 끝을 이렇게 바꾸세요:
- "나스닥 상승을 주도했고" → "나스닥 상승을 **주도하고 있고**"
- "강세를 보였어요" → "강세를 **보이고 있어요**"
- "긍정적인 기대감을 불어넣었기 때문입니다" → "**불어넣고 있기** 때문입니다"
- "2.5% 상승하며" → "2.5% **오르는 중이며**" / "현재 2.5% 올라 있고"
- "관망세가 짙었던 하루였어요" → "관망세가 짙게 이어지고 있어요"

절대 금지: "~한 하루였어요", "마감했어요", "끝났어요", "하루를 마무리했어요",
"오늘 장은 ~였습니다" — 아직 하루가 끝나지 않았습니다.

즐겨 쓸 말: "지금까지", "현재", "~하는 중", "~고 있어요", "이 흐름이 이어진다면",
"남은 시간 동안", "장 후반 관건은".

수치는 **확정치가 아니라 현재가**입니다. "마감가"·"종가"라고 부르지 마세요.
아직 안 나온 것(마감 지수, 종가 기준 순매수)을 있는 것처럼 쓰지 마세요.`
    : `\n⏱️ 시제 — 장이 끝난 뒤입니다. 확정된 수치로 하루를 정리해 쓰세요.`;
}
