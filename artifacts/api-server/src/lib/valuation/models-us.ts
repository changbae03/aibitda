/**
 * models-us.ts — 미국 시장 및 특수 구조 밸류에이션 모델 정의.
 * 도메인 지식은 기존 프롬프트에서 그대로 옮겼다. 설계 원칙은 models-kr.ts 참고.
 */

import type { ValuationModel } from "./model-registry.js";

export const RNPV_US: ValuationModel = {
  key: "rnpv_us",
  reportFormat: "rnpv",
  label: "rNPV",
  rationale: `rNPV 기본 구조는 한국 바이오와 동일합니다. FDA 지정에 따른 PoS 보정이 의무입니다.`,
  absName: "rNPV Sum of Parts 주당가치",
  relName: "피어 EV/Sales 목표가",
  absWeight: 0.7,
  absProcedure: `[PDUFA 이벤트 캘린더 — 필수 작성]
| 약물명(적응증) | 단계 | FDA 지정 | PDUFA/결과 날짜 | AdCom | 당사 PoS |
(BTD·Priority Review·Fast Track·ODD 지정 여부를 반드시 반영해 PoS를 보정하세요)
- 자산별 rNPV를 합산하고 완전희석 주식수로 나눠 주당가치를 산출하세요 = $__/share`,
  relProcedure: `- 개발단계 바이오 피어의 EV/Sales 또는 EV/Pipeline 배수를 적용하세요 = $__/share`,
  bands: `Bear: 핵심 자산 CRL 또는 AdCom 부정 시나리오 = $__
Bull: 승인 + 조기 상업화 시나리오 = $__`,
  crossCheck: `CRL(승인거절) 리스크 체크리스트: 제조시설 사전실사 이슈, 임상 데이터 일관성,
대조군 설계 적절성, AdCom 표결 결과. 해당 항목이 있으면 PoS를 하향하세요.`,
};

export const SOTP_BIGTECH: ValuationModel = {
  key: "sotp_bigtech",
  reportFormat: "dcf",
  label: "Segment SOTP",
  rationale: `⛔ GAAP PER 단독 사용 금지 (주식보상비용(SBC)으로 왜곡).
⛔ 단일 EV/EBITDA 배수를 전체에 적용하는 것 금지 (사업부별 구조가 완전히 다름).`,
  absName: "Segment SOTP 주당가치",
  relName: "FCF Yield 역산 목표주가",
  absWeight: 0.6,
  absProcedure: `[SBC 조정]
- GAAP 영업이익 __억 | SBC __억 | Non-GAAP 영업이익 __억
- Non-GAAP FCF = GAAP FCF + SBC 세후 조정 = __억
[Segment SOTP 테이블]
| 사업부 | 매출 | 영업이익률 | 적용배수 | EV기여 |
  ⚠️ EV = 배수 × 기준값입니다. 자릿수를 확인하세요 — 서버가 검산하며 어긋나면 반려됩니다.
- 순현금(또는 순차입금) ± $__ → Equity Value $__ → 주당 SOTP = $__`,
  relProcedure: `- Forward FCF $__억 ÷ 목표 FCF Yield __% → 목표 시총 → 주당 = $__
- M7 피어 FCF Yield 중앙값 __%와 비교해 저평가·적정·고평가를 판단하세요.`,
  bands: `Bear: AI 수익화 지연 + 규제 압박 + 광고 경기 하락 = $__
Bull: AI 신사업 개화 + 자사주 누적 효과 + 세그먼트 마진 확장 = $__`,
  crossCheck: `[자사주 매입 EPS Accretion — Forward EPS에 반드시 반영]
- 연간 자사주 매입액 $__억 ÷ 시가총액 $__억 = 매입률 __%
- 연간 EPS Accretion = 매입률 × EPS = +$__/주 (__%↑)
- 3년 누적 EPS Accretion = +$__/주 (복리 효과 포함)`,
};

