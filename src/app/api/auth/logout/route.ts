import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/server/auth";
import { json } from "@/server/http";

export async function POST() {
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
}
