/**
 * Recent form: values a player's last-14-days per-game line with the same baseline as the
 * projections, so "hot" means "playing like a more valuable fantasy player than projected".
 */
import type { AnalysisContext } from "../engine/context";
import { valuePlayers } from "../engine/valuation";
import type { Player } from "../types";

export interface FormRow {
  id: string;
  games: number;
  recentValue: number;
  projValue: number;
  trend: number;
}

export function recentForm(ctx: AnalysisContext, ids: string[], minGames = 2): FormRow[] {
  const pseudo: Player[] = [];
  for (const id of ids) {
    const p = ctx.byId.get(id);
    const r = p?.live?.recent;
    if (!p?.proj || !r || r.gp < minGames) continue;
    const g = r.gp;
    const t = r.tot;
    pseudo.push({ ...p, proj: { ...p.proj, min: t.min / g, pts: t.pts / g, fg3m: t.fg3m / g, reb: t.reb / g, ast: t.ast / g, stl: t.stl / g, blk: t.blk / g, tov: t.tov / g, fgm: t.fgm / g, fga: t.fga / g, ftm: t.ftm / g, fta: t.fta / g } });
  }
  if (!pseudo.length) return [];
  const vals = valuePlayers(pseudo, ctx.baseline);
  return pseudo
    .map((p) => {
      const recentValue = vals.get(p.id)?.total ?? 0;
      const projValue = ctx.values.get(p.id)?.total ?? 0;
      return { id: p.id, games: p.live!.recent.gp, recentValue, projValue, trend: recentValue - projValue };
    })
    .sort((a, b) => b.recentValue - a.recentValue);
}
