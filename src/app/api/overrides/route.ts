import { z } from "zod";
import { bumpDataVersion, db } from "@/server/db";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";

/** Manual data corrections (team, eligibility, games missed). Stored separately; raw data is never overwritten. */
const Body = z.discriminatedUnion("field", [
  z.object({ field: z.literal("team"), playerId: z.string(), value: z.object({ team: z.string().length(3) }), note: z.string().max(300).optional() }),
  z.object({ field: z.literal("elig"), playerId: z.string(), value: z.object({ elig: z.array(z.enum(["PG", "SG", "SF", "PF", "C"])).min(1) }), note: z.string().max(300).optional() }),
  z.object({ field: z.literal("gamesMissed"), playerId: z.string(), value: z.object({ games: z.number().min(0).max(82) }), note: z.string().max(300).optional() }),
]);

export async function GET() {
  try {
    requireDb();
    return json({ overrides: await db().playerOverride.findMany({ where: { active: true }, orderBy: { createdAt: "desc" }, take: 200 }) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    requireDb();
    const b = Body.parse(await req.json());
    const prisma = db();
    await prisma.$transaction([
      prisma.playerOverride.updateMany({ where: { playerId: b.playerId, field: b.field, active: true }, data: { active: false } }),
      prisma.playerOverride.create({ data: { playerId: b.playerId, field: b.field, value: b.value, note: b.note ?? null } }),
    ]);
    await bumpDataVersion();
    return json({ ok: true }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request) {
  try {
    requireDb();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json({ error: "id required" }, 400);
    await db().playerOverride.update({ where: { id }, data: { active: false } });
    await bumpDataVersion();
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
