import { describe, expect, it } from "vitest";
import { importAdp, importMetadata, importProjections, importSchedule, teamAbbr } from "@/lib/import/csv";
import { applyAdp, applyProjectionSet, consensus, type ProjectionSet } from "@/lib/import/apply";
import { buildScheduleModel, fantasyWeek, weekRange, TOTAL_WEEKS } from "@/lib/engine/schedule";
import { nameKey } from "@/lib/names";
import { computeLeagueRates, estimateAttempts, projectPlayer } from "@/lib/projection/model";
import { mkPlayer } from "./helpers";

const players = [
  mkPlayer({ id: "nba-1", name: "Nikola Jokić", team: "DEN" }),
  mkPlayer({ id: "nba-2", name: "Jaren Jackson Jr.", team: "MEM" }),
  mkPlayer({ id: "nba-3", name: "Kel'el Ware", team: "MIL" }),
];

describe("identity matching", () => {
  it("normalises diacritics, suffixes and punctuation", () => {
    expect(nameKey("Nikola Jokić")).toBe(nameKey("nikola jokic"));
    expect(nameKey("Jaren Jackson Jr.")).toBe(nameKey("Jaren Jackson"));
    expect(nameKey("Kel'el Ware")).toBe(nameKey("Kelel Ware"));
  });
});

describe("projection CSV import", () => {
  it("accepts aliases, percentage+attempts, and derives makes from volume", () => {
    const csv = "Player,Team,G,MPG,PTS,3PM,REB,AST,STL,BLK,TO,FG%,FGA,FT%,FTA\nNikola Jokic,DEN,70,35,27,1.6,12.5,9.8,1.5,0.8,3.2,57.5%,17.6,0.82,6.4\n";
    const r = importProjections(csv, players);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].fgm).toBeCloseTo(0.575 * 17.6, 10);
    expect(r.rows[0].ftm).toBeCloseTo(0.82 * 6.4, 10);
  });

  it("rejects files without attempt columns (cannot volume-weight)", () => {
    const r = importProjections("name,gp,pts,3pm,reb,ast,stl,blk,to,fg%,ft%\nX,70,1,1,1,1,1,1,1,0.5,0.8\n", players);
    expect(r.issues.some((i) => i.level === "error" && /FGA/.test(i.message))).toBe(true);
  });

  it("normalises season totals to per game", () => {
    const csv = "name,gp,min,pts,3pm,reb,ast,stl,blk,to,fgm,fga,ftm,fta,basis\nJaren Jackson Jr.,50,1500,1000,50,300,100,60,80,90,350,700,250,300,total\n";
    const r = importProjections(csv, players);
    expect(r.rows[0].pts).toBeCloseTo(20, 10);
    expect(r.rows[0].min).toBeCloseTo(30, 10);
  });

  it("reports unmatched players and invalid rows without inventing values", () => {
    const csv = "name,gp,pts,3pm,reb,ast,stl,blk,to,fgm,fga,ftm,fta\nUnknown Guy,70,10,1,1,1,1,1,1,4,8,1,2\nKelel Ware,70,10,,8,1,1,1,1,4,8,1,2\n";
    const r = importProjections(csv, players);
    expect(r.unmatched).toEqual(["Unknown Guy"]);
    expect(r.rows).toHaveLength(0);
    expect(r.issues.some((i) => /3pm|fg3m/i.test(i.message))).toBe(true);
  });

  it("flags makes exceeding attempts", () => {
    const csv = "name,gp,pts,3pm,reb,ast,stl,blk,to,fgm,fga,ftm,fta\nNikola Jokic,70,10,1,1,1,1,1,1,9,8,1,2\n";
    expect(importProjections(csv, players).issues.some((i) => /exceed/.test(i.message))).toBe(true);
  });
});

describe("projection versioning and consensus", () => {
  const setA: ProjectionSet = {
    id: "a",
    label: "A",
    source: "A",
    kind: "external",
    createdAt: "2026-10-01",
    rows: [{ playerId: "nba-1", name: "Nikola Jokić", gp: 70, min: 35, pts: 30, fg3m: 2, reb: 12, ast: 10, stl: 1.5, blk: 1, tov: 3, fgm: 10, fga: 20, ftm: 5, fta: 6 }],
  };
  const setB: ProjectionSet = { ...setA, id: "b", source: "B", rows: [{ ...setA.rows[0], pts: 20, fgm: 2, fga: 4, gp: 60 }] };

  it("consensus averages makes and attempts separately (volume-aware %)", () => {
    const c = consensus([{ set: setA, weight: 1 }, { set: setB, weight: 1 }], "c", "2026-10-02");
    const r = c.rows[0];
    expect(r.fgm / r.fga).toBeCloseTo(6 / 12, 10); // not (50% + 50%)/2 coincidence: makes/attempts
    expect(r.gp).toBeCloseTo(65, 10);
  });

  it("applying a set does not mutate the original players (immutable snapshots)", () => {
    const before = JSON.stringify(players);
    const out = applyProjectionSet(players, setA);
    expect(JSON.stringify(players)).toBe(before);
    expect(out[0].proj!.pts).toBe(30);
    expect(out[0].proj!.source).toBe("A");
    expect(out[1].proj!.flags.some((f) => /model estimate kept/.test(f))).toBe(true);
  });

  it("ADP import matches by name and applies", () => {
    const r = importAdp("Player,ADP\nNikola Jokic,1.4\nNobody,2\n", players);
    expect(r.rows[0].adp).toBe(1.4);
    expect(r.unmatched).toEqual(["Nobody"]);
    expect(applyAdp(players, r.rows)[0].adp).toBe(1.4);
  });

  it("metadata import sets platform eligibility", () => {
    const r = importMetadata("name,positions\nNikola Jokic,C/PF\n", players);
    expect(r.rows[0].elig).toEqual(["C", "PF"]);
  });
});

