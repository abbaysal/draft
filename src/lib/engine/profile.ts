/**
 * Player profile analytics derived from the dataset (no new assumptions):
 *  - shooting/usage/rebounding/defence detail from the 2025-26 NBA Stats totals
 *    (TS%, eFG%, 3P%, 3PA rate, FT rate, usage proxy per 36, AST/TO, OREB/DREB, fouls, team record)
 *  - per-36 projection, category ranks, strengths/weaknesses and an archetype label
 *  - fantasy value of every past season under the current league baseline (trend) and durability
 *  - statistically similar players (cosine similarity of category z-score profiles)
 */
import { CAT_BY_KEY } from "../categories";
import type { CategoryKey, HistSeason, Player } from "../types";
import type { AnalysisContext } from "./context";
import { valuePlayers } from "./valuation";

export interface AdvancedLine {
  basis: string;
  ts: number | null;
  efg: number | null;
  fg3Pct: number | null;
  fg3a: number | null;
  fg3Rate: number | null;
  ftRate: number | null;
  usage36: number | null;
  astTo: number | null;
  oreb: number | null;
  dreb: number | null;
  pf: number | null;
  stocks: number;
  record: { wins: number; losses: number; pct: number } | null;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Advanced line from the most detailed actual season (2025-26), else the projection. */
export function advancedLine(p: Player): AdvancedLine | null {
  const h: (HistSeason & { basis?: string }) | undefined = p.hist.find((x) => x.season === "2025-26" && !x.attemptsEstimated) ?? undefined;
  const s = h ?? (p.proj ? { ...p.proj, season: "projection" } : null);
  if (!s) return null;
  const basis = h ? "2025-26 actual" : "2026-27 projection";
  const fg3a = h?.fg3a ?? null;
  return {
    basis,
    ts: ratio(s.pts, 2 * (s.fga + 0.44 * s.fta)),
    efg: ratio(s.fgm + 0.5 * s.fg3m, s.fga),
    fg3Pct: fg3a != null ? ratio(s.fg3m, fg3a) : null,
    fg3a,
    fg3Rate: fg3a != null ? ratio(fg3a, s.fga) : null,
    ftRate: ratio(s.fta, s.fga),
    usage36: s.min > 0 ? ((s.fga + 0.44 * s.fta + s.tov) / s.min) * 36 : null,
    astTo: ratio(s.ast, s.tov),
    oreb: h?.oreb ?? null,
    dreb: h?.dreb ?? null,
    pf: h?.pf ?? null,
    stocks: s.stl + s.blk,
    record: h?.wins != null && h.losses != null ? { wins: h.wins, losses: h.losses, pct: h.wins / Math.max(1, h.wins + h.losses) } : null,
  };
}

/** Projected per-36 line. */
export function per36(p: Player): Record<string, number> | null {
  const j = p.proj;
  if (!j || j.min <= 0) return null;
  const f = 36 / j.min;
  return { pts: j.pts * f, fg3m: j.fg3m * f, reb: j.reb * f, ast: j.ast * f, stl: j.stl * f, blk: j.blk * f, tov: j.tov * f, fga: j.fga * f, fta: j.fta * f };
}

const rankCache = new WeakMap<object, Map<string, Record<string, number>>>();
/** Rank (1 = best) of every projected player in each league category. */
export function categoryRanks(ctx: AnalysisContext): Map<string, Record<string, number>> {
  const hit = rankCache.get(ctx.values);
  if (hit) return hit;
  const vals = [...ctx.values.values()];
  const out = new Map<string, Record<string, number>>(vals.map((v) => [v.id, {}]));
  for (const c of ctx.cats) {
    [...vals].sort((a, b) => b.cat[c] - a.cat[c]).forEach((v, i) => (out.get(v.id)![c] = i + 1));
  }
  rankCache.set(ctx.values, out);
  return out;
}

const ARCH: Record<string, string> = {
  pts: "Scorer",
  fg3m: "Shooter",
  reb: "Rebounder",
  ast: "Playmaker",
  stl: "Thief",
  blk: "Rim protector",
  fgPct: "Efficient finisher",
  ftPct: "FT specialist",
  tov: "Low-turnover",
};

export function strengths(ctx: AnalysisContext, id: string) {
  const v = ctx.values.get(id);
  if (!v) return { strengths: [] as CategoryKey[], weaknesses: [] as CategoryKey[], archetype: "—" };
  const sorted = [...ctx.cats].sort((a, b) => v.cat[b] - v.cat[a]);
  const strong = sorted.filter((c) => v.cat[c] >= 0.75).slice(0, 3);
  const weak = sorted.filter((c) => v.cat[c] <= -0.5).reverse().slice(0, 3);
  const archetype = (strong.length ? strong : sorted.slice(0, 1)).slice(0, 2).map((c) => ARCH[c] ?? CAT_BY_KEY[c].short).join(" · ");
  return { strengths: strong, weaknesses: weak, archetype };
}

const trendCache = new WeakMap<object, Map<string, { season: string; value: number; gp: number }[]>>();
/** Fantasy value (total z, per game) of each past season under the current league baseline. */
export function seasonValues(ctx: AnalysisContext): Map<string, { season: string; value: number; gp: number }[]> {
  const hit = trendCache.get(ctx.baseline);
  if (hit) return hit;
  const out = new Map<string, { season: string; value: number; gp: number }[]>();
  for (const season of ["2023-24", "2024-25", "2025-26"]) {
    const pseudo: Player[] = [];
    for (const p of ctx.players) {
      const h = p.hist.find((x) => x.season === season);
      if (!h || !p.proj || h.gp < 5) continue;
      pseudo.push({ ...p, proj: { ...p.proj, ...h, gp: h.gp } });
    }
    const vals = valuePlayers(pseudo, ctx.baseline);
    for (const q of pseudo) {
      const arr = out.get(q.id) ?? [];
      arr.push({ season, value: vals.get(q.id)?.total ?? 0, gp: q.proj!.gp });
      out.set(q.id, arr);
    }
  }
  trendCache.set(ctx.baseline, out);
  return out;
}

/** Change in fantasy value from the earliest to the latest available season (null if < 2 seasons). */
export function valueTrend(rows: { season: string; value: number }[] | undefined): number | null {
  if (!rows || rows.length < 2) return null;
  return rows[rows.length - 1].value - rows[0].value;
}

/** Most similar fantasy profiles: cosine similarity of category z vectors, penalised by value gap. */
export function similarPlayers(ctx: AnalysisContext, id: string, n = 6): { id: string; sim: number }[] {
  const v = ctx.values.get(id);
  if (!v) return [];
  const vec = (x: Record<string, number>) => ctx.cats.map((c) => x[c]);
  const a = vec(v.cat);
  const na = Math.hypot(...a) || 1;
  const out: { id: string; sim: number }[] = [];
  for (const w of ctx.values.values()) {
    if (w.id === id) continue;
    const b = vec(w.cat);
    const nb = Math.hypot(...b) || 1;
    const cos = a.reduce((s, x, i) => s + x * b[i], 0) / (na * nb);
    out.push({ id: w.id, sim: cos - 0.04 * Math.abs(v.total - w.total) });
  }
  return out.sort((x, y) => y.sim - x.sim).slice(0, n);
}
