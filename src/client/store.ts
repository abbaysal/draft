"use client";
/**
 * Client state: dataset, draft sessions, sync queue and shared analysis results.
 *
 * Persistence model
 *  - Server mode (DATABASE_URL configured): the database is authoritative. Every
 *    action is applied optimistically with the same pure reducer the server uses,
 *    then confirmed by POST /api/drafts/:id/actions (optimistic concurrency on
 *    `version`). 409 → adopt the server state; network failure → the action is
 *    queued (localStorage) and replayed when the connection returns.
 *  - Local mode (no database): sessions and imports live in localStorage.
 *  In both modes the latest state is mirrored to localStorage for crash recovery.
 */
import { create } from "zustand";
import { LEAGUE_PRESETS, normaliseSettings, type LeagueSettings } from "@/lib/league";
import { EMPTY_DRAFT, applyDraftAction, type DraftAction, type DraftState } from "@/lib/engine/draft";
import type { Dataset, Player } from "@/lib/types";
import type { ScheduleGame } from "@/lib/engine/schedule";
import type { ProjectionSet } from "@/lib/import/apply";
import { applyAdp, applyAvailabilityOverride, applyMetadata, applyProjectionSet } from "@/lib/import/apply";
import type { AdpRow, MetadataRow, ScheduleRow } from "@/lib/import/csv";
import type { FastResult, StrategiesResult } from "@/workers/protocol";
import type { CandidateTally, ChampionshipVerdict } from "@/lib/engine/championship";
import type { CategoryWeights } from "@/lib/categories";

export interface DatasetPayload {
  dataset: Dataset;
  schedule: ScheduleGame[];
  projectionSetId: string;
  adpSetId: string | null;
  dataVersion: number;
  source: "database" | "bundled";
}

export interface SessionRec {
  id: string;
  name: string;
  settings: LeagueSettings;
  state: DraftState;
  version: number;
  projectionSetId: string | null;
  updatedAt: string;
  local: boolean;
}

interface Pending {
  sessionId: string;
  action: DraftAction;
  expectedVersion: number;
  audit?: unknown;
}

export interface LocalImports {
  projections: ProjectionSet | null;
  adp: AdpRow[] | null;
  schedule: ScheduleRow[] | null;
  metadata: MetadataRow[] | null;
  overrides: { playerId: string; games: number; note: string }[];
  version: number;
}

export interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
}

export interface ChampState {
  key: string;
  candidates: string[];
  sims: number;
  done: number;
  tallies: CandidateTally[] | null;
  verdict: ChampionshipVerdict | null;
  running: boolean;
  error?: string;
}

interface Store {
  boot: "loading" | "ready" | "error";
  bootError?: string;
  mode: "server" | "local";
  health: Record<string, unknown> | null;
  auth: { authConfigured: boolean; authenticated: boolean; canWrite: boolean };
  base: DatasetPayload | null;
  frozen: Record<string, DatasetPayload>;
  localImports: LocalImports;
  sessions: SessionRec[];
  activeId: string | null;
  queue: Pending[];
  sync: { status: "synced" | "saving" | "offline" | "conflict" | "local" | "error"; message?: string };
  watchlist: string[];
  hypothetical: string[];
  puntWeights: CategoryWeights | null;
  toasts: Toast[];
  fast: { key: string; result: FastResult | null; loading: boolean; error?: string };
  strategies: { key: string; result: StrategiesResult | null; loading: boolean; error?: string };
  champ: ChampState | null;

  init: () => Promise<void>;
  reloadDataset: () => Promise<void>;
  createSession: (name: string, settings: LeagueSettings, state?: DraftState) => Promise<SessionRec | null>;
  selectSession: (id: string) => void;
  updateSettings: (settings: LeagueSettings, name?: string) => Promise<boolean>;
  deleteSession: (id: string) => Promise<void>;
  dispatch: (action: DraftAction, audit?: unknown) => Promise<boolean>;
  flushQueue: () => Promise<void>;
  toggleWatch: (id: string) => void;
  setHypothetical: (ids: string[]) => void;
  setPuntWeights: (w: CategoryWeights | null) => void;
  setLocalImports: (patch: Partial<LocalImports>) => void;
  toast: (kind: Toast["kind"], text: string) => void;
  dismissToast: (id: number) => void;
  setFast: (patch: Partial<Store["fast"]>) => void;
  setStrategies: (patch: Partial<Store["strategies"]>) => void;
  setChamp: (c: ChampState | null | ((prev: ChampState | null) => ChampState | null)) => void;
}

