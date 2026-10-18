/**
 * Deep Monte Carlo: remaining draft → regular season → playoffs → champion.
 *
 * For each candidate X for my current (or next) pick and each simulation s, the
 * SAME random stream (common random numbers, seed = hash(baseSeed, s)) drives:
 *   1. the remaining draft — opponents via the market model (market.ts), my later
 *      picks via a linearised marginal-win-probability policy;
 *   2. season-level player outcomes — games played ~ N(gp, gpSd) clipped, a talent
 *      multiplier ~ N(1, cv) and shooting shocks from projection uncertainty;
 *   3. weekly head-to-head matchups (round-robin schedule) with weekly noise and a
 *      shared team games shock (correlates counting categories within a week);
 *   4. a seeded playoff bracket over the configured playoff weeks.
 * Rotisserie leagues skip 3–4 and rank season totals.
 *
 * Δ P(champion | X) = P(champion | draft X) − P(champion | default policy pick),
 * with a paired standard error. See METHODOLOGY.md §8.
 */
import { startingSlots } from "../league";
import { matchLineup, slotAccepts } from "../positions";
import type { CategoryKey } from "../types";
import { usageFor, type AnalysisContext } from "./context";
import { createRng, hashSeed, normal } from "./math";
import { newSimDraft, opponentPick, takeId, takeIndex, teamTendencies, type SimDraft } from "./market";
import { projectField } from "./recommend";
import { AGG_LEN, GAMES, addContribution, addInto, catDist, catWinGradient, emptyAgg, evaluateVsField, objectiveValue, type Agg, type PlayerLine } from "./team";
import { COUNTING_KEYS, CAT_BY_KEY } from "../categories";

export const POLICY = "__policy__";

export interface ChampionshipOptions {
  candidates: string[]; // may include POLICY for the baseline
  sims: number;
  seed: number;
  /** Simulate only sims in [from, to) — lets a worker run in cancellable chunks. */
  from?: number;
  to?: number;
  /** Collect per-sim final objective values and my final rosters (mock draft distributions). */
  collect?: boolean;
  /** Optional static strategy weights for MY future picks (otherwise the marginal policy). */
  myWeights?: Record<string, number> | null;
}

export interface CandidateTally {
  id: string;
  sims: number;
  champ: number;
  playoffs: number;
  standingPts: number;
  finalObj: number;
  finalObjSq: number;
  /** Per-sim champion indicator (bit per sim) for paired comparisons. */
  champBits: number[];
  playoffBits: number[];
  unavailable: number;
  finalObjs?: number[];
  rosters?: string[][];
  ranks?: number[];
}

export interface ChampionshipChunk {
  from: number;
  to: number;
  tallies: CandidateTally[];
}

function newTally(id: string, n: number): CandidateTally {
  return { id, sims: 0, champ: 0, playoffs: 0, standingPts: 0, finalObj: 0, finalObjSq: 0, champBits: new Array(n).fill(0), playoffBits: new Array(n).fill(0), unavailable: 0 };
}

/** Linearised policy: Σ_c ∂E[win]/∂mean_c × Δmean_c(player). */
function policyWeights(me: Agg, field: Agg[], cats: CategoryKey[]): Record<string, number> {
  const g: Record<string, number> = {};
  for (const c of cats) {
    let s = 0;
    for (const f of field) s += catWinGradient(me, f, c);
    g[c] = s / Math.max(1, field.length);
  }
  return g;
}

const PCT_INDEX: Record<string, number> = { fgPct: COUNTING_KEYS.length * 3, ftPct: COUNTING_KEYS.length * 3 + 10 };

function policyScore(contrib: Agg, me: Agg, g: Record<string, number>, cats: CategoryKey[]): number {
  let s = 0;
  for (const c of cats) {
    const def = CAT_BY_KEY[c];
    if (def.kind === "counting") s += g[c] * contrib[COUNTING_KEYS.indexOf(c as (typeof COUNTING_KEYS)[number]) * 3];
    else {
      const b = PCT_INDEX[c];
      const A = me[b + 1];
      if (A <= 0) continue;
      const p = me[b] / A;
      s += (g[c] * (contrib[b] - p * contrib[b + 1])) / (A + contrib[b + 1]);
    }
  }
  return s;
}

