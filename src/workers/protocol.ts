import type { LeagueSettings } from "@/lib/league";
import type { DraftState } from "@/lib/engine/draft";
import type { Player } from "@/lib/types";
import type { ScheduleGame } from "@/lib/engine/schedule";
import type { AvailabilityResult } from "@/lib/engine/availability";
import type { RecommendationSet } from "@/lib/engine/recommend";
import type { DraftAlert } from "@/lib/engine/alerts";
import type { TeamProfile, RivalRow } from "@/lib/engine/opponents";
import type { PositionScarcity } from "@/lib/engine/scarcity";
import type { PortfolioRisk } from "@/lib/engine/risk";
import type { StrategyAdvice, StrategyResult } from "@/lib/engine/strategy";
import type { ChampionshipChunk } from "@/lib/engine/championship";
import type { CategoryWeights } from "@/lib/categories";

export interface EngineState {
  settings: LeagueSettings;
  draft: DraftState;
}

export type WorkerRequest =
  | { type: "init"; datasetKey: string; players: Player[]; schedule: ScheduleGame[] }
  | { type: "fast"; id: number; datasetKey: string; state: EngineState; sims: number }
  | { type: "strategies"; id: number; datasetKey: string; state: EngineState; runs: number; custom?: { label: string; weights: CategoryWeights } | null; onlyCustom?: boolean }
  | { type: "championship"; id: number; datasetKey: string; state: EngineState; candidates: string[]; sims: number; seed: number; from: number; to: number; collect?: boolean; myWeights?: Record<string, number> | null };

export interface FastResult {
  avail: AvailabilityResult;
  rec: RecommendationSet;
  alerts: DraftAlert[];
  profiles: TeamProfile[];
  rival: RivalRow[];
  positions: PositionScarcity[];
  portfolio: PortfolioRisk | null;
  ms: number;
}

export interface StrategiesResult {
  results: StrategyResult[];
  advice: StrategyAdvice | null;
  ms: number;
}

export type WorkerResponse =
  | { type: "ready"; datasetKey: string }
  | { type: "fast"; id: number; result: FastResult }
  | { type: "strategies"; id: number; result: StrategiesResult }
  | { type: "championship"; id: number; result: ChampionshipChunk }
  | { type: "error"; id: number; error: string };
