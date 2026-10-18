/**
 * Opponent intelligence: category profiles, inferred strategies (labelled as
 * estimates), positional needs, draft tendencies and the rival matrix.
 */
import { CAT_BY_KEY } from "../categories";
import { startingSlots } from "../league";
import { matchLineup } from "../positions";
import type { CategoryKey, LineupSlot } from "../types";
import type { AnalysisContext } from "./context";
import { teamTendencies } from "./market";
import type { ProjectedField } from "./recommend";
import { catProbs, matchupWinProb } from "./team";

export interface TeamProfile {
  index: number;
  name: string;
  roster: string[];
  catZ: Record<string, number>;
  catRank: Record<string, number>; // 1 = strongest in league
  strengths: CategoryKey[];
  weaknesses: CategoryKey[];
  inferredPunts: { cat: CategoryKey; confidence: "low" | "medium" }[];
  openSlots: LineupSlot[];
  meanReach: number;
  tendencyNote: string;
}

export function teamProfiles(ctx: AnalysisContext): TeamProfile[] {
  const slots = startingSlots(ctx.settings);
  const tend = teamTendencies(ctx);
  const profiles = ctx.rosters.map((ids, index) => {
    const catZ: Record<string, number> = {};
    for (const c of ctx.cats) catZ[c] = ids.reduce((a, id) => a + (ctx.values.get(id)?.cat[c] ?? 0), 0);
    const { assignment } = matchLineup(slots, ids.map((id) => ctx.byId.get(id)?.elig ?? []));
    return {
      index,
      name: ctx.settings.teamNames[index],
      roster: ids,
      catZ,
      catRank: {} as Record<string, number>,
      strengths: [] as CategoryKey[],
      weaknesses: [] as CategoryKey[],
      inferredPunts: [] as TeamProfile["inferredPunts"],
      openSlots: slots.filter((_, i) => assignment[i] === -1),
      meanReach: tend[index].meanReach,
      tendencyNote: "",
    };
  });
  for (const c of ctx.cats) {
    const order = [...profiles].sort((a, b) => b.catZ[c] - a.catZ[c]);
    order.forEach((p, i) => (p.catRank[c] = i + 1));
  }
  const n = profiles.length;
  for (const p of profiles) {
    p.strengths = ctx.cats.filter((c) => p.catRank[c] <= Math.max(1, Math.round(n / 4)) && p.roster.length > 0);
    p.weaknesses = ctx.cats.filter((c) => p.catRank[c] > n - Math.max(1, Math.round(n / 4)) && p.roster.length > 0);
    const perPlayer = p.roster.length;
    if (perPlayer >= 4) {
      for (const c of ctx.cats) {
        const avg = p.catZ[c] / perPlayer;
        if (avg <= -0.6) p.inferredPunts.push({ cat: c, confidence: perPlayer >= 7 && avg <= -0.8 ? "medium" : "low" });
      }
    }
    const reach = p.meanReach;
    p.tendencyNote =
      perPlayer < 3
        ? "Too few picks to infer tendencies"
        : reach < -4
          ? `Reaches ahead of market (avg ${reach.toFixed(1)} picks)`
          : reach > 4
            ? `Waits for value (avg +${reach.toFixed(1)} picks)`
            : "Drafts close to market order";
  }
  return profiles;
}

export interface RivalRow {
  index: number;
  name: string;
  catProbs: Record<string, number>;
  expectedCatWins: number;
  winProb: number;
  threatCats: CategoryKey[];
}

/** Projected-final-roster head-to-head matrix: my team vs every opponent. */
export function rivalMatrix(ctx: AnalysisContext, field: ProjectedField): RivalRow[] {
  const me = field.teamAggs[ctx.myIndex];
  return field.opponents.map((o) => {
    const ps = catProbs(me, o.agg, ctx.cats);
    const cp = Object.fromEntries(ctx.cats.map((c, i) => [c, ps[i]]));
    return {
      index: o.index,
      name: ctx.settings.teamNames[o.index],
      catProbs: cp,
      expectedCatWins: ps.reduce((a, b) => a + b, 0),
      winProb: matchupWinProb(ps),
      threatCats: ctx.cats.filter((c) => cp[c] < 0.35),
    };
  });
}

export function describePunt(c: CategoryKey) {
  return CAT_BY_KEY[c].short;
}
