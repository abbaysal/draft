import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, anonymousWritesAllowed, authConfigured, verifySessionToken } from "@/server/auth";

/**
 * Access policy (see README → Security):
 *  - APP_PASSWORD set: every page and API route requires the signed session cookie,
 *    except /login, /api/auth/*, /api/health and /api/cron/* (cron uses CRON_SECRET).
 *  - APP_PASSWORD unset: pages are public; mutating API calls are allowed only in
 *    development or when ALLOW_ANONYMOUS_WRITES=true.
 */
const PUBLIC = [/^\/login/, /^\/api\/auth\//, /^\/api\/health/, /^\/api\/cron\//, /^\/_next\//, /^\/favicon/];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  const isApi = pathname.startsWith("/api/");
  const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
  if (authConfigured()) {
    const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value).catch(() => false);
    if (ok) return NextResponse.next();
    if (isApi) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (isApi && mutating && !anonymousWritesAllowed())
    return NextResponse.json({ error: "Writes disabled: set APP_PASSWORD (recommended) or ALLOW_ANONYMOUS_WRITES=true" }, { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
