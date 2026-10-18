/**
 * Player valuation: Z-scores and G-scores with volume-weighted percentage impact.
 *
 * Key design decisions (see METHODOLOGY.md §3):
 *  - FG% / FT% are valued by IMPACT = makes − baseline% × attempts, never by raw %.
 *  - Turnovers are reversed (fewer = better).
 *  - The normalisation baseline (means / SDs / baseline percentages) is computed
 *    ONCE for the league's active categories on an iteratively-selected draftable
 *    pool. Punts and soft weights only re-weight category scores; they never
 *    re-center the baseline, so punting a category cannot silently change the
 *    relative scale of the remaining categories.
 */
import { CAT_KEYS, CATEGORIES, CAT_BY_KEY, type CategoryWeights, uniformWeights } from "../categories";
import type { CategoryKey, Player, StatLine } from "../types";

export type ValueBasis = "perGame" | "season";
export type ValueMethod = "z" | "g";
export type Population = "draftable" | "all" | "position";

export interface ValuationConfig {
  basis: ValueBasis;
  method: ValueMethod;
  /** Number of players in the draftable pool (teams × roster size). */
  poolSize: number;
  population: Population;
  activeCats: CategoryKey[];
  /** Average scheduled games per week, used to scale within-player weekly variance for G-scores. */
  gamesPerWeek: number;
}

export interface Baseline {
  config: ValuationConfig;
  mean: Record<CategoryKey, number>;
  sd: Record<CategoryKey, number>;
  /** G-score shrink factor per category: σ_between / sqrt(σ_between² + σ_within²). */
  gFactor: Record<CategoryKey, number>;
  fgPct: number;
  ftPct: number;
  poolIds: string[];
  replacement: Record<CategoryKey, number>;
  replacementTotal: number;
}

export interface PlayerValue {
  id: string;
  cat: Record<CategoryKey, number>;
  total: number;
  /** total − replacement-level total (VORP-style). */
  vorp: number;
  rank: number;
}

export const DEFAULT_VALUATION: ValuationConfig = {
  basis: "perGame",
  method: "z",
  poolSize: 156,
  population: "draftable",
  activeCats: CAT_KEYS,
  gamesPerWeek: 3.3,
};

/** Raw (un-normalised) category quantity for a player, per game or season total. */
export function rawCategory(line: StatLine, gp: number, cat: CategoryKey, basis: ValueBasis, fgBase: number, ftBase: number): number {
  const mult = basis === "season" ? gp : 1;
  switch (cat) {
    case "fgPct":
      return (line.fgm - fgBase * line.fga) * mult;
    case "ftPct":
      return (line.ftm - ftBase * line.fta) * mult;
    default:
      return line[cat] * mult;
  }
}

function projected(players: Player[]): Player[] {
  return players.filter((p) => p.proj && p.proj.min > 0);
}

function computeStats(pool: Player[], cfg: ValuationConfig, fgBase: number, ftBase: number) {
  const mean = {} as Record<CategoryKey, number>;
  const sd = {} as Record<CategoryKey, number>;
  const gFactor = {} as Record<CategoryKey, number>;
  for (const cat of CAT_KEYS) {
    const xs = pool.map((p) => rawCategory(p.proj!, p.proj!.gp, cat, cfg.basis, fgBase, ftBase));
    const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length);
    mean[cat] = m;
    sd[cat] = Math.sqrt(v) || 1;
    // Within-player weekly variance (per-game scale) for the G-score factor.
    const def = CAT_BY_KEY[cat];
    let within = 0;
    for (const p of pool) {
      const l = p.proj!;
      if (def.kind === "percentage") {
        const [mk, at] = def.ratio!;
        const att = l[at];
        const pct = att > 0 ? l[mk] / att : 0;
        within += (att * pct * (1 - pct) * def.phi) / cfg.gamesPerWeek;
      } else {
        within += (def.phi * l[cat as keyof StatLine]) / cfg.gamesPerWeek;
      }
    }
    within /= Math.max(1, pool.length);
    // σ_between on per-game scale (season basis divides out gp approximately).
    const sbPerGame =
      cfg.basis === "season"
        ? sd[cat] / Math.max(1, pool.reduce((a, p) => a + p.proj!.gp, 0) / Math.max(1, pool.length))
        : sd[cat];
    gFactor[cat] = sbPerGame / Math.sqrt(sbPerGame ** 2 + within);
  }
  return { mean, sd, gFactor };
}

