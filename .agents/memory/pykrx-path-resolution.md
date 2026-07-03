---
name: pykrx script path resolution
description: Why pykrx_fetcher.py + Python binary fail in production and the multi-fallback fix
---

# pykrx Script Path Resolution

**Why:** 배포 환경에서 두 가지 독립적인 실패 원인이 있음.

## 실패 원인 1 — 스크립트 경로
- Dev(ESM): `import.meta.url` 기반 경로 정상 작동
- Prod(CJS bundle): `import.meta.url` throws → CWD 기반 경로 4개 폴백으로 해결

## 실패 원인 2 — Python 바이너리 (Go 래퍼)
- Replit 배포 환경의 `python3` (PATH)은 Go 래퍼(`python-wrapper`) 바이너리임
- `/home/runner/workspace/.pythonlibs/bin/python3` 역시 `existsSync`는 통과하나 Go 래퍼일 수 있음
- Go 래퍼는 내부에서 실제 Python을 찾지 못하면 `panic: no such file or directory` 발생
- **핵심:** `existsSync`만으로는 충분하지 않음 — 실제 실행해서 `Python 3.x` 출력 확인 필요

## Fix (pykrx-client.ts)

### Python 바이너리 선택
1. `spawnSync(bin, ["--version"])` 실행 → `Python 3.\d+` 패턴 확인 (`isRealPython()`)
2. 버전 고정 경로 우선 시도: `python3.11`, `python3.12` (Go 래퍼가 비버전 `python3`만 가로채는 경우)
3. `findUvPythons()`: `/home/runner/.local/share/uv/python/cpython-*/bin/python3` 동적 탐색
4. 검증 실패 시 "python3" PATH 폴백 (로그: `[pykrx] 검증된 Python 바이너리 없음`)

### 스크립트 경로 선택
4개 후보를 `existsSync`로 순서대로 확인 (import.meta.url → __dirname → cwd/src → cwd/artifacts)

### 빈 캐시 방지 (flow.ts)
- 0건이면 DB 저장 안 함, 빈 캐시 감지 시 즉시 DELETE 후 재빌드

## 진단
- 스타트업 로그: `[pykrx] Python 바이너리 확정 (검증 완료): <path>`
- "검증 완료" 없이 "폴백" 메시지 → Go 래퍼 패닉 원인
- `panic: no such file or directory` + `python-wrapper/main.go` → Python 바이너리 문제

**How to apply:** pykrx "panic" 에러 시 스타트업 로그의 "바이너리 확정" 경로 확인. "검증 완료" 없으면 `isRealPython` 검증 실패 → 새 Python 경로 추가 필요.
