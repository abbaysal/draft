/**
 * AnalysisContext: everything the analytics need about the current draft moment,
 * computed once per state change and shared by recommendations, scarcity,
 * simulations, opponent analysis and the copilot.
 */
import { uniformWeights } from "../categories";
import { draftablePool, rosterSize, startingSlots, type LeagueSettings } from "../league";
import type { CategoryKey, Player } from "../types";
import { currentOverall, draftedIds, ownerOf, rosters, teamPicksFrom, totalPicks, type DraftState } from "./draft";
import { regularSeasonWeeks, uniformSchedule, type ScheduleModel } from "./schedule";
import { GAMES, addInto, contribution, emptyAgg, scaleAgg, type Agg, type PlayerLine } from "./team";
import { buildBaseline, valuePlayers, type Baseline, type PlayerValue } from "./valuation";

export type MarketSource = "adp" | "proxy" | "mixed";

export interface AnalysisContext {
  settings: LeagueSettings;
  players: Player[];
  byId: Map<string, Player>;
  lines: Map<string, PlayerLine>;
  baseline: Baseline;
  values: Map<string, PlayerValue>;
  marketRank: Map<string, number>;
  marketSource: MarketSource;
  /** Available, projected players in market order. */
  available: string[];
  availableSet: Set<string>;
  drafted: Set<string>;
  rosters: string[][];
  draft: DraftState;
  overall: number;
  totalPicks: number;
  onClock: number;
  myIndex: number;
  myNextPicks: number[];
  /** Opponent picks between now and my next pick (0 if I am on the clock and pick again next). */
  picksBeforeMyNext: number;
  schedule: ScheduleModel;
  regWeeks: number[];
  cats: CategoryKey[];
  starters: number;
  rosterSlots: number;
  /** Per-player contribution to a team aggregate for the regular-season week (usage 1). */
  weekContrib: (id: string, usage?: number) => Agg;
  /** Cached average regular-season games per week for an NBA team. */
  gamesPerWeek: (team: string) => number;
  /** Cached scheduled games for an NBA team in the j-th playoff week. */
  playoffGames: (team: string, j: number) => number;
}

export interface ContextInput {
  players: Player[];
  settings: LeagueSettings;
  draft: DraftState;
  schedule?: ScheduleModel;
}

/** Heuristic market order used ONLY when no ADP is imported (labelled "market proxy" in the UI). */
export function marketProxy(players: Player[], values: Map<string, PlayerValue>): Map<string, number> {
  const proj = players.filter((p) => p.proj && values.has(p.id));
  const byValue = [...proj].sort((a, b) => values.get(a.id)!.rank - values.get(b.id)!.rank);
  const valueRank = new Map(byValue.map((p, i) => [p.id, i + 1]));
  // Market tendency: scoring and name value are over-weighted relative to 9-cat value.
  const byPts = [...proj].sort((a, b) => b.proj!.pts * Math.min(1, b.proj!.gp / 70) - a.proj!.pts * Math.min(1, a.proj!.gp / 70));
  const ptsRank = new Map(byPts.map((p, i) => [p.id, i + 1]));
  const score = (p: Player) => {
    const outPenalty = p.availability?.status === "OUT_SEASON" ? 1000 : 0;
    return 0.6 * valueRank.get(p.id)! + 0.4 * ptsRank.get(p.id)! + outPenalty;
  };
  const sorted = [...proj].sort((a, b) => score(a) - score(b));
  return new Map(sorted.map((p, i) => [p.id, i + 1]));
}

export function buildMarket(players: Player[], values: Map<string, PlayerValue>): { rank: Map<string, number>; source: MarketSource } {
  const proxy = marketProxy(players, values);
  const withAdp = players.filter((p) => p.adp != null && p.proj);
  if (!withAdp.length) return { rank: proxy, source: "proxy" };
  // Real ADP where imported; players without ADP are slotted by proxy rank behind comparable ADPs.
  const entries = players
    .filter((p) => p.proj)
    .map((p) => ({ id: p.id, key: p.adp != null ? p.adp : (proxy.get(p.id) ?? 999) + 0.5 + (withAdp.length < 150 ? 0 : 30) }));
  entries.sort((a, b) => a.key - b.key);
  const coverage = withAdp.length / Math.max(1, players.filter((p) => p.proj).length);
  return { rank: new Map(entries.map((e, i) => [e.id, i + 1])), source: coverage > 0.25 ? "adp" : "mixed" };
}

export function toLine(p: Player): PlayerLine | null {
  if (!p.proj) return null;
  return { id: p.id, line: p.proj, gp: p.proj.gp, gpSd: p.proj.gpSd, sd: p.proj.sd, team: p.team };
}

const baselineCache = new Map<string, { players: Player[]; baseline: Baseline; values: Map<string, PlayerValue> }>();

