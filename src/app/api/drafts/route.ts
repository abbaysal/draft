import { z } from "zod";
import { createSession, listSessions } from "@/server/drafts";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireDb();
    return json({ sessions: await listSessions() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    requireDb();
    const body = z.object({ name: z.string().min(1).max(80), settings: z.unknown(), state: z.unknown().optional(), projectionSetId: z.string().nullish() }).parse(await req.json());
    return json({ session: await createSession({ ...body, settings: body.settings }) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
