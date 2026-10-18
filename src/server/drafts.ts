import type { z } from "zod";
import { ActionRequestSchema, DraftStateSchema } from "./drafts.schema";
export { ActionRequestSchema, DraftActionSchema, DraftStateSchema, AuditPayloadSchema } from "./drafts.schema";
import type { Prisma } from "@prisma/client";
import { LeagueSettingsSchema, normaliseSettings, type LeagueSettings } from "@/lib/league";
import { EMPTY_DRAFT, applyDraftAction, validateDraftState, type DraftAction, type DraftState } from "@/lib/engine/draft";
import { db } from "./db";
import { HttpError } from "./http";

function shapeOf(s: LeagueSettings) {
  return { teams: s.teams, rounds: s.rounds, draftType: s.draftType };
}

export interface SessionDTO {
  id: string;
  name: string;
  settings: LeagueSettings;
  state: DraftState;
  version: number;
  projectionSetId: string | null;
  createdAt: string;
  updatedAt: string;
}

function toDTO(r: { id: string; name: string; settings: Prisma.JsonValue; state: Prisma.JsonValue; version: number; projectionSetId: string | null; createdAt: Date; updatedAt: Date }): SessionDTO {
  return {
    id: r.id,
    name: r.name,
    settings: r.settings as unknown as LeagueSettings,
    state: r.state as unknown as DraftState,
    version: r.version,
    projectionSetId: r.projectionSetId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function listSessions() {
  const rows = await db().draftSession.findMany({ where: { archived: false }, orderBy: { updatedAt: "desc" }, take: 50 });
  return rows.map(toDTO);
}

export async function getSession(id: string): Promise<SessionDTO> {
  const r = await db().draftSession.findUnique({ where: { id } });
  if (!r || r.archived) throw new HttpError(404, "Draft session not found");
  return toDTO(r);
}

export async function createSession(input: { name: string; settings: unknown; state?: unknown; projectionSetId?: string | null }) {
  const settings = normaliseSettings(LeagueSettingsSchema.parse(input.settings));
  const state = input.state ? (DraftStateSchema.parse(input.state) as DraftState) : EMPTY_DRAFT;
  const errors = validateDraftState(state, shapeOf(settings));
  if (errors.length) throw new HttpError(400, "Invalid draft state", { errors });
  const prisma = db();
  const set = input.projectionSetId
    ? await prisma.projectionSet.findUnique({ where: { id: input.projectionSetId } })
    : await prisma.projectionSet.findFirst({ where: { isActive: true } });
  return prisma.$transaction(async (tx) => {
    const r = await tx.draftSession.create({
      data: { name: input.name.slice(0, 80), settings: settings as object, state: state as unknown as object, version: state.version, projectionSetId: set?.id ?? null },
    });
    if (state.picks.length)
      await tx.draftPick.createMany({ data: state.picks.map((p) => ({ sessionId: r.id, overall: p.overall, round: p.round, teamIndex: p.teamIndex, playerId: p.playerId, at: new Date(p.at) })) });
    return toDTO(r);
  });
}

export async function updateSession(id: string, patch: { name?: string; settings?: unknown; expectedVersion: number }) {
  const cur = await getSession(id);
  const settings = patch.settings ? normaliseSettings(LeagueSettingsSchema.parse(patch.settings)) : cur.settings;
  const errors = validateDraftState(cur.state, shapeOf(settings));
  if (errors.length) throw new HttpError(409, "Settings conflict with existing picks", { errors });
  const res = await db().draftSession.updateMany({
    where: { id, version: patch.expectedVersion },
    data: { name: patch.name?.slice(0, 80) ?? cur.name, settings: settings as object, version: { increment: 1 }, state: { ...cur.state, version: cur.version + 1 } as unknown as object },
  });
  if (res.count === 0) throw new HttpError(409, "Version conflict", { current: await getSession(id) });
  return getSession(id);
}

export async function archiveSession(id: string) {
  await db().draftSession.update({ where: { id }, data: { archived: true } });
}

/**
 * Apply a draft action transactionally:
 *  1. optimistic concurrency on `version` (a stale client gets 409 + current state),
 *  2. the pure reducer validates order / duplicates / ownership,
 *  3. DraftPick rows are synchronised — their unique (session, overall) and
 *     (session, player) constraints make double-drafting impossible even under races,
 *  4. an immutable audit row records the state before the action and the client's
 *     recommendation snapshot.
 */
export async function applyAction(id: string, body: z.infer<typeof ActionRequestSchema>): Promise<SessionDTO> {
  const prisma = db();
  try {
    return await prisma.$transaction(async (tx) => {
      const r = await tx.draftSession.findUnique({ where: { id } });
      if (!r || r.archived) throw new HttpError(404, "Draft session not found");
      if (r.version !== body.expectedVersion) throw new HttpError(409, "Version conflict", { current: toDTO(r) });
      const settings = r.settings as unknown as LeagueSettings;
      const before = r.state as unknown as DraftState;
      const action = body.action as DraftAction;
      if (action.type === "pick" || action.type === "edit") {
        const exists = await tx.player.findUnique({ where: { id: action.playerId }, select: { id: true } });
        if (!exists) throw new HttpError(400, `Unknown player ${action.playerId}`);
      }
      const res = applyDraftAction(before, action, shapeOf(settings));
      if (!res.ok) throw new HttpError(422, res.error);
      const next = res.state;
      // Sync pick rows: remove rows that changed or disappeared, then insert new/changed rows.
      const oldBy = new Map(before.picks.map((p) => [p.overall, p]));
      const newBy = new Map(next.picks.map((p) => [p.overall, p]));
      const stale = before.picks.filter((p) => {
        const n = newBy.get(p.overall);
        return !n || n.playerId !== p.playerId || n.teamIndex !== p.teamIndex;
      });
      if (stale.length) await tx.draftPick.deleteMany({ where: { sessionId: id, overall: { in: stale.map((p) => p.overall) } } });
      const fresh = next.picks.filter((p) => {
        const o = oldBy.get(p.overall);
        return !o || o.playerId !== p.playerId || o.teamIndex !== p.teamIndex;
      });
      if (fresh.length)
        await tx.draftPick.createMany({ data: fresh.map((p) => ({ sessionId: id, overall: p.overall, round: p.round, teamIndex: p.teamIndex, playerId: p.playerId, at: new Date(p.at) })) });
      const upd = await tx.draftSession.updateMany({ where: { id, version: body.expectedVersion }, data: { state: next as unknown as object, version: next.version } });
      if (upd.count === 0) throw new HttpError(409, "Version conflict");
      const last = action.type === "pick" ? next.picks[next.picks.length - 1] : null;
      await tx.draftAudit.create({
        data: {
          sessionId: id,
          version: next.version,
          action: action.type,
          overall: last?.overall ?? (action.type === "edit" || action.type === "setOwner" ? action.overall : null),
          playerId: last?.playerId ?? (action.type === "edit" ? action.playerId : null),
          teamIndex: last?.teamIndex ?? null,
          recommendation: (body.audit?.recommendation ?? undefined) as object | undefined,
          categoryImpact: (body.audit?.categoryImpact ?? undefined) as object | undefined,
          simulation: (body.audit?.simulation ?? undefined) as object | undefined,
          stateBefore: before as unknown as object,
          projectionSetId: r.projectionSetId,
        },
      });
      const out = await tx.draftSession.findUniqueOrThrow({ where: { id } });
      return toDTO(out);
    });
  } catch (e) {
    // Unique-constraint violation on DraftPick = concurrent duplicate selection.
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") throw new HttpError(409, "Player or pick already taken (concurrent update)", { current: await getSession(id) });
    throw e;
  }
}

export async function getAudit(id: string) {
  return db().draftAudit.findMany({ where: { sessionId: id }, orderBy: { createdAt: "asc" } });
}

export async function exportSession(id: string) {
  const s = await getSession(id);
  const audit = await getAudit(id);
  return { format: "warroom-draft-v1", exportedAt: new Date().toISOString(), session: s, audit };
}

export async function saveSimulation(id: string, input: { stateVersion: number; kind: string; params: unknown; result: unknown }) {
  return db().simulationResult.create({
    data: { sessionId: id, stateVersion: input.stateVersion, kind: input.kind.slice(0, 32), params: (input.params ?? {}) as object, result: (input.result ?? {}) as object },
  });
}

export async function latestSimulations(id: string, stateVersion?: number) {
  return db().simulationResult.findMany({ where: { sessionId: id, ...(stateVersion != null ? { stateVersion } : {}) }, orderBy: { createdAt: "desc" }, take: 10 });
}
