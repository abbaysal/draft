/**
 * Builds src/data/schedule.generated.json from the official 2026-27 NBA regular-season
 * schedule (NBA schedule PDF "as of August 13, 2026", transcribed to
 * data/research/nba_schedule_2026-27.csv). 1,200 of 1,230 games: the 30 Emirates NBA Cup
 * knockout-round games are TBD and therefore absent (every team has 80 listed games).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importSchedule, teamAbbr } from "../src/lib/import/csv";

const ROOT = join(__dirname, "..");
const res = importSchedule(readFileSync(join(ROOT, "data/research/nba_schedule_2026-27.csv"), "utf8"));
const errors = res.issues.filter((i) => i.level === "error");
if (errors.length) throw new Error(`Schedule has ${errors.length} unparseable rows, e.g. ${errors[0].message}`);
// Tip-off times (ET) from the time_et column, keyed by date|home|away.
const times = new Map<string, string>();
const lines = readFileSync(join(ROOT, "data/research/nba_schedule_2026-27.csv"), "utf8").trim().split("\n");
const head = lines[0].split(",");
for (const l of lines.slice(1)) {
  const c = Object.fromEntries(l.split(",").map((v, i) => [head[i], v]));
  const home = teamAbbr(c.home);
  const away = teamAbbr(c.away);
  if (home && away && c.time_et) times.set(`${c.date}|${home}|${away}`, c.time_et);
}
const rows = res.rows.map((g) => ({ ...g, ...(times.get(`${g.date}|${g.home}|${g.away}`) ? { time: times.get(`${g.date}|${g.home}|${g.away}`) } : {}) }));
writeFileSync(join(ROOT, "src/data/schedule.generated.json"), JSON.stringify(rows));
console.log(`schedule: ${rows.length} games written (${times.size} with tip-off times)`);
