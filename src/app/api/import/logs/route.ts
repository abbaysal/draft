import { db } from "@/server/db";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireDb();
    const logs = await db().importLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
    return json({ logs });
  } catch (e) {
    return errorResponse(e);
  }
}
