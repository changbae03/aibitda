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
pnpm --filter @workspace/aibida-mobile run dev:local   # 모바일 :23339 (맥에서는 dev:local)
```

모바일만 스크립트가 둘이다. `dev`는 **Replit 전용**(Replit 프리뷰 주소·프록시 환경변수를 넘김)이고
`artifacts/aibida-mobile/.replit-artifact/artifact.toml`이 그것을 호출한다. 맥에서는 `dev:local`을 쓴다.
**`dev`를 로컬용으로 바꾸면 Replit 모바일 프리뷰가 크래시한다** — 실제로 한 번 그렇게 만들었다.

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

### 조용한 실패를 만들지 말 것

이 저장소에서 나온 큰 결함은 거의 전부 같은 모양이었다. **데이터가 안 들어오는데
아무도 모른 채 분석이 그대로 진행된다.** 지표 캐시 0% 적중, DART 재무 0행,
한국 PER 0건, 사업보고서 0건이 모두 그랬다.

- 수집 실패는 괜찮다(분석을 막지 않는다). **말 없이 실패하는 것**이 문제다.
  `return null` 앞에는 사유를 남길 것 — 어느 단계에서 끊겼는지 알아야 고칠 수 있다.
- `catch {}`로 삼키기 전에, 그 예외가 기능을 통째로 죽이는 종류인지 볼 것.
- 표가 0행이면 의심할 것. 코드가 그 표를 참조하는데 비어 있다면 십중팔구 고장이다.

> **jsonb 컬럼에 `JSON.parse`를 걸지 말 것.** pg 드라이버가 이미 객체로 돌려주므로
> `"[object Object]" is not valid JSON` 예외가 나고, 그게 catch에 삼켜지면 캐시가
> 통째로 죽는다. corp_code 맵 3,977건이 `system_cache`에 멀쩡히 있는데도 조회가
> **항상 실패**했고, 그래서 DART 사업보고서가 한 건도 수집되지 않았다.
> `@workspace/db`의 `readJsonb()`를 쓸 것. jsonb 컬럼은 `system_cache.data`,
> `kv_cache.value`, `market_brief_history.data`, `portfolio_snapshots.holdings_json`,
> `model_calibration.sector_benchmarks`, `sector_priors.specific_levers`다.

### DART 원문(사업보고서) 수집 규격

`document.xml` + `rcept_no`이고 **응답이 곧 ZIP**이다. `document.json?rcpNo=`이라는
규격은 없다(status 101을 돌려준다). 목록의 접수번호 필드도 `rcp_no`가 아니라 `rcept_no`다.

- `last_reprt_at=N`으로 받을 것. `Y`는 최신판만 주는데, 정정공시(`[첨부정정]`·`[기재정정]`)는
  원문 ZIP이 없어 status 014가 난다. 원본까지 받아 **정정이 아닌 것부터** 시도한다.
- `page_count`는 넉넉히(30). 5로 두면 분기·반기 공시에 밀려 사업보고서가 잘린다.
- ZIP 파싱은 **중앙 디렉터리** 기준으로 한다. DART ZIP은 스트리밍 압축(플래그 bit 3)이라
  로컬 헤더의 압축크기가 항상 0이다 — 그걸 보고 건너뛰면 항목을 하나도 못 찾는다.
- 원문 파일은 `.xml`이다(`.html` 아님). 태그 구조는 같아 `htmlToText`로 처리된다.

### 타입 검사에서 `lib/*` 변경이 안 보일 때

`artifacts/api-server/tsconfig.json`이 `references`로 `lib/db`를 참조한다. 프로젝트 참조는
소스가 아니라 **빌드된 선언 파일**(`lib/db/dist/*.d.ts`)을 본다. 그래서 `lib/db/src`에
export를 추가하면 `has no exported member` 오류가 난다. 해당 패키지를 먼저 빌드할 것.

```bash
cd lib/db && pnpm exec tsc -p tsconfig.json
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

### 종목 마스터 — 조회는 `stocks` 뷰로

종목은 시장별로 `krx_stocks`(code 기준) / `us_stocks`(ticker 기준)에 저장되지만,
**조회는 두 테이블을 합친 `stocks` 뷰를 쓴다** (`ticker` 표준형 + `market` + 공통 21컬럼).
뷰 정의는 `lib/db/src/migrate.ts`, 타입은 `lib/db/src/schema/market_data.ts`의 `stocksView`.

- 저장(수집기·자가 등록)은 여전히 시장별 테이블로 간다.
- 새 종목 등록은 `artifacts/api-server/src/lib/stock-registry.ts`의
  `ensureStockRegistered()` 한 곳만 거친다 — 호출부에서 시장을 분기하지 말 것.
- 미국 종목 목록 출처는 SEC 공식 목록(`lib/us-universe.ts`)이다.
  `US_MASTER_LIST`는 SEC 조회 실패 시 폴백 시드일 뿐이므로 손으로 추가하지 말 것.

**두 테이블의 실제 병합은 호스팅 이관 이후로 미뤄져 있다.** 지금 병합하면 옛 코드로
돌고 있는 운영 서버가 멈춘다.

### 피어그룹 — 지표는 종목 마스터에서 조인한다

피어 비교에 필요한 PER·PBR·ROE·시총은 **외부 API로 다시 받지 말 것.** 종목 마스터
(`stocks` 뷰)에 한국 2,800 + 미국 10,400여 종목분이 이미 정리돼 있다.

- 저장: `stock_peers` (종목별 피어 티커·순위·선정이유·출처)
- 접근: `artifacts/api-server/src/lib/peer-store.ts`
  - `savePeers()` — AI가 피어를 고를 때마다 저장. 티커는 표준형으로 정규화된다.
  - `getPeersWithMetrics()` — 저장된 피어 + 지표를 한 번의 질의로
  - `getSectorPeers()` — 같은 업종·유사 시총 자동 선정 (AI 선정 실패 시 대비책)
- 표기 규칙은 `peer-format.ts`가 소유한다(순수 함수라 DB 없이 테스트 가능).
  시장별 통화 구분과 "0은 결측" 처리가 여기 있다 — 프롬프트에 그대로 들어가
  AI 판단을 좌우하므로 `peer-format.test.ts`를 함께 갱신할 것.

`krx_peer_data`(0행)를 조회하던 5곳은 `stocks` 뷰로 옮겼다. 표 정의와 일회성
적재 스크립트만 남아 있으니 **새로 참조하지 말 것.**

### 한국 종목명 — 법인명이 아니라 종목약명

`kind.krx.co.kr` 상장법인 목록은 **법인 등록명**을 준다(005380 → "현대자동차",
"케이티앤지"). 거래 화면·시세표의 정식 표기는 **종목약명**("현대차", "KT&G")이며
KIS `search-stock-info`의 `prdt_abrv_name`이 그 값이다.

`fetchKISStockNames()`(`lib/kis-client.ts`)가 종목약명·영문명과 함께
**한국 표준산업분류·KRX 업종중분류**도 돌려준다. 야후 industry보다 한국 종목에
정확할 수 있으니 업종 분류를 더 개선할 때 쓸 것.

새 종목 이름을 어딘가에 저장할 때는 이 함수를 거칠 것 — KRX 목록을 그대로 쓰면
표기가 다시 갈라진다.

**KIS 표준산업분류는 `kis-industry-backfill.ts`가 채운다.** 수확기도 수집하면서 함께
쓰지만 그쪽은 주 1회 주기라, 비어 있는 종목만 골라 채우는 가벼운 작업을 따로 두고
장마감 스케줄에 물려놨다. 밴드 집계보다 **먼저** 돌아야 한다 — 분류가 밴드의 묶음 기준이다.

> 실패를 캐시할 때는 "KIS가 없다고 답한 것"과 "물어보지도 못한 것"을 구분할 것.
> 예전에는 HTTP 오류·네트워크 예외까지 null로 캐시해서, 순간적인 실패 한 번이 그 종목을
> 프로세스가 끝날 때까지 "분류 없음"으로 못박았다(같은 종목이 드라이런에선 되고 본
> 수집에선 비는 현상). `rt_cd != 0`만 캐시한다.

### 한국 종목코드는 "6자리 + 숫자로 시작"이다

KRX가 신규상장·스팩에 `0004Y0`·`0126Z0`처럼 **영문이 섞인 코드**를 발급한다. 판정이
`/^\d{6}$/`(전부 숫자)로 돼 있어서 그런 종목 55개가 전부 "미국"으로 분류됐고, KIS·DART
조회가 통째로 막혀 있었다. 판정은 `lib/shared/ticker.ts`의 `isKoreanTicker` 하나만 쓸 것.

첫 글자를 숫자로 못박은 근거는 실제 데이터다 — 미국 10,448종목 중 숫자로 시작하는
티커는 0개, 6글자 티커 303개는 전부 `ICR-PA` 같은 하이픈 우선주다.

> **아직 정리 중이다.** `/^\d{6}$/`가 20개 파일에 85곳 복사돼 있고, 지금 관문으로 옮긴 것은
> 수집을 막고 있던 `kis-client`·`dart-store`·`krx-cache`뿐이다. 나머지를 건드릴 때
> 같이 옮길 것.

### 종목 메모는 "사람의 판단"만 담아야 한다

`ticker_notes`(스크립트: `scripts/add-ticker-notes.ts`)는 사람이 종목별로 보정을 적어두는
자리다. 분석 결과를 보고 반복되는 오류를 잡아주는 장치이고, 실측 오차에 근거해 쓴다
("2026년 분석에서 목표가 332% 괴리 발생 확인 → DCF 성장률·OPM 과낙관 원인").

**여기에 데이터 결함을 메우는 내용이 들어가면 안 된다.** 메디포스트 메모에는 이런 줄이
있었다 — `실제 업종: 바이오텍 (industry="일반"으로 분류돼 KR_OTHER 오분류 주의)`.
꺼내 쓸 수 있는 데이터(마스터의 KIS 분류)를 코드가 못 꺼내서 사람이 손으로 채운 것이다.
그런 줄을 발견하면 메모를 고치지 말고 **데이터 경로를 고칠 것.**

메모가 맡아야 하는 것은 코드가 알 수 없는 판단이다 — 예: "카티스템은 국내 허가·판매
중이므로 PoS=100%, 임상 성공확률을 다시 곱하지 말 것".

### 업종은 야후가 비면 종목 마스터에서 가져온다

야후는 한국 종목의 `industry`를 자주 비운다. 예전에는 그때 `"일반"`을 넣었고, 그 값이
업종 분류·모델 선택·섹터 프라이어로 흘러가 KR_OTHER 취급(목표가 150% 상한, WACC
12~13%)을 받았다. 분석 63건이 그렇게 남아 있다.

`financial-context.ts`의 `resolveIndustry()`가 순서를 정한다:
**야후 → 마스터 industry → 마스터 KIS 분류 → `"일반"`**. 이름을 종목 마스터로 통일한
것과 같은 원칙이다(단일 출처).

> **KIS 값을 그대로 industry 자리에 넣지 말 것.** 모호한 값이 야후용 규칙표에 잘못 걸린다 —
> "기타 금융업"은 지주회사를 전부 담는 칸이라, 배터리 소재 지주회사 에코프로가
> KR_FINANCIAL로 분류된다. `isUsableKisIndustry()`를 반드시 통과시킬 것.
> 실측 14종목에서 마스터 sector와 100% 일치하는 것을 확인했다.

### 업종 분류 — `lib/sector-taxonomy.ts`

`industry`(야후의 영문 고정 명칭)를 업종 코드로 바꾼다. **순서가 의미를 갖는다** —
부분 문자열로 검사하므로 좁은 항목이 위에 있어야 한다(`semiconductor equipment`가
`semiconductor`보다 먼저).

새 industry 값이 등장하면 표에 추가할 것. 안 그러면 조용히 `_OTHER`로 빠진다 —
예전에 `Auto Manufacturers`가 안 걸려 현대차·기아가 미분류였던 게 그 사례다.
`sector-taxonomy.test.ts`가 실제 오분류 사례를 회귀 테스트로 고정하고 있다.

한국 종목은 KIS 표준산업분류(`krx_stocks.kis_industry`)를 보조로 쓴다. 다만
**`KIS_OVERRIDE`에 함부로 추가하지 말 것** — KIS는 법인 등록 업종이라 실제 사업과
어긋난다. 넓게 적용해봤더니 두산(지주)·한화시스템(방산전자)이 전자부품으로
잘못 옮겨졌다. 현재 덮어쓰는 건 조선뿐이고, 나머지는 야후가 못 잡았을 때만 메운다.
추가 전에 반드시 실제 종목으로 드라이런할 것.

피어 비교에 쓸 수 있는지는 `isComparableSector()`로 판단한다(`_OTHER`·`_SHELL` 제외).
SPAC(`Shell Companies`)은 사업 실체가 없어 멀티플 비교가 무의미하다.

> 현재 비교 가능 비율: 한국 75%(2,097/2,800), 미국 4%(385/10,448 — 미국은 SEC
> 목록을 새로 받아 industry 수집이 회차당 600개씩 진행 중이라 시간이 지나면 오른다).
> 삼성전자는 야후가 `Consumer Electronics`로 주어 `KR_ELECTRONICS`다 —
> SK하이닉스와 묶이지 않는다. 종목별 예외를 코드에 박지 말 것(업종 피어는
> AI 선정 실패 시의 대비책이고, AI는 이 관계를 안다).

### 밸류에이션 모델 — `lib/valuation/`

업종에 맞는 모델 **하나만** 프롬프트에 주입한다. 예전에는 17개 블록(626줄)이 모든
종목에 전부 들어가, 삼성전자를 분석하면서 리츠·은행·광산 규칙을 함께 읽었다.

- `model-registry.ts` — 공통 렌더러. **조율 절차와 FINAL_VALUATION_DATA 매핑은 여기 1벌뿐**이다.
  괴리율 20%/30% 구간 처리와 "3개 이상 단순 평균 금지"가 모든 모델에 동일 적용된다.
- `models-kr.ts` / `models-us.ts` — 모델 정의. 모델별로 다른 것은 **무엇이 절대·상대가치인가**와
  **가중치(absWeight)** 둘뿐이다. 3-way가 필요했던 지표는 `crossCheck`로 빼서 조율에서 제외한다.
- `select-model.ts` — 업종 감지 → 모델 1개. **순서가 의미를 갖는다** — 구조가 명확한
  업종(MLP·BDC·리츠·금융)을 먼저 보고 포괄적인 SOTP를 마지막에 둔다.

- `report-formats.ts` — 보고서 본문 서식(표 양식). 모델의 `reportFormat`이 하나를 고른다.
  예전에는 DCF·rNPV·EV/Sales·Gordon P/B 네 벌(640줄)이 전부 들어가고 "모델이 X인 경우
  이 섹션만 작성"이라는 문장으로 AI가 고르게 했다. 삼성전자 프롬프트에 임상 rNPV
  작성법 21k자가 실려 `relative_valuation` userPrompt의 54%를 차지했다.

새 업종을 추가할 때는 모델 정의 하나와 `PRIORITY` 한 줄만 넣으면 된다. 블록을 통째로
복사하지 말 것.

> **바이오는 업종이 아니라 수익성으로 갈린다.** rNPV는 가치의 대부분이 아직 팔지 않은
> 파이프라인에 있는 회사를 위한 방법이다. 이미 이익을 내는 CDMO(삼성바이오로직스 OPM 46%)나
> 바이오시밀러(셀트리온 28%)에 쓰면 벌고 있는 돈을 통째로 빼고 임상 성공확률만 세게 된다.
> `buildPrompt`의 `metrics.opm`이 이 갈림을 맡는다 — 파이프라인이 `stocks` 뷰에서 넘겨준다.

> **접미사로 한국을 판정하지 말 것.** `needsKorBiotech`가 `ticker.includes(".KS")`로
> 판정하고 있었는데, 티커를 표준형(217730)으로 통일한 뒤로 이 조건이 **어떤 한국 종목에도
> 참이 되지 않아** 한국 바이오텍이 하나도 rNPV를 받지 못했다. 강스템바이오텍이 DCF,
> 코오롱티슈진이 SOTP로 갔다. `needsCBDilutionCheck`도 같은 버그였다.
> 판정은 `isKoreanTicker` 하나만 쓴다.

> **미국 전용 판정에는 한국 종목 제외 가드가 필요하다.** 야후 업종명에는 시장 구분이
> 없어서, 한국 조선사(한화오션·HD현대중공업)가 `Aerospace & Defense`로 와서 미국 방산
> 모델(CCAR·EAC 정상화)을 받고 있었다. `needsUS*`·`needsBigTech`는 6자리 숫자 티커를 배제한다.

### 밸류에이션 입력은 `inputs.ts`가 센다

"이 종목 밸류에이션에 무엇이 들어갔나"를 알려면 예전에는 `pipeline.ts`의 `executeStep`
1,783줄을 읽어야 했다. 데이터는 14개 소스에서 병렬로 모이고 컨텍스트는 24곳에서
이어붙는데, 수집이 전부 `.catch(() => null)`이라 **무엇이 빠졌는지 알 수 없었다.**

`lib/valuation/inputs.ts`가 이제 그것을 한 곳에서 센다.

- `collectValuationInputs()` — 가격·주식수·순차입금·재무연도·피어·밴드·부문자료·베타
- `renderInputGaps()` — 빠진 것을 프롬프트에 **"지어내지 마세요"**로 명시
- `describeInputs()` — 로그 한 줄 (`272210 입력 100% (재무 3년, 피어 4, 순부채 ○ …)`)

판정 규칙은 `input-format.ts`(순수 함수)에 있고 `input-format.test.ts`가 지킨다.
`netDebt` 판정을 없애거나 "추정하지 마세요" 문구를 빼면 테스트가 실패하는 것을 확인했다.

> **이 모듈은 읽기만 한다.** 수집은 기존 경로가 그대로 하고 여기서는 저장된 것을 확인한다.
> 그래야 분석이 느려지지 않고, 넣는 것만으로 동작이 바뀌지 않는다.

### `total_debt`와 `net_debt`를 혼동하지 말 것

`ticker_financials`의 두 컬럼은 전혀 다른 값이다.

| 컬럼 | 뜻 | 한화시스템 | 한화에어로 | 삼성전자 |
|---|---|---|---|---|
| `total_debt` | 부채총계(매입채무·충당부채 포함) | 0.79조 | 7.16조 | 25.24조 |
| `net_debt` | **이자부부채 − 현금** (IFRS 코드 집계) | 1.15조 | 5.11조 | **−56.67조** |

기업가치에서 빼야 하는 것은 `net_debt`다. `total_debt`로 계산하면 삼성전자가 순현금
56조인데도 순부채 25조로 잡혀 목표주가가 통째로 어긋난다.

예전에는 `dart-balance.ts`가 IFRS 코드로 정확히 계산해놓고 **프롬프트에 넣은 뒤 버렸다.**
같은 종목을 다시 분석하면 다시 받았고, 다른 코드는 그 값을 볼 수 없었다.
지금은 `saveNetDebt()`가 남긴다.

> `fs_type`에 `'CFS'`와 `'연결'`이 섞여 있어 같은 (종목·연도·보고서)에 행이 둘 생긴다.
> `'연결'` 쪽은 대차대조표 항목이 비어 있으니, 조회할 때 값이 있는 행을 먼저 집을 것.

### 밸류에이션 정확도 장치

목표주가는 **기업가치 − 순차입금**에서 나오므로 두 값이 틀리면 통째로 무너진다.
실제로 한화시스템 분석에서 목표가가 6배 어긋난 적이 있다.

- **순차입금은 실측값을 주입한다** (`lib/dart-balance.ts`). AI에게 추정시키지 말 것.
  IFRS 표준 `account_id`로 매칭한다 — 한글 계정명은 회사마다 달라서
  (SK하이닉스는 유동·비유동 차입금이 둘 다 "차입금") 누락이 생긴다.
  현금은 `현금및현금성자산`만 센다(넉넉히 잡으면 기업가치가 부풀려진다).
- **rNPV 자기검증이 구속력을 갖게 한다** (`lib/valuation/rnpv-audit.ts`).
  프롬프트는 이미 `TAM Sanity Check`와 `Peak Sales 유사약물 Sanity Check`를 지시한다.
  문제는 AI가 그 검증을 수행하고, **빨간불을 계산한 뒤 스스로 끈다**는 것이다.
  메디포스트(1132)는 이렇게 통과했다.

  | 자산 | TAM vs 글로벌 | Peak Sales vs 유사약물 | 결론 |
  |---|---|---|---|
  | 일본 카티스템 | 200% | 750% | "합리적" |
  | 미국 카티스템 | 700% | **3,500%** | "합리적" |

  한 나라의 TAM이 글로벌 시장의 7배일 수는 없다. 이 rNPV가 목표주가 41,325원
  (현재가 5.1배)의 근거였다. 기준(TAM 120%·Peak 300%)을 넘는데 "합리적/타당"으로
  넘기면 QC가 불승인한다. **과대라고 정직하게 적으면 통과시킨다** — 숫자를 억누르는
  것이 아니라 빨간불을 스스로 끄는 것을 막는 장치다.

  > 잡는 것은 **산수 오류가 아니다.** 메디포스트의 계산은 전부 맞았다
  > (TAM = 300만명 × 1,500만원 = 45조원). TAM은 정의상 100% 점유 시 전체 시장이라
  > 전체 환자 수를 곱하는 것이 맞다. 잡는 것은 결론이다.

- **조율도 서버가 검산한다** (`lib/valuation/reconcile-audit.ts`).
  LLM은 조율을 **문장으로 서술만** 하고 숫자는 한쪽을 그대로 쓴다. 메디포스트(분석 1132)에서
  rNPV 41,325원과 피어 9,000원이 359% 벌어졌는데 "rNPV에 더 큰 신뢰를 두어 조율합니다"라고
  써놓고 `base`에 41,325를 넣었다. 한화시스템(1130)은 절대 1,590원 vs 상대 57,126원으로
  3,493% 벌어진 채였다. 가중평균과 15% 이상 어긋나면 QC가 즉시 불승인한다.
  시나리오 3개가 같은 값인 것도 잡는다 — 실측 3건 모두 상대가치가 bear=base=bull이었다.
- **모델 판정은 `lib/valuation/pick-model.ts` 하나만 쓴다.** 프롬프트 조립과 QC 조율 검산이
  같은 가중치를 봐야 하는데, 두 곳에서 각자 판정하면 또 엇갈린다. 감지 규칙(`needsXxx`)은
  `ai-agents`가 소유하고 `setFlagDetector()`로 등록한다(순환 참조 회피).
- **SOTP 표는 서버가 검산한다** (`lib/analysis/sotp-audit.ts`).
  `배수 × 기준값 = EV`가 어긋나면 QC가 LLM 판정 없이 즉시 불승인한다.
  프롬프트로 "정확히 계산하라"고 해도 LLM은 산수를 틀린다 — 실제로 EV/Sales가
  1/10로 계산되는 사고가 3건 중 2건에서 나왔다.

> DART 회사코드는 `dart-store.ts`의 `lookupCorpCode()`만 쓸 것.
> `company.json?stock_code=...`는 DART가 규격을 바꿔 더 이상 동작하지 않는다
> (corp_code 필수). 이걸 모르고 쓰면 조용히 null이 되어 재무 수집 전체가 멈춘다.

### 분석 결과의 구조화 저장

AI는 `relative_valuation` 단계에서 두 JSON 블록을 내보낸다 — `FINAL_VALUATION_DATA`
(시나리오별 목표가·절대/상대 평가)와 `SEGMENT_FORECAST_DATA`(부문별 실적 전망).
이를 `analysis_valuations` / `analysis_segment_forecasts`에 저장한다.
파싱은 `artifacts/api-server/src/lib/analysis/valuation-extract.ts`,
저장은 같은 폴더의 `valuation-store.ts`, 훅은 `pipeline.ts`의 스텝 저장 직후.

**프롬프트에서 이 블록들의 형식을 바꾸면 파서가 조용히 빈손이 된다.**
`valuation-extract.test.ts`가 실제 분석 본문을 픽스처로 쓰고 있으니 함께 갱신할 것.

### 업종 배수는 손으로 적지 말 것 — 실측 밴드가 진실이다

프롬프트에 들어가는 업종 PER·PBR·P/S 범위는 **`sector_multiple_bands` 테이블 하나**가
소유한다. `lib/valuation/sector-bands.ts`가 매일 장마감 후 `stocks` 뷰에서 사분위수를
집계해 채우고, `pipeline.ts`가 그 값을 프롬프트에 넣는다.

**왜 이렇게까지 하는가.** 예전에는 같은 규칙이 네 곳에 손으로 적혀 있었고 숫자가 서로
달랐다. 그리고 무엇보다 **적어둔 시점에 얼어붙어 틀린 값이 됐다.**

| | 코드에 적혀 있던 값 | 2026-07 실측 |
|---|---|---|
| 한국 방산 PER | 12~28x | 중앙값 26.4x |
| 한국 방산 EV/Sales | **20~60x** (스페이스X 비교군) | **P/S 중앙값 2.1x** |
| 한국 건설 PBR | 0.3~0.6x | 중앙값 0.57x, 상위25% 1.00x |

방산 EV/Sales가 특히 나빴다. 야후가 한화시스템 업종을 `Aerospace & Defense`로 주는데,
`pipeline.ts`의 정규식이 `aerospace`만 보고 미국 뉴스페이스 규칙을 붙였다. 20배만
적용해도 시총이 76조(실제 12.8조)가 된다. KIS 분류로는 "전자부품 제조업"이다.

지켜야 할 것:

- **`SECTOR_PRIORS`(`routes/performance.ts`)에 배수 범위를 새로 적지 말 것.** 이 표는
  WACC·Terminal g·피어 **이름**·실측 편향 하드캡을 맡는다. EV/EBITDA만 예외로 남아
  있는데, EBITDA를 저장하지 않아 아직 실측할 수 없기 때문이다.
- 이 표는 Gemini(`runSectorPriorUpdateAgent`)가 자동으로 다시 쓴다. 그래서 프롬프트
  규칙 5번에 "배수를 숫자로 적지 말라"를 넣어뒀다 — 지우면 정리한 것이 되돌아온다.
- **표본이 부족하면 숫자를 지어내지 않는다.** `MIN_SAMPLES`(5) 미만이면 밴드를 빼고
  "개별 확인하라"고만 말한다. 틀린 숫자는 없는 숫자보다 나쁘다.
- 업종 판정은 `classifySector` 하나만 쓴다. 세 번째 인자는 회사명이 아니라 **KIS 업종**이다.
- 밴드는 시가총액 기준 P/S다(순부채가 전 종목에 없다). EV/Sales로 쓰려면 보정이 필요하고,
  프롬프트에도 그렇게 적혀 있다.

`band-format.test.ts`가 이 규칙들을 지킨다. `MIN_SAMPLES`를 0으로 바꾸거나 음수 PER을
통과시키면 실패하는 것을 확인했다.

### 알려진 과제 (종목 DB 기초공사)

해결됨: 티커 표준화 관문(`lib/shared/ticker.ts`), 지표 캐시 적중률 0% 수리,
DART 재무 저장 복구, 미국 목록 SEC 전환 + 자가 치유, 조회용 `stocks` 뷰.

남은 것:
- `krx_stocks` / `us_stocks` 실제 병합 (호스팅 이관 후).
- `analyses`가 종목 마스터를 참조하지 않는다. **외래키는 테이블 병합 전에는 불가능하다**
  — `analyses.ticker`가 한국이면 `krx_stocks`, 미국이면 `us_stocks`를 가리켜야 하는데
  한 컬럼이 두 테이블을 조건부로 참조할 수 없고, `stocks`는 뷰라 참조 대상이 못 된다.
- `krx_stocks`의 PER·PBR은 KIS 기반 수집 코드가 배포돼야 채워진다(현재 0건).
- FMP 연동은 v3 폐기로 전량 실패해 **제거하기로 결론**났다(요금제상 한국 종목 재무
  불가, 야후 `quoteSummary`와 중복). 작업이 별도 브랜치에 있으니 병합 후
  `fmp-client.ts` 참조가 남아 있지 않은지 확인할 것. 운영 DB의 `fmp_cache` 테이블은
  고아로 남는다.

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
