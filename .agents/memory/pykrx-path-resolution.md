---
name: pykrx script path resolution
description: Why pykrx_fetcher.py fails in production and the multi-fallback fix
---

# pykrx Script Path Resolution

**Why:** 배포 환경(CJS 번들 dist/index.cjs)에서 import.meta.url이 undefined → 기존 폴백 경로가 잘못된 CWD를 가정해 "panic: no such file or directory" 발생. 빈 결과가 DB에 캐시되어 30분간 "데이터 없음" 반복.

## Root cause
- Dev(ESM): `import.meta.url` 기반 경로 정상 작동
- Prod(CJS bundle at dist/index.cjs): `import.meta.url` throws → 기존 코드는 `process.cwd() + "artifacts/api-server/src/lib/..."` 사용
- 배포 환경 CWD가 다르면(api-server/ vs workspace root) 경로 불일치

## Fix (pykrx-client.ts)
4개 후보 경로를 `existsSync`로 순서대로 확인:
1. `import.meta.url` 기준 (ESM dev)
2. `__dirname + "../src/lib/"` (CJS bundle: dist/ 상위로 이동)
3. `process.cwd() + "src/lib/"` (CWD=api-server/)
4. `process.cwd() + "artifacts/api-server/src/lib/"` (CWD=workspace/)

스타트업 로그: `[pykrx] 스크립트 경로 확정: ...`

## Empty cache prevention (flow.ts)
- `buildFlowData()`: kospi/kosdaq/stocks 모두 0건이면 throw → DB 저장 안 함
- GET 핸들러 DB 조회: 빈 결과 감지 시 해당 캐시 즉시 DELETE 후 재빌드

**How to apply:** pykrx 관련 "panic" 에러 시 먼저 스타트업 로그에서 "스크립트 경로 확정" 확인. 없으면 경로 탐지 실패.
