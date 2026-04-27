import { Router } from "express";
import { pool } from "@workspace/db";
import YahooFinance from "yahoo-finance2";

const router = Router();
const yahooFinance = new YahooFinance();

async function fetchCurrentPrice(ticker: string): Promise<number | null> {
  const isKorean = /^\d{6}$/.test(ticker);
  if (isKorean) {
    const [ks, kq] = await Promise.allSettled([
      yahooFinance.quote(`${ticker}.KS`, { fields: ["regularMarketPrice"] }),
      yahooFinance.quote(`${ticker}.KQ`, { fields: ["regularMarketPrice"] }),
    ]);
    const ksPrice = ks.status === "fulfilled" ? (ks.value?.regularMarketPrice ?? null) : null;
    const kqPrice = kq.status === "fulfilled" ? (kq.value?.regularMarketPrice ?? null) : null;
    return ksPrice ?? kqPrice;
  } else {
    try {
      const q = await yahooFinance.quote(ticker, { fields: ["regularMarketPrice"] });
      return q?.regularMarketPrice ?? null;
    } catch {
      return null;
    }
  }
}

export function classifySector(industry: string, market: "KR" | "US"): string {
  const ind = (industry ?? "").toLowerCase();
  if (market === "KR") {
    // 바이오·제약 (semiconductor equipment보다 먼저 체크해야 "bio" 포함 오류 방지)
    if (ind.includes("biotech") || ind.includes("pharma") || ind.includes("바이오") || ind.includes("제약") || ind.includes("drug")) return "KR_BIOTECH";
    // 반도체 장비·소재 (순수 반도체보다 먼저 체크)
    if (ind.includes("semiconductor equipment") || ind.includes("semiconductor material") || ind.includes("반도체 장비") || ind.includes("반도체 소재")) return "KR_SEMICONDUCTOR_EQ";
    // 반도체·메모리
    if (ind.includes("반도체") || ind.includes("semiconductor") || ind.includes("memory") || ind.includes("foundry")) return "KR_SEMICONDUCTOR";
    // 금융
    if (ind.includes("금융") || ind.includes("은행") || ind.includes("보험") || ind.includes("증권") || ind.includes("financial") || ind.includes("bank") || ind.includes("insurance") || ind.includes("capital market")) return "KR_FINANCIAL";
    // 건설·건자재
    if (ind.includes("건설") || ind.includes("건자재") || ind.includes("construc") || ind.includes("engineering & construction")) return "KR_CONSTRUCTION";
    // 통신
    if (ind.includes("통신") || ind.includes("telecom") || ind.includes("wireless") || ind.includes("communication services")) return "KR_TELECOM";
    // 리츠·부동산
    if (ind.includes("리츠") || ind.includes("reit") || ind.includes("real estate")) return "KR_REIT";
    // 자동차·부품
    if (ind.includes("자동차") || ind.includes("automotive") || ind.includes("auto part") || ind.includes("car")) return "KR_AUTO";
    // IT·게임·플랫폼·소프트웨어
    if (ind.includes("software") || ind.includes("internet") || ind.includes("gaming") || ind.includes("multimedia") || ind.includes("platform") || ind.includes("게임") || ind.includes("it서비스")) return "KR_IT";
    // 소비재·전자
    if (ind.includes("consumer electronics") || ind.includes("소비재") || ind.includes("consumer cyclical") || ind.includes("retail")) return "KR_CONSUMER";
    // 에너지·화학
    if (ind.includes("energy") || ind.includes("oil") || ind.includes("chemical") || ind.includes("에너지") || ind.includes("화학")) return "KR_ENERGY";
    // 방산·조선·기계
    if (ind.includes("defense") || ind.includes("aerospace") || ind.includes("shipbuilding") || ind.includes("machinery")) return "KR_DEFENSE";
    return "KR_OTHER";
  } else {
    if (ind.includes("biotech") || ind.includes("pharmaceutical") || ind.includes("drug")) return "US_BIOTECH";
    if (ind.includes("semiconductor equipment") || ind.includes("semiconductor material")) return "US_SEMICONDUCTOR_EQ";
    if (ind.includes("semiconductor") || ind.includes("foundry") || ind.includes("memory")) return "US_TECH";
    if (ind.includes("software") || ind.includes("technology") || ind.includes("internet") || ind.includes("cloud")) return "US_TECH";
    if (ind.includes("bank") || ind.includes("financial") || ind.includes("insurance") || ind.includes("capital market")) return "US_FINANCIAL";
    if (ind.includes("reit") || ind.includes("real estate")) return "US_REIT";
    if (ind.includes("energy") || ind.includes("oil") || ind.includes("mining")) return "US_ENERGY";
    if (ind.includes("defense") || ind.includes("aerospace")) return "US_DEFENSE";
    if (ind.includes("telecom") || ind.includes("communication")) return "US_TELECOM";
    if (ind.includes("utilities")) return "US_UTILITIES";
    if (ind.includes("consumer") || ind.includes("retail")) return "US_CONSUMER";
    return "US_OTHER";
  }
}

