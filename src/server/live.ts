/**
 * Live in-season feed (served by /api/live). Fetches public JSON feeds from the server
 * (Vercel can reach them; browsers would be blocked by CORS):
 *   - NBA.com CDN schedule: game ids, dates, status          (refreshed every 15 min)
 *   - NBA.com CDN box scores of every final game              (cached permanently: finals never change)
 *   - ESPN public injury report                               (refreshed every 15 min)
 * The aggregate is cached for 15 minutes in the Next.js data cache, so a page view never
 * triggers more than one rebuild per window. Failures are reported per source; the app then
 * keeps using the bundled dataset for that part.
 */
import { unstable_cache } from "next/cache";
import { aggregateBoxscores, parseEspnInjuries, parseNbaBoxscore, parseNbaSchedule, type LiveGame } from "@/lib/live/parse";
import type { LiveFeed } from "@/lib/live/blend";

export const LIVE_SOURCES = {
  schedule: "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json",
  boxscore: (id: string) => `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${id}.json`,
  injuries: "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
};
const SEASON = "2026-27";
const SEASON_START = "2026-10-01";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; 9cat-war-room/1.0)", Accept: "application/json", Referer: "https://www.nba.com/" };

async function getJson(url: string, init: RequestInit & { next?: { revalidate?: number } }, timeoutMs = 15000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, headers: HEADERS, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const msg = (e: unknown) => (e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e));

export async function buildFeed(): Promise<LiveFeed> {
  const sources: LiveFeed["sources"] = [];
  const warnings: string[] = [];
  let games: LiveGame[] = [];
  try {
    const all = parseNbaSchedule(await getJson(LIVE_SOURCES.schedule, { next: { revalidate: 900 } }));
    games = all.filter((g) => g.date >= SEASON_START);
    if (all.length && !games.length) warnings.push("NBA schedule feed is not on the 2026-27 season yet.");
    sources.push({ id: "nba-schedule", name: "NBA.com schedule (CDN)", url: LIVE_SOURCES.schedule, ok: games.length > 0, error: games.length ? undefined : "no 2026-27 games in feed", count: games.length });
  } catch (e) {
    sources.push({ id: "nba-schedule", name: "NBA.com schedule (CDN)", url: LIVE_SOURCES.schedule, ok: false, error: msg(e), count: 0 });
  }

  const finals = games.filter((g) => g.status === 3);
  let failed = 0;
  const box = await pool(finals, 12, async (g) => {
    try {
      // Final box scores never change: cache them permanently.
      return { date: g.date, lines: parseNbaBoxscore(await getJson(LIVE_SOURCES.boxscore(g.gameId), { cache: "force-cache" })) };
    } catch {
      failed++;
      return null;
    }
  });
  const ok = box.filter((b): b is NonNullable<typeof b> => !!b && b.lines.length > 0);
  if (failed) warnings.push(`${failed} of ${finals.length} final box scores could not be loaded; they will be retried.`);
  sources.push({
    id: "nba-boxscores",
    name: "NBA.com box scores (CDN)",
    url: LIVE_SOURCES.boxscore("<gameId>"),
    ok: finals.length === 0 ? games.length > 0 : ok.length > 0,
    error: finals.length === 0 ? (games.length ? "season not started — no final games yet" : "schedule unavailable") : ok.length ? undefined : "no box scores loaded",
    count: ok.length,
  });
  const teamGames: Record<string, number> = {};
  for (const g of finals) for (const t of [g.home, g.away]) teamGames[t] = (teamGames[t] ?? 0) + 1;

  let injuries: LiveFeed["injuries"] = [];
  try {
    injuries = parseEspnInjuries(await getJson(LIVE_SOURCES.injuries, { next: { revalidate: 900 } }));
    sources.push({ id: "espn-injuries", name: "ESPN injury report", url: LIVE_SOURCES.injuries, ok: true, count: injuries.length });
  } catch (e) {
    sources.push({ id: "espn-injuries", name: "ESPN injury report", url: LIVE_SOURCES.injuries, ok: false, error: msg(e), count: 0 });
  }

  return {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    sources,
    // Use the live schedule only when it covers the full season (it then includes NBA Cup knockout games).
    schedule: games.length >= 1150 ? games.map(({ date, home, away, time }) => ({ date, home, away, time })) : null,
    teamGames,
    stats: aggregateBoxscores(ok),
    injuries,
    warnings,
  };
}

class LiveUnavailable extends Error {
  constructor(readonly feed: LiveFeed) {
    super("all live sources failed");
  }
}

const cached = unstable_cache(
  async () => {
    const feed = await buildFeed();
    // Never cache a total failure: the next request retries immediately.
    if (!feed.sources.some((s) => s.ok)) throw new LiveUnavailable(feed);
    return feed;
  },
  ["live-feed-v1"],
  { revalidate: 900, tags: ["live"] },
);

export async function getLiveFeed(): Promise<LiveFeed> {
  try {
    return await cached();
  } catch (e) {
    if (e instanceof LiveUnavailable) return e.feed;
    throw e;
  }
}
