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

- `analyses` - 분석 세션 (ticker, company, status, verdict, prices)
- `analysis_steps` - 각 에이전트 분석 결과
- `hypotheses` - 투자 가설 추적 (outcome, accuracy scoring)

## API Routes

- `POST /api/analysis` - 새 분석 시작
- `GET /api/analysis` - 분석 목록
- `GET /api/analysis/:id` - 분석 상세
- `POST /api/analysis/:id/step` - 분석 스텝 실행
- `GET /api/hypotheses` - 가설 목록
- `POST /api/hypotheses` - 가설 생성
- `PATCH /api/hypotheses/:id` - 가설 업데이트

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json`. Run `pnpm run typecheck` from root.

## Package Scripts

- `pnpm --filter @workspace/api-server run dev` - API 서버
- `pnpm --filter @workspace/hedge-fund-ai run dev` - 프론트엔드
- `pnpm --filter @workspace/db run push` - DB 스키마 push
- `pnpm --filter @workspace/api-spec run codegen` - API 코드젠
