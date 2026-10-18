/**
 * Dataset build pipeline (stage 1–9 of the ingestion design in DATA_SOURCES.md):
 *   1. Source retrieval     – raw files committed under data/raw with sha256 in MANIFEST.json
 *   2. Identity matching    – NBA person id primary key; name-key matching for ESPN-keyed seasons
 *   3. Schema validation    – zod row schemas; invalid rows are logged and skipped (never guessed)
 *   4. Deduplication        – one Player per NBA id; duplicate name keys are reported
 *   5. Normalisation        – totals → per-game lines; derived FGA/FTA flagged when estimated
 *   6. Projection           – WarRoom Projection Model v1 (model-generated estimate)
 *   7. Output               – src/data/dataset.generated.json (also used by prisma/seed.ts)
 *   8. Ranking recalc       – tags computed from per-game valuation
 *   9. Data-quality report  – data/build-report.json
 *
 * Run: npm run data:build
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { z } from "zod";
import { nameKey } from "../src/lib/names";
import { deriveEligibility } from "../src/lib/positions";
import {
  PROJECTION_SOURCE,
  PROJECTION_VERSION,
  computeLeagueRates,
  estimateAttempts,
  posGroup,
  projectPlayer,
} from "../src/lib/projection/model";
import { buildBaseline, valuePlayers, DEFAULT_VALUATION } from "../src/lib/engine/valuation";
import { classifyPlayer } from "../src/lib/engine/tags";
import type { Availability, Dataset, HistSeason, Player, TeamChange } from "../src/lib/types";

const ROOT = join(__dirname, "..");
const SEASON_START = new Date("2026-10-20T00:00:00Z");
const log: { level: "info" | "warn" | "error"; msg: string }[] = [];
const info = (msg: string) => log.push({ level: "info", msg });
const warn = (msg: string) => log.push({ level: "warn", msg });

function readCsv(rel: string): Record<string, string>[] {
  const text = readFileSync(join(ROOT, rel), "utf8");
  const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (res.errors.length) for (const e of res.errors) warn(`${rel}: CSV parse error row ${e.row}: ${e.message}`);
  return res.data;
}
const sha = (rel: string) => createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");

// ---------- 2025-26 official totals (stats.nba.com via EasySportsApps) ----------
const num = z.coerce.number();
const optNum = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().optional());
const NbaRow = z.object({
  season: z.literal("2025-26"),
  player_id: z.coerce.number().int().positive(),
  player_name: z.string().min(2),
  team: z.string().length(3),
  position: z.string(),
  height_m: optNum,
  weight_kg: optNum,
  birthdate: z.string().optional(),
  age_completed_years: optNum,
  experience: optNum,
  minutes_played: num,
  wins: num,
  losses: num,
  one_point_made: num,
  one_point_attempted: num,
  two_point_made: num,
  two_point_attempted: num,
  three_point_made: num,
  three_point_attempted: num,
  offensive_rebounds: num,
  defensive_rebounds: num,
  assists: num,
  turnovers: optNum,
  steals: optNum,
  blocks: optNum,
});

const NBA_FILE = "data/raw/nba_stats_2025-26_regular_season_totals.csv";
const players = new Map<string, Player>();
const byKey = new Map<string, Player>();

for (const raw of readCsv(NBA_FILE)) {
  const r = NbaRow.safeParse(raw);
  if (!r.success) {
    warn(`${NBA_FILE}: invalid row for ${raw.player_name}: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    continue;
  }
  const d = r.data;
  const gp = d.wins + d.losses;
  if (gp <= 0) continue;
  const missing = ["turnovers", "steals", "blocks"].filter((k) => (d as Record<string, unknown>)[k] == null);
  if (missing.length) warn(`${d.player_name}: missing ${missing.join(", ")} in 2025-26 source; stats treated as unavailable (season skipped)`);
  const fgm = d.two_point_made + d.three_point_made;
  const fga = d.two_point_attempted + d.three_point_attempted;
  const hist: HistSeason[] = missing.length
    ? []
    : [
        {
          season: "2025-26",
          source: "nba-stats-2025-26",
          gp,
          min: d.minutes_played / gp,
          pts: (d.one_point_made + 2 * d.two_point_made + 3 * d.three_point_made) / gp,
          fg3m: d.three_point_made / gp,
          reb: (d.offensive_rebounds + d.defensive_rebounds) / gp,
          ast: d.assists / gp,
          stl: d.steals! / gp,
          blk: d.blocks! / gp,
          tov: d.turnovers! / gp,
          fgm: fgm / gp,
          fga: fga / gp,
          ftm: d.one_point_made / gp,
          fta: d.one_point_attempted / gp,
          attemptsEstimated: false,
          team: d.team,
        },
      ];
  const birth = d.birthdate ? new Date(d.birthdate + "T00:00:00Z") : undefined;
  const age = birth ? Math.floor((SEASON_START.getTime() - birth.getTime()) / (365.2425 * 864e5)) : undefined;
  const p: Player = {
    id: `nba-${d.player_id}`,
    nbaId: d.player_id,
    name: d.player_name,
    team: d.team,
    nbaPos: d.position || "F",
    elig: deriveEligibility(d.position || "F"),
    eligSource: "derived",
    age,
    birthdate: d.birthdate || undefined,
    experience: d.experience != null ? d.experience + 1 : undefined,
    heightM: d.height_m,
    weightKg: d.weight_kg,
    proj: null,
    hist,
    tags: [],
    adp: null,
    adpSource: null,
  };
  if (players.has(p.id)) warn(`Duplicate NBA id ${p.id} (${p.name}) — kept first`);
  else players.set(p.id, p);
  const k = nameKey(p.name);
  if (byKey.has(k)) warn(`Duplicate name key "${k}" (${p.name} / ${byKey.get(k)!.name}) — name matching disabled for this key`);
  byKey.set(k, byKey.has(k) ? (null as unknown as Player) : p);
}
info(`2025-26: ${players.size} players loaded`);

// ---------- 2023-24 and 2024-25 per-game (nbabench-data, ESPN-keyed) ----------
const BenchRow = z.object({
  player: z.string(),
  position: z.string(),
  team: z.string(),
  gp: z.number().int().nonnegative(),
  mpg: z.number(),
  fg_pct: z.number().min(0).max(1),
  ft_pct: z.number().min(0).max(1),
  three_pm: z.number(),
  rpg: z.number(),
  apg: z.number(),
  stpg: z.number(),
  blkpg: z.number(),
  topg: z.number(),
  pts: z.number(),
  id: z.number().int(),
});

// League FTA/FGA by position group from real 2025-26 attempts, used when a player has none.
const ftaRatioByGroup: Record<string, number> = {};
{
  const acc: Record<string, [number, number]> = {};
  for (const p of players.values()) {
    const h = p.hist[0];
    if (!h || h.gp * h.min < 500) continue;
    const g = posGroup(p.nbaPos);
    acc[g] ??= [0, 0];
    acc[g][0] += h.fta * h.gp;
    acc[g][1] += h.fga * h.gp;
  }
  for (const g of Object.keys(acc)) ftaRatioByGroup[g] = acc[g][0] / acc[g][1];
}

const availabilityRows = readCsv("data/research/availability_2026-27.csv");
const returningKeys = new Set(availabilityRows.map((r) => nameKey(r.player_name)));
const extraPlayers = new Map<string, Player>(); // in history but not 2025-26 (e.g. missed whole season)

for (const [season, file] of [
  ["2024-25", "data/raw/nbabench_2024-25_season_per_game.jsonl"],
  ["2023-24", "data/raw/nbabench_2023-24_season_per_game.jsonl"],
] as const) {
  let matched = 0;
  let unmatched = 0;
  const lines = readFileSync(join(ROOT, file), "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    const parsed = BenchRow.safeParse(JSON.parse(line));
    if (!parsed.success) {
      warn(`${file}: invalid row ${line.slice(0, 60)}`);
      continue;
    }
    const b = parsed.data;
    if (b.gp <= 0 || b.mpg <= 0) continue;
    const k = nameKey(b.player);
    let p = byKey.get(k) ?? extraPlayers.get(k);
    if (!p && returningKeys.has(k)) {
      // Player absent from 2025-26 (e.g. missed the season injured) but researched as returning.
      p = {
        id: `espn-${b.id}`,
        espnId: b.id,
        name: b.player,
        team: b.team,
        nbaPos: b.position.startsWith("C") ? "C" : b.position.endsWith("F") ? "F" : "G",
        elig: [],
        eligSource: "derived",
        proj: null,
        hist: [],
        tags: [],
        adp: null,
        adpSource: null,
      };
      p.elig = deriveEligibility(p.nbaPos);
      extraPlayers.set(k, p);
      info(`Added ${b.player} from ${season} history (absent from 2025-26, listed in availability research)`);
    }
    if (!p) {
      unmatched++;
      continue;
    }
    matched++;
    p.espnId ??= b.id;
    const own = p.hist.find((h) => !h.attemptsEstimated);
    const ratio = own && own.fga > 1 ? own.fta / own.fga : ftaRatioByGroup[posGroup(p.nbaPos)];
    const att = estimateAttempts(b.pts, b.three_pm, b.fg_pct, b.ft_pct, ratio);
    p.hist.push({
      season,
      source: season === "2024-25" ? "nbabench-2024-25" : "nbabench-2023-24",
      gp: b.gp,
      min: b.mpg,
      pts: b.pts,
      fg3m: b.three_pm,
      reb: b.rpg,
      ast: b.apg,
      stl: b.stpg,
      blk: b.blkpg,
      tov: b.topg,
      ...att,
      attemptsEstimated: true,
    });
  }
  info(`${season}: matched ${matched}, unmatched ${unmatched} (unmatched = not in 2025-26 player pool and not researched as returning)`);
}
for (const p of extraPlayers.values()) players.set(p.id, p);

// ---------- Offseason moves ----------
const MoveRow = z.object({
  player_name: z.string(),
  from_team: z.string(),
  to_team: z.string(),
  transaction_type: z.string(),
  reported_date: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  apply: z.enum(["true", "false"]),
  source_name: z.string(),
  source_url: z.string().url(),
});
const allByKey = new Map<string, Player>();
for (const p of players.values()) allByKey.set(nameKey(p.name), p);
const departures: Record<string, { name: string; fga: number }[]> = {};
for (const raw of readCsv("data/research/offseason_moves_2026.csv")) {
  const r = MoveRow.safeParse(raw);
  if (!r.success) {
    warn(`offseason_moves: invalid row ${raw.player_name}`);
    continue;
  }
  const m = r.data;
  const p = allByKey.get(nameKey(m.player_name));
  if (!p) {
    warn(`offseason_moves: no player match for ${m.player_name}`);
    continue;
  }
  if (m.apply !== "true") {
    info(`offseason_moves: NOT applied (conflicting sources) ${m.player_name} ${m.from_team}→${m.to_team}`);
    continue;
  }
  const tc: TeamChange = {
    from: m.from_team,
    to: m.to_team,
    type: m.transaction_type,
    date: m.reported_date,
    confidence: m.confidence,
    sourceName: m.source_name,
    sourceUrl: m.source_url,
  };
  if (p.team !== m.from_team) warn(`offseason_moves: ${p.name} listed from ${m.from_team} but data team is ${p.team}`);
  p.teamChange = tc;
  p.team = m.to_team;
  const fga = p.hist.find((h) => h.season === "2025-26")?.fga ?? 0;
  (departures[m.from_team] ??= []).push({ name: p.name, fga });
}

// ---------- Availability ----------
const AvailRow = z.object({
  player_name: z.string(),
  team: z.string(),
  status: z.enum(["HEALTHY", "DAY_TO_DAY", "OUT_START", "OUT_EXTENDED", "OUT_SEASON", "RETURNING", "UNKNOWN"]),
  injury: z.string(),
  est_games_missed: z.coerce.number().min(0).max(82),
  estimate_basis: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  reported_date: z.string(),
  source_name: z.string(),
  source_url: z.string().url(),
  notes: z.string().optional(),
});
for (const raw of availabilityRows) {
  const r = AvailRow.safeParse(raw);
  if (!r.success) {
    warn(`availability: invalid row ${raw.player_name}`);
    continue;
  }
  const a = r.data;
  const p = allByKey.get(nameKey(a.player_name));
  if (!p) {
    warn(`availability: no player match for ${a.player_name}`);
    continue;
  }
  if (p.id.startsWith("espn-")) {
    // Team in the per-game history file is unreliable for players who missed 2025-26; use researched team.
    p.team = a.team;
  } else if (p.team !== a.team) warn(`availability: ${p.name} team ${p.team} differs from research team ${a.team}`);
  const av: Availability = {
    status: a.status,
    injury: a.injury,
    estGamesMissed: a.est_games_missed,
    estimateBasis: a.estimate_basis,
    confidence: a.confidence,
    reportedDate: a.reported_date,
    sourceName: a.source_name,
    sourceUrl: a.source_url,
    notes: a.notes || undefined,
  };
  p.availability = av;
}

// ---------- Biographical supplement for players absent from the 2025-26 file ----------
for (const raw of readCsv("data/research/player_metadata_supplement.csv")) {
  const p = allByKey.get(nameKey(raw.player_name));
  if (!p) {
    warn(`metadata supplement: no player match for ${raw.player_name}`);
    continue;
  }
  if (!p.birthdate && raw.birthdate) {
    p.birthdate = raw.birthdate;
    const birth = new Date(raw.birthdate + "T00:00:00Z");
    p.age = Math.floor((SEASON_START.getTime() - birth.getTime()) / (365.2425 * 864e5));
  }
  if (raw.nba_position && p.id.startsWith("espn-")) {
    p.nbaPos = raw.nba_position;
    p.elig = deriveEligibility(raw.nba_position);
  }
}

// ---------- Rookies (no statistics; no projection) ----------
for (const raw of readCsv("data/research/rookies_2026.csv")) {
  const pick = Number(raw.pick);
  const id = `rookie-2026-${pick}`;
  players.set(id, {
    id,
    name: raw.player_name,
    team: raw.team,
    nbaPos: raw.position,
    elig: deriveEligibility(raw.position),
    eligSource: "derived",
    rookie: { pick, college: raw.college, sourceUrl: raw.source_url },
    proj: null,
    hist: [],
    tags: [],
    adp: null,
    adpSource: null,
  });
}

// ---------- Projections ----------
const leagueRows: { nbaPos: string; season: HistSeason }[] = [];
for (const p of players.values()) for (const h of p.hist) leagueRows.push({ nbaPos: p.nbaPos, season: h });
const league = computeLeagueRates(leagueRows);
let projected = 0;
for (const p of players.values()) {
  p.hist.sort((a, b) => b.season.localeCompare(a.season));
  if (p.rookie) continue;
  p.proj = projectPlayer({ nbaPos: p.nbaPos, age: p.age, hist: p.hist, availability: p.availability, teamChange: p.teamChange }, league);
  if (p.proj) projected++;
}
info(`Projected ${projected} players with ${PROJECTION_VERSION}`);

// ---------- Tags (per-game valuation) ----------
const all = [...players.values()];
const base = buildBaseline(all, { ...DEFAULT_VALUATION, basis: "perGame" });
const values = valuePlayers(all, base);
for (const p of all) p.tags = classifyPlayer(p, { values, departures });

// ---------- Output ----------
const rounded = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
function roundDeep<T>(v: T): T {
  if (typeof v === "number") return rounded(v) as T;
  if (Array.isArray(v)) return v.map(roundDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x)])) as T;
  return v;
}

const sortedPlayers = all.sort((a, b) => (values.get(a.id)?.rank ?? 9999) - (values.get(b.id)?.rank ?? 9999));
const dataset: Dataset = {
  meta: {
    builtAt: new Date().toISOString(),
    projectionVersion: PROJECTION_VERSION,
    projectionSource: PROJECTION_SOURCE,
    sources: [
      {
        id: "nba-stats-2025-26",
        name: "NBA Stats API 2025-26 regular-season totals (via EasySportsApps/nba_api_25_26_data)",
        url: "https://github.com/EasySportsApps/nba_api_25_26_data",
        season: "2025-26",
        retrieved: "2026-10-18",
        sha256: sha(NBA_FILE),
      },
      {
        id: "nbabench-2024-25",
        name: "nbabench-data 2024-25 per-game aggregates (willccbb/nbabench-data)",
        url: "https://github.com/willccbb/nbabench-data",
        season: "2024-25",
        retrieved: "2026-10-18",
        sha256: sha("data/raw/nbabench_2024-25_season_per_game.jsonl"),
      },
      {
        id: "nbabench-2023-24",
        name: "nbabench-data 2023-24 per-game aggregates (willccbb/nbabench-data)",
        url: "https://github.com/willccbb/nbabench-data",
        season: "2023-24",
        retrieved: "2026-10-18",
        sha256: sha("data/raw/nbabench_2023-24_season_per_game.jsonl"),
      },
      {
        id: "research-2026-offseason",
        name: "Researched 2026 offseason moves, availability and rookie list (see DATA_SOURCES.md)",
        url: "data/research/",
        season: "2026-27",
        retrieved: "2026-10-18",
      },
    ],
    playerCount: all.length,
    projectedCount: projected,
    notes: [
      "2026-27 projections are MODEL-GENERATED ESTIMATES (WarRoom Projection Model v1), not third-party projections.",
      "No ADP is bundled. Import ADP via Data Management; until then a clearly-labelled market proxy is used for opponent modelling.",
      "Fantasy position eligibility is derived from NBA listed positions (G/F/C) and should be overridden by platform eligibility imports.",
      "2023-24 and 2024-25 FGA/FTA are estimated from per-game points and percentages (flagged per season).",
    ],
  },
  players: roundDeep(sortedPlayers),
};

writeFileSync(join(ROOT, "src/data/dataset.generated.json"), JSON.stringify(dataset));
writeFileSync(
  join(ROOT, "data/build-report.json"),
  JSON.stringify({ builtAt: dataset.meta.builtAt, counts: { players: all.length, projected }, log }, null, 2),
);
const warns = log.filter((l) => l.level === "warn");
console.log(log.filter((l) => l.level === "info").map((l) => "info  " + l.msg).join("\n"));
console.log(warns.map((l) => "warn  " + l.msg).join("\n"));
console.log(`\nWrote ${all.length} players (${projected} projected). ${warns.length} warnings. Top 15 (per-game z):`);
for (const p of sortedPlayers.slice(0, 15)) console.log(`  ${values.get(p.id)?.rank}. ${p.name} ${p.team} ${values.get(p.id)?.total.toFixed(2)}`);
