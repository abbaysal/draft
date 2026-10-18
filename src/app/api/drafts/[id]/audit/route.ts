import { getAudit } from "@/server/drafts";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDb();
    return json({ audit: await getAudit((await params).id) });
  } catch (e) {
    return errorResponse(e);
  }
}
