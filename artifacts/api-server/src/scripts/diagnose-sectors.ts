import { pool } from "@workspace/db";

(async () => {
  // analyses 컬럼 확인
  const { rows: cols } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='analyses' ORDER BY ordinal_position`
  );
  const colNames = cols.map((r:any) => r.column_name);
  console.log("컬럼:", colNames.join(", "));

  // 30일 이상 된 완료 분석
  const { rows } = await pool.query(`
    SELECT
      a.id,
      a.ticker,
      a.company_name,
      a.industry,
      a.investment_verdict,
      a.target_price,
      a.start_price,
      a.created_at
    FROM analyses a
    WHERE a.status = 'completed'
      AND a.start_price IS NOT NULL
      AND a.start_price > 0
      AND a.target_price IS NOT NULL
      AND a.created_at < NOW() - INTERVAL '30 days'
    ORDER BY a.industry, a.ticker, a.created_at DESC
  `);

  console.log(`\n총 ${rows.length}건 분석`);

  // Yahoo Finance로 현재가 가져오는 대신, model_calibration에서 섹터별 집계만
  // — 섹터별 종목 목록과 특성 파악
  const sectorMap: Record<string, {ticker: string; company: string; industry: string; targetUpside: number}[]> = {};

  for (const r of rows) {
    const industry = r.industry ?? "";
    const ticker = r.ticker ?? "";
    const market: "KR" | "US" = /^\d{6}$/.test(ticker) ? "KR" : "US";
    const sector = classifySector(industry, market);

    if (!sectorMap[sector]) sectorMap[sector] = [];
    const upside = r.start_price > 0 ? ((r.target_price - r.start_price) / r.start_price) * 100 : 0;
    sectorMap[sector].push({ ticker, company: r.company_name ?? "", industry, targetUpside: Math.round(upside) });
  }

  for (const [sector, items] of Object.entries(sectorMap).sort()) {
    const avgUpside = items.reduce((s,i) => s + i.targetUpside, 0) / items.length;
    const highUpsideCnt = items.filter(i => i.targetUpside > 80).length;
    console.log(`\n=== ${sector} (${items.length}건, 평균목표상승 ${avgUpside.toFixed(0)}%, 80%초과 ${highUpsideCnt}건) ===`);
    // 중복 제거하여 종목 목록
    const unique = [...new Map(items.map(i => [i.ticker, i])).values()];
    for (const it of unique) {
      const flag = it.targetUpside > 150 ? "🚨" : it.targetUpside > 80 ? "⚠️" : "✅";
      console.log(`  ${flag} ${it.ticker} ${it.company.slice(0,12).padEnd(12)} | industry: ${it.industry.slice(0,30)} | 목표상승 ${it.targetUpside > 0 ? "+" : ""}${it.targetUpside}%`);
    }
  }

  // model_calibration 확인
  const { rows: cal } = await pool.query(
    `SELECT sector, direction_accuracy, avg_price_deviation, sample_count FROM model_calibration ORDER BY sector`
  );
  console.log("\n\n=== model_calibration 현황 ===");
  for (const c of cal) {
    console.log(`  ${c.sector}: 방향 ${c.direction_accuracy ?? "?"}% | 가격괴리 ${c.avg_price_deviation ?? "?"}% | ${c.sample_count}건`);
  }

  await pool.end();
  process.exit(0);
})();

function classifySector(industry: string, market: "KR" | "US"): string {
  const ind = (industry ?? "").toLowerCase();
  if (market === "KR") {
    if (ind.includes("biotech") || ind.includes("pharma") || ind.includes("바이오") || ind.includes("제약") || ind.includes("drug")) return "KR_BIOTECH";
    if (ind.includes("semiconductor equipment") || ind.includes("semiconductor material") || ind.includes("반도체 장비") || ind.includes("반도체 소재")) return "KR_SEMICONDUCTOR_EQ";
    if (ind.includes("반도체") || ind.includes("semiconductor") || ind.includes("memory") || ind.includes("foundry")) return "KR_SEMICONDUCTOR";
    if (ind.includes("금융") || ind.includes("은행") || ind.includes("보험") || ind.includes("증권") || ind.includes("financial") || ind.includes("bank")) return "KR_FINANCIAL";
    if (ind.includes("건설") || ind.includes("construc") || ind.includes("engineering & construction")) return "KR_CONSTRUCTION";
    if (ind.includes("통신") || ind.includes("telecom") || ind.includes("wireless") || ind.includes("communication services")) return "KR_TELECOM";
    if (ind.includes("리츠") || ind.includes("reit") || ind.includes("real estate")) return "KR_REIT";
    if (ind.includes("자동차") || ind.includes("automotive") || ind.includes("auto part") || ind.includes("car")) return "KR_AUTO";
    if (ind.includes("software") || ind.includes("internet") || ind.includes("gaming") || ind.includes("multimedia") || ind.includes("platform") || ind.includes("게임") || ind.includes("it서비스")) return "KR_IT";
    if (ind.includes("consumer electronics") || ind.includes("소비재") || ind.includes("consumer cyclical") || ind.includes("retail")) return "KR_CONSUMER";
    if (ind.includes("energy") || ind.includes("oil") || ind.includes("chemical") || ind.includes("에너지") || ind.includes("화학")) return "KR_ENERGY";
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
    if (ind.includes("consumer") || ind.includes("retail")) return "US_CONSUMER";
    return "US_OTHER";
  }
}