export function getBaseline(players: Player[], settings: LeagueSettings) {
  const key = [settings.valuationBasis, settings.valuationMethod, draftablePool(settings), settings.categories.join(",")].join("|");
  const hit = baselineCache.get(key);
  if (hit && hit.players === players) return hit;
  const baseline = buildBaseline(players, {
    basis: settings.valuationBasis,
    method: settings.valuationMethod,
    poolSize: draftablePool(settings),
    population: "draftable",
    activeCats: settings.categories,
    gamesPerWeek: 3.3,
  });
  const values = valuePlayers(players, baseline, uniformWeights(settings.categories));
  const entry = { players, baseline, values };
  baselineCache.set(key, entry);
  return entry;
}

export function buildContext(input: ContextInput): AnalysisContext {
  const { players, settings, draft } = input;
  const schedule = input.schedule ?? uniformSchedule();
  const byId = new Map(players.map((p) => [p.id, p]));
  const lines = new Map<string, PlayerLine>();
  for (const p of players) {
    const l = toLine(p);
    if (l) lines.set(p.id, l);
  }
  const { baseline, values } = getBaseline(players, settings);
  const market = buildMarket(players, values);
  const drafted = draftedIds(draft);
  const available = [...lines.keys()]
    .filter((id) => !drafted.has(id))
    .sort((a, b) => (market.rank.get(a) ?? 9999) - (market.rank.get(b) ?? 9999));
  const shape = { teams: settings.teams, rounds: settings.rounds, draftType: settings.draftType };
  const overall = currentOverall(draft);
  const total = totalPicks(shape);
  const myIndex = settings.myPosition - 1;
  const myNextPicks = teamPicksFrom(myIndex, overall, shape, draft.ownerOverrides);
  const onClock = overall <= total ? ownerOf(overall, shape, draft.ownerOverrides) : -1;
  const nextMine = onClock === myIndex ? myNextPicks[1] : myNextPicks[0];
  const picksBeforeMyNext = nextMine ? nextMine - overall - (onClock === myIndex ? 1 : 0) : Math.max(0, total - overall + 1);
  const regWeeks = regularSeasonWeeks(settings.regularSeasonWeeks);
  const gpwCache = new Map<string, number>();
  const gpw = (team: string) => {
    let v = gpwCache.get(team);
    if (v == null) {
      v = schedule.avgGames(team, regWeeks) || 3.3;
      gpwCache.set(team, v);
    }
    return v;
  };
  const contribCache = new Map<string, Agg>();
  const weekContrib = (id: string, usage = 1) => {
    const k = `${id}|${usage}`;
    let a = contribCache.get(k);
    if (!a) {
      const l = lines.get(id);
      a = l ? contribution(l, { scheduled: gpw(l.team), usage }) : emptyAgg();
      contribCache.set(k, a);
    }
    return a;
  };
  const poCache = new Map<string, number>();
  const playoffGames = (team: string, j: number) => {
    const k = `${team}|${j}`;
    let v = poCache.get(k);
    if (v == null) {
      const w = settings.playoffWeeks[j];
      v = w ? schedule.gamesInWeek(team, w) || gpw(team) : gpw(team);
      poCache.set(k, v);
    }
    return v;
  };
  return {
    gamesPerWeek: gpw,
    playoffGames,
    settings,
    players,
    byId,
    lines,
    baseline,
    values,
    marketRank: market.rank,
    marketSource: market.source,
    available,
    availableSet: new Set(available),
    drafted,
    rosters: rosters(draft, settings.teams),
    draft,
    overall,
    totalPicks: total,
    onClock,
    myIndex,
    myNextPicks,
    picksBeforeMyNext: Math.max(0, picksBeforeMyNext),
    schedule,
    regWeeks,
    cats: settings.categories,
    starters: startingSlots(settings).length,
    rosterSlots: rosterSize(settings),
    weekContrib,
  };
}

/**
 * Lineup usage per rostered player: the top `starters` by value are fully used,
 * bench players at the league's bench-utilisation rate (daily lineups) or 0 (weekly).
 */
export function usageFor(ctx: AnalysisContext, ids: string[]): number[] {
  const S = ctx.starters;
  const bench = ctx.settings.lineupMode === "daily" ? ctx.settings.benchUtilization : 0;
  const order = ids
    .map((id, i) => ({ i, v: ctx.values.get(id)?.total ?? -99 }))
    .sort((a, b) => b.v - a.v);
  const usage = new Array(ids.length).fill(1);
  order.forEach((o, rank) => (usage[o.i] = rank < S ? 1 : bench));
  return usage;
}

/** Aggregate a roster (real players and/or fill pseudo-lines) for one regular-season week. */
export function rosterAgg(ctx: AnalysisContext, ids: string[], fills: Agg[] = []): Agg {
  const usage = usageFor(ctx, ids);
  const agg = emptyAgg();
  ids.forEach((id, i) => addInto(agg, ctx.weekContrib(id, usage[i])));
  for (const f of fills) addInto(agg, f);
  return applyGamesCap(ctx, agg);
}

function applyGamesCap(ctx: AnalysisContext, agg: Agg): Agg {
  const cap = ctx.settings.weeklyGamesCap;
  if (!cap || agg[GAMES] <= cap) return agg;
  // Weekly games-started cap: counted games are scaled down proportionally (managers start
  // their best options, so this slightly understates the capped team — documented).
  return scaleAgg(agg, cap / agg[GAMES]);
}
