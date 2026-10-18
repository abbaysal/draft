import { createHash } from "node:crypto";
import { importAdp, importHistory, importMetadata, importProjections, importSchedule, type ImportKind, type ImportResult } from "@/lib/import/csv";
import { consensus, type ProjectionSet } from "@/lib/import/apply";
import { projectionFromRow } from "@/lib/import/apply";
import { bumpDataVersion, db } from "./db";
import { loadDataset } from "./dataset";
import { HttpError } from "./http";

export interface ImportOptions {
  source: string;
  label?: string;
  totals?: boolean;
  activate?: boolean;
  dryRun?: boolean;
  filename?: string;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "import";

export function contentHash(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

/** Validate, then (unless dryRun) persist an import as a NEW immutable version. */
export async function runImport(kind: ImportKind, text: string, opts: ImportOptions) {
  if (text.length > 5_000_000) throw new HttpError(413, "File too large (5 MB max)");
  const prisma = db();
  const { dataset } = await loadDataset();
  const players = dataset.players;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  let result: ImportResult<object>;
  let targetId: string | null = null;
  switch (kind) {
    case "projections": {
      const pr = importProjections(text, players, { totals: opts.totals });
      result = pr;
      if (!opts.dryRun && pr.rows.length && !pr.issues.some((i) => i.row === 0 && i.level === "error")) {
        targetId = `${slug(opts.source)}-${stamp}`;
        const byId = new Map(players.map((p) => [p.id, p]));
        await prisma.$transaction(async (tx) => {
          if (opts.activate) await tx.projectionSet.updateMany({ data: { isActive: false }, where: { isActive: true } });
          await tx.projectionSet.create({ data: { id: targetId!, label: opts.label || opts.source, source: opts.source, kind: "external", isActive: !!opts.activate } });
          const rows = pr.rows.map((r) => {
            const pr = projectionFromRow(r, { id: targetId!, source: opts.source, kind: "external" }, byId.get(r.playerId)?.proj ?? null);
            return { setId: targetId!, playerId: r.playerId, gp: r.gp, min: r.min, pts: r.pts, fg3m: r.fg3m, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov, fgm: r.fgm, fga: r.fga, ftm: r.ftm, fta: r.fta, sd: pr.sd as object, gpSd: pr.gpSd, confidence: pr.confidence, kind: "projection", flags: pr.flags };
          });
          for (let i = 0; i < rows.length; i += 500) await tx.projection.createMany({ data: rows.slice(i, i + 500) });
        });
      }
      break;
    }
    case "adp": {
      const ar = importAdp(text, players, opts.source);
      result = ar;
      if (!opts.dryRun && ar.rows.length) {
        targetId = `adp-${slug(opts.source)}-${stamp}`;
        await prisma.$transaction(async (tx) => {
          if (opts.activate !== false) await tx.adpSet.updateMany({ data: { isActive: false }, where: { isActive: true } });
          await tx.adpSet.create({ data: { id: targetId!, source: opts.source, isActive: opts.activate !== false } });
          await tx.adpEntry.createMany({ data: ar.rows.map((r) => ({ setId: targetId!, playerId: r.playerId, adp: r.adp })) });
        });
      }
      break;
    }
    case "history": {
      const hr = importHistory(text, players);
      result = hr;
      if (!opts.dryRun && hr.rows.length)
        await prisma.seasonStat.createMany({
          data: hr.rows.map((r) => ({ playerId: r.playerId, season: r.season, kind: "historical", source: `import:${slug(opts.source)}`, gp: Math.round(r.gp), min: r.min, pts: r.pts, fg3m: r.fg3m, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov, fgm: r.fgm, fga: r.fga, ftm: r.ftm, fta: r.fta, attemptsEstimated: false })),
          skipDuplicates: true,
        });
      break;
    }
    case "schedule": {
      const sr = importSchedule(text);
      result = sr;
      if (!opts.dryRun && sr.rows.length && !sr.issues.some((i) => i.row === 0 && i.level === "error"))
        await prisma.$transaction(async (tx) => {
          await tx.scheduleGame.deleteMany({ where: { season: "2026-27" } });
          await tx.scheduleGame.createMany({ data: sr.rows.map((g) => ({ season: "2026-27", date: g.date, home: g.home, away: g.away, source: opts.source })), skipDuplicates: true });
        });
      break;
    }
    case "metadata": {
      const mr = importMetadata(text, players);
      result = mr;
      if (!opts.dryRun && mr.rows.length) {
        const data = mr.rows.flatMap((r) => [
          ...(r.elig ? [{ playerId: r.playerId, field: "elig", value: { elig: r.elig } as object, note: `import:${opts.source}` }] : []),
          ...(r.team ? [{ playerId: r.playerId, field: "team", value: { team: r.team } as object, note: `import:${opts.source}` }] : []),
        ]);
        await prisma.playerOverride.createMany({ data });
      }
      break;
    }
  }
  const imported = opts.dryRun ? 0 : result.rows.length;
  await prisma.importLog.create({
    data: { kind, filename: opts.filename ?? null, rowsTotal: result.totalRows, rowsImported: imported, unmatched: result.unmatched.slice(0, 500), issues: result.issues.slice(0, 500) as object[], targetId },
  });
  if (imported) await bumpDataVersion();
  return { ...result, rows: result.rows.slice(0, 20), rowCount: result.rows.length, imported, targetId, dryRun: !!opts.dryRun };
}

export async function listProjectionSets() {
  const sets = await db().projectionSet.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { projections: true } } } });
  return sets.map((s) => ({ id: s.id, label: s.label, source: s.source, kind: s.kind, isActive: s.isActive, createdAt: s.createdAt.toISOString(), count: s._count.projections }));
}

