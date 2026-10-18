import { NextResponse } from "next/server";
import { authorizeUrl, yahooConfigured } from "@/server/yahoo";
import { errorResponse, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    if (!yahooConfigured()) return json({ error: "Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in Vercel" }, 501);
    return NextResponse.redirect(await authorizeUrl(req));
  } catch (e) {
    return errorResponse(e);
  }
}
