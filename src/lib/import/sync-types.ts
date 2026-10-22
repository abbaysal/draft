import type { WeekActual } from "../engine/lineup";
import type { YahooPaste } from "./yahoo-paste";

/** A Yahoo matchup snapshot pasted by the manager (per draft session, this browser). */
export interface MatchupSync {
  syncedAt: string;
  /** Eastern date the snapshot was taken (games before this date are in `actual`). */
  asOf: string;
  week: number;
  /** League team index of the opponent this week, when known. */
  oppIndex?: number;
  mine: string[];
  opp: string[];
  status: Record<string, string>;
  slots: Record<string, string>;
  actual: { me: WeekActual; opp: WeekActual } | null;
  games?: YahooPaste["games"];
}

/** All league rosters pasted from Yahoo (League → Rosters). */
export interface LeagueSync {
  syncedAt: string;
  /** Roster per league team index (null = not provided). */
  teams: (string[] | null)[];
  /** Every rostered player found, including groups not mapped to a team. */
  rostered: string[];
}

export interface SessionSyncs {
  matchup?: MatchupSync | null;
  league?: LeagueSync | null;
}
