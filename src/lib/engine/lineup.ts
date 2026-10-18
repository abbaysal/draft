/**
 * Weekly matchup analysis and opponent-specific lineup optimisation.
 *
 * For a given matchup period (one or more fantasy calendar weeks) and opponent:
 *  1. Both rosters are aggregated with that period's NBA games (real game dates when a
 *     schedule is loaded, otherwise the uniform estimate).
 *  2. Category win probabilities come from the matchup model (team.ts).
 *  3. Each player's matchup score = Σ_c ∂P(win_c)/∂mean_c × his contribution to c, i.e.
 *     how much he moves the expected number of categories won in this matchup. Swing
 *     categories (close to 50%) dominate; categories already won or lost barely count.
 *  4. Daily leagues with a real schedule: every game day, the players who have a game are
 *     slotted greedily by per-game matchup score subject to positional feasibility
 *     (bipartite matching); the rest of that day's players sit. Both teams are optimised
 *     the same way, and the final projection counts only started games.
 *  5. Injured players (reported out) go to IL first.
 */
import { CAT_BY_KEY, COUNTING_KEYS } from "../categories";
import { startingSlots } from "../league";
import { matchLineup } from "../positions";
import type { CategoryKey, LineupSlot } from "../types";
import { usageFor, type AnalysisContext } from "./context";
import { fantasyWeek, TOTAL_WEEKS, weekRange } from "./schedule";
import { addContribution, catDist, catProbs, catWinGradient, emptyAgg, matchupWinProb, type Agg } from "./team";

export interface LineupRow {
  id: string;
  slot: LineupSlot | "BN" | "IL";
  score: number;
  /** Expected games (availability-adjusted) in the period. */
  games: number;
  /** Scheduled NBA games in the period / of those, days he gets a starting slot (daily plan). */
  scheduled: number;
  starts: number;
}

export interface CategoryLine {
  cat: CategoryKey;
  mine: number;
  theirs: number;
  pWin: number;
  swing: boolean;
}

export interface DayPlan {
  date: string;
  starters: { id: string; slot: LineupSlot }[];
  /** Players with a game who do not fit in a starting slot that day (or were benched by override). */
  sit: string[];
}

/** Manual start/sit decisions: date → player id → decision (the lineup analyzer). */
export type LineupOverrides = Record<string, Record<string, "start" | "sit">>;

export interface WeekPlan {
  period: number;
  weeks: number[];
  dates: { start: string; end: string };
  opponent: number;
  categories: CategoryLine[];
  expectedCats: number;
  winProb: number;
  lineup: LineupRow[];
  /** Day-by-day start/sit (empty without a real schedule). */
  daily: DayPlan[];
  pickups: { id: string; score: number; replaces: string | null; gain: number }[];
  notes: string[];
}

const OUT = new Set(["OUT_SEASON", "OUT_EXTENDED", "OUT_START"]);

/**
 * Head-to-head matchup periods as fantasy calendar weeks. Yahoo merges the NBA All-Star
 * break week (Mon Feb 15 2027, games resume Thu Feb 25) with the following week, so
 * 25 calendar weeks become 24 periods: 21 regular-season + 3 playoff weeks.
 */
export const ALL_STAR_WEEK = fantasyWeek("2027-02-15");
export function matchupPeriods(): number[][] {
  const out: number[][] = [];
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    if (w === ALL_STAR_WEEK && w < TOTAL_WEEKS) out.push([w, ++w]);
    else out.push([w]);
  }
  return out;
}

/** Index (1-based) of the matchup period containing a date. */
export function periodOf(date: string): number {
  const w = fantasyWeek(date);
  const i = matchupPeriods().findIndex((p) => p.includes(w));
  return i < 0 ? 1 : i + 1;
}

function periodGames(ctx: AnalysisContext, team: string, weeks: number[]) {
  return weeks.reduce((a, w) => a + (ctx.schedule.source === "imported" ? ctx.schedule.gamesInWeek(team, w) : ctx.schedule.gamesInWeek(team, w) || ctx.gamesPerWeek(team)), 0);
}

function rosterAgg(ctx: AnalysisContext, ids: string[], gamesOf: (id: string, team: string) => number, usage?: number[]): Agg {
  const agg = emptyAgg();
  ids.forEach((id, i) => {
    const l = ctx.lines.get(id);
    if (l) addContribution(agg, l, { scheduled: gamesOf(id, l.team), usage: usage ? usage[i] : 1 });
  });
  return agg;
}

const PCT_INDEX: Record<string, number> = { fgPct: COUNTING_KEYS.length * 3, ftPct: COUNTING_KEYS.length * 3 + 10 };

