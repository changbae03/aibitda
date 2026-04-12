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
      if (!name || !/^\d{6}$/.test(code)) continue;
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

loadKRXList().catch(() => {});