function policyPick(ctx: AnalysisContext, sim: SimDraft, t: number, remaining: number, valueOrder: number[], fieldAggs: Agg[], fill: Agg): number {
  const ids = sim.rosters[t];
  const usage = usageFor(ctx, ids);
  const me = emptyAgg();
  ids.forEach((id, i) => addInto(me, ctx.weekContrib(id, usage[i])));
  addInto(me, fill);
  const g = policyWeights(me, fieldAggs, ctx.cats);
  const slots = startingSlots(ctx.settings);
  let must: ReturnType<typeof slots.filter> | null = null;
  if (remaining <= 4) {
    const { assignment } = matchLineup(slots, sim.eligs[t]);
    const open = slots.filter((_, i) => assignment[i] === -1);
    if (open.length >= remaining && open.length > 0) must = open;
  }
  let best = -1;
  let bestScore = -Infinity;
  let seen = 0;
  for (const i of valueOrder) {
    if (sim.taken[i]) continue;
    if (++seen > 60) break;
    const id = sim.ids[i];
    if (must && !must.some((s) => slotAccepts(s, ctx.byId.get(id)!.elig))) continue;
    const sc = policyScore(ctx.weekContrib(id, ids.length < ctx.starters ? 1 : ctx.settings.benchUtilization), me, g, ctx.cats);
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  if (best < 0) for (const i of valueOrder) if (!sim.taken[i]) return i;
  return best;
}

/** Round-robin pairings for n teams over w weeks (circle method; odd n gets byes). */
export function roundRobin(n: number, weeks: number): [number, number][][] {
  const teams = Array.from({ length: n % 2 ? n + 1 : n }, (_, i) => i);
  const m = teams.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = teams[i];
      const b = teams[m - 1 - i];
      if (a < n && b < n) pairs.push([a, b]);
    }
    rounds.push(pairs);
    teams.splice(1, 0, teams.pop()!);
  }
  return Array.from({ length: weeks }, (_, w) => rounds[w % rounds.length]);
}

interface SeasonTeam {
  agg: Agg; // regular-season weekly aggregate (expected)
  playoff: Agg[]; // per playoff week
  season: Agg; // season totals (roto)
}

function sampleCat(a: Agg, cat: CategoryKey, shock: number, rng: () => number): number {
  const d = catDist(a, cat);
  const m = CAT_BY_KEY[cat].kind === "counting" ? d.mean * shock : d.mean;
  return m + Math.sqrt(d.variance) * normal(rng);
}

function playWeek(A: Agg, B: Agg, cats: CategoryKey[], rng: () => number): number {
  // returns category wins of A minus ... we return A's wins (B = n - A, ties ignored)
  const sa = 1 + 0.07 * normal(rng);
  const sb = 1 + 0.07 * normal(rng);
  let wins = 0;
  for (const c of cats) {
    const x = sampleCat(A, c, sa, rng);
    const y = sampleCat(B, c, sb, rng);
    const dir = CAT_BY_KEY[c].direction;
    if (dir * (x - y) > 0) wins++;
  }
  return wins;
}

function sampledLine(l: PlayerLine, rng: () => number): PlayerLine {
  const gp = Math.max(0, Math.min(82, l.gp + l.gpSd * normal(rng)));
  const cv = l.line.pts > 0 ? Math.min(0.45, (l.sd.pts ?? 0) / l.line.pts) : 0.15;
  const k = Math.max(0.4, 1 + cv * normal(rng));
  const line = { ...l.line };
  for (const key of ["pts", "fg3m", "reb", "ast", "stl", "blk", "tov", "fga", "fta"] as const) line[key] *= k;
  const fgP = l.line.fga > 0 ? l.line.fgm / l.line.fga + ((l.sd.fgm ?? 0) / Math.max(l.line.fga, 1e-6)) * normal(rng) : 0;
  const ftP = l.line.fta > 0 ? l.line.ftm / l.line.fta + ((l.sd.ftm ?? 0) / Math.max(l.line.fta, 1e-6)) * normal(rng) : 0;
  line.fgm = line.fga * Math.max(0, Math.min(1, fgP));
  line.ftm = line.fta * Math.max(0, Math.min(1, ftP));
  line.pts = 2 * line.fgm + line.fg3m + line.ftm;
  return { ...l, line, gp };
}

