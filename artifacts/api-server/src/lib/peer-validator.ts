/**
 * peer-validator.ts
 * 분석 완료 후 피어 그룹의 적절성을 자동 검증한다.
 *
 * 검증 항목:
 *  1. peer_no_data      — Yahoo/DART 데이터 전혀 없음 (존재하지 않는 티커 의심)
 *  2. peer_count_low    — 유효 피어 2개 미만
 *  3. peer_size_extreme — 피어 시총이 피어 그룹 중앙값의 30배 초과/미만
 *  4. peer_sector_mismatch — 피어 섹터가 분석 대상과 다름 (sector 데이터 있을 때만)
 */

import path from "path";
import fs from "fs/promises";
import { sanitizePathComponent } from "./sanitize.js";

export interface PeerIssue {
  type: "no_data" | "count_low" | "size_extreme" | "sector_mismatch";
  ticker?: string;
  detail: string;
  severity: "warning" | "error";
}

export interface PeerValidationResult {
  issues: PeerIssue[];
  validPeerCount: number;
  totalPeerCount: number;
  hasIssues: boolean;
}

const DATA_DIR = path.join(process.cwd(), "data", "peers");

// 광범위 섹터 정규화 — 같은 군으로 묶어 너무 민감한 오탐 방지
const SECTOR_GROUP: Record<string, string> = {
  "technology": "tech",
  "communication services": "tech",
  "consumer cyclical": "consumer",
  "consumer defensive": "consumer",
  "industrials": "industrial",
  "basic materials": "materials",
  "energy": "energy",
  "healthcare": "healthcare",
  "financial services": "financial",
  "real estate": "real_estate",
  "utilities": "utilities",
};

function normalizeSector(s: string): string {
  const lower = s.toLowerCase();
  return SECTOR_GROUP[lower] ?? lower;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function validatePeers(
  subjectTicker: string,
  subjectSector: string | null,
): Promise<PeerValidationResult> {
  const issues: PeerIssue[] = [];

  const safe = sanitizePathComponent(subjectTicker);
  if (!safe) return { issues: [], validPeerCount: 0, totalPeerCount: 0, hasIssues: false };

  const filePath = path.join(DATA_DIR, safe, "peers_latest.json");
  let snapshot: any;
  try {
    const content = await fs.readFile(filePath, "utf-8");
    snapshot = JSON.parse(content);
  } catch {
    // 피어 파일 없음 — peer_table QA 플래그로 이미 커버됨
    return { issues: [], validPeerCount: 0, totalPeerCount: 0, hasIssues: false };
  }

  const peers = (snapshot.peers ?? {}) as Record<string, any>;
  const entries = Object.entries(peers);
  const totalPeerCount = entries.length;

  if (totalPeerCount === 0) {
    return { issues: [], validPeerCount: 0, totalPeerCount: 0, hasIssues: false };
  }

  // ── 피어별 검증 ────────────────────────────────────────────────────────────
  let validPeerCount = 0;
  const validMarketCaps: number[] = [];

  for (const [ticker, peer] of entries) {
    const peerName = peer.name ?? ticker;
    const hasAnyData =
      peer.marketCap != null ||
      peer.revenue != null ||
      peer.pbr != null ||
      peer.per_trailing != null;

    if (!hasAnyData) {
      issues.push({
        type: "no_data",
        ticker,
        detail: `${ticker}(${peerName}): 재무 데이터 없음 — 잘못된 티커이거나 AI 오선정 의심`,
        severity: "error",
      });
      continue;
    }

    validPeerCount++;
    if (peer.marketCap != null) validMarketCaps.push(peer.marketCap);

    // 섹터 불일치 검증 (sector 필드가 있을 때만 — 신규 수집 분석부터 적용)
    if (subjectSector && peer.sector && typeof peer.sector === "string") {
      const subjectGroup = normalizeSector(subjectSector);
      const peerGroup = normalizeSector(peer.sector);
      if (subjectGroup !== peerGroup) {
        issues.push({
          type: "sector_mismatch",
          ticker,
          detail: `${ticker}(${peerName}): 섹터 불일치 — 분석 대상:${subjectSector} vs 피어:${peer.sector}`,
          severity: "warning",
        });
      }
    }
  }

  // ── 피어 수 부족 ────────────────────────────────────────────────────────────
  if (validPeerCount < 2) {
    issues.push({
      type: "count_low",
      detail: `유효 피어 ${validPeerCount}개 (최소 2개 필요) — 비교 신뢰도 낮음`,
      severity: "error",
    });
  }

  // ── 시총 규모 극단치 ──────────────────────────────────────────────────────
  if (validMarketCaps.length >= 3) {
    const med = median(validMarketCaps);
    const RATIO_THRESHOLD = 30;
    for (const [ticker, peer] of entries) {
      if (peer.marketCap == null) continue;
      const ratio = peer.marketCap / med;
      if (ratio > RATIO_THRESHOLD) {
        issues.push({
          type: "size_extreme",
          ticker,
          detail: `${ticker}(${peer.name}): 시가총액이 피어 중앙값의 ${ratio.toFixed(0)}배 — 규모 불일치`,
          severity: "warning",
        });
      } else if (ratio < 1 / RATIO_THRESHOLD) {
        issues.push({
          type: "size_extreme",
          ticker,
          detail: `${ticker}(${peer.name}): 시가총액이 피어 중앙값의 1/${(1 / ratio).toFixed(0)}배 — 규모 불일치`,
          severity: "warning",
        });
      }
    }
  }

  return {
    issues,
    validPeerCount,
    totalPeerCount,
    hasIssues: issues.length > 0,
  };
}
