/**
 * us-universe.ts — 미국 상장 종목 목록의 단일 출처
 *
 * 왜 이 파일이 생겼나:
 * 미국 종목 목록은 원래 us-full-harvester.ts에 손으로 적은 358개 배열이었다.
 * 한국은 KRX API에서 2,800개를 자동으로 받아오는데 미국만 수작업이라, 분석한 종목이
 * 마스터에 없는 일이 계속 생겼다(SAP·닌텐도 등 23개). 목록을 늘려도 신규 상장이
 * 나오면 같은 문제가 반복되므로, 출처 자체를 공식 목록으로 바꾼다.
 *
 * 출처: SEC company_tickers.json — 무료, 인증 불필요, 약 10,400개.
 * SEC는 접속 시 연락처가 담긴 User-Agent를 요구한다(없으면 차단).
 */

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const USER_AGENT = "aibitda research contact@aibitda.kr";

export interface UniverseEntry {
  ticker: string;
  name: string;
  /** SEC 중앙 색인 키. EDGAR 공시 조회에 쓰인다. 장외 ADR 등은 없을 수 있다. */
  cik: string | null;
}

/** SEC 응답 한 건의 모양. 객체의 값들이 이 형태로 들어온다. */
interface SecRow {
  cik_str: number;
  ticker: string;
  title: string;
}

let cached: { at: number; entries: UniverseEntry[] } | null = null;
const CACHE_MS = 12 * 60 * 60 * 1000; // 상장 목록은 하루 단위로도 충분히 최신이다

export interface FetchUniverseOptions {
  /** 캐시를 무시하고 새로 받아온다. 상장 직후 종목을 즉시 반영해야 할 때 쓴다. */
  force?: boolean;
}

/**
 * SEC 공식 목록을 가져온다. 실패하면 null — 호출부가 폴백을 결정한다.
 * 목록 전체를 메모리에 들고 있어도 10,400건이라 수 MB 수준이다.
 */
export async function fetchSecUniverse(opts: FetchUniverseOptions = {}): Promise<UniverseEntry[] | null> {
  if (!opts.force && cached && Date.now() - cached.at < CACHE_MS) return cached.entries;

  try {
    const res = await fetch(SEC_TICKERS_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[us-universe] SEC 목록 HTTP ${res.status} — 폴백 사용`);
      return null;
    }

    const raw = (await res.json()) as Record<string, SecRow>;
    const seen = new Set<string>();
    const entries: UniverseEntry[] = [];

    for (const row of Object.values(raw)) {
      const ticker = (row?.ticker ?? "").trim().toUpperCase();
      const name = (row?.title ?? "").trim();
      // 티커에 점(BRK.B)이나 하이픈이 섞인 우선주·클래스주도 그대로 둔다.
      // 야후·FMP가 표기를 달리 쓰는 경우가 있으나 여기서는 원본을 보존한다.
      if (!ticker || !name) continue;
      if (seen.has(ticker)) continue; // 같은 티커가 여러 CIK로 중복되는 경우가 있다
      seen.add(ticker);
      entries.push({
        ticker,
        name: name.slice(0, 200), // us_stocks.name이 VARCHAR(200)
        cik: row.cik_str != null ? String(row.cik_str).padStart(10, "0") : null,
      });
    }

    if (entries.length === 0) {
      console.warn("[us-universe] SEC 응답이 비어 있음 — 폴백 사용");
      return null;
    }

    cached = { at: Date.now(), entries };
    console.log(`[us-universe] SEC 목록 ${entries.length}건 로드`);
    return entries;
  } catch (err: any) {
    console.warn("[us-universe] SEC 목록 조회 실패:", err?.message?.slice(0, 80));
    return null;
  }
}
