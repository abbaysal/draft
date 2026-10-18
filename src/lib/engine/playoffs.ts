/**
 * Fantasy playoff schedule analytics. Nominal scheduled games are shown separately
 * from EXPECTED counted games (scheduled × P(available) × lineup usage). A back-to-back
 * is reported as a congestion indicator only — we do not assume rest.
 */
import type { AnalysisContext } from "./context";

export interface PlayoffRow {
  id: string;
  team: string;
  regAvgGames: number;
  playoffGames: number[]; // nominal scheduled games per playoff week
  playoffTotal: number;
  expectedCounted: number;
  backToBacks: number;
  /** Per-game value × (playoff games / regular-season games per week ratio). */
  playoffAdjValue: number;
  regValue: number;
}

export function playoffTable(ctx: AnalysisContext, ids: string[]): PlayoffRow[] {
  const weeks = ctx.settings.playoffWeeks;
  return ids
    .filter((id) => ctx.lines.has(id))
    .map((id) => {
      const p = ctx.byId.get(id)!;
      const reg = ctx.schedule.avgGames(p.team, ctx.regWeeks) || 3.3;
      const games = weeks.map((w) => ctx.schedule.gamesInWeek(p.team, w));
      const total = games.reduce((a, b) => a + b, 0);
      const avail = Math.min(1, (p.proj?.gp ?? 0) / 82);
      const v = ctx.values.get(id)?.total ?? 0;
      return {
        id,
        team: p.team,
        regAvgGames: reg,
        playoffGames: games,
        playoffTotal: total,
        expectedCounted: total * avail,
        backToBacks: ctx.schedule.backToBacks(p.team, weeks),
        regValue: v,
        playoffAdjValue: weeks.length ? v * (total / (reg * weeks.length)) : v,
      };
    });
}

export function teamPlayoffGames(ctx: AnalysisContext): { team: string; games: number[]; total: number; b2b: number }[] {
  const teams = ctx.schedule.teams();
  const list = teams.length ? teams : [...new Set(ctx.players.map((p) => p.team))].sort();
  return list.map((team) => {
    const games = ctx.settings.playoffWeeks.map((w) => ctx.schedule.gamesInWeek(team, w));
    return { team, games, total: games.reduce((a, b) => a + b, 0), b2b: ctx.schedule.backToBacks(team, ctx.settings.playoffWeeks) };
  });
}
