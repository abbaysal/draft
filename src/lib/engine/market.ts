/**
 * Opponent draft-behaviour model and expected-roster fills.
 *
 * Opponent pick (one draw): every candidate gets a perceived rank
 *     r̃_i = marketRank_i + σ(marketRank_i)·Z_i − κ·tilt_t·z_i + needPenalty_t,i
 * with σ(r) = adpSigmaBase + adpSigmaSlope·r (ADP spread widens later in drafts),
 * Z_i ~ N(0,1), tilt_t a SHRUNK estimate of the team's observed category
 * preferences (n/(n+6) shrinkage so a few picks cannot dominate), and need
 * penalties when the team must fill open starting slots. The team takes the
 * smallest r̃. All assumptions are listed in METHODOLOGY.md §7.
 */
import { CAT_KEYS } from "../categories";
import { slotAccepts, matchLineup } from "../positions";
import { startingSlots } from "../league";
import type { CategoryKey, SlotPos } from "../types";
import type { AnalysisContext } from "./context";
import { addInto, emptyAgg, type Agg } from "./team";
import { normal } from "./math";

export const CANDIDATE_WINDOW = 40;
const TILT_K = 3;
const TILT_SHRINK = 6;

export interface TeamTendency {
  tilt: Record<CategoryKey, number>;
  picks: number;
  /** Mean (pick − market rank) of the team's picks; negative = reaches. */
  meanReach: number;
}

export function teamTendencies(ctx: AnalysisContext): TeamTendency[] {
  const all = ctx.draft.picks.map((p) => ctx.values.get(p.playerId)).filter(Boolean);
  const leagueMean = {} as Record<CategoryKey, number>;
  for (const c of CAT_KEYS) leagueMean[c] = all.length ? all.reduce((a, v) => a + v!.cat[c], 0) / all.length : 0;
  return ctx.rosters.map((ids, t) => {
    const vals = ids.map((id) => ctx.values.get(id)).filter(Boolean);
    const n = vals.length;
    const shrink = n / (n + TILT_SHRINK);
    const tilt = {} as Record<CategoryKey, number>;
    for (const c of CAT_KEYS) tilt[c] = n ? shrink * (vals.reduce((a, v) => a + v!.cat[c], 0) / n - leagueMean[c]) : 0;
    const reaches = ctx.draft.picks.filter((p) => p.teamIndex === t).map((p) => p.overall - (ctx.marketRank.get(p.playerId) ?? p.overall));
    return { tilt, picks: n, meanReach: reaches.length ? reaches.reduce((a, b) => a + b, 0) / reaches.length : 0 };
  });
}

/** Precomputed per-context arrays so the inner simulation loop avoids Map lookups. */
export interface SimIndex {
  ids: string[];
  rank: Float64Array;
  cat: Float64Array; // n × CAT_KEYS.length
  pureC: Uint8Array;
  elig: SlotPos[][];
}

const simIndexCache = new WeakMap<AnalysisContext, SimIndex>();

export function simIndex(ctx: AnalysisContext): SimIndex {
  let ix = simIndexCache.get(ctx);
  if (ix) return ix;
  const ids = ctx.available;
  const n = ids.length;
  const nc = CAT_KEYS.length;
  ix = { ids, rank: new Float64Array(n), cat: new Float64Array(n * nc), pureC: new Uint8Array(n), elig: [] };
  ids.forEach((id, i) => {
    ix!.rank[i] = ctx.marketRank.get(id) ?? i + ctx.overall;
    const v = ctx.values.get(id);
    if (v) CAT_KEYS.forEach((c, j) => (ix!.cat[i * nc + j] = v.cat[c]));
    const e = ctx.byId.get(id)!.elig;
    ix!.elig.push(e);
    ix!.pureC[i] = e.length === 1 && e[0] === "C" ? 1 : 0;
  });
  simIndexCache.set(ctx, ix);
  return ix;
}

/** Mutable state for fast draft simulation. */
export interface SimDraft {
  ix: SimIndex;
  ids: string[]; // candidate universe in market order (available at sim start)
  taken: Uint8Array;
  rosters: string[][];
  eligs: SlotPos[][][];
  cursor: number; // first not-taken index (amortised)
}

export function newSimDraft(ctx: AnalysisContext): SimDraft {
  const ix = simIndex(ctx);
  return {
    ix,
    ids: ix.ids,
    taken: new Uint8Array(ctx.available.length),
    rosters: ctx.rosters.map((r) => r.slice()),
    eligs: ctx.rosters.map((r) => r.map((id) => ctx.byId.get(id)!.elig)),
    cursor: 0,
  };
}

