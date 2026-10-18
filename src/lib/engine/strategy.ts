/**
 * Punt / build strategy engine.
 *
 * A strategy is a drafting RULE: rank players by Σ_c w_c·z_ic (punted categories
 * w=0, soft punts 0 < w < 1). Each strategy is evaluated by completing the draft
 * from the CURRENT state many times (opponents follow the market model, my picks
 * follow the strategy) and scoring the realised final rosters with the league's
 * TRUE objective over ALL league categories — so a punt only wins if giving up a
 * category actually yields more expected category wins / matchup wins / roto
 * points. Common random numbers make strategy differences low-noise.
 */
import { CAT_BY_KEY, CAT_KEYS, describeWeights, uniformWeights, type CategoryWeights } from "../categories";
import { startingSlots } from "../league";
import { matchLineup, slotAccepts } from "../positions";
import type { CategoryKey } from "../types";
import { usageFor, type AnalysisContext } from "./context";
import { createRng, hashSeed } from "./math";
import { newSimDraft, opponentPick, takeIndex, teamTendencies } from "./market";
import { addInto, emptyAgg, evaluateVsField, objectiveValue } from "./team";

export interface StrategyDef {
  key: string;
  label: string;
  kind: "balanced" | "single" | "double" | "triple" | "soft" | "custom";
  weights: CategoryWeights;
}

export function strategyCatalog(cats: CategoryKey[]): StrategyDef[] {
  const base = uniformWeights(cats);
  const out: StrategyDef[] = [{ key: "balanced", label: "Balanced", kind: "balanced", weights: base }];
  const mk = (punts: CategoryKey[], kind: StrategyDef["kind"]) => {
    const w = { ...base };
    for (const p of punts) w[p] = 0;
    return { key: `punt:${punts.join("+")}`, label: describeWeights(w), kind, weights: w };
  };
  for (const c of cats) out.push(mk([c], "single"));
  for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) out.push(mk([cats[i], cats[j]], "double"));
  const triples: CategoryKey[][] = [
    ["ftPct", "fg3m", "ast"],
    ["fgPct", "reb", "blk"],
    ["ftPct", "ast", "tov"],
    ["pts", "ftPct", "tov"],
    ["fgPct", "ftPct", "tov"],
  ];
  for (const t of triples) if (t.every((c) => cats.includes(c))) out.push(mk(t, "triple"));
  for (const c of ["ftPct", "fgPct", "tov", "ast", "fg3m"] as CategoryKey[]) {
    if (!cats.includes(c)) continue;
    const w = { ...base, [c]: 0.4 };
    out.push({ key: `soft:${c}`, label: `Soft punt ${CAT_BY_KEY[c].short} (×0.4)`, kind: "soft", weights: w });
  }
  return out;
}

export interface StrategyResult {
  key: string;
  label: string;
  kind: StrategyDef["kind"];
  weights: CategoryWeights;
  runs: number;
  meanObj: number;
  sdObj: number;
  /** Paired difference vs balanced and its standard error. */
  deltaVsBalanced: number;
  deltaSe: number;
  perCategory: Record<string, number>;
  expectedCatWins: number;
  matchupWinProb: number;
  targets: string[];
  sampleRoster: string[];
}

export interface StrategyRunOptions {
  runs?: number;
  seed?: number;
  strategies?: StrategyDef[];
}

