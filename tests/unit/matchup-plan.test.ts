import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import dataset from "@/data/dataset.generated.json";
import games from "@/data/schedule.generated.json";
import type { Dataset } from "@/lib/types";
import { LEAGUE_PRESETS } from "@/lib/league";
import { buildContext } from "@/lib/engine/context";
import { EMPTY_DRAFT } from "@/lib/engine/draft";
import { buildScheduleModel, type ScheduleGame } from "@/lib/engine/schedule";
import { planWeek, resolveTeam } from "@/lib/engine/lineup";
import { parseYahooPaste } from "@/lib/import/yahoo-paste";
import { buildCoachFacts } from "@/client/coach-facts";
import { syncFromPaste } from "@/client/matchup-sync";
import { CoachAdviceSchema } from "@/lib/coach";

const ds = dataset as unknown as Dataset;
const settings = LEAGUE_PRESETS[0].settings;
const ctx = buildContext({ players: ds.players, settings, draft: EMPTY_DRAFT, schedule: buildScheduleModel(games as ScheduleGame[]) });
const paste = parseYahooPaste(readFileSync(join(__dirname, "../fixtures/yahoo_matchup_week1.txt"), "utf8"), ds.players);
const sync = syncFromPaste(paste, "2026-10-21");
const opp = resolveTeam("Kadıköy UNO’s", settings.teamNames);
const knueppel = ds.players.find((p) => p.name === "Kon Knueppel")!.id;
const opts = { rosters: { mine: sync.mine, opp: sync.opp }, actual: sync.actual, fromDate: "2026-10-21", unavailable: { [knueppel]: ["2026-10-21"] } };

describe("live matchup planning (Yahoo week 1, Wed Oct 21)", () => {
  const plan = planWeek(ctx, 1, opp, opts);

  it("plans only the remaining days on top of the actual totals", () => {
    expect(plan.daily.length).toBeGreaterThan(0);
    for (const d of plan.daily) expect(d.date >= "2026-10-21").toBe(true);
    expect(plan.remaining.actualUsed).toBe(true);
    const pts = plan.categories.find((c) => c.cat === "pts")!;
    expect(pts.mine).toBeGreaterThan(70);
    expect(pts.theirs).toBeGreaterThan(71);
    // The engine assumes both managers fill every open slot daily (Yahoo's "remaining" counts the lineup as set).
    expect(plan.remaining.me).toBeGreaterThan(20);
    expect(plan.remaining.opp).toBeGreaterThan(15);
  });

  it("uses real teams: Wednesday starters are exactly the players with games, minus the out flag", () => {
    const wed = plan.daily.find((d) => d.date === "2026-10-21")!;
    const names = wed.starters.map((s) => ctx.byId.get(s.id)!.name).sort();
    expect(wed.out).toContain(knueppel);
    expect(names).toEqual(["Bam Adebayo", "Desmond Bane", "Kawhi Leonard", "Miles Bridges", "Myles Turner", "Nikola Vučević"].sort());
    expect(ctx.schedule.gameOn("PHX", "2026-10-21")).toMatchObject({ opp: "POR", home: false, time: "10:00 PM" });
  });

  it("streaming candidates exclude rostered players and count remaining games", () => {
    for (const p of plan.pickups) {
      expect(sync.mine).not.toContain(p.id);
      expect(sync.opp).not.toContain(p.id);
      for (const d of p.days ?? []) expect(d >= "2026-10-21").toBe(true);
    }
  });

  it("the coach fact sheet is compact and grounded in the plan", () => {
    const facts = buildCoachFacts(ctx, plan, opts, sync, "2026-10-21");
    expect(facts.myRoster).toHaveLength(13);
    expect(facts.opponentRoster).toHaveLength(13);
    expect(facts.enginePlan[0].isToday).toBe(true);
    expect(JSON.stringify(facts).length).toBeLessThan(60_000);
    expect(facts.myRoster.find((p) => p.player === "Kon Knueppel")?.yahooFlag).toBe("O");
  });

  it("coach output schema accepts a well-formed answer", () => {
    const ok = CoachAdviceSchema.safeParse({ headline: "x", today: { date: "2026-10-21", start: [], bench: [] }, changes: [], categoryPlan: [{ cat: "PTS", stance: "push", reason: "r" }], streaming: [], risks: [], summary: "s" });
    expect(ok.success).toBe(true);
  });
});
