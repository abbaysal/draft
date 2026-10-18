"use client";
/**
 * Web Worker pool. One "fast" worker serves live recommendations; a pool of deep
 * workers runs Monte Carlo jobs in parallel chunks. Stale deep jobs are cancelled
 * by terminating their workers, so a new pick never waits on an old simulation.
 */
import type { Player } from "@/lib/types";
import type { ScheduleGame } from "@/lib/engine/schedule";
import type { WorkerRequest, WorkerResponse } from "@/workers/protocol";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

class EngineWorker {
  private w: Worker;
  private pending = new Map<number, Pending>();
  datasetKey = "";
  busy = 0;

  constructor() {
    this.w = new Worker(new URL("../workers/engine.worker.ts", import.meta.url));
    this.w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === "ready") return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      this.busy--;
      if (m.type === "error") p.reject(new Error(m.error));
      else p.resolve(m.result);
    };
    this.w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || "Worker crashed"));
      this.pending.clear();
      this.busy = 0;
    };
  }

  ensure(datasetKey: string, players: Player[], schedule: ScheduleGame[]) {
    if (this.datasetKey === datasetKey) return;
    this.datasetKey = datasetKey;
    this.w.postMessage({ type: "init", datasetKey, players, schedule } satisfies WorkerRequest);
  }

  run<T>(req: WorkerRequest & { id: number }): Promise<T> {
    this.busy++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req.id, { resolve: resolve as (v: unknown) => void, reject });
      this.w.postMessage(req);
    });
  }

  terminate() {
    this.w.terminate();
    for (const p of this.pending.values()) p.reject(new Error("cancelled"));
    this.pending.clear();
  }
}

let seq = 1;
export const nextId = () => seq++;

let fast: EngineWorker | null = null;
let strat: EngineWorker | null = null;
let deep: EngineWorker[] = [];

export interface DatasetRef {
  key: string;
  players: Player[];
  schedule: ScheduleGame[];
}

export function fastWorker(ds: DatasetRef) {
  fast ??= new EngineWorker();
  fast.ensure(ds.key, ds.players, ds.schedule);
  return fast;
}

export function strategyWorker(ds: DatasetRef) {
  strat ??= new EngineWorker();
  strat.ensure(ds.key, ds.players, ds.schedule);
  return strat;
}

export function cancelStrategies() {
  strat?.terminate();
  strat = null;
}

export function deepPool(ds: DatasetRef): EngineWorker[] {
  const n = Math.max(1, Math.min(4, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 2) - 1));
  while (deep.length < n) deep.push(new EngineWorker());
  for (const w of deep) w.ensure(ds.key, ds.players, ds.schedule);
  return deep;
}

export function cancelDeep() {
  for (const w of deep) w.terminate();
  deep = [];
}