function buildSeasonTeams(ctx: AnalysisContext, rosters: string[][], rng: () => number): SeasonTeam[] {
  const playoffWeeks = ctx.settings.playoffWeeks;
  return rosters.map((ids) => {
    const usage = usageFor(ctx, ids);
    const agg = emptyAgg();
    const playoff = playoffWeeks.map(() => emptyAgg());
    const season = emptyAgg();
    ids.forEach((id, i) => {
      const l = ctx.lines.get(id);
      if (!l) return;
      const s = sampledLine(l, rng);
      const opt = { usage: usage[i], includeUncertainty: false };
      addContribution(agg, s, { ...opt, scheduled: ctx.gamesPerWeek(l.team) });
      playoffWeeks.forEach((_w, j) => addContribution(playoff[j], s, { ...opt, scheduled: ctx.playoffGames(l.team, j) }));
      if (ctx.settings.format === "roto") addContribution(season, s, { ...opt, scheduled: 82, seasonMode: true });
    });
    const cap = ctx.settings.weeklyGamesCap;
    const capIt = (a: Agg) => {
      if (!cap || a[GAMES] <= cap) return a;
      const k = cap / a[GAMES];
      const out = new Float64Array(AGG_LEN);
      for (let i = 0; i < AGG_LEN; i++) out[i] = a[i] * k;
      return out;
    };
    return { agg: capIt(agg), playoff: playoff.map(capIt), season };
  });
}

/** Returns champion index, the set of playoff teams, and my standing points. */
function playSeason(ctx: AnalysisContext, teams: SeasonTeam[], schedule: [number, number][][], rng: () => number) {
  const n = teams.length;
  const cats = ctx.cats;
  const fmt = ctx.settings.format;
  const pts = new Array(n).fill(0);
  if (fmt === "roto") {
    for (const c of cats) {
      const vals = teams.map((t, i) => ({ i, v: sampleCat(t.season, c, 1, rng) * CAT_BY_KEY[c].direction }));
      vals.sort((a, b) => a.v - b.v);
      vals.forEach((x, rank) => (pts[x.i] += rank + 1));
    }
    const champ = pts.indexOf(Math.max(...pts));
    const order = pts.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);
    return { champ, playoffTeams: new Set(order.slice(0, Math.max(1, ctx.settings.playoffTeams)).map((o) => o.i)), pts };
  }
  const catWins = new Array(n).fill(0);
  for (const week of schedule) {
    for (const [a, b] of week) {
      const wa = playWeek(teams[a].agg, teams[b].agg, cats, rng);
      const wb = cats.length - wa;
      catWins[a] += wa;
      catWins[b] += wb;
      if (fmt === "h2h_each") {
        pts[a] += wa;
        pts[b] += wb;
      } else {
        pts[a] += wa > wb ? 1 : wa === wb ? 0.5 : 0;
        pts[b] += wb > wa ? 1 : wa === wb ? 0.5 : 0;
      }
    }
  }
  const seeds = pts
    .map((p, i) => ({ i, key: p * 1e4 + catWins[i] + rng() }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.i);
  const P = Math.min(ctx.settings.playoffTeams, n);
  if (P <= 1) return { champ: seeds[0], playoffTeams: new Set(seeds.slice(0, 1)), pts };
  let size = 1;
  while (size < P) size *= 2;
  let alive = seeds.slice(0, P);
  const byes = size - P;
  let round = 0;
  const weeks = ctx.settings.playoffWeeks;
  const play = (a: number, b: number) => {
    const wk = Math.min(round, Math.max(0, weeks.length - 1));
    const A = teams[a].playoff[wk] ?? teams[a].agg;
    const B = teams[b].playoff[wk] ?? teams[b].agg;
    const wa = playWeek(A, B, cats, rng);
    const wb = cats.length - wa;
    return wa > wb ? a : wb > wa ? b : alive.indexOf(a) < alive.indexOf(b) ? a : b; // tie → higher seed
  };
  // Round 1 with byes for top seeds.
  if (byes > 0) {
    const bye = alive.slice(0, byes);
    const rest = alive.slice(byes);
    const winners: number[] = [];
    for (let i = 0; i < rest.length / 2; i++) winners.push(play(rest[i], rest[rest.length - 1 - i]));
    alive = [...bye, ...winners];
    round++;
  }
  while (alive.length > 1) {
    const next: number[] = [];
    for (let i = 0; i < alive.length / 2; i++) next.push(play(alive[i], alive[alive.length - 1 - i]));
    alive = next;
    round++;
  }
  return { champ: alive[0], playoffTeams: new Set(seeds.slice(0, P)), pts };
}

