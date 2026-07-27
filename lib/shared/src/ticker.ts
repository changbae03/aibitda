// ─── 종목 티커 표준화 ─────────────────────────────────────────────────────────
//
// 원칙: 저장은 항상 표준형 하나로, 변환은 외부 API를 부르는 경계에서만.
//
//   표준형  한국 `005930` (6자리, 접미사 없음) / 미국 `NVDA` (대문자)
//   시장    별도로 들고 다닌다 (컬럼·인자). 티커 문자열에 섞지 않는다.
//
// 이 규칙이 없어서 ticker_metric_cache는 `005930.KS`로, analyses는 `005930`으로
// 저장돼 캐시 적중률이 0%였다. DB에 넣기 전·조회 키로 쓰기 전에 반드시 통과시킬 것.

export type Market = "KR" | "US";

/** 한국거래소 시장 구분. 야후 심볼 접미사가 달라진다. */
export type KrExchange = "KOSPI" | "KOSDAQ";

/**
 * 한국 종목코드: 6자리이고 **숫자로 시작**한다.
 *
 * 예전에는 `/^\d{6}$/`(6자리 전부 숫자)였다. 그런데 KRX가 신규상장·스팩에
 * `0004Y0`·`0126Z0`처럼 영문이 섞인 코드를 발급하기 시작했고, 그런 종목 55개가
 * 전부 "한국이 아님"으로 판정돼 KIS·DART 조회가 통째로 막혀 있었다.
 *
 * 첫 글자를 숫자로 못박는 이유는 미국 티커와 겹치지 않게 하기 위해서다. 실제 데이터로
 * 확인했다 — 미국 10,448종목 중 숫자로 시작하는 티커는 0개이고, 6글자 티커 303개는
 * 전부 `ICR-PA` 같은 우선주라 하이픈이 들어간다. 한국 2,800종목은 전부 숫자로 시작한다.
 */
const KR_CODE = /^\d[0-9A-Z]{5}$/;
const KR_SUFFIX = /\.(KS|KQ)$/i;

/**
 * 어떤 표기로 들어오든 표준형으로 바꾼다.
 * `005930.KS` `005930.kq` ` 005930 ` → `005930`,  `nvda` → `NVDA`
 * 빈 문자열이나 null이면 빈 문자열을 돌려준다(호출부에서 걸러낼 것).
 */
export function normalizeTicker(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(KR_SUFFIX, "").toUpperCase();
}

/** 표준형 티커가 한국 종목인지. 6자리이고 숫자로 시작하면 한국으로 본다. */
export function isKoreanTicker(ticker: string | null | undefined): boolean {
  return KR_CODE.test(normalizeTicker(ticker));
}

/** 표준형 티커의 시장 구분. */
export function detectMarket(ticker: string | null | undefined): Market {
  return isKoreanTicker(ticker) ? "KR" : "US";
}

/**
 * 야후 파이낸스가 요구하는 심볼로 변환한다. 외부 호출 직전에만 쓴다.
 * 한국 종목은 거래소에 따라 접미사가 갈리므로 exchange를 넘겨야 한다.
 * 모르면 KOSPI(.KS)로 가정하니, 정확도가 필요하면 KRX 캐시에서 조회해 넘길 것.
 */
export function toYahooSymbol(ticker: string, exchange?: KrExchange | null): string {
  const t = normalizeTicker(ticker);
  if (!isKoreanTicker(t)) return t;
  return `${t}${exchange === "KOSDAQ" ? ".KQ" : ".KS"}`;
}

/** 표준형 티커로 저장·조회해도 되는 값인지 검사. 형식이 어긋나면 null. */
export function safeTicker(raw: string | null | undefined): string | null {
  const t = normalizeTicker(raw);
  if (!t) return null;
  if (KR_CODE.test(t)) return t;
  if (/^[A-Z][A-Z0-9.\-]{0,14}$/.test(t)) return t;
  return null;
}
