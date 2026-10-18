"use client";
/**
 * Analysis orchestration: the fast recommendation job runs after every state
 * change (≈0.2 s in a worker); deep jobs (strategy lab, championship Monte Carlo)
 * run in the background, chunked across a worker pool, and are cancelled the
 * moment the draft moves on. The UI always shows the latest verified values.
 */
import { useEffect, useMemo, useRef } from "react";
import { buildContext, type AnalysisContext } from "@/lib/engine/context";
import { buildScheduleModel } from "@/lib/engine/schedule";
import { POLICY, mergeChunks, summarise, type ChampionshipChunk } from "@/lib/engine/championship";
import type { FastResult, StrategiesResult } from "@/workers/protocol";
import { cancelDeep, cancelStrategies, deepPool, fastWorker, nextId, strategyWorker, type DatasetRef } from "./engine";
import { useActiveSession, useDataset, useStore } from "./store";
import { hashSeed } from "@/lib/engine/math";

export function stateKey(dsKey: string, sessionId: string, version: number, settings: unknown) {
  return `${dsKey}|${sessionId}|${version}|${hashSeed(JSON.stringify(settings))}`;
}

const scheduleCache = new WeakMap<object, ReturnType<typeof buildScheduleModel>>();

/** Main-thread analysis context (cheap: baselines are cached per dataset). */
export function useEngineContext(): AnalysisContext | null {
  const ds = useDataset();
  const session = useActiveSession();
  return useMemo(() => {
    if (!ds || !session) return null;
    let sched = scheduleCache.get(ds.schedule);
    if (!sched) {
      sched = buildScheduleModel(ds.schedule);
      scheduleCache.set(ds.schedule, sched);
    }
    return buildContext({ players: ds.players, settings: session.settings, draft: session.state, schedule: sched });
  }, [ds, session]);
}

export function useCurrentKey() {
  const ds = useDataset();
  const session = useActiveSession();
  return ds && session ? stateKey(ds.key, session.id, session.version, session.settings) : "";
}

export function useFast(): { result: FastResult | null; loading: boolean; stale: boolean; error?: string } {
  const fast = useStore((s) => s.fast);
  const key = useCurrentKey();
  return { result: fast.result, loading: fast.loading, stale: fast.key !== key, error: fast.error };
}

export function useStrategies(): { result: StrategiesResult | null; loading: boolean; stale: boolean } {
  const st = useStore((s) => s.strategies);
  const key = useCurrentKey();
  return { result: st.result, loading: st.loading, stale: st.key !== key };
}

/** Run a chunked championship simulation across the worker pool. */
export async function runChampionship(opts: {
  ds: DatasetRef;
  state: { settings: unknown; draft: unknown };
  key: string;
  candidates: string[];
  sims: number;
  chunk?: number;
  collect?: boolean;
  myWeights?: Record<string, number> | null;
  onProgress: (chunks: ChampionshipChunk[], done: number) => void;
  isCurrent: () => boolean;
}) {
  const pool = deepPool(opts.ds);
  const chunk = opts.chunk ?? 40;
  const ranges: [number, number][] = [];
  for (let f = 0; f < opts.sims; f += chunk) ranges.push([f, Math.min(opts.sims, f + chunk)]);
  const chunks: ChampionshipChunk[] = [];
  let next = 0;
  const seed = hashSeed("champ", opts.key);
  const workerLoop = async (w: (typeof pool)[number]) => {
    while (next < ranges.length && opts.isCurrent()) {
      const [from, to] = ranges[next++];
      const res = await w.run<ChampionshipChunk>({
        type: "championship",
        id: nextId(),
        datasetKey: opts.ds.key,
        state: opts.state as never,
        candidates: opts.candidates,
        sims: opts.sims,
        seed,
        from,
        to,
        collect: opts.collect,
        myWeights: opts.myWeights ?? null,
      });
      if (!opts.isCurrent()) return;
      chunks.push(res);
      opts.onProgress(chunks, chunks.reduce((a, c) => a + (c.to - c.from), 0));
    }
  };
  await Promise.all(pool.map(workerLoop));
  return chunks;
}

