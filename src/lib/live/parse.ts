/**
 * Parsers for the public in-season feeds used by /api/live:
 *  - NBA.com CDN league schedule (scheduleLeagueV2.json)
 *  - NBA.com CDN box scores (liveData/boxscore/boxscore_<gameId>.json)
 *  - ESPN public NBA injury report (site.api.espn.com …/injuries)
 * Every field is read defensively: an unexpected shape yields fewer rows plus a
 * warning, never fabricated numbers.
 */
import type { StatLine } from "../types";
import type { ScheduleGame } from "../engine/schedule";

export interface LiveGame extends ScheduleGame {
  gameId: string;
  /** 1 = scheduled, 2 = live, 3 = final. */
  status: number;
}

export interface LiveGameLine extends Omit<StatLine, "min"> {
  min: number;
}

export interface LivePlayerStats {
  nbaId: number;
  name: string;
  team: string;
  gp: number;
  tot: LiveGameLine;
  /** Totals over the most recent window (default 14 days) ending at the latest final game. */
  recent: { gp: number; tot: LiveGameLine; from: string };
  lastGame?: string;
}

export interface LiveInjury {
  espnId?: number;
  name: string;
  team?: string;
  /** Raw status text ("Out", "Day-To-Day", …). */
  status: string;
  comment?: string;
  returnDate?: string;
  date?: string;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const ZERO_LINE: LiveGameLine = { min: 0, pts: 0, fg3m: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 };

/** "PT34M12.00S" → 34.2 minutes; plain numbers / "34:12" also accepted. */
export function parseMinutes(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "");
  const iso = s.match(/^PT(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (iso) return num(iso[1]) + num(iso[2]) / 60;
  const mmss = s.match(/^(\d+):(\d+)$/);
  if (mmss) return num(mmss[1]) + num(mmss[2]) / 60;
  return num(s);
}

/** Regular-season games (gameId 002…) from scheduleLeagueV2.json. */
export function parseNbaSchedule(json: unknown): LiveGame[] {
  const ls = obj(obj(json).leagueSchedule);
  const out: LiveGame[] = [];
  for (const day of arr(ls.gameDates)) {
    for (const g of arr(obj(day).games)) {
      const o = obj(g);
      const gameId = String(o.gameId ?? "");
      if (!gameId.startsWith("002")) continue;
      const dateRaw = String(o.gameDateEst ?? o.gameDate ?? "");
      const m = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})/) ?? dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (!m) continue;
      const date = m[0].includes("/") ? `${m[3]}-${m[1]}-${m[2]}` : m[0];
      const home = String(obj(o.homeTeam).teamTricode ?? "");
      const away = String(obj(o.awayTeam).teamTricode ?? "");
      if (!home || !away) continue;
      out.push({ gameId, date, home, away, status: num(o.gameStatus) });
    }
  }
  return out;
}

/** Player lines of a final box score (players with minutes > 0). */
export function parseNbaBoxscore(json: unknown): { team: string; nbaId: number; name: string; line: LiveGameLine }[] {
  const game = obj(obj(json).game);
  const out: { team: string; nbaId: number; name: string; line: LiveGameLine }[] = [];
  for (const side of [game.homeTeam, game.awayTeam]) {
    const t = obj(side);
    const team = String(t.teamTricode ?? "");
    for (const p of arr(t.players)) {
      const o = obj(p);
      const s = obj(o.statistics);
      const min = parseMinutes(s.minutes ?? s.minutesCalculated);
      if (!(min > 0)) continue;
      out.push({
        team,
        nbaId: num(o.personId),
        name: String(o.name ?? `${o.firstName ?? ""} ${o.familyName ?? ""}`).trim(),
        line: {
          min,
          pts: num(s.points),
          fg3m: num(s.threePointersMade),
          reb: num(s.reboundsTotal),
          ast: num(s.assists),
          stl: num(s.steals),
          blk: num(s.blocks),
          tov: num(s.turnovers),
          fgm: num(s.fieldGoalsMade),
          fga: num(s.fieldGoalsAttempted),
          ftm: num(s.freeThrowsMade),
          fta: num(s.freeThrowsAttempted),
        },
      });
    }
  }
  return out;
}

export function addLine(a: LiveGameLine, b: LiveGameLine): LiveGameLine {
  const o = { ...a };
  for (const k of Object.keys(ZERO_LINE) as (keyof LiveGameLine)[]) o[k] = a[k] + b[k];
  return o;
}

const DAY = 864e5;

/** Aggregate final box scores into season totals and a recent-form window per player. */
export function aggregateBoxscores(games: { date: string; lines: ReturnType<typeof parseNbaBoxscore> }[], recentDays = 14): LivePlayerStats[] {
  const latest = games.reduce((m, g) => (g.date > m ? g.date : m), "");
  const from = latest ? new Date(Date.parse(latest + "T00:00:00Z") - (recentDays - 1) * DAY).toISOString().slice(0, 10) : "";
  const by = new Map<number, LivePlayerStats>();
  for (const g of [...games].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const l of g.lines) {
      if (!l.nbaId) continue;
      let p = by.get(l.nbaId);
      if (!p) {
        p = { nbaId: l.nbaId, name: l.name, team: l.team, gp: 0, tot: { ...ZERO_LINE }, recent: { gp: 0, tot: { ...ZERO_LINE }, from } };
        by.set(l.nbaId, p);
      }
      p.gp++;
      p.tot = addLine(p.tot, l.line);
      p.team = l.team;
      p.lastGame = g.date;
      if (g.date >= from) {
        p.recent.gp++;
        p.recent.tot = addLine(p.recent.tot, l.line);
      }
    }
  }
  return [...by.values()];
}

/** ESPN injury report: { injuries: [{ displayName: team, injuries: [{ athlete, status, … }] }] }. */
export function parseEspnInjuries(json: unknown): LiveInjury[] {
  const out: LiveInjury[] = [];
  for (const team of arr(obj(json).injuries)) {
    const t = obj(team);
    for (const inj of arr(t.injuries)) {
      const o = obj(inj);
      const a = obj(o.athlete);
      const name = String(a.displayName ?? a.fullName ?? "").trim();
      if (!name) continue;
      let espnId = num(a.id);
      if (!espnId) {
        for (const l of arr(a.links)) {
          const m = String(obj(l).href ?? "").match(/\/id\/(\d+)/);
          if (m) {
            espnId = Number(m[1]);
            break;
          }
        }
      }
      const details = obj(o.details);
      const type = obj(o.type);
      out.push({
        espnId: espnId || undefined,
        name,
        team: String(obj(a.team).abbreviation ?? t.abbreviation ?? t.displayName ?? "") || undefined,
        status: String(o.status ?? type.description ?? obj(details.fantasyStatus).description ?? "Unknown"),
        comment: String(o.shortComment ?? o.longComment ?? "") || undefined,
        returnDate: String(details.returnDate ?? "").slice(0, 10) || undefined,
        date: String(o.date ?? "").slice(0, 10) || undefined,
      });
    }
  }
  return out;
}