const LS = {
  sessions: "wr.v1.sessions",
  active: "wr.v1.active",
  queue: "wr.v1.queue",
  imports: "wr.v1.imports",
  watch: "wr.v1.watch",
};

function lsGet<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or unavailable: server persistence still applies */
  }
}

const EMPTY_IMPORTS: LocalImports = { projections: null, adp: null, schedule: null, metadata: null, overrides: [], version: 0 };

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = {} as T;
  }
  return { ok: res.ok, status: res.status, data };
}

function shape(s: LeagueSettings) {
  return { teams: s.teams, rounds: s.rounds, draftType: s.draftType };
}

let toastSeq = 1;

export const useStore = create<Store>((set, get) => ({
  boot: "loading",
  mode: "local",
  health: null,
  auth: { authConfigured: false, authenticated: false, canWrite: true },
  base: null,
  frozen: {},
  localImports: EMPTY_IMPORTS,
  sessions: [],
  activeId: null,
  queue: [],
  sync: { status: "local" },
  watchlist: [],
  hypothetical: [],
  puntWeights: null,
  toasts: [],
  fast: { key: "", result: null, loading: false },
  strategies: { key: "", result: null, loading: false },
  champ: null,

  async init() {
    try {
      const cached = lsGet<SessionRec[]>(LS.sessions, []);
      const queue = lsGet<Pending[]>(LS.queue, []);
      set({ watchlist: lsGet(LS.watch, []), localImports: { ...EMPTY_IMPORTS, ...lsGet(LS.imports, EMPTY_IMPORTS) }, queue });
      const [health, auth] = await Promise.all([api<Record<string, unknown>>("/api/health"), api<Store["auth"]>("/api/auth/status")]);
      const mode = health.data.database === "ok" ? "server" : "local";
      set({ health: health.data, auth: auth.data, mode, sync: { status: mode === "server" ? "synced" : "local" } });
      await get().reloadDataset();
      let sessions = cached;
      if (mode === "server") {
        const r = await api<{ sessions: Omit<SessionRec, "local">[] }>("/api/drafts");
        if (r.ok) {
          const server = r.data.sessions.map((s) => ({ ...s, local: false }));
          // Keep local cache entries that have queued (unsynced) actions; server wins otherwise.
          const queuedIds = new Set(queue.map((q) => q.sessionId));
          sessions = [
            ...server.map((s) => (queuedIds.has(s.id) ? (cached.find((c) => c.id === s.id) ?? s) : s)),
            ...cached.filter((c) => c.local),
          ];
        }
      } else sessions = cached.map((s) => ({ ...s, local: true }));
      const active = lsGet<string | null>(LS.active, null);
      set({ sessions, activeId: sessions.find((s) => s.id === active)?.id ?? sessions[0]?.id ?? null, boot: "ready" });
      if (!get().sessions.length) await get().createSession(LEAGUE_PRESETS[0].settings.name, LEAGUE_PRESETS[0].settings);
      lsSet(LS.sessions, get().sessions);
      if (get().queue.length) void get().flushQueue();
      window.addEventListener("online", () => void get().flushQueue());
      setInterval(() => {
        if (get().queue.length) void get().flushQueue();
      }, 15_000);
    } catch (e) {
      set({ boot: "error", bootError: e instanceof Error ? e.message : String(e) });
    }
  },

  async reloadDataset() {
    const r = await api<DatasetPayload>("/api/dataset");
    if (!r.ok) throw new Error((r.data as unknown as { error?: string }).error ?? "Failed to load dataset");
    set({ base: r.data });
    const s = get().sessions.find((x) => x.id === get().activeId);
    if (s?.projectionSetId && s.projectionSetId !== r.data.projectionSetId && get().mode === "server") await loadFrozen(s.projectionSetId);
  },

  async createSession(name, settings, state = EMPTY_DRAFT) {
    const st = normaliseSettings(settings);
    if (get().mode === "server") {
      const r = await api<{ session: Omit<SessionRec, "local">; error?: string }>("/api/drafts", { method: "POST", body: JSON.stringify({ name, settings: st, state }) });
      if (!r.ok) {
        get().toast("error", r.data.error ?? "Could not create draft (are you signed in?)");
        return null;
      }
      const rec = { ...r.data.session, local: false };
      set({ sessions: [rec, ...get().sessions], activeId: rec.id });
      persist(get);
      return rec;
    }
    const rec: SessionRec = { id: `local-${Date.now().toString(36)}`, name, settings: st, state, version: state.version, projectionSetId: get().base?.projectionSetId ?? null, updatedAt: new Date().toISOString(), local: true };
    set({ sessions: [rec, ...get().sessions], activeId: rec.id });
    persist(get);
    return rec;
  },

  selectSession(id) {
    set({ activeId: id, hypothetical: [] });
    lsSet(LS.active, id);
    const s = get().sessions.find((x) => x.id === id);
    if (s?.projectionSetId && get().base && s.projectionSetId !== get().base!.projectionSetId && get().mode === "server") void loadFrozen(s.projectionSetId);
  },

  async updateSettings(settings, name) {
    const s = active(get);
    if (!s) return false;
    const st = normaliseSettings(settings);
    if (!s.local && get().mode === "server") {
      const r = await api<{ session: Omit<SessionRec, "local">; error?: string; errors?: string[] }>(`/api/drafts/${s.id}`, { method: "PATCH", body: JSON.stringify({ settings: st, name, expectedVersion: s.version }) });
      if (!r.ok) {
        get().toast("error", r.data.error ?? "Could not save settings");
        return false;
      }
      replaceSession(set, get, { ...r.data.session, local: false });
    } else replaceSession(set, get, { ...s, settings: st, name: name ?? s.name, updatedAt: new Date().toISOString() });
    return true;
  },

  async deleteSession(id) {
    const s = get().sessions.find((x) => x.id === id);
    if (s && !s.local && get().mode === "server") await api(`/api/drafts/${id}`, { method: "DELETE" });
    const sessions = get().sessions.filter((x) => x.id !== id);
    set({ sessions, activeId: get().activeId === id ? (sessions[0]?.id ?? null) : get().activeId });
    persist(get);
  },

  async dispatch(action, audit) {
    const s = active(get);
    const ds = get().base;
    if (!s || !ds) return false;
    const known = new Set(ds.dataset.players.map((p) => p.id));
    const r = applyDraftAction(s.state, action, shape(s.settings), (id) => known.has(id));
    if (!r.ok) {
      get().toast("error", r.error);
      return false;
    }
    const optimistic: SessionRec = { ...s, state: r.state, version: r.state.version, updatedAt: new Date().toISOString() };
    replaceSession(set, get, optimistic);
    if (s.local || get().mode !== "server") return true;
    const pending: Pending = { sessionId: s.id, action, expectedVersion: s.version, audit };
    if (get().queue.some((q) => q.sessionId === s.id)) {
      set({ queue: [...get().queue, pending] });
      lsSet(LS.queue, get().queue);
      return true;
    }
    return sendAction(set, get, pending, s);
  },

  async flushQueue() {
    const q = get().queue;
    if (!q.length || get().mode !== "server") return;
    const [head] = q;
    const s = get().sessions.find((x) => x.id === head.sessionId);
    set({ queue: q.slice(1) });
    lsSet(LS.queue, get().queue);
    const ok = await sendAction(set, get, head, s ?? null, true);
    if (ok && get().queue.length) await get().flushQueue();
  },

  toggleWatch(id) {
    const w = get().watchlist.includes(id) ? get().watchlist.filter((x) => x !== id) : [...get().watchlist, id];
    set({ watchlist: w });
    lsSet(LS.watch, w);
  },
  setHypothetical(ids) {
    set({ hypothetical: ids });
  },
  setPuntWeights(w) {
    set({ puntWeights: w });
  },
  setLocalImports(patch) {
    const next = { ...get().localImports, ...patch, version: get().localImports.version + 1 };
    set({ localImports: next });
    lsSet(LS.imports, next);
  },
  toast(kind, text) {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, kind, text }].slice(-4) });
    setTimeout(() => get().dismissToast(id), kind === "error" ? 7000 : 3500);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  setFast(patch) {
    set({ fast: { ...get().fast, ...patch } });
  },
  setStrategies(patch) {
    set({ strategies: { ...get().strategies, ...patch } });
  },
  setChamp(c) {
    set({ champ: typeof c === "function" ? c(get().champ) : c });
  },
}));

