import { z } from "zod";
import { activateProjectionSet, createConsensus, listProjectionSets } from "@/server/imports";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireDb();
    return json({ sets: await listProjectionSets() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    requireDb();
    const body = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("activate"), id: z.string() }),
        z.object({ action: z.literal("consensus"), inputs: z.array(z.object({ id: z.string(), weight: z.number().min(0).max(10) })).min(1).max(8), label: z.string().max(120).optional() }),
      ])
      .parse(await req.json());
    if (body.action === "activate") {
      await activateProjectionSet(body.id);
      return json({ ok: true });
    }
    return json(await createConsensus(body.inputs, body.label), 201);
  } catch (e) {
    return errorResponse(e);
  }
}
