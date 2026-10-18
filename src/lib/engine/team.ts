/**
 * Team aggregation and head-to-head / rotisserie category model.
 *
 * A team's weekly (or season) category totals are modelled as approximately
 * normal. Each player contributes additively to sufficient statistics stored in
 * a Float64Array so teams can be built and compared very quickly:
 *
 *   counting stat c:  mean  Σ e·μ
 *                     var   Σ e·φ_c·μ + Var(G)·μ²          (game-to-game + games-played noise)
 *                     unc   Σ (e·sd_μ)²                     (projection uncertainty of μ)
 *   FG% / FT%:        team % = Σ E[makes] / Σ E[attempts]   (volume-weighted, never an average of %)
 *                     variance via the delta method on (makes − p_T·attempts).
 *
 * e = expected counted games = n · q,   q = P(available) × lineup usage,
 * n = scheduled games in the period, Var(G) = n·q·(1−q) (or gpSd² for season totals).
 * See METHODOLOGY.md §5.
 */
import { CAT_BY_KEY, COUNTING_KEYS } from "../categories";
import type { CategoryKey, CountingKey, StatLine } from "../types";
import { normCdf, normPdf, poissonBinomial } from "./math";

export interface PlayerLine {
  id: string;
  line: StatLine; // per-game projection
  gp: number; // projected games
  gpSd: number;
  sd: Partial<Record<keyof StatLine, number>>;
  team: string;
}

const NC = COUNTING_KEYS.length; // 7
const PCT_BASE = NC * 3; // 21
const PCT_LEN = 10;
export const AGG_LEN = PCT_BASE + 2 * PCT_LEN + 1; // 42
/** Index holding expected counted player-games (Σ e). */
export const GAMES = AGG_LEN - 1;
const FG = PCT_BASE;
const FT = PCT_BASE + PCT_LEN;

export type Agg = Float64Array;

export function emptyAgg(): Agg {
  return new Float64Array(AGG_LEN);
}

export function addInto(target: Agg, src: Agg, sign = 1): Agg {
  for (let i = 0; i < AGG_LEN; i++) target[i] += sign * src[i];
  return target;
}

export function sumAggs(aggs: Agg[]): Agg {
  const t = emptyAgg();
  for (const a of aggs) addInto(t, a);
  return t;
}

export function scaleAgg(a: Agg, k: number): Agg {
  // Scale games (e): means scale by k, variance terms approximately by k (k² for unc / games var).
  const out = new Float64Array(a);
  for (let c = 0; c < NC; c++) {
    out[c * 3] *= k;
    out[c * 3 + 1] *= k;
    out[c * 3 + 2] *= k * k;
  }
  for (const b of [FG, FT]) {
    for (let j = 0; j < 6; j++) out[b + j] *= k;
    for (let j = 6; j < 10; j++) out[b + j] *= k * k;
  }
  out[GAMES] *= k;
  return out;
}

export interface ContributionOptions {
  /** Scheduled games in the period for the player's NBA team. */
  scheduled: number;
  /** Lineup usage multiplier (1 = always started when playing). */
  usage: number;
  /** Season-total mode uses gpSd for games-played variance. */
  seasonMode?: boolean;
  includeUncertainty?: boolean;
}

/** Sufficient-statistic contribution of one player to a team aggregate. */
export function contribution(p: PlayerLine, o: ContributionOptions): Agg {
  return addContribution(emptyAgg(), p, o);
}

/** Add a player's contribution into an existing aggregate (allocation-free hot path). */
export function addContribution(a: Agg, p: PlayerLine, o: ContributionOptions): Agg {
  const avail = Math.max(0, Math.min(1, p.gp / 82));
  const q = avail * o.usage;
  const n = o.scheduled;
  const e = n * q;
  // Season totals: games-played uncertainty is dominated by injury clustering (gpSd), not
  // independent per-game availability, so use the projection's games SD instead of binomial.
  const varG = o.seasonMode ? ((p.gpSd * o.usage * n) / 82) ** 2 : n * q * (1 - q);
  const unc = o.includeUncertainty !== false;
  const L = p.line;
  for (let c = 0; c < NC; c++) {
    const k = COUNTING_KEYS[c];
    const mu = L[k];
    a[c * 3] += e * mu;
    a[c * 3 + 1] += e * PHI[c] * mu + varG * mu * mu;
    if (unc) {
      const s = p.sd[k] ?? 0;
      a[c * 3 + 2] += (e * s) ** 2;
    }
  }
  a[GAMES] += e;
  for (let j = 0; j < 2; j++) {
    const base = j === 0 ? FG : FT;
    const m = j === 0 ? L.fgm : L.ftm;
    const att = j === 0 ? L.fga : L.fta;
    const phi = j === 0 ? PHI_FG : PHI_FT;
    const pi = att > 0 ? m / att : 0;
    a[base] += e * m;
    a[base + 1] += e * att;
    a[base + 2] += e * att * pi * (1 - pi);
    a[base + 3] += e * phi * att;
    a[base + 4] += e * phi * att * pi;
    a[base + 5] += e * phi * att * pi * pi;
    a[base + 6] += varG * m * m;
    a[base + 7] += varG * m * att;
    a[base + 8] += varG * att * att;
    if (unc) {
      const s = (j === 0 ? p.sd.fgm : p.sd.ftm) ?? 0;
      a[base + 9] += (e * s) ** 2;
    }
  }
  return a;
}

