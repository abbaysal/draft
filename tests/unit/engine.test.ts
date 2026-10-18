import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, defaultTeamNames } from "@/lib/league";
import { buildContext } from "@/lib/engine/context";
import { EMPTY_DRAFT, applyDraftAction, type DraftState } from "@/lib/engine/draft";
import { simulateAvailability } from "@/lib/engine/availability";
import { recommend } from "@/lib/engine/recommend";
import { POLICY, mergeChunks, simulateChampionship, summarise, roundRobin } from "@/lib/engine/championship";
import { evaluateStrategies, strategyCatalog } from "@/lib/engine/strategy";
import { categoryScarcity } from "@/lib/engine/scarcity";
import { teamProfiles } from "@/lib/engine/opponents";
import { applyAvailabilityOverride } from "@/lib/import/apply";
import { matchLineup, deriveEligibility } from "@/lib/positions";
import { syntheticPool } from "./helpers";

const settings = { ...DEFAULT_SETTINGS, teams: 6, rounds: 8, myPosition: 3, teamNames: defaultTeamNames(6, 3), regularSeasonWeeks: 10, playoffTeams: 4, playoffWeeks: [23, 24] };
const shape = { teams: 6, rounds: 8, draftType: "snake" as const };
const pool = syntheticPool(160);

