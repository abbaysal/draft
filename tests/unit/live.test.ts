import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateBoxscores, parseEspnInjuries, parseMinutes, parseNbaBoxscore, parseNbaSchedule } from "@/lib/live/parse";
import { applyLive, blendProjection, K_GAMES, mapInjury, type LiveFeed } from "@/lib/live/blend";
import { syntheticPool } from "./helpers";

const schedule = {
  leagueSchedule: {
    seasonYear: "2026-27",
    gameDates: [
      { gameDate: "10/20/2026 00:00:00", games: [
        { gameId: "0022600001", gameStatus: 3, gameDateEst: "2026-10-20T00:00:00Z", homeTeam: { teamTricode: "DET" }, awayTeam: { teamTricode: "BOS" } },
        { gameId: "0012600001", gameStatus: 3, gameDateEst: "2026-10-10T00:00:00Z", homeTeam: { teamTricode: "DEN" }, awayTeam: { teamTricode: "LAL" } },
      ] },
      { gameDate: "10/21/2026 00:00:00", games: [
        { gameId: "0022600004", gameStatus: 1, gameDateEst: "2026-10-21T00:00:00Z", homeTeam: { teamTricode: "MIA" }, awayTeam: { teamTricode: "MIN" } },
      ] },
    ],
  },
};
const player = (personId: number, name: string, minutes: string, pts: number) => ({
  personId, name, played: "1",
  statistics: { minutes, points: pts, reboundsTotal: 10, assists: 5, steals: 1, blocks: 2, turnovers: 3, threePointersMade: 2, fieldGoalsMade: 10, fieldGoalsAttempted: 20, freeThrowsMade: 4, freeThrowsAttempted: 5 },
});
const box = {
  game: {
    gameId: "0022600001",
    homeTeam: { teamTricode: "DET", players: [player(1, "Home Star", "PT36M30.00S", 30), player(2, "Bench Guy", "", 0)] },
    awayTeam: { teamTricode: "BOS", players: [player(3, "Away Star", "PT34M00.00S", 25)] },
  },
};
const injuries = {
  injuries: [
    { id: "1", displayName: "Detroit Pistons", injuries: [
      { status: "Out", shortComment: "Out with a sprained ankle.", date: "2026-10-17T12:00Z", athlete: { displayName: "Home Star", links: [{ href: "https://www.espn.com/nba/player/_/id/4433/home-star" }] }, details: { returnDate: "2026-11-15" } },
      { status: "Day-To-Day", shortComment: "Questionable for opening night.", athlete: { id: "999", displayName: "Somebody Else" } },
    ] },
  ],
};

describe("live feed parsers", () => {
  it("parses minutes in ISO and mm:ss form", () => {
    expect(parseMinutes("PT34M30.00S")).toBeCloseTo(34.5, 6);
    expect(parseMinutes("12:30")).toBeCloseTo(12.5, 6);
    expect(parseMinutes("")).toBe(0);
  });

  it("keeps only regular-season games from the NBA schedule", () => {
    const g = parseNbaSchedule(schedule);
    expect(g.map((x) => x.gameId)).toEqual(["0022600001", "0022600004"]);
    expect(g[0]).toMatchObject({ date: "2026-10-20", home: "DET", away: "BOS", status: 3 });
  });

  it("parses box scores, skipping DNPs, and aggregates season + recent totals", () => {
    const lines = parseNbaBoxscore(box);
    expect(lines).toHaveLength(2);
    const agg = aggregateBoxscores([{ date: "2026-10-20", lines }, { date: "2026-11-20", lines }], 14);
    const star = agg.find((p) => p.nbaId === 1)!;
    expect(star.gp).toBe(2);
    expect(star.tot.pts).toBe(60);
    expect(star.recent.gp).toBe(1);
    expect(star.recent.from).toBe("2026-11-07");
  });

  it("parses the ESPN injury report with ids from links or athlete.id", () => {
    const inj = parseEspnInjuries(injuries);
    expect(inj).toHaveLength(2);
    expect(inj[0]).toMatchObject({ espnId: 4433, name: "Home Star", status: "Out", returnDate: "2026-11-15" });
    expect(inj[1].espnId).toBe(999);
    expect(parseEspnInjuries({ unexpected: true })).toEqual([]);
  });
});

