import { z } from "zod";

export const DraftActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pick"), playerId: z.string().min(1).max(64), at: z.string().datetime().optional() }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
  z.object({ type: z.literal("edit"), overall: z.number().int().min(1).max(600), playerId: z.string().min(1).max(64) }),
  z.object({ type: z.literal("setOwner"), overall: z.number().int().min(1).max(600), teamIndex: z.number().int().min(0).max(19) }),
  z.object({ type: z.literal("reset") }),
]);

const PickSchema = z.object({
  overall: z.number().int().min(1),
  round: z.number().int().min(1),
  teamIndex: z.number().int().min(0),
  playerId: z.string().min(1).max(64),
  at: z.string(),
});

export const DraftStateSchema = z.object({
  picks: z.array(PickSchema).max(600),
  redo: z.array(PickSchema).max(600),
  ownerOverrides: z.record(z.string(), z.number().int().min(0)),
  version: z.number().int().min(0),
});

export const AuditPayloadSchema = z
  .object({
    recommendation: z.unknown().optional(),
    categoryImpact: z.unknown().optional(),
    simulation: z.unknown().optional(),
  })
  .optional();

export const ActionRequestSchema = z.object({
  action: DraftActionSchema,
  expectedVersion: z.number().int().min(0),
  audit: AuditPayloadSchema,
});

