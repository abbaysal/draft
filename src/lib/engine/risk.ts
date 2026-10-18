/**
 * Risk intelligence. Four SEPARATE dimensions (never merged into fake medical odds):
 *   availability — games-played history and current researched status
 *   gamesUncertainty — projected games SD
 *   projection — statistical uncertainty of the per-game projection (CV)
 *   role — team change, returning from long absence, minutes volatility, youth
 * Portfolio risk simulates the roster's season outcome jointly.
 */
import type { Player } from "../types";
import { usageFor, type AnalysisContext } from "./context";
import { createRng, hashSeed, normal, quantile } from "./math";

export type RiskLevel = "low" | "medium" | "high";

export interface PlayerRisk {
  id: string;
  availability: RiskLevel;
  availabilityEvidence: string;
  gamesSd: number;
  projectionCv: number;
  projection: RiskLevel;
  role: RiskLevel;
  roleEvidence: string[];
  overall: RiskLevel;
}

const level = (x: number, lo: number, hi: number): RiskLevel => (x < lo ? "low" : x < hi ? "medium" : "high");

export function playerRisk(p: Player): PlayerRisk | null {
  if (!p.proj) return null;
  const seasons = p.hist.filter((h) => h.gp > 0);
  const gpRate = seasons.length ? seasons.reduce((a, h) => a + h.gp, 0) / (seasons.length * 82) : 0.6;
  let availability = level(1 - gpRate, 0.15, 0.3);
  const st = p.availability?.status;
  if (st === "OUT_SEASON" || st === "OUT_EXTENDED") availability = "high";
  else if ((st === "OUT_START" || st === "RETURNING") && availability === "low") availability = "medium";
  const availabilityEvidence = `${seasons.length ? `Played ${(gpRate * 100).toFixed(0)}% of games over ${seasons.length} season(s)` : "No history"}${st && st !== "HEALTHY" ? `; current status ${st}` : ""}`;
  const projectionCv = p.proj.pts > 0 ? (p.proj.sd.pts ?? 0) / p.proj.pts : 0.3;
  const roleEvidence: string[] = [];
  if (p.teamChange) roleEvidence.push(`New team (${p.teamChange.to})`);
  if (!p.hist.some((h) => h.season === "2025-26")) roleEvidence.push("Did not play 2025-26");
  const cur = p.hist.find((h) => h.season === "2025-26");
  const prev = p.hist.find((h) => h.season === "2024-25");
  if (cur && prev && Math.abs(cur.min - prev.min) >= 6) roleEvidence.push(`Minutes moved ${prev.min.toFixed(1)} → ${cur.min.toFixed(1)}`);
  if (p.age != null && p.age <= 21) roleEvidence.push("Age ≤ 21 (development volatility)");
  const role: RiskLevel = roleEvidence.length >= 2 ? "high" : roleEvidence.length === 1 ? "medium" : "low";
  const projection = level(projectionCv, 0.16, 0.24);
  const score = { low: 0, medium: 1, high: 2 };
  const total = score[availability] * 1.5 + score[projection] + score[role];
  return {
    id: p.id,
    availability,
    availabilityEvidence,
    gamesSd: p.proj.gpSd,
    projectionCv,
    projection,
    role,
    roleEvidence,
    overall: total >= 4 ? "high" : total >= 2 ? "medium" : "low",
  };
}

export interface PortfolioRisk {
  sims: number;
  totalValue: { p10: number; p50: number; p90: number; mean: number };
  gamesLost: { p10: number; p50: number; p90: number };
  highRiskShare: number;
  concentrationWarning: string | null;
}

/** Joint simulation of the roster's season value (z-units × share of games played). */
export function portfolioRisk(ctx: AnalysisContext, ids: string[], sims = 1000, seed = hashSeed("portfolio", ids.join(","))): PortfolioRisk {
  const usage = usageFor(ctx, ids);
  const rng = createRng(seed);
  const vals: number[] = [];
  const lost: number[] = [];
  let valueSum = 0;
  let highRiskValue = 0;
  ids.forEach((id) => {
    const v = Math.max(0, ctx.values.get(id)?.total ?? 0);
    valueSum += v;
    const r = playerRisk(ctx.byId.get(id)!);
    if (r?.overall === "high") highRiskValue += v;
  });
  for (let s = 0; s < sims; s++) {
    let tot = 0;
    let gl = 0;
    ids.forEach((id, i) => {
      const p = ctx.byId.get(id)!;
      if (!p.proj) return;
      const v = ctx.values.get(id)?.total ?? 0;
      const gp = Math.max(0, Math.min(82, p.proj.gp + p.proj.gpSd * normal(rng)));
      const cv = p.proj.pts > 0 ? (p.proj.sd.pts ?? 0) / p.proj.pts : 0.2;
      const talent = 1 + cv * normal(rng);
      tot += usage[i] * (v + Math.abs(v) * (talent - 1)) * (gp / 82);
      gl += Math.max(0, p.proj.gp - gp);
    });
    vals.push(tot);
    lost.push(gl);
  }
  vals.sort((a, b) => a - b);
  lost.sort((a, b) => a - b);
  const share = valueSum > 0 ? highRiskValue / valueSum : 0;
  return {
    sims,
    totalValue: { p10: quantile(vals, 0.1), p50: quantile(vals, 0.5), p90: quantile(vals, 0.9), mean: vals.reduce((a, b) => a + b, 0) / Math.max(1, sims) },
    gamesLost: { p10: quantile(lost, 0.1), p50: quantile(lost, 0.5), p90: quantile(lost, 0.9) },
    highRiskShare: share,
    concentrationWarning: share > 0.35 ? `${(share * 100).toFixed(0)}% of your roster value comes from high-risk players` : null,
  };
}
