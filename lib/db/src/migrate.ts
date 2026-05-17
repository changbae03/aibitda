import { pool } from "./index";

export async function runMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS analyses (
        id SERIAL PRIMARY KEY,
        ticker TEXT NOT NULL,
        company_name TEXT NOT NULL,
        industry TEXT NOT NULL,
        additional_context TEXT,
        status TEXT NOT NULL DEFAULT 'in_progress',
        current_step TEXT,
        investment_verdict TEXT,
        target_price REAL,
        entry_price REAL,
        stop_loss REAL,
        risk_reward_ratio REAL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS analysis_steps (
        id SERIAL PRIMARY KEY,
        analysis_id INTEGER NOT NULL REFERENCES analyses(id),
        step_key TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        content TEXT NOT NULL,
        validation_notes TEXT,
        information_type TEXT NOT NULL DEFAULT 'data_based_estimate',
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_insights (
        id SERIAL PRIMARY KEY,
        analysis_id INTEGER,
        ticker TEXT NOT NULL,
        company_name TEXT NOT NULL,
        industry TEXT NOT NULL,
        verdict TEXT,
        entry_price REAL,
        target_price REAL,
        stop_loss REAL,
        price_at_review REAL,
        price_return REAL,
        days_elapsed INTEGER,
        outcome TEXT NOT NULL DEFAULT 'pending',
        lesson TEXT,
        analysis_date TIMESTAMP,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hypotheses (
        id SERIAL PRIMARY KEY,
        analysis_id INTEGER,
        ticker TEXT NOT NULL,
        company_name TEXT NOT NULL,
        hypothesis_text TEXT NOT NULL,
        target_price REAL NOT NULL,
        entry_price REAL NOT NULL,
        actual_price REAL,
        time_horizon TEXT,
        catalysts TEXT,
        risks TEXT,
        outcome TEXT NOT NULL DEFAULT 'pending',
        accuracy_score REAL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    // 컬럼 추가 마이그레이션 (이미 존재하면 무시)
    await client.query(`
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS english_name TEXT;
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS user_id TEXT;
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS is_public TEXT NOT NULL DEFAULT 'true';
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS memo TEXT;
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS user_rating INTEGER;
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS user_feedback TEXT;
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS start_price REAL;
    `);

    // model_insights: 방향성 일치 여부 컬럼
    await client.query(`
      ALTER TABLE model_insights ADD COLUMN IF NOT EXISTS direction_match BOOLEAN;
    `);

    // model_insights: 밸류에이션 방법론 + 목표주가 달성도
    await client.query(`
      ALTER TABLE model_insights ADD COLUMN IF NOT EXISTS valuation_method TEXT;
      ALTER TABLE model_insights ADD COLUMN IF NOT EXISTS target_achievement_pct REAL;
    `);

    // analysis_steps UNIQUE 제약 (캐시 ON CONFLICT DO NOTHING 사용)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'analysis_steps_analysis_id_step_key_key'
        ) THEN
          ALTER TABLE analysis_steps
            ADD CONSTRAINT analysis_steps_analysis_id_step_key_key
            UNIQUE (analysis_id, step_key);
        END IF;
      END $$;
    `);

    // 크레딧 & 추천인 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_credits (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        daily_used INTEGER NOT NULL DEFAULT 0,
        daily_limit INTEGER NOT NULL DEFAULT 3,
        daily_reset_date TEXT NOT NULL DEFAULT '',
        bonus_credits INTEGER NOT NULL DEFAULT 0,
        referral_code TEXT UNIQUE,
        total_analyses INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS referral_uses (
        id SERIAL PRIMARY KEY,
        referral_code TEXT NOT NULL,
        referee_id TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    // user_credits 확장: 유저 등급 + 관리자 메모 + 닉네임
    await client.query(`
      ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS tier VARCHAR NOT NULL DEFAULT 'free';
      ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS admin_memo TEXT NOT NULL DEFAULT '';
      ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS display_name TEXT;
    `);

    // 시스템 설정 테이블 (공지 배너 등 key-value)
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    // 종목별 관리자 보정 메모 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticker_notes (
        ticker TEXT PRIMARY KEY,
        memo TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      ALTER TABLE ticker_notes ADD COLUMN IF NOT EXISTS auto_learning TEXT NOT NULL DEFAULT '';
    `);

    // 관리자 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        user_id TEXT PRIMARY KEY,
        display_name TEXT,
        added_by TEXT,
        added_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    // 재실행 스케줄 테이블
    await client.query(`
      CREATE TABLE IF NOT EXISTS analysis_schedules (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        ticker TEXT NOT NULL,
        company_name TEXT NOT NULL,
        industry TEXT,
        additional_context TEXT,
        frequency TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        next_run_at TIMESTAMP NOT NULL,
        last_run_at TIMESTAMP,
        last_analysis_id INTEGER,
        source_analysis_id INTEGER,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    // 티커별 지표 캐시 (PBR 등 Yahoo/Naver 폴백 실패 시 재활용)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticker_metric_cache (
        ticker TEXT PRIMARY KEY,
        pbr REAL,
        per_trailing REAL,
        per_fwd REAL,
        ev_ebitda REAL,
        roe REAL,
        operating_margin REAL,
        market_cap REAL,
        book_value REAL,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    // 토큰 비용 트래킹
    await client.query(`
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS token_count INTEGER DEFAULT 0;
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS estimated_cost_usd REAL DEFAULT 0;
    `);

    // 프로모 코드
    await client.query(`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        description TEXT,
        credit_amount INTEGER NOT NULL DEFAULT 0,
        tier_upgrade TEXT,
        max_uses INTEGER,
        uses_count INTEGER NOT NULL DEFAULT 0,
        expires_at TIMESTAMP,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
      CREATE TABLE IF NOT EXISTS promo_code_uses (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL,
        user_id TEXT NOT NULL,
        used_at TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE(code, user_id)
      );
    `);

    // 카카오 이메일 저장
    await client.query(`
      ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS email TEXT;
    `);

    // 마지막 로그인 시각
    await client.query(`
      ALTER TABLE user_credits ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
    `);

    // KRX 업종 피어 데이터 (밸류에이션 비교용)
    await client.query(`
      CREATE TABLE IF NOT EXISTS krx_peer_data (
        id            SERIAL PRIMARY KEY,
        code          VARCHAR(10) NOT NULL,
        name          VARCHAR(100) NOT NULL,
        market        VARCHAR(10) NOT NULL,
        sector        VARCHAR(50) NOT NULL,
        pbr           NUMERIC(10,2),
        per           NUMERIC(10,2),
        bps           NUMERIC(14,2),
        eps           NUMERIC(14,2),
        mcap          BIGINT,
        snapshot_date DATE NOT NULL,
        created_at    TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS krx_peer_data_code_date_idx
        ON krx_peer_data(code, snapshot_date);
    `);

    // 언어 설정 (영어 모드)
    await client.query(`
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'ko';

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        language VARCHAR(5) NOT NULL DEFAULT 'ko',
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL
      );
    `);

    // 캘리브레이션 히스토리
    await client.query(`
      CREATE TABLE IF NOT EXISTS calibration_history (
        id SERIAL PRIMARY KEY,
        sector TEXT NOT NULL,
        market TEXT NOT NULL,
        direction_accuracy REAL,
        avg_price_deviation REAL,
        sample_count INTEGER NOT NULL DEFAULT 0,
        recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // 프롬프트 버전 관리
    await client.query(`
      CREATE TABLE IF NOT EXISTS prompt_versions (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        stage TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        ab_group TEXT,
        is_active BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // analyses 완료 시각 컬럼
    await client.query(`
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
      ALTER TABLE analyses ADD COLUMN IF NOT EXISTS error_message TEXT;
    `);

    // ── [v2] Kakao user_id 접두사 통합 마이그레이션 ──────────────────────────
    // auth.ts 콜백이 과거에 raw Kakao ID(숫자만)로 user_credits를 생성했고,
    // credits.ts getUserId()는 kakao_${id} 형식을 사용해 두 레코드가 생겼음.
    // 이 마이그레이션은 raw ID 레코드를 kakao_ 접두사 레코드로 통합한다.
    await client.query(`
      DO $$
      DECLARE
        raw_rec RECORD;
        prefixed_id TEXT;
      BEGIN
        -- 케이스 1: kakao_ 접두사 레코드가 이미 있는 경우
        -- → display_name/email 이전 후 raw 레코드 삭제
        FOR raw_rec IN
          SELECT uc_raw.user_id, uc_raw.display_name, uc_raw.email
          FROM user_credits uc_raw
          WHERE uc_raw.user_id ~ '^[0-9]+$'
            AND EXISTS (
              SELECT 1 FROM user_credits
              WHERE user_id = 'kakao_' || uc_raw.user_id
            )
        LOOP
          prefixed_id := 'kakao_' || raw_rec.user_id;

          -- display_name/email 이전 (kakao_ 레코드가 NULL인 경우에만)
          UPDATE user_credits
          SET display_name = COALESCE(display_name, raw_rec.display_name),
              email = COALESCE(email, raw_rec.email)
          WHERE user_id = prefixed_id;

          -- analyses 소유권 이전 (혹시 raw ID로 분석이 있다면)
          UPDATE analyses
          SET user_id = prefixed_id
          WHERE user_id = raw_rec.user_id;

          -- analysis_schedules 이전
          UPDATE analysis_schedules
          SET user_id = prefixed_id
          WHERE user_id = raw_rec.user_id;

          -- referral_uses referee_id 이전
          UPDATE referral_uses
          SET referee_id = prefixed_id
          WHERE referee_id = raw_rec.user_id;

          -- raw 레코드 삭제
          DELETE FROM user_credits WHERE user_id = raw_rec.user_id;
        END LOOP;

        -- 케이스 2: raw ID 레코드만 있고 kakao_ 레코드가 없는 경우
        -- → user_id 자체를 kakao_ 접두사로 변경
        FOR raw_rec IN
          SELECT user_id FROM user_credits
          WHERE user_id ~ '^[0-9]+$'
            AND NOT EXISTS (
              SELECT 1 FROM user_credits
              WHERE user_id = 'kakao_' || user_credits.user_id
            )
        LOOP
          prefixed_id := 'kakao_' || raw_rec.user_id;

          UPDATE analyses
          SET user_id = prefixed_id
          WHERE user_id = raw_rec.user_id;

          UPDATE analysis_schedules
          SET user_id = prefixed_id
          WHERE user_id = raw_rec.user_id;

          UPDATE referral_uses
          SET referee_id = prefixed_id
          WHERE referee_id = raw_rec.user_id;

          UPDATE user_credits
          SET user_id = prefixed_id
          WHERE user_id = raw_rec.user_id;
        END LOOP;
      END $$;
    `);
    // ─────────────────────────────────────────────────────────────────────────

    // model_calibration 테이블 (섹터 재보정 통계)
    await client.query(`
      CREATE TABLE IF NOT EXISTS model_calibration (
        id                   SERIAL PRIMARY KEY,
        sector               TEXT NOT NULL,
        market               TEXT NOT NULL DEFAULT 'KR',
        direction_accuracy   REAL,
        avg_price_deviation  REAL,
        sample_count         INTEGER NOT NULL DEFAULT 0,
        sector_benchmarks    JSONB,
        last_recalc_at       TIMESTAMPTZ DEFAULT NOW(),
        created_at           TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE (sector, market)
      );
    `);

    // sector_benchmarks 컬럼 — 기존 테이블에 없으면 추가
    await client.query(`
      ALTER TABLE model_calibration
        ADD COLUMN IF NOT EXISTS sector_benchmarks JSONB;
    `);

    // ticker_financials 테이블 (DART 시계열 재무 데이터)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticker_financials (
        id          SERIAL PRIMARY KEY,
        ticker      TEXT NOT NULL,
        bsns_year   TEXT NOT NULL,
        reprt_code  TEXT NOT NULL,
        fs_type     TEXT NOT NULL,
        account_nm  TEXT NOT NULL,
        thstrm_amount  BIGINT,
        frmtrm_amount  BIGINT,
        bfefrmtrm_amount BIGINT,
        thstrm_add_amount BIGINT,
        currency    TEXT DEFAULT 'KRW',
        fetched_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        UNIQUE (ticker, bsns_year, reprt_code, fs_type, account_nm)
      );
      CREATE INDEX IF NOT EXISTS idx_ticker_financials_ticker
        ON ticker_financials (ticker, bsns_year DESC);
    `);

    // ── 성능 인덱스 ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analyses_user_id_created_at
        ON analyses (user_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_analysis_steps_analysis_id
        ON analysis_steps (analysis_id);

      CREATE INDEX IF NOT EXISTS idx_analyses_ticker
        ON analyses (ticker);

      CREATE INDEX IF NOT EXISTS idx_analyses_status_created_at
        ON analyses (status, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_analyses_public_status
        ON analyses (is_public, status, created_at DESC)
        WHERE status = 'completed';

      CREATE INDEX IF NOT EXISTS idx_model_insights_ticker
        ON model_insights (ticker, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_model_insights_outcome
        ON model_insights (outcome);

      CREATE INDEX IF NOT EXISTS idx_model_insights_industry_outcome
        ON model_insights (industry, outcome);

      CREATE INDEX IF NOT EXISTS idx_analysis_schedules_next_run
        ON analysis_schedules (next_run_at ASC)
        WHERE enabled = true;

      CREATE INDEX IF NOT EXISTS idx_calibration_history_sector
        ON calibration_history (sector, recorded_at DESC);
    `);

    // share_pending: 공유 대기 컬럼 추가 (자기 자신 공유 방지)
    await client.query(`
      ALTER TABLE user_credits
        ADD COLUMN IF NOT EXISTS share_pending_analysis_id INTEGER,
        ADD COLUMN IF NOT EXISTS share_pending_at TIMESTAMPTZ;
    `);

    console.log("Database migrations completed successfully");
  } finally {
    client.release();
  }
}
