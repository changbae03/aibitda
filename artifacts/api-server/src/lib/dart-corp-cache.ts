/**
 * dart-corp-cache.ts
 * themes.ts가 DART API에서 로드한 corp_code 맵을 공유 인메모리 캐시에 저장.
 * 순환 의존 방지: routes/themes.ts → lib/dart-corp-cache ← routes/market-data.ts
 */

export interface CorpInfo {
  corp_code: string;
  corp_name: string;
  stock_code: string | null;
  corp_cls: string;
}

let _corpCodeMap: Map<string, string> | null = null;
let _cachedAt = 0;

// 이름 검색용: corp_name(소문자) → CorpInfo[]
let _nameIndex: Map<string, CorpInfo[]> | null = null;
// 전체 목록 (이름 부분 검색용)
let _allCorps: CorpInfo[] | null = null;

export function setCorpCodeMap(map: Map<string, string>): void {
  _corpCodeMap = map;
  _cachedAt = Date.now();
}

export function setCorpInfoList(list: CorpInfo[]): void {
  _allCorps = list;
  _nameIndex = new Map();
  for (const c of list) {
    const key = c.corp_name.toLowerCase();
    if (!_nameIndex.has(key)) _nameIndex.set(key, []);
    _nameIndex.get(key)!.push(c);
  }
}

export function searchCorpByName(query: string, limit = 20): CorpInfo[] {
  if (!_allCorps || _allCorps.length === 0) return [];
  const q = query.toLowerCase();
  const results: CorpInfo[] = [];
  for (const c of _allCorps) {
    if (c.corp_name.toLowerCase().includes(q)) {
      results.push(c);
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function hasCorpInfoList(): boolean {
  return _allCorps !== null && _allCorps.length > 0;
}

export function getCorpCodeFromCache(stockCode: string): string | null {
  return _corpCodeMap?.get(stockCode) ?? null;
}

export function hasCorpCodeCache(): boolean {
  return _corpCodeMap !== null && _corpCodeMap.size > 0;
}

export function getCorpCodeCacheSize(): number {
  return _corpCodeMap?.size ?? 0;
}
