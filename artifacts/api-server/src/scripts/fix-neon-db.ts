import { pool } from "@workspace/db";

(async () => {
  console.log("[fix-neon] Neon DB 연결 확인...");

  // 1. model_calibration UNIQUE 제약 추가
  try {
    await pool.query(`ALTER TABLE model_calibration ADD CONSTRAINT model_calibration_sector_key UNIQUE (sector)`);
    console.log("[fix-neon] model_calibration UNIQUE(sector) 추가 완료");
  } catch (e: any) {
    if (e.message?.includes("already exists")) {
      console.log("[fix-neon] model_calibration UNIQUE 이미 존재");
    } else {
      console.error("[fix-neon] model_calibration UNIQUE 추가 실패:", e.message);
    }
  }

  // 2. sector_priors 테이블 생성
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sector_priors (
        sector           TEXT PRIMARY KEY,
        wacc_range       TEXT,
        terminal_g       TEXT,
        peers_note       TEXT,
        bias_risk        TEXT,
        specific_levers  JSONB NOT NULL DEFAULT '[]'::jsonb,
        is_auto_updated  BOOLEAN NOT NULL DEFAULT FALSE,
        auto_update_notes TEXT,
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("[fix-neon] sector_priors 테이블 생성/확인 완료");
  } catch (e: any) {
    console.error("[fix-neon] sector_priors 생성 실패:", e.message);
  }

  // 3. model_calibration diagnosis_note 컬럼 추가
  try {
    await pool.query(`
      ALTER TABLE model_calibration
        ADD COLUMN IF NOT EXISTS diagnosis_note TEXT,
        ADD COLUMN IF NOT EXISTS diagnosis_updated_at TIMESTAMPTZ
    `);
    console.log("[fix-neon] model_calibration diagnosis_note 컬럼 추가 완료");
  } catch (e: any) {
    console.error("[fix-neon] diagnosis_note 추가 실패:", e.message);
  }

  // 4. sector_priors is_auto_updated, auto_update_notes 컬럼 추가 (테이블 생성 이후)
  try {
    await pool.query(`
      ALTER TABLE sector_priors
        ADD COLUMN IF NOT EXISTS is_auto_updated BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS auto_update_notes TEXT
    `);
    console.log("[fix-neon] sector_priors 컬럼 추가 완료");
  } catch (e: any) {
    if (!e.message?.includes("already exists")) {
      console.error("[fix-neon] sector_priors 컬럼 추가 실패:", e.message);
    }
  }

  // 5. ticker_notes 테이블에 데이터 삽입 (Neon DB 기준)
  const notes = [
    {
      ticker: "000660",
      memo: `[SK하이닉스 DCF 필수 제약 — 절대 준수]

⛔ 목표주가 HARD CAP: 시작가 대비 최대 +80% (한 번의 분석에서 2배 초과 목표가 출력 금지)
- DCF 목표가가 시작가의 180% 초과 시: 분석 중단 후 WACC 최소 2%p 상향 재계산

⛔ 성장률 하드캡 (반드시 준수):
- Year 1 매출성장률 상한: +50%
- Year 2 = Year 1의 최대 40%
- Year 3~5 = 컨센서스 기준 8~15%
- 10년 CAGR 15% 초과 가정 즉시 무효

⛔ OPM 상한:
- Year 1~2: 최대 40%
- Year 3~5: 최대 32%
- Year 6~10: 최대 25%

⛔ FCFF/매출 상한: Year 1~5 최대 12%, Year 6~10 최대 10%

✅ WACC: 12.0~14.5% (HBM 사이클 리스크 반영, 기본 13.0%)
✅ 피어: SK하이닉스 과거 EV/EBITDA(6~14x) → Micron(MU) → 삼성전자 반도체 부문
⛔ Damodaran 반도체 멀티플(EV/EBITDA 23.9x) 직접 적용 금지
✅ Terminal g ≤ 1.5%

[최근 진단]
2026-04 분석 다수에서 목표가 360~480% 괴리 발생 → DCF 성장률 하드캡 미준수 원인 확정`,
    },
    {
      ticker: "005930",
      memo: `[삼성전자 DCF 필수 제약 — 절대 준수]

⛔ 목표주가 HARD CAP: 시작가 대비 최대 +70% (2배 초과 목표가 금지)
- 반도체+소비자가전+MX 복합 사업 → SOTP 권장

⛔ 성장률 하드캡:
- 반도체부문 Year 1: 최대 +45%, Year 2: Year 1의 40% 이하
- MX(스마트폰)·가전: Year 1 최대 +10%
- 10년 매출 CAGR 12% 초과 가정 무효

⛔ OPM 상한:
- 반도체부문: Year 1~2 최대 35%, Year 3~5 최대 28%
- MX·가전: Year 1~5 최대 15%

✅ WACC: 10.5~13.0% (기본 11.5%)
✅ 피어: 삼성전자 과거 EV/EBITDA 4~9x (Damodaran 미국 멀티플 직접 적용 금지)
✅ 복합기업 SOTP 의무 (반도체 + MX + 가전 + 금융)

[최근 진단]
2026-04~05 분석에서 목표가 47~136% 괴리 반복 → SOTP 미적용 단순 DCF가 주원인`,
    },
    {
      ticker: "402340",
      memo: `[SK스퀘어 밸류에이션 필수 지침]

⛔ SK스퀘어는 순수 투자지주회사 — SOTP 필수, DCF 단독 금지
⛔ 목표주가 하드캡: SOTP 합산의 최대 130% (지주사 할인 20~30% 적용 의무)

▶ SOTP 구성:
① SK하이닉스(000660) 지분 약 20% → 시가 기준 지분가치 (미래 추정가 사용 금지)
② SK텔레콤 등 자회사 → EV/EBITDA 개별 평가
③ 현금 및 기타 투자자산

[최근 진단]
2026-04 목표가 127% 괴리 → 지주사 할인 미적용 + SK하이닉스 지분 과대평가`,
    },
    {
      ticker: "279570",
      memo: `[케이뱅크 밸류에이션 필수 지침]

⛔ 인터넷은행은 Gordon Growth P/B 모델 우선 (DCF 보조)
⛔ EV/EBITDA 금지 (금융주 적용 불가)

▶ 적정 P/B = (ROE - g) / (CoE - g)
- CoE: 10.0~13.0%, g: 3.0~4.0%
▶ 피어: 카카오뱅크(323410) P/B 배수 참조
▶ 목표주가 하드캡: 현재가의 +60%`,
    },
    {
      ticker: "042700",
      memo: `[한미반도체 밸류에이션 필수 지침]

⛔ 목표주가 하드캡: 현재가의 +80%
⛔ AMAT·KLAC 피어 절대 금지 (전공정 장비 — 사업 불일치)

▶ 피어 우선순위:
1. BESI (AMS: BESI.AS) — TC Bonder 직접 경쟁사
2. KLIC (NASDAQ: KLIC) — 후공정 패키징
3. ASMPT (HKG: 0522)

▶ WACC: 12.0~15.0%, EV/EBITDA 18~30x (BESI 기준)`,
    },
  ];

  for (const n of notes) {
    try {
      await pool.query(
        `INSERT INTO ticker_notes (ticker, memo, updated_at, auto_learning)
         VALUES ($1, $2, NOW(), '{}'::jsonb)
         ON CONFLICT (ticker) DO UPDATE SET memo = EXCLUDED.memo, updated_at = NOW()`,
        [n.ticker, n.memo]
      );
      console.log(`[fix-neon] ticker_notes ${n.ticker} 삽입 완료`);
    } catch (e: any) {
      console.error(`[fix-neon] ticker_notes ${n.ticker} 실패:`, e.message);
    }
  }

  // 6. Neon DB 테이블 목록 출력
  const { rows: tables } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
  );
  console.log("\n[fix-neon] Neon DB 테이블:", tables.map((r: any) => r.tablename).join(", "));

  // 7. model_calibration 제약 확인
  const { rows: constraints } = await pool.query(
    `SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name='model_calibration'`
  );
  console.log("[fix-neon] model_calibration 제약:", constraints.map((r: any) => `${r.constraint_name}(${r.constraint_type})`).join(", "));

  await pool.end();
  process.exit(0);
})();
