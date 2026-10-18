import { cookies } from "next/headers";
import { SESSION_COOKIE, anonymousWritesAllowed, authConfigured, verifySessionToken } from "@/server/auth";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const authed = authConfigured() ? await verifySessionToken(token).catch(() => false) : false;
  return json({ authConfigured: authConfigured(), authenticated: authed, canWrite: authConfigured() ? authed : anonymousWritesAllowed() });
}