function score(p: Player, base: Omit<Baseline, "replacement" | "replacementTotal" | "poolIds">, weights: CategoryWeights) {
  const cat = {} as Record<CategoryKey, number>;
  let total = 0;
  for (const c of CATEGORIES) {
    const raw = rawCategory(p.proj!, p.proj!.gp, c.key, base.config.basis, base.fgPct, base.ftPct);
    let z = (c.direction * (raw - base.mean[c.key])) / base.sd[c.key];
    if (base.config.method === "g") z *= base.gFactor[c.key];
    const active = base.config.activeCats.includes(c.key);
    cat[c.key] = active ? z : 0;
    total += active ? z * weights[c.key] : 0;
  }
  return { cat, total };
}

/**
 * Build the frozen normalisation baseline. The draftable pool is chosen
 * iteratively: value everyone against the full pool, keep the top N, recompute
 * the baseline on those N, repeat until membership stabilises.
 */
export function buildBaseline(players: Player[], cfg: ValuationConfig = DEFAULT_VALUATION): Baseline {
  const all = projected(players).filter((p) => p.proj!.min >= 8 && p.proj!.gp >= 5);
  const weights = uniformWeights(cfg.activeCats);
  let pool = all;
  let fgBase = sumRatio(pool, "fgm", "fga");
  let ftBase = sumRatio(pool, "ftm", "fta");
  let stats = computeStats(pool, cfg, fgBase, ftBase);
  if (cfg.population !== "all") {
    for (let iter = 0; iter < 4; iter++) {
      const partial = { config: cfg, ...stats, fgPct: fgBase, ftPct: ftBase };
      const ranked = all
        .map((p) => ({ p, v: score(p, partial, weights).total }))
        .sort((a, b) => b.v - a.v)
        .slice(0, Math.min(cfg.poolSize, all.length))
        .map((x) => x.p);
      const same = ranked.length === pool.length && ranked.every((p, i) => p === pool[i]);
      pool = ranked;
      fgBase = sumRatio(pool, "fgm", "fga");
      ftBase = sumRatio(pool, "ftm", "fta");
      stats = computeStats(pool, cfg, fgBase, ftBase);
      if (same) break;
    }
  }
  const base = { config: cfg, ...stats, fgPct: fgBase, ftPct: ftBase };
  // Replacement level: average of the players ranked just outside the draftable pool.
  const ranked = all.map((p) => ({ p, s: score(p, base, weights) })).sort((a, b) => b.s.total - a.s.total);
  const repl = ranked.slice(cfg.poolSize, cfg.poolSize + 12);
  const replacement = {} as Record<CategoryKey, number>;
  for (const c of CAT_KEYS) replacement[c] = repl.length ? repl.reduce((a, r) => a + r.s.cat[c], 0) / repl.length : 0;
  const replacementTotal = repl.length ? repl.reduce((a, r) => a + r.s.total, 0) / repl.length : 0;
  return { ...base, poolIds: pool.map((p) => p.id), replacement, replacementTotal };
}

function sumRatio(pool: Player[], mk: "fgm" | "ftm", at: "fga" | "fta"): number {
  let m = 0;
  let a = 0;
  for (const p of pool) {
    m += p.proj![mk];
    a += p.proj![at];
  }
  return a > 0 ? m / a : 0;
}

/** Value every projected player under a (possibly punted / soft-weighted) weight vector. */
export function valuePlayers(players: Player[], base: Baseline, weights: CategoryWeights = uniformWeights(base.config.activeCats)): Map<string, PlayerValue> {
  const replTotal = CAT_KEYS.reduce((a, c) => a + base.replacement[c] * weights[c], 0);
  const vals = projected(players).map((p) => {
    const s = score(p, base, weights);
    return { id: p.id, cat: s.cat, total: s.total, vorp: s.total - replTotal, rank: 0 };
  });
  vals.sort((a, b) => b.total - a.total);
  vals.forEach((v, i) => (v.rank = i + 1));
  return new Map(vals.map((v) => [v.id, v]));
}

export interface RankShift {
  id: string;
  baseRank: number;
  newRank: number;
  delta: number; // positive = rises
}

/** Compare rankings under two weight vectors (e.g. balanced vs punt FT%). */
export function rankShifts(baseVals: Map<string, PlayerValue>, newVals: Map<string, PlayerValue>, topN = 200): RankShift[] {
  const out: RankShift[] = [];
  for (const [id, nv] of newVals) {
    const bv = baseVals.get(id);
    if (!bv) continue;
    if (bv.rank > topN && nv.rank > topN) continue;
    out.push({ id, baseRank: bv.rank, newRank: nv.rank, delta: bv.rank - nv.rank });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/** Team-level shooting percentage from aggregated makes and attempts (never an average of %). */
export function teamPct(lines: { m: number; a: number }[]): number | null {
  let m = 0;
  let a = 0;
  for (const l of lines) {
    m += l.m;
    a += l.a;
  }
  return a > 0 ? m / a : null;
}
