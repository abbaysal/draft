/**
 * WarRoom Projection Model v1 — a transparent, Marcel-style projection system.
 *
 * It is a MODEL-GENERATED ESTIMATE, not a third-party projection. Every step is
 * documented in METHODOLOGY.md §2 and every constant lives in PROJECTION_CONSTANTS
 * so it can be audited and tuned.
 *
 * Steps:
 *  1. Per-minute production rates blended across up to three seasons with
 *     recency weights (6/3/1) multiplied by minutes played.
 *  2. Regression of per-minute rates toward the league average of the player's
 *     position group (adds R "phantom" minutes of league-average production).
 *  3. Shooting percentages regressed via phantom attempts (volume-aware).
 *  4. Age adjustment on production rates (not on percentages).
 *  5. Minutes = games-weighted MPG with small age adjustments.
 *  6. Games played = recency-weighted GP regressed toward a league prior, minus
 *     researched games-missed estimates.
 *  7. Points derived from the box-score identity PTS = 2·FGM + 3PM + FTM.
 *  8. Uncertainty (SD of the true per-game mean) from sample size and role flags.
 */
import type { Availability, HistSeason, Projection, StatLine, TeamChange } from "../types";

export const PROJECTION_VERSION = "warroom-model-v1.0";
export const PROJECTION_SOURCE = "warroom-model";

export const PROJECTION_CONSTANTS = {
  seasonWeights: { "2025-26": 6, "2024-25": 3, "2023-24": 1 } as Record<string, number>,
  regressionMinutes: 400,
  fgPhantomAttempts: 150,
  ftPhantomAttempts: 100,
  gpPriorGames: 68,
  gpPriorWeight: 1.5,
  gpCap: 79,
  minSampleMinutes: 150,
  ageAdjust: [
    [21, 0.06],
    [22, 0.05],
    [23, 0.04],
    [24, 0.03],
    [25, 0.02],
    [26, 0.01],
    [29, 0],
    [30, -0.01],
    [31, -0.02],
    [32, -0.03],
    [33, -0.045],
    [34, -0.06],
    [99, -0.08],
  ] as [number, number][],
};

const RATE_KEYS = ["fg3m", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "ftm", "fta"] as const;
type RateKey = (typeof RATE_KEYS)[number];

export type LeagueRates = Record<"G" | "F" | "C", Record<RateKey, number> & { fgPct: number; ftPct: number }>;

export function posGroup(nbaPos: string): "G" | "F" | "C" {
  const p = nbaPos.trim().toUpperCase()[0];
  return p === "C" ? "C" : p === "F" ? "F" : "G";
}

/** League per-minute rates by position group, computed from actual seasons with real attempts. */
export function computeLeagueRates(
  rows: { nbaPos: string; season: HistSeason }[],
  minMinutes = 500,
): LeagueRates {
  const acc: Record<string, Record<string, number>> = {};
  for (const { nbaPos, season } of rows) {
    if (season.attemptsEstimated) continue;
    const total = season.gp * season.min;
    if (total < minMinutes) continue;
    const g = posGroup(nbaPos);
    acc[g] ??= { minutes: 0 };
    acc[g].minutes += total;
    for (const k of RATE_KEYS) acc[g][k] = (acc[g][k] ?? 0) + season[k] * season.gp;
  }
  const out = {} as LeagueRates;
  for (const g of ["G", "F", "C"] as const) {
    const a = acc[g];
    if (!a || !a.minutes) throw new Error(`No league data for position group ${g}`);
    const r = {} as Record<RateKey, number>;
    for (const k of RATE_KEYS) r[k] = a[k] / a.minutes;
    out[g] = { ...r, fgPct: a.fgm / a.fga, ftPct: a.ftm / a.fta };
  }
  return out;
}

export function ageAdjustment(age: number | undefined): number {
  if (age == null) return 0;
  for (const [maxAge, adj] of PROJECTION_CONSTANTS.ageAdjust) if (age <= maxAge) return adj;
  return 0;
}

export interface ProjectionInput {
  nbaPos: string;
  age?: number;
  hist: HistSeason[];
  availability?: Availability;
  teamChange?: TeamChange;
}

