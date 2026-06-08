/**
 * dart-corp-cache.ts
 * themes.ts가 DART API에서 로드한 corp_code 맵을 공유 인메모리 캐시에 저장.
 * dart-store.ts가 system_cache DB 조회 없이 바로 접근 가능.
 * 순환 의존 방지: routes/themes.ts → lib/dart-corp-cache ← lib/dart-store.ts
 */

let _corpCodeMap: Map<string, string> | null = null;
let _cachedAt = 0;

export function setCorpCodeMap(map: Map<string, string>): void {
  _corpCodeMap = map;
  _cachedAt = Date.now();
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
