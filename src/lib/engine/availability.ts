/**
 * Monte Carlo of the opponent picks between now and my next pick.
 * Produces survival probabilities (P(player still available at my next pick)),
 * expected draft positions, per-team pick predictions and joint samples used by
 * the pick-now-vs-wait optimiser.
 */
import type { AnalysisContext } from "./context";
import { hashSeed, createRng } from "./math";
import { newSimDraft, opponentPick, takeIndex, teamTendencies } from "./market";

export interface AvailabilityResult {
  sims: number;
  horizon: number; // number of opponent picks simulated
  startOverall: number;
  survival: Map<string, number>;
  /** Mean overall pick number when taken within the horizon (undefined if never taken). */
  expectedPick: Map<string, number>;
  /** For each opponent team on the clock in the horizon, most likely selections. */
  teamPredictions: { teamIndex: number; overall: number; options: { id: string; p: number }[] }[];
  /** Joint samples for tracked ids: taken[s * tracked.length + j]. */
  tracked: string[];
  taken: Uint8Array;
}

export interface AvailabilityOptions {
  sims?: number;
  seed?: number;
  /** Track joint samples for these ids (default: top 60 available by market). */
  trackIds?: string[];
}

export function simulateAvailability(ctx: AnalysisContext, opts: AvailabilityOptions = {}): AvailabilityResult {
  const sims = opts.sims ?? 400;
  const seed = opts.seed ?? hashSeed("avail", ctx.overall, ctx.draft.version);
  const myTurn = ctx.onClock === ctx.myIndex;
  const startOverall = myTurn ? ctx.overall + 1 : ctx.overall;
  const horizon = ctx.picksBeforeMyNext;
  const tracked = opts.trackIds ?? ctx.available.slice(0, 60);
  const trackIdx = new Map(tracked.map((id, j) => [id, j]));
  const taken = new Uint8Array(sims * tracked.length);
  const takenCount = new Map<string, number>();
  const pickSum = new Map<string, number>();
  const tendencies = teamTendencies(ctx);
  const shape = { teams: ctx.settings.teams, rounds: ctx.settings.rounds, draftType: ctx.settings.draftType };
  const owners: number[] = [];
  for (let k = 0; k < horizon; k++) {
    const o = startOverall + k;
    const round = Math.floor((o - 1) / shape.teams) + 1;
    const idx = (o - 1) % shape.teams;
    owners.push(ctx.draft.ownerOverrides[o] ?? (shape.draftType === "snake" && round % 2 === 0 ? shape.teams - 1 - idx : idx));
  }
  const remainingFor = (t: number, fromOverall: number) => {
    let n = 0;
    for (let o = fromOverall; o <= ctx.totalPicks; o++) {
      const round = Math.floor((o - 1) / shape.teams) + 1;
      const idx = (o - 1) % shape.teams;
      const owner = ctx.draft.ownerOverrides[o] ?? (shape.draftType === "snake" && round % 2 === 0 ? shape.teams - 1 - idx : idx);
      if (owner === t) n++;
    }
    return n;
  };
  const remainingCache = owners.map((t, k) => remainingFor(t, startOverall + k));
  const predCounts: Map<string, number>[] = owners.map(() => new Map());

  for (let s = 0; s < sims; s++) {
    const rng = createRng(hashSeed(seed, s));
    const sim = newSimDraft(ctx);
    for (let k = 0; k < horizon; k++) {
      const t = owners[k];
      const idx = opponentPick(ctx, sim, t, remainingCache[k], tendencies, rng);
      if (idx < 0) break;
      const id = sim.ids[idx];
      takeIndex(sim, ctx, t, idx);
      takenCount.set(id, (takenCount.get(id) ?? 0) + 1);
      pickSum.set(id, (pickSum.get(id) ?? 0) + startOverall + k);
      const j = trackIdx.get(id);
      if (j != null) taken[s * tracked.length + j] = 1;
      const pc = predCounts[k];
      pc.set(id, (pc.get(id) ?? 0) + 1);
    }
  }
  const survival = new Map<string, number>();
  const expectedPick = new Map<string, number>();
  for (const id of ctx.available) {
    const n = takenCount.get(id) ?? 0;
    survival.set(id, 1 - n / sims);
    if (n) expectedPick.set(id, pickSum.get(id)! / n);
  }
  const teamPredictions = owners.map((t, k) => ({
    teamIndex: t,
    overall: startOverall + k,
    options: [...predCounts[k].entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => ({ id, p: n / sims })),
  }));
  return { sims, horizon, startOverall, survival, expectedPick, teamPredictions, tracked, taken };
}
