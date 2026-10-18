/**
 * Folds the live in-season feed into the player dataset.
 *
 * Rest-of-season projection (Bayesian shrinkage, WarRoom model v1 as the prior):
 *   per-game counting stat  = (prior × K_GAMES + season total) / (K_GAMES + games played)
 *   FG% / FT%               = (prior% × K_ATT + makes) / (K_ATT + attempts), applied to the
 *                             blended attempts, so percentages stay volume-weighted
 *   availability (gp / 82)  = (prior rate × K_AVAIL + games played) / (K_AVAIL + team games)
 *   uncertainty (sd)        × sqrt(K_GAMES / (K_GAMES + games played))
 * Early in the season the projection dominates; by ~15 games actual play carries half the
 * weight. Projections stay labelled "estimate".
 *
 * Injuries: a player on the live report gets that status (ESPN wording mapped to ours) and
 * any additional expected missed games are removed from his availability. When the report
 * loads successfully, players flagged only "day-to-day"/"out at start" in the preseason
 * research but absent from a complete report (≥ 10 entries) are marked healthy.
 */
import { nameKey } from "../names";
import type { Availability, AvailabilityStatus, Player, Projection, StatLine } from "../types";
import type { LiveInjury, LivePlayerStats } from "./parse";

export const K_GAMES = 15;
export const K_FG_ATT = 250;
export const K_FT_ATT = 120;
export const K_AVAIL = 20;

export interface LiveFeed {
  generatedAt: string;
  season: string;
  sources: { id: string; name: string; url: string; ok: boolean; error?: string; count: number }[];
  schedule: { date: string; home: string; away: string }[] | null;
  teamGames: Record<string, number>;
  stats: LivePlayerStats[];
  injuries: LiveInjury[];
  warnings: string[];
}

export interface LiveOptions {
  stats: boolean;
  injuries: boolean;
}

export interface LiveReport {
  statsMatched: number;
  statsUnmatched: string[];
  injuriesMatched: number;
  injuriesUnmatched: string[];
}

const COUNT: (keyof StatLine)[] = ["min", "pts", "fg3m", "reb", "ast", "stl", "blk", "tov"];

export function blendProjection(proj: Projection, s: LivePlayerStats, teamGames: number): Projection {
  const g = s.gp;
  if (g <= 0) return proj;
  const w = K_GAMES / (K_GAMES + g);
  const line = { ...proj } as Projection;
  for (const k of COUNT) line[k] = (proj[k] * K_GAMES + s.tot[k]) / (K_GAMES + g);
  const fga = (proj.fga * K_GAMES + s.tot.fga) / (K_GAMES + g);
  const fta = (proj.fta * K_GAMES + s.tot.fta) / (K_GAMES + g);
  const fgp = proj.fga > 0 ? proj.fgm / proj.fga : 0.46;
  const ftp = proj.fta > 0 ? proj.ftm / proj.fta : 0.75;
  line.fga = fga;
  line.fta = fta;
  line.fgm = fga * ((fgp * K_FG_ATT + s.tot.fgm) / (K_FG_ATT + s.tot.fga));
  line.ftm = fta * ((ftp * K_FT_ATT + s.tot.ftm) / (K_FT_ATT + s.tot.fta));
  const rate = Math.min(1, proj.gp / 82);
  const tg = Math.max(teamGames, g);
  const avail = (rate * K_AVAIL + g) / (K_AVAIL + tg);
  const shrink = Math.sqrt(w);
  const sd = Object.fromEntries(Object.entries(proj.sd).map(([k, v]) => [k, (v ?? 0) * shrink]));
  return {
    ...line,
    gp: Math.min(82, avail * 82),
    sd,
    gpSd: proj.gpSd * shrink,
    confidence: Math.min(1, proj.confidence + (1 - proj.confidence) * (1 - w)),
    source: `${proj.source}+live`,
    flags: [...proj.flags.filter((f) => !f.startsWith("In-season:")), `In-season: ${g} games of 2026-27 blended (${Math.round((1 - w) * 100)}% weight on actual play)`],
  };
}

const DAY = 864e5;

