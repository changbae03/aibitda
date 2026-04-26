import { pool } from "@workspace/db";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as XLSX from "xlsx";

const SNAPSHOT_DATE = "2026-04-26";

async function main() {
  const BASE = resolve(process.cwd(), "attached_assets");

  const readXlsx = (file: string) =>
    (XLSX.utils.sheet_to_json(
      XLSX.readFile(resolve(BASE, file)).Sheets["Sheet1"],
      { header: 1 }
    ) as any[][]).slice(1);

  const pbrRows  = readXlsx("data_4950_20260426_1777175403413.xlsx");
  const kospiRows = readXlsx("data_5212_20260426_1777175539676.xlsx");
  const kosdaqRows = readXlsx("data_5244_20260426_1777175569665.xlsx");

  // PBR 맵 (종목코드 → 지표)
  const pbrMap = new Map<string, { pbr: any; per: any; bps: any; eps: any }>();
  for (const r of pbrRows) {
    const code = String(r[0]).padStart(6, "0");
    pbrMap.set(code, { eps: r[5], per: r[6], bps: r[9], pbr: r[10] });
  }

  // 업종 통합
  const sectorRows = [...kospiRows, ...kosdaqRows];

  // 테이블 생성
  await pool.query(`
    CREATE TABLE IF NOT EXISTS krx_peer_data (
      id           SERIAL PRIMARY KEY,
      code         VARCHAR(10) NOT NULL,
      name         VARCHAR(100) NOT NULL,
      market       VARCHAR(10) NOT NULL,
      sector       VARCHAR(50) NOT NULL,
      pbr          NUMERIC(10,2),
      per          NUMERIC(10,2),
      bps          NUMERIC(14,2),
      eps          NUMERIC(14,2),
      mcap         BIGINT,
      snapshot_date DATE NOT NULL,
      created_at   TIMESTAMP DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS krx_peer_data_code_date_idx
      ON krx_peer_data(code, snapshot_date);
  `);

  let inserted = 0;
  let skipped  = 0;

  for (const r of sectorRows) {
    const code   = String(r[0]).padStart(6, "0");
    const name   = String(r[1]);
    const market = String(r[2]);
    const sector = String(r[3]);
    const mcap   = typeof r[7] === "number" ? r[7] : null;
    const p      = pbrMap.get(code);
    const pbr    = p && typeof p.pbr === "number" && p.pbr > 0 ? p.pbr : null;
    const per    = p && typeof p.per === "number" && p.per > 0 ? p.per : null;
    const bps    = p && typeof p.bps === "number" ? p.bps : null;
    const eps    = p && typeof p.eps === "number" ? p.eps : null;

    const res = await pool.query(
      `INSERT INTO krx_peer_data (code, name, market, sector, pbr, per, bps, eps, mcap, snapshot_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (code, snapshot_date) DO UPDATE
         SET pbr=EXCLUDED.pbr, per=EXCLUDED.per, bps=EXCLUDED.bps,
             eps=EXCLUDED.eps, mcap=EXCLUDED.mcap`,
      [code, name, market, sector, pbr, per, bps, eps, mcap, SNAPSHOT_DATE]
    );
    if (res.rowCount && res.rowCount > 0) inserted++;
    else skipped++;
  }

  console.log(`완료 — 삽입/업데이트: ${inserted}, 스킵: ${skipped}`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
