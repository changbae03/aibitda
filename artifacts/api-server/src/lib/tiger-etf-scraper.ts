/** TIGER ETF 전체 목록 크롤러 (미래에셋 공식 사이트 기반)
 *  Endpoint: /tigeretf/ko/reference/list.ajax
 *  - HTML response containing ETF name (data-jong-name) + KSD fund code (data-ksd-fund)
 *  - KSD fund code KR7XXXXXXY → stock code = chars 3-9 (XXXXXX)
 *  - 24h cache, TTL refresh on next request after expiry
 */

const TIGER_REF_URL = "https://investments.miraeasset.com/tigeretf/ko/reference/list.ajax";
const CACHE_TTL_MS  = 24 * 60 * 60 * 1000; // 24시간

export interface TigerEtfEntry {
  code:      string;
  isuCd:     string;
  name:      string;
  sector:    string;
  issuer:    string;
  yahooCode: string;
  leverage:  number;
  ter?:      number;
  benchmark?: string;
}

let _cache: TigerEtfEntry[] = [];
let _lastFetch = 0;
let _inFlight: Promise<void> | null = null;

// ── 이름으로 섹터 자동 분류 ──────────────────────────────────────────────────

function detectSector(name: string): string {
  const n = name.toLowerCase();
  if (/채권|단기채|국고채|머니마켓|cma|cd금리|colb|금리|만기/.test(n)) return "채권";
  if (/리츠|부동산/.test(n))                                             return "리츠";
  if (/반도체|필라델피아|ai반도체|krx반도체|soxl|chip/.test(n))          return "반도체";
  if (/2차전지|배터리|이차전지/.test(n))                                  return "2차전지";
  if (/헬스케어|바이오|제약|bio|pharma/.test(n))                         return "헬스케어";
  if (/코스닥|kosdaq/.test(n))                                           return "코스닥";
  if (/금\b|금선물|골드|gold/.test(n))                                   return "원자재";
  if (/원유|wti|천연가스|원자재|commodity/.test(n))                      return "원자재";
  if (/배당|분배|월배당|dividend/.test(n))                               return "배당";
  if (/미국|나스닥|s&p|sp500|snp500|nasdaq|us |선진국|유럽|일본|china|베트남|인도|글로벌|달러|해외|신흥|emerging|msci/.test(n)) return "해외주식";
  if (/ai|로봇|우주|방산|사이버보안|항공|모빌리티|게임|메타버스|미디어|2030|탄소|esg|테크|it\b/.test(n)) return "테마";
  if (/밸류업|value/.test(n))                                            return "국내주식";
  if (/200|코스피|코리아|중소형|krx300|건설|은행|금융|소비재|화학|철강|에너지|정보/.test(n)) return "국내주식";
  return "국내주식";
}

// ── 이름으로 레버리지 자동 감지 ──────────────────────────────────────────────

function detectLeverage(name: string): number {
  const n = name.toLowerCase();
  if (/인버스.*3x|선물인버스.*3x|3x.*인버스|bear 3x/.test(n)) return -3;
  if (/인버스.*2x|선물인버스.*2x|2x.*인버스/.test(n))          return -2;
  if (/인버스/.test(n))                                         return -1;
  if (/선물레버리지.*2x|레버리지.*2x|2x.*레버리지|울트라프로|3x.*(bull|lev)/.test(n)) return 3;
  if (/레버리지|2x|2배|ultrashort|ultra pro/.test(n))          return 2;
  return 1;
}

// ── HTML 파싱 ────────────────────────────────────────────────────────────────

function parseHtml(html: string): TigerEtfEntry[] {
  const seen = new Set<string>();
  const etfs: TigerEtfEntry[] = [];

  // <button ... data-ksd-fund="KR7XXXXXXXXY" data-jong-name="TIGER 이름">
  const RE = /data-ksd-fund="(KR7\d{9})"\s+data-jong-name="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(html)) !== null) {
    const ksdFund = m[1]!;
    const rawName = m[2]!.trim();

    const code = ksdFund.substring(3, 9); // KR7XXXXXXY → XXXXXX
    if (seen.has(code)) continue;
    seen.add(code);

    const name     = rawName.replace(/\s+/g, " ");
    const sector   = detectSector(name);
    const leverage = detectLeverage(name);

    etfs.push({
      code,
      isuCd:     ksdFund,
      name,
      sector,
      issuer:    "미래에셋",
      yahooCode: `${code}.KS`,
      leverage,
    });
  }

  return etfs;
}

// ── 실제 크롤링 ──────────────────────────────────────────────────────────────

async function fetchTigerEtfs(): Promise<void> {
  const res = await fetch(TIGER_REF_URL, {
    method:  "POST",
    headers: {
      "Content-Type":     "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Referer":          "https://investments.miraeasset.com/tigeretf/ko/reference/list.do",
      "User-Agent":       "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    },
    body:    "pageNo=1&listCnt=500",
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const etfs = parseHtml(html);
  if (etfs.length < 10) throw new Error(`파싱 결과 너무 적음: ${etfs.length}개`);

  _cache     = etfs;
  _lastFetch = Date.now();
  console.log(`[tiger-etf] ${etfs.length}개 TIGER ETF 로드 완료 (미래에셋)`);
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/** 현재 캐시 반환 (비어있을 수 있음) */
export function getCachedTigerEtfs(): TigerEtfEntry[] {
  return _cache;
}

/** 필요시 갱신 후 캐시 반환 (비동기) */
export async function ensureTigerEtfs(): Promise<TigerEtfEntry[]> {
  if (_cache.length > 0 && Date.now() - _lastFetch < CACHE_TTL_MS) {
    return _cache;
  }
  if (!_inFlight) {
    _inFlight = fetchTigerEtfs().finally(() => { _inFlight = null; });
  }
  await _inFlight;
  return _cache;
}

/** 강제 갱신 */
export async function refreshTigerEtfs(): Promise<TigerEtfEntry[]> {
  _lastFetch = 0;
  return ensureTigerEtfs();
}