export function evaluateStrategies(ctx: AnalysisContext, opts: StrategyRunOptions = {}): StrategyResult[] {
  const runs = opts.runs ?? 16;
  const seed = opts.seed ?? hashSeed("strategy", ctx.overall, ctx.draft.version);
  const strategies = opts.strategies ?? strategyCatalog(ctx.cats);
  const tendencies = teamTendencies(ctx);
  const shape = { teams: ctx.settings.teams, rounds: ctx.settings.rounds, draftType: ctx.settings.draftType };
  const owners: number[] = [];
  for (let o = ctx.overall; o <= ctx.totalPicks; o++) {
    const round = Math.floor((o - 1) / shape.teams) + 1;
    const idx = (o - 1) % shape.teams;
    owners.push(ctx.draft.ownerOverrides[o] ?? (shape.draftType === "snake" && round % 2 === 0 ? shape.teams - 1 - idx : idx));
  }
  const remainingAfter = owners.map((t, k) => owners.slice(k).filter((x) => x === t).length);
  const slots = startingSlots(ctx.settings);
  const ids = ctx.available;
  const objs: number[][] = strategies.map(() => []);
  const results: StrategyResult[] = strategies.map((s) => ({
    key: s.key,
    label: s.label,
    kind: s.kind,
    weights: s.weights,
    runs: 0,
    meanObj: 0,
    sdObj: 0,
    deltaVsBalanced: 0,
    deltaSe: 0,
    perCategory: Object.fromEntries(ctx.cats.map((c) => [c, 0])),
    expectedCatWins: 0,
    matchupWinProb: 0,
    targets: [],
    sampleRoster: [],
  }));

  strategies.forEach((st, si) => {
    // Per-game strategy value, discounted by projected availability (a per-game star who
    // misses half the season contributes half as many weekly games).
    const wv = ids.map((id) => {
      const v = ctx.values.get(id);
      const gp = ctx.lines.get(id)?.gp ?? 0;
      if (!v) return -99;
      const raw = CAT_KEYS.reduce((a, c) => a + st.weights[c] * v.cat[c], 0);
      const avail = Math.min(1, gp / 72);
      return ctx.settings.valuationBasis === "season" ? raw : raw >= 0 ? raw * avail : raw * (2 - avail);
    });
    const order = ids.map((_, i) => i).sort((a, b) => wv[b] - wv[a]);
    results[si].targets = order.slice(0, 8).map((i) => ids[i]);
    for (let r = 0; r < runs; r++) {
      const rng = createRng(hashSeed(seed, r));
      const sim = newSimDraft(ctx);
      for (let k = 0; k < owners.length; k++) {
        const t = owners[k];
        let idx = -1;
        if (t === ctx.myIndex) {
          let must: typeof slots | null = null;
          if (remainingAfter[k] <= 4) {
            const { assignment } = matchLineup(slots, sim.eligs[t]);
            const open = slots.filter((_, i) => assignment[i] === -1);
            if (open.length >= remainingAfter[k] && open.length) must = open;
          }
          for (const i of order) {
            if (sim.taken[i]) continue;
            if (must && !must.some((s) => slotAccepts(s, ctx.byId.get(ids[i])!.elig))) continue;
            idx = i;
            break;
          }
          if (idx < 0) for (const i of order) if (!sim.taken[i]) { idx = i; break; }
        } else idx = opponentPick(ctx, sim, t, remainingAfter[k], tendencies, rng);
        if (idx < 0) break;
        takeIndex(sim, ctx, t, idx);
      }
      const aggs = sim.rosters.map((rs) => {
        const u = usageFor(ctx, rs);
        const a = emptyAgg();
        rs.forEach((id, i) => addInto(a, ctx.weekContrib(id, u[i])));
        return a;
      });
      const ev = evaluateVsField(aggs[ctx.myIndex], aggs.map((agg, index) => ({ index, agg })).filter((o) => o.index !== ctx.myIndex), ctx.cats);
      const obj = objectiveValue(ev, ctx.settings.format);
      objs[si].push(obj);
      const res = results[si];
      res.runs++;
      for (const c of ctx.cats) res.perCategory[c] += ev.perCategory[c] / runs;
      res.expectedCatWins += ev.expectedCatWins / runs;
      res.matchupWinProb += ev.matchupWinProb / runs;
      if (r === 0) res.sampleRoster = sim.rosters[ctx.myIndex].slice(ctx.rosters[ctx.myIndex].length);
    }
  });
  const balIdx = strategies.findIndex((s) => s.kind === "balanced");
  results.forEach((res, si) => {
    const xs = objs[si];
    const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    res.meanObj = m;
    res.sdObj = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
    if (balIdx >= 0) {
      const ds = xs.map((x, i) => x - objs[balIdx][i]);
      const dm = ds.reduce((a, b) => a + b, 0) / Math.max(1, ds.length);
      res.deltaVsBalanced = dm;
      res.deltaSe = Math.sqrt(ds.reduce((a, b) => a + (b - dm) ** 2, 0) / Math.max(1, ds.length - 1) / Math.max(1, ds.length));
    }
  });
  return results.sort((a, b) => b.meanObj - a.meanObj);
}

export interface StrategyAdvice {
  recommended: StrategyResult;
  commit: boolean;
  message: string;
  flexibility: number;
}

/**
 * Commitment rule: only advise committing to a punt when (a) it beats balanced by
 * more than 2 SE, (b) we are past round 3 (early punts close doors cheaply avoided),
 * and (c) it is not a double/triple punt unless it beats the best single punt too.
 */
export function strategyAdvice(results: StrategyResult[], round: number): StrategyAdvice | null {
  if (!results.length) return null;
  const best = results[0];
  const balanced = results.find((r) => r.kind === "balanced");
  const tolerance = best.sdObj * 0.1 + 0.02;
  const flexibility = results.filter((r) => best.meanObj - r.meanObj <= tolerance).length;
  if (!balanced || best.kind === "balanced")
    return { recommended: best, commit: false, flexibility, message: "Balanced build projects best — keep drafting for overall category wins." };
  const significant = best.deltaVsBalanced > 2 * best.deltaSe;
  const bestSingle = results.find((r) => r.kind === "single" || r.kind === "soft");
  const multiOk = best.kind !== "double" && best.kind !== "triple" ? true : !!bestSingle && best.meanObj - bestSingle.meanObj > 2 * best.deltaSe;
  const commit = significant && round > 3 && multiOk;
  const message = commit
    ? `${best.label} projects +${best.deltaVsBalanced.toFixed(3)} over balanced (±${best.deltaSe.toFixed(3)}). The evidence supports leaning into it.`
    : significant
      ? `${best.label} edges balanced (+${best.deltaVsBalanced.toFixed(3)}), but it is round ${round}${!multiOk ? " and a multi-category punt is not clearly better than a single punt" : ""} — stay flexible and favour players who fit both builds.`
      : `No build beats balanced by a statistically meaningful margin (best: ${best.label}, +${best.deltaVsBalanced.toFixed(3)} ± ${best.deltaSe.toFixed(3)}). Stay flexible.`;
  return { recommended: best, commit, message, flexibility };
}
