/**
 * Category and positional scarcity of the REMAINING pool, recomputed after every pick.
 *
 * supplyShare_c   = Σ max(0, z_ic) over the best R available players (R = picks left)
 *                   ÷ the same quantity at the start of the draft.
 * strongLeft_c    = # available players with z_ic ≥ 1.
 * strongAtMyPick  = expected # of those still there at my next pick (uses survival probs).
 * scarcityIndex_c = mean_k(supplyShare_k) / supplyShare_c  (>1 = scarcer than average).
 */
import { CAT_BY_KEY, CAT_KEYS } from "../categories";
import { slotAccepts } from "../positions";
import type { CategoryKey, SlotPos } from "../types";
import type { AnalysisContext } from "./context";

export interface CategoryScarcity {
  cat: CategoryKey;
  label: string;
  supplyShare: number;
  strongLeft: number;
  strongAtMyPick: number | null;
  scarcityIndex: number;
  topRemaining: { id: string; z: number }[];
}

export interface PositionScarcity {
  pos: SlotPos;
  aboveReplacement: number;
  topRemaining: string[];
}

function supply(ids: string[], ctx: AnalysisContext, cat: CategoryKey, r: number): number {
  const vals = ids
    .map((id) => ctx.values.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .sort((a, b) => b.total - a.total)
    .slice(0, r);
  return vals.reduce((a, v) => a + Math.max(0, v.cat[cat]), 0);
}

export function categoryScarcity(ctx: AnalysisContext, survival?: Map<string, number>): CategoryScarcity[] {
  const picksLeft = Math.max(1, ctx.totalPicks - ctx.overall + 1);
  const allProjected = [...ctx.lines.keys()];
  const startR = ctx.totalPicks;
  const rows = ctx.cats.map((cat) => {
    const start = supply(allProjected, ctx, cat, startR) || 1e-9;
    const now = supply(ctx.available, ctx, cat, picksLeft);
    const strong = ctx.available.filter((id) => (ctx.values.get(id)?.cat[cat] ?? 0) >= 1);
    const strongAtMyPick = survival ? strong.reduce((a, id) => a + (survival.get(id) ?? 1), 0) : null;
    const topRemaining = ctx.available
      .map((id) => ({ id, z: ctx.values.get(id)?.cat[cat] ?? 0 }))
      .sort((a, b) => b.z - a.z)
      .slice(0, 5);
    return { cat, label: CAT_BY_KEY[cat].short, supplyShare: now / start, strongLeft: strong.length, strongAtMyPick, scarcityIndex: 1, topRemaining };
  });
  const meanShare = rows.reduce((a, r) => a + r.supplyShare, 0) / Math.max(1, rows.length);
  for (const r of rows) r.scarcityIndex = r.supplyShare > 0 ? meanShare / r.supplyShare : 5;
  return rows;
}

export function positionScarcity(ctx: AnalysisContext): PositionScarcity[] {
  const replTotal = CAT_KEYS.reduce((a, c) => a + ctx.baseline.replacement[c], 0);
  return (["PG", "SG", "SF", "PF", "C"] as SlotPos[]).map((pos) => {
    const ids = ctx.available.filter((id) => {
      const v = ctx.values.get(id);
      return v && v.total > replTotal && slotAccepts(pos, ctx.byId.get(id)!.elig);
    });
    ids.sort((a, b) => ctx.values.get(b)!.total - ctx.values.get(a)!.total);
    return { pos, aboveReplacement: ids.length, topRemaining: ids.slice(0, 5) };
  });
}
