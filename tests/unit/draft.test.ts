import { describe, expect, it } from "vitest";
import {
  EMPTY_DRAFT,
  applyDraftAction,
  defaultOwner,
  draftOrder,
  teamPicksFrom,
  validateDraftState,
  type DraftState,
} from "@/lib/engine/draft";

const shape = { teams: 12, rounds: 13, draftType: "snake" as const };

function pickN(n: number, state: DraftState = EMPTY_DRAFT) {
  let s = state;
  for (let i = 0; i < n; i++) {
    const r = applyDraftAction(s, { type: "pick", playerId: `x${s.picks.length}`, at: "2026-10-18T00:00:00Z" }, shape);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

describe("snake order", () => {
  it("reverses every even round", () => {
    const order = draftOrder(shape);
    expect(order.slice(0, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(order.slice(12, 24)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(order.slice(24, 36)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(order).toHaveLength(156);
  });

  it("linear drafts keep the same order every round", () => {
    expect(defaultOwner(13, { ...shape, draftType: "linear" })).toBe(0);
  });

  it("finds a team's picks (the turn at the end of a round gives back-to-back picks)", () => {
    expect(teamPicksFrom(11, 1, shape).slice(0, 4)).toEqual([12, 13, 36, 37]);
    expect(teamPicksFrom(0, 1, shape).slice(0, 3)).toEqual([1, 24, 25]);
  });

  it("handles a very long interval between my picks", () => {
    const big = { teams: 20, rounds: 13, draftType: "snake" as const };
    const mine = teamPicksFrom(0, 1, big);
    expect(mine[1] - mine[0]).toBe(39);
  });
});

describe("draft reducer", () => {
  it("assigns picks to the correct team in snake order", () => {
    const s = pickN(14);
    expect(s.picks[11].teamIndex).toBe(11);
    expect(s.picks[12].teamIndex).toBe(11);
    expect(s.picks[13].teamIndex).toBe(10);
    expect(s.picks[13].round).toBe(2);
    expect(validateDraftState(s, shape)).toEqual([]);
  });

  it("prevents drafting the same player twice", () => {
    const s = pickN(1);
    const r = applyDraftAction(s, { type: "pick", playerId: "x0" }, shape);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown players", () => {
    const r = applyDraftAction(EMPTY_DRAFT, { type: "pick", playerId: "ghost" }, shape, (id) => id !== "ghost");
    expect(r.ok).toBe(false);
  });

  it("supports undo and redo", () => {
    const s = pickN(3);
    const u = applyDraftAction(s, { type: "undo" }, shape);
    expect(u.ok && u.state.picks.length).toBe(2);
    if (!u.ok) return;
    expect(u.state.redo[0].playerId).toBe("x2");
    const r = applyDraftAction(u.state, { type: "redo" }, shape);
    expect(r.ok && r.state.picks.map((p) => p.playerId)).toEqual(["x0", "x1", "x2"]);
  });

  it("clears redo on a new pick and refuses redo of a player drafted meanwhile", () => {
    const s = pickN(2);
    const u = applyDraftAction(s, { type: "undo" }, shape);
    if (!u.ok) throw new Error();
    const p = applyDraftAction(u.state, { type: "pick", playerId: "other" }, shape);
    if (!p.ok) throw new Error();
    expect(p.state.redo).toEqual([]);
  });

  it("edits a past pick without duplicating players", () => {
    const s = pickN(3);
    const ok = applyDraftAction(s, { type: "edit", overall: 2, playerId: "fixed" }, shape);
    expect(ok.ok && ok.state.picks[1].playerId).toBe("fixed");
    const dup = applyDraftAction(s, { type: "edit", overall: 2, playerId: "x0" }, shape);
    expect(dup.ok).toBe(false);
  });

  it("supports traded picks via owner overrides", () => {
    const r = applyDraftAction(EMPTY_DRAFT, { type: "setOwner", overall: 1, teamIndex: 5 }, shape);
    if (!r.ok) throw new Error();
    const p = applyDraftAction(r.state, { type: "pick", playerId: "a" }, shape);
    expect(p.ok && p.state.picks[0].teamIndex).toBe(5);
  });

  it("refuses picks after the draft is complete (nearly completed draft edge)", () => {
    const small = { teams: 2, rounds: 2, draftType: "snake" as const };
    let s = EMPTY_DRAFT;
    for (let i = 0; i < 4; i++) {
      const r = applyDraftAction(s, { type: "pick", playerId: `y${i}` }, small);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
    }
    expect(applyDraftAction(s, { type: "pick", playerId: "late" }, small).ok).toBe(false);
  });

  it("increments version on every successful mutation (optimistic concurrency)", () => {
    const s = pickN(2);
    expect(s.version).toBe(2);
  });

  it("detects corrupted states", () => {
    const s = pickN(2);
    const bad = { ...s, picks: [s.picks[0], { ...s.picks[1], playerId: s.picks[0].playerId }] };
    expect(validateDraftState(bad, shape).length).toBeGreaterThan(0);
  });
});
