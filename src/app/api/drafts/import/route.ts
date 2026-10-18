import { z } from "zod";
import { createSession } from "@/server/drafts";
import { errorResponse, json, requireDb } from "@/server/http";

/** Restore a draft exported from this app (server or local mode). */
export async function POST(req: Request) {
  try {
    requireDb();
    const body = z
      .object({ format: z.literal("warroom-draft-v1"), session: z.object({ name: z.string(), settings: z.unknown(), state: z.unknown(), projectionSetId: z.string().nullish() }) })
      .parse(await req.json());
    return json({ session: await createSession({ name: `${body.session.name} (restored)`, settings: body.session.settings, state: body.session.state, projectionSetId: body.session.projectionSetId }) }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