/** ESPN status wording → our availability status and expected games missed from today. */
export function mapInjury(inj: LiveInjury, today: string): { status: AvailabilityStatus; games: number } {
  const s = `${inj.status} ${inj.comment ?? ""}`.toLowerCase();
  if (/out for (the )?season|season-ending|rest of the season/.test(s)) return { status: "OUT_SEASON", games: 82 };
  const days = inj.returnDate ? Math.max(0, (Date.parse(inj.returnDate) - Date.parse(today)) / DAY) : null;
  if (/day-to-day|questionable|probable|doubtful/.test(inj.status.toLowerCase())) return { status: "DAY_TO_DAY", games: 1 };
  if (/out|injured reserve|suspen/.test(s)) {
    const games = days != null ? Math.round(days * 0.48) : 4;
    return { status: games >= 15 ? "OUT_EXTENDED" : "OUT_START", games: Math.max(1, games) };
  }
  return { status: "DAY_TO_DAY", games: 0 };
}

export function applyLive(players: Player[], feed: LiveFeed, opts: LiveOptions, today = new Date().toISOString().slice(0, 10)): { players: Player[]; report: LiveReport } {
  const report: LiveReport = { statsMatched: 0, statsUnmatched: [], injuriesMatched: 0, injuriesUnmatched: [] };
  const byNba = new Map<number, Player>();
  const byEspn = new Map<number, Player>();
  const byName = new Map<string, Player>();
  for (const p of players) {
    if (p.nbaId) byNba.set(p.nbaId, p);
    if (p.espnId) byEspn.set(p.espnId, p);
    byName.set(nameKey(p.name), p);
  }
  const stats = new Map<string, LivePlayerStats>();
  if (opts.stats) {
    for (const s of feed.stats) {
      const p = byNba.get(s.nbaId) ?? byName.get(nameKey(s.name));
      if (p) {
        stats.set(p.id, s);
        report.statsMatched++;
      } else if (s.gp >= 3) report.statsUnmatched.push(s.name);
    }
  }
  const injuries = new Map<string, LiveInjury>();
  const injuryOk = opts.injuries && feed.sources.some((x) => x.id === "espn-injuries" && x.ok);
  if (injuryOk) {
    for (const inj of feed.injuries) {
      const p = (inj.espnId ? byEspn.get(inj.espnId) : undefined) ?? byName.get(nameKey(inj.name));
      if (p) {
        injuries.set(p.id, inj);
        report.injuriesMatched++;
      } else report.injuriesUnmatched.push(inj.name);
    }
  }
  // A real NBA injury report always lists many players; a near-empty one is treated as incomplete
  // and never used to clear preseason injury flags.
  const reportComplete = feed.injuries.length >= 10;
  const out = players.map((p) => {
    let next = p;
    const s = stats.get(p.id);
    if (s && p.proj) {
      next = { ...next, proj: blendProjection(p.proj, s, feed.teamGames[s.team] ?? s.gp), team: s.team || p.team, live: s };
    } else if (s) {
      next = { ...next, live: s };
    }
    if (injuryOk) {
      const inj = injuries.get(p.id);
      if (inj) {
        const m = mapInjury(inj, today);
        const prev = p.availability?.estGamesMissed ?? 0;
        const extra = Math.max(0, m.games - prev);
        const availability: Availability = {
          status: m.status,
          injury: inj.comment ?? inj.status,
          estGamesMissed: Math.max(prev, m.games),
          estimateBasis: inj.returnDate ? `ESPN estimated return ${inj.returnDate}` : `ESPN status "${inj.status}"`,
          confidence: inj.returnDate ? "medium" : "low",
          reportedDate: inj.date,
          sourceName: "ESPN injury report (live)",
          sourceUrl: "https://www.espn.com/nba/injuries",
        };
        const proj = next.proj && extra > 0 ? { ...next.proj, gp: Math.max(0, next.proj.gp * (1 - Math.min(82, extra) / 82)) } : next.proj;
        next = { ...next, availability, proj };
      } else if (reportComplete && p.availability && (p.availability.status === "DAY_TO_DAY" || p.availability.status === "OUT_START")) {
        next = { ...next, availability: { ...p.availability, status: "HEALTHY", notes: "Not on the current ESPN injury report" } };
      }
    }
    return next;
  });
  return { players: out, report };
}
