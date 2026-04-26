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

    console.log("Database migrations completed successfully");
  } finally {
    client.release();
  }
}
