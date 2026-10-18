import { exportSession } from "@/server/drafts";
import { errorResponse, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireDb();
    const id = (await params).id;
    const data = await exportSession(id);
    return new Response(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="draft-${id}.json"` },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