describe("blending live data into projections", () => {
  const [p] = syntheticPool(1);
  const proj = p.proj!;
  const stats = { nbaId: 1, name: p.name, team: p.team, gp: K_GAMES, tot: { min: 0, pts: proj.pts * K_GAMES * 2, fg3m: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 }, recent: { gp: 0, tot: { min: 0, pts: 0, fg3m: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 }, from: "" } };

  it("after K games, actual play carries half the weight", () => {
    const b = blendProjection(proj, stats, K_GAMES);
    expect(b.pts).toBeCloseTo(proj.pts * 1.5, 6);
    expect(b.flags.some((f) => f.startsWith("In-season: 15 games"))).toBe(true);
  });

  it("percentages are blended on attempts (volume-weighted)", () => {
    const shoot = { ...stats, tot: { ...stats.tot, fga: 400, fgm: 300 } };
    const b = blendProjection(proj, shoot, K_GAMES);
    expect(b.fgm / b.fga).toBeGreaterThan(proj.fgm / proj.fga);
    expect(b.fgm / b.fga).toBeLessThan(0.75);
  });

  it("maps ESPN statuses", () => {
    expect(mapInjury({ name: "x", status: "Out", returnDate: "2026-12-20" }, "2026-10-20").status).toBe("OUT_EXTENDED");
    expect(mapInjury({ name: "x", status: "Out" }, "2026-10-20").status).toBe("OUT_START");
    expect(mapInjury({ name: "x", status: "Out", comment: "Out for the season (ACL)" }, "2026-10-20").status).toBe("OUT_SEASON");
    expect(mapInjury({ name: "x", status: "Day-To-Day" }, "2026-10-20").status).toBe("DAY_TO_DAY");
  });

  it("applyLive matches by NBA/ESPN id and reduces availability for new injuries", () => {
    const players = syntheticPool(3).map((x, i) => ({ ...x, nbaId: 100 + i, espnId: 200 + i }));
    const feed: LiveFeed = {
      generatedAt: "2026-10-25T00:00:00Z",
      season: "2026-27",
      sources: [{ id: "espn-injuries", name: "ESPN", url: "", ok: true, count: 1 }],
      schedule: null,
      teamGames: {},
      stats: [{ ...stats, nbaId: 101 }],
      injuries: [{ espnId: 202, name: "whoever", status: "Out", returnDate: "2026-12-30" }],
      warnings: [],
    };
    const { players: out, report } = applyLive(players, feed, { stats: true, injuries: true }, "2026-10-25");
    expect(report.statsMatched).toBe(1);
    expect(report.injuriesMatched).toBe(1);
    expect(out[1].live?.gp).toBe(K_GAMES);
    expect(out[2].availability?.status).toBe("OUT_EXTENDED");
    expect(out[2].proj!.gp).toBeLessThan(players[2].proj!.gp);
    const off = applyLive(players, feed, { stats: false, injuries: false }, "2026-10-25");
    expect(off.players[1].proj).toEqual(players[1].proj);
  });
});

describe("live feed assembly (/api/live)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds the feed from schedule, final box scores and injuries, reporting per-source status", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const body = url.includes("scheduleLeagueV2") ? schedule : url.includes("boxscore_0022600001") ? box : url.includes("injuries") ? injuries : null;
      return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("nope", { status: 404 });
    });
    const { buildFeed } = await import("@/server/live");
    const feed = await buildFeed();
    expect(feed.sources.every((s) => s.ok)).toBe(true);
    expect(feed.stats.map((s) => s.nbaId).sort()).toEqual([1, 3]);
    expect(feed.teamGames).toEqual({ DET: 1, BOS: 1 });
    expect(feed.injuries).toHaveLength(2);
    expect(feed.schedule).toBeNull(); // partial schedule → keep the bundled one
  });

  it("reports failures without throwing", async () => {
    vi.stubGlobal("fetch", async () => new Response("blocked", { status: 403 }));
    const { buildFeed } = await import("@/server/live");
    const feed = await buildFeed();
    expect(feed.sources.find((s) => s.id === "nba-schedule")?.ok).toBe(false);
    expect(feed.sources.find((s) => s.id === "espn-injuries")?.error).toBe("HTTP 403");
    expect(feed.stats).toEqual([]);
  });
});
