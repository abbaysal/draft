/**
 * Post-draft roster analytics: league power ratings, trade evaluation, trade finder and
 * waiver (add/drop) suggestions.
 *
 * A team's strength is its average-week category distribution (team.ts) for its best
 * lineup: healthy players ranked by value start, the rest are benched at the league's
 * bench-utilisation rate, players reported out sit on IL. Strength vs the league =
 * expected categories won per week against each other team (evaluateVsField). A trade is
 * judged by how it moves that number for both sides (the partner's improvement is the best
 * signal that they would accept), in the fantasy playoff weeks (real NBA games those weeks)
 * and, when the matchup schedule is known, over the remaining regular-season matchups.
 * Roster counts are kept: receiving more players than you send drops your lowest-value
 * player; receiving fewer adds the best free agent.
 */
import { CAT_BY_KEY } from "../categories";
import type { CategoryKey } from "../types";
import { usageFor, type AnalysisContext } from "./context";
import { matchupPeriods, planWeek } from "./lineup";
import { addContribution, catDist, emptyAgg, evaluateVsField, objectiveValue, type Agg, type FieldEvaluation } from "./team";

const OUT = new Set(["OUT_SEASON", "OUT_EXTENDED", "OUT_START"]);

export interface Trade {
  partner: number;
  give: string[];
  get: string[];
}

export interface SideImpact {
  team: number;
  before: FieldEvaluation;
  after: FieldEvaluation;
  /** Δ league objective (expected category wins / week vs the field, or the format's objective). */
  delta: number;
  /** Δ expected category wins / week vs the field over the fantasy playoff weeks. */
  playoffDelta: number;
  drops: string[];
  adds: string[];
}

export interface CategoryChange {
  cat: CategoryKey;
  before: number;
  after: number;
  pBefore: number;
  pAfter: number;
}

export interface TradeEvaluation {
  trade: Trade;
  me: SideImpact;
  them: SideImpact;
  categories: CategoryChange[];
  /** Σ player value (z) received − sent: how the trade looks on paper / to rankings. */
  valueBalance: number;
  /** Remaining scheduled matchups (when the schedule is known). */
  schedule: { weeks: number; winsBefore: number; winsAfter: number; catsBefore: number; catsAfter: number } | null;
  verdict: { tone: "good" | "warn" | "bad"; text: string };
  acceptance: { tone: "good" | "warn" | "bad"; text: string };
}

const isOut = (ctx: AnalysisContext, id: string) => OUT.has(ctx.byId.get(id)?.availability?.status ?? "");
const value = (ctx: AnalysisContext, id: string) => ctx.values.get(id)?.total ?? -99;

/** Free agents (undrafted, healthy, projected) best value first. */
export function freeAgents(ctx: AnalysisContext): string[] {
  return ctx.available.filter((id) => !isOut(ctx, id) && ctx.values.has(id)).sort((a, b) => value(ctx, b) - value(ctx, a));
}

/** Bring a roster back to `size` players: drop the lowest-value healthy player(s) or add the best free agent(s). */
export function settleRoster(ctx: AnalysisContext, ids: string[], size: number, fa: string[], taken: Set<string>): { ids: string[]; drops: string[]; adds: string[] } {
  const cap = size;
  let roster = [...ids];
  const drops: string[] = [];
  const adds: string[] = [];
  while (roster.length > cap) {
    const healthy = roster.filter((id) => !isOut(ctx, id));
    const pool = healthy.length ? healthy : roster;
    const worst = pool.reduce((w, id) => (value(ctx, id) < value(ctx, w) ? id : w));
    roster = roster.filter((id) => id !== worst);
    drops.push(worst);
  }
  for (const id of fa) {
    if (roster.length >= cap) break;
    if (taken.has(id)) continue;
    roster.push(id);
    adds.push(id);
    taken.add(id);
  }
  return { ids: roster, drops, adds };
}

