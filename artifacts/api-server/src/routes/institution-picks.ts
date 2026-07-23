/**
 * /api/market/institution-picks
 * 기관·외인이 매집 중인 종목을 스크리닝합니다.
 *
 * 로직:
 *   1) pykrx investor_market 으로 KOSPI + KOSDAQ 전 종목 투자자 순매수 조회
 *   2) 기관 or 외인 순매수 ≥ 3억원 & 주가등락률 |change| < 5% 필터
 *   3) 복합 점수(기관+외인 순매수, 주가 안정성, 거래량) 순위 산출
 *
 * 캐시: system_cache, 4시간 TTL
 */
import { Router } from "express";
import { pool } from "@workspace/db";
import { callPykrxAny } from "../lib/pykrx-client.js";

const router = Router();

const CACHE_KEY = "institution_picks_v1";
const TTL_MS    = 4 * 60 * 60 * 1000;

export interface InstitutionPick {
  ticker:      string;
  name:        string;
  market:      string;
  institution: number;
  foreign:     number;
  combined:    number;
  change:      number;
  close:       number;
  volume:      number;
  score:       number;
  type:        "both" | "institution" | "foreign";
  rationale:   string;
}

/** YYYYMMDD 형태의 한국 날짜 — 시장 마감(15:30 KST) 전이면 전일 반환 */
function krDateCandidates(): string[] {
  const now = new Date();
  const kr  = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const krH = kr.getHours() * 60 + kr.getMinutes();
  // 15:30(930분) 이전이면 오늘 데이터 없음 → 전일부터 시작
  const startOffset = krH < 930 ? 1 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(kr);
    d.setDate(d.getDate() - (startOffset + i));
    const y   = d.getFullYear();
    const m   = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  });
}

async function loadFromDB(): Promise<{ data: InstitutionPick[]; cachedAt: string } | null> {
  try {
    const r = await pool.query(
      "SELECT data, expires_at FROM system_cache WHERE key=$1 AND expires_at > NOW() LIMIT 1",
      [CACHE_KEY],
    );
    if (!r.rows.length) return null;
    const raw = r.rows[0].data;
    const parsed: InstitutionPick[] = Array.isArray(raw) ? raw : JSON.parse(raw);
    if (!parsed.length) return null;
    const createdAt = new Date(new Date(r.rows[0].expires_at).getTime() - TTL_MS).toISOString();
    return { data: parsed, cachedAt: createdAt };
  } catch { return null; }
}

async function saveToDB(picks: InstitutionPick[]): Promise<void> {
  if (!picks.length) return;
  try {
    await pool.query(
      `INSERT INTO system_cache (key, data, expires_at)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO UPDATE SET data=$2::jsonb, expires_at=$3`,
      [CACHE_KEY, JSON.stringify(picks), new Date(Date.now() + TTL_MS)],
    );
  } catch (e) {
    console.warn("[institution-picks] DB 저장 실패:", e);
  }
}

interface RawRow {
  ticker:      string;
  name:        string;
  institution: number;
  foreign:     number;
  individual:  number;
  close:       number;
  volume:      number;
  change:      number;
}

function buildRationale(pick: InstitutionPick): string {
  const instStr = pick.institution > 0 ? `기관 +${pick.institution}억` : "";
  const foreStr = pick.foreign     > 0 ? `외인 +${pick.foreign}억`     : "";
  const who  = [instStr, foreStr].filter(Boolean).join(", ");
  const priceLine = Math.abs(pick.change) < 1
    ? `주가는 ${pick.change >= 0 ? "+" : ""}${pick.change.toFixed(1)}% 거의 보합`
    : `주가는 ${pick.change >= 0 ? "+" : ""}${pick.change.toFixed(1)}%`;
  const concl = pick.type === "both"
    ? "기관과 외국인이 동시에 사 모으는 패턴은 강한 상승 신호입니다."
    : pick.type === "institution"
    ? "기관이 꾸준히 사 모으는 종목은 단기 급등 전 자주 나타나는 패턴입니다."
    : "외국인이 집중 매수하는 종목은 향후 모멘텀이 붙을 가능성이 높습니다.";
  return `${who} 순매수. ${priceLine}에서 수급이 집중되고 있습니다. ${concl}`;
}

