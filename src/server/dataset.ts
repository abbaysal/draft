import type { Availability, Dataset, HistSeason, Player, PlayerTag, Projection, SlotPos, TeamChange } from "@/lib/types";
import type { ScheduleGame } from "@/lib/engine/schedule";
import bundled from "@/data/dataset.generated.json";
import bundledSchedule from "@/data/schedule.generated.json";
import { db, getConfig, hasDatabase } from "./db";

export interface DatasetPayload {
  dataset: Dataset;
  schedule: ScheduleGame[];
  projectionSetId: string;
  adpSetId: string | null;
  dataVersion: number;
  source: "database" | "bundled";
}

type Cached = { key: string; payload: DatasetPayload };
const cache = new Map<string, Cached>();

/** Compose the analysis dataset. Uses the database when configured, else the bundled snapshot. */
export async function loadDataset(setId?: string | null): Promise<DatasetPayload> {
  if (!hasDatabase()) {
    const ds = bundled as unknown as Dataset;
    return { dataset: ds, schedule: bundledSchedule as ScheduleGame[], projectionSetId: ds.meta.projectionVersion, adpSetId: null, dataVersion: 0, source: "bundled" };
  }
  const prisma = db();
  const dataVersion = await getConfig<number>("dataVersion", 0);
  const activeSet = setId ? await prisma.projectionSet.findUnique({ where: { id: setId } }) : await prisma.projectionSet.findFirst({ where: { isActive: true } });
  if (!activeSet) throw new Error("No projection set found — run the seed (npm run db:seed).");
  const activeAdp = await prisma.adpSet.findFirst({ where: { isActive: true } });
  const key = `${dataVersion}|${activeSet.id}|${activeAdp?.id ?? ""}`;
  const hit = cache.get(activeSet.id);
  if (hit && hit.key === key) return hit.payload;

  const [players, stats, projs, adps, overrides, games] = await Promise.all([
    prisma.player.findMany(),
    prisma.seasonStat.findMany(),
    prisma.projection.findMany({ where: { setId: activeSet.id } }),
    activeAdp ? prisma.adpEntry.findMany({ where: { setId: activeAdp.id } }) : Promise.resolve([]),
    prisma.playerOverride.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } }),
    prisma.scheduleGame.findMany({ where: { season: "2026-27" } }),
  ]);
  const histBy = new Map<string, HistSeason[]>();
  for (const s of stats) {
    const arr = histBy.get(s.playerId) ?? [];
    arr.push({ season: s.season, source: s.source, team: s.team ?? undefined, gp: s.gp, min: s.min, pts: s.pts, fg3m: s.fg3m, reb: s.reb, ast: s.ast, stl: s.stl, blk: s.blk, tov: s.tov, fgm: s.fgm, fga: s.fga, ftm: s.ftm, fta: s.fta, attemptsEstimated: s.attemptsEstimated });
    histBy.set(s.playerId, arr);
  }
  const projBy = new Map(projs.map((p) => [p.playerId, p]));
  const adpBy = new Map(adps.map((a) => [a.playerId, a.adp]));
  const out: Player[] = players.map((p) => {
    const j = projBy.get(p.id);
    const proj: Projection | null = j
      ? { min: j.min, pts: j.pts, fg3m: j.fg3m, reb: j.reb, ast: j.ast, stl: j.stl, blk: j.blk, tov: j.tov, fgm: j.fgm, fga: j.fga, ftm: j.ftm, fta: j.fta, gp: j.gp, sd: j.sd as Projection["sd"], gpSd: j.gpSd, confidence: j.confidence, source: activeSet.source, version: activeSet.id, kind: j.kind as Projection["kind"], flags: j.flags }
      : null;
    return {
      id: p.id,
      nbaId: p.nbaId ?? undefined,
      espnId: p.espnId ?? undefined,
      name: p.name,
      team: p.team,
      nbaPos: p.nbaPos,
      elig: p.elig as SlotPos[],
      eligSource: p.eligSource as Player["eligSource"],
      age: p.age ?? undefined,
      birthdate: p.birthdate ?? undefined,
      experience: p.experience ?? undefined,
      heightM: p.heightM ?? undefined,
      weightKg: p.weightKg ?? undefined,
      rookie: (p.rookie as Player["rookie"]) ?? undefined,
      teamChange: (p.teamChange as unknown as TeamChange) ?? undefined,
      availability: (p.availability as unknown as Availability) ?? undefined,
      tags: (p.tags as unknown as PlayerTag[]) ?? [],
      proj,
      hist: (histBy.get(p.id) ?? []).sort((a, b) => b.season.localeCompare(a.season)),
      adp: adpBy.get(p.id) ?? null,
      adpSource: adpBy.has(p.id) ? (activeAdp?.source ?? null) : null,
    };
  });
  const byId = new Map(out.map((p) => [p.id, p]));
  for (const o of overrides) {
    const p = byId.get(o.playerId);
    if (!p) continue;
    const v = o.value as Record<string, unknown>;
    if (o.field === "team" && typeof v.team === "string") p.team = v.team;
    if (o.field === "elig" && Array.isArray(v.elig)) {
      p.elig = v.elig as SlotPos[];
      p.eligSource = "manual";
    }
    if (o.field === "gamesMissed" && typeof v.games === "number" && p.proj) {
      const g = Math.min(82, Math.max(0, v.games));
      p.proj = { ...p.proj, gp: p.proj.gp * (1 - g / 82), flags: [...p.proj.flags, `Manual override: ~${g} games missed (${o.note ?? ""})`] };
      p.availability = { status: g >= 82 ? "OUT_SEASON" : g >= 20 ? "OUT_EXTENDED" : g > 0 ? "OUT_START" : "HEALTHY", injury: o.note ?? "Manual override", estGamesMissed: g, estimateBasis: "Manual entry", confidence: "medium", sourceName: "Manual", reportedDate: o.createdAt.toISOString().slice(0, 10) };
    }
  }
  const base = bundled as unknown as Dataset;
  const dataset: Dataset = {
    meta: { ...base.meta, projectionVersion: activeSet.id, projectionSource: activeSet.source, playerCount: out.length, projectedCount: out.filter((p) => p.proj).length },
    players: out,
  };
  const payload: DatasetPayload = {
    dataset,
    schedule: games.length ? games.map((g) => ({ date: g.date, home: g.home, away: g.away })) : (bundledSchedule as ScheduleGame[]),
    projectionSetId: activeSet.id,
    adpSetId: activeAdp?.id ?? null,
    dataVersion,
    source: "database",
  };
  cache.set(activeSet.id, { key, payload });
  return payload;
}