const PHI = COUNTING_KEYS.map((k) => CAT_BY_KEY[k].phi);
const PHI_FG = CAT_BY_KEY.fgPct.phi;
const PHI_FT = CAT_BY_KEY.ftPct.phi;

export interface CatDist {
  mean: number;
  variance: number;
}

/** Mean and variance of a team's category total (or team percentage). */
export function catDist(a: Agg, cat: CategoryKey): CatDist {
  const def = CAT_BY_KEY[cat];
  if (def.kind === "counting") {
    const c = COUNTING_KEYS.indexOf(cat as CountingKey);
    return { mean: a[c * 3], variance: a[c * 3 + 1] + a[c * 3 + 2] };
  }
  const b = cat === "fgPct" ? FG : FT;
  const Em = a[b];
  const Ea = a[b + 1];
  if (Ea <= 1e-9) return { mean: 0, variance: 1 };
  const p = Em / Ea;
  const num = a[b + 2] + (a[b + 5] - 2 * p * a[b + 4] + p * p * a[b + 3]) + (a[b + 6] - 2 * p * a[b + 7] + p * p * a[b + 8]) + a[b + 9];
  return { mean: p, variance: Math.max(num, 1e-9) / (Ea * Ea) };
}

/** P(team A beats team B in a category). Ties are treated as negligible (continuous model). */
export function catWinProb(A: Agg, B: Agg, cat: CategoryKey): number {
  const da = catDist(A, cat);
  const db = catDist(B, cat);
  const s = Math.sqrt(da.variance + db.variance);
  const diff = CAT_BY_KEY[cat].direction * (da.mean - db.mean);
  if (s < 1e-12) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  return normCdf(diff / s);
}

/** d P(A wins cat) / d mean_A(cat) — used for linearised marginal values. */
export function catWinGradient(A: Agg, B: Agg, cat: CategoryKey): number {
  const da = catDist(A, cat);
  const db = catDist(B, cat);
  const s = Math.sqrt(da.variance + db.variance);
  if (s < 1e-12) return 0;
  const diff = CAT_BY_KEY[cat].direction * (da.mean - db.mean);
  return (CAT_BY_KEY[cat].direction * normPdf(diff / s)) / s;
}

export function catProbs(A: Agg, B: Agg, cats: CategoryKey[]): number[] {
  return cats.map((c) => catWinProb(A, B, c));
}

/** P(win a most-categories matchup): more category wins than losses; exact tie counts half. */
export function matchupWinProb(ps: number[]): number {
  const dist = poissonBinomial(ps);
  const n = ps.length;
  let p = 0;
  for (let k = 0; k <= n; k++) {
    if (2 * k > n) p += dist[k];
    else if (2 * k === n) p += 0.5 * dist[k];
  }
  return p;
}

export interface FieldEvaluation {
  /** Mean over opponents of expected category wins per matchup. */
  expectedCatWins: number;
  /** Mean over opponents of P(win matchup) under most-categories rules. */
  matchupWinProb: number;
  /** Expected rotisserie points (season totals), if computed. */
  rotoPoints: number;
  perCategory: Record<string, number>; // mean P(win) per category
  perOpponent: { index: number; expectedCatWins: number; winProb: number; catProbs: number[] }[];
}

/** Evaluate a team aggregate against a field of opponent aggregates. */
export function evaluateVsField(me: Agg, opponents: { index: number; agg: Agg }[], cats: CategoryKey[]): FieldEvaluation {
  const perCategory: Record<string, number> = Object.fromEntries(cats.map((c) => [c, 0]));
  const perOpponent: FieldEvaluation["perOpponent"] = [];
  let ecw = 0;
  let mw = 0;
  for (const o of opponents) {
    const ps = catProbs(me, o.agg, cats);
    const e = ps.reduce((a, b) => a + b, 0);
    const w = matchupWinProb(ps);
    ecw += e;
    mw += w;
    ps.forEach((p, i) => (perCategory[cats[i]] += p));
    perOpponent.push({ index: o.index, expectedCatWins: e, winProb: w, catProbs: ps });
  }
  const n = Math.max(1, opponents.length);
  for (const c of cats) perCategory[c] /= n;
  // Roto points: 1 point per opponent beaten in each category, plus 1 (last place = 1).
  const rotoPoints = cats.reduce((a, c) => a + 1 + perCategory[c] * opponents.length, 0);
  return { expectedCatWins: ecw / n, matchupWinProb: mw / n, rotoPoints, perCategory, perOpponent };
}

export function objectiveValue(ev: FieldEvaluation, format: "h2h_each" | "h2h_most" | "roto"): number {
  if (format === "h2h_most") return ev.matchupWinProb;
  if (format === "roto") return ev.rotoPoints;
  return ev.expectedCatWins;
}

export const OBJECTIVE_LABEL = {
  h2h_each: { name: "Expected category wins / week", unit: "cats", digits: 3 },
  h2h_most: { name: "Matchup win probability (most-cats)", unit: "%", digits: 1 },
  roto: { name: "Expected roto points", unit: "pts", digits: 2 },
} as const;