async function computePicks(): Promise<InstitutionPick[] | null> {
  const dateCandidates = krDateCandidates();
  let allRows: (RawRow & { market: string })[] = [];
  let usedDate = "";

  for (const date of dateCandidates) {
    console.log(`[institution-picks] 스캔 시도: ${date}`);
    try {
      const [kospiRows, kosdaqRows] = await Promise.all([
        callPykrxAny("investor_market", date, date, "KOSPI",  120_000) as Promise<RawRow[]>,
        callPykrxAny("investor_market", date, date, "KOSDAQ", 120_000) as Promise<RawRow[]>,
      ]);
      const rows: (RawRow & { market: string })[] = [
        ...(Array.isArray(kospiRows)  ? kospiRows.map(r  => ({ ...r, market: "KOSPI"  })) : []),
        ...(Array.isArray(kosdaqRows) ? kosdaqRows.map(r => ({ ...r, market: "KOSDAQ" })) : []),
      ];
      if (rows.length > 0) { allRows = rows; usedDate = date; break; }
    } catch (e) {
      console.warn(`[institution-picks] ${date} 호출 실패:`, e);
    }
  }

  if (!allRows.length) {
    console.warn("[institution-picks] 모든 날짜 시도 후 데이터 없음");
    return null;
  }
  console.log(`[institution-picks] 스캔 날짜: ${usedDate}, 원시 행: ${allRows.length}`);

  const picks: InstitutionPick[] = [];

  for (const row of allRows) {
    const inst  = row.institution ?? 0;
    const fore  = row.foreign     ?? 0;
    const change = row.change     ?? 0;
    const vol   = row.volume      ?? 0;
    const close = row.close       ?? 0;

    if (inst + fore < 3) continue;
    if (Math.abs(change) >= 5) continue;
    if (close < 500) continue;
    if (vol < 100_000) continue;

    const combined = inst + fore;
    const type: InstitutionPick["type"] =
      inst > 0 && fore > 0 ? "both"
      : inst >= fore ? "institution"
      : "foreign";

    const priceStabilityScore = Math.max(0, 1 - Math.abs(change) / 5);
    const buyScore = Math.min(combined / 100, 1);
    const score = Math.round((buyScore * 0.7 + priceStabilityScore * 0.3) * 1000) / 1000;

    const pick: InstitutionPick = {
      ticker:      row.ticker,
      name:        row.name || row.ticker,
      market:      row.market,
      institution: inst,
      foreign:     fore,
      combined,
      change:      Math.round(change * 10) / 10,
      close,
      volume: vol,
      score,
      type,
      rationale: "",
    };
    pick.rationale = buildRationale(pick);
    picks.push(pick);
  }

  picks.sort((a, b) => {
    if (a.type === "both" && b.type !== "both") return -1;
    if (b.type === "both" && a.type !== "both") return  1;
    return b.combined - a.combined;
  });

  const top = picks.slice(0, 25);
  console.log(`[institution-picks] 완료: ${top.length}개 (전체 후보 ${picks.length}개)`);
  return top;
}

router.get("/market/institution-picks", async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === "1";

    if (!forceRefresh) {
      const cached = await loadFromDB();
      if (cached) {
        return res.json({ picks: cached.data, cachedAt: cached.cachedAt, fromCache: true });
      }
    }

    const picks = await computePicks();
    if (!picks) {
      return res.status(503).json({ error: "기관·외인 매집 데이터를 불러오지 못했습니다." });
    }

    await saveToDB(picks);
    return res.json({ picks, cachedAt: new Date().toISOString(), fromCache: false });
  } catch (e: any) {
    console.error("[institution-picks]", e);
    return res.status(500).json({ error: "오류가 발생했습니다." });
  }
});

export default router;
