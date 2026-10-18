import type { PrismaClient } from "@prisma/client";
import { nameKey } from "@/lib/names";
import type { Dataset } from "@/lib/types";
import bundled from "@/data/dataset.generated.json";

/**
 * Idempotent seed from the bundled, versioned dataset:
 *  - Player identity rows are upserted (metadata may be refreshed).
 *  - Season statistics are inserted once (skipDuplicates).
 *  - The model projection set is IMMUTABLE: created only if its id does not exist.
 *  - Researched availability items become NewsItem rows (deduplicated).
 */
export async function seedDatabase(prisma: PrismaClient, opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const ds = bundled as unknown as Dataset;
  const setId = ds.meta.projectionVersion;
  let players = 0;
  for (const p of ds.players) {
    const data = {
      nbaId: p.nbaId ?? null,
      espnId: p.espnId ?? null,
      name: p.name,
      nameKey: nameKey(p.name),
      team: p.team,
      nbaPos: p.nbaPos,
      elig: p.elig,
      eligSource: p.eligSource,
      age: p.age ?? null,
      birthdate: p.birthdate ?? null,
      experience: p.experience ?? null,
      heightM: p.heightM ?? null,
      weightKg: p.weightKg ?? null,
      rookie: (p.rookie ?? undefined) as object | undefined,
      teamChange: (p.teamChange ?? undefined) as object | undefined,
      availability: (p.availability ?? undefined) as object | undefined,
      tags: p.tags as unknown as object,
    };
    await prisma.player.upsert({ where: { id: p.id }, update: data, create: { id: p.id, ...data } });
    players++;
  }
  log(`players upserted: ${players}`);

  const stats = ds.players.flatMap((p) =>
    p.hist.map((h) => ({
      playerId: p.id,
      season: h.season,
      kind: "historical",
      source: h.source,
      team: h.team ?? null,
      gp: Math.round(h.gp),
      min: h.min,
      pts: h.pts,
      fg3m: h.fg3m,
      reb: h.reb,
      ast: h.ast,
      stl: h.stl,
      blk: h.blk,
      tov: h.tov,
      fgm: h.fgm,
      fga: h.fga,
      ftm: h.ftm,
      fta: h.fta,
      attemptsEstimated: h.attemptsEstimated,
    })),
  );
  for (let i = 0; i < stats.length; i += 500) await prisma.seasonStat.createMany({ data: stats.slice(i, i + 500), skipDuplicates: true });
  log(`season stats ensured: ${stats.length}`);

  const existing = await prisma.projectionSet.findUnique({ where: { id: setId } });
  if (!existing) {
    const anyActive = await prisma.projectionSet.findFirst({ where: { isActive: true } });
    await prisma.projectionSet.create({
      data: { id: setId, label: `WarRoom Projection Model ${setId}`, source: ds.meta.projectionSource, kind: "model", isActive: !anyActive, notes: ds.meta.notes.join("\n") },
    });
    const rows = ds.players
      .filter((p) => p.proj)
      .map((p) => {
        const j = p.proj!;
        return {
          setId,
          playerId: p.id,
          gp: j.gp,
          min: j.min,
          pts: j.pts,
          fg3m: j.fg3m,
          reb: j.reb,
          ast: j.ast,
          stl: j.stl,
          blk: j.blk,
          tov: j.tov,
          fgm: j.fgm,
          fga: j.fga,
          ftm: j.ftm,
          fta: j.fta,
          sd: j.sd as object,
          gpSd: j.gpSd,
          confidence: j.confidence,
          kind: j.kind,
          flags: j.flags,
        };
      });
    for (let i = 0; i < rows.length; i += 500) await prisma.projection.createMany({ data: rows.slice(i, i + 500) });
    log(`projection set ${setId} created (${rows.length} rows)`);
  } else log(`projection set ${setId} already exists — left untouched (immutable)`);

  const news = ds.players
    .filter((p) => p.availability)
    .map((p) => ({
      playerId: p.id,
      title: `${p.name}: ${p.availability!.status.replace(/_/g, " ").toLowerCase()} — ${p.availability!.injury ?? ""}`,
      body: [p.availability!.estimateBasis, p.availability!.notes].filter(Boolean).join(" · "),
      kind: "injury",
      status: "reported",
      confidence: p.availability!.confidence,
      sourceName: p.availability!.sourceName ?? "research",
      sourceUrl: p.availability!.sourceUrl ?? null,
      publishedAt: new Date((p.availability!.reportedDate ?? "2026-10-01").length === 7 ? `${p.availability!.reportedDate}-01` : (p.availability!.reportedDate ?? "2026-10-01")),
      dedupeKey: `research:${p.id}:${p.availability!.status}:${p.availability!.reportedDate}`,
    }));
  await prisma.newsItem.createMany({ data: news, skipDuplicates: true });
  log(`news items ensured: ${news.length}`);
  const dv = await prisma.appConfig.findUnique({ where: { key: "dataVersion" } });
  if (!dv) await prisma.appConfig.create({ data: { key: "dataVersion", value: 1 } });
  return { players, stats: stats.length, setId };
}
