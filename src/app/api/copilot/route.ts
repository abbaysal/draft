import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { COPILOT_SYSTEM_PROMPT } from "@/lib/copilot";
import { errorResponse, json } from "@/server/http";
import { clientKey, rateLimit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  question: z.string().min(1).max(1000),
  facts: z.record(z.string(), z.unknown()),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(10).optional(),
});

/**
 * Grounded copilot. The client sends the engine-computed fact sheet; the model only
 * explains it. Without ANTHROPIC_API_KEY the endpoint returns 501 and the client
 * uses the deterministic explainer instead.
 */
export async function POST(req: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) return json({ error: "AI not configured", fallback: true }, 501);
    if (!rateLimit(`copilot:${clientKey(req)}`, 20, 0.2)) return json({ error: "Rate limited — try again shortly" }, 429);
    const text = await req.text();
    if (text.length > 120_000) return json({ error: "Context too large" }, 413);
    const body = Body.parse(JSON.parse(text));
    const client = new Anthropic();
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...(body.history ?? []).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: `Fact sheet (JSON, computed by the analytics engine):\n${JSON.stringify(body.facts)}\n\nQuestion: ${body.question}` },
    ];
    const response = await client.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 4000,
      system: COPILOT_SYSTEM_PROMPT,
      // Live drafts need fast answers: low effort keeps latency down; adaptive thinking is on by default.
      output_config: { effort: (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high") || "low" },
      // Server-side refusal fallback (re-runs a declined request on a fallback model).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (response.stop_reason === "refusal") return json({ answer: "The AI declined to answer this question. Use the deterministic explanation instead.", model: response.model, refused: true });
    const answer = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n");
    return json({ answer, model: response.model });
  } catch (e) {
    if (e instanceof Anthropic.APIError) return json({ error: `AI provider error (${e.status ?? "network"})`, fallback: true }, 502);
    return errorResponse(e);
  }
}
