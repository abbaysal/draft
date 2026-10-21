/**
 * AI lineup coach: shared schema and prompt. The deterministic engine computes the optimal
 * daily lineup and every number; the model reviews that plan against the context the engine
 * cannot weigh well (injury notes, back-to-back rest risk, late games, category strategy) and
 * returns structured advice. Its start/sit suggestions are re-scored by the engine in the UI.
 */
import * as z from "zod/v4";

export const CoachAdviceSchema = z.object({
  headline: z.string().describe("One sentence: the state of the matchup and the main lever this week."),
  today: z.object({
    date: z.string(),
    start: z.array(z.object({ player: z.string(), slot: z.string(), note: z.string() })),
    bench: z.array(z.object({ player: z.string(), reason: z.string() })),
  }),
  changes: z
    .array(z.object({ date: z.string(), player: z.string(), action: z.enum(["start", "sit"]), reason: z.string() }))
    .describe("Only deviations from the engine plan you recommend; empty if the plan is right."),
  categoryPlan: z.array(z.object({ cat: z.string(), stance: z.enum(["push", "protect", "concede", "locked"]), reason: z.string() })),
  streaming: z.array(z.object({ add: z.string(), drop: z.string(), reason: z.string() })),
  risks: z.array(z.string()),
  summary: z.string(),
});
export type CoachAdvice = z.infer<typeof CoachAdviceSchema>;

export const COACH_SYSTEM_PROMPT = `You are the lineup coach for a Yahoo head-to-head 9-category fantasy basketball team (daily lineups; each player's slot locks at his game's tip-off).
You receive a fact sheet computed by an analytics engine: the matchup state (actual totals so far when available, projected finals, per-category win probabilities), the remaining NBA schedule for both rosters with tip-off times (US Eastern), the engine's day-by-day lineup (which already maximises expected categories won with positional matching), each player's per-game matchup impact, injury flags and schedule-aware streaming candidates.

How to work:
- Treat the engine's numbers as the source of truth. Never invent stats, injuries, games or news. If something is unknown, say so.
- Confirm today's lineup first, then the rest of the week.
- Recommend a change to the engine plan only when the fact sheet shows a reason the engine underweights: an injury or "O"/GTD flag, a back-to-back rest risk for an older or recently injured player, a game that tips after a teammate's lock, or a category strategy (protecting a FG%/FT%/TO lead, conceding a lost category to chase swing categories). Each change must name the date, the player and the reason.
- Category stance: "locked" (≥90% either way), "protect" (ahead, low volume helps), "push" (swing category where volume or a specific skill matters), "concede" (out of reach; stop sacrificing for it).
- Streaming: only from the candidates provided; prefer players whose games fall on days with open slots; always name the drop.
- Be concise and concrete. Use player names exactly as given.`;
