import { loadDataset } from "@/server/dataset";
import { errorResponse, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Composed analysis dataset (players + history + chosen projection set + ADP + overrides + schedule). */
export async function GET(req: Request) {
  try {
    const set = new URL(req.url).searchParams.get("set");
    const payload = await loadDataset(set);
    const etag = `"${payload.source}-${payload.dataVersion}-${payload.projectionSetId}-${payload.adpSetId ?? ""}"`;
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    return json(payload, { headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  } catch (e) {
    return errorResponse(e);
  }
}
