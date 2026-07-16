---
name: pykrx script path resolution
description: Why pykrx_fetcher.py + Python binary fail in production and the definitive uv-run fix
---

# pykrx Script Path Resolution

**Why:** 배포 환경에서 두 가지 독립적인 실패 원인이 있음.

## 실패 원인 1 — 스크립트 경로
- Dev(ESM): `import.meta.url` 기반 경로 정상 작동
- Prod(CJS bundle): `import.meta.url` throws → CWD 기반 경로 4개 폴백으로 해결

## 실패 원인 2 — Python 바이너리 (Go 래퍼) — 핵심 문제
- Replit 배포 환경의 `python3` (PATH)은 Go 래퍼(`python-wrapper`) 바이너리임
- `/home/runner/workspace/.pythonlibs/bin/python3.11` 은 dev에서만 존재 (PATH에서 `python3.11`로 노출됨)
- 배포 환경에서는 `.pythonlibs` PATH 설정이 없어 절대경로도, PATH 명령도 모두 실패
- **핵심 함정:** `existsSync("python3.11")` → false (절대경로가 아님) → PATH에 있어도 건너뜀

## 확정된 Fix — `uv run --with pykrx python3`
- `PYTHON_BIN` 단일 문자열 → `PYTHON_CMD: { bin, prefixArgs }` 구조체로 교체
- spawn: `spawn(PYTHON_CMD.bin, [...PYTHON_CMD.prefixArgs, SCRIPT, ...args])`
- **최우선**: `uv --version` 성공 시 `{ bin: uvBin, prefixArgs: ["run", "--with", "pykrx", "python3"] }` 사용
  - uv가 Python 바이너리 + pykrx 패키지 자동 관리
  - `which uv` → Nix 하드코드 경로 → PATH 후보 순으로 탐색
- **폴백 순서**: 절대경로 existsSync+isRealPython → PATH 버전 고정(`python3.11` 등) → `python3`

## Dev 확인 로그
- `[pykrx] Python 확정 (uv run): /nix/store/.../uv` ← 정상
- `[pykrx] 검증된 Python 없음 — 'python3' 폴백` ← 배포 문제 (재배포로 해결)

## 스크립트 경로 선택
4개 후보를 `existsSync`로 순서대로 확인 (import.meta.url → __dirname → cwd/src → cwd/artifacts)

## 빈 캐시 방지 (flow.ts)
- 0건이면 DB 저장 안 함, 빈 캐시 감지 시 즉시 DELETE 후 재빌드

**How to apply:** pykrx "panic" 에러 시 `uv` 경로 확인이 선행. uv가 없는 환경에서는 `PYTHON_BIN` 환경변수로 override 가능.
