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

    // ticker_financials는 여기서 만들지 않는다 — 소유자는
    // artifacts/api-server/src/lib/dart-store.ts (ensureTable).
    //
    // [수리] 과거 이 파일에도 account_nm 기반 정의가 있었고 그쪽이 먼저 실행돼 이겼다.
    // 그 결과 실제 테이블은 account_nm NOT NULL + 5컬럼 UNIQUE를 갖게 됐는데,
    // 데이터를 넣는 dart-store/financial-context는 account_nm을 채우지 않고
    // ON CONFLICT (ticker, bsns_year, reprt_code, fs_type) 4컬럼에 의존한다.
    // → 모든 INSERT가 NOT NULL 위반으로 실패해 테이블이 0행이었다(2026-07-25 실 DB 확인).
    // 아래는 그 상태를 되돌리는 멱등 수리다. 표가 비어 있어 데이터 손실 위험은 없다.
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='ticker_financials') THEN

          -- account_nm은 계정과목 방식의 잔재다. 지표 방식 INSERT를 막지 않도록 NULL 허용.
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='ticker_financials'
                       AND column_name='account_nm' AND is_nullable='NO') THEN
            ALTER TABLE ticker_financials ALTER COLUMN account_nm DROP NOT NULL;
          END IF;

          -- bsns_year도 두 방식이 TEXT/INTEGER로 갈렸다. TEXT면 숫자도 그대로 들어가므로 유지.

          -- ON CONFLICT가 요구하는 4컬럼 UNIQUE가 없으면 추가.
          -- (5컬럼 UNIQUE는 account_nm이 NULL이면 중복을 막지 못하므로 4컬럼이 실질 키다.)
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid='ticker_financials'::regclass AND contype='u'
              AND conname='ticker_financials_ticker_year_reprt_fs_key'
          ) THEN
            ALTER TABLE ticker_financials
              ADD CONSTRAINT ticker_financials_ticker_year_reprt_fs_key
              UNIQUE (ticker, bsns_year, reprt_code, fs_type);
          END IF;
        END IF;
      END $$;
    `);

    // [수리] ticker_metric_cache의 티커 표기 통일.
    // 저장은 야후 심볼(005930.KS), 조회는 표준형(005930)으로 갈려 적중률이 0%였다
    // (2026-07-25 실 DB 확인: 한국 종목 120개 중 0개 적중). 코드는 normalizeTicker로
    // 통일했고, 여기서는 기존 행의 접미사를 떼어 과거 캐시를 되살린다.
    // 표준형 행이 이미 있으면 최신 것만 남긴다.
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema='public' AND table_name='ticker_metric_cache') THEN

          DELETE FROM ticker_metric_cache old
          WHERE old.ticker ~ '\\.(KS|KQ)$'
            AND EXISTS (
              SELECT 1 FROM ticker_metric_cache cur
              WHERE cur.ticker = regexp_replace(old.ticker, '\\.(KS|KQ)$', '')
                AND cur.updated_at >= old.updated_at
            );

          UPDATE ticker_metric_cache
          SET ticker = regexp_replace(ticker, '\\.(KS|KQ)$', '')
          WHERE ticker ~ '\\.(KS|KQ)$';
        END IF;
      END $$;
    `);

    // ── 종목 통합 조회 창구 ──────────────────────────────────────────────────
    // 종목 마스터는 시장별로 krx_stocks / us_stocks로 나뉘어 있고 컬럼 구성은
    // 사실상 같다(공통 21개, 타입 전부 일치). 이름표만 code / ticker로 다르다.
    //
    // 두 테이블을 실제로 합치지 않고 뷰만 얹는 이유:
    // 운영 서버가 아직 옛 코드로 돌고 있어 krx_stocks·us_stocks를 직접 조회한다.
    // 지금 테이블을 병합하면 그 서버가 즉시 멈춘다. 뷰는 더하기만 하는 변경이라
    // 옛 코드는 그대로 동작하고 새 코드는 창구 하나만 보면 된다.
    // 실제 병합은 배포를 통제할 수 있게 된 뒤(호스팅 이관 후)에 한다.
    //
    // ticker는 양쪽 모두 표준형(접미사 없는 원형)이다 — lib/shared/ticker.ts 참고.
    // 야후 호출용 symbol(005930.KS)은 저장값이 아니라 파생값이므로 뷰에 넣지 않는다.
    await client.query(`
      CREATE OR REPLACE VIEW stocks AS
        SELECT
          k.code          AS ticker,
          'KR'::text      AS market,
          k.name, k.exchange, k.sector, k.industry,
          k.market_cap, k.current_price, k.per, k.pbr, k.roe, k.opm,
          k.rev_growth, k.revenue, k.net_income, k.shares_out, k.beta,
          k.week52_high, k.week52_low,
          k.data_fetched, k.fetch_error, k.last_updated
        FROM krx_stocks k
        UNION ALL
        SELECT
          u.ticker        AS ticker,
          'US'::text      AS market,
          u.name, u.exchange, u.sector, u.industry,
          u.market_cap, u.current_price, u.per, u.pbr, u.roe, u.opm,
          u.rev_growth, u.revenue, u.net_income, u.shares_out, u.beta,
          u.week52_high, u.week52_low,
          u.data_fetched, u.fetch_error, u.last_updated
        FROM us_stocks u
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

    // ── krx_stocks: 한국 전체 상장 종목 마스터 테이블 ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS krx_stocks (
        code              VARCHAR(6) PRIMARY KEY,
        name              TEXT NOT NULL,
        exchange          VARCHAR(10) NOT NULL,
        symbol            TEXT,
        sector            TEXT,
        industry          TEXT,
        market_cap        BIGINT,
        current_price     REAL,
        per               REAL,
        pbr               REAL,
        roe               REAL,
        opm               REAL,
        rev_growth        REAL,
        revenue           BIGINT,
        net_income        BIGINT,
        shares_out        BIGINT,
        beta              REAL,
        week52_high       REAL,
        week52_low        REAL,
        data_fetched      BOOLEAN NOT NULL DEFAULT false,
        fetch_error       TEXT,
        last_updated      TIMESTAMPTZ,
        created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_krx_stocks_exchange
        ON krx_stocks (exchange);

      CREATE INDEX IF NOT EXISTS idx_krx_stocks_sector
        ON krx_stocks (sector);

      CREATE INDEX IF NOT EXISTS idx_krx_stocks_data_fetched
        ON krx_stocks (data_fetched, last_updated ASC);
    `);

    // ── us_stocks: 미국 주요 상장 종목 마스터 테이블 ─────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS us_stocks (
        ticker            TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        exchange          VARCHAR(10),
        sector            TEXT,
        industry          TEXT,
        market_cap        BIGINT,
        current_price     REAL,
        per               REAL,
        pbr               REAL,
        roe               REAL,
        opm               REAL,
        rev_growth        REAL,
        revenue           BIGINT,
        net_income        BIGINT,
        shares_out        BIGINT,
        beta              REAL,
        week52_high       REAL,
        week52_low        REAL,
        data_fetched      BOOLEAN NOT NULL DEFAULT false,
        fetch_error       TEXT,
        last_updated      TIMESTAMPTZ,
        created_at        TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_us_stocks_sector
        ON us_stocks (sector);

      CREATE INDEX IF NOT EXISTS idx_us_stocks_exchange
        ON us_stocks (exchange);

      CREATE INDEX IF NOT EXISTS idx_us_stocks_data_fetched
        ON us_stocks (data_fetched, last_updated ASC);
    `);

    // ML 모델 DB 저장 (재배포 후 즉시 복원용)
    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_models (
        symbol      VARCHAR(10)  PRIMARY KEY,
        model_data  TEXT         NOT NULL,
        version     INTEGER      NOT NULL,
        trained_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ml_model_meta (
        id          INTEGER      PRIMARY KEY DEFAULT 1,
        meta_data   TEXT         NOT NULL,
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);

    // 섹터 밸류에이션 보정 지침 (DB 편집 가능)
    await client.query(`
      CREATE TABLE IF NOT EXISTS sector_priors (
        sector          TEXT        PRIMARY KEY,
        wacc_range      TEXT        NOT NULL DEFAULT '',
        terminal_g      TEXT        NOT NULL DEFAULT '',
        peers_note      TEXT        NOT NULL DEFAULT '',
        bias_risk       TEXT        NOT NULL DEFAULT '',
        specific_levers JSONB       NOT NULL DEFAULT '[]',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── 외래키 제약 추가 (drizzle 스키마의 .references()와 일치) ──────────────
    // NOT VALID: 기존 행에 고아 데이터가 있어도 실패하지 않고, 새로 쓰는 행부터 검증한다.
    // 제약 이름은 drizzle-kit push가 생성하는 이름과 동일하게 맞춰 중복 생성을 방지.
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'hypotheses_analysis_id_analyses_id_fk'
        ) THEN
          ALTER TABLE hypotheses
            ADD CONSTRAINT hypotheses_analysis_id_analyses_id_fk
            FOREIGN KEY (analysis_id) REFERENCES analyses(id)
            ON DELETE SET NULL NOT VALID;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'model_insights_analysis_id_analyses_id_fk'
        ) THEN
          ALTER TABLE model_insights
            ADD CONSTRAINT model_insights_analysis_id_analyses_id_fk
            FOREIGN KEY (analysis_id) REFERENCES analyses(id)
            ON DELETE SET NULL NOT VALID;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'referral_uses_referral_code_user_credits_referral_code_fk'
        ) THEN
          ALTER TABLE referral_uses
            ADD CONSTRAINT referral_uses_referral_code_user_credits_referral_code_fk
            FOREIGN KEY (referral_code) REFERENCES user_credits(referral_code)
            NOT VALID;
        END IF;
      END $$;
    `);

    console.log("Database migrations completed successfully");
  } finally {
    client.release();
  }
}
