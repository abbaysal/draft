import { z } from "zod";
import { db } from "@/server/db";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    requireDb();
    const playerId = new URL(req.url).searchParams.get("playerId");
    const items = await db().newsItem.findMany({ where: playerId ? { playerId } : {}, orderBy: { publishedAt: "desc" }, take: 100 });
    return json({ items });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Manual news entry. Status distinguishes confirmed reports from rumors; rumors never change projections. */
export async function POST(req: Request) {
  try {
    requireDb();
    const b = z
      .object({
        playerId: z.string().nullish(),
        title: z.string().min(3).max(200),
        body: z.string().max(2000).optional(),
        kind: z.enum(["injury", "trade", "rotation", "projection", "other"]),
        status: z.enum(["confirmed", "reported", "rumor"]),
        confidence: z.enum(["high", "medium", "low"]),
        sourceName: z.string().min(1).max(100),
        sourceUrl: z.string().url().optional(),
        publishedAt: z.string().datetime().optional(),
      })
      .parse(await req.json());
    const item = await db().newsItem.create({
      data: { ...b, playerId: b.playerId ?? null, body: b.body ?? null, sourceUrl: b.sourceUrl ?? null, publishedAt: b.publishedAt ? new Date(b.publishedAt) : new Date(), dedupeKey: `manual:${Date.now()}:${b.title.slice(0, 40)}` },
    });
    return json({ item }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
