import { afterEach, describe, expect, it, vi } from "vitest";

const calls: Record<string, unknown>[] = [];
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    beta = {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return {
            stop_reason: "end_turn",
            model: "claude-opus-5-5",
            parsed_output: { headline: "h", moves: [], watch: [], keep: [], summary: "s" },
          };
        },
      },
    };
  }
  return { default: Anthropic };
});

describe("/api/waiver-coach", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    calls.length = 0;
  });

  it("returns 501 without an API key", async () => {
    const { POST } = await import("@/app/api/waiver-coach/route");
    const r = await POST(new Request("http://x/api/waiver-coach", { method: "POST", body: JSON.stringify({ facts: {} }) }));
    expect(r.status).toBe(501);
  });

  it("calls Claude with structured output, effort and server-side fallback, and returns the parsed advice", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    const { POST } = await import("@/app/api/waiver-coach/route");
    const r = await POST(new Request("http://x/api/waiver-coach", { method: "POST", headers: { "x-forwarded-for": "1.2.3.4" }, body: JSON.stringify({ facts: { a: 1 }, language: "tr" }) }));
    const d = await r.json();
    expect(r.status).toBe(200);
    expect(d.advice.headline).toBe("h");
    const p = calls[0] as { model: string; betas: string[]; fallbacks: string; output_config: { effort: string; format: unknown }; messages: { content: string }[] };
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.output_config.effort).toBe("medium");
    expect(p.output_config.format).toBeTruthy();
    expect(p.messages[0].content).toContain("Turkish");
  });
});
