import { CAT_BY_KEY } from "@/lib/categories";
import type { AnalysisContext } from "@/lib/engine/context";
import type { PlanOptions, WeekPlan } from "@/lib/engine/lineup";
import type { MatchupSync } from "./matchup-sync";

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Compact, engine-computed fact sheet for the AI lineup coach (no free text from the page). */
export function buildCoachFacts(ctx: AnalysisContext, plan: WeekPlan, opts: PlanOptions, sync: MatchupSync | null, today: string) {
  const name = (id: string) => ctx.byId.get(id)?.name ?? id;
  const mine = opts.rosters?.mine ?? ctx.rosters[ctx.myIndex];
  const theirs = opts.rosters?.opp ?? ctx.rosters[plan.opponent] ?? [];
  const score = new Map(plan.lineup.map((l) => [l.id, l]));
  const player = (id: string, side: "me" | "opp") => {
    const p = ctx.byId.get(id)!;
    const j = p.proj;
    const a = p.availability;
    return {
      player: p.name,
      nbaTeam: p.team,
      positions: p.elig.join(","),
      age: p.age ?? null,
      yahooFlag: sync?.status[id] ?? null,
      injury: a && a.status !== "HEALTHY" ? { status: a.status, note: a.injury ?? null, source: a.sourceName ?? null } : null,
      perGame: j ? { min: r1(j.min), pts: r1(j.pts), fg3m: r1(j.fg3m), reb: r1(j.reb), ast: r1(j.ast), stl: r1(j.stl), blk: r1(j.blk), tov: r1(j.tov), fgPct: j.fga ? r3(j.fgm / j.fga) : null, fga: r1(j.fga), ftPct: j.fta ? r3(j.ftm / j.fta) : null, fta: r1(j.fta) } : null,
      season2627: p.live ? { gp: p.live.gp, ptsPerGame: r1(p.live.tot.pts / Math.max(1, p.live.gp)) } : null,
      ...(side === "me" ? { matchupImpactPerWeek: r3(score.get(id)?.score ?? 0), gamesLeft: score.get(id)?.scheduled ?? 0 } : {}),
    };
  };
  return {
    today,
    league: { format: "Yahoo H2H, each of 9 categories counts", categories: ctx.cats.map((c) => CAT_BY_KEY[c].short), lineupSlots: Object.entries(ctx.settings.slots).map(([k, v]) => `${k}×${v}`).join(" "), dailyLineups: true, weeklyGamesCap: ctx.settings.weeklyGamesCap },
    matchup: {
      week: plan.period,
      dates: plan.dates,
      opponent: ctx.settings.teamNames[plan.opponent],
      winProbability: r3(plan.winProb),
      expectedCategoriesWon: r1(plan.expectedCats),
      categories: plan.categories.map((c) => ({ cat: CAT_BY_KEY[c.cat].short, projectedFinalMe: CAT_BY_KEY[c.cat].kind === "percentage" ? r3(c.mine) : r1(c.mine), projectedFinalOpp: CAT_BY_KEY[c.cat].kind === "percentage" ? r3(c.theirs) : r1(c.theirs), pWin: r3(c.pWin) })),
      actualSoFar: opts.actual ?? null,
      plannedFrom: plan.remaining.fromDate,
      remainingStarts: { me: plan.remaining.me, opp: plan.remaining.opp },
      yahooGamesPlayed: sync?.games ?? null,
    },
    enginePlan: plan.daily.map((d) => ({
      date: d.date,
      day: DOW[new Date(d.date + "T12:00:00Z").getUTCDay()],
      isToday: d.date === today,
      start: d.starters.map((s) => {
        const g = ctx.schedule.gameOn(ctx.byId.get(s.id)!.team, d.date);
        return { player: name(s.id), slot: s.slot, game: g ? `${g.home ? "vs" : "@"} ${g.opp} ${g.time ?? ""} ET`.trim() : null };
      }),
      benchedWithGame: d.sit.map((id) => ({ player: name(id), why: d.protect?.includes(id) ? "negative matchup impact (protect)" : "no eligible slot left" })),
      out: (d.out ?? []).map(name),
    })),
    myRoster: mine.filter((id) => ctx.byId.has(id)).map((id) => player(id, "me")),
    opponentRoster: theirs.filter((id) => ctx.byId.has(id)).map((id) => player(id, "opp")),
    streamingCandidates: plan.pickups.slice(0, 6).map((p) => ({ add: name(p.id), nbaTeam: ctx.byId.get(p.id)?.team, positions: ctx.byId.get(p.id)?.elig.join(","), gameDates: p.days ?? [], expectedCategoryGain: r3(p.gain), drop: p.replaces ? name(p.replaces) : null })),
    engineNotes: plan.notes,
  };
}
