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

      -- 누가 어떤 보고서를 읽었는지. "총 분석 수"는 만든 횟수지 읽은 횟수가 아니라
      -- 운영 화면의 숫자가 실제 사용과 어긋나 있었다.
      CREATE TABLE IF NOT EXISTS analysis_views (
        id SERIAL PRIMARY KEY,
        analysis_id INTEGER NOT NULL REFERENCES analyses(id),
        user_id TEXT NOT NULL,
        ticker TEXT,
        viewed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_views_user ON analysis_views (user_id, viewed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_views_ticker ON analysis_views (ticker, viewed_at DESC);
      -- 30분 내 재열람을 걸러내는 조회가 (analysis_id, user_id, viewed_at)로 들어온다.
      CREATE INDEX IF NOT EXISTS idx_analysis_views_dedupe ON analysis_views (analysis_id, user_id, viewed_at DESC);

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

          -- 같은 종목이 표준형·접미사형 두 행으로 있으면 오래된 쪽을 버린다.
          -- 어느 쪽이 최신인지 모르므로 양방향을 모두 처리해야 한다. 한쪽만 지우면
          -- 이어지는 이름 변경에서 기본키가 충돌해 마이그레이션 전체가 실패한다.
          DELETE FROM ticker_metric_cache a
           USING ticker_metric_cache b
           WHERE a.ticker ~ '\\.(KS|KQ)$'
             AND b.ticker = regexp_replace(a.ticker, '\\.(KS|KQ)$', '')
             AND a.updated_at <= b.updated_at;   -- 접미사형이 더 오래됨

          DELETE FROM ticker_metric_cache b
           USING ticker_metric_cache a
           WHERE a.ticker ~ '\\.(KS|KQ)$'
             AND b.ticker = regexp_replace(a.ticker, '\\.(KS|KQ)$', '')
             AND a.updated_at > b.updated_at;    -- 접미사형이 더 최신

          -- 짝이 없어진 접미사형만 남았으므로 이제 안전하게 이름을 정리한다.
          UPDATE ticker_metric_cache
          SET ticker = regexp_replace(ticker, '\\.(KS|KQ)$', '')
          WHERE ticker ~ '\\.(KS|KQ)$';
        END IF;
      END $$;
    `);

    // ── 밸류에이션·실적전망 구조화 저장 ──────────────────────────────────────
    // AI는 relative_valuation 단계에서 FINAL_VALUATION_DATA와 SEGMENT_FORECAST_DATA를
    // JSON으로 내보낸다. 예전에는 그중 base 하나만 analyses.target_price로 옮기고
    // 나머지를 버렸다. 근거 수치를 남겨야 목표가 변화 추적과 "예상 vs 실제" 대조가 된다.
    await client.query(`
      CREATE TABLE IF NOT EXISTS analysis_valuations (
        id             SERIAL PRIMARY KEY,
        analysis_id    INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        ticker         TEXT NOT NULL,
        current_price  REAL,
        bear           REAL,
        base           REAL,
        bull           REAL,
        abs_model      TEXT,
        abs_bear       REAL,
        abs_base       REAL,
        abs_bull       REAL,
        rel_bear       REAL,
        rel_base       REAL,
        rel_bull       REAL,
        created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT analysis_valuations_analysis_id_key UNIQUE (analysis_id)
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_valuations_ticker
        ON analysis_valuations (ticker, created_at DESC);

      CREATE TABLE IF NOT EXISTS analysis_segment_forecasts (
        id               SERIAL PRIMARY KEY,
        analysis_id      INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        ticker           TEXT NOT NULL,
        segment_name     TEXT NOT NULL,
        currency         TEXT NOT NULL DEFAULT 'KRW',
        fiscal_year      INTEGER NOT NULL,
        revenue          REAL,
        operating_income REAL,
        created_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT analysis_segment_forecasts_uniq UNIQUE (analysis_id, segment_name, fiscal_year)
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_segment_forecasts_ticker
        ON analysis_segment_forecasts (ticker, fiscal_year);

      -- 이 값을 믿어도 되는가. 저장 시점에 검산해 함께 남긴다.
      --
      -- 분석은 종목당 여러 번 쌓이고 결과가 크게 엇갈린다. 실제로 한화시스템은
      -- 같은 날 5건이 저장됐는데 목표가가 1,590원 ~ 57,900원으로 36배 벌어져 있었다
      -- (현재가 68,200원). 재사용하려면 **어느 것이 정본인지** 가릴 근거가 필요하다.
      ALTER TABLE analysis_valuations ADD COLUMN IF NOT EXISTS audit_ok     BOOLEAN;
      ALTER TABLE analysis_valuations ADD COLUMN IF NOT EXISTS audit_issues TEXT;
    `);

    // ── 사업보고서 시계열 ────────────────────────────────────────────────────
    //
    // 기존 dart_biz_content는 `UNIQUE(corp_code)`라 **회사당 최신 1건**만 남는다.
    // 그래서 "이 회사가 어디로 가고 있나"를 볼 수 없었다 — 비교할 과거가 없으니까.
    //
    // 사업보고서는 DART에 7~8년치가 그대로 있다(삼성전자 2019~2025 7건 확인).
    // 연도별로 쌓아두면 사업 구성의 이동·신규 사업 등장·매출처 집중도 변화를
    // 원문 근거로 짚을 수 있다. 이건 예측이 아니라 **서술**이라 틀릴 수가 없다.
    await client.query(`
      CREATE TABLE IF NOT EXISTS dart_biz_reports (
        id         SERIAL PRIMARY KEY,
        ticker     TEXT NOT NULL,
        corp_code  TEXT NOT NULL,
        bsns_year  INTEGER NOT NULL,
        rcept_no   TEXT NOT NULL,
        report_nm  TEXT,
        /** "사업의 내용" 원문 발췌 (섹션별로 잘라 저장) */
        content    TEXT NOT NULL,
        char_count INTEGER NOT NULL DEFAULT 0,
        fetched_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT dart_biz_reports_uniq UNIQUE (ticker, bsns_year)
      );
      CREATE INDEX IF NOT EXISTS idx_dart_biz_reports_ticker
        ON dart_biz_reports (ticker, bsns_year DESC);

      -- 분기·반기까지 담는다.
      --
      -- 연간만 보면 1년에 한 점뿐이라 "언제부터 시작했나"를 1년 단위로만 알 수 있다.
      -- 신규 사업·계약은 분기보고서에 먼저 뜨므로 분기까지 봐야 변화 시점이 잡힌다.
      -- DART에 분기·반기가 그대로 있다(메디포스트·SK하이닉스 3년치 14건씩 확인).
      --   quarter 1=1분기 · 2=반기 · 3=3분기 · 4=사업보고서(연간)
      ALTER TABLE dart_biz_reports ADD COLUMN IF NOT EXISTS quarter INTEGER NOT NULL DEFAULT 4;
      ALTER TABLE dart_biz_reports DROP CONSTRAINT IF EXISTS dart_biz_reports_uniq;
      ALTER TABLE dart_biz_reports
        ADD CONSTRAINT dart_biz_reports_uniq UNIQUE (ticker, bsns_year, quarter);
      CREATE INDEX IF NOT EXISTS idx_dart_biz_reports_period
        ON dart_biz_reports (ticker, bsns_year DESC, quarter DESC);

      -- 테마 검색 전용 축약본 — "이 사업을 한다고 적어놓은 회사"를 빨리 찾기 위한 것.
      --
      -- dart_biz_reports는 분기·반기까지 다 쌓여 427MB·39,650행이다. 테마 검색은
      -- 종목당 **최신 1건**만 보면 되는데, 매번 전체를 훑고 DISTINCT ON으로 정렬하느라
      -- 2~3초가 걸렸고 운영에서는 문장 타임아웃으로 500이 났다.
      -- 최신본만 모으면 2,762행·22MB(전체의 5%)라 훨씬 싸다. pg_trgm 인덱스까지 얹어
      -- ILIKE '%...%'가 인덱스를 타게 한다.
      CREATE TABLE IF NOT EXISTS theme_search_docs (
        ticker     TEXT PRIMARY KEY,
        bsns_year  INTEGER NOT NULL,
        quarter    INTEGER NOT NULL,
        doc        TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `);

    // pg_trgm은 없는 환경도 있으니 실패해도 넘어간다 — 인덱스가 없으면 느릴 뿐, 동작은 한다.
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_theme_search_docs_trgm
         ON theme_search_docs USING gin (doc gin_trgm_ops)`,
    ).catch((e: unknown) => {
      console.warn("[migrate] theme_search_docs trgm 인덱스 생략:", (e as Error)?.message?.slice(0, 80));
    });

    await client.query(`

      -- 사업 국면 판정 이력 — 실체·기대 2축으로 라이프사이클(①~⑤·쇠퇴·턴어라운드)을 찍는다.
      -- 저장하는 이유: (1) UI가 궤적을 그리고 (2) 다음 분석이 직전 실체 점수로 턴어라운드를 감지한다.
      CREATE TABLE IF NOT EXISTS stock_stage_verdict (
        id              SERIAL PRIMARY KEY,
        ticker          TEXT NOT NULL,
        analysis_id     INTEGER,
        phase           TEXT NOT NULL,
        stage_number    INTEGER,
        substance_score INTEGER NOT NULL,
        substance_state TEXT NOT NULL,
        expectation     TEXT NOT NULL,
        confidence      TEXT NOT NULL,
        reasons         JSONB,
        computed_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stock_stage_verdict_ticker
        ON stock_stage_verdict (ticker, computed_at DESC);
      -- 판정에 쓴 원자료(매출성장·마진·최신 분기 YoY…). 화면의 '여정'이 이 값으로 그린다.
      -- 점수는 상한(±100)에 눌려 +102% 성장과 +47% 성장이 같아 보인다 — 원자료가 필요하다.
      ALTER TABLE stock_stage_verdict ADD COLUMN IF NOT EXISTS signals JSONB;

      -- 미국 종목 구조화 재무 — SEC EDGAR companyfacts(XBRL)에서 뽑은 연간 값.
      -- 한국의 ticker_financials·dart_biz_reports에 대응하는 미국판 저장소다.
      -- 회계연도(fy)별 한 행. 값은 USD, 큰 회사도 담기게 BIGINT.
      CREATE TABLE IF NOT EXISTS us_financials (
        ticker           TEXT NOT NULL,
        fy               INTEGER NOT NULL,
        revenue          BIGINT,
        operating_income BIGINT,
        net_income       BIGINT,
        capex            BIGINT,
        rnd              BIGINT,
        inventory        BIGINT,
        receivables      BIGINT,
        payables         BIGINT,
        cogs             BIGINT,
        cik              INTEGER,
        fetched_at       TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        PRIMARY KEY (ticker, fy)
      );
      CREATE INDEX IF NOT EXISTS idx_us_financials_ticker
        ON us_financials (ticker, fy DESC);

      -- 다가오는 일정 — "며칠에 무슨 일이 예정돼 있고, 어느 종목이 움직이나".
      -- 뉴스에서 날짜가 박힌 예정 이벤트(임상 발표·정부 일정·정책·계약·실적)를 뽑아 쌓는다.
      -- 같은 이벤트가 여러 기사에 나오므로 (날짜+제목)으로 중복을 막는다.
      CREATE TABLE IF NOT EXISTS upcoming_events (
        id          SERIAL PRIMARY KEY,
        event_date  DATE NOT NULL,
        title       TEXT NOT NULL,
        category    TEXT NOT NULL,           -- 임상·허가 / 정부·정책 / 계약·수주 / 실적 / 지수·수급 / 기타
        summary     TEXT,
        tickers     JSONB,                   -- [{ticker, name, why}]
        sectors     JSONB,                   -- ["건설","인프라"]
        importance  INTEGER NOT NULL DEFAULT 2, -- 1 낮음 · 2 보통 · 3 높음
        source      TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT upcoming_events_uniq UNIQUE (event_date, title)
      );
      CREATE INDEX IF NOT EXISTS idx_upcoming_events_date
        ON upcoming_events (event_date, importance DESC);

      -- 미국 연차보고서(10-K/20-F) "Item 1. Business" 본문 — 한국 dart_biz_reports의 미국판.
      -- 다년치를 쌓아 연도별 서술 변화(행간)를 비교한다. 회계연도(fy)별 한 행.
      CREATE TABLE IF NOT EXISTS us_biz_reports (
        ticker     TEXT NOT NULL,
        fy         INTEGER NOT NULL,
        filed_date TEXT,
        content    TEXT NOT NULL,
        char_count INTEGER NOT NULL DEFAULT 0,
        fetched_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        PRIMARY KEY (ticker, fy)
      );
      CREATE INDEX IF NOT EXISTS idx_us_biz_reports_ticker
        ON us_biz_reports (ticker, fy DESC);
    `);

    // ── 종목별 정본 ─────────────────────────────────────────────────────────
    //
    // "이 종목의 현재 유효한 밸류에이션·실적전망"을 한 줄로 꺼내는 창구.
    // 조회를 stocks 뷰 하나로 모은 것과 같은 원칙이다.
    //
    // 고르는 규칙: **검산을 통과한 가장 최근 분석**.
    // audit_ok가 NULL인 과거 행은 검산 도입 전 것이라 배제하지 않되(데이터를 잃지 않는다),
    // 명시적으로 실패(false)한 것만 제외한다. 목표가가 현재가의 10%에도 못 미치거나
    // 20배를 넘는 것은 단위 오류가 거의 확실하므로 정본에서 뺀다.
    await client.query(`
      CREATE OR REPLACE VIEW stock_valuation_current AS
        SELECT DISTINCT ON (v.ticker)
               v.ticker, v.analysis_id, v.current_price,
               v.bear, v.base, v.bull,
               v.abs_model, v.abs_base, v.rel_base,
               v.audit_ok, v.created_at
          FROM analysis_valuations v
         WHERE v.base IS NOT NULL AND v.base > 0
           AND COALESCE(v.audit_ok, TRUE)
           AND (v.current_price IS NULL OR v.current_price <= 0
                OR (v.base >= v.current_price * 0.1 AND v.base <= v.current_price * 20))
         ORDER BY v.ticker, v.created_at DESC, v.analysis_id DESC
    `);

    // 실적 전망도 같은 원칙 — 종목·연도·부문마다 가장 최근 분석의 값 하나.
    await client.query(`
      CREATE OR REPLACE VIEW stock_segment_forecast_current AS
        SELECT DISTINCT ON (f.ticker, f.fiscal_year, f.segment_name)
               f.ticker, f.fiscal_year, f.segment_name, f.currency,
               f.revenue, f.operating_income, f.analysis_id, f.created_at
          FROM analysis_segment_forecasts f
         ORDER BY f.ticker, f.fiscal_year, f.segment_name, f.created_at DESC, f.analysis_id DESC
    `);

    // 한국 표준산업분류(KIS search-stock-info) 보관.
    // 야후 industry는 한국 종목에 부정확할 때가 있다 — 조선 3사가 "Aerospace & Defense"로
    // 묶여 방산으로 분류됐다. KIS는 "선박 및 보트 건조업"으로 정확히 준다.
    // 저장해두면 분류 규칙을 고칠 때 API를 다시 부르지 않아도 된다.
    await client.query(`
      ALTER TABLE krx_stocks ADD COLUMN IF NOT EXISTS kis_industry TEXT;
    `);

    // ── 종목별 피어그룹 ──────────────────────────────────────────────────────
    // 피어는 분석마다 AI가 새로 고르고 버려졌다. 남겨두면 다음 분석이 같은 피어를
    // 재사용해 비교가 일관되고, 피어 지표는 stocks 뷰에서 조인해 오므로
    // 외부 API를 피어 수만큼 호출하던 것이 사라진다.
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_peers (
        id                     SERIAL PRIMARY KEY,
        ticker                 TEXT NOT NULL,
        peer_ticker            TEXT NOT NULL,
        peer_name              TEXT,
        rank                   INTEGER NOT NULL DEFAULT 0,
        reason                 TEXT,
        source                 TEXT NOT NULL DEFAULT 'ai',
        selected_by_analysis_id INTEGER,
        created_at             TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at             TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        CONSTRAINT stock_peers_ticker_peer_key UNIQUE (ticker, peer_ticker)
      );
      CREATE INDEX IF NOT EXISTS idx_stock_peers_ticker ON stock_peers (ticker, rank);
    `);

    // ── 업종별 배수 밴드(실측) ────────────────────────────────────────────────
    // 프롬프트에 들어가는 "업종 PER/PBR 범위"가 여러 파일에 손으로 적혀 있었고,
    // 적어둔 시점에 멈춰 있었다. 2026-07 실측과 대조하니 한국 방산이 코드상
    // PER 12~28x인데 실제 중앙값은 50x였다 — 그대로 쓰면 목표가가 반토막 난다.
    //
    // 그래서 밴드를 stocks 뷰에서 직접 계산해 여기에 적재한다. 하드코딩 값은
    // 표본이 모자랄 때의 폴백으로만 남는다.
    // 이상치에 둔감하도록 평균이 아니라 사분위수(p25/p50/p75)를 쓴다.
    await client.query(`
      CREATE TABLE IF NOT EXISTS sector_multiple_bands (
        sector      TEXT PRIMARY KEY,
        market      TEXT NOT NULL,
        stock_count INTEGER NOT NULL DEFAULT 0,
        per_n       INTEGER NOT NULL DEFAULT 0,
        per_p25     REAL,
        per_p50     REAL,
        per_p75     REAL,
        pbr_n       INTEGER NOT NULL DEFAULT 0,
        pbr_p25     REAL,
        pbr_p50     REAL,
        pbr_p75     REAL,
        computed_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );

      -- P/S(시가총액÷매출). PER·PBR보다 늦게 추가했다.
      -- 한국 방산주가 야후 업종만 보고 "EV/Sales 20~60x(스페이스X 비교군)" 지시를
      -- 받던 사고를 직접 막으려면 이 지표의 실측이 반드시 필요하다.
      -- 순부채를 전 종목에 갖고 있지 않아 EV가 아닌 시가총액 기준이며, 이름도 그렇게 붙였다.
      ALTER TABLE sector_multiple_bands ADD COLUMN IF NOT EXISTS psr_n   INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sector_multiple_bands ADD COLUMN IF NOT EXISTS psr_p25 REAL;
      ALTER TABLE sector_multiple_bands ADD COLUMN IF NOT EXISTS psr_p50 REAL;
      ALTER TABLE sector_multiple_bands ADD COLUMN IF NOT EXISTS psr_p75 REAL;
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
          k.data_fetched, k.fetch_error, k.last_updated,
          -- 한국 표준산업분류. 야후 industry가 틀릴 때 분류를 바로잡는 근거라
          -- 창구에서 함께 꺼낼 수 있어야 한다(미국 종목에는 없는 개념이라 NULL).
          -- CREATE OR REPLACE VIEW는 뒤에 컬럼을 더하는 것만 허용한다 — 맨 끝에 둘 것.
          k.kis_industry
        FROM krx_stocks k
        UNION ALL
        SELECT
          u.ticker        AS ticker,
          'US'::text      AS market,
          u.name, u.exchange, u.sector, u.industry,
          u.market_cap, u.current_price, u.per, u.pbr, u.roe, u.opm,
          u.rev_growth, u.revenue, u.net_income, u.shares_out, u.beta,
          u.week52_high, u.week52_low,
          u.data_fetched, u.fetch_error, u.last_updated,
          NULL::text      AS kis_industry
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