/** Average-week aggregate (playoffWeek = j-th playoff week uses that week's real NBA games). */
export function teamAgg(ctx: AnalysisContext, ids: string[], playoffWeek?: number): Agg {
  const active = ids.filter((id) => !isOut(ctx, id));
  const usage = usageFor(ctx, active);
  const agg = emptyAgg();
  active.forEach((id, i) => {
    const l = ctx.lines.get(id);
    if (!l) return;
    const games = playoffWeek == null ? ctx.gamesPerWeek(l.team) : ctx.playoffGames(l.team, playoffWeek);
    addContribution(agg, l, { scheduled: games, usage: usage[i] });
  });
  return agg;
}

export function field(ctx: AnalysisContext, aggs: Agg[], team: number): FieldEvaluation {
  return evaluateVsField(
    aggs[team],
    aggs.map((agg, index) => ({ index, agg })).filter((o) => o.index !== team),
    ctx.cats,
  );
}

export const objective = (ctx: AnalysisContext, ev: FieldEvaluation) => objectiveValue(ev, ctx.settings.format === "roto" ? "h2h_each" : ctx.settings.format);

export interface PowerRow {
  team: number;
  rank: number;
  expectedCatWins: number;
  winProb: number;
  playoffCatWins: number;
  perCategory: Record<string, number>;
}

/** League power ratings from current rosters: expected categories won per week vs every other team. */
export function powerRankings(ctx: AnalysisContext, rosters = ctx.rosters): PowerRow[] {
  const aggs = rosters.map((r) => teamAgg(ctx, r));
  const po = ctx.settings.playoffWeeks.map((_, j) => rosters.map((r) => teamAgg(ctx, r, j)));
  const rows = rosters.map((_, t) => {
    const ev = field(ctx, aggs, t);
    const poCats = po.length ? po.reduce((a, w) => a + field(ctx, w, t).expectedCatWins, 0) / po.length : ev.expectedCatWins;
    return { team: t, rank: 0, expectedCatWins: ev.expectedCatWins, winProb: ev.matchupWinProb, playoffCatWins: poCats, perCategory: ev.perCategory };
  });
  [...rows].sort((a, b) => b.expectedCatWins - a.expectedCatWins).forEach((r, i) => (r.rank = i + 1));
  return rows;
}

function applyTrade(rosters: string[][], me: number, t: Trade): string[][] {
  return rosters.map((r, i) => {
    if (i === me) return [...r.filter((id) => !t.give.includes(id)), ...t.get];
    if (i === t.partner) return [...r.filter((id) => !t.get.includes(id)), ...t.give];
    return r;
  });
}

/** Rosters before/after a trade with both sides settled to legal size. */
function tradeRosters(ctx: AnalysisContext, t: Trade, fa: string[]) {
  const me = ctx.myIndex;
  const taken = new Set<string>();
  const before = ctx.rosters.map((r) => [...r]);
  const raw = applyTrade(before, me, t);
  const sMe = settleRoster(ctx, raw[me], before[me].length, fa, taken);
  const sThem = settleRoster(ctx, raw[t.partner], before[t.partner].length, fa, taken);
  const after = raw.map((r, i) => (i === me ? sMe.ids : i === t.partner ? sThem.ids : r));
  return { before, after, sMe, sThem };
}

/** Remaining regular-season matchups (period index ≥ fromPeriod) vs the scheduled opponents. */
function scheduleOutlook(ctx: AnalysisContext, rosters: string[][], opponents: number[], fromPeriod: number) {
  const c = { ...ctx, rosters };
  let wins = 0;
  let cats = 0;
  let weeks = 0;
  const periods = matchupPeriods();
  opponents.forEach((opp, i) => {
    if (i + 1 < fromPeriod || opp < 0 || !periods[i]) return;
    const p = planWeek(c, i + 1, opp, { pickups: false });
    wins += p.winProb;
    cats += p.expectedCats;
    weeks++;
  });
  return { wins, cats, weeks };
}