export async function activateProjectionSet(id: string) {
  const prisma = db();
  const set = await prisma.projectionSet.findUnique({ where: { id } });
  if (!set) throw new HttpError(404, "Projection set not found");
  await prisma.$transaction([prisma.projectionSet.updateMany({ data: { isActive: false }, where: { isActive: true } }), prisma.projectionSet.update({ where: { id }, data: { isActive: true } })]);
  await bumpDataVersion();
}

export async function createConsensus(inputs: { id: string; weight: number }[], label?: string) {
  const prisma = db();
  const sets: { set: ProjectionSet; weight: number }[] = [];
  for (const inp of inputs) {
    const s = await prisma.projectionSet.findUnique({ where: { id: inp.id }, include: { projections: { include: { player: { select: { name: true } } } } } });
    if (!s) throw new HttpError(404, `Projection set ${inp.id} not found`);
    sets.push({
      weight: inp.weight,
      set: { id: s.id, label: s.label, source: s.source, kind: s.kind as ProjectionSet["kind"], createdAt: s.createdAt.toISOString(), rows: s.projections.map((p) => ({ playerId: p.playerId, name: p.player.name, gp: p.gp, min: p.min, pts: p.pts, fg3m: p.fg3m, reb: p.reb, ast: p.ast, stl: p.stl, blk: p.blk, tov: p.tov, fgm: p.fgm, fga: p.fga, ftm: p.ftm, fta: p.fta })) },
    });
  }
  const id = `consensus-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const c = consensus(sets, id, new Date().toISOString());
  const { dataset } = await loadDataset();
  const byId = new Map(dataset.players.map((p) => [p.id, p]));
  await prisma.$transaction(async (tx) => {
    await tx.projectionSet.create({ data: { id, label: label || c.label, source: "consensus", kind: "consensus", notes: c.label } });
    const rows = c.rows.map((r) => {
      const pr = projectionFromRow(r, { id, source: "consensus", kind: "consensus" }, byId.get(r.playerId)?.proj ?? null);
      return { setId: id, playerId: r.playerId, gp: r.gp, min: r.min, pts: r.pts, fg3m: r.fg3m, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov, fgm: r.fgm, fga: r.fga, ftm: r.ftm, fta: r.fta, sd: pr.sd as object, gpSd: pr.gpSd, confidence: pr.confidence, kind: "projection", flags: [c.label] };
    });
    for (let i = 0; i < rows.length; i += 500) await tx.projection.createMany({ data: rows.slice(i, i + 500) });
  });
  await bumpDataVersion();
  return { id, label: c.label, count: c.rows.length };
}
