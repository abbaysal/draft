/**
 * CSV import system: projections, ADP, historical stats, NBA schedule, player
 * metadata. Headers are matched case-insensitively against alias lists so exports
 * from common tools (Hashtag Basketball, Basketball Monster, spreadsheet templates)
 * work without manual renaming. Every row is validated; problems are reported
 * per row and NEVER silently replaced with invented values.
 */
import Papa from "papaparse";
import { nameKey } from "../names";
import type { Player, SlotPos } from "../types";

export type ImportKind = "projections" | "adp" | "history" | "schedule" | "metadata";

export interface ImportIssue {
  row: number; // 1-based data row
  level: "error" | "warning";
  message: string;
}

export interface ImportResult<T> {
  kind: ImportKind;
  rows: T[];
  issues: ImportIssue[];
  unmatched: string[];
  columns: Record<string, string | null>; // canonical field -> source header used
  totalRows: number;
}

const ALIASES: Record<string, string[]> = {
  name: ["name", "player", "player name", "player_name", "playername", "full name"],
  team: ["team", "tm", "nba team", "team_abbr"],
  nbaId: ["nba_id", "nbaid", "player_id", "nba person id", "personid"],
  gp: ["gp", "g", "games", "games played", "proj gp"],
  min: ["min", "mpg", "minutes", "m/g", "mp"],
  pts: ["pts", "points", "p", "ppg"],
  fg3m: ["3pm", "3ptm", "tpm", "fg3m", "3p", "threes", "3-pt made", "3pt"],
  reb: ["reb", "rebounds", "r", "trb", "rpg"],
  ast: ["ast", "assists", "a", "apg"],
  stl: ["stl", "steals", "s", "spg"],
  blk: ["blk", "blocks", "b", "bpg"],
  tov: ["to", "tov", "turnovers", "topg"],
  fgm: ["fgm", "fg made"],
  fga: ["fga", "fg att", "fg attempts"],
  fgPct: ["fg%", "fg_pct", "fgpct", "fg pct", "fg"],
  ftm: ["ftm", "ft made"],
  fta: ["fta", "ft att", "ft attempts"],
  ftPct: ["ft%", "ft_pct", "ftpct", "ft pct", "ft"],
  basis: ["basis", "per", "stat basis"],
  adp: ["adp", "avg pick", "average pick", "avg. pick", "adp avg"],
  adpSource: ["source", "platform", "adp source"],
  season: ["season", "year"],
  date: ["date", "game date", "game_date"],
  home: ["home", "home team", "home_team", "home/neutral"],
  away: ["away", "visitor", "away team", "visitor/neutral", "road", "away_team"],
  positions: ["positions", "pos", "position", "eligibility", "elig"],
  status: ["status", "injury status"],
};

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveColumns(headers: string[], fields: string[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  const norm = new Map(headers.map((h) => [normHeader(h), h]));
  for (const f of fields) {
    map[f] = null;
    for (const a of ALIASES[f] ?? [f]) {
      const hit = norm.get(a);
      if (hit) {
        map[f] = hit;
        break;
      }
    }
  }
  return map;
}

function parse(text: string) {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy" });
  return { data: res.data, headers: res.meta.fields ?? [], errors: res.errors };
}

function num(v: string | undefined): number | null {
  if (v == null) return null;
  const t = String(v).trim().replace(/,/g, "");
  if (t === "" || t === "-" || t.toLowerCase() === "na" || t.toLowerCase() === "n/a") return null;
  const pct = t.endsWith("%");
  const x = Number(pct ? t.slice(0, -1) : t);
  if (!Number.isFinite(x)) return null;
  return pct ? x / 100 : x;
}

/** Percentages may arrive as 0.481, 48.1 or "48.1%". */
function pctValue(v: string | undefined): number | null {
  const x = num(v);
  if (x == null) return null;
  return x > 1 ? x / 100 : x;
}

export interface PlayerMatcher {
  match(name: string, team?: string | null, nbaId?: number | null): Player | null;
}

export function createMatcher(players: Player[]): PlayerMatcher {
  const byNba = new Map<number, Player>();
  const byKey = new Map<string, Player[]>();
  for (const p of players) {
    if (p.nbaId) byNba.set(p.nbaId, p);
    const k = nameKey(p.name);
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  return {
    match(name, team, nbaId) {
      if (nbaId && byNba.has(nbaId)) return byNba.get(nbaId)!;
      const cands = byKey.get(nameKey(name)) ?? [];
      if (cands.length === 1) return cands[0];
      if (cands.length > 1 && team) return cands.find((c) => c.team === team.toUpperCase()) ?? null;
      return null;
    },
  };
}

export interface ProjectionRow {
  playerId: string;
  name: string;
  gp: number;
  min: number;
  pts: number;
  fg3m: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
}

/** Projections: per-game by default; totals when a `basis` column says "total" or the file is flagged. */
export function importProjections(text: string, players: Player[], opts: { totals?: boolean } = {}): ImportResult<ProjectionRow> {
  const { data, headers } = parse(text);
  const cols = resolveColumns(headers, ["name", "team", "nbaId", "gp", "min", "pts", "fg3m", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "fgPct", "ftm", "fta", "ftPct", "basis"]);
  const issues: ImportIssue[] = [];
  const unmatched: string[] = [];
  const rows: ProjectionRow[] = [];
  const matcher = createMatcher(players);
  const required = ["name", "gp", "pts", "fg3m", "reb", "ast", "stl", "blk", "tov"];
  const missingCols = required.filter((f) => !cols[f]);
  if (missingCols.length) issues.push({ row: 0, level: "error", message: `Missing required columns: ${missingCols.join(", ")}` });
  if (!cols.fga) issues.push({ row: 0, level: "error", message: "FGA column required (FG% alone cannot be volume-weighted)" });
  if (!cols.fta) issues.push({ row: 0, level: "error", message: "FTA column required (FT% alone cannot be volume-weighted)" });
  if (issues.some((i) => i.level === "error")) return { kind: "projections", rows, issues, unmatched, columns: cols, totalRows: data.length };
  const seen = new Set<string>();
  data.forEach((r, i) => {
    const rowNo = i + 1;
    const g = (f: string) => (cols[f] ? r[cols[f]!] : undefined);
    const name = (g("name") ?? "").trim();
    if (!name) return issues.push({ row: rowNo, level: "warning", message: "Empty name — skipped" });
    const p = matcher.match(name, g("team"), num(g("nbaId")));
    if (!p) {
      unmatched.push(name);
      return;
    }
    if (seen.has(p.id)) return issues.push({ row: rowNo, level: "warning", message: `Duplicate row for ${p.name} — first row kept` });
    const gp = num(g("gp"));
    if (gp == null || gp < 0 || gp > 82) return issues.push({ row: rowNo, level: "error", message: `${name}: invalid GP` });
    const totals = opts.totals || /tot/i.test(g("basis") ?? "");
    const div = totals ? Math.max(gp, 1) : 1;
    const vals: Record<string, number | null> = {};
    for (const f of ["min", "pts", "fg3m", "reb", "ast", "stl", "blk", "tov", "fga", "fta", "fgm", "ftm"]) {
      const x = num(g(f));
      vals[f] = x == null ? null : x / div;
    }
    for (const f of ["pts", "fg3m", "reb", "ast", "stl", "blk", "tov", "fga", "fta"])
      if (vals[f] == null || vals[f]! < 0) return issues.push({ row: rowNo, level: "error", message: `${name}: missing/invalid ${f}` });
    // Makes from explicit columns, or derived from % × attempts (never the reverse).
    const fgPct = pctValue(g("fgPct"));
    const ftPct = pctValue(g("ftPct"));
    const fgm = vals.fgm ?? (fgPct != null ? fgPct * vals.fga! : null);
    const ftm = vals.ftm ?? (ftPct != null ? ftPct * vals.fta! : null);
    if (fgm == null) return issues.push({ row: rowNo, level: "error", message: `${name}: need FGM or FG%` });
    if (ftm == null) return issues.push({ row: rowNo, level: "error", message: `${name}: need FTM or FT%` });
    if (fgm > vals.fga! + 1e-6 || ftm > vals.fta! + 1e-6) return issues.push({ row: rowNo, level: "error", message: `${name}: makes exceed attempts` });
    if (vals.min == null) issues.push({ row: rowNo, level: "warning", message: `${name}: minutes missing — stored as 0 (display only)` });
    seen.add(p.id);
    rows.push({
      playerId: p.id,
      name: p.name,
      gp,
      min: vals.min ?? 0,
      pts: vals.pts!,
      fg3m: vals.fg3m!,
      reb: vals.reb!,
      ast: vals.ast!,
      stl: vals.stl!,
      blk: vals.blk!,
      tov: vals.tov!,
      fgm,
      fga: vals.fga!,
      ftm,
      fta: vals.fta!,
    });
  });
  return { kind: "projections", rows, issues, unmatched, columns: cols, totalRows: data.length };
}

export interface AdpRow {
  playerId: string;
  name: string;
  adp: number;
  source: string | null;
}

export function importAdp(text: string, players: Player[], defaultSource = "imported"): ImportResult<AdpRow> {
  const { data, headers } = parse(text);
  const cols = resolveColumns(headers, ["name", "team", "nbaId", "adp", "adpSource"]);
  const issues: ImportIssue[] = [];
  const unmatched: string[] = [];
  const rows: AdpRow[] = [];
  if (!cols.name || !cols.adp) {
    issues.push({ row: 0, level: "error", message: "ADP import needs name and adp columns" });
    return { kind: "adp", rows, issues, unmatched, columns: cols, totalRows: data.length };
  }
  const matcher = createMatcher(players);
  const seen = new Set<string>();
  data.forEach((r, i) => {
    const name = (r[cols.name!] ?? "").trim();
    const adp = num(r[cols.adp!]);
    if (!name) return;
    if (adp == null || adp <= 0) return issues.push({ row: i + 1, level: "error", message: `${name}: invalid ADP` });
    const p = matcher.match(name, cols.team ? r[cols.team] : null, cols.nbaId ? num(r[cols.nbaId]) : null);
    if (!p) return void unmatched.push(name);
    if (seen.has(p.id)) return issues.push({ row: i + 1, level: "warning", message: `Duplicate ${p.name} — first kept` });
    seen.add(p.id);
    rows.push({ playerId: p.id, name: p.name, adp, source: (cols.adpSource ? r[cols.adpSource] : null) || defaultSource });
  });
  return { kind: "adp", rows, issues, unmatched, columns: cols, totalRows: data.length };
}

export interface ScheduleRow {
  date: string;
  home: string;
  away: string;
}

const TEAM_NAMES: Record<string, string> = {
  "atlanta hawks": "ATL", "boston celtics": "BOS", "brooklyn nets": "BKN", "charlotte hornets": "CHA", "chicago bulls": "CHI",
  "cleveland cavaliers": "CLE", "dallas mavericks": "DAL", "denver nuggets": "DEN", "detroit pistons": "DET", "golden state warriors": "GSW",
  "houston rockets": "HOU", "indiana pacers": "IND", "la clippers": "LAC", "los angeles clippers": "LAC", "los angeles lakers": "LAL",
  "memphis grizzlies": "MEM", "miami heat": "MIA", "milwaukee bucks": "MIL", "minnesota timberwolves": "MIN", "new orleans pelicans": "NOP",
  "new york knicks": "NYK", "oklahoma city thunder": "OKC", "orlando magic": "ORL", "philadelphia 76ers": "PHI", "phoenix suns": "PHX",
  "portland trail blazers": "POR", "sacramento kings": "SAC", "san antonio spurs": "SAS", "toronto raptors": "TOR", "utah jazz": "UTA",
  "washington wizards": "WAS",
};
const ABBR = new Set(Object.values(TEAM_NAMES));
const ABBR_FIX: Record<string, string> = { BRK: "BKN", PHO: "PHX", CHO: "CHA", GS: "GSW", NO: "NOP", NY: "NYK", SA: "SAS", UTAH: "UTA", WSH: "WAS" };

export function teamAbbr(v: string): string | null {
  const t = v.trim();
  const up = t.toUpperCase();
  if (ABBR.has(up)) return up;
  if (ABBR_FIX[up]) return ABBR_FIX[up];
  return TEAM_NAMES[t.toLowerCase()] ?? null;
}

function isoDate(v: string): string | null {
  const t = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

export function importSchedule(text: string): ImportResult<ScheduleRow> {
  const { data, headers } = parse(text);
  const cols = resolveColumns(headers, ["date", "home", "away"]);
  const issues: ImportIssue[] = [];
  const rows: ScheduleRow[] = [];
  if (!cols.date || !cols.home || !cols.away) {
    issues.push({ row: 0, level: "error", message: "Schedule import needs date, home and away columns" });
    return { kind: "schedule", rows, issues, unmatched: [], columns: cols, totalRows: data.length };
  }
  const seen = new Set<string>();
  data.forEach((r, i) => {
    const date = isoDate(r[cols.date!] ?? "");
    const home = teamAbbr(r[cols.home!] ?? "");
    const away = teamAbbr(r[cols.away!] ?? "");
    if (!date || !home || !away) return issues.push({ row: i + 1, level: "error", message: `Unparseable row: ${Object.values(r).join(", ")}` });
    if (home === away) return issues.push({ row: i + 1, level: "error", message: `Team plays itself on ${date}` });
    const k = `${date}|${home}|${away}`;
    if (seen.has(k)) return issues.push({ row: i + 1, level: "warning", message: `Duplicate game ${k}` });
    seen.add(k);
    rows.push({ date, home, away });
  });
  const counts = new Map<string, number>();
  for (const g of rows) for (const t of [g.home, g.away]) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const [t, n] of counts) if (n > 82) issues.push({ row: 0, level: "warning", message: `${t} has ${n} games (> 82)` });
  return { kind: "schedule", rows, issues, unmatched: [], columns: cols, totalRows: data.length };
}

export interface MetadataRow {
  playerId: string;
  name: string;
  elig: SlotPos[] | null;
  team: string | null;
}

export function importMetadata(text: string, players: Player[]): ImportResult<MetadataRow> {
  const { data, headers } = parse(text);
  const cols = resolveColumns(headers, ["name", "team", "nbaId", "positions"]);
  const issues: ImportIssue[] = [];
  const unmatched: string[] = [];
  const rows: MetadataRow[] = [];
  if (!cols.name) {
    issues.push({ row: 0, level: "error", message: "Metadata import needs a name column" });
    return { kind: "metadata", rows, issues, unmatched, columns: cols, totalRows: data.length };
  }
  const matcher = createMatcher(players);
  const valid = new Set(["PG", "SG", "SF", "PF", "C"]);
  data.forEach((r, i) => {
    const name = (r[cols.name!] ?? "").trim();
    if (!name) return;
    const p = matcher.match(name, null, cols.nbaId ? num(r[cols.nbaId]) : null);
    if (!p) return void unmatched.push(name);
    let elig: SlotPos[] | null = null;
    if (cols.positions && r[cols.positions]) {
      const parts = r[cols.positions].toUpperCase().split(/[,/|\s]+/).filter(Boolean);
      const bad = parts.filter((x) => !valid.has(x) && !["G", "F", "UTIL"].includes(x));
      if (bad.length) issues.push({ row: i + 1, level: "warning", message: `${name}: ignored positions ${bad.join(",")}` });
      elig = parts.filter((x) => valid.has(x)) as SlotPos[];
      if (!elig.length) elig = null;
    }
    const team = cols.team && r[cols.team] ? teamAbbr(r[cols.team]) : null;
    if (cols.team && r[cols.team] && !team) issues.push({ row: i + 1, level: "warning", message: `${name}: unknown team ${r[cols.team]}` });
    rows.push({ playerId: p.id, name: p.name, elig, team });
  });
  return { kind: "metadata", rows, issues, unmatched, columns: cols, totalRows: data.length };
}

export interface HistoryRow extends Omit<ProjectionRow, "playerId"> {
  playerId: string;
  season: string;
}

export function importHistory(text: string, players: Player[]): ImportResult<HistoryRow> {
  const proj = importProjections(text, players);
  const { data, headers } = parse(text);
  const cols = resolveColumns(headers, ["season", "name"]);
  const issues = [...proj.issues];
  if (!cols.season) issues.push({ row: 0, level: "error", message: "History import needs a season column (e.g. 2024-25)" });
  const seasonByName = new Map<string, string>();
  if (cols.season && cols.name) for (const r of data) seasonByName.set(nameKey(r[cols.name] ?? ""), (r[cols.season] ?? "").trim());
  const rows = cols.season
    ? proj.rows
        .map((r) => ({ ...r, season: seasonByName.get(nameKey(r.name)) ?? "" }))
        .filter((r) => /^\d{4}-\d{2}$/.test(r.season))
    : [];
  return { kind: "history", rows, issues, unmatched: proj.unmatched, columns: { ...proj.columns, season: cols.season }, totalRows: data.length };
}

/** Header-only templates with a clearly fictional example row (not real statistics). */
export const TEMPLATES: Record<ImportKind, string> = {
  projections: "name,team,nba_id,gp,min,pts,3pm,reb,ast,stl,blk,to,fgm,fga,ftm,fta\nEXAMPLE PLAYER (delete me),AAA,,70,30.0,20.0,2.0,6.0,4.0,1.0,0.5,2.0,7.5,16.0,3.0,3.8\n",
  adp: "name,team,adp,source\nEXAMPLE PLAYER (delete me),AAA,12.5,Yahoo\n",
  history: "season,name,team,gp,min,pts,3pm,reb,ast,stl,blk,to,fgm,fga,ftm,fta\n2024-25,EXAMPLE PLAYER (delete me),AAA,70,30.0,20.0,2.0,6.0,4.0,1.0,0.5,2.0,7.5,16.0,3.0,3.8\n",
  schedule: "date,home,away\n2026-10-20,AAA,BBB\n",
  metadata: "name,nba_id,positions,team\nEXAMPLE PLAYER (delete me),,PG/SG,AAA\n",
};
