import { describe, expect, it } from "vitest";
import { catDist, catWinProb, contribution, matchupWinProb, sumAggs } from "@/lib/engine/team";
import { poissonBinomial } from "@/lib/engine/math";
import type { PlayerLine } from "@/lib/engine/team";
import { mkPlayer } from "./helpers";
import { CAT_KEYS } from "@/lib/categories";

const line = (p: ReturnType<typeof mkPlayer>): PlayerLine => ({ id: p.id, line: p.proj!, gp: p.proj!.gp, gpSd: p.proj!.gpSd, sd: p.proj!.sd, team: p.team });
const opts = { scheduled: 3.5, usage: 1 };

describe("team aggregation", () => {
  it("team FG% = Σmakes/Σattempts (volume weighted)", () => {
    const a = mkPlayer({ fgm: 1, fga: 1, gp: 82 });
    const b = mkPlayer({ fgm: 4, fga: 10, gp: 82 });
    const agg = sumAggs([contribution(line(a), opts), contribution(line(b), opts)]);
    expect(catDist(agg, "fgPct").mean).toBeCloseTo(5 / 11, 10);
  });

  it("identical teams split every category 50/50", () => {
    const team = [mkPlayer({}), mkPlayer({ pts: 25 })].map((p) => contribution(line(p), opts));
    const A = sumAggs(team);
    const B = sumAggs(team);
    for (const c of CAT_KEYS) expect(catWinProb(A, B, c)).toBeCloseTo(0.5, 10);
  });

  it("P(A beats B) + P(B beats A) = 1 and turnovers favour the lower team", () => {
    const A = sumAggs([contribution(line(mkPlayer({ tov: 1 })), opts)]);
    const B = sumAggs([contribution(line(mkPlayer({ tov: 4, pts: 30 })), opts)]);
    for (const c of CAT_KEYS) expect(catWinProb(A, B, c) + catWinProb(B, A, c)).toBeCloseTo(1, 10);
    expect(catWinProb(A, B, "tov")).toBeGreaterThan(0.5);
    expect(catWinProb(A, B, "pts")).toBeLessThan(0.5);
  });

  it("injured players (gp 0) contribute nothing", () => {
    const out = contribution(line(mkPlayer({ gp: 0, pts: 40 })), opts);
    expect(catDist(out, "pts").mean).toBe(0);
  });

  it("matchup win probability is consistent with the category distribution", () => {
    expect(matchupWinProb(new Array(9).fill(0.5))).toBeCloseTo(0.5, 10);
    expect(matchupWinProb(new Array(9).fill(0.9))).toBeGreaterThan(0.99);
    const dist = poissonBinomial([0.2, 0.5, 0.9]);
    expect(dist.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});
