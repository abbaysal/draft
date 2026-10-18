import { describe, expect, it } from "vitest";
import { puntWeights, uniformWeights } from "@/lib/categories";
import { buildBaseline, rawCategory, rankShifts, teamPct, valuePlayers, DEFAULT_VALUATION } from "@/lib/engine/valuation";
import { mkPlayer, syntheticPool } from "./helpers";

const cfg = { ...DEFAULT_VALUATION, poolSize: 120 };

describe("z-score valuation", () => {
  const pool = syntheticPool();
  const base = buildBaseline(pool, cfg);
  const vals = valuePlayers(pool, base);

  it("normalises counting categories to mean 0 / sd 1 over the draftable pool", () => {
    const inPool = base.poolIds.map((id) => vals.get(id)!);
    for (const c of ["pts", "reb", "ast", "stl", "blk", "fg3m"] as const) {
      const xs = inPool.map((v) => v.cat[c]);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
      expect(Math.abs(m)).toBeLessThan(1e-9);
      expect(Math.sqrt(v)).toBeCloseTo(1, 6);
    }
  });

  it("reverses turnovers: fewer turnovers produce higher value", () => {
    const low = mkPlayer({ tov: 0.8 });
    const high = mkPlayer({ tov: 4.0 });
    const v = valuePlayers([...pool, low, high], base);
    expect(v.get(low.id)!.cat.tov).toBeGreaterThan(0);
    expect(v.get(high.id)!.cat.tov).toBeLessThan(0);
    expect(v.get(low.id)!.cat.tov).toBeGreaterThan(v.get(high.id)!.cat.tov);
  });

  it("weights FG% by volume: impact = FGM − baseline% × FGA", () => {
    const lowVol = mkPlayer({ fgm: 2.4, fga: 4 }); // 60% on 4 attempts
    const highVol = mkPlayer({ fgm: 12, fga: 20 }); // 60% on 20 attempts
    const v = valuePlayers([...pool, lowVol, highVol], base);
    expect(rawCategory(highVol.proj!, 70, "fgPct", "perGame", base.fgPct, base.ftPct)).toBeCloseTo(12 - base.fgPct * 20, 10);
    expect(v.get(highVol.id)!.cat.fgPct).toBeGreaterThan(v.get(lowVol.id)!.cat.fgPct * 4.9);
  });

  it("extremely high-volume poor FT shooter is heavily penalised; low-volume good shooter barely helps", () => {
    const brick = mkPlayer({ ftm: 6, fta: 10 }); // 60% on 10 FTA
    const sniper = mkPlayer({ ftm: 0.95, fta: 1 }); // 95% on 1 FTA
    const v = valuePlayers([...pool, brick, sniper], base);
    expect(v.get(brick.id)!.cat.ftPct).toBeLessThan(-3);
    expect(v.get(sniper.id)!.cat.ftPct).toBeGreaterThan(0);
    expect(v.get(sniper.id)!.cat.ftPct).toBeLessThan(1.5);
  });

  it("handles zero shot attempts without NaN", () => {
    const zero = mkPlayer({ fgm: 0, fga: 0, ftm: 0, fta: 0, pts: 0 });
    const v = valuePlayers([...pool, zero], base).get(zero.id)!;
    for (const x of Object.values(v.cat)) expect(Number.isFinite(x)).toBe(true);
    expect(v.cat.fgPct).toBeCloseTo((0 - base.mean.fgPct) / base.sd.fgPct, 10);
  });

  it("excludes players with missing projections", () => {
    const missing = { ...mkPlayer({}), proj: null };
    const v = valuePlayers([...pool, missing], base);
    expect(v.has(missing.id)).toBe(false);
  });

  it("punts zero the punted category without re-centering the baseline", () => {
    const punted = valuePlayers(pool, base, puntWeights(["ftPct", "tov"]));
    const id = pool[3].id;
    const a = vals.get(id)!;
    const b = punted.get(id)!;
    // Per-category z-scores are identical (same baseline); only the weighted total changes.
    for (const c of Object.keys(a.cat)) expect(b.cat[c as keyof typeof a.cat]).toBeCloseTo(a.cat[c as keyof typeof a.cat], 12);
    expect(b.total).toBeCloseTo(a.total - a.cat.ftPct - a.cat.tov, 10);
  });

  it("supports several categories punted and soft weights", () => {
    const w = { ...puntWeights(["ftPct", "fg3m", "ast"]), tov: 0.5 };
    const v = valuePlayers(pool, base, w);
    const p = pool[10].id;
    const a = vals.get(p)!;
    const expected = a.total - a.cat.ftPct - a.cat.fg3m - a.cat.ast - 0.5 * a.cat.tov;
    expect(v.get(p)!.total).toBeCloseTo(expected, 10);
  });

  it("reports rank shifts between strategies", () => {
    const shifts = rankShifts(vals, valuePlayers(pool, base, puntWeights(["ftPct"])));
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts[0].delta).toBeGreaterThanOrEqual(shifts[shifts.length - 1].delta);
  });

  it("computes replacement level from players just outside the pool", () => {
    expect(base.replacementTotal).toBeLessThan(vals.get(base.poolIds[0])!.total);
    const v = vals.get(base.poolIds[0])!;
    expect(v.vorp).toBeCloseTo(v.total - base.replacementTotal, 6);
  });

  it("G-scores shrink high within-player-variance categories (steals) more than points", () => {
    const g = buildBaseline(pool, { ...cfg, method: "g" });
    expect(g.gFactor.stl).toBeLessThan(g.gFactor.pts);
    for (const f of Object.values(g.gFactor)) expect(f).toBeGreaterThan(0);
  });

  it("season-total basis rewards games played", () => {
    const sb = buildBaseline(pool, { ...cfg, basis: "season" });
    const durable = mkPlayer({ gp: 80 });
    const fragile = mkPlayer({ gp: 40 });
    const v = valuePlayers([...pool, durable, fragile], sb);
    expect(v.get(durable.id)!.total).toBeGreaterThan(v.get(fragile.id)!.total);
  });
});

describe("team percentages", () => {
  it("aggregates makes and attempts — never averages percentages", () => {
    // 1/1 (100%) + 40/100 (40%) => 41/101 = 40.6%, not the 70% simple average.
    expect(teamPct([{ m: 1, a: 1 }, { m: 40, a: 100 }])).toBeCloseTo(41 / 101, 12);
    expect(teamPct([{ m: 0, a: 0 }])).toBeNull();
  });
});

describe("uniform weights", () => {
  it("respects league category exclusions", () => {
    const w = uniformWeights(["pts", "reb"]);
    expect(w.pts).toBe(1);
    expect(w.ast).toBe(0);
  });
});
