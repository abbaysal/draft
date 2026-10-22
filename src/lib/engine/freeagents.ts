/**
 * Free-agent analytics. For every free agent (players on no roster):
 *  - season gain: Δ expected categories won per week vs the league if he replaces your best
 *    drop candidate (rest of season, average week), with the per-category win-probability change;
 *  - fit: how much his strong categories line up with your team's needs;
 *  - schedule: games left this matchup (from today), games next matchup, back-to-backs;
 *  - recent form: value of his last-14-days line (live box scores) vs his projection.
 * The weekly streaming gain comes from the daily lineup planner (lineup.ts) and is merged in by
 * the page, because it depends on the current matchup state.
 */
import type { CategoryKey } from "../types";
import type { AnalysisContext } from "./context";
import { matchupPeriods } from "./lineup";
import { field, objective, teamAgg } from "./trade";
import { recentForm } from "../live/form";

const OUT = new Set(["OUT_SEASON", "OUT_EXTENDED", "OUT_START"]);

export type NeedLabel = "strong" | "swing" | "weak" | "punt";

export interface TeamNeed {
  cat: CategoryKey;
  /** Average P(win category) vs the other teams. */
  pWin: number;
  label: NeedLabel;
  /** Marginal weight: categories near 50% matter most; punted ones barely. */
  weight: number;
}

export interface DropCandidate {
  id: string;
  value: number;
  /** Δ expected cats/week vs the league if swapped for the best free agent (> 0 = upgrade available). */
  lossIfDropped: number;
  replacement: string | null;
  status?: string;
  note: string;
}

export interface FreeAgentRow {
  id: string;
  value: number;
  rank: number;
  catZ: Record<string, number>;
  topCats: CategoryKey[];
  injured: boolean;
  status?: string;
  seasonGain: number;
  seasonDrop: string | null;
  /** Δ P(win) vs the league per category for the season move. */
  catDelta: Record<string, number>;
  fit: number;
  gamesLeftWeek: number;
  gamesNextWeek: number;
  b2bNextWeek: number;
  recent: { games: number; value: number; trend: number } | null;
}

const isOut = (ctx: AnalysisContext, id: string) => OUT.has(ctx.byId.get(id)?.availability?.status ?? "");

/** My category profile vs the league (average week). */
export function teamNeeds(ctx: AnalysisContext, mine = ctx.rosters[ctx.myIndex]): TeamNeed[] {
  const aggs = ctx.rosters.map((r, i) => teamAgg(ctx, i === ctx.myIndex ? mine : r));
  const ev = field(ctx, aggs, ctx.myIndex);
  return ctx.cats.map((c) => {
    const p = ev.perCategory[c];
    const label: NeedLabel = p >= 0.65 ? "strong" : p >= 0.35 ? "swing" : p >= 0.15 ? "weak" : "punt";
    return { cat: c, pWin: p, label, weight: 4 * p * (1 - p) };
  });
}

/**
 * My players ranked from most to least droppable: the net change in expected categories per week
 * if he is swapped for the best of the top free agents (positive = an upgrade is available).
 */
export function dropCandidates(ctx: AnalysisContext, mine = ctx.rosters[ctx.myIndex], faPool?: string[]): DropCandidate[] {
  const aggs = ctx.rosters.map((r, i) => teamAgg(ctx, i === ctx.myIndex ? mine : r));
  const base = objective(ctx, field(ctx, aggs, ctx.myIndex));
  const fas = (faPool ?? ctx.available)
    .filter((id) => !mine.includes(id) && ctx.values.has(id) && !isOut(ctx, id))
    .sort((a, b) => (ctx.values.get(b)?.total ?? -99) - (ctx.values.get(a)?.total ?? -99))
    .slice(0, 8);
  return mine
    .filter((id) => ctx.byId.has(id))
    .map((id) => {
      let best = -Infinity;
      let bestFa: string | null = null;
      for (const fa of fas.length ? fas : [null]) {
        const a = aggs.slice();
        a[ctx.myIndex] = teamAgg(ctx, [...mine.filter((x) => x !== id), ...(fa ? [fa] : [])]);
        const d = objective(ctx, field(ctx, a, ctx.myIndex)) - base;
        if (d > best) {
          best = d;
          bestFa = fa;
        }
      }
      const p = ctx.byId.get(id)!;
      const st = p.availability?.status;
      const note = isOut(ctx, id)
        ? "injured — use an IL slot instead of dropping"
        : best > 0.005
          ? "upgrade available on waivers"
          : best > -0.03
            ? "easy to replace"
            : best > -0.1
              ? "replaceable at a small cost"
              : "core player — keep";
      return { id, value: ctx.values.get(id)?.total ?? -99, lossIfDropped: best, replacement: bestFa, status: st && st !== "HEALTHY" ? st : undefined, note };
    })
    .sort((a, b) => b.lossIfDropped - a.lossIfDropped);
}

