import { disconnect, fetchDraft, yahooConfigured } from "@/server/yahoo";
import { errorResponse, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Live Yahoo draft results for the configured league (default BİLLUR CUP 254849). */
export async function GET(req: Request) {
  try {
    if (!yahooConfigured()) return json({ configured: false, error: "Yahoo app not configured" }, 501);
    const leagueId = new URL(req.url).searchParams.get("league") ?? process.env.YAHOO_LEAGUE_ID ?? "254849";
    if (!/^\d+$/.test(leagueId)) return json({ error: "Invalid league id" }, 400);
    return json({ configured: true, ...(await fetchDraft(req, leagueId)) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE() {
  await disconnect();
  return json({ ok: true });
}
