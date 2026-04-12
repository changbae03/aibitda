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
    console.log("Database migrations completed successfully");
  } finally {
    client.release();
  }
}
