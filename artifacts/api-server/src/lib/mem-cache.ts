interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.evictions++;
      this.stats.misses++;
      return null;
    }
    this.stats.hits++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.stats.sets++;
  }

  del(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.store.size,
      hitRate: total > 0 ? ((this.stats.hits / total) * 100).toFixed(1) + "%" : "0%",
    };
  }

  // 만료된 항목 일괄 정리 (주기적으로 호출)
  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }
}

export const cache = new MemCache();

// TTL 상수 (밀리초)
export const TTL = {
  NAVER_PRICE:    5  * 60 * 1000,  //  5분 — 실시간 시세·수급
  NAVER_CONSENSUS: 10 * 60 * 1000, // 10분 — FnGuide 컨센서스
  YAHOO_FINANCIAL: 20 * 60 * 1000, // 20분 — Yahoo Finance 재무제표
  DART_FILING:    60 * 60 * 1000,  // 60분 — DART 공시 데이터
  KRX_LIST:       24 * 60 * 60 * 1000, // 24시간 — KRX 종목 목록
  PEER_FINANCIALS: 8 * 60 * 60 * 1000, // 8시간 — 피어 재무 데이터 (당일 분석 일관성)
  HOUR:            60 * 60 * 1000, // 1시간
};

// 주기적 만료 항목 정리 (5분마다)
setInterval(() => {
  const n = cache.purgeExpired();
  if (n > 0) {
    console.log(`[Cache] 만료 항목 ${n}개 정리. 현재 캐시 크기: ${cache.getStats().size}`);
  }
}, 5 * 60 * 1000);