function draftTo(n: number, players = pool): DraftState {
  let s = EMPTY_DRAFT;
  for (let i = 0; i < n; i++) {
    const ctx = buildContext({ players, settings, draft: s });
    const r = applyDraftAction(s, { type: "pick", playerId: ctx.available[0] }, shape);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

describe("availability simulation", () => {
  const ctx = buildContext({ players: pool, settings, draft: draftTo(2) });
  const a = simulateAvailability(ctx, { sims: 200, seed: 42 });

  it("is reproducible for the same seed", () => {
    const b = simulateAvailability(ctx, { sims: 200, seed: 42 });
    expect([...b.survival.entries()]).toEqual([...a.survival.entries()]);
  });

  it("survival probabilities lie in [0, 1] and the horizon matches the snake gap", () => {
    for (const p of a.survival.values()) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
    // I pick 3rd; next pick is 10th overall => 6 opponent picks in between.
    expect(a.horizon).toBe(6);
    // Exactly `horizon` players disappear per simulation.
    const expectedTaken = [...a.survival.values()].reduce((s, p) => s + (1 - p), 0);
    expect(expectedTaken).toBeCloseTo(6, 6);
  });

  it("deep-pool players survive with high probability", () => {
    const last = ctx.available[ctx.available.length - 1];
    expect(a.survival.get(last)).toBe(1);
  });
});

describe("recommendations", () => {
  const ctx = buildContext({ players: pool, settings, draft: draftTo(2) });
  const avail = simulateAvailability(ctx, { sims: 150, seed: 1 });
  const rec = recommend(ctx, avail);

  it("ranks by the strategic score and labels the metric", () => {
    expect(rec.metricLevel).toBe(2);
    for (let i = 1; i < rec.candidates.length; i++) expect(rec.candidates[i - 1].score).toBeGreaterThanOrEqual(rec.candidates[i].score);
    expect(rec.picks.bestStrategic?.id).toBe(rec.candidates[0].id);
  });

  it("distinguishes best overall, best fit and best strategic picks", () => {
    expect(rec.picks.bestOverall).toBeDefined();
    expect(rec.picks.bestFit).toBeDefined();
    expect(rec.picks.bestStrategic).toBeDefined();
  });

  it("an injured star loses value immediately (sudden unavailability)", () => {
    const star = rec.candidates[0].id;
    const hurt = applyAvailabilityOverride(pool, star, 82, "test injury");
    const ctx2 = buildContext({ players: hurt, settings, draft: ctx.draft });
    const rec2 = recommend(ctx2, simulateAvailability(ctx2, { sims: 100, seed: 1 }));
    const c = rec2.candidates.find((x) => x.id === star);
    expect(c ? c.gain : -Infinity).toBeLessThan(rec.candidates[0].gain);
    expect(rec2.candidates[0].id).not.toBe(star);
  });

  it("works when the draft is nearly complete", () => {
    const late = buildContext({ players: pool, settings, draft: draftTo(46) });
    const r = recommend(late, simulateAvailability(late, { sims: 50, seed: 2 }));
    expect(r.candidates.length).toBeGreaterThan(0);
  });
});

describe("championship simulation", () => {
  const ctx = buildContext({ players: pool, settings, draft: draftTo(2) });
  const cands = [POLICY, ctx.available[0], ctx.available[5]];

  it("is reproducible and chunkable (chunks merge to the full run)", () => {
    const full = simulateChampionship(ctx, { candidates: cands, sims: 40, seed: 9 });
    const a = simulateChampionship(ctx, { candidates: cands, sims: 40, seed: 9, from: 0, to: 20 });
    const b = simulateChampionship(ctx, { candidates: cands, sims: 40, seed: 9, from: 20, to: 40 });
    const merged = mergeChunks([b, a]);
    expect(merged.map((t) => t.champ)).toEqual(full.tallies.map((t) => t.champ));
    expect(merged.map((t) => t.champBits)).toEqual(full.tallies.map((t) => t.champBits));
  });

  it("produces probabilities and a labelled fallback level", () => {
    const res = simulateChampionship(ctx, { candidates: cands, sims: 60, seed: 3 });
    const v = summarise(res.tallies, 50);
    for (const s of v.summaries) {
      expect(s.pChamp).toBeGreaterThanOrEqual(0);
      expect(s.pChamp).toBeLessThanOrEqual(1);
      expect(s.pPlayoffs).toBeGreaterThanOrEqual(s.pChamp);
    }
    expect([0, 1, 2]).toContain(v.level);
    expect(v.label).toMatch(/Level/);
  });

  it("falls back when there are too few simulations", () => {
    const res = simulateChampionship(ctx, { candidates: cands, sims: 10, seed: 3 });
    expect(summarise(res.tallies, 200).level).toBe(2);
  });

  it("round-robin schedules every team once per week", () => {
    const rr = roundRobin(6, 5);
    for (const week of rr) {
      const teams = week.flat();
      expect(new Set(teams).size).toBe(6);
    }
    expect(roundRobin(5, 1)[0].length).toBe(2); // odd team count => one bye
  });
});

describe("strategies, scarcity and opponents", () => {
  const ctx = buildContext({ players: pool, settings, draft: draftTo(12) });

  it("catalog includes balanced, all single and double punts, and soft punts", () => {
    const cat = strategyCatalog(ctx.cats);
    expect(cat.filter((s) => s.kind === "single")).toHaveLength(9);
    expect(cat.filter((s) => s.kind === "double")).toHaveLength(36);
    expect(cat.some((s) => s.kind === "soft")).toBe(true);
  });

  it("evaluates strategies with paired differences vs balanced", () => {
    const res = evaluateStrategies(ctx, { runs: 4, strategies: strategyCatalog(ctx.cats).slice(0, 5) });
    const bal = res.find((r) => r.kind === "balanced")!;
    expect(bal.deltaVsBalanced).toBe(0);
    for (const r of res) expect(Number.isFinite(r.meanObj)).toBe(true);
  });

  it("scarcity shares are in [0, 1]", () => {
    for (const s of categoryScarcity(ctx)) {
      expect(s.supplyShare).toBeGreaterThanOrEqual(0);
      expect(s.supplyShare).toBeLessThanOrEqual(1.0001);
    }
  });

  it("opponent profiles rank every category for every team", () => {
    const prof = teamProfiles(ctx);
    expect(prof).toHaveLength(6);
    for (const p of prof) for (const c of ctx.cats) expect(p.catRank[c]).toBeGreaterThanOrEqual(1);
  });

  it("opponents repeatedly drafting one position still produce valid simulations", () => {
    const centers = pool.map((p) => ({ ...p, elig: deriveEligibility("C"), nbaPos: "C" }));
    const c2 = buildContext({ players: centers, settings, draft: draftTo(6, centers) });
    const a = simulateAvailability(c2, { sims: 30, seed: 5 });
    expect(a.horizon).toBeGreaterThanOrEqual(0);
  });
});

describe("position eligibility", () => {
  it("derives dual eligibility and matches lineups", () => {
    expect(deriveEligibility("G-F")).toEqual(["SG", "SF"]);
    expect(deriveEligibility("F-C")).toEqual(["PF", "C"]);
    const { filled } = matchLineup(["PG", "C", "UTIL"], [["C"], ["PG", "SG"], ["C", "PF"]]);
    expect(filled).toBe(3);
  });
});

describe("weekly lineup", () => {
  it("parses a pasted Yahoo schedule and resolves curly-apostrophe team names", async () => {
    const { parseSchedule, resolveTeam } = await import("@/lib/engine/lineup");
    const sched = parseSchedule("1\tlogo Kadıköy UNO’s\t \t0 - 0\n2\tlogo Ilgarı yedim's Optimal Team\t \t \n");
    expect(sched).toEqual(["Kadıköy UNO’s", "Ilgarı yedim's Optimal Team"]);
    expect(resolveTeam(sched[0], ["A", "Kadıköy UNO's"])).toBe(1);
    expect(resolveTeam(sched[1], ["Ilgarı yedim's Optimal", "B"])).toBe(0);
  });

  it("builds a feasible lineup with every slot filled and probabilities in range", async () => {
    const { planWeek } = await import("@/lib/engine/lineup");
    const ctx = buildContext({ players: pool, settings, draft: draftTo(48) });
    const opp = (ctx.myIndex + 1) % settings.teams;
    const plan = planWeek(ctx, 3, opp);
    const starters = plan.lineup.filter((r) => r.slot !== "BN" && r.slot !== "IL");
    expect(starters.length).toBeGreaterThan(0);
    expect(new Set(plan.lineup.map((r) => r.id)).size).toBe(plan.lineup.length);
    expect(plan.winProb).toBeGreaterThanOrEqual(0);
    expect(plan.winProb).toBeLessThanOrEqual(1);
    for (let i = 1; i < starters.length; i++) expect(Number.isFinite(starters[i].score)).toBe(true);
  });
});

describe("official schedule and daily start/sit", () => {
  it("bundled 2026-27 schedule has 1,200 games (80 per team) and 24 Yahoo matchup periods", async () => {
    const games = (await import("@/data/schedule.generated.json")).default as { date: string; home: string; away: string }[];
    const { buildScheduleModel, fantasyWeek } = await import("@/lib/engine/schedule");
    const { matchupPeriods, periodOf } = await import("@/lib/engine/lineup");
    expect(games).toHaveLength(1200);
    const m = buildScheduleModel(games);
    expect(m.teams()).toHaveLength(30);
    for (const t of m.teams()) expect(m.avgGames(t, Array.from({ length: 25 }, (_, i) => i + 1)) * 25).toBeCloseTo(80, 6);
    const periods = matchupPeriods();
    expect(periods).toHaveLength(24);
    expect(periods[17]).toEqual([fantasyWeek("2027-02-15"), fantasyWeek("2027-02-22")]);
    expect(periodOf("2026-10-20")).toBe(1);
    expect(periodOf("2027-04-11")).toBe(24);
  });

  it("starts only players with a game that day, never more than the slots", async () => {
    const games = (await import("@/data/schedule.generated.json")).default as { date: string; home: string; away: string }[];
    const { buildScheduleModel } = await import("@/lib/engine/schedule");
    const { planWeek } = await import("@/lib/engine/lineup");
    const teams = buildScheduleModel(games).teams();
    const nbaPool = pool.map((p, i) => ({ ...p, team: teams[i % teams.length] }));
    const ctx = buildContext({ players: nbaPool, settings, draft: draftTo(48, nbaPool), schedule: buildScheduleModel(games) });
    const plan = planWeek(ctx, 2, (ctx.myIndex + 1) % settings.teams);
    expect(plan.daily.length).toBeGreaterThan(0);
    for (const d of plan.daily) {
      expect(d.starters.length).toBeLessThanOrEqual(ctx.starters);
      for (const s of d.starters) expect(ctx.schedule.gameDates(ctx.byId.get(s.id)!.team, 2)).toContain(d.date);
      if (d.sit.length) expect(d.starters.length).toBe(ctx.starters);
    }
    for (const r of plan.lineup) expect(r.starts).toBeLessThanOrEqual(r.scheduled);
  });
});

describe("trade analysis", () => {
  const full = buildContext({ players: pool, settings, draft: draftTo(48) });
  const me = full.myIndex;
  const partner = (me + 1) % settings.teams;

  it("an empty trade changes nothing", async () => {
    const { evaluateTrade } = await import("@/lib/engine/trade");
    const ev = evaluateTrade(full, { partner, give: [], get: [] });
    expect(ev.me.delta).toBeCloseTo(0, 9);
    expect(ev.them.delta).toBeCloseTo(0, 9);
  });

  it("giving my best player for their worst hurts me and helps them", async () => {
    const { evaluateTrade } = await import("@/lib/engine/trade");
    const v = (id: string) => full.values.get(id)!.total;
    const best = [...full.rosters[me]].sort((a, b) => v(b) - v(a))[0];
    const worst = [...full.rosters[partner]].sort((a, b) => v(a) - v(b))[0];
    const ev = evaluateTrade(full, { partner, give: [best], get: [worst] });
    expect(ev.me.delta).toBeLessThan(0);
    expect(ev.them.delta).toBeGreaterThan(0);
    expect(ev.verdict.tone).toBe("bad");
    expect(ev.valueBalance).toBeLessThan(0);
  });

  it("2-for-1 keeps rosters legal (they drop one, I add a free agent)", async () => {
    const { evaluateTrade } = await import("@/lib/engine/trade");
    const [a, b] = full.rosters[me];
    const ev = evaluateTrade(full, { partner, give: [a, b], get: [full.rosters[partner][0]] });
    expect(ev.me.adds).toHaveLength(1);
    expect(ev.them.drops).toHaveLength(1);
  });

  it("trade finder returns only trades that improve my team, and waiver moves are improvements", async () => {
    const { findTrades, waiverMoves, powerRankings } = await import("@/lib/engine/trade");
    const ideas = findTrades(full, { limit: 10, partner });
    for (const x of ideas) expect(x.myDelta).toBeGreaterThan(0.01);
    for (const m of waiverMoves(full)) expect(m.delta).toBeGreaterThan(0);
    const pr = powerRankings(full);
    expect(new Set(pr.map((r) => r.rank)).size).toBe(settings.teams);
  });

  it("lineup analyzer: benching a starter never beats the recommended lineup by much and is reflected in starts", async () => {
    const games = (await import("@/data/schedule.generated.json")).default as { date: string; home: string; away: string }[];
    const { buildScheduleModel } = await import("@/lib/engine/schedule");
    const { planWeek } = await import("@/lib/engine/lineup");
    const teams = buildScheduleModel(games).teams();
    const nbaPool = pool.map((p, i) => ({ ...p, team: teams[i % teams.length] }));
    const ctx = buildContext({ players: nbaPool, settings, draft: draftTo(48, nbaPool), schedule: buildScheduleModel(games) });
    const opp = (ctx.myIndex + 1) % settings.teams;
    const best = planWeek(ctx, 3, opp);
    const day = best.daily.find((d) => d.starters.length > 0)!;
    const star = day.starters[0].id;
    const mine = planWeek(ctx, 3, opp, { overrides: { [day.date]: { [star]: "sit" } } });
    const dayAfter = mine.daily.find((d) => d.date === day.date)!;
    expect(dayAfter.starters.some((s) => s.id === star)).toBe(false);
    expect(dayAfter.sit).toContain(star);
    expect(mine.expectedCats).toBeLessThanOrEqual(best.expectedCats + 0.05);
  });
});
