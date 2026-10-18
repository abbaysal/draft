import { describe, expect, it } from "vitest";
import dataset from "@/data/dataset.generated.json";
import type { Dataset } from "@/lib/types";
import { LEAGUE_PRESETS } from "@/lib/league";
import { buildContext } from "@/lib/engine/context";
import { EMPTY_DRAFT } from "@/lib/engine/draft";
import { advancedLine, categoryRanks, per36, seasonValues, similarPlayers, strengths, valueTrend } from "@/lib/engine/profile";

const ds = dataset as unknown as Dataset;
const ctx = buildContext({ players: ds.players, settings: LEAGUE_PRESETS[0].settings, draft: EMPTY_DRAFT });
const jokic = ds.players.find((p) => p.name.startsWith("Nikola Joki"))!;

describe("player profile analytics", () => {
  it("dataset carries the new 2025-26 detail and playoff history", () => {
    const h = jokic.hist.find((x) => x.season === "2025-26")!;
    expect(h.fg3a).toBeGreaterThan(h.fg3m);
    expect(h.oreb! + h.dreb!).toBeCloseTo(h.reb, 6);
    expect(h.wins! + h.losses!).toBe(h.gp);
    expect(jokic.playoffs?.length).toBeGreaterThan(0);
    expect(jokic.country).toBe("Serbia");
  });

  it("advanced line uses standard formulas", () => {
    const a = advancedLine(jokic)!;
    const h = jokic.hist.find((x) => x.season === "2025-26")!;
    expect(a.basis).toBe("2025-26 actual");
    expect(a.ts!).toBeCloseTo(h.pts / (2 * (h.fga + 0.44 * h.fta)), 9);
    expect(a.fg3Pct!).toBeCloseTo(h.fg3m / h.fg3a!, 9);
    expect(a.ts!).toBeGreaterThan(0.5);
    expect(a.ts!).toBeLessThan(0.8);
    expect(per36(jokic)!.reb).toBeGreaterThan(jokic.proj!.reb);
  });

  it("category ranks are a permutation per category", () => {
    const r = categoryRanks(ctx);
    for (const c of ctx.cats) {
      const ranks = [...r.values()].map((x) => x[c]).sort((a, b) => a - b);
      expect(ranks[0]).toBe(1);
      expect(new Set(ranks).size).toBe(ranks.length);
    }
    expect(r.get(jokic.id)!.reb).toBeLessThanOrEqual(10);
  });

  it("season values, trend, archetype and similar players", () => {
    const sv = seasonValues(ctx).get(jokic.id)!;
    expect(sv.map((x) => x.season)).toEqual(["2023-24", "2024-25", "2025-26"]);
    expect(sv.every((x) => x.value > 3)).toBe(true);
    expect(valueTrend(sv)).not.toBeNull();
    expect(valueTrend([{ season: "x", value: 1 }])).toBeNull();
    expect(strengths(ctx, jokic.id).strengths.length).toBeGreaterThan(0);
    const sim = similarPlayers(ctx, jokic.id);
    expect(sim).toHaveLength(6);
    expect(sim.some((x) => x.id === jokic.id)).toBe(false);
  });
});
