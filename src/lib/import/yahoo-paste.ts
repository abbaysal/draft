/**
 * Parser for text copied from Yahoo Fantasy pages (select all → copy → paste). Works with:
 *  - the Matchup page: both rosters (left = the page owner's team), current Yahoo slots,
 *    NBA team + positions, injury flags, week number, category totals and games played;
 *  - the My Team page: a single roster.
 * The Yahoo API needs app approval (it returned 403 for this league), so this is the sync path.
 * Players are matched to the database by name; anything unmatched is reported, never guessed.
 */
import { nameKey } from "../names";
import type { Player, SlotPos } from "../types";
import type { WeekActual } from "../engine/lineup";
import { resolveTeam } from "../engine/lineup";

export interface YahooRosterEntry {
  playerId: string;
  name: string;
  team?: string;
  positions?: SlotPos[];
  /** Yahoo status flag: O (out), GTD, DTD, INJ, SUSP, NA … */
  status?: string;
  /** Yahoo lineup slot as shown on the page (PG … Util, BN, IL). */
  slot?: string;
}

export interface YahooTeamTotals extends WeekActual {
  score?: number;
}

export interface YahooPaste {
  kind: "matchup" | "roster";
  week?: number;
  left: YahooRosterEntry[];
  right: YahooRosterEntry[];
  totals: YahooTeamTotals[];
  games?: { leftPlayed: number; leftTotal: number; rightPlayed: number; rightTotal: number };
  unmatched: string[];
}