export function simulateChampionship(ctx: AnalysisContext, opts: ChampionshipOptions): ChampionshipChunk {
  const from = opts.from ?? 0;
  const to = Math.min(opts.to ?? opts.sims, opts.sims);
  const tallies = opts.candidates.map((id) => newTally(id, to - from));
  const field = projectField(ctx);
  const fieldAggs = field.opponents.map((o) => o.agg);
  const tendencies = teamTendencies(ctx);
  const shape = { teams: ctx.settings.teams, rounds: ctx.settings.rounds, draftType: ctx.settings.draftType };
  const owners: number[] = [];
  for (let o = ctx.overall; o <= ctx.totalPicks; o++) {
    const round = Math.floor((o - 1) / shape.teams) + 1;
    const idx = (o - 1) % shape.teams;
    owners.push(ctx.draft.ownerOverrides[o] ?? (shape.draftType === "snake" && round % 2 === 0 ? shape.teams - 1 - idx : idx));
  }
  const remainingAfter = owners.map((t, k) => owners.slice(k).filter((x) => x === t).length);
  const base = newSimDraft(ctx);
  const valueOrder = base.ids.map((_, i) => i).sort((a, b) => (ctx.values.get(base.ids[a])?.rank ?? 1e9) - (ctx.values.get(base.ids[b])?.rank ?? 1e9));
  const fillAvg = field.myFills.length ? averageAgg(field.myFills) : emptyAgg();
  const weeks = roundRobin(ctx.settings.teams, ctx.settings.regularSeasonWeeks);
  const w = opts.myWeights;
  const weightOrder = w
    ? base.ids
        .map((id, i) => {
          const v = ctx.values.get(id);
          const gp = ctx.lines.get(id)?.gp ?? 0;
          const raw = v ? Object.entries(w).reduce((a, [c, wt]) => a + wt * (v.cat[c as CategoryKey] ?? 0), 0) : -99;
          return { i, s: raw >= 0 ? raw * Math.min(1, gp / 72) : raw };
        })
        .sort((a, b) => b.s - a.s)
        .map((x) => x.i)
    : null;

  for (let s = from; s < to; s++) {
    const simSeed = hashSeed(opts.seed, s);
    tallies.forEach((tally, ci) => {
      const rng = createRng(simSeed);
      const sim = newSimDraft(ctx);
      let usedCandidate = false;
      for (let k = 0; k < owners.length; k++) {
        const t = owners[k];
        let idx: number;
        if (t === ctx.myIndex) {
          const myRemaining = remainingAfter[k];
          const cand = opts.candidates[ci];
          if (!usedCandidate && cand !== POLICY) {
            usedCandidate = true;
            const ci2 = sim.ids.indexOf(cand);
            if (ci2 >= 0 && !sim.taken[ci2]) {
              takeIndex(sim, ctx, t, ci2);
              continue;
            }
            tally.unavailable++;
          }
          usedCandidate = true;
          if (weightOrder) {
            idx = -1;
            for (const i of weightOrder) if (!sim.taken[i]) { idx = i; break; }
          } else {
            const fill = scaleFill(fillAvg, Math.max(0, myRemaining - 1));
            idx = policyPick(ctx, sim, t, myRemaining, valueOrder, fieldAggs, fill);
          }
        } else {
          idx = opponentPick(ctx, sim, t, remainingAfter[k], tendencies, rng);
        }
        if (idx < 0) break;
        takeIndex(sim, ctx, t, idx);
      }
      // Season (separate stream so draft divergence does not desynchronise season noise more than necessary).
      const seasonRng = createRng(hashSeed(simSeed, "season"));
      const teams = buildSeasonTeams(ctx, sim.rosters, seasonRng);
      const res = playSeason(ctx, teams, weeks, seasonRng);
      const j = s - from;
      tally.sims++;
      if (res.champ === ctx.myIndex) {
        tally.champ++;
        tally.champBits[j] = 1;
      }
      if (res.playoffTeams.has(ctx.myIndex)) {
        tally.playoffs++;
        tally.playoffBits[j] = 1;
      }
      tally.standingPts += res.pts[ctx.myIndex];
      // Analytic objective of the realised final rosters (expected values, no season noise).
      const finalAggs = sim.rosters.map((ids) => {
        const u = usageFor(ctx, ids);
        const a = emptyAgg();
        ids.forEach((id, i) => addInto(a, ctx.weekContrib(id, u[i])));
        return a;
      });
      const ev = evaluateVsField(
        finalAggs[ctx.myIndex],
        finalAggs.map((agg, index) => ({ index, agg })).filter((o) => o.index !== ctx.myIndex),
        ctx.cats,
      );
      const obj = objectiveValue(ev, ctx.settings.format);
      tally.finalObj += obj;
      tally.finalObjSq += obj * obj;
      if (opts.collect) {
        (tally.finalObjs ??= []).push(obj);
        (tally.rosters ??= []).push(sim.rosters[ctx.myIndex].slice());
        const myPts = res.pts[ctx.myIndex];
        (tally.ranks ??= []).push(1 + res.pts.filter((p) => p > myPts).length);
      }
    });
  }
  return { from, to, tallies };
}