export const REIT_US: ValuationModel = {
  key: "reit_us",
  reportFormat: "pbDdm",
  label: "NAV+P/AFFO",
  rationale: `⛔ EPS·EV/EBITDA 기반 분석 금지 (D&A로 왜곡).
⛔ FFO 단독 사용 금지 — 반드시 AFFO(Adjusted FFO) 기준.
⛔ 서브섹터 구분 없이 단일 Cap Rate 적용 금지 — 서브섹터·지역별 차등 의무.`,
  absName: "P/NAV 기반 목표주가",
  relName: "P/AFFO 기반 목표주가",
  absWeight: 0.55,
  absProcedure: `[서브섹터별 NAV — Cap Rate 차등 적용]
| 서브섹터 | NOI($억) | 적용 Cap Rate | 자산가치($억) | 지역 |
  데이터센터 4.5~5.5% / 셀타워 3.5~5% / 산업물류 4~6% / 헬스케어 5~6.5%
  주거 4~5.5% / 리테일 5.5~7% / 오피스 6~9%(⚠️ 위기 섹터 주의)
- NAV = 합계 자산가치 − 총부채 − 우선주 = $__  →  주당 NAV = $__
- 적정 P/NAV __x (프리미엄 서브섹터 DC·셀타워·산업 1.0~1.3x / 오피스 등 압박 섹터 0.6~0.9x)
- P/NAV 기반 목표주가 = 주당 NAV × 적정 P/NAV = $__`,
  relProcedure: `[AFFO 산출 (FFO → AFFO 조정)]
① FFO = 순이익 + D&A − 자산 매각 이익 = $__/share
② 유지보수CapEx 차감 ③ 직선임대료 조정 ④ 기타 비현금 조정
⑤ AFFO = ① − ② − ③ − ④ = $__/share
- 서브섹터 피어 P/AFFO __x (데이터센터 25~40x / 셀타워 20~30x / 산업 20~28x
  / 주거 18~25x / 리테일 12~18x) → 목표주가 = $__`,
  bands: `Bear: 금리 상승 → Cap Rate 확대 → NAV 하락 + AFFO 성장 둔화 = $__
Bull: 금리 인하 + 서브섹터 수요 호조(AI 데이터센터 등) + NAV 확장 = $__`,
  crossCheck: `AFFO Payout Ratio = 주당 배당 ÷ AFFO = __%
  85% 이하 지속 가능 / 90% 초과 배당컷 리스크 경고
서브섹터 전용 지표: (데이터센터) MW 가동률·하이퍼스케일 비중·신규 MW 파이프라인
  (셀타워) Tenancy Ratio·에스컬레이터·5G 전환율  (헬스케어) EBITDARM Coverage·NNN vs RIDEA
  (산업물류) Lease Mark-to-Market·Same-Store NOI  (주거) Blended Rent Growth·점유율`,
};

export const TBV_ROTCE: ValuationModel = {
  key: "tbv_rotce",
  reportFormat: "pbDdm",
  label: "P/TBVPS",
  rationale: `⛔ EV/EBITDA 금지 (이자비용이 영업비용 → EV 개념 부적합).
⛔ P/B(총장부가) 단독 사용 금지 → 굿윌·무형자산 제거 후 P/TBVPS 사용.
⛔ 충당금 정상화 없이 PER 직접 사용 금지 (사이클 왜곡).`,
  absName: "P/TBVPS 목표주가",
  relName: "정상화 P/E 목표주가",
  absWeight: 0.6,
  absProcedure: `[TBVPS 산출]
TBVPS = (총자본 $__ − 굿윌 $__ − 무형자산 $__) ÷ 발행주식수 = $__
[Justified P/TBVPS]
= (ROTCE __% − g __%) ÷ (CoE __% − g __%) = __x
피어 범위: JPM 2.0~2.5x / 대형 상업은행 1.2~1.8x / 지역은행 0.8~1.2x
- 목표주가 = 적정 P/TBVPS × TBVPS = $__`,
  relProcedure: `- 정상화 EPS = GAAP EPS ± (실제 PCL − Mid-cycle PCL) 세후 = $__
- 적정 PER __x 적용 → 목표주가 = $__`,
  bands: `Bear: CCAR SCB 상향 + NIM 압축(연준 인하 가속) + PCL 사이클 악화 = $__
Bull: CCAR 초과자본 활용 대규모 자사주 + NIM 회복 + PCL 사이클 완화 = $__`,
  crossCheck: `[CCAR 자본 배분 — 필수]
① CET1 __% | SCB __% | 총 요구 자본 __%
② 초과 자본 = CET1 − 운용 목표 = __bp   ③ CCAR [통과/조건부/미통과]
④ 승인된 환원: 자사주 $__억 + 배당 $__억
⑤ ⚠️ SCB 상향 또는 CCAR 미통과 시 배당 동결·자사주 중단 리스크 명시 필수
[NIM 금리 민감도] 현재 NIM __% | 연준 25bp 인하 시 NII 영향 −$__억
  (Asset-sensitive / Liability-sensitive 구분) | Deposit Beta __%
[신용 사이클] NCO __% | NPL __%(1.0% 초과 경고) | Coverage __x | CRE Office 비중 __%`,
};

