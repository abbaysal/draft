import { getLiveFeed } from "@/server/live";
import { errorResponse, json } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** In-season feed: 2026-27 box-score totals, recent form, injury report and live schedule (cached 15 min). */
export async function GET() {
  try {
    return json(await getLiveFeed());
  } catch (e) {
    return errorResponse(e);
  }
}
