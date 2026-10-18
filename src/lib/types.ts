import type { LivePlayerStats } from "./live/parse";
/**
 * Core domain types shared by the dataset pipeline, the analytics engine,
 * the API layer and the UI. Everything here is plain serialisable data.
 */

export type CategoryKey =
  | "pts"
  | "fg3m"
  | "reb"
  | "ast"
  | "stl"
  | "blk"
  | "fgPct"
  | "ftPct"
  | "tov";

export type CountingKey = "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "tov";

/** Fantasy lineup slot positions. */
export type SlotPos = "PG" | "SG" | "SF" | "PF" | "C";
export type LineupSlot = SlotPos | "G" | "F" | "UTIL" | "BN" | "IL";

/** Per-game box-score line used everywhere (projections and history). */
export interface StatLine {
  min: number;
  pts: number;
  fg3m: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
}

export type DataKind = "actual" | "projection" | "estimate";

export interface HistSeason extends StatLine {
  season: string; // "2025-26"
  gp: number;
  source: string; // source id from DATA_SOURCES
  /** True when FGA/FTA were not in the source and were derived (see METHODOLOGY.md). */
  attemptsEstimated: boolean;
  team?: string;
}

export type ConfidenceLevel = "high" | "medium" | "low";

export interface Projection extends StatLine {
  gp: number;
  /** Season-level uncertainty (SD of the player's true per-game mean) per stat. */
  sd: Partial<Record<keyof StatLine, number>>;
  gpSd: number;
  /** 0..1 aggregate confidence score. */
  confidence: number;
  source: string; // e.g. "warroom-model-v1" or an imported source key
  version: string;
  kind: DataKind; // "projection" (external) | "estimate" (model generated)
  flags: string[];
}

export type AvailabilityStatus =
  | "HEALTHY"
  | "DAY_TO_DAY"
  | "OUT_START"
  | "OUT_EXTENDED"
  | "OUT_SEASON"
  | "RETURNING"
  | "UNKNOWN";

export interface Availability {
  status: AvailabilityStatus;
  injury?: string;
  estGamesMissed: number;
  estimateBasis?: string;
  confidence: ConfidenceLevel;
  reportedDate?: string;
  sourceName?: string;
  sourceUrl?: string;
  notes?: string;
}

export interface TeamChange {
  from: string;
  to: string;
  type: string;
  date?: string;
  confidence: ConfidenceLevel;
  sourceName: string;
  sourceUrl: string;
}

export type TagKind =
  | "elite_anchor"
  | "balanced"
  | "specialist"
  | "breakout"
  | "regression"
  | "bounce_back"
  | "high_risk"
  | "stable"
  | "new_team"
  | "returning_injury"
  | "rookie_no_projection";

export interface PlayerTag {
  kind: TagKind;
  label: string;
  confidence: ConfidenceLevel;
  evidence: string[];
}

export interface Player {
  id: string; // stable internal id: "nba-<nbaId>" or "rookie-2026-<pick>"
  nbaId?: number;
  espnId?: number;
  name: string;
  team: string;
  nbaPos: string; // NBA listed position (G, F, C, G-F, ...)
  elig: SlotPos[];
  eligSource: "derived" | "imported" | "manual";
  age?: number; // age at 2026-10-20
  birthdate?: string;
  experience?: number;
  heightM?: number;
  weightKg?: number;
  rookie?: { pick: number; college: string; sourceUrl: string };
  teamChange?: TeamChange;
  availability?: Availability;
  proj: Projection | null;
  hist: HistSeason[];
  tags: PlayerTag[];
  /** Imported ADP, if any (null = not imported). */
  adp?: number | null;
  adpSource?: string | null;
  /** 2026-27 season-to-date actuals from the live feed (NBA.com box scores), when loaded. */
  live?: LivePlayerStats;
}

export interface DatasetMeta {
  builtAt: string;
  projectionVersion: string;
  projectionSource: string;
  sources: { id: string; name: string; url: string; season: string; retrieved: string; sha256?: string }[];
  playerCount: number;
  projectedCount: number;
  notes: string[];
}

export interface Dataset {
  meta: DatasetMeta;
  players: Player[];
}
