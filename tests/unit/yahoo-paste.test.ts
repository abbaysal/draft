import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import dataset from "@/data/dataset.generated.json";
import type { Dataset } from "@/lib/types";
import { isOutFlag, parseYahooPaste } from "@/lib/import/yahoo-paste";

const ds = dataset as unknown as Dataset;
const text = readFileSync(join(__dirname, "../fixtures/yahoo_matchup_week1.txt"), "utf8");

describe("Yahoo matchup paste", () => {
  const r = parseYahooPaste(text, ds.players);

  it("reads both rosters in order with slots, teams, positions and flags", () => {
    expect(r.kind).toBe("matchup");
    expect(r.week).toBe(1);
    expect(r.left.map((x) => x.name)).toEqual([
      "Shai Gilgeous-Alexander", "Kawhi Leonard", "Desmond Bane", "Kon Knueppel", "Bam Adebayo", "Josh Hart", "Myles Turner",
      "VJ Edgecombe", "Miles Bridges", "Nikola Vučević", "Devin Vassell", "Julian Champagnie", "DeMar DeRozan",
    ]);
    expect(r.right).toHaveLength(13);
    expect(r.right[0].name).toBe("Anthony Edwards");
    expect(r.left[3]).toMatchObject({ status: "O", team: "CHA", slot: "SF" });
    expect(r.left[1].positions).toEqual(["SG", "SF", "PF"]);
    expect(r.left[12].slot).toBe("BN");
    expect(r.right[8]).toMatchObject({ name: "Brandon Ingram", status: "O", slot: "UTIL" });
    expect(isOutFlag(r.left[3].status)).toBe(true);
    expect(r.unmatched).toEqual([]);
  });

  it("reads week-to-date totals and games played", () => {
    expect(r.totals[0]).toMatchObject({ fgm: 27, fga: 63, ftm: 8, fta: 11, fg3m: 8, pts: 70, reb: 23, ast: 10, stl: 7, blk: 7, tov: 5, score: 3 });
    expect(r.totals[1]).toMatchObject({ fgm: 25, fga: 44, pts: 71, ast: 16, blk: 1, tov: 7, score: 5 });
    expect(r.games).toEqual({ leftPlayed: 5, leftTotal: 35, rightPlayed: 3, rightTotal: 23 });
  });

  it("a plain roster paste (My Team page) puts everyone on one side", () => {
    const one = parseYahooPaste("PG\tShai Gilgeous-Alexander\nOKC - PG\nC\tMyles Turner\nMIL - C\n", ds.players);
    expect(one.kind).toBe("roster");
    expect(one.left.map((x) => [x.name, x.slot])).toEqual([["Shai Gilgeous-Alexander", "PG"], ["Myles Turner", "C"]]);
  });
});