const SLOTS = new Set(["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "BN", "IL", "IL+"]);
const STATUS = new Set(["O", "GTD", "DTD", "INJ", "SUSP", "NA", "OUT", "IL"]);
const TEAM_POS = /^([A-Z]{2,4})\s*[-–]\s*((?:PG|SG|SF|PF|C|G|F)(?:\s*,\s*(?:PG|SG|SF|PF|C|G|F))*)$/;
const NUM = String.raw`(-?\d+)`;
const PCT = String.raw`(?:-|\.?\d+(?:\.\d+)?)`;
const TOTALS = new RegExp(String.raw`(\d+)\s*/\s*(\d+)\s+${PCT}\s+(\d+)\s*/\s*(\d+)\s+${PCT}\s+${NUM}\s+${NUM}\s+${NUM}\s+${NUM}\s+${NUM}\s+${NUM}\s+${NUM}(?:\s+(\d+(?:\.\d+)?))?`, "g");

function toSlots(pos: string): SlotPos[] {
  return pos
    .split(",")
    .map((x) => x.trim())
    .filter((x): x is SlotPos => ["PG", "SG", "SF", "PF", "C"].includes(x));
}

export function parseYahooPaste(text: string, players: Player[]): YahooPaste {
  const byName = new Map<string, Player>();
  for (const p of players) if (p.proj || p.id.startsWith("rookie")) byName.set(nameKey(p.name), p);
  for (const p of players) if (!byName.has(nameKey(p.name))) byName.set(nameKey(p.name), p);

  const totals: YahooTeamTotals[] = [];
  for (const m of text.matchAll(TOTALS)) {
    const n = m.slice(1).map((x) => (x == null ? undefined : Number(x)));
    totals.push({ fgm: n[0]!, fga: n[1]!, ftm: n[2]!, fta: n[3]!, fg3m: n[4]!, pts: n[5]!, reb: n[6]!, ast: n[7]!, stl: n[8]!, blk: n[9]!, tov: n[10]!, score: n[11] });
    if (totals.length === 2) break;
  }
  const gm = text.match(/(\d+)\s*\/\s*(\d+)\s*Games Played\s*(\d+)\s*\/\s*(\d+)/i);
  const games = gm ? { leftPlayed: +gm[1], leftTotal: +gm[2], rightPlayed: +gm[3], rightTotal: +gm[4] } : undefined;
  const wk = text.match(/\bWeek\s+(\d{1,2})\b/i);
  const kind: YahooPaste["kind"] = totals.length >= 2 || games ? "matchup" : "roster";

  // Cells: lines, further split on tabs.
  const cells = text
    .split(/\r?\n/)
    .flatMap((l) => l.split("\t"))
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const left: YahooRosterEntry[] = [];
  const right: YahooRosterEntry[] = [];
  const unmatched: string[] = [];
  let side: "L" | "R" = "L";
  let pendingSlot: string | undefined;
  let last: YahooRosterEntry | null = null;
  const seen = new Set<string>();

  const matchName = (cell: string): { p: Player; status?: string } | null => {
    if (cell.length < 4 || cell.length > 60 || /\d{2}/.test(cell)) return null;
    const direct = byName.get(nameKey(cell));
    if (direct) return { p: direct };
    // "Kon Knueppel O" / "Brandon Ingram GTD": trailing status flag.
    const m = cell.match(/^(.*\S)\s+([A-Z]{1,4})$/);
    if (m && STATUS.has(m[2])) {
      const p = byName.get(nameKey(m[1]));
      if (p) return { p, status: m[2] };
    }
    return null;
  };

  for (const cell of cells) {
    const up = cell.toUpperCase();
    if (SLOTS.has(up) && cell.length <= 4) {
      if (kind === "matchup") {
        if (last && side === "L" && !last.slot) last.slot = up;
        side = "R";
        pendingSlot = up;
      } else pendingSlot = up;
      continue;
    }
    const tp = cell.match(TEAM_POS);
    if (tp && last) {
      last.team = tp[1] === "PHO" ? "PHX" : tp[1] === "GS" ? "GSW" : tp[1] === "NO" ? "NOP" : tp[1] === "NY" ? "NYK" : tp[1] === "SA" ? "SAS" : tp[1];
      last.positions = toSlots(tp[2]);
      continue;
    }
    if (last && STATUS.has(cell) && !last.status) {
      last.status = cell;
      continue;
    }
    const hit = matchName(cell);
    if (!hit) {
      // A name-like cell directly followed by a TEAM - POS cell is reported as unmatched later.
      continue;
    }
    if (seen.has(hit.p.id)) continue;
    seen.add(hit.p.id);
    const entry: YahooRosterEntry = { playerId: hit.p.id, name: hit.p.name, status: hit.status };
    if (kind === "matchup") {
      if (side === "R") {
        entry.slot = pendingSlot;
        right.push(entry);
        side = "L";
        pendingSlot = undefined;
      } else left.push(entry);
    } else {
      entry.slot = pendingSlot;
      pendingSlot = undefined;
      left.push(entry);
    }
    last = entry;
  }

  // Unmatched: "Name" cells followed by a TEAM - POS cell that did not attach to a matched player.
  for (let i = 0; i + 1 < cells.length; i++) {
    if (TEAM_POS.test(cells[i + 1]) && !matchName(cells[i]) && /^[A-Z][\p{L}.'’ -]+$/u.test(cells[i]) && cells[i].includes(" ")) unmatched.push(cells[i]);
  }

  return { kind, week: wk ? Number(wk[1]) : undefined, left, right, totals, games, unmatched };
}

/** Yahoo flags that mean the player will not play (today). */
export function isOutFlag(status?: string): boolean {
  return status === "O" || status === "OUT" || status === "INJ" || status === "SUSP" || status === "IL";
}

export interface LeagueRosterGroup {
  /** League team index the group was matched to (-1 = unknown; the user maps it). */
  teamIndex: number;
  /** Text seen just before the roster (usually the Yahoo team name). */
  label: string;
  players: string[];
}

const HEADER = new Set(["PLAYER", "PLAYERS", "POS", "POSITION"]);
const LABEL_STOP = new Set(["STATUS", "OPP", "OPPONENT", "ROSTERS", "LEAGUE ROSTERS", "STARTERS", "BENCH", "EDIT", "ACTION", "GAME", "MATCHUP", "FANTASY BASKETBALL"]);

/**
 * Yahoo League → Rosters page (or several team pages pasted together): every rostered player,
 * grouped by roster table. A group starts at a table header ("Pos"/"Player") or a team name;
 * its team is the league team whose name matches the text before it.
 */
export function parseLeagueRosters(text: string, players: Player[], teamNames: string[]): { groups: LeagueRosterGroup[]; rostered: string[]; unmatched: string[] } {
  const byName = new Map<string, Player>();
  for (const p of players) byName.set(nameKey(p.name), p);
  const cells = text
    .split(/\r?\n/)
    .flatMap((l) => l.split("\t"))
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const groups: LeagueRosterGroup[] = [];
  const seen = new Set<string>();
  let current: LeagueRosterGroup | null = null;
  let boundary = true;
  let pendingTeam = -1;
  let pendingLabel = "";
  let labelLocked = false;
  const playerOf = (cell: string): Player | null => {
    if (cell.length < 4 || cell.length > 60 || /\d{2}/.test(cell)) return null;
    const direct = byName.get(nameKey(cell));
    if (direct) return direct;
    const m = cell.match(/^(.*\S)\s+([A-Z]{1,4})$/);
    return m && STATUS.has(m[2]) ? (byName.get(nameKey(m[1])) ?? null) : null;
  };
  for (const cell of cells) {
    if (HEADER.has(cell.toUpperCase())) {
      boundary = true;
      continue;
    }
    const p = playerOf(cell);
    if (p) {
      if (boundary || !current) {
        current = { teamIndex: pendingTeam, label: pendingLabel, players: [] };
        groups.push(current);
        boundary = false;
        pendingTeam = -1;
        pendingLabel = "";
        labelLocked = false;
      }
      if (!seen.has(p.id)) {
        seen.add(p.id);
        current.players.push(p.id);
      }
      continue;
    }
    if (TEAM_POS.test(cell) || STATUS.has(cell) || SLOTS.has(cell.toUpperCase()) || /\d/.test(cell) || cell.length < 3 || cell.length > 45) continue;
    // A league team name starts a new roster; other text becomes the label of the next group.
    const t = cell.length >= 5 ? resolveTeam(cell, teamNames) : -1;
    if (t >= 0) {
      pendingTeam = t;
      pendingLabel = cell;
      labelLocked = true;
      boundary = true;
    } else if (!labelLocked && !LABEL_STOP.has(cell.toUpperCase())) {
      // First text after a roster ends is usually the next team's name.
      pendingLabel = cell;
      labelLocked = true;
    }
  }
  const unmatched: string[] = [];
  for (let i = 0; i + 1 < cells.length; i++) {
    if (TEAM_POS.test(cells[i + 1]) && !playerOf(cells[i]) && /^[A-Z][\p{L}.'’ -]+$/u.test(cells[i]) && cells[i].includes(" ")) unmatched.push(cells[i]);
  }
  return { groups: groups.filter((g) => g.players.length > 0), rostered: [...seen], unmatched };
}