export const DEFENSE_US: ValuationModel = {
  key: "defense_us",
  reportFormat: "dcf",
  label: "EV/EBITDA(Adj.)",
  rationale: `⛔ P/Book 의미 없음 (경쟁우위가 자산이 아닌 기술·인력·분류프로그램).
⛔ EAC 손실이 포함된 분기 EBITDA·EPS를 그대로 배수 적용 금지 → 정상화 필수.`,
  absName: "EV/EBITDA(Adj.) 목표주가",
  relName: "정상화 P/E 목표주가",
  absWeight: 0.6,
  absProcedure: `- Adj. EBITDA = GAAP EBITDA + EAC 손실 일회성 제거 = $__억
- 피어 배수 __x (대형 프라임 13~18x / IT방산 10~14x)
- 목표주가 = (Adj. EBITDA × 배수 − 순차입금) ÷ 주식수 = $__`,
  relProcedure: `- Adj. EPS = GAAP EPS + EAC 세후 정상화 = $__
- 적정 PER __x (방산 대형 18~25x, Backlog 가시성으로 조정) → 목표주가 = $__`,
  bands: `Bear: 국방예산 CR 연장 + 대형 FFP EAC 손실 발생 + Book-to-Bill 악화 = $__
Bull: 예산 증액(지정학 리스크 상승) + Backlog 신기록 + EAC 정상화 = $__`,
  crossCheck: `[Backlog 가시성] Funded/Unfunded/Total Backlog와 Backlog/Revenue 배수
  (Total 4x 이상 = 우수)
[Book-to-Bill 추이] 분기별 신규수주 ÷ 매출. 3분기 연속 1.0x 미만이면 모멘텀 약화 경고 명시
[계약유형 Mix & EAC 리스크] FFP __% / CPFF+CPIF __% / T&M __%
  진행 중 대형 FFP 개발 계약의 완료율·EAC 조정 이력
[FCF Conversion] FCF ÷ Net Income = __% (100~120% 우수 / 80% 미만 운전자본 이슈)
  선급금 잔액 $__ (매출 선인식 여부 확인)`,
};

export const MLP: ValuationModel = {
  key: "mlp",
  reportFormat: "dcf",
  label: "DCF per Unit",
  rationale: `⛔ EPS·PER 기반 분석 완전 금지 (법인세 없는 패스스루 구조라 순이익이 왜곡).
⛔ 단순 순이익 배당성향 계산 금지 (배분금은 DCF per Unit으로만 계산).`,
  absName: "DCF per Unit 기반 목표가",
  relName: "Distribution Yield 역산 목표가",
  absWeight: 0.6,
  absProcedure: `① DCF per Unit = EBITDA − 이자비용 − 유지보수CapEx = $__/unit
② 적정 Price/DCF 배수 __x 적용 → 목표가 = $__/unit`,
  relProcedure: `- DPU(연간 배분금) $__ ÷ 목표 Distribution Yield __% = $__/unit`,
  bands: `Bear: Coverage 1.0x 미만 하락 + 배분금 삭감 = $__
Bull: 처리량 증가 + Fee-based 비중 확대 = $__`,
  crossCheck: `Distribution Coverage Ratio = DCF ÷ DPU = __x (1.0x 이상 안정 / 1.1x+ 권장)
Debt/EBITDA = __x (4.0x 이하 안정 / 5.0x 초과 배분금 삭감 경고)
Fee-based Revenue 비중 __% (원자재 가격 노출도 판단)`,
};

