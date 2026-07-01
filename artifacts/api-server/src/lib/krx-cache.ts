export interface StockEntry {
  name: string;
  code: string;
  symbol: string;
  exchange: "KOSPI" | "KOSDAQ";
}

let cache: StockEntry[] = [];
let loadedAt = 0;
const TTL = 1000 * 60 * 60 * 24;

export async function loadKRXList(): Promise<StockEntry[]> {
  const now = Date.now();
  if (cache.length > 0 && now - loadedAt < TTL) return cache;

  try {
    const res = await fetch(
      "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13",
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, signal: AbortSignal.timeout(10000) }
    );
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("euc-kr").decode(buf);
    const rows = html.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
    const results: StockEntry[] = [];
    for (const row of rows.slice(1)) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [];
      if (cells.length < 3) continue;
      const name = cells[0].replace(/<[^>]+>/g, "").trim();
      const market = cells[1].replace(/<[^>]+>/g, "").replace(/\s+/g, "");
      const code = cells[2].replace(/<[^>]+>/g, "").trim();
      // 표준 6자리 숫자 코드 + 신규 상장 영숫자 코드(예: 0088M0) 모두 허용
      if (!name || !/^[A-Za-z0-9]{6}$/.test(code)) continue;
      const exchange: "KOSPI" | "KOSDAQ" = market.includes("코스닥") ? "KOSDAQ" : "KOSPI";
      results.push({ name, code, symbol: `${code}${exchange === "KOSPI" ? ".KS" : ".KQ"}`, exchange });
    }
    if (results.length > 0) {
      cache = results;
      loadedAt = now;
      console.log(`[KRX] 종목 목록 로드 완료: ${results.length}개`);
    }
    return cache;
  } catch (err: any) {
    console.error("[KRX] 로드 실패:", err.message);
    return cache;
  }
}

export function getKRXCache(): StockEntry[] {
  return cache;
}

export function lookupKoreanName(tickerOrCode: string): string | null {
  if (cache.length === 0) return null;
  const code = tickerOrCode.replace(/\.(KS|KQ)$/i, "");
  const entry = cache.find(e => e.code === code);
  return entry?.name ?? null;
}

export function lookupCodeByName(name: string): string | null {
  if (cache.length === 0) return null;
  const entry = cache.find(e => e.name === name);
  return entry?.code ?? null;
}

export function lookupSymbolByName(name: string): string | null {
  if (cache.length === 0) return null;
  const entry = cache.find(e => e.name === name);
  return entry?.symbol ?? null;
}

/**
 * AI가 .KS/.KQ 를 잘못 붙일 수 있으므로 KRX 캐시로 교정.
 * 6자리 코드를 추출 → 캐시에서 정확한 심볼 반환.
 * 캐시 미로드·코드 미존재 시 원본 반환.
 */
export function correctKoreanTicker(ticker: string): string {
  if (cache.length === 0) return ticker;
  const code = ticker.replace(/\.(KS|KQ)$/i, "");
  if (!/^\d{6}$/.test(code)) return ticker; // 한국 주식 아님
  const entry = cache.find(e => e.code === code);
  if (!entry) return ticker; // 캐시에 없으면 원본 유지
  return entry.symbol; // e.g. "079550.KS" (올바른 거래소)
}

loadKRXList().catch(() => {});
