/**
 * Applying imported data to the player pool, projection versioning and a
 * transparent consensus methodology.
 *
 *  - Projection sets are IMMUTABLE once created (new import ⇒ new set id).
 *  - Draft sessions freeze the set they were created with (see store + audit),
 *    so later imports never rewrite the reasoning behind old picks.
 *  - Consensus averages per-game counting stats and, separately, makes and
 *    attempts — percentages are re-derived from averaged makes/attempts so
 *    shooting volume is respected (never an average of percentages). Season-total
 *    sources are normalised to per-game before averaging.
 */
import type { Player, Projection, StatLine } from "../types";
import type { AdpRow, MetadataRow, ProjectionRow } from "./csv";

export interface ProjectionSet {
  id: string;
  label: string;
  source: string;
  kind: "model" | "external" | "consensus" | "custom";
  createdAt: string;
  rows: ProjectionRow[];
}

const LINE_KEYS = ["min", "pts", "fg3m", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "ftm", "fta"] as const;

export function projectionFromRow(row: ProjectionRow, set: Pick<ProjectionSet, "id" | "source" | "kind">, model: Projection | null): Projection {
  const line = {} as StatLine;
  for (const k of LINE_KEYS) line[k] = row[k];
  // Uncertainty: reuse the model's coefficient of variation for this player when available.
  const cv = model && model.pts > 0 ? (model.sd.pts ?? 0) / model.pts : 0.15;
  const sd: Projection["sd"] = {};
  for (const k of ["pts", "fg3m", "reb", "ast", "stl", "blk", "tov", "fga", "fta", "min"] as const) sd[k] = line[k] * cv;
  const fgP = line.fga > 0 ? line.fgm / line.fga : 0;
  const ftP = line.fta > 0 ? line.ftm / line.fta : 0;
  sd.fgm = model?.sd.fgm ?? Math.sqrt((fgP * (1 - fgP)) / 400) * line.fga;
  sd.ftm = model?.sd.ftm ?? Math.sqrt((ftP * (1 - ftP)) / 150) * line.fta;
  return {
    ...line,
    gp: row.gp,
    sd,
    gpSd: model?.gpSd ?? 7 + 0.18 * (82 - row.gp),
    confidence: model ? Math.min(0.9, model.confidence + 0.05) : 0.6,
    source: set.source,
    version: set.id,
    kind: set.kind === "model" ? "estimate" : "projection",
    flags: [`Imported projection set "${set.source}" (${set.id})`],
  };
}

export interface ApplyOptions {
  /** Keep the bundled model projection for players missing from the set. */
  fallbackToModel: boolean;
}

export function applyProjectionSet(players: Player[], set: ProjectionSet, opts: ApplyOptions = { fallbackToModel: true }): Player[] {
  const byId = new Map(set.rows.map((r) => [r.playerId, r]));
  return players.map((p) => {
    const row = byId.get(p.id);
    if (row) return { ...p, proj: projectionFromRow(row, set, p.proj) };
    if (opts.fallbackToModel) {
      if (!p.proj) return p;
      return { ...p, proj: { ...p.proj, flags: [...p.proj.flags.filter((f) => !f.startsWith("Not in")), `Not in "${set.source}" — model estimate kept`] } };
    }
    return { ...p, proj: null };
  });
}

export function consensus(sets: { set: ProjectionSet; weight: number }[], id: string, createdAt: string): ProjectionSet {
  const acc = new Map<string, { w: number; gpW: number; sums: Record<string, number>; name: string; n: number }>();
  for (const { set, weight } of sets) {
    if (weight <= 0) continue;
    for (const r of set.rows) {
      const a = acc.get(r.playerId) ?? { w: 0, gpW: 0, sums: Object.fromEntries(LINE_KEYS.map((k) => [k, 0])), name: r.name, n: 0 };
      a.w += weight;
      a.gpW += weight * r.gp;
      for (const k of LINE_KEYS) a.sums[k] += weight * r[k];
      a.n++;
      acc.set(r.playerId, a);
    }
  }
  const rows: ProjectionRow[] = [...acc.entries()].map(([playerId, a]) => {
    const row = { playerId, name: a.name, gp: a.gpW / a.w } as ProjectionRow;
    for (const k of LINE_KEYS) row[k] = a.sums[k] / a.w;
    return row;
  });
  return {
    id,
    label: `Consensus of ${sets.filter((s) => s.weight > 0).map((s) => `${s.set.source}×${s.weight}`).join(", ")}`,
    source: "consensus",
    kind: "consensus",
    createdAt,
    rows,
  };
}

export function applyAdp(players: Player[], rows: AdpRow[]): Player[] {
  const byId = new Map(rows.map((r) => [r.playerId, r]));
  return players.map((p) => {
    const r = byId.get(p.id);
    return r ? { ...p, adp: r.adp, adpSource: r.source } : { ...p, adp: null, adpSource: null };
  });
}

export function applyMetadata(players: Player[], rows: MetadataRow[]): Player[] {
  const byId = new Map(rows.map((r) => [r.playerId, r]));
  return players.map((p) => {
    const r = byId.get(p.id);
    if (!r) return p;
    return { ...p, ...(r.elig ? { elig: r.elig, eligSource: "imported" as const } : {}), ...(r.team ? { team: r.team } : {}) };
  });
}

/** Manual availability override (e.g. sudden injury news during the draft). */
export function applyAvailabilityOverride(players: Player[], playerId: string, gamesMissed: number, note: string): Player[] {
  return players.map((p) => {
    if (p.id !== playerId || !p.proj) return p;
    const base = p.proj.gp;
    const gp = Math.max(0, base * (1 - Math.min(82, gamesMissed) / 82));
    return {
      ...p,
      availability: {
        status: gamesMissed >= 82 ? "OUT_SEASON" : gamesMissed >= 20 ? "OUT_EXTENDED" : gamesMissed > 0 ? "OUT_START" : "HEALTHY",
        injury: note,
        estGamesMissed: gamesMissed,
        estimateBasis: "Manual entry",
        confidence: "medium",
        sourceName: "Manual",
      },
      proj: { ...p.proj, gp, flags: [...p.proj.flags, `Manual availability: ~${gamesMissed} games missed (${note})`] },
    };
  });
}
