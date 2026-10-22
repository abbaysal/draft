import { describe, expect, it } from "vitest";
import dataset from "@/data/dataset.generated.json";
import type { Dataset } from "@/lib/types";
import { LEAGUE_PRESETS } from "@/lib/league";
import { parseLeagueRosters } from "@/lib/import/yahoo-paste";

const ds = dataset as unknown as Dataset;
const names = LEAGUE_PRESETS[0].settings.teamNames;
const pool = ds.players.filter((p) => p.proj).slice(0, 156);

function page(renamedIndex: number): string {
  const out: string[] = ["BİLLUR CUP", "League Rosters"];
  names.forEach((n, t) => {
    out.push(t === renamedIndex ? "İlker & Ahmet" : n, "Manager Name", "Pos\tPlayer\tStatus\tOpp");
    pool.slice(t * 13, t * 13 + 13).forEach((p, k) => out.push(`${k < 10 ? "Util" : "BN"}\t${p.name}${k === 2 ? " O" : ""}\n${p.team} - ${p.elig.join(",")}\t\t7:30 pm @ BKN`));
  });
  return out.join("\n");
}

describe("Yahoo league rosters paste", () => {
  it("finds all 156 rostered players in 12 groups and maps known team names", () => {
    const r = parseLeagueRosters(page(2), ds.players, names);
    expect(r.rostered).toHaveLength(156);
    expect(r.groups).toHaveLength(12);
    expect(r.groups.every((g) => g.players.length === 13)).toBe(true);
    expect(r.groups[0].teamIndex).toBe(0);
    expect(r.groups[11].teamIndex).toBe(11);
    // Renamed team on Yahoo: left for the user to map, but its players are still rostered.
    expect(r.groups[2].teamIndex).toBe(-1);
    expect(r.groups[2].label).toBe("İlker & Ahmet");
    expect(r.groups[2].players[0]).toBe(pool[26].id);
  });
});
