import { z } from "zod";
import { archiveSession, getSession, updateSession } from "@/server/drafts";
import { errorResponse, json, requireDb } from "@/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    requireDb();
    return json({ session: await getSession((await params).id) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    requireDb();
    const body = z.object({ name: z.string().min(1).max(80).optional(), settings: z.unknown().optional(), expectedVersion: z.number().int().min(0) }).parse(await req.json());
    return json({ session: await updateSession((await params).id, body) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    requireDb();
    await archiveSession((await params).id);
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
