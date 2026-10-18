/**
 * Draft state machine. Pure and deterministic so the same reducer runs in the
 * browser (optimistic updates) and on the server (authoritative transaction).
 */
export interface DraftPick {
  overall: number; // 1-based
  round: number; // 1-based
  teamIndex: number; // 0-based
  playerId: string;
  at: string; // ISO timestamp
}

export interface DraftState {
  picks: DraftPick[];
  redo: DraftPick[];
  /** Traded / corrected pick ownership: overall -> teamIndex. */
  ownerOverrides: Record<number, number>;
  version: number;
}

export interface DraftShape {
  teams: number;
  rounds: number;
  draftType: "snake" | "linear";
}

export type DraftAction =
  | { type: "pick"; playerId: string; at?: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "edit"; overall: number; playerId: string }
  | { type: "setOwner"; overall: number; teamIndex: number }
  | { type: "reset" };

export type DraftResult = { ok: true; state: DraftState } | { ok: false; error: string };

export const EMPTY_DRAFT: DraftState = { picks: [], redo: [], ownerOverrides: {}, version: 0 };

export function totalPicks(s: DraftShape): number {
  return s.teams * s.rounds;
}

export function roundOf(overall: number, teams: number): number {
  return Math.floor((overall - 1) / teams) + 1;
}

/** Team index (0-based) on the clock for an overall pick under the default order. */
export function defaultOwner(overall: number, s: DraftShape): number {
  const round = roundOf(overall, s.teams);
  const idx = (overall - 1) % s.teams;
  return s.draftType === "snake" && round % 2 === 0 ? s.teams - 1 - idx : idx;
}

export function ownerOf(overall: number, s: DraftShape, overrides: Record<number, number> = {}): number {
  return overrides[overall] ?? defaultOwner(overall, s);
}

export function draftOrder(s: DraftShape, overrides: Record<number, number> = {}): number[] {
  return Array.from({ length: totalPicks(s) }, (_, i) => ownerOf(i + 1, s, overrides));
}

export function currentOverall(state: DraftState): number {
  return state.picks.length + 1;
}

export function isComplete(state: DraftState, s: DraftShape): boolean {
  return state.picks.length >= totalPicks(s);
}

/** Overall pick numbers belonging to a team at or after `from`. */
export function teamPicksFrom(teamIndex: number, from: number, s: DraftShape, overrides: Record<number, number> = {}): number[] {
  const out: number[] = [];
  for (let o = Math.max(1, from); o <= totalPicks(s); o++) if (ownerOf(o, s, overrides) === teamIndex) out.push(o);
  return out;
}

export function draftedIds(state: DraftState): Set<string> {
  return new Set(state.picks.map((p) => p.playerId));
}

export function rosters(state: DraftState, teams: number): string[][] {
  const r: string[][] = Array.from({ length: teams }, () => []);
  for (const p of state.picks) r[p.teamIndex]?.push(p.playerId);
  return r;
}

function bump(state: DraftState, patch: Partial<DraftState>): DraftState {
  return { ...state, ...patch, version: state.version + 1 };
}

/**
 * Apply an action. Validates: snake order and pick ownership, duplicate players,
 * draft completion, redo applicability and edit targets.
 */
export function applyDraftAction(
  state: DraftState,
  action: DraftAction,
  shape: DraftShape,
  isKnownPlayer: (id: string) => boolean = () => true,
): DraftResult {
  switch (action.type) {
    case "pick": {
      if (isComplete(state, shape)) return { ok: false, error: "Draft is complete" };
      if (!isKnownPlayer(action.playerId)) return { ok: false, error: `Unknown player ${action.playerId}` };
      if (draftedIds(state).has(action.playerId)) return { ok: false, error: "Player already drafted" };
      const overall = currentOverall(state);
      const pick: DraftPick = {
        overall,
        round: roundOf(overall, shape.teams),
        teamIndex: ownerOf(overall, shape, state.ownerOverrides),
        playerId: action.playerId,
        at: action.at ?? new Date().toISOString(),
      };
      return { ok: true, state: bump(state, { picks: [...state.picks, pick], redo: [] }) };
    }
    case "undo": {
      if (!state.picks.length) return { ok: false, error: "Nothing to undo" };
      const last = state.picks[state.picks.length - 1];
      return { ok: true, state: bump(state, { picks: state.picks.slice(0, -1), redo: [last, ...state.redo] }) };
    }
    case "redo": {
      if (!state.redo.length) return { ok: false, error: "Nothing to redo" };
      const [next, ...rest] = state.redo;
      if (draftedIds(state).has(next.playerId)) return { ok: false, error: "Redo player is already drafted" };
      const overall = currentOverall(state);
      const pick: DraftPick = { ...next, overall, round: roundOf(overall, shape.teams), teamIndex: ownerOf(overall, shape, state.ownerOverrides) };
      return { ok: true, state: bump(state, { picks: [...state.picks, pick], redo: rest }) };
    }
    case "edit": {
      const idx = state.picks.findIndex((p) => p.overall === action.overall);
      if (idx === -1) return { ok: false, error: `Pick ${action.overall} has not been made` };
      if (!isKnownPlayer(action.playerId)) return { ok: false, error: `Unknown player ${action.playerId}` };
      const dup = state.picks.find((p) => p.playerId === action.playerId && p.overall !== action.overall);
      if (dup) return { ok: false, error: `Player already drafted at pick ${dup.overall}` };
      const picks = state.picks.slice();
      picks[idx] = { ...picks[idx], playerId: action.playerId };
      return { ok: true, state: bump(state, { picks, redo: state.redo.filter((r) => r.playerId !== action.playerId) }) };
    }
    case "setOwner": {
      if (action.overall < 1 || action.overall > totalPicks(shape)) return { ok: false, error: "Pick out of range" };
      if (action.teamIndex < 0 || action.teamIndex >= shape.teams) return { ok: false, error: "Team out of range" };
      const ownerOverrides = { ...state.ownerOverrides, [action.overall]: action.teamIndex };
      const picks = state.picks.map((p) => (p.overall === action.overall ? { ...p, teamIndex: action.teamIndex } : p));
      return { ok: true, state: bump(state, { ownerOverrides, picks }) };
    }
    case "reset":
      return { ok: true, state: { ...EMPTY_DRAFT, version: state.version + 1 } };
  }
}

/** Integrity check used by the server before persisting and by restore/import. */
export function validateDraftState(state: DraftState, shape: DraftShape): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  state.picks.forEach((p, i) => {
    if (p.overall !== i + 1) errors.push(`Pick ${i + 1} has overall ${p.overall}`);
    if (seen.has(p.playerId)) errors.push(`Duplicate player ${p.playerId}`);
    seen.add(p.playerId);
    const owner = ownerOf(p.overall, shape, state.ownerOverrides);
    if (p.teamIndex !== owner) errors.push(`Pick ${p.overall} assigned to team ${p.teamIndex} but owner is ${owner}`);
  });
  if (state.picks.length > totalPicks(shape)) errors.push("More picks than the draft allows");
  return errors;
}
