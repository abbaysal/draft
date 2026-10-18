import { NextResponse } from "next/server";
import { exchangeCode } from "@/server/yahoo";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const code = u.searchParams.get("code");
    if (!code) return errorResponse(new Error(u.searchParams.get("error_description") ?? "Missing code"));
    await exchangeCode(req, code, u.searchParams.get("state"));
    return NextResponse.redirect(new URL("/?yahoo=connected", req.url));
  } catch (e) {
    return errorResponse(e);
  }
}
