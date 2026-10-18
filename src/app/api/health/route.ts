import { json } from "@/server/http";
import { db, hasDatabase } from "@/server/db";
import { authConfigured, anonymousWritesAllowed } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Health check used by monitoring and by the client to choose server vs local mode. */
export async function GET() {
  let database: "ok" | "unconfigured" | "error" = "unconfigured";
  let detail: string | undefined;
  if (hasDatabase()) {
    try {
      await db().$queryRaw`SELECT 1`;
      database = "ok";
    } catch (e) {
      database = "error";
      detail = e instanceof Error ? e.message.split("\n")[0] : "unknown";
    }
  }
  return json({
    status: database === "error" ? "degraded" : "ok",
    database,
    detail,
    auth: authConfigured() ? "password" : "none",
    writes: authConfigured() ? "authenticated" : anonymousWritesAllowed() ? "anonymous" : "disabled",
    ai: process.env.ANTHROPIC_API_KEY ? "configured" : "unconfigured",
    time: new Date().toISOString(),
  });
}
