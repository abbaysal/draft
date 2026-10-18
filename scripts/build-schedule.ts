/**
 * Builds src/data/schedule.generated.json from the official 2026-27 NBA regular-season
 * schedule (NBA schedule PDF "as of August 13, 2026", transcribed to
 * data/research/nba_schedule_2026-27.csv). 1,200 of 1,230 games: the 30 Emirates NBA Cup
 * knockout-round games are TBD and therefore absent (every team has 80 listed games).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { importSchedule } from "../src/lib/import/csv";

const ROOT = join(__dirname, "..");
const res = importSchedule(readFileSync(join(ROOT, "data/research/nba_schedule_2026-27.csv"), "utf8"));
const errors = res.issues.filter((i) => i.level === "error");
if (errors.length) throw new Error(`Schedule has ${errors.length} unparseable rows, e.g. ${errors[0].message}`);
writeFileSync(join(ROOT, "src/data/schedule.generated.json"), JSON.stringify(res.rows));
console.log(`schedule: ${res.rows.length} games written`);
