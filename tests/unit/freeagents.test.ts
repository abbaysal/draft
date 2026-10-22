import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import dataset from "@/data/dataset.generated.json";
import games from "@/data/schedule.generated.json";
import type { Dataset } from "@/lib/types";
import { LEAGUE_PRESETS } from "@/lib/league";
import { buildContext, withRosters } from "@/lib/engine/context";
import { EMPTY_DRAFT } from "@/lib/engine/draft";
import { buildScheduleModel, type ScheduleGame } from "@/lib/engine/schedule";
import { resolveTeam } from "@/lib/engine/lineup";
import { parseYahooPaste } from "@/lib/import/yahoo-paste";
import { dropCandidates, scanFreeAgents, teamNeeds, upcomingGames } from "@/lib/engine/freeagents";

const ds = dataset as unknown as Dataset;
const settings = LEAGUE_PRESETS[0].settings;
const base = buildContext({ players: ds.players, settings, draft: EMPTY_DRAFT, schedule: buildScheduleModel(games as ScheduleGame[]) });
const paste = parseYahooPaste(readFileSync(join(__dirname, "../fixtures/yahoo_matchup_week1.txt"), "utf8"), ds.players);
const opp = resolveTeam("Kadıköy UNO’s", settings.teamNames);
// Other teams: fill with the next-best players so the free-agent pool looks like a drafted league.
const taken = new Set([...paste.left, ...paste.right].map((x) => x.playerId));
const rest = base.available.filter((id) => !taken.has(id));
const rosters = settings.teamNames.map((_, i) => (i === base.myIndex ? paste.left.map((x) => x.playerId) : i === opp ? paste.right.map((x) => x.playerId) : rest.splice(0, 13)));
const ctx = withRosters(base, rosters);

describe("free agents", () => {
  it("withRosters makes everyone else a free agent", () => {
    expect(ctx.available.some((id) => taken.has(id))).toBe(false);
    expect(ctx.drafted.size).toBe(156);
  });

  it("team needs and drop candidates", () => {
    const needs = teamNeeds(ctx);
    expect(needs).toHaveLength(9);
    for (const n of needs) expect(n.weight).toBeGreaterThanOrEqual(0);
    const drops = dropCandidates(ctx);
    expect(drops).toHaveLength(13);
    for (let i = 1; i < drops.length; i++) expect(drops[i - 1].lossIfDropped).toBeGreaterThanOrEqual(drops[i].lossIfDropped);
    expect(drops.at(-1)!.id).toBe(ds.players.find((p) => p.name === "Shai Gilgeous-Alexander")!.id);
  });

  it("scans the pool quickly with season gains, best drops and schedule", () => {
    const t = Date.now();
    const rows = scanFreeAgents(ctx, { period: 1, today: "2026-10-21" });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(rows.length).toBeGreaterThan(100);
    const mine = new Set(rosters[base.myIndex]);
    for (const r of rows) {
      expect(mine.has(r.id)).toBe(false);
      if (r.seasonDrop) expect(mine.has(r.seasonDrop)).toBe(true);
      expect(Number.isFinite(r.seasonGain)).toBe(true);
      expect(r.gamesLeftWeek).toBeLessThanOrEqual(5);
    }
    const best = [...rows].sort((a, b) => b.seasonGain - a.seasonGain)[0];
    expect(best.seasonGain).toBeGreaterThan(0);
    const g = upcomingGames(ctx, "PHX", "2026-10-21", 7);
    expect(g[0]).toMatchObject({ date: "2026-10-21", opp: "POR", home: false });
  });
});
