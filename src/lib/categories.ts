import type { CategoryKey, CountingKey } from "./types";

export interface CategoryDef {
  key: CategoryKey;
  label: string;
  short: string;
  /** +1 = higher is better, -1 = lower is better (turnovers). */
  direction: 1 | -1;
  kind: "counting" | "percentage";
  /** For percentages: [makes, attempts] fields. */
  ratio?: ["fgm" | "ftm", "fga" | "fta"];
  /**
   * Within-player per-game dispersion assumption (variance = phi * mean for counting
   * stats). See METHODOLOGY.md §5 — replace with game-log estimates when imported.
   */
  phi: number;
  color: string;
}

export const CATEGORIES: CategoryDef[] = [
  { key: "pts", label: "Points", short: "PTS", direction: 1, kind: "counting", phi: 2.2, color: "#f59e0b" },
  { key: "fg3m", label: "Three-pointers made", short: "3PM", direction: 1, kind: "counting", phi: 1.0, color: "#06b6d4" },
  { key: "reb", label: "Rebounds", short: "REB", direction: 1, kind: "counting", phi: 1.15, color: "#22c55e" },
  { key: "ast", label: "Assists", short: "AST", direction: 1, kind: "counting", phi: 1.1, color: "#a855f7" },
  { key: "stl", label: "Steals", short: "STL", direction: 1, kind: "counting", phi: 1.0, color: "#ef4444" },
  { key: "blk", label: "Blocks", short: "BLK", direction: 1, kind: "counting", phi: 1.3, color: "#3b82f6" },
  { key: "fgPct", label: "Field-goal %", short: "FG%", direction: 1, kind: "percentage", ratio: ["fgm", "fga"], phi: 1.2, color: "#84cc16" },
  { key: "ftPct", label: "Free-throw %", short: "FT%", direction: 1, kind: "percentage", ratio: ["ftm", "fta"], phi: 1.2, color: "#14b8a6" },
  { key: "tov", label: "Turnovers", short: "TO", direction: -1, kind: "counting", phi: 1.0, color: "#f43f5e" },
];

export const CAT_KEYS: CategoryKey[] = CATEGORIES.map((c) => c.key);
export const COUNTING_KEYS: CountingKey[] = ["pts", "fg3m", "reb", "ast", "stl", "blk", "tov"];
export const CAT_BY_KEY: Record<CategoryKey, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
) as Record<CategoryKey, CategoryDef>;

export type CategoryWeights = Record<CategoryKey, number>;

export function uniformWeights(active: CategoryKey[] = CAT_KEYS): CategoryWeights {
  const w = {} as CategoryWeights;
  for (const k of CAT_KEYS) w[k] = active.includes(k) ? 1 : 0;
  return w;
}

export function puntWeights(punts: CategoryKey[], base: CategoryWeights = uniformWeights()): CategoryWeights {
  const w = { ...base };
  for (const p of punts) w[p] = 0;
  return w;
}

export function describeWeights(w: CategoryWeights): string {
  const punted = CAT_KEYS.filter((k) => w[k] === 0).map((k) => CAT_BY_KEY[k].short);
  const soft = CAT_KEYS.filter((k) => w[k] > 0 && w[k] < 1).map((k) => `${CAT_BY_KEY[k].short}×${w[k]}`);
  if (!punted.length && !soft.length) return "Balanced (9-cat)";
  return [punted.length ? `Punt ${punted.join("/")}` : "", soft.length ? `Soft ${soft.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");
}
