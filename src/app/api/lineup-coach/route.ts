import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { COACH_SYSTEM_PROMPT, CoachAdviceSchema } from "@/lib/coach";
import { errorResponse, json } from "@/server/http";
import { clientKey, rateLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({
  facts: z.record(z.string(), z.unknown()),
  language: z.enum(["en", "tr"]).default("en"),
  question: z.string().max(1000).optional(),
});

/** AI review of the engine's daily lineup plan (structured output). 501 without ANTHROPIC_API_KEY. */
export async function POST(req: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return json({ error: "AI not configured (set ANTHROPIC_API_KEY)", fallback: true }, 501);
    if (!rateLimit(`coach:${clientKey(req)}`, 10, 0.1)) return json({ error: "Rate limited — try again in a minute" }, 429);
    const text = await req.text();
    if (text.length > 200_000) return json({ error: "Context too large" }, 413);
    const body = Body.parse(JSON.parse(text));
    const client = new Anthropic();
    const lang = body.language === "tr" ? "Write every text field in Turkish (player and team names unchanged)." : "Write in English.";
    const response = await client.beta.messages.parse({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      system: COACH_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Fact sheet (JSON):\n${JSON.stringify(body.facts)}\n\n${body.question ? `Manager's question: ${body.question}\n\n` : ""}Review the plan and return your advice. ${lang}`,
        },
      ],
      output_config: { effort: (process.env.ANTHROPIC_COACH_EFFORT as "low" | "medium" | "high") || "medium", format: betaZodOutputFormat(CoachAdviceSchema) },
      // Server-side refusal fallback: a declined request is re-run on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as unknown as Parameters<typeof client.beta.messages.parse>[0]);
    if (response.stop_reason === "refusal") return json({ error: "The AI declined this request; the engine plan above still applies.", refused: true }, 200);
    if (response.stop_reason === "max_tokens" || !response.parsed_output) return json({ error: "The AI response was incomplete; try again." }, 502);
    return json({ advice: response.parsed_output, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "AI provider is rate limiting — try again shortly" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI provider error (${e.status ?? "network"})`, fallback: true }, 502);
    return errorResponse(e);
  }
}