function averageAgg(aggs: Agg[]): Agg {
  const a = emptyAgg();
  for (const x of aggs) addInto(a, x);
  for (let i = 0; i < a.length; i++) a[i] /= aggs.length;
  return a;
}

function scaleFill(avg: Agg, n: number): Agg {
  const a = new Float64Array(avg);
  for (let i = 0; i < a.length; i++) a[i] *= n;
  return a;
}

export function mergeChunks(chunks: ChampionshipChunk[]): CandidateTally[] {
  if (!chunks.length) return [];
  const sorted = [...chunks].sort((a, b) => a.from - b.from);
  return sorted[0].tallies.map((t0, ci) => {
    const out = newTally(t0.id, 0);
    for (const ch of sorted) {
      const t = ch.tallies[ci];
      out.sims += t.sims;
      out.champ += t.champ;
      out.playoffs += t.playoffs;
      out.standingPts += t.standingPts;
      out.finalObj += t.finalObj;
      out.finalObjSq += t.finalObjSq;
      out.unavailable += t.unavailable;
      out.champBits.push(...t.champBits);
      out.playoffBits.push(...t.playoffBits);
      if (t.finalObjs) (out.finalObjs ??= []).push(...t.finalObjs);
      if (t.rosters) (out.rosters ??= []).push(...t.rosters);
      if (t.ranks) (out.ranks ??= []).push(...t.ranks);
    }
    return out;
  });
}

export interface ChampionshipSummary {
  id: string;
  sims: number;
  pChamp: number;
  pChampSe: number;
  pPlayoffs: number;
  deltaChamp: number;
  deltaChampSe: number;
  deltaPlayoffs: number;
  deltaPlayoffsSe: number;
  meanFinalObj: number;
  sdFinalObj: number;
  unavailableRate: number;
}

function pairedDelta(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (!n) return { d: 0, se: 1 };
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    s += d;
    s2 += d * d;
  }
  const m = s / n;
  const v = n > 1 ? (s2 - n * m * m) / (n - 1) : 1;
  return { d: m, se: Math.sqrt(Math.max(v, 0) / n) || 1 / n };
}

export interface ChampionshipVerdict {
  level: 0 | 1 | 2;
  label: string;
  reason: string;
  summaries: ChampionshipSummary[];
  baseline: ChampionshipSummary | null;
}

/**
 * Summarise tallies and decide which metric level is reliable enough to rank by:
 * 0 = Δ championship probability, 1 = Δ playoff probability, 2 = fast expected-outcome metric.
 */
