/**
 * Integration tests against a real PostgreSQL database (skipped when DATABASE_URL is
 * not set). Covers draft persistence, transactional pick rows, duplicate prevention
 * under concurrent requests, optimistic concurrency, undo/redo and the audit trail.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/league";

const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("draft sessions (PostgreSQL)", () => {
  let mod: typeof import("@/server/drafts");
  let dbm: typeof import("@/server/db");
  let id = "";
  let players: string[] = [];

  beforeAll(async () => {
    dbm = await import("@/server/db");
    const { seedDatabase } = await import("@/server/seed");
    await seedDatabase(dbm.db());
    mod = await import("@/server/drafts");
    players = (await dbm.db().player.findMany({ take: 5, orderBy: { id: "asc" }, select: { id: true } })).map((p) => p.id);
    const s = await mod.createSession({ name: "integration", settings: DEFAULT_SETTINGS });
    id = s.id;
  });

  afterAll(async () => {
    if (id) await dbm.db().draftSession.delete({ where: { id } }).catch(() => {});
    await dbm.db().$disconnect();
  });

  it("persists a pick with an audit row and pick row", async () => {
    const s = await mod.applyAction(id, { action: { type: "pick", playerId: players[0] }, expectedVersion: 0, audit: { recommendation: { top: [] } } });
    expect(s.version).toBe(1);
    expect(s.state.picks[0].playerId).toBe(players[0]);
    const rows = await dbm.db().draftPick.findMany({ where: { sessionId: id } });
    expect(rows).toHaveLength(1);
    const audit = await mod.getAudit(id);
    expect(audit[0].action).toBe("pick");
    expect((audit[0].stateBefore as { picks: unknown[] }).picks).toHaveLength(0);
  });

  it("rejects stale versions (optimistic concurrency)", async () => {
    await expect(mod.applyAction(id, { action: { type: "pick", playerId: players[1] }, expectedVersion: 0 })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects duplicate players", async () => {
    await expect(mod.applyAction(id, { action: { type: "pick", playerId: players[0] }, expectedVersion: 1 })).rejects.toMatchObject({ status: 422 });
  });

  it("allows exactly one of two concurrent requests for the same version", async () => {
    const results = await Promise.allSettled([
      mod.applyAction(id, { action: { type: "pick", playerId: players[1] }, expectedVersion: 1 }),
      mod.applyAction(id, { action: { type: "pick", playerId: players[2] }, expectedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const s = await mod.getSession(id);
    expect(s.state.picks).toHaveLength(2);
    const rows = await dbm.db().draftPick.findMany({ where: { sessionId: id } });
    expect(rows).toHaveLength(2);
  });

  it("undo removes the pick row and redo restores it", async () => {
    let s = await mod.getSession(id);
    s = await mod.applyAction(id, { action: { type: "undo" }, expectedVersion: s.version });
    expect(await dbm.db().draftPick.count({ where: { sessionId: id } })).toBe(1);
    s = await mod.applyAction(id, { action: { type: "redo" }, expectedVersion: s.version });
    expect(await dbm.db().draftPick.count({ where: { sessionId: id } })).toBe(2);
    expect(s.state.picks).toHaveLength(2);
  });

  it("pick corrections keep pick rows unique", async () => {
    let s = await mod.getSession(id);
    s = await mod.applyAction(id, { action: { type: "edit", overall: 2, playerId: players[3] }, expectedVersion: s.version });
    const rows = await dbm.db().draftPick.findMany({ where: { sessionId: id }, orderBy: { overall: "asc" } });
    expect(rows.map((r) => r.playerId)).toEqual([players[0], players[3]]);
    await expect(mod.applyAction(id, { action: { type: "edit", overall: 2, playerId: players[0] }, expectedVersion: s.version })).rejects.toMatchObject({ status: 422 });
  });

  it("refuses settings that conflict with existing picks", async () => {
    const s = await mod.getSession(id);
    await expect(mod.updateSession(id, { settings: { ...DEFAULT_SETTINGS, teams: 1 }, expectedVersion: s.version })).rejects.toBeTruthy();
  });

  it("seed is idempotent and never rewrites the immutable projection set", async () => {
    const before = await dbm.db().projection.count();
    const { seedDatabase } = await import("@/server/seed");
    await seedDatabase(dbm.db());
    expect(await dbm.db().projection.count()).toBe(before);
  });
});