export function evaluateTrade(ctx: AnalysisContext, t: Trade, opts: { opponents?: number[]; fromPeriod?: number } = {}): TradeEvaluation {
  const fa = freeAgents(ctx);
  const { before, after, sMe, sThem } = tradeRosters(ctx, t, fa);
  const me = ctx.myIndex;
  const aggB = before.map((r) => teamAgg(ctx, r));
  const aggA = after.map((r) => teamAgg(ctx, r));
  const poB = ctx.settings.playoffWeeks.map((_, j) => before.map((r) => teamAgg(ctx, r, j)));
  const poA = ctx.settings.playoffWeeks.map((_, j) => after.map((r) => teamAgg(ctx, r, j)));
  const poCats = (po: Agg[][], team: number) => (po.length ? po.reduce((a, w) => a + field(ctx, w, team).expectedCatWins, 0) / po.length : 0);

  const side = (team: number, settled: { drops: string[]; adds: string[] }): SideImpact => {
    const b = field(ctx, aggB, team);
    const a = field(ctx, aggA, team);
    return { team, before: b, after: a, delta: objective(ctx, a) - objective(ctx, b), playoffDelta: poCats(poA, team) - poCats(poB, team), drops: settled.drops, adds: settled.adds };
  };
  const mine = side(me, sMe);
  const theirs = side(t.partner, sThem);

  const categories: CategoryChange[] = ctx.cats.map((c) => ({
    cat: c,
    before: catDist(aggB[me], c).mean,
    after: catDist(aggA[me], c).mean,
    pBefore: mine.before.perCategory[c],
    pAfter: mine.after.perCategory[c],
  }));
  const valueBalance = t.get.reduce((a, id) => a + value(ctx, id), 0) - t.give.reduce((a, id) => a + value(ctx, id), 0);

  let schedule: TradeEvaluation["schedule"] = null;
  if (opts.opponents?.length) {
    const b = scheduleOutlook(ctx, before, opts.opponents, opts.fromPeriod ?? 1);
    const a = scheduleOutlook(ctx, after, opts.opponents, opts.fromPeriod ?? 1);
    if (b.weeks) schedule = { weeks: b.weeks, winsBefore: b.wins, winsAfter: a.wins, catsBefore: b.cats, catsAfter: a.cats };
  }

  const d = mine.delta;
  const verdict: TradeEvaluation["verdict"] =
    d > 0.08 ? { tone: "good", text: `Accept — you gain ${d.toFixed(2)} expected categories per week vs the league.` }
    : d > 0.02 ? { tone: "good", text: `Small win (+${d.toFixed(2)} cats/week). Worth it if it also fixes a playoff-week or positional need.` }
    : d > -0.02 ? { tone: "warn", text: "Roughly neutral for your team — decide on risk, schedule and category fit." }
    : { tone: "bad", text: `Decline — you lose ${(-d).toFixed(2)} expected categories per week vs the league.` };
  const td = theirs.delta;
  const acceptance: TradeEvaluation["acceptance"] =
    td > 0.02 ? { tone: "good", text: `${ctx.settings.teamNames[t.partner]} also improves (+${td.toFixed(2)}) — a genuine win-win, likely accepted.` }
    : td > -0.02 ? { tone: "warn", text: `About neutral for ${ctx.settings.teamNames[t.partner]} (${td >= 0 ? "+" : ""}${td.toFixed(2)}) — pitch the categories they gain; could go either way.` }
    : valueBalance < -0.5 ? { tone: "warn", text: `It hurts them on category fit (${td.toFixed(2)}) but they get more player value on paper (${(-valueBalance).toFixed(1)}) — may still be accepted.` }
    : { tone: "bad", text: `They get worse (${td.toFixed(2)}) and get less value on paper — unlikely to be accepted.` };

  return { trade: t, me: mine, them: theirs, categories, valueBalance, schedule, verdict, acceptance };
}

export interface TradeIdea {
  trade: Trade;
  myDelta: number;
  theirDelta: number;
  valueBalance: number;
}

