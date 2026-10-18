import { timingSafeEqual } from "@/server/auth";
import { errorResponse, json, requireDb } from "@/server/http";
import { runRefresh } from "@/server/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Manual runs must send the same header. */
export async function GET(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") ?? "";
    if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) return json({ error: "Unauthorized" }, 401);
    requireDb();
    return json({ ok: true, results: await runRefresh() });
  } catch (e) {
    return errorResponse(e);
  }
}