/** Matchup score: linearised change in expected categories won from `games` of this player. */
function matchupScore(ctx: AnalysisContext, id: string, games: number, base: Agg, grad: Record<string, number>, sign = 1): number {
  const l = ctx.lines.get(id);
  if (!l) return -Infinity;
  const c = addContribution(emptyAgg(), l, { scheduled: games, usage: 1 });
  let s = 0;
  for (const cat of ctx.cats) {
    if (CAT_BY_KEY[cat].kind === "counting") s += grad[cat] * c[COUNTING_KEYS.indexOf(cat as (typeof COUNTING_KEYS)[number]) * 3];
    else {
      const b = PCT_INDEX[cat];
      const A = base[b + 1];
      if (A <= 0) continue;
      const p = base[b] / A;
      s += (grad[cat] * (c[b] - p * c[b + 1])) / (A + c[b + 1]);
    }
  }
  return sign * s;
}

/** Greedy feasible starting set from players ordered best-first; returns slot per started player. */
function fillSlots(ctx: AnalysisContext, slots: LineupSlot[], ordered: string[]): { id: string; slot: LineupSlot }[] {
  const chosen: string[] = [];
  for (const id of ordered) {
    if (chosen.length >= slots.length) break;
    const trial = [...chosen, id];
    if (matchLineup(slots, trial.map((x) => ctx.byId.get(x)!.elig)).filled === trial.length) chosen.push(id);
  }
  const { assignment } = matchLineup(slots, chosen.map((x) => ctx.byId.get(x)!.elig));
  const out: { id: string; slot: LineupSlot }[] = [];
  slots.forEach((slot, i) => {
    if (assignment[i] >= 0) out.push({ id: chosen[assignment[i]], slot });
  });
  return out;
}

/** Day-by-day start/sit for one roster; returns the plan and started games per player. */
function dailyPlan(ctx: AnalysisContext, ids: string[], weeks: number[], perGame: Map<string, number>, slots: LineupSlot[], overrides: LineupOverrides = {}) {
  const dates = new Map<string, string[]>();
  for (const id of ids) {
    const team = ctx.byId.get(id)!.team;
    for (const w of weeks) for (const d of ctx.schedule.gameDates(team, w)) dates.set(d, [...(dates.get(d) ?? []), id]);
  }
  const starts = new Map<string, number>();
  const days: DayPlan[] = [];
  for (const date of [...dates.keys()].sort()) {
    const o = overrides[date] ?? {};
    const rank = (id: string) => (o[id] === "start" ? 1e6 : 0) + (perGame.get(id) ?? 0);
    const playing = dates.get(date)!.sort((a, b) => rank(b) - rank(a));
    const starters = fillSlots(ctx, slots, playing.filter((id) => o[id] !== "sit"));
    const on = new Set(starters.map((s) => s.id));
    for (const s of starters) starts.set(s.id, (starts.get(s.id) ?? 0) + 1);
    days.push({ date, starters, sit: playing.filter((id) => !on.has(id)) });
  }
  return { days, starts };
}