/**
 * Trade finder: every 1-for-1 swap with every team, plus 2-for-1 consolidations (two of
 * mine for one of their top players). Keeps trades that help me; ranks win-wins first.
 */
export function findTrades(ctx: AnalysisContext, opts: { limit?: number; partner?: number } = {}): TradeIdea[] {
  const fa = freeAgents(ctx);
  const me = ctx.myIndex;
  const baseAggs = ctx.rosters.map((r) => teamAgg(ctx, r));
  const baseObj = ctx.rosters.map((_, t) => objective(ctx, field(ctx, baseAggs, t)));
  const mine = ctx.rosters[me].filter((id) => !isOut(ctx, id));
  const out: TradeIdea[] = [];

  const consider = (partner: number, give: string[], get: string[]) => {
    const t: Trade = { partner, give, get };
    const raw = applyTrade(ctx.rosters, me, t);
    const taken = new Set<string>();
    const sMe = settleRoster(ctx, raw[me], ctx.rosters[me].length, fa, taken);
    const sThem = settleRoster(ctx, raw[partner], ctx.rosters[partner].length, fa, taken);
    const aggs = baseAggs.slice();
    aggs[me] = teamAgg(ctx, sMe.ids);
    aggs[partner] = teamAgg(ctx, sThem.ids);
    const myDelta = objective(ctx, field(ctx, aggs, me)) - baseObj[me];
    if (myDelta <= 0.01) return;
    const theirDelta = objective(ctx, field(ctx, aggs, partner)) - baseObj[partner];
    const valueBalance = get.reduce((a, id) => a + value(ctx, id), 0) - give.reduce((a, id) => a + value(ctx, id), 0);
    out.push({ trade: t, myDelta, theirDelta, valueBalance });
  };

  ctx.rosters.forEach((roster, partner) => {
    if (partner === me || (opts.partner != null && partner !== opts.partner)) return;
    const theirs = roster.filter((id) => !isOut(ctx, id));
    for (const g of mine) for (const r of theirs) consider(partner, [g], [r]);
    const stars = [...theirs].sort((a, b) => value(ctx, b) - value(ctx, a)).slice(0, 5);
    for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) for (const r of stars) consider(partner, [mine[i], mine[j]], [r]);
  });

  // Win-wins first (they are the trades that actually happen), then by my gain.
  const score = (x: TradeIdea) => x.myDelta + Math.min(0, x.theirDelta) * 2 + (x.theirDelta > 0.02 ? 0.05 : 0);
  return out.sort((a, b) => score(b) - score(a)).slice(0, opts.limit ?? 25);
}

export interface WaiverMove {
  add: string;
  drop: string;
  delta: number;
}

/** Best add/drop moves: top free agents vs my weakest players, by Δ expected category wins. */
export function waiverMoves(ctx: AnalysisContext, limit = 8): WaiverMove[] {
  const me = ctx.myIndex;
  const fa = freeAgents(ctx).slice(0, 60);
  const aggs = ctx.rosters.map((r) => teamAgg(ctx, r));
  const base = objective(ctx, field(ctx, aggs, me));
  const roster = ctx.rosters[me];
  const droppable = roster.filter((id) => !isOut(ctx, id)).sort((a, b) => value(ctx, a) - value(ctx, b)).slice(0, 4);
  const moves: WaiverMove[] = [];
  for (const add of fa) {
    let best: WaiverMove | null = null;
    for (const drop of droppable) {
      const a = aggs.slice();
      a[me] = teamAgg(ctx, [...roster.filter((id) => id !== drop), add]);
      const delta = objective(ctx, field(ctx, a, me)) - base;
      if (!best || delta > best.delta) best = { add, drop, delta };
    }
    if (best && best.delta > 0.005) moves.push(best);
  }
  return moves.sort((a, b) => b.delta - a.delta).slice(0, limit);
}

export const catLabel = (c: CategoryKey) => CAT_BY_KEY[c].short;
