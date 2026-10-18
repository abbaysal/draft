import { db, hasDatabase } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import bundled from "@/data/dataset.generated.json";

export const dynamic = "force-dynamic";

/** Source freshness overview for the Data Management page. */
export async function GET() {
  try {
    const meta = (bundled as { meta: { sources: unknown[]; builtAt: string; notes: string[] } }).meta;
    if (!hasDatabase()) return json({ mode: "bundled", bundled: meta, sets: [], adp: [], schedule: { games: 0 }, refresh: [] });
    const prisma = db();
    const [sets, adp, games, refresh, latestNews] = await Promise.all([
      prisma.projectionSet.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.adpSet.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
      prisma.scheduleGame.count({ where: { season: "2026-27" } }),
      prisma.refreshRun.findMany({ orderBy: { startedAt: "desc" }, take: 10 }),
      prisma.newsItem.findFirst({ orderBy: { createdAt: "desc" } }),
    ]);
    return json({ mode: "database", bundled: meta, sets, adp, schedule: { games }, refresh, latestNews: latestNews?.createdAt ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