function gamesFrom(ctx: AnalysisContext, team: string, weeks: number[], from?: string) {
  return weeks.reduce((a, w) => a + (ctx.schedule.source === "imported" ? ctx.schedule.gameDates(team, w).filter((d) => !from || d >= from).length : ctx.gamesPerWeek(team)), 0);
}

export function scanFreeAgents(
  ctx: AnalysisContext,
  opts: { mine?: string[]; period: number; today: string; limit?: number; drops?: number } ,
): FreeAgentRow[] {
  const mine = opts.mine ?? ctx.rosters[ctx.myIndex];
  const periods = matchupPeriods();
  const thisWeeks = periods[opts.period - 1] ?? [];
  const nextWeeks = periods[opts.period] ?? [];
  const pool = ctx.available.filter((id) => !mine.includes(id) && ctx.values.has(id));
  pool.sort((a, b) => (ctx.values.get(b)?.total ?? -99) - (ctx.values.get(a)?.total ?? -99));
  const top = pool.slice(0, opts.limit ?? 180);

  const aggs = ctx.rosters.map((r, i) => teamAgg(ctx, i === ctx.myIndex ? mine : r));
  const baseEv = field(ctx, aggs, ctx.myIndex);
  const base = objective(ctx, baseEv);
  const needs = new Map(teamNeeds(ctx, mine).map((n) => [n.cat, n]));
  const drops = dropCandidates(ctx, mine)
    .filter((d) => !isOut(ctx, d.id))
    .slice(0, opts.drops ?? 3)
    .map((d) => d.id);
  const form = new Map(recentForm(ctx, top, 2).map((f) => [f.id, f]));

  return top.map((id) => {
    const p = ctx.byId.get(id)!;
    const v = ctx.values.get(id)!;
    let best = { gain: -Infinity, drop: null as string | null, ev: baseEv };
    for (const drop of drops.length ? drops : [null]) {
      const a = aggs.slice();
      a[ctx.myIndex] = teamAgg(ctx, [...mine.filter((x) => x !== drop), id]);
      const ev = field(ctx, a, ctx.myIndex);
      const g = objective(ctx, ev) - base;
      if (g > best.gain) best = { gain: g, drop, ev };
    }
    const catDelta = Object.fromEntries(ctx.cats.map((c) => [c, best.ev.perCategory[c] - baseEv.perCategory[c]]));
    const topCats = [...ctx.cats].sort((a, b) => v.cat[b] - v.cat[a]).filter((c) => v.cat[c] >= 0.75).slice(0, 3);
    const fit = ctx.cats.reduce((a, c) => a + Math.max(0, v.cat[c]) * (needs.get(c)?.weight ?? 0), 0);
    const f = form.get(id);
    const st = p.availability?.status;
    return {
      id,
      value: v.total,
      rank: v.rank,
      catZ: v.cat,
      topCats,
      injured: isOut(ctx, id),
      status: st && st !== "HEALTHY" ? st : undefined,
      seasonGain: best.gain,
      seasonDrop: best.drop,
      catDelta,
      fit,
      gamesLeftWeek: gamesFrom(ctx, p.team, thisWeeks, opts.today),
      gamesNextWeek: gamesFrom(ctx, p.team, nextWeeks),
      b2bNextWeek: ctx.schedule.backToBacks(p.team, nextWeeks),
      recent: f ? { games: f.games, value: f.recentValue, trend: f.trend } : null,
    };
  });
}

/** Next 14 days of a team's games from a date: [{date, opp, home, time}]. */
export function upcomingGames(ctx: AnalysisContext, team: string, from: string, days = 14) {
  const out: { date: string; opp: string; home: boolean; time?: string }[] = [];
  const t0 = Date.parse(from + "T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(t0 + i * 864e5).toISOString().slice(0, 10);
    const g = ctx.schedule.gameOn(team, d);
    if (g) out.push({ date: d, ...g });
  }
  return out;
}
