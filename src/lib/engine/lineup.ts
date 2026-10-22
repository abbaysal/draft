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
  /** Subset of `sit` benched on purpose: their game is expected to cost categories (e.g. FG%/TO). */
  protect?: string[];
  /** Players with a game that day who are unavailable (injured / reported out). */
  out?: string[];
}

/** Category totals already played this matchup (e.g. pasted from Yahoo). */
export interface WeekActual {
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fg3m: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
}

export interface PlanOptions {
  pickups?: boolean;
  overrides?: LineupOverrides;
  /** Plan only games on or after this date (US Eastern YYYY-MM-DD); earlier days are covered by `actual`. */
  fromDate?: string;
  actual?: { me: WeekActual; opp: WeekActual } | null;
  /** Real rosters (e.g. from Yahoo) replacing the draft-board rosters for this matchup. */
  rosters?: { mine?: string[]; opp?: string[] } | null;
  /** Player id → unavailable on these dates ("all" = whole period). */
  unavailable?: Record<string, string[] | "all">;
  /** Bench players whose game is expected to cost categories (default true). */
  protect?: boolean;
  /** Free agents to evaluate for streaming (default: ctx.available) and how many to return (default 8). */
  pickupPool?: string[];
  pickupCount?: number;
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
  pickups: { id: string; score: number; replaces: string | null; gain: number; days?: string[] }[];
  /** Scheduled starts left in the period for each side (daily plan) and whether actual totals were used. */
  remaining: { me: number; opp: number; fromDate: string | null; actualUsed: boolean };
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

/** Game dates of a player in the period, from `fromDate`, excluding dates he is unavailable. */
type DatesOf = (id: string) => string[];

/** Day-by-day start/sit for one roster; returns the plan and started games per player. */
function dailyPlan(ctx: AnalysisContext, ids: string[], datesOf: DatesOf, perGame: Map<string, number>, slots: LineupSlot[], opts: { overrides?: LineupOverrides; protect?: boolean; outOn?: (id: string, d: string) => boolean; teamDates?: (team: string) => string[] } = {}) {
  const dates = new Map<string, string[]>();
  for (const id of ids) for (const d of datesOf(id)) dates.set(d, [...(dates.get(d) ?? []), id]);
  const outDays = new Map<string, string[]>();
  if (opts.outOn && opts.teamDates) {
    for (const id of ids) {
      const team = ctx.byId.get(id)?.team;
      if (!team) continue;
      for (const d of opts.teamDates(team)) if (opts.outOn(id, d)) outDays.set(d, [...(outDays.get(d) ?? []), id]);
    }
  }
  const starts = new Map<string, number>();
  const days: DayPlan[] = [];
  for (const date of [...new Set([...dates.keys(), ...outDays.keys()])].sort()) {
    const o = opts.overrides?.[date] ?? {};
    const rank = (id: string) => (o[id] === "start" ? 1e6 : 0) + (perGame.get(id) ?? 0);
    const playing = (dates.get(date) ?? []).sort((a, b) => rank(b) - rank(a));
    // Protect: a game with negative expected impact (hurts FG%/FT%/TO more than it adds) is benched.
    const protect = opts.protect ? playing.filter((id) => o[id] !== "start" && (perGame.get(id) ?? 0) < 0) : [];
    const starters = fillSlots(ctx, slots, playing.filter((id) => o[id] !== "sit" && !protect.includes(id)));
    const on = new Set(starters.map((s) => s.id));
    for (const s of starters) starts.set(s.id, (starts.get(s.id) ?? 0) + 1);
    days.push({ date, starters, sit: playing.filter((id) => !on.has(id)), protect, out: outDays.get(date) ?? [] });
  }
  return { days, starts };
}

function addActual(agg: Agg, a: WeekActual | undefined): Agg {
  if (!a) return agg;
  const vals: Record<string, number> = { pts: a.pts, fg3m: a.fg3m, reb: a.reb, ast: a.ast, stl: a.stl, blk: a.blk, tov: a.tov };
  COUNTING_KEYS.forEach((k, c) => (agg[c * 3] += vals[k] ?? 0));
  agg[PCT_INDEX.fgPct] += a.fgm;
  agg[PCT_INDEX.fgPct + 1] += a.fga;
  agg[PCT_INDEX.ftPct] += a.ftm;
  agg[PCT_INDEX.ftPct + 1] += a.fta;
  return agg;
}

export function planWeek(ctx: AnalysisContext, period: number | number[], opponent: number, opts: PlanOptions = {}): WeekPlan {
  const periods = matchupPeriods();
  const weeks = Array.isArray(period) ? period : (periods[period - 1] ?? [period]);
  const periodNo = Array.isArray(period) ? periods.findIndex((p) => p[0] === period[0]) + 1 : period;
  const notes: string[] = [];
  const real = ctx.schedule.source === "imported";
  const daily = real && ctx.settings.lineupMode === "daily";
  const slots = startingSlots(ctx.settings);
  const from = opts.fromDate ?? null;
  const first = weekRange(weeks[0]);
  const last = weekRange(weeks[weeks.length - 1]);
  const effFrom = from && from > first.start ? from : null;

  // Team game dates in this period (from `fromDate`).
  const teamDates = new Map<string, string[]>();
  const datesOfTeam = (team: string) => {
    let d = teamDates.get(team);
    if (!d) {
      d = weeks.flatMap((w) => ctx.schedule.gameDates(team, w)).filter((x) => !effFrom || x >= effFrom);
      teamDates.set(team, d);
    }
    return d;
  };
  const unavailable = opts.unavailable ?? {};
  const outOn = (id: string, d: string) => {
    const u = unavailable[id];
    return u === "all" || (Array.isArray(u) && u.includes(d));
  };
  const datesOf: DatesOf = (id) => datesOfTeam(ctx.byId.get(id)!.team).filter((d) => !outOn(id, d));
  // Remaining fraction of the period for the uniform (no schedule) model.
  const totalDays = weeks.reduce((a, w) => a + weekRange(w).days, 0);
  const leftDays = effFrom ? Math.max(0, (Date.parse(last.end) - Date.parse(effFrom)) / 864e5 + 1) : totalDays;
  const games = (id: string, team: string) => (real ? datesOf(id).length : periodGames(ctx, team, weeks) * (leftDays / totalDays) * (unavailable[id] === "all" ? 0 : 1));

  const injuredOf = (ids: string[]) => ids.filter((id) => OUT.has(ctx.byId.get(id)?.availability?.status ?? "") || unavailable[id] === "all").slice(0, ctx.settings.slots.IL);
  const mine = (opts.rosters?.mine ?? ctx.rosters[ctx.myIndex]).filter((id) => ctx.byId.has(id));
  const theirs = (opts.rosters?.opp ?? ctx.rosters[opponent] ?? []).filter((id) => ctx.byId.has(id));
  const injured = injuredOf(mine);
  const active = mine.filter((id) => !injured.includes(id));
  const oppInjured = injuredOf(theirs);
  const oppActive = theirs.filter((id) => !oppInjured.includes(id));

  // Preliminary projection (default usage) plus games already played → category gradients.
  const opp0 = addActual(rosterAgg(ctx, oppActive, games, usageFor(ctx, oppActive)), opts.actual?.opp);
  const me0 = addActual(rosterAgg(ctx, active, games, usageFor(ctx, active)), opts.actual?.me);
  const grad: Record<string, number> = {};
  for (const c of ctx.cats) grad[c] = catWinGradient(me0, opp0, c);

  const scored = active
    .map((id) => {
      const p = ctx.byId.get(id)!;
      return { id, score: matchupScore(ctx, id, games(id, p.team), me0, grad), perGame: matchupScore(ctx, id, 1, me0, grad) };
    })
    .sort((a, b) => b.score - a.score);
  const perGame = new Map(scored.map((s) => [s.id, s.perGame]));

  // Base (weekly) lineup: best feasible starters for the whole period.
  const base = fillSlots(ctx, slots, scored.map((s) => s.id));
  const baseIds = new Set(base.map((b) => b.id));
  const scoreOf = new Map(scored.map((s) => [s.id, s.score]));

  let me: Agg;
  let opp: Agg;
  let days: DayPlan[] = [];
  let starts = new Map<string, number>();
  let oppStarts = 0;
  const protect = opts.protect !== false;
  if (daily) {
    const mp = dailyPlan(ctx, active, datesOf, perGame, slots, { overrides: opts.overrides, protect, outOn, teamDates: datesOfTeam });
    days = mp.days;
    starts = mp.starts;
    // Opponent starts whoever hurts us most each day (their best players for this matchup).
    const oppPer = new Map(oppActive.map((id) => [id, matchupScore(ctx, id, 1, opp0, grad, -1)]));
    const op = dailyPlan(ctx, oppActive, datesOf, oppPer, slots);
    oppStarts = [...op.starts.values()].reduce((a, b) => a + b, 0);
    me = addActual(rosterAgg(ctx, active, (id) => mp.starts.get(id) ?? 0), opts.actual?.me);
    opp = addActual(rosterAgg(ctx, oppActive, (id) => op.starts.get(id) ?? 0), opts.actual?.opp);
  } else {
    const bench = ctx.settings.lineupMode === "daily" ? ctx.settings.benchUtilization : 0;
    me = addActual(rosterAgg(ctx, active, games, active.map((id) => (baseIds.has(id) ? 1 : bench))), opts.actual?.me);
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
  const lost = days.reduce((a, d) => a + d.sit.filter((id) => opts.overrides?.[d.date]?.[id] !== "sit" && !d.protect?.includes(id)).length, 0);
  if (lost > 0) notes.push(`${lost} player-game(s) this period don't fit in a starting slot (crowded days) — consider streaming a player whose games fall on light days.`);
  const protectedGames = days.reduce((a, d) => a + (d.protect?.length ?? 0), 0);
  if (protectedGames > 0) notes.push(`${protectedGames} game(s) benched on purpose: those players are expected to cost more in FG%/FT%/TO than they add in this matchup.`);

  const ps = catProbs(me, opp, ctx.cats);
  const categories: CategoryLine[] = ctx.cats.map((c, i) => ({ cat: c, mine: catDist(me, c).mean, theirs: catDist(opp, c).mean, pWin: ps[i], swing: ps[i] > 0.3 && ps[i] < 0.7 }));

  // Pickups: schedule-aware streaming. A free agent's value = extra expected categories from the
  // games he would actually START on the remaining days (open slots or beating a starter), net of
  // the dropped player's lost starts.
  let pickups: WeekPlan["pickups"] = [];
  if (opts.pickups !== false) {
    const startValue = (ids: string[], pg: Map<string, number>) => {
      if (!daily) return ids.reduce((a, id) => a + (pg.get(id) ?? 0) * games(id, ctx.byId.get(id)!.team), 0);
      const r = dailyPlan(ctx, ids, datesOf, pg, slots, { protect });
      let v = 0;
      for (const d of r.days) for (const s of d.starters) v += pg.get(s.id) ?? 0;
      return v;
    };
    const baseValue = startValue(active, perGame);
    const drops = [...active].sort((a, b) => (ctx.values.get(a)?.total ?? -99) - (ctx.values.get(b)?.total ?? -99)).slice(0, 2);
    pickups = (opts.pickupPool ?? ctx.available)
      .filter((id) => ctx.lines.has(id) && !OUT.has(ctx.byId.get(id)?.availability?.status ?? "") && !mine.includes(id) && !theirs.includes(id))
      .slice(0, Math.max(120, opts.pickupCount ?? 0))
      .map((id) => {
        const pg = new Map(perGame);
        pg.set(id, matchupScore(ctx, id, 1, me0, grad));
        let best = { gain: -Infinity, drop: null as string | null };
        for (const drop of drops) {
          const g = startValue([...active.filter((x) => x !== drop), id], pg) - baseValue;
          if (g > best.gain) best = { gain: g, drop };
        }
        const days = datesOf(id);
        return { id, score: best.gain, replaces: best.drop, gain: best.gain, days };
      })
      .filter((p) => Number.isFinite(p.gain))
      .sort((a, b) => b.gain - a.gain)
      .slice(0, opts.pickupCount ?? 8);
  }

  if (!real) notes.push("No NBA schedule loaded — games per player are a uniform estimate; daily start/sit cannot use real game days.");
  if (theirs.length === 0) notes.push("Opponent roster is empty — enter the full draft or paste the Yahoo matchup to analyse this matchup.");
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
    remaining: { me: [...starts.values()].reduce((a, b) => a + b, 0), opp: oppStarts, fromDate: effFrom, actualUsed: !!opts.actual },
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
