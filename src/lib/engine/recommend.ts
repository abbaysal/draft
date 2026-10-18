/**
 * Fast (live) recommendation engine — fallback level 2 of the decision hierarchy.
 *
 *  gain(X)       = Obj(my roster + X + expected future fills) − Obj(my roster + fills)
 *                  where Obj is format-aware (expected category wins per week for
 *                  H2H each-category, matchup win probability for most-categories,
 *                  expected roto points for rotisserie) against the PROJECTED FINAL
 *                  rosters of every opponent (current picks + expected fills).
 *  strategic(X)  = E_s[ max_{Y available at my next pick in sample s} Obj(roster + X + Y + fills) ] − Obj_base
 *                  i.e. a two-pick lookahead over Monte Carlo opponent behaviour
 *                  (pick-now-vs-wait). This is the primary FAST ranking.
 *  score(X)      = strategic(X) − λ · downside(X)   (λ = league risk aversion)
 *
 * The deep championship simulation (championship.ts) re-ranks the leaders by
 * Δ P(championship) when it is statistically separable.
 */
import { CAT_BY_KEY } from "../categories";
import type { CategoryKey } from "../types";
import type { AvailabilityResult } from "./availability";
import { rosterAgg, usageFor, type AnalysisContext } from "./context";
import { makeFillProvider, teamFills } from "./market";
import { categoryScarcity, type CategoryScarcity } from "./scarcity";
import { addInto, contribution, emptyAgg, evaluateVsField, objectiveValue, type Agg, type FieldEvaluation, type PlayerLine } from "./team";

export interface ProjectedField {
  opponents: { index: number; agg: Agg }[];
  myCurrent: string[];
  myFills: Agg[]; // all my remaining picks
  baseline: FieldEvaluation;
  baselineObj: number;
  /** Projected final aggregate per team (current + expected fills), including mine. */
  teamAggs: Agg[];
}

export function projectField(ctx: AnalysisContext): ProjectedField {
  const fill = makeFillProvider(ctx);
  const teamAggs: Agg[] = [];
  const opponents: { index: number; agg: Agg }[] = [];
  for (let t = 0; t < ctx.settings.teams; t++) {
    const agg = rosterAgg(ctx, ctx.rosters[t], teamFills(ctx, t, fill));
    teamAggs.push(agg);
    if (t !== ctx.myIndex) opponents.push({ index: t, agg });
  }
  const myFills = teamFills(ctx, ctx.myIndex, fill);
  const baseline = evaluateVsField(teamAggs[ctx.myIndex], opponents, ctx.cats);
  return {
    opponents,
    myCurrent: ctx.rosters[ctx.myIndex],
    myFills,
    baseline,
    baselineObj: objectiveValue(baseline, ctx.settings.format),
    teamAggs,
  };
}

export function myAggWith(ctx: AnalysisContext, field: ProjectedField, add: string[], overrides?: Map<string, PlayerLine>): Agg {
  const ids = [...field.myCurrent, ...add];
  const usage = usageFor(ctx, ids);
  const agg = emptyAgg();
  ids.forEach((id, i) => {
    const o = overrides?.get(id);
    addInto(agg, o ? contribution(o, { scheduled: ctx.gamesPerWeek(o.team), usage: usage[i] }) : ctx.weekContrib(id, usage[i]));
  });
  for (const f of field.myFills.slice(add.length)) addInto(agg, f);
  return agg;
}

export function evaluateRoster(ctx: AnalysisContext, field: ProjectedField, add: string[], overrides?: Map<string, PlayerLine>) {
  const ev = evaluateVsField(myAggWith(ctx, field, add, overrides), field.opponents, ctx.cats);
  return { ev, obj: objectiveValue(ev, ctx.settings.format) };
}

export interface CandidateEval {
  id: string;
  valueRank: number;
  marketRank: number;
  adp: number | null;
  gain: number;
  strategic: number;
  survival: number;
  expectedPick?: number;
  downside: number;
  upside: number;
  catImpact: Record<string, number>;
  score: number;
  reasons: string[];
}

export type PickKind = "bestOverall" | "bestFit" | "bestStrategic" | "bestValueAdp" | "bestScarcity" | "bestUpside" | "bestLowRisk";

export interface RecommendationSet {
  metricLevel: 2;
  metricName: string;
  objectiveName: string;
  baselineObj: number;
  myTurn: boolean;
  candidates: CandidateEval[];
  picks: Partial<Record<PickKind, { id: string; why: string }>>;
  likelySurvivors: { id: string; survival: number; gain: number }[];
  scarcity: CategoryScarcity[];
  field: ProjectedField;
  notes: string[];
}

