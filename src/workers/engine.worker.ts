/// <reference lib="webworker" />
/**
 * Analytics worker: every heavy computation runs here so the draft board never
 * blocks. Players are sent once per dataset ("init"); requests carry only the
 * league settings and draft state.
 */
import { buildContext } from "@/lib/engine/context";
import { buildScheduleModel, type ScheduleModel } from "@/lib/engine/schedule";
import { simulateAvailability } from "@/lib/engine/availability";
import { recommend } from "@/lib/engine/recommend";
import { draftAlerts } from "@/lib/engine/alerts";
import { rivalMatrix, teamProfiles } from "@/lib/engine/opponents";
import { positionScarcity } from "@/lib/engine/scarcity";
import { portfolioRisk } from "@/lib/engine/risk";
import { evaluateStrategies, strategyAdvice, strategyCatalog } from "@/lib/engine/strategy";
import { simulateChampionship } from "@/lib/engine/championship";
import type { Player } from "@/lib/types";
import type { WorkerRequest, WorkerResponse } from "./protocol";

let players: Player[] = [];
let schedule: ScheduleModel = buildScheduleModel(null);
let key = "";

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      players = m.players;
      schedule = buildScheduleModel(m.schedule);
      key = m.datasetKey;
      post({ type: "ready", datasetKey: key });
      return;
    }
    if (m.datasetKey !== key) throw new Error("Worker dataset mismatch");
    const ctx = buildContext({ players, settings: m.state.settings, draft: m.state.draft, schedule });
    if (m.type === "fast") {
      const t0 = performance.now();
      const avail = simulateAvailability(ctx, { sims: m.sims });
      const rec = recommend(ctx, avail);
      const mine = ctx.rosters[ctx.myIndex];
      post({
        type: "fast",
        id: m.id,
        result: {
          avail,
          rec,
          alerts: draftAlerts(ctx, rec),
          profiles: teamProfiles(ctx),
          rival: rivalMatrix(ctx, rec.field),
          positions: positionScarcity(ctx),
          portfolio: mine.length ? portfolioRisk(ctx, mine, 600) : null,
          ms: performance.now() - t0,
        },
      });
    } else if (m.type === "strategies") {
      const t0 = performance.now();
      let catalog = strategyCatalog(ctx.cats);
      if (m.onlyCustom) catalog = catalog.filter((c) => c.kind === "balanced");
      if (m.custom) catalog.push({ key: "custom", label: m.custom.label, kind: "custom", weights: m.custom.weights });
      const results = evaluateStrategies(ctx, { runs: m.runs, strategies: catalog });
      const round = Math.floor((ctx.overall - 1) / ctx.settings.teams) + 1;
      post({ type: "strategies", id: m.id, result: { results, advice: strategyAdvice(results, round), ms: performance.now() - t0 } });
    } else if (m.type === "championship") {
      const result = simulateChampionship(ctx, { candidates: m.candidates, sims: m.sims, seed: m.seed, from: m.from, to: m.to, collect: m.collect, myWeights: m.myWeights });
      post({ type: "championship", id: m.id, result });
    }
  } catch (err) {
    post({ type: "error", id: "id" in m ? m.id : -1, error: err instanceof Error ? err.message : String(err) });
  }
};
