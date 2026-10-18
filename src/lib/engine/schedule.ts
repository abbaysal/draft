/**
 * NBA schedule model. The official 2026-27 schedule (opening night Tue Oct 20 2026,
 * final day Sun Apr 11 2027 — NBA.com / pr.nba.com) is published as PDFs on hosts
 * this project could not access, so it must be IMPORTED as CSV (date,home,away).
 * Until then a clearly-labelled UNIFORM model spreads 82 games evenly over the
 * season's days. Uniform mode cannot distinguish playoff-week schedules between
 * teams; the UI says so.
 */
export interface ScheduleGame {
  date: string; // YYYY-MM-DD (US Eastern date)
  home: string;
  away: string;
}

export const SEASON_START = "2026-10-20";
export const SEASON_END = "2027-04-11";
const DAY = 864e5;

function utc(d: string): number {
  return Date.parse(d + "T00:00:00Z");
}

const START = utc(SEASON_START);
const END = utc(SEASON_END);
export const SEASON_DAYS = Math.round((END - START) / DAY) + 1;
/** First Monday after opening night; week 1 runs opening night → the following Sunday. */
const FIRST_MONDAY = START + ((8 - new Date(START).getUTCDay()) % 7) * DAY;

export function fantasyWeek(date: string): number {
  const t = utc(date);
  if (t < FIRST_MONDAY) return 1;
  return 2 + Math.floor((t - FIRST_MONDAY) / (7 * DAY));
}

export const TOTAL_WEEKS = fantasyWeek(SEASON_END);

export function weekRange(week: number): { start: string; end: string; days: number } {
  const startT = week === 1 ? START : FIRST_MONDAY + (week - 2) * 7 * DAY;
  const endT = Math.min(END, week === 1 ? FIRST_MONDAY - DAY : startT + 6 * DAY);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { start: iso(startT), end: iso(endT), days: Math.round((endT - startT) / DAY) + 1 };
}

export interface ScheduleModel {
  source: "imported" | "uniform";
  label: string;
  gameCount: number;
  gamesInWeek(team: string, week: number): number;
  /** Average games per week over a set of weeks (default: regular season). */
  avgGames(team: string, weeks: number[]): number;
  backToBacks(team: string, weeks: number[]): number;
  /** Number of NBA games on each date of a week (lineup congestion indicator). */
  dailyGameCounts(week: number): { date: string; games: number }[];
  teams(): string[];
}

export function buildScheduleModel(games: ScheduleGame[] | null | undefined): ScheduleModel {
  if (!games || games.length === 0) return uniformSchedule();
  const byTeamWeek = new Map<string, number>();
  const datesByTeam = new Map<string, string[]>();
  const byDate = new Map<string, number>();
  const teams = new Set<string>();
  for (const g of games) {
    const w = fantasyWeek(g.date);
    for (const t of [g.home, g.away]) {
      teams.add(t);
      byTeamWeek.set(`${t}|${w}`, (byTeamWeek.get(`${t}|${w}`) ?? 0) + 1);
      const arr = datesByTeam.get(t) ?? [];
      arr.push(g.date);
      datesByTeam.set(t, arr);
    }
    byDate.set(g.date, (byDate.get(g.date) ?? 0) + 1);
  }
  for (const arr of datesByTeam.values()) arr.sort();
  const model: ScheduleModel = {
    source: "imported",
    label: `Imported schedule (${games.length} games)`,
    gameCount: games.length,
    gamesInWeek: (team, week) => byTeamWeek.get(`${team}|${week}`) ?? 0,
    avgGames: (team, weeks) => (weeks.length ? weeks.reduce((a, w) => a + model.gamesInWeek(team, w), 0) / weeks.length : 0),
    backToBacks: (team, weeks) => {
      const set = new Set(weeks);
      const ds = datesByTeam.get(team) ?? [];
      let n = 0;
      for (let i = 1; i < ds.length; i++)
        if (utc(ds[i]) - utc(ds[i - 1]) === DAY && set.has(fantasyWeek(ds[i]))) n++;
      return n;
    },
    dailyGameCounts: (week) => {
      const r = weekRange(week);
      const out: { date: string; games: number }[] = [];
      for (let t = utc(r.start); t <= utc(r.end); t += DAY) {
        const d = new Date(t).toISOString().slice(0, 10);
        out.push({ date: d, games: byDate.get(d) ?? 0 });
      }
      return out;
    },
    teams: () => [...teams].sort(),
  };
  return model;
}

const WEEK_DAYS = Array.from({ length: TOTAL_WEEKS + 1 }, (_, w) => (w === 0 ? 0 : weekRange(w).days));

export function uniformSchedule(): ScheduleModel {
  const perDay = 82 / SEASON_DAYS;
  const days = (w: number) => (w >= 1 && w <= TOTAL_WEEKS ? WEEK_DAYS[w] : 0);
  const model: ScheduleModel = {
    source: "uniform",
    label: "Uniform estimate — no schedule imported (82 games spread evenly)",
    gameCount: 0,
    gamesInWeek: (_team, week) => days(week) * perDay,
    avgGames: (_t, weeks) => (weeks.length ? weeks.reduce((a, w) => a + days(w) * perDay, 0) / weeks.length : 7 * perDay),
    backToBacks: () => 0,
    dailyGameCounts: (week) => {
      const r = weekRange(week);
      const out: { date: string; games: number }[] = [];
      for (let t = utc(r.start); t <= utc(r.end); t += DAY) out.push({ date: new Date(t).toISOString().slice(0, 10), games: 15 * perDay });
      return out;
    },
    teams: () => [],
  };
  return model;
}

export function regularSeasonWeeks(n: number): number[] {
  return Array.from({ length: Math.min(n, TOTAL_WEEKS) }, (_, i) => i + 1);
}