export function planWeek(ctx: AnalysisContext, period: number | number[], opponent: number, opts: { pickups?: boolean; overrides?: LineupOverrides } = {}): WeekPlan {
  const periods = matchupPeriods();
  const weeks = Array.isArray(period) ? period : (periods[period - 1] ?? [period]);
  const periodNo = Array.isArray(period) ? periods.findIndex((p) => p[0] === period[0]) + 1 : period;
  const notes: string[] = [];
  const real = ctx.schedule.source === "imported";
  const daily = real && ctx.settings.lineupMode === "daily";
  const slots = startingSlots(ctx.settings);
  const games = (_id: string, team: string) => periodGames(ctx, team, weeks);

  const injuredOf = (ids: string[]) => ids.filter((id) => OUT.has(ctx.byId.get(id)?.availability?.status ?? "")).slice(0, ctx.settings.slots.IL);
  const mine = ctx.rosters[ctx.myIndex];
  const theirs = ctx.rosters[opponent] ?? [];
  const injured = injuredOf(mine);
  const active = mine.filter((id) => !injured.includes(id));
  const oppInjured = injuredOf(theirs);
  const oppActive = theirs.filter((id) => !oppInjured.includes(id));

  // Preliminary projection (default usage) → category gradients.
  const opp0 = rosterAgg(ctx, oppActive, games, usageFor(ctx, oppActive));
  const me0 = rosterAgg(ctx, active, games, usageFor(ctx, active));
  const grad: Record<string, number> = {};
  for (const c of ctx.cats) grad[c] = catWinGradient(me0, opp0, c);

  const scored = active
    .map((id) => {
      const p = ctx.byId.get(id)!;
      return { id, score: matchupScore(ctx, id, games(id, p.team), me0, grad), perGame: matchupScore(ctx, id, 1, me0, grad) };
    })
    .sort((a, b) => b.score - a.score);

  // Base (weekly) lineup: best feasible starters for the whole period.
  const base = fillSlots(ctx, slots, scored.map((s) => s.id));
  const baseIds = new Set(base.map((b) => b.id));
  const scoreOf = new Map(scored.map((s) => [s.id, s.score]));

  let me: Agg;
  let opp: Agg;
  let days: DayPlan[] = [];
  let starts = new Map<string, number>();
  if (daily) {
    const mp = dailyPlan(ctx, active, weeks, new Map(scored.map((s) => [s.id, s.perGame])), slots, opts.overrides);
    days = mp.days;
    starts = mp.starts;
    // Opponent starts whoever hurts us most each day (their best players for this matchup).
    const oppPer = new Map(oppActive.map((id) => [id, matchupScore(ctx, id, 1, opp0, grad, -1)]));
    const op = dailyPlan(ctx, oppActive, weeks, oppPer, slots);
    me = rosterAgg(ctx, active, (id) => mp.starts.get(id) ?? 0);
    opp = rosterAgg(ctx, oppActive, (id) => op.starts.get(id) ?? 0);
  } else {
    const bench = ctx.settings.lineupMode === "daily" ? ctx.settings.benchUtilization : 0;
    me = rosterAgg(ctx, active, games, active.map((id) => (baseIds.has(id) ? 1 : bench)));
    opp = opp0;
  }

  const expGames = (id: string) => {
    const p = ctx.byId.get(id)!;
    return games(id, p.team) * Math.min(1, (p.proj?.gp ?? 0) / 82);
  };
  const row = (id: string, slot: LineupRow["slot"]): LineupRow => {
    const p = ctx.byId.get(id)!;
    const sched = slot === "IL" ? 0 : games(id, p.team);
    return { id, slot, score: slot === "IL" ? 0 : (scoreOf.get(id) ?? 0), games: slot === "IL" ? 0 : expGames(id), scheduled: sched, starts: daily ? (starts.get(id) ?? 0) : slot === "BN" || slot === "IL" ? 0 : sched };
  };
  const lineup: LineupRow[] = [
    ...base.map((b) => row(b.id, b.slot)),
    ...scored.filter((s) => !baseIds.has(s.id)).map((s) => row(s.id, "BN")),
    ...injured.map((id) => row(id, "IL")),
  ];
  if (base.length < slots.length) notes.push(`Only ${base.length}/${slots.length} starting slots can be filled with eligible healthy players.`);
  const lost = days.reduce((a, d) => a + d.sit.filter((id) => opts.overrides?.[d.date]?.[id] !== "sit").length, 0);
  if (lost > 0) notes.push(`${lost} player-game(s) this period don't fit in a starting slot (crowded days) — consider streaming a player whose games fall on light days.`);

  const ps = catProbs(me, opp, ctx.cats);
  const categories: CategoryLine[] = ctx.cats.map((c, i) => ({ cat: c, mine: catDist(me, c).mean, theirs: catDist(opp, c).mean, pWin: ps[i], swing: ps[i] > 0.3 && ps[i] < 0.7 }));

  // Pickups: undrafted players who help this matchup more than the weakest active player.
  const worst = scored.length ? scored[scored.length - 1] : null;
  const pickups = (opts.pickups === false ? [] : ctx.available)
    .filter((id) => !OUT.has(ctx.byId.get(id)?.availability?.status ?? ""))
    .slice(0, 250)
    .map((id) => ({ id, score: matchupScore(ctx, id, games(id, ctx.byId.get(id)!.team), me, grad) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((p) => ({ ...p, replaces: worst?.id ?? null, gain: p.score - (worst?.score ?? 0) }));

  if (!real) notes.push("No NBA schedule loaded — games per player are a uniform estimate; daily start/sit cannot use real game days.");
  if (theirs.length === 0) notes.push("Opponent roster is empty on the draft board — enter the full draft to analyse this matchup.");
  const first = weekRange(weeks[0]);
  const last = weekRange(weeks[weeks.length - 1]);
  return {
    period: periodNo,
    weeks,
    dates: { start: first.start, end: last.end },
    opponent,
    categories,
    expectedCats: ps.reduce((a, b) => a + b, 0),
    winProb: matchupWinProb(ps),
    lineup,
    daily: days,
    pickups,
    notes,
  };
}

/** Normalise a team name for matching pasted schedules ("Kadıköy UNO’s" ≈ "Kadıköy UNO's"). */
export function teamNameKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[’'`´]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveTeam(name: string, teamNames: string[]): number {
  const k = teamNameKey(name);
  const keys = teamNames.map(teamNameKey);
  let i = keys.indexOf(k);
  if (i >= 0) return i;
  i = keys.findIndex((t) => k.startsWith(t) || t.startsWith(k));
  return i;
}

/** Parse pasted Yahoo schedule rows like "1  logo Kadıköy UNO’s  0 - 0" → opponent names by week. */
export function parseSchedule(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\t/g, " ").trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(?:logo\s+)?(.+?)(?:\s+\d+\s*-\s*\d+)?\s*$/i);
    if (m) out[Number(m[1]) - 1] = m[2].trim();
  }
  return out.map((x) => x ?? "");
}
