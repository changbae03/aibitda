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

## AI Model Self-Calibration System

30일 이상 된 완료 분석을 실제 주가와 비교하여 섹터별 편향을 측정하고, 이후 분석 프롬프트에 자동 주입하는 피드백 루프.

- **보정 계산**: `POST /api/performance/recalculate` (관리자 전용) — Yahoo Finance 현재가 조회 → 방향 적중률 + 목표주가 편향 계산 → model_calibration 업데이트
- **보정값 조회**: `GET /api/performance/calibration` — 전체 섹터 보정 데이터 조회
- **자동 주입**: `buildPrompt()` 함수가 `relative_valuation`·`investment_strategy` 단계에서 해당 섹터 보정값을 시스템 프롬프트에 주입
- **섹터 분류**: KR/US × 산업군(바이오, 반도체, 금융, 건설, 통신, 리츠 등) 조합으로 12개 섹터 분류
- **최소 샘플 3건** 이상일 때만 보정값 활성화 (데이터 부족 시 기존 프롬프트 유지)

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
