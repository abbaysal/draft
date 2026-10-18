import { ActionRequestSchema, applyAction } from "@/server/drafts";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

/** Transactional draft action (pick / undo / redo / edit / setOwner / reset) with optimistic concurrency. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDb();
    const body = ActionRequestSchema.parse(await req.json());
    return json({ session: await applyAction((await params).id, body) });
  } catch (e) {
    return errorResponse(e);
  }
}