function scaledLine(ctx: AnalysisContext, id: string, gpQ: number, prodQ: number): PlayerLine {
  const l = ctx.lines.get(id)!;
  const cv = l.line.pts > 0 ? (l.sd.pts ?? 0) / l.line.pts : 0.15;
  const k = Math.max(0.3, 1 + prodQ * cv);
  const line = { ...l.line };
  for (const key of ["pts", "fg3m", "reb", "ast", "stl", "blk", "fgm", "fga", "ftm", "fta", "tov"] as const) line[key] *= k;
  return { ...l, line, gp: Math.max(0, Math.min(82, l.gp + gpQ * l.gpSd)) };
}

const fmtPct = (x: number) => `${(x * 100).toFixed(0)}%`;

export function recommend(ctx: AnalysisContext, avail: AvailabilityResult | null, opts: { pool?: number; pairs?: number } = {}): RecommendationSet {
  const field = projectField(ctx);
  const format = ctx.settings.format;
  const myTurn = ctx.onClock === ctx.myIndex;
  const hasNext = myTurn ? ctx.myNextPicks.length > 1 : ctx.myNextPicks.length > 0;
  const λ = ctx.settings.riskAversion;
  const notes: string[] = [];

  // Candidate pool: best by value ∪ best by market (keeps the computation bounded).
  const byValue = [...ctx.available].sort((a, b) => (ctx.values.get(a)?.rank ?? 1e9) - (ctx.values.get(b)?.rank ?? 1e9));
  const poolN = opts.pool ?? 45;
  const pool = [...new Set([...byValue.slice(0, poolN), ...ctx.available.slice(0, poolN)])];

  const evals = new Map<string, { obj: number; ev: FieldEvaluation }>();
  for (const id of pool) evals.set(id, evaluateRoster(ctx, field, [id]));
  const gainOf = (id: string) => evals.get(id)!.obj - field.baselineObj;
  const ranked = pool.sort((a, b) => gainOf(b) - gainOf(a));

  // Two-pick lookahead (pick now vs wait).
  const K = Math.min(ranked.length, opts.pairs ?? 18);
  const M = Math.min(ranked.length, 26);
  const strategic = new Map<string, number>();
  if (hasNext && avail && myTurn) {
    const ys = ranked.slice(0, M);
    const trackIdx = new Map(avail.tracked.map((id, j) => [id, j]));
    for (const x of ranked.slice(0, K)) {
      const pairObj = ys.map((y) => (y === x ? -Infinity : evaluateRoster(ctx, field, [x, y]).obj));
      let acc = 0;
      for (let s = 0; s < avail.sims; s++) {
        let best = evals.get(x)!.obj; // if every tracked Y is gone, fall back to X + generic fill
        for (let j = 0; j < ys.length; j++) {
          const ti = trackIdx.get(ys[j]);
          const gone = ti != null && avail.taken[s * avail.tracked.length + ti] === 1;
          if (!gone && pairObj[j] > best) best = pairObj[j];
        }
        acc += best;
      }
      strategic.set(x, acc / avail.sims - field.baselineObj);
    }
  } else {
    if (!myTurn) notes.push("You are not on the clock: rankings show value for your next pick with survival odds to that pick.");
    if (!hasNext && myTurn) notes.push("This is your final pick — no lookahead needed.");
  }

  const scarcity = categoryScarcity(ctx, avail?.survival);
  const scarcityIdx = Object.fromEntries(scarcity.map((s) => [s.cat, s.scarcityIndex])) as Record<CategoryKey, number>;

  const candidates: CandidateEval[] = ranked.map((id) => {
    const p = ctx.byId.get(id)!;
    const v = ctx.values.get(id)!;
    const ev = evals.get(id)!.ev;
    const gain = gainOf(id);
    const isTop = ranked.indexOf(id) < K;
    let downside = 0;
    let upside = 0;
    if (isTop) {
      const dn = evaluateRoster(ctx, field, [id], new Map([[id, scaledLine(ctx, id, -1.28, -1.28)]])).obj;
      const up = evaluateRoster(ctx, field, [id], new Map([[id, scaledLine(ctx, id, 1.28, 1.28)]])).obj;
      downside = Math.max(0, evals.get(id)!.obj - dn);
      upside = Math.max(0, up - evals.get(id)!.obj);
    }
    const catImpact: Record<string, number> = {};
    for (const c of ctx.cats) catImpact[c] = ev.perCategory[c] - field.baseline.perCategory[c];
    const strat = strategic.get(id) ?? gain;
    const survival = avail?.survival.get(id) ?? 1;
    const reasons: string[] = [];
    const ups = ctx.cats.filter((c) => catImpact[c] > 0.005).sort((a, b) => catImpact[b] - catImpact[a]).slice(0, 3);
    const downs = ctx.cats.filter((c) => catImpact[c] < -0.005).sort((a, b) => catImpact[a] - catImpact[b]).slice(0, 2);
    if (ups.length) reasons.push(`Boosts ${ups.map((c) => `${CAT_BY_KEY[c].short} (+${(catImpact[c] * 100).toFixed(1)} pts win%)`).join(", ")}`);
    if (downs.length) reasons.push(`Costs ${downs.map((c) => `${CAT_BY_KEY[c].short} (${(catImpact[c] * 100).toFixed(1)})`).join(", ")}`);
    if (avail && myTurn && hasNext) reasons.push(`${fmtPct(survival)} chance he survives to your next pick`);
    if (p.availability && p.availability.status !== "HEALTHY") reasons.push(`Availability: ${p.availability.status.replace("_", " ").toLowerCase()} (${p.availability.injury ?? ""})`);
    if (p.proj && p.proj.confidence < 0.5) reasons.push(`Low projection confidence (${fmtPct(p.proj.confidence)})`);
    return {
      id,
      valueRank: v.rank,
      marketRank: ctx.marketRank.get(id) ?? 999,
      adp: p.adp ?? null,
      gain,
      strategic: strat,
      survival,
      expectedPick: avail?.expectedPick.get(id),
      downside,
      upside,
      catImpact,
      score: strat - λ * downside,
      reasons,
    };
  });
  candidates.sort((a, b) => b.score - a.score);

  const picks: RecommendationSet["picks"] = {};
  const top = candidates.slice(0, K);
  const byKey = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, b) => (f(b) > f(a) ? b : a), arr[0]);
  if (candidates.length) {
    const bo = byValue.find((id) => ctx.lines.has(id));
    if (bo) picks.bestOverall = { id: bo, why: `Highest league-wide ${ctx.settings.valuationMethod.toUpperCase()}-score value (rank #${ctx.values.get(bo)!.rank})` };
    const fit = byKey(candidates, (c) => c.gain);
    picks.bestFit = { id: fit.id, why: `Largest immediate improvement to your projected final roster (+${fit.gain.toFixed(3)})` };
    picks.bestStrategic = {
      id: candidates[0].id,
      why: hasNext && myTurn ? "Best two-pick outcome after accounting for who survives to your next pick and risk" : "Best risk-adjusted improvement",
    };
    const withAdp = top.filter((c) => c.adp != null);
    if (withAdp.length) {
      const va = byKey(withAdp, (c) => (c.adp ?? 0) - c.valueRank);
      picks.bestValueAdp = { id: va.id, why: `Value rank #${va.valueRank} vs ADP ${va.adp?.toFixed(1)}` };
    }
    const sc = byKey(top, (c) => ctx.cats.reduce((a, k) => a + Math.max(0, c.catImpact[k]) * (scarcityIdx[k] ?? 1), 0));
    picks.bestScarcity = { id: sc.id, why: "Largest win-probability gains concentrated in the scarcest remaining categories" };
    const upc = byKey(top, (c) => c.gain + c.upside);
    picks.bestUpside = { id: upc.id, why: `Best 90th-percentile outcome (+${(upc.gain + upc.upside).toFixed(3)})` };
    const safe = top.filter((c) => (ctx.byId.get(c.id)!.proj?.confidence ?? 0) >= 0.65 && (ctx.byId.get(c.id)!.availability?.status ?? "HEALTHY") === "HEALTHY");
    if (safe.length) {
      const lr = byKey(safe, (c) => c.gain - c.downside);
      picks.bestLowRisk = { id: lr.id, why: `Best gain after downside among high-confidence, healthy players` };
    }
  }
  const likelySurvivors = candidates
    .filter((c) => c.survival >= 0.6)
    .slice(0, 8)
    .map((c) => ({ id: c.id, survival: c.survival, gain: c.gain }));

  if (ctx.marketSource === "proxy") notes.push("No ADP imported — opponent behaviour uses the heuristic market proxy.");
  if (ctx.schedule.source === "uniform") notes.push("No NBA schedule imported — uniform games per week assumed.");

  return {
    metricLevel: 2,
    metricName: "Level 2 · Expected-outcome lookahead (fast)",
    objectiveName: format === "h2h_most" ? "Matchup win probability" : format === "roto" ? "Expected roto points" : "Expected category wins / week",
    baselineObj: field.baselineObj,
    myTurn,
    candidates,
    picks,
    likelySurvivors,
    scarcity,
    field,
    notes,
  };
}
