#!/bin/bash
set -e
pnpm install --frozen-lockfile

# DB 스키마는 서버 기동 시 lib/db/src/migrate.ts가 처리한다 (생성·컬럼 추가만, 삭제 없음).
# 여기서 `pnpm --filter db push`를 돌리면 drizzle 스키마에 없는 실제 테이블·컬럼을
# 삭제하려 시도하므로 사용하지 않는다. 스키마를 손으로 밀어야 할 때만 수동 실행할 것.
