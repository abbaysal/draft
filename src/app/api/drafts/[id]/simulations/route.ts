import { z } from "zod";
import { latestSimulations, saveSimulation } from "@/server/drafts";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Durable storage of completed (client/worker-computed) simulation results. */
export async function GET(req: Request, { params }: Ctx) {
  try {
    requireDb();
    const v = new URL(req.url).searchParams.get("version");
    return json({ results: await latestSimulations((await params).id, v ? Number(v) : undefined) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    requireDb();
    const text = await req.text();
    if (text.length > 2_000_000) return json({ error: "Result too large" }, 413);
    const body = z.object({ stateVersion: z.number().int().min(0), kind: z.enum(["championship", "strategy", "mock"]), params: z.unknown(), result: z.unknown() }).parse(JSON.parse(text));
    const r = await saveSimulation((await params).id, { ...body, params: body.params, result: body.result });
    return json({ id: r.id }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