function isBullishVerdict(verdict: string): boolean | null {
  const v = verdict.trim();
  if (v.includes("강력매수") || v.includes("적극매수") || v.includes("Strong Buy") || v.includes("매수") || v.includes("Buy")) return true;
  if (v.includes("매도") || v.includes("적극매도") || v.includes("Sell") || v.includes("Strong Sell")) return false;
  return null;
}

router.post("/performance/recalculate", async (req, res) => {
  try {
    const adminCheck = await pool.query(
      `SELECT 1 FROM admins WHERE user_id = $1`,
      [(req as any).session?.userId]
    );
    if (adminCheck.rowCount === 0) {
      return res.status(403).json({ error: "관리자 권한이 필요합니다" });
    }

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { rows: analyses } = await pool.query(
      `SELECT id, ticker, industry, investment_verdict, start_price, target_price, created_at
       FROM analyses
       WHERE status = 'completed'
         AND start_price IS NOT NULL
         AND target_price IS NOT NULL
         AND investment_verdict IS NOT NULL
         AND created_at < $1
       ORDER BY created_at DESC`,
      [cutoff]
    );

    if (analyses.length === 0) {
      return res.json({ message: "보정 가능한 데이터가 없습니다. 30일 이상 된 분석이 필요합니다.", count: 0 });
    }

    const uniqueTickers = [...new Set(analyses.map((r: any) => r.ticker as string))];
    const priceMap = new Map<string, number | null>();
    await Promise.all(
      uniqueTickers.map(async (ticker) => {
        const price = await fetchCurrentPrice(ticker);
        priceMap.set(ticker, price);
      })
    );

    const sectorStats = new Map<string, {
      market: "KR" | "US";
      directionCorrect: number;
      directionTotal: number;
      deviationSum: number;
      deviationCount: number;
    }>();

    for (const row of analyses) {
      const ticker = row.ticker as string;
      const industry = row.industry as string;
      const verdict = row.investment_verdict as string;
      const startPrice = parseFloat(row.start_price);
      const targetPrice = parseFloat(row.target_price);
      const currentPrice = priceMap.get(ticker);

      if (!currentPrice || isNaN(startPrice) || isNaN(targetPrice) || startPrice === 0) continue;

      const market: "KR" | "US" = /^\d{6}$/.test(ticker) ? "KR" : "US";
      const sector = classifySector(industry, market);

      if (!sectorStats.has(sector)) {
        sectorStats.set(sector, { market, directionCorrect: 0, directionTotal: 0, deviationSum: 0, deviationCount: 0 });
      }
      const stats = sectorStats.get(sector)!;

      const bullish = isBullishVerdict(verdict);
      if (bullish !== null) {
        const actualUp = currentPrice > startPrice;
        if ((bullish && actualUp) || (!bullish && !actualUp)) {
          stats.directionCorrect++;
        }
        stats.directionTotal++;
      }

      const deviationPct = ((targetPrice - currentPrice) / startPrice) * 100;
      stats.deviationSum += deviationPct;
      stats.deviationCount++;
    }

    let updatedSectors = 0;
    for (const [sector, stats] of sectorStats.entries()) {
      const directionAccuracy = stats.directionTotal > 0
        ? (stats.directionCorrect / stats.directionTotal) * 100
        : null;
      const avgPriceDeviation = stats.deviationCount > 0
        ? stats.deviationSum / stats.deviationCount
        : null;
      const sampleCount = stats.deviationCount;

      await pool.query(
        `INSERT INTO model_calibration (sector, market, direction_accuracy, avg_price_deviation, sample_count, last_recalc_at, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (sector) DO UPDATE SET
           market = EXCLUDED.market,
           direction_accuracy = EXCLUDED.direction_accuracy,
           avg_price_deviation = EXCLUDED.avg_price_deviation,
           sample_count = EXCLUDED.sample_count,
           last_recalc_at = NOW()`,
        [sector, stats.market, directionAccuracy, avgPriceDeviation, sampleCount]
      );
      updatedSectors++;
    }

    // 히스토리 스냅샷 저장
    for (const [sector, stats] of sectorStats.entries()) {
      const directionAccuracy = stats.directionTotal > 0
        ? (stats.directionCorrect / stats.directionTotal) * 100
        : null;
      const avgPriceDeviation = stats.deviationCount > 0
        ? stats.deviationSum / stats.deviationCount
        : null;
      await pool.query(
        `INSERT INTO calibration_history (sector, market, direction_accuracy, avg_price_deviation, sample_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [sector, stats.market, directionAccuracy, avgPriceDeviation, stats.deviationCount]
      );
    }

    return res.json({
      message: "모델 보정 완료",
      analysesProcessed: analyses.length,
      sectorsUpdated: updatedSectors,
      sectors: Object.fromEntries(
        Array.from(sectorStats.entries()).map(([k, v]) => [
          k,
          {
            directionAccuracy: v.directionTotal > 0 ? Math.round((v.directionCorrect / v.directionTotal) * 100) : null,
            avgPriceDeviation: v.deviationCount > 0 ? Math.round((v.deviationSum / v.deviationCount) * 10) / 10 : null,
            sampleCount: v.deviationCount,
          }
        ])
      ),
    });
  } catch (err) {
    console.error("[performance/recalculate] error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/performance/calibration-history", async (req, res) => {
  const { sector } = req.query as { sector?: string };
  try {
    const { rows } = await pool.query(
      `SELECT sector, market, direction_accuracy, avg_price_deviation, sample_count,
              TO_CHAR(recorded_at AT TIME ZONE 'Asia/Seoul', 'MM/DD') AS label,
              recorded_at
       FROM calibration_history
       ${sector ? "WHERE sector = $1" : ""}
       ORDER BY recorded_at ASC
       LIMIT 200`,
      sector ? [sector] : []
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

router.get("/performance/calibration", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sector, market, direction_accuracy, avg_price_deviation, sample_count, last_recalc_at
       FROM model_calibration
       ORDER BY sector`
    );
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ── 섹터별 도메인 지식 사전 보정값 ─────────────────────────────────────────────
// 실적 데이터 30건 누적 전에도 항상 적용되는 한국 시장 특성 기반 사전 보정
const SECTOR_PRIORS: Record<string, {
  waccRange: string;
  terminalG: string;
  peersNote: string;
  biasRisk: string;
  specificLevers: string[];
}> = {
  KR_SEMICONDUCTOR: {
    waccRange: "WACC 11.0~14.0% (한국 반도체: 시장위험 + 사이클 리스크 반영)",
    terminalG: "Terminal g ≤ 1.5% (반도체는 기술 진부화 리스크로 장기 성장 보수적 적용)",
    peersNote: "피어: 삼성전자 반도체부문·SK하이닉스·Micron·Samsung Foundry(비상장 추정) 순서로 우선. EV/EBITDA 한국 벤치마크(6~14x)와 미국 Damodaran(23.9x) 차이 주의 — 한국 주식이면 한국 멀티플 우선.",
    biasRisk: "과대평가 위험: AI가 HBM 성장률을 장기에도 지속 적용하는 경향. Year 3 이후 성장률을 컨센서스 수준(8~12%)으로 반드시 수렴.",
    specificLevers: [
      "Year 2 성장률은 Year 1의 30~50%로 감소 적용 (예: Y1 +55% → Y2 +15~25%)",
      "OPM 상한: Year 1~2 최대 45%, Year 3~5 최대 35%, Year 6~10 최대 28%",
      "FCFF/매출 상한: Year 1~5 최대 15%, Year 6~10 최대 12%",
      "10년 매출 CAGR이 15% 초과 시 과성장 가정 — 컨센서스로 하향",
      "목표주가가 현재주가 2배 초과 시 WACC 최소 1%p 상향 재검토 필수",
    ],
  },
  KR_BIOTECH: {
    waccRange: "WACC 12.0~16.0% (임상 단계별 차등: 3상 12~13%, 2상 14~15%, 1상/전임상 15~16%)",
    terminalG: "Terminal g ≤ 2.0% (상업화 후 성숙기 기준)",
    peersNote: "피어 rNPV PoS 기준: 3상 40~65%, 2상 15~30%, 1상 5~15%, 전임상 1~5%. 이미 허가·판매 중인 제품은 PoS=100% 고정(DCF).",
    biasRisk: "과소평가 위험: AI가 rNPV 계산 시 글로벌 파이프라인 전체를 낮은 PoS로 일괄 할인하는 경향. 허가 완료 제품과 임상 파이프라인 분리 평가 필수.",
    specificLevers: [
      "허가 완료 제품(한국·해외 허가): PoS=100% DCF로 별도 산정 후 합산",
      "rNPV 계산 시 할인율과 PoS를 이중 적용하지 말 것 (PoS는 현금흐름에, 할인율은 TV에만 적용)",
      "목표주가가 현재주가 -50% 이하면 허가 완료 제품 DCF 누락 가능성 재검토",
      "한국 임상 바이오 평균 PBR 4~12x 참조하여 rNPV 하한선 크로스체크 필수",
    ],
  },
  KR_FINANCIAL: {
    waccRange: "자기자본비용(CoE) 9.0~12.0% (금융주는 WACC 대신 Gordon Growth P/B 모델 사용)",
    terminalG: "g = 장기 GDP 성장률 수준 2.0~3.0%",
    peersNote: "피어: KB금융·신한지주·하나금융·우리금융 (국내 4대 금융지주 기준). PBR 0.4~0.9x 범위 — 코스피 대비 할인 반영.",
    biasRisk: "주의: 금융주 DDM 시 배당 성장률 과대평가 경향. 한국 금융주는 배당 규제로 DDM 과소평가 → Gordon P/B 모델 우선.",
    specificLevers: [
      "적정 P/B = (ROE - g) / (CoE - g) 공식 적용",
      "ROE 10~14% (최근 4대 금융지주 평균) 기준 적용",
      "BPS에 자사주·우선주 조정 반영",
    ],
  },
  KR_CONSTRUCTION: {
    waccRange: "WACC 9.0~12.0% (건설: 프로젝트 리스크 반영)",
    terminalG: "Terminal g ≤ 1.5%",
    peersNote: "피어: 삼성물산 건설부문·현대건설·GS건설·대우건설. EV/EBITDA 4~8x, PBR 0.3~0.6x 범위.",
    biasRisk: "주의: 삼성물산 등 복합기업은 SOTP 적용 필수. 건설부문 + 상사부문 + 투자부문 분리 평가. 단순 DCF 사용 시 지배구조 할인 미반영 오류.",
    specificLevers: [
      "SOTP 적용 시 각 사업부문 독립 멀티플 사용",
      "건설수주잔고 기반 매출 인식 확인 (잔고 소진율 반영)",
      "PF(프로젝트 파이낸싱) 우발부채 리스크 할인 반영",
    ],
  },
  KR_AUTO: {
    waccRange: "WACC 9.5~12.5%",
    terminalG: "Terminal g ≤ 1.5% (자동차: 전기차 전환 리스크 반영)",
    peersNote: "피어: 현대차·기아·Toyota·Volkswagen·BMW. PER 6~14x, EV/EBITDA 3~8x 범위.",
    biasRisk: "EV 전환 비용 과소평가 경향. R&D·Capex 증가 반영하여 FCFF 하향 압력 적용.",
    specificLevers: [
      "전기차 전환 비용: 연간 Capex 20~30% 증가 반영 (2026~2030)",
      "배터리 원가 하락 효과와 수익성 개선 균형 조정",
    ],
  },
  KR_REIT: {
    waccRange: "Cap Rate 4.5~7.0% (리츠 유형별: 물류 4.5~5.5%, 리테일 6~7%, 오피스 5~6%)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 롯데리츠·ESR켄달스퀘어·SK리츠. FFO 기반 P/FFO 12~18x 우선.",
    biasRisk: "NAV 계산 시 감정평가 기반 자산가치 사용 — 시장 거래 Cap Rate와의 차이 주의.",
    specificLevers: [
      "FFO = 순이익 + 감가상각 - 자산매각이익 (GAAP 순이익 사용 금지)",
      "NAV 할인율: 코스피 상장 리츠 평균 NAV 대비 10~20% 할인 적용",
    ],
  },
  KR_TELECOM: {
    waccRange: "WACC 7.5~9.5% (통신: 안정적 현금흐름 반영)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: SK텔레콤·KT·LG유플러스. EV/EBITDA 4~7x, PER 10~18x 범위.",
    biasRisk: "5G 투자 부담으로 단기 FCF 압박 → FCFF 과대평가 주의.",
    specificLevers: [
      "5G Capex 피크(2024~2026) 이후 감소 경로 반영",
      "배당 안정성 높아 DDM 보조 모델로 크로스체크 권장",
    ],
  },
  US_TECH: {
    waccRange: "WACC 9.0~13.0% (미국 테크: 성장 단계별 차등)",
    terminalG: "Terminal g ≤ 3.0%",
    peersNote: "Damodaran US Semiconductor: EV/EBITDA 23.9x, EV/Sales 7.1x 참조.",
    biasRisk: "미국 테크주: AI 관련 성장 프리미엄 과대반영 경향. 수익성 전환 시점 보수적 추정.",
    specificLevers: [
      "SBC(주식보상비용) 반드시 비용으로 처리 (adjusted EBITDA 사용 금지)",
      "FCF Yield 방법으로 크로스체크: 현재주가 기준 FCF Yield 2~5% 정상 범위",
    ],
  },
  US_BIOTECH: {
    waccRange: "WACC 10.0~14.0% (임상 단계별 차등)",
    terminalG: "Terminal g ≤ 2.5%",
    peersNote: "rNPV PoS 기준: FDA 3상 45~65%, 2상 20~35%, 1상 8~18%.",
    biasRisk: "FDA 심사 타임라인 과낙관 경향. PDUFA 날짜 기반 현금흐름 타이밍 조정 필수.",
    specificLevers: [
      "상업화 매출 반영: FDA 허가 후 12~18개월 시장 침투 지연 반영",
      "특허 만료 시점 반드시 DCF 기간에 포함",
    ],
  },
  KR_SEMICONDUCTOR_EQ: {
    waccRange: "WACC 10.0~13.0% (반도체 장비·소재: 고객 집중 리스크 반영)",
    terminalG: "Terminal g ≤ 1.5%",
    peersNote: "피어: ASML·Lam Research·Applied Materials·원익IPS·피에스케이·동진쎄미켐. EV/Sales 2~6x (한국), EV/EBITDA 8~20x.",
    biasRisk: "고객(삼성·SK하이닉스) 투자사이클에 연동된 매출 변동성 높음. 수주잔고·장비납기 사이클 감안하여 연도별 성장률 차등화 필수.",
    specificLevers: [
      "수주잔고 기반 단기(Y1~Y2) 매출 추정 우선, 분기별 공시 확인",
      "반도체 고객의 Capex 사이클(2026~2027 피크 예상)에 연동한 성장률 모델링",
      "한미반도체처럼 독점 제품은 20~30% 프리미엄 멀티플 적용 가능하나 고객 집중 리스크 할인",
    ],
  },
  KR_IT: {
    waccRange: "WACC 9.0~12.0% (IT·게임·플랫폼)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 카카오·넷마블·크래프톤·엔씨소프트·펄어비스 (게임), 네이버·카카오 (플랫폼). PER 15~35x, EV/Sales 2~5x.",
    biasRisk: "게임주: 신작 흥행 여부 불확실성 과소평가 경향. 플랫폼주: 광고 매출 사이클 변동성 고려.",
    specificLevers: [
      "신작 게임: 오픈 후 12개월 이내 매출 집중, 이후 급감 곡선 모델링",
      "플랫폼: MAU 성장률 둔화 감안하여 ARPU 개선 여부 별도 분석",
      "SBC 반드시 비용 처리",
    ],
  },
  KR_CONSUMER: {
    waccRange: "WACC 8.5~11.0% (소비재·전자)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 삼성전자(소비자 가전부문)·LG전자·애플·Sony. EV/EBITDA 5~12x, PER 12~20x.",
    biasRisk: "삼성전자 등 복합 대기업은 반도체·가전·모바일 부문 분리 분석 필수. 소비자 가전만 분석 시 과대평가 주의.",
    specificLevers: [
      "삼성전자 분석 시: 반도체(DS) + 가전(CE) + MX 부문 SOTP 또는 통합 DCF로 전체 기업 분석 필수",
      "가전 부문 OPM 상한: 8~12% (반도체 OPM과 혼용 금지)",
      "WM(웨어러블·스마트홈) 성장 가정 보수적 적용",
    ],
  },
  KR_ENERGY: {
    waccRange: "WACC 8.0~11.0% (에너지·화학)",
    terminalG: "Terminal g ≤ 1.5%",
    peersNote: "피어: SK이노베이션·GS칼텍스·롯데케미칼·LG화학. EV/EBITDA 4~8x, PBR 0.5~1.2x.",
    biasRisk: "유가·화학 스프레드 사이클 변동성 과소평가 경향. 중기(2~3년) 정상화 가정 사용.",
    specificLevers: [
      "유가 가정: WTI 70~85$/bbl 범위 내 기준 케이스 사용",
      "배터리 소재(양극재·음극재) 포함 시 별도 성장 모델 추가",
    ],
  },
  KR_DEFENSE: {
    waccRange: "WACC 8.0~10.5% (방산·조선·기계)",
    terminalG: "Terminal g ≤ 2.0%",
    peersNote: "피어: 한화에어로스페이스·LIG넥스원·현대로템·HD현대중공업. EV/EBITDA 8~20x (방산 프리미엄), PER 12~25x.",
    biasRisk: "수출 수주 지속성 불확실성 과소평가 경향. 폴란드·루마니아 등 대규모 계약의 이행 리스크 반영 필수.",
    specificLevers: [
      "수출 계약: 이행 단계별 매출 인식(납품 일정 기반) 모델링",
      "방산 업체: 장기 수주잔고 기반 매출 예측 가능성 높음 → DCF 신뢰도 우수",
      "조선: 수주단가 vs 철강 원가 스프레드 모델링 필수",
    ],
  },
};

// ── 데이터 기반 보정: 관측된 편향을 WACC·성장률 레버로 변환 ─────────────────────
function biasToLeverGuidance(devRounded: number, sector: string): string[] {
  const lines: string[] = [];
  const isKR = sector.startsWith("KR_");

  if (devRounded > 20) {
    // 심각한 과대평가
    lines.push(`⛔ 심각한 과대평가 편향(+${devRounded}%p) 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 1.5~2.0%p 상향하세요`);
    lines.push(`  2. Terminal g를 0.5%p 하향하세요 (상한: ${isKR ? "1.5" : "2.5"}%)`);
    lines.push(`  3. DCF 가중치를 줄이고 피어 멀티플 가중치를 높이세요 (DCF 40% / 피어 60%)`);
    lines.push(`  4. Bear 시나리오 가중치를 30%로 높이세요`);
  } else if (devRounded > 10) {
    lines.push(`⚠️ 중간 수준 과대평가(+${devRounded}%p) 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 1.0%p 상향하세요`);
    lines.push(`  2. Year 6~10 성장률을 0.5%p 하향 조정하세요`);
    lines.push(`  3. Bear 시나리오 가중치를 20~25%로 높이세요`);
  } else if (devRounded > 5) {
    lines.push(`⚠️ 소폭 과대평가(+${devRounded}%p) 감지:`);
    lines.push(`  1. 하단 시나리오(Bear) 가중치를 15%로 상향하세요`);
    lines.push(`  2. 피어 멀티플에서 하위 사분위수(P25) 기준값을 함께 제시하세요`);
  } else if (devRounded < -20) {
    // 심각한 과소평가
    lines.push(`⛔ 심각한 과소평가(${devRounded}%p) 편향 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 1.0~1.5%p 하향하세요`);
    lines.push(`  2. 허가 완료 제품·기존 수익 자산의 가치를 재확인하세요 (DCF 누락 가능성)`);
    lines.push(`  3. Bull 시나리오 가중치를 30%로 높이세요`);
  } else if (devRounded < -10) {
    lines.push(`⚠️ 중간 수준 과소평가(${devRounded}%p) 감지:`);
    lines.push(`  1. WACC를 현재 가정보다 0.5~1.0%p 하향하세요`);
    lines.push(`  2. 상단 시나리오(Bull) 가중치를 25%로 높이세요`);
  }

  return lines;
}

export async function getCalibrationContext(sector: string): Promise<string | null> {
  try {
    // ── Part 1: 섹터 도메인 사전 지식 (데이터 없어도 항상 반환) ──────────────
    const prior = SECTOR_PRIORS[sector] ?? null;

    // ── Part 2: 실적 데이터 기반 편향 보정 (3건 이상 있을 때) ──────────────
    const { rows } = await pool.query(
      `SELECT direction_accuracy, avg_price_deviation, sample_count
       FROM model_calibration
       WHERE sector = $1`,
      [sector]
    );

    const hasStat = rows.length > 0 && (rows[0].sample_count as number) >= 3;
    const cal = hasStat ? rows[0] : null;
    const dirAcc = cal ? (cal.direction_accuracy as number | null) : null;
    const dev = cal ? (cal.avg_price_deviation as number | null) : null;
    const n = cal ? (cal.sample_count as number) : 0;

    // 사전 지식도, 데이터도 없으면 null
    if (!prior && !hasStat) return null;

    const lines: string[] = [];

    // ── 사전 지식 섹션 ─────────────────────────────────────────────────────
    if (prior) {
      lines.push(`[🧠 섹터 밸류에이션 보정 지침 — ${sector}]`);
      lines.push(`이 섹터의 한국 시장 특성 및 데이터 학습 결과를 반드시 반영하세요:\n`);
      lines.push(`▶ 적정 WACC 범위: ${prior.waccRange}`);
      lines.push(`▶ Terminal g: ${prior.terminalG}`);
      lines.push(`▶ 피어 선택: ${prior.peersNote}`);
      lines.push(`▶ 주요 편향 위험: ${prior.biasRisk}`);
      if (prior.specificLevers.length > 0) {
        lines.push(`▶ 핵심 조정 레버:`);
        for (const lever of prior.specificLevers) {
          lines.push(`  • ${lever}`);
        }
      }
    }

    // ── 데이터 기반 보정 섹션 ─────────────────────────────────────────────
    if (hasStat) {
      lines.push(`\n[📊 실적 데이터 보정 — 과거 ${n}건 분석 학습]`);

      if (dirAcc !== null) {
        const accLabel = dirAcc < 50
          ? "⚠️ 불확실 (방향 예측 무작위 수준)"
          : dirAcc < 60 ? "보통" : "양호";
        lines.push(`• 방향 예측 정확도: ${Math.round(dirAcc)}% (${accLabel})`);
        if (dirAcc < 50) {
          lines.push(`  → 투자의견 보정: 이 섹터는 매수/매도 단정 대신 중립 + 조건부 논리를 우선 사용하세요`);
        }
      }

      if (dev !== null) {
        const devRounded = Math.round(dev * 10) / 10;
        const biasLabel = devRounded > 0
          ? `+${devRounded}%p 과대평가 경향`
          : `${devRounded}%p 과소평가 경향`;
        lines.push(`• 목표주가 편향: ${biasLabel}`);
        const leverLines = biasToLeverGuidance(devRounded, sector);
        lines.push(...leverLines);
      }
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

export { router as performanceRouter };
export default router;
