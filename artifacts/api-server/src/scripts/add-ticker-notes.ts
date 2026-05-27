import { pool } from "@workspace/db";

const notes = [
  {
    ticker: "009900",
    memo: `[명신산업 DCF 필수 제약]

⚡ 업종: 전기차 차체·알루미늄 다이캐스팅 부품 (현대차·기아·GM 납품 티어1 부품사)

⛔ HARD CAP: 목표주가 ≤ 시작가 × 1.60 (60% 상승 상한)
- 2026년 분석에서 목표가 332% 괴리 발생 확인 → DCF 성장률·OPM 과낙관 원인

⛔ 매출성장률 상한:
- Year 1: 최대 +20% (전기차 물량 확대 최대 호황 가정)
- Year 2: Year 1의 최대 50%
- Year 3~5: 5~12% (자동차 부품 성숙 사이클)

⛔ OPM 상한:
- Year 1~2: 최대 8% (원자재비·전기차 전환 비용 반영)
- Year 3~5: 최대 7%

✅ WACC: 11.5~13.5%
✅ 피어: 현대모비스·HL만도·현대위아. EV/EBITDA 5~9x
⛔ Damodaran 미국 부품사 멀티플 직접 적용 금지

✅ 중국 BYD·CATL 공급망 진입에 따른 점유율 하락 시나리오 Bear 케이스 포함 필수`,
  },
  {
    ticker: "323350",
    memo: `[다원넥스뷰 분류 주의 + DCF 필수 제약]

⚡ 업종: 용접·레이저 자동화 장비 (Specialty Industrial Machinery)
⛔ 방산 기업이 아님 — "방위산업 매출 비중 10~20% 미만"
⛔ 방산 멀티플(EV/EBITDA 10~22x) 적용 금지

▶ 올바른 분류: 산업기계 / 용접·레이저 장비
▶ 적용 피어: 에스에프에이·로보스타·이에스아이. EV/EBITDA 7~14x, PER 12~22x

⛔ HARD CAP: 목표주가 ≤ 시작가 × 1.80 (80% 상승 상한)
- 2026년 방산 오분류로 목표가 316% 괴리 발생 확인

⛔ 매출성장률 상한:
- Year 1: 최대 +30% (수주잔고 기반 최대 가정)
- Year 2~5: 10~20%

⛔ OPM 상한: Year 1~5 최대 12%
✅ WACC: 11.0~13.5%`,
  },
  {
    ticker: "001250",
    memo: `[GS글로벌 밸류에이션 필수 지침]

⚡ 업종: 종합상사 (원자재 트레이딩, 산업재 수출입)

⛔ 종합상사는 DCF 단독 금지 → EV/EBITDA + PBR 복합 평가 필수
⛔ HARD CAP: 목표주가 ≤ 시작가 × 1.40 (40% 상승 상한)
- 2026년 목표가 158% 괴리 발생 — 종합상사 성장률 과낙관 원인

▶ 적정 멀티플:
- EV/EBITDA: 4~8x (국내 종합상사 밴드)
- PBR: 0.3~0.7x
- PER: 8~15x

⛔ 매출성장률 상한:
- Year 1: 최대 +10% (원자재 가격 변동 연동, 구조적 성장 아님)
- Year 2~5: 3~8%

✅ WACC: 9.5~11.5%
✅ 피어: 포스코인터내셔널·LX인터내셔널·현대코퍼레이션. EV/EBITDA 4~8x

[최근 진단]
2026년 분석에서 종합상사를 제조업처럼 DCF 고성장 가정 → 목표가 158% 괴리`,
  },
  {
    ticker: "078160",
    memo: `[메디포스트 밸류에이션 필수 지침]

⚡ 실제 업종: 줄기세포 치료제 + 제대혈 보관 바이오텍 (industry="일반"으로 분류돼 KR_OTHER 오분류 주의)
⛔ KR_OTHER 가이드라인이 아닌 KR_BIOTECH 가이드라인 적용 필수

▶ 주요 파이프라인:
- 카티스템(줄기세포 무릎 치료제): 국내 허가·판매 중 → PoS=100%, DCF로 현금흐름 산정
- 제대혈 보관 사업: 안정적 매출, 낮은 성장

▶ 밸류에이션 방법:
- 허가 완료(카티스템): DCF (WACC 12.0~14.0%, terminal g ≤ 1.5%)
- 파이프라인(임상 2~3상): rNPV (PoS 20~40%)
- 제대혈 사업: EV/EBITDA 6~10x

⛔ HARD CAP: 목표주가 ≤ 시작가 × 2.00 (파이프라인 옵션가치 포함)
- 2026년 목표가 354% 괴리 발생 — rNPV 과낙관 원인

✅ WACC: 13.0~15.0% (상업화 제품 포함이나 파이프라인 의존도 높음)
✅ 피어: 셀트리온·바이오에이치·파미셀 (줄기세포 피어)`,
  },
  {
    ticker: "263860",
    memo: `[지니언스 밸류에이션 필수 지침]

⚡ 업종: 네트워크 접근제어(NAC) B2B 보안 소프트웨어 (소형주)

⛔ HARD CAP: 목표주가 ≤ 시작가 × 1.60 (60% 상승 상한)
- 2026년 목표가 121% 괴리 발생 확인 — 소형 B2B SW 성장 과낙관 원인

▶ 적용 멀티플:
- EV/Sales: 2~5x (한국 소형 보안 SW 밴드)
- PER: 20~35x
- EV/EBITDA: 10~18x

⛔ 매출성장률 상한:
- Year 1: 최대 +25% (공공·금융 수주 최대 호황)
- Year 2~5: 10~18%

⛔ OPM 상한: Year 1~5 최대 22%
✅ WACC: 11.5~13.5% (소형주 유동성 리스크 반영)
✅ 피어: 안랩·이스트시큐리티·파이오링크. EV/Sales 2~5x

[최근 진단]
B2B 보안 SW 기업의 정부 계약 수주 속도를 과낙관하여 목표가 121% 괴리 발생`,
  },
  // 이미 있지만 업데이트
  {
    ticker: "347850",
    memo: `[디앤디파마텍 밸류에이션 필수 지침]

⚡ 업종: 경구용 비만치료제(GLP-1) 임상 개발 바이오텍 (임상 2상 진행 중)

⛔ HARD CAP: 목표주가 ≤ 시작가 × 2.00 (rNPV 옵션가치 포함 최대 2배)
- 2026년 목표가 106% 괴리 → 조정 허용 범위 내

▶ rNPV 계산:
- DD01 (경구 비만치료제) 임상 2상: PoS 15~25% 적용
- 최대 시장 규모: 글로벌 GLP-1 시장의 0.5~2% 점유 가정 상한
- 허가 후 매출 반영 시차: 18~24개월

✅ WACC: 14.0~16.0% (임상 2상 바이오텍)
✅ 피어: 한미약품(olamkicept)·일동제약·동아ST. PBR 2~8x`,
  },
];

(async () => {
  console.log("[ticker-notes] Neon DB 삽입 시작...");

  for (const n of notes) {
    try {
      await pool.query(
        `INSERT INTO ticker_notes (ticker, memo, updated_at, auto_learning)
         VALUES ($1, $2, NOW(), '{}'::jsonb)
         ON CONFLICT (ticker) DO UPDATE SET memo = EXCLUDED.memo, updated_at = NOW()`,
        [n.ticker, n.memo]
      );
      console.log(`  ✅ ${n.ticker} 삽입 완료`);
    } catch (e: any) {
      console.error(`  ❌ ${n.ticker} 실패:`, e.message);
    }
  }

  // 전체 ticker_notes 확인
  const { rows } = await pool.query(
    `SELECT ticker, LEFT(memo, 60) AS preview, updated_at FROM ticker_notes ORDER BY updated_at DESC`
  );
  console.log(`\n[ticker-notes] 전체 ${rows.length}개 보정 메모:`);
  for (const r of rows) {
    console.log(`  ${r.ticker}: ${r.preview.replace(/\n/g, " ")}...`);
  }

  await pool.end();
  process.exit(0);
})();
