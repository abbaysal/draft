import { z } from "zod";
import { CAT_KEYS } from "./categories";
import type { CategoryKey, LineupSlot } from "./types";

export const SCORING_FORMATS = ["h2h_each", "h2h_most", "roto"] as const;
export type ScoringFormat = (typeof SCORING_FORMATS)[number];

export const FORMAT_LABEL: Record<ScoringFormat, string> = {
  h2h_each: "Head-to-head each category",
  h2h_most: "Head-to-head most categories",
  roto: "Rotisserie",
};

export const SlotCountsSchema = z.object({
  PG: z.number().int().min(0).max(5),
  SG: z.number().int().min(0).max(5),
  G: z.number().int().min(0).max(5),
  SF: z.number().int().min(0).max(5),
  PF: z.number().int().min(0).max(5),
  F: z.number().int().min(0).max(5),
  C: z.number().int().min(0).max(5),
  UTIL: z.number().int().min(0).max(10),
  BN: z.number().int().min(0).max(15),
  IL: z.number().int().min(0).max(10),
});
export type SlotCounts = z.infer<typeof SlotCountsSchema>;

const CategoryKeySchema = z.enum(CAT_KEYS as [CategoryKey, ...CategoryKey[]]);

export const LeagueSettingsSchema = z
  .object({
    name: z.string().min(1).max(80),
    teams: z.number().int().min(2).max(20),
    myPosition: z.number().int().min(1).max(20),
    draftType: z.enum(["snake", "linear"]),
    rounds: z.number().int().min(1).max(30),
    slots: SlotCountsSchema,
    format: z.enum(SCORING_FORMATS),
    categories: z.array(CategoryKeySchema).min(1),
    lineupMode: z.enum(["daily", "weekly"]),
    /** Fraction of bench players' games that reach an active lineup slot. */
    benchUtilization: z.number().min(0).max(1),
    /** Optional weekly cap on games started across the roster (null = no cap). */
    weeklyGamesCap: z.number().int().min(1).max(100).nullable(),
    regularSeasonWeeks: z.number().int().min(1).max(26),
    playoffTeams: z.number().int().min(0).max(16),
    /** Fantasy week numbers (1-based) used for the playoffs. */
    playoffWeeks: z.array(z.number().int().min(1).max(30)).max(6),
    valuationBasis: z.enum(["perGame", "season"]),
    valuationMethod: z.enum(["z", "g"]),
    teamNames: z.array(z.string().max(40)),
    /** Market model: ADP SD = base + slope × ADP (picks). */
    adpSigmaBase: z.number().min(0).max(30),
    adpSigmaSlope: z.number().min(0).max(1),
    riskAversion: z.number().min(0).max(1),
  })
  .refine((s) => s.myPosition <= s.teams, { message: "Draft position must be ≤ number of teams", path: ["myPosition"] })
  .refine((s) => s.teamNames.length === s.teams, { message: "Need one name per team", path: ["teamNames"] });

export type LeagueSettings = z.infer<typeof LeagueSettingsSchema>;

export function defaultTeamNames(n: number, myPosition: number): string[] {
  return Array.from({ length: n }, (_, i) => (i + 1 === myPosition ? "My Team" : `Team ${i + 1}`));
}

export const DEFAULT_SETTINGS: LeagueSettings = {
  name: "My 9-Cat League",
  teams: 12,
  myPosition: 6,
  draftType: "snake",
  rounds: 13,
  slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2, BN: 3, IL: 3 },
  format: "h2h_each",
  categories: CAT_KEYS,
  lineupMode: "daily",
  benchUtilization: 0.6,
  weeklyGamesCap: null,
  regularSeasonWeeks: 22,
  playoffTeams: 6,
  playoffWeeks: [23, 24, 25],
  valuationBasis: "perGame",
  valuationMethod: "z",
  teamNames: defaultTeamNames(12, 6),
  adpSigmaBase: 2,
  adpSigmaSlope: 0.16,
  riskAversion: 0.25,
};

export function startingSlots(s: Pick<LeagueSettings, "slots">): LineupSlot[] {
  const order: (keyof SlotCounts)[] = ["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL"];
  const out: LineupSlot[] = [];
  for (const k of order) for (let i = 0; i < s.slots[k]; i++) out.push(k as LineupSlot);
  return out;
}

export function rosterSize(s: Pick<LeagueSettings, "slots">): number {
  return startingSlots(s).length + s.slots.BN;
}

/** Teams × drafted roster size: the size of the "draftable" valuation pool. */
export function draftablePool(s: LeagueSettings): number {
  return s.teams * Math.min(s.rounds, rosterSize(s) + s.slots.IL);
}

/** Normalise settings after edits (resize team names, clamp position). */
export function normaliseSettings(s: LeagueSettings): LeagueSettings {
  const teams = s.teams;
  const myPosition = Math.min(s.myPosition, teams);
  let names = s.teamNames.slice(0, teams);
  while (names.length < teams) names.push(`Team ${names.length + 1}`);
  names = names.map((n, i) => (n.trim() ? n : i + 1 === myPosition ? "My Team" : `Team ${i + 1}`));
  return { ...s, teams, myPosition, teamNames: names };
}