/** Mounted once in the app shell: keeps fast analysis, strategy lab and championship sims current. */
export function AnalysisRunner() {
  const ds = useDataset();
  const session = useActiveSession();
  const key = useCurrentKey();
  const keyRef = useRef(key);
  keyRef.current = key;

  // Fast job.
  useEffect(() => {
    if (!ds || !session || !key) return;
    const st = useStore.getState();
    if (st.fast.key === key && st.fast.result) return;
    st.setFast({ loading: true });
    const handle = setTimeout(() => {
      const id = nextId();
      fastWorker(ds)
        .run<FastResult>({ type: "fast", id, datasetKey: ds.key, state: { settings: session.settings, draft: session.state }, sims: 300 })
        .then((result) => {
          if (keyRef.current === key) useStore.getState().setFast({ key, result, loading: false, error: undefined });
        })
        .catch((e: Error) => {
          if (keyRef.current === key) useStore.getState().setFast({ loading: false, error: e.message });
        });
    }, 25);
    return () => clearTimeout(handle);
  }, [ds, session, key]);

  // Strategy lab (background, cancellable).
  useEffect(() => {
    if (!ds || !session || !key) return;
    const st = useStore.getState();
    if (st.strategies.key === key && st.strategies.result) return;
    cancelStrategies();
    st.setStrategies({ loading: true });
    const handle = setTimeout(() => {
      const w = useStore.getState().puntWeights;
      strategyWorker(ds)
        .run<StrategiesResult>({ type: "strategies", id: nextId(), datasetKey: ds.key, state: { settings: session.settings, draft: session.state }, runs: 10, custom: w ? { label: "Custom weights", weights: w } : null })
        .then((result) => {
          if (keyRef.current === key) useStore.getState().setStrategies({ key, result, loading: false });
        })
        .catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [ds, session, key]);

  // Championship Monte Carlo for the fast leaders (background, cancellable).
  const fastKey = useStore((s) => s.fast.key);
  const fastResult = useStore((s) => s.fast.result);
  useEffect(() => {
    if (!ds || !session || !fastResult || fastKey !== key) return;
    if (session.state.picks.length >= session.settings.teams * session.settings.rounds) return;
    const cands = fastResult.rec.candidates.slice(0, 5).map((c) => c.id);
    if (!cands.length) return;
    const st = useStore.getState();
    if (st.champ?.key === key) return;
    cancelDeep();
    const sims = 300;
    const candidates = [POLICY, ...cands];
    st.setChamp({ key, candidates, sims, done: 0, tallies: null, verdict: null, running: true });
    const isCurrent = () => keyRef.current === key && useStore.getState().champ?.key === key;
    runChampionship({
      ds,
      state: { settings: session.settings, draft: session.state },
      key,
      candidates,
      sims,
      isCurrent,
      onProgress: (chunks, done) => {
        const tallies = mergeChunks(chunks);
        useStore.getState().setChamp((prev) => (prev && prev.key === key ? { ...prev, done, tallies, verdict: summarise(tallies, 200) } : prev));
      },
    })
      .then(() => {
        if (!isCurrent()) return;
        useStore.getState().setChamp((prev) => (prev && prev.key === key ? { ...prev, running: false } : prev));
        const c = useStore.getState().champ;
        if (c?.verdict && useStore.getState().mode === "server" && !session.local)
          void fetch(`/api/drafts/${session.id}/simulations`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stateVersion: session.version, kind: "championship", params: { sims, candidates }, result: { verdict: c.verdict } }),
          }).catch(() => {});
      })
      .catch((e: Error) => {
        if (e.message !== "cancelled") useStore.getState().setChamp((prev) => (prev && prev.key === key ? { ...prev, running: false, error: e.message } : prev));
      });
  }, [ds, session, key, fastKey, fastResult]);

  return null;
}
