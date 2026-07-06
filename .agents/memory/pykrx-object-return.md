---
name: callPykrx object vs array
description: callPykrx는 배열 전용. 객체를 반환하는 pykrx 액션은 callPykrxAny를 써야 하며, 빈 캐시 오염 방지를 위해 isCacheValid 패턴이 필요하다.
---

## 규칙

1. `callPykrx()` — 반환 타입 `Promise<any[]>`. Python 스크립트가 JSON 배열을 출력할 때 사용. 객체를 받으면 `[]`를 반환하고 경고를 남긴다.
2. `callPykrxAny()` — 반환 타입 `Promise<any>`. Python 스크립트가 JSON 객체를 출력할 때 사용. `presurge_scan` 처럼 `{candidates:[], backtest:{}}` 형태를 반환하는 액션에 사용.
3. `ALLOWED_PYKRX_TYPES` — 새 액션 추가 시 반드시 화이트리스트에도 추가. 빠뜨리면 `validatePykrxArgs`에서 throw.

## 빈 캐시 오염 방지

스캔 실패 시 빈 결과(`candidates: []`)가 DB에 저장된다. 다음 서버 재시작 시 이 빈 캐시가 복원되어 유효 캐시로 서빙되는 문제가 발생할 수 있다.

```typescript
function isCacheValid(c: CachedPresurge): boolean {
  return c.result.candidates.length > 0 && Date.now() - c.cachedAt < TTL_MS;
}
```

`candidates.length > 0` 조건을 함께 체크해 빈 결과를 무효화한다.

**Why:** `callPykrx`는 역사적으로 배열 전용으로 설계됐다. `presurge_scan` 추가 시 이를 모르고 `callPykrx`를 사용해 항상 빈 결과를 반환하는 버그가 발생했다.

**How to apply:** Python 스크립트에서 `{...}` 객체를 emit하는 모든 새 액션은 `callPykrxAny`를 사용. 캐시 라우트에는 `isCacheValid` 패턴으로 빈 결과 재사용을 차단.
