# AI 헤지펀드 리서치 플랫폼

## Overview

AI 기반 헤지펀드 리서치 플랫폼. 팀장(Lead Portfolio Strategist) + 8명의 전문 AI 분석가로 구성된 조직이 종목 분석을 수행하고 투자 가설을 추적한다.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/hedge-fund-ai)
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **AI**: OpenAI via Replit AI Integrations (gpt-5.2)
- **Validation**: Zod (zod/v4), drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **UI**: Tailwind CSS + shadcn/ui, framer-motion, recharts

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── hedge-fund-ai/      # React frontend (preview at /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas
│   └── db/                 # Drizzle ORM schema + DB connection
```

## AI Research Organization

### 8 Specialist Agents
- **Agent 1** - Global Macro Strategist: 거시 환경 분석
- **Agent 2** - Industry Structure Analyst: 산업 구조 분석
- **Agent 3** - Fundamental Analyst: 기업 펀더멘탈 분석
- **Agent 4** - Valuation Specialist: 밸류에이션
- **Agent 5** - Market Microstructure Analyst: 수급 분석
- **Agent 6** - Technical Strategist: 기술적 분석
- **Agent 7** - Catalyst Hunter: 촉매 탐지
- **Agent 8** - Smart Money Tracker: 세력 탐지

### Lead Portfolio Strategist (팀장)
- 1:1 인터뷰 방식으로 각 단계 검증
- 최종 투자 전략 도출

## Analysis Flow

Step 1: industry_structure → Step 2: macro → Step 3: fundamental →
Step 4: valuation → Step 5: market_microstructure → Step 6: technical →
Step 7: catalyst → Step 8: smart_money → Step 9: lead_validation (final verdict)

## Database Schema

- `analyses` - 분석 세션 (ticker, company, status, verdict, prices, token_count, estimated_cost_usd)
- `analysis_steps` - 각 에이전트 분석 결과
- `hypotheses` - 투자 가설 추적 (outcome, accuracy scoring)
- `user_credits` - 유저 크레딧·등급 관리 (tier: free/beta/premium)
- `analysis_schedules` - 재실행 스케줄 (cron)
- `ticker_notes` - 종목별 관리자 메모·자동학습 데이터
- `promo_codes` - 프로모 코드 (credit_amount, tier_upgrade, max_uses)
- `promo_code_uses` - 프로모 코드 사용 이력 (unique per user)
- `model_calibration` - 섹터별 AI 모델 성과 보정 데이터 (direction_accuracy, avg_price_deviation, sample_count)

## KIS Open API 실시간 데이터 통합

한국투자증권 Open API(실전투자)로 한국 주식 실시간 데이터를 AI 분석에 주입.

- **파일**: `artifacts/api-server/src/lib/kis-client.ts`
- **토큰 관리**: OAuth2 client_credentials 자동 발급·캐싱 (24h, 5min 버퍼)
- **주입 시점 1**: 분석 시작 시 `buildKISStockContext(krxCode)` → 전 단계 공통 컨텍스트에 현재가·52주 고저·PER·PBR·EPS·BPS 주입
- **주입 시점 2**: `relative_valuation` 단계의 `getKRXSectorPeerContext()` → 피어 상위 15개 종목 KIS 실시간 PER/PBR/ROE 보강 (KRX 정적 스냅샷 fallback)
- **ROE 계산**: KIS `inquire-price` API에 ROE 필드 없음 → EPS/BPS 비율로 직접 산출
- **환경 변수**: `KIS_APP_KEY`, `KIS_APP_SECRET` (Replit Secrets)

## AI Model Self-Calibration System

30일 이상 된 완료 분석을 실제 주가와 비교하여 섹터별 편향을 측정하고, 이후 분석 프롬프트에 자동 주입하는 피드백 루프.

- **보정 계산**: `POST /api/performance/recalculate` (관리자 전용) — Yahoo Finance 현재가 조회 → 방향 적중률 + 목표주가 편향 계산 → model_calibration 업데이트
- **보정값 조회**: `GET /api/performance/calibration` — 전체 섹터 보정 데이터 조회
- **자동 주입**: `buildPrompt()` 함수가 `relative_valuation`·`investment_strategy` 단계에서 해당 섹터 보정값을 시스템 프롬프트에 주입
- **섹터 분류**: KR/US × 산업군(바이오, 반도체, 금융, 건설, 통신, 리츠 등) 조합으로 12개 섹터 분류
- **최소 샘플 3건** 이상일 때만 보정값 활성화 (데이터 부족 시 기존 프롬프트 유지)

## UI/UX Design System

- **브랜드 컬러**: `#FF8A7A` (코랄/살몬)
- **폰트**: Pretendard (한국어 최적화), Spoqa Han Sans Neo (브랜드 워드마크)
- **다크 모드**: Deep Navy (`222 47% 8%`) 배경
- **사이드바**: 아이콘(Sparkles/BookOpen/CalendarDays/BarChart2) + 브랜드 컬러 active state + 사용자 프로필/크레딧 도트 표시
- **랜딩 우측**: 실제 분석 결과 미리보기 데모 (주가 카드 + 지표 그리드 + 파이프라인)
- **애니메이션**: framer-motion (페이지 전환, 드롭다운, 모달)
- **핵심 컴포넌트**: `app-layout.tsx` (사이드바+레이아웃), `landing.tsx` (랜딩), `analysis-detail.tsx` (리포트)

## API Routes

- `POST /api/analysis` - 새 분석 시작
- `GET /api/analysis` - 분석 목록
- `GET /api/analysis/:id` - 분석 상세
- `POST /api/analysis/:id/step` - 분석 스텝 실행
- `GET /api/hypotheses` - 가설 목록
- `POST /api/hypotheses` - 가설 생성
- `PATCH /api/hypotheses/:id` - 가설 업데이트
- `GET /api/market-data/etf-inclusion/:ticker` - ETF 편입 현황 (Yahoo Finance 글로벌 + Gemini AI 국내 ETF 추정)
- `GET /api/market-data/peer-group/:ticker` - AI Peer Group 분석 (Gemini gemini-2.5-flash)

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json`. Run `pnpm run typecheck` from root.

## Package Scripts

- `pnpm --filter @workspace/api-server run dev` - API 서버
- `pnpm --filter @workspace/hedge-fund-ai run dev` - 프론트엔드
- `pnpm --filter @workspace/db run push` - DB 스키마 push
- `pnpm --filter @workspace/api-spec run codegen` - API 코드젠
