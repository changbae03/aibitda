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

    console.log("Database migrations completed successfully");
  } finally {
    client.release();
  }
}
