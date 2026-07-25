# 애빛다 — 개발 가이드

AI 헤지펀드 리서치 플랫폼. 프로젝트의 도메인 지식·구조·에이전트 파이프라인 설명은
[replit.md](replit.md)에 있다. 이 문서는 **로컬(맥)에서 개발하는 방법**을 다룬다.

## 목표 (2026-07 기준)

1. 개발 환경을 Replit → 로컬(Claude Code)로 완전 이관
2. DB·코드 뼈대 기초공사
3. Railway/Render에 병행 배포 후 도메인 스왑으로 Replit 졸업
4. 그 위에서 iOS·Android 앱(`artifacts/aibida-mobile`, Expo) 개발

Replit은 3번이 끝날 때까지 **운영 서버로 그대로 살려둔다.** 로컬 작업은 Replit에
영향을 주지 않으며, Replit이 코드를 받아가려면 Replit 화면에서 직접 pull 해야 한다.

## 최초 1회 셋업

```bash
pnpm install
cp .env.example .env   # 그다음 .env에 실제 값을 채운다
```

`.env` 값은 Replit 프로젝트 → Tools → Secrets에서 가져온다.
`.env`는 `.gitignore`에 등록돼 있어 커밋되지 않는다. **`.env.example`에는 실제 값을 적지 말 것.**

필수는 `DATABASE_URL`, `PORT`, `GEMINI_API_KEY` 세 개다. 나머지 데이터 소스 키는
없어도 서버는 뜨지만 해당 데이터가 빠진 채로 분석이 진행된다(정확도에 영향).

## 실행

```bash
pnpm --filter @workspace/api-server run dev      # API 서버 :8080
pnpm --filter @workspace/hedge-fund-ai run dev   # 웹 :22315 (/api는 8080으로 프록시)
pnpm --filter @workspace/mockup-sandbox run dev  # 디자인 프리뷰
pnpm --filter @workspace/aibida-mobile run dev   # 모바일 :23339
```

dev 스크립트는 Node 24의 `--env-file-if-exists`로 루트 `.env`를 읽는다(dotenv 불필요).

웹만 띄우면 화면은 보이지만 데이터 요청은 모두 실패한다 — API 서버를 같이 띄워야 한다.
API 서버는 `artifacts/hedge-fund-ai/dist/public`이 빌드돼 있으면 프론트엔드도 함께
서빙한다. 즉 **배포는 `node dist/index.cjs` 한 프로세스로 끝난다.**

### 모바일

시뮬레이터·실기기에는 origin이 없으므로 `.env`의 `EXPO_PUBLIC_API_URL`을 반드시 지정한다
(iOS 시뮬레이터는 `http://localhost:8080`, 안드로이드 에뮬레이터는 `http://10.0.2.2:8080`).
앱스토어 출시용 `eas.json`은 아직 없다 — 출시 단계에서 만든다.

## 검사

```bash
pnpm run test        # vitest 1회 실행
pnpm run test:watch  # 파일 저장할 때마다 재실행
pnpm run typecheck   # 전체
pnpm run build       # typecheck + 각 패키지 빌드
```

테스트는 소스 옆에 `*.test.ts`로 둔다. 현재 커버되는 곳은 `lib/shared`(티커 표준화,
포맷터)뿐이다 — 이 프로젝트에는 원래 테스트가 하나도 없었고, 여기서부터 넓혀간다.

**새 테스트를 쓸 때는 반드시 "일부러 깨뜨려서 실패하는지" 확인할 것.** 통과만 하는
테스트는 안전망이 아니다. 실제로 지표 캐시 적중률 0% 버그를 다시 넣어보니 7개가
실패하는 것을 확인하고 안전망으로 인정했다.

**기존 타입 에러가 남아 있다** (Replit 시절 타입 검사 없이 esbuild로만 빌드해온 결과):
api-server 191개, hedge-fund-ai 33개, aibida-mobile 7개. 이건 알려진 기준선이다.
변경 후에는 **"기준선 대비 신규 에러 0"**을 확인하고, 잔존분은 점진적으로 줄인다.

```bash
cd artifacts/api-server && pnpm exec tsc -p tsconfig.json --noEmit 2>&1 | grep -c "error TS"
```

## DB — 반드시 알아야 할 것

**스키마의 진실은 두 곳에 나뉘어 있다.**

- 실제 DDL: `lib/db/src/migrate.ts` — 서버 기동 시 실행. 생성·컬럼추가만 하고 삭제하지 않는다.
- 타입 미러: `lib/db/src/schema/` — Drizzle 정의. 타입 안전 쿼리용.

스키마를 바꿀 때는 **두 곳을 함께** 고친다.

일부 테이블은 각자의 모듈이 소유한다(예: `ticker_financials`는
`artifacts/api-server/src/lib/dart-store.ts`). 같은 테이블을 두 곳에서 정의하지 말 것 —
`CREATE TABLE IF NOT EXISTS`라 먼저 실행된 쪽이 이기고 나머지는 조용히 무시된다.

### `drizzle-kit push`를 쓰지 말 것

실제 DB에는 48개 테이블이 있지만 Drizzle 스키마는 25개만 안다. `push`는 스키마에 없는
테이블·컬럼을 **삭제하려 시도**한다. `scripts/post-merge.sh`에서 이 명령을 제거한 이유다.
스키마 반영은 `migrate.ts`가 담당한다.

### 알려진 과제 (종목 DB 기초공사)

- 종목 식별자가 통일돼 있지 않다: `krx_stocks.code`는 6자리(`005930`), `us_stocks.ticker`는
  `NVDA`, `analyses.ticker`에는 `.KS` 접미사가 섞여 있다. 그래서 코드 곳곳에
  `ticker.split(".")[0]`가 흩어져 있다.
- 한국·미국 종목 테이블이 분리돼 있는데 컬럼 구성은 거의 같다.
- `analyses`가 종목 마스터를 참조하지 않아 종목 단위 조회를 한 번에 못 한다.

실 DB 진단은 `DATABASE_URL` 확보 후 진행한다.

## Replit 관련 파일

`.replit`, `replit.nix`, `.replitignore`, `artifacts/*/.replit-artifact/`는 Replit이 운영을
맡는 동안 유지한다. 도메인 스왑이 끝나면 정리한다.

`@replit/vite-plugin-*` 3종은 `REPL_ID`가 있을 때만 켜지므로 로컬에서는 자동으로 꺼진다.

> `.replit`에 `JWT_SECRET`·`ECOS_API_KEY`·`FRED_API_KEY`가 평문으로 커밋돼 있다.
> 비공개 저장소지만 이관이 끝나면 재발급할 것.

## 파이썬 (pykrx)

한국 수급·공매도·급등주·ETF·테마 데이터는 `pykrx`(Python)를 통해 수집한다
(`artifacts/api-server/src/lib/pykrx_fetcher.py`). 10개 이상의 모듈이 의존한다.
`requirements.txt`가 없어 `pykrx`는 수동 설치해야 하며, `.env`의 `PYTHON_BIN`으로
인터프리터를 지정할 수 있다.

이 의존성 때문에 **Vercel 같은 서버리스 호스팅에는 API 서버를 올릴 수 없다.**
상주 프로세스가 필요한 정기 작업(11개 이상)과 메모리 기반 잠금장치도 같은 이유다.
배포 대상은 컨테이너형 호스팅(Railway/Render)으로 정했다.