export function takeIndex(sim: SimDraft, ctx: AnalysisContext, teamIndex: number, idx: number) {
  sim.taken[idx] = 1;
  const id = sim.ids[idx];
  sim.rosters[teamIndex].push(id);
  sim.eligs[teamIndex].push(sim.ix.elig[idx]);
  while (sim.cursor < sim.ids.length && sim.taken[sim.cursor]) sim.cursor++;
}

export function takeId(sim: SimDraft, ctx: AnalysisContext, teamIndex: number, id: string) {
  const idx = sim.ids.indexOf(id);
  if (idx >= 0) takeIndex(sim, ctx, teamIndex, idx);
  else {
    sim.rosters[teamIndex].push(id);
    sim.eligs[teamIndex].push(ctx.byId.get(id)?.elig ?? []);
  }
}

/** Open starting slots a team still has to fill. */
function mustFillSlots(ctx: AnalysisContext, sim: SimDraft, t: number, remainingPicks: number) {
  const slots = startingSlots(ctx.settings);
  if (remainingPicks > 4) return null;
  const { assignment } = matchLineup(slots, sim.eligs[t]);
  const open = slots.filter((_, i) => assignment[i] === -1);
  return open.length >= remainingPicks && open.length > 0 ? open : null;
}

export function opponentPick(
  ctx: AnalysisContext,
  sim: SimDraft,
  t: number,
  remainingPicks: number,
  tendencies: TeamTendency[],
  rng: () => number,
): number {
  const { adpSigmaBase, adpSigmaSlope } = ctx.settings;
  const must = mustFillSlots(ctx, sim, t, remainingPicks);
  const tiltObj = tendencies[t]?.tilt;
  const nc = CAT_KEYS.length;
  const tilt = tiltObj && CAT_KEYS.some((c) => tiltObj[c] !== 0) ? CAT_KEYS.map((c) => tiltObj[c]) : null;
  const cCount = sim.eligs[t].filter((e) => e.length === 1 && e[0] === "C").length;
  const ix = sim.ix;
  let best = -1;
  let bestScore = Infinity;
  let seen = 0;
  for (let i = sim.cursor; i < sim.ids.length && seen < CANDIDATE_WINDOW; i++) {
    if (sim.taken[i]) continue;
    seen++;
    const r = ix.rank[i];
    let s = r + (adpSigmaBase + adpSigmaSlope * r) * normal(rng);
    if (tilt) {
      let dot = 0;
      for (let j = 0; j < nc; j++) dot += tilt[j] * ix.cat[i * nc + j];
      s -= TILT_K * dot;
    }
    if (must && !must.some((slot) => slotAccepts(slot, ix.elig[i]))) s += 1000;
    if (cCount >= 3 && ix.pureC[i]) s += 8;
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  return best;
}

/**
 * Expected-roster "fill" aggregates: the k-th future pick (k picks from now) is
 * represented by the average contribution of available players around market
 * position k. Usage follows roster position (starter vs bench).
 */
export function makeFillProvider(ctx: AnalysisContext, window = 3) {
  const cache = new Map<string, Agg>();
  const bench = ctx.settings.lineupMode === "daily" ? ctx.settings.benchUtilization : 0;
  return (k: number, rosterIndex: number): Agg => {
    const usage = rosterIndex < ctx.starters ? 1 : bench;
    const key = `${k}|${usage}`;
    let a = cache.get(key);
    if (a) return a;
    a = emptyAgg();
    const lo = Math.max(0, k - window);
    const hi = Math.min(ctx.available.length - 1, k + window);
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      addInto(a, ctx.weekContrib(ctx.available[j], usage));
      n++;
    }
    if (n) for (let i = 0; i < a.length; i++) a[i] /= n;
    cache.set(key, a);
    return a;
  };
}

/** Fill aggregates for every remaining pick of a team (optionally skipping its next `skip` picks). */
export function teamFills(ctx: AnalysisContext, t: number, fill: ReturnType<typeof makeFillProvider>, skip = 0, rosterLen?: number): Agg[] {
  const shape = { teams: ctx.settings.teams, rounds: ctx.settings.rounds, draftType: ctx.settings.draftType };
  const out: Agg[] = [];
  let idx = rosterLen ?? ctx.rosters[t].length;
  let skipped = 0;
  for (let o = ctx.overall; o <= ctx.totalPicks; o++) {
    const owner = ctx.draft.ownerOverrides[o] ?? defaultOwnerFast(o, shape);
    if (owner !== t) continue;
    if (skipped < skip) {
      skipped++;
      idx++;
      continue;
    }
    out.push(fill(o - ctx.overall, idx));
    idx++;
  }
  return out;
}

function defaultOwnerFast(overall: number, s: { teams: number; draftType: "snake" | "linear" }) {
  const round = Math.floor((overall - 1) / s.teams) + 1;
  const idx = (overall - 1) % s.teams;
  return s.draftType === "snake" && round % 2 === 0 ? s.teams - 1 - idx : idx;
}