describe("schedule import and model", () => {
  it("parses common formats and builds weekly counts", () => {
    const csv = "Date,Visitor/Neutral,Home/Neutral\nTue Oct 20 2026,New York Knicks,Boston Celtics\n2026-10-21,BOS,PHI\n";
    const r = importSchedule(csv);
    expect(r.rows).toEqual([
      { date: "2026-10-20", home: "BOS", away: "NYK" },
      { date: "2026-10-21", home: "PHI", away: "BOS" },
    ]);
    const m = buildScheduleModel(r.rows);
    expect(m.gamesInWeek("BOS", 1)).toBe(2);
    expect(m.backToBacks("BOS", [1])).toBe(1);
  });

  it("fantasy weeks run opening night → Sunday, then Monday–Sunday", () => {
    expect(fantasyWeek("2026-10-20")).toBe(1);
    expect(fantasyWeek("2026-10-25")).toBe(1);
    expect(fantasyWeek("2026-10-26")).toBe(2);
    expect(weekRange(1)).toEqual({ start: "2026-10-20", end: "2026-10-25", days: 6 });
    expect(TOTAL_WEEKS).toBe(25);
  });

  it("uniform schedule spreads 82 games across the season", () => {
    const m = buildScheduleModel(null);
    let total = 0;
    for (let w = 1; w <= TOTAL_WEEKS; w++) total += m.gamesInWeek("BOS", w);
    expect(total).toBeCloseTo(82, 6);
  });

  it("team names map to abbreviations", () => {
    expect(teamAbbr("LA Clippers")).toBe("LAC");
    expect(teamAbbr("PHO")).toBe("PHX");
  });
});

describe("projection model", () => {
  it("estimates attempts consistent with the points identity", () => {
    const a = estimateAttempts(25, 2, 0.5, 0.8, 0.35);
    expect(2 * a.fgm + 2 + a.ftm).toBeCloseTo(25, 10);
    expect(a.fgm / a.fga).toBeCloseTo(0.5, 10);
  });

  it("regresses small samples toward league average and returns null for tiny samples", () => {
    const hist = (gp: number, min: number, fgm: number, fga: number) => ({
      season: "2025-26", gp, min, pts: 2 * fgm + 1, fg3m: 1, reb: 4, ast: 2, stl: 1, blk: 0.5, tov: 1, fgm, fga, ftm: 2, fta: 2.5, source: "t", attemptsEstimated: false,
    });
    const league = computeLeagueRates([{ nbaPos: "G", season: hist(70, 30, 6, 13) }, { nbaPos: "F", season: hist(70, 30, 6, 13) }, { nbaPos: "C", season: hist(70, 30, 6, 13) }]);
    expect(projectPlayer({ nbaPos: "G", hist: [hist(2, 10, 3, 3)] }, league)).toBeNull();
    const hot = projectPlayer({ nbaPos: "G", hist: [hist(20, 20, 6, 8)] }, league)!; // 75% on small sample
    expect(hot.fgm / hot.fga).toBeLessThan(0.75);
    expect(hot.fgm / hot.fga).toBeGreaterThan(6 / 13);
    expect(hot.kind).toBe("estimate");
  });

  it("player changing teams gets wider uncertainty", () => {
    const h = { season: "2025-26", gp: 70, min: 30, pts: 20, fg3m: 2, reb: 5, ast: 4, stl: 1, blk: 0.5, tov: 2, fgm: 7, fga: 15, ftm: 4, fta: 5, source: "t", attemptsEstimated: false };
    const league = computeLeagueRates(["G", "F", "C"].map((nbaPos) => ({ nbaPos, season: h })));
    const same = projectPlayer({ nbaPos: "G", hist: [h] }, league)!;
    const moved = projectPlayer({ nbaPos: "G", hist: [h], teamChange: { from: "A", to: "B", type: "trade", confidence: "high", sourceName: "x", sourceUrl: "x" } }, league)!;
    expect(moved.sd.pts!).toBeGreaterThan(same.sd.pts!);
    expect(moved.flags.some((f) => /New team/.test(f))).toBe(true);
  });
});