export function summarise(tallies: CandidateTally[], minSims = 200): ChampionshipVerdict {
  const base = tallies.find((t) => t.id === POLICY) ?? null;
  const summaries: ChampionshipSummary[] = tallies
    .filter((t) => t.id !== POLICY)
    .map((t) => {
      const pc = t.champ / Math.max(1, t.sims);
      const dc = base ? pairedDelta(t.champBits, base.champBits) : { d: 0, se: 1 };
      const dp = base ? pairedDelta(t.playoffBits, base.playoffBits) : { d: 0, se: 1 };
      const mo = t.finalObj / Math.max(1, t.sims);
      return {
        id: t.id,
        sims: t.sims,
        pChamp: pc,
        pChampSe: Math.sqrt(Math.max(pc * (1 - pc), 1e-9) / Math.max(1, t.sims)),
        pPlayoffs: t.playoffs / Math.max(1, t.sims),
        deltaChamp: dc.d,
        deltaChampSe: dc.se,
        deltaPlayoffs: dp.d,
        deltaPlayoffsSe: dp.se,
        meanFinalObj: mo,
        sdFinalObj: Math.sqrt(Math.max(0, t.finalObjSq / Math.max(1, t.sims) - mo * mo)),
        unavailableRate: t.unavailable / Math.max(1, t.sims),
      };
    });
  summaries.sort((a, b) => b.deltaChamp - a.deltaChamp || b.deltaPlayoffs - a.deltaPlayoffs);
  const baseline = base
    ? {
        id: POLICY,
        sims: base.sims,
        pChamp: base.champ / Math.max(1, base.sims),
        pChampSe: Math.sqrt(Math.max((base.champ / base.sims) * (1 - base.champ / base.sims), 1e-9) / Math.max(1, base.sims)),
        pPlayoffs: base.playoffs / Math.max(1, base.sims),
        deltaChamp: 0,
        deltaChampSe: 0,
        deltaPlayoffs: 0,
        deltaPlayoffsSe: 0,
        meanFinalObj: base.finalObj / Math.max(1, base.sims),
        sdFinalObj: 0,
        unavailableRate: 0,
      }
    : null;
  const n = Math.min(...tallies.map((t) => t.sims));
  if (summaries.length < 2 || n < minSims)
    return { level: 2, label: "Level 2 · Expected-outcome lookahead", reason: `Only ${n} simulations so far (need ≥ ${minSims}).`, summaries, baseline };
  const byChamp = [...summaries].sort((a, b) => b.deltaChamp - a.deltaChamp);
  const [c1, c2] = byChamp;
  const t1 = tallies.find((t) => t.id === c1.id)!;
  const t2 = tallies.find((t) => t.id === c2.id)!;
  const champSep = pairedDelta(t1.champBits, t2.champBits);
  if (champSep.d > 1.96 * champSep.se)
    return {
      level: 0,
      label: "Level 0 · Δ Championship probability",
      reason: `Top candidate beats #2 by ${(champSep.d * 100).toFixed(1)} pts (SE ${(champSep.se * 100).toFixed(1)}).`,
      summaries: byChamp,
      baseline,
    };
  const byPo = [...summaries].sort((a, b) => b.deltaPlayoffs - a.deltaPlayoffs);
  const p1 = tallies.find((t) => t.id === byPo[0].id)!;
  const p2 = tallies.find((t) => t.id === byPo[1].id)!;
  const poSep = pairedDelta(p1.playoffBits, p2.playoffBits);
  if (poSep.d > 1.96 * poSep.se)
    return {
      level: 1,
      label: "Level 1 · Δ Playoff qualification",
      reason: `Championship deltas not separable (Δ ${(champSep.d * 100).toFixed(1)} ± ${(champSep.se * 100).toFixed(1)}); playoff odds are.`,
      summaries: byPo,
      baseline,
    };
  return {
    level: 2,
    label: "Level 2 · Expected-outcome lookahead",
    reason: `Neither championship nor playoff deltas separate the top candidates at ${n} sims — falling back to expected category outcomes.`,
    summaries: byChamp,
    baseline,
  };
}

export { takeId };
