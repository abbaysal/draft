import { db } from "@/server/db";
import { errorResponse, json, requireDb } from "@/server/http";
import { seedDatabase } from "@/server/seed";

export const maxDuration = 60;

/** Idempotent seed from the bundled dataset (protected by the auth middleware). */
export async function POST() {
  try {
    requireDb();
    const log: string[] = [];
    const res = await seedDatabase(db(), { log: (m) => log.push(m) });
    return json({ ok: true, ...res, log });
  } catch (e) {
    return errorResponse(e);
  }
}
