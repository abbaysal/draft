import { z } from "zod";
import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE, authConfigured, checkPassword, createSessionToken } from "@/server/auth";
import { errorResponse, json } from "@/server/http";
import { clientKey, rateLimit } from "@/server/ratelimit";

export async function POST(req: Request) {
  try {
    if (!authConfigured()) return json({ ok: true, auth: "none" });
    if (!rateLimit(`login:${clientKey(req)}`, 8, 0.05)) return json({ error: "Too many attempts — wait a minute" }, 429);
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await req.json());
    if (!(await checkPassword(password))) return json({ error: "Invalid password" }, 401);
    (await cookies()).set(SESSION_COOKIE, await createSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
