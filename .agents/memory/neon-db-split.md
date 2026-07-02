---
name: Neon DB vs local DB split
description: API 서버와 executeSql이 서로 다른 DB를 바라봐서 캐시 조작이 엇갈리는 문제
---

API 서버(`@workspace/db` pool)는 `NEON_DATABASE_URL ?? DATABASE_URL`을 사용한다.
`executeSql` code_execution 도구는 로컬 PostgreSQL(`DATABASE_URL`)을 쿼리한다.

**Why:** 두 환경이 분리되어 있어 `executeSql`로 캐시를 DELETE해도 실제 서버 캐시(Neon)는 그대로 남는다.
이 때문에 DB 캐시를 삭제했다고 착각하고 서버 재시작해도 stale 캐시가 계속 서빙됐다.

**How to apply:**
- Neon DB 캐시를 직접 조작하려면 Node.js 프로세스 내에서 `process.env.NEON_DATABASE_URL`을 사용해 `pg.Pool`로 접속해야 한다.
- 캐시 무효화는 캐시 키 버전 bump (예: v10 → v11)가 가장 안전하고 확실하다.
- `executeSql`로 조회한 system_cache 결과는 로컬 DB 기준이므로 서버 캐시 현황과 다를 수 있다.