function active(get: () => Store) {
  return get().sessions.find((s) => s.id === get().activeId) ?? null;
}

function persist(get: () => Store) {
  lsSet(LS.sessions, get().sessions);
  lsSet(LS.active, get().activeId);
}

function replaceSession(set: (p: Partial<Store>) => void, get: () => Store, rec: SessionRec) {
  set({ sessions: get().sessions.map((s) => (s.id === rec.id ? rec : s)) });
  persist(get);
}

async function sendAction(set: (p: Partial<Store>) => void, get: () => Store, p: Pending, prev: SessionRec | null, fromQueue = false): Promise<boolean> {
  set({ sync: { status: "saving" } });
  try {
    const r = await api<{ session?: Omit<SessionRec, "local">; current?: Omit<SessionRec, "local">; error?: string }>(`/api/drafts/${p.sessionId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: p.action, expectedVersion: p.expectedVersion, audit: p.audit }),
    });
    if (r.ok && r.data.session) {
      // Only adopt the server copy if no newer optimistic actions are queued for this session.
      if (!get().queue.some((q) => q.sessionId === p.sessionId)) replaceSession(set, get, { ...r.data.session, local: false });
      set({ sync: { status: "synced" } });
      return true;
    }
    if (r.status === 409) {
      const current = r.data.current ?? (await api<{ session: Omit<SessionRec, "local"> }>(`/api/drafts/${p.sessionId}`)).data.session;
      if (current) replaceSession(set, get, { ...current, local: false });
      set({ queue: get().queue.filter((q) => q.sessionId !== p.sessionId), sync: { status: "conflict", message: "Draft changed elsewhere — loaded the latest saved state." } });
      lsSet(LS.queue, get().queue);
      get().toast("error", "Draft was updated elsewhere; your view was refreshed.");
      return false;
    }
    if (r.status === 401 || r.status === 403) {
      if (prev) replaceSession(set, get, prev);
      set({ sync: { status: "error", message: r.data.error ?? "Not authorised" } });
      get().toast("error", r.data.error ?? "Sign in to save picks.");
      return false;
    }
    // Validation error from the server: roll back the optimistic update.
    if (prev && !fromQueue) replaceSession(set, get, prev);
    set({ sync: { status: "error", message: r.data.error } });
    get().toast("error", r.data.error ?? `Save failed (${r.status})`);
    return false;
  } catch {
    // Network failure: keep the optimistic state and queue the action for replay.
    set({ queue: [p, ...get().queue.filter((q) => q !== p)], sync: { status: "offline", message: "Offline — picks are saved locally and will sync." } });
    lsSet(LS.queue, get().queue);
    return true;
  }
}

async function loadFrozen(setId: string) {
  const st = useStore.getState();
  if (st.frozen[setId]) return;
  const r = await api<DatasetPayload>(`/api/dataset?set=${encodeURIComponent(setId)}`);
  if (r.ok) useStore.setState({ frozen: { ...useStore.getState().frozen, [setId]: r.data } });
}

// ---------------------------------------------------------------------------
// Effective dataset (memoised so analysis caches keyed on array identity hold).
// ---------------------------------------------------------------------------
export interface EffectiveDataset {
  key: string;
  players: Player[];
  schedule: ScheduleGame[];
  meta: Dataset["meta"];
  projectionSetId: string;
  frozen: boolean;
  source: DatasetPayload["source"];
}

let memo: { inputs: unknown[]; out: EffectiveDataset } | null = null;

export function effectiveDataset(st: Pick<Store, "base" | "frozen" | "localImports" | "mode" | "sessions" | "activeId">): EffectiveDataset | null {
  if (!st.base) return null;
  const s = st.sessions.find((x) => x.id === st.activeId);
  const wantSet = s?.projectionSetId;
  const payload = wantSet && st.frozen[wantSet] ? st.frozen[wantSet] : st.base;
  const inputs = [payload, st.mode === "local" ? st.localImports : null];
  if (memo && memo.inputs.every((x, i) => x === inputs[i])) return memo.out;
  let players = payload.dataset.players;
  let schedule = payload.schedule;
  let setId = payload.projectionSetId;
  const li = st.mode === "local" ? st.localImports : null;
  if (li) {
    if (li.projections) {
      players = applyProjectionSet(players, li.projections);
      setId = li.projections.id;
    }
    if (li.adp) players = applyAdp(players, li.adp);
    if (li.metadata) players = applyMetadata(players, li.metadata);
    for (const o of li.overrides) players = applyAvailabilityOverride(players, o.playerId, o.games, o.note);
    if (li.schedule) schedule = li.schedule;
  }
  const out: EffectiveDataset = {
    key: `${payload.source}:${payload.dataVersion}:${setId}:${payload.adpSetId ?? ""}:${li?.version ?? 0}`,
    players,
    schedule,
    meta: payload.dataset.meta,
    projectionSetId: setId,
    frozen: payload !== st.base,
    source: payload.source,
  };
  memo = { inputs, out };
  return out;
}

export function useDataset() {
  return useStore((st) => effectiveDataset(st));
}

export function useActiveSession() {
  return useStore((st) => st.sessions.find((s) => s.id === st.activeId) ?? null);
}