export const BDC: ValuationModel = {
  key: "bdc",
  reportFormat: "pbDdm",
  label: "P/NAV+NII",
  rationale: `⛔ EV/EBITDA 적용 금지 (대출 포트폴리오 기업에 부적합).
⛔ 순이익·PER 단독 사용 금지 (NII Coverage가 핵심 지속가능성 지표).`,
  absName: "P/NAV 기반 목표가",
  relName: "P/NII 기반 목표가",
  absWeight: 0.65,
  absProcedure: `① NAV per Share = 총 포트폴리오 공정가치 − 부채 = $__/share (전분기 대비 ±__%)
② 적정 P/NAV __x (우량 BDC 1.0~1.4x / 부실 우려 0.7~0.9x)
③ 목표가 = NAV per Share × 적정 P/NAV = $__`,
  relProcedure: `① NII per Share = 이자수익 − 이자비용 − 운용수수료 = $__/share (분기)
② 적정 P/NII __x 적용 → 목표가 = $__`,
  bands: `Bear: Non-accrual 급등 + NAV 훼손 + Coverage 1.0x 미만 = $__
Bull: NAV 회복 + 금리 상승 수혜(변동금리) + 신규 대출 확장 = $__`,
  crossCheck: `Coverage Ratio = NII ÷ 배당 = __x (1.0x 이상 유지 필수)
Non-accrual Rate __% (2% 초과 시 신용 악화 경고)
Debt/Equity __x (1.0~1.5x 일반적, 2.0x 초과 위험)
포트폴리오 구성: Senior Secured __% / 2nd Lien __% / Equity·Warrant __%`,
};

export const ROYALTY: ValuationModel = {
  key: "royalty",
  reportFormat: "dcf",
  label: "스트림NPV+P/NAV",
  rationale: `⛔ 일반 광산사 EV/EBITDA 배수 직접 적용 금지 (로열티 구조는 2~3배 프리미엄).
⛔ CapEx·광산 운영비 가정 불필요 (Operator 귀속).`,
  absName: "P/NAV 기반 목표가",
  relName: "피어 EV/EBITDA 목표가",
  absWeight: 0.6,
  absProcedure: `[로열티 자산 목록]
| 자산명 | 광종 | 계약유형(NSR/Stream) | 생산량/yr | 잔여기간 | Operator |
[스트림별 NPV] 각 자산 NPV = Σ(연간 로열티 수익 × 생산 확률) ÷ WACC
- WACC __% (일반 광산사 대비 1~2%p 낮게 — 운영 리스크 없음)
- 현물가 장기 컨센서스: 금 $__/oz, 은 $__/oz, 구리 $__/t
- 로열티 스트림 NAV 합계 = $__  →  주당 NAV = $__
- 적정 P/NAV __x (로열티 피어 1.2~2.0x) → 목표가 = $__`,
  relProcedure: `- 피어 EV/EBITDA 배수 __x (로열티 피어 20~35x) → 목표가 = $__`,
  bands: `Bear: 주요 Operator 생산 차질 + 원자재 가격 약세 = $__
Bull: 신규 로열티 자산 취득 + 원자재 가격 강세 + NAV 확장 = $__`,
  crossCheck: `FCF Yield 역산 참고: Forward FCF $__ ÷ 목표 FCF Yield __% → 시총 → 주당 $__`,
};