export function projectPlayer(input: ProjectionInput, league: LeagueRates): Projection | null {
  const C = PROJECTION_CONSTANTS;
  const flags: string[] = [];
  const seasons = input.hist.filter((h) => h.gp > 0 && h.min > 0 && C.seasonWeights[h.season] != null);
  const totalMinutes = seasons.reduce((s, h) => s + h.gp * h.min, 0);
  if (totalMinutes < C.minSampleMinutes) return null;

  const lg = league[posGroup(input.nbaPos)];
  const latestW = Math.max(...Object.values(C.seasonWeights));

  // 1–2. Weighted, regressed per-minute rates.
  const wMin = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.gp * h.min, 0);
  const phantom = C.regressionMinutes * latestW;
  const rate = {} as Record<RateKey, number>;
  for (const k of RATE_KEYS) {
    const wStat = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h[k] * h.gp, 0);
    rate[k] = (wStat + phantom * lg[k]) / (wMin + phantom);
  }

  // 3. Volume-aware shooting percentages (phantom attempts at league average).
  const wFgm = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.fgm * h.gp, 0);
  const wFga = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.fga * h.gp, 0);
  const wFtm = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.ftm * h.gp, 0);
  const wFta = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.fta * h.gp, 0);
  const fgPhantom = C.fgPhantomAttempts * latestW;
  const ftPhantom = C.ftPhantomAttempts * latestW;
  const fgPct = (wFgm + fgPhantom * lg.fgPct) / (wFga + fgPhantom);
  const ftPct = (wFtm + ftPhantom * lg.ftPct) / (wFta + ftPhantom);

  // 4. Age adjustment to production rates.
  const ageAdj = ageAdjustment(input.age);
  if (ageAdj > 0.025) flags.push(`Age ${input.age}: +${(ageAdj * 100).toFixed(0)}% development adjustment`);
  if (ageAdj < -0.025) flags.push(`Age ${input.age}: ${(ageAdj * 100).toFixed(1)}% aging adjustment`);
  for (const k of RATE_KEYS) rate[k] *= 1 + ageAdj;

  // 5. Minutes per game.
  const gpW = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.gp, 0);
  let mpg = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.gp * h.min, 0) / gpW;
  if (input.age != null && input.age <= 22) mpg += 1.0;
  if (input.age != null && input.age >= 34) mpg -= 1.5;
  mpg = Math.max(4, Math.min(38, mpg));

  // 6. Games played.
  const gpHistW = seasons.reduce((s, h) => s + C.seasonWeights[h.season], 0);
  const gpHist = seasons.reduce((s, h) => s + C.seasonWeights[h.season] * h.gp, 0);
  let gp = (gpHist + C.gpPriorGames * C.gpPriorWeight * latestW) / (gpHistW + C.gpPriorWeight * latestW);
  gp = Math.min(C.gpCap, gp);
  const missed = input.availability?.estGamesMissed ?? 0;
  if (missed > 0) {
    gp = Math.max(0, gp * (1 - missed / 82));
    flags.push(`Researched availability: ~${missed} games missed (${input.availability?.confidence} confidence)`);
  }
  const hasLatest = seasons.some((h) => h.season === "2025-26");
  if (!hasLatest) flags.push("No 2025-26 games: projection relies on 2023-25 history");
  if (seasons.some((h) => h.attemptsEstimated)) flags.push("Some historical FGA/FTA estimated from per-game data");
  if (input.teamChange) flags.push(`New team: ${input.teamChange.from} → ${input.teamChange.to} (role uncertainty)`);

  // 7. Per-game line.
  const line: StatLine = {
    min: mpg,
    fg3m: rate.fg3m * mpg,
    reb: rate.reb * mpg,
    ast: rate.ast * mpg,
    stl: rate.stl * mpg,
    blk: rate.blk * mpg,
    tov: rate.tov * mpg,
    fga: rate.fga * mpg,
    fgm: rate.fga * mpg * fgPct,
    fta: rate.fta * mpg,
    ftm: rate.fta * mpg * ftPct,
    pts: 0,
  };
  line.fg3m = Math.min(line.fg3m, line.fgm);
  line.pts = 2 * line.fgm + line.fg3m + line.ftm;

  // 8. Uncertainty.
  let cv = 0.06 + 0.5 / Math.sqrt(1 + totalMinutes / 150);
  if (input.teamChange) cv += 0.04;
  if (!hasLatest) cv += 0.06;
  if (input.availability && ["RETURNING", "OUT_EXTENDED"].includes(input.availability.status)) cv += 0.04;
  if (input.age != null && input.age <= 22) cv += 0.03;
  const sd: Projection["sd"] = {};
  for (const k of ["pts", "fg3m", "reb", "ast", "stl", "blk", "tov", "fga", "fta", "min"] as const) sd[k] = line[k] * cv;
  // Percentage uncertainty from attempt volume: binomial SE of the regressed estimate.
  sd.fgm = Math.sqrt((fgPct * (1 - fgPct)) / (wFga / latestW + C.fgPhantomAttempts)) * line.fga;
  sd.ftm = Math.sqrt((ftPct * (1 - ftPct)) / (wFta / latestW + C.ftPhantomAttempts)) * line.fta;
  let gpSd = 7 + 0.18 * (82 - gp);
  if (input.availability && input.availability.status !== "HEALTHY") gpSd += 5;
  gpSd = Math.min(gpSd, gp);

  const confidence = Math.max(0.05, Math.min(0.95, 1 - 1.6 * cv));

  return {
    ...line,
    gp,
    sd,
    gpSd,
    confidence,
    source: PROJECTION_SOURCE,
    version: PROJECTION_VERSION,
    kind: "estimate",
    flags,
  };
}

/**
 * Derive FGA/FTA for a per-game line that only has percentages (e.g. the
 * nbabench per-game files). Uses PTS = 2·FGM + 3PM + FTM, FGM = fg%·FGA,
 * FTM = ft%·r·FGA where r = FTA/FGA is taken from the player's own season with
 * real attempts if available, else the league position-group ratio.
 */
export function estimateAttempts(
  pts: number,
  fg3m: number,
  fgPct: number,
  ftPct: number,
  ftaPerFga: number,
): { fgm: number; fga: number; ftm: number; fta: number } {
  if (!(fgPct > 0) || pts <= 0) return { fgm: 0, fga: 0, ftm: 0, fta: 0 };
  const denom = 2 * fgPct + ftPct * ftaPerFga;
  const fga = Math.max(0, (pts - fg3m) / denom);
  const fta = fga * ftaPerFga;
  return { fga, fgm: fga * fgPct, fta, ftm: fta * ftPct };
}
