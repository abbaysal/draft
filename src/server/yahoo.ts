import { cookies } from "next/headers";
import { findFirst, parseDraftResults, parsePlayerNames } from "@/lib/yahoo";
import { HttpError } from "./http";

const AUTH = "https://api.login.yahoo.com/oauth2";
const API = "https://fantasysports.yahooapis.com/fantasy/v2";
const C = { at: "yh_at", rt: "yh_rt", exp: "yh_exp", state: "yh_state" };
const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 30 };

export function yahooConfigured() {
  return !!(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);
}

export function redirectUri(req: Request) {
  if (process.env.YAHOO_REDIRECT_URI) return process.env.YAHOO_REDIRECT_URI;
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? u.host;
  return `${proto}://${host}/api/yahoo/callback`;
}

function basic() {
  return "Basic " + Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString("base64");
}

export async function authorizeUrl(req: Request) {
  const state = crypto.randomUUID();
  (await cookies()).set(C.state, state, { ...cookieOpts, maxAge: 600 });
  const p = new URLSearchParams({ client_id: process.env.YAHOO_CLIENT_ID!, redirect_uri: redirectUri(req), response_type: "code", language: "en-us", state });
  return `${AUTH}/request_auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const res = await fetch(`${AUTH}/get_token`, { method: "POST", headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) throw new HttpError(502, `Yahoo token error: ${data.error_description ?? data.error ?? res.status}`);
  const jar = await cookies();
  jar.set(C.at, data.access_token, cookieOpts);
  if (data.refresh_token) jar.set(C.rt, data.refresh_token, cookieOpts);
  jar.set(C.exp, String(Date.now() + ((data.expires_in ?? 3600) - 120) * 1000), cookieOpts);
  return data.access_token;
}

export async function exchangeCode(req: Request, code: string, state: string | null) {
  const jar = await cookies();
  if (!state || jar.get(C.state)?.value !== state) throw new HttpError(400, "Yahoo login state mismatch — try connecting again");
  jar.delete(C.state);
  await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri(req) });
}

async function accessToken(req: Request): Promise<string> {
  const jar = await cookies();
  const at = jar.get(C.at)?.value;
  const exp = Number(jar.get(C.exp)?.value ?? 0);
  if (at && Date.now() < exp) return at;
  const rt = jar.get(C.rt)?.value;
  if (!rt) throw new HttpError(401, "Not connected to Yahoo");
  return tokenRequest({ grant_type: "refresh_token", refresh_token: rt, redirect_uri: redirectUri(req) });
}

async function api(token: string, path: string) {
  const res = await fetch(`${API}/${path}${path.includes("?") ? "&" : "?"}format=json`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401) throw new HttpError(401, "Yahoo session expired — reconnect");
  if (!res.ok) throw new HttpError(502, `Yahoo API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

let gameKeyCache: string | null = null;
const nameCache = new Map<string, string>();

export async function fetchDraft(req: Request, leagueId: string) {
  const t0 = Date.now();
  const token = await accessToken(req);
  if (!gameKeyCache) gameKeyCache = findFirst(await api(token, "game/nba"), "game_key");
  if (!gameKeyCache) throw new HttpError(502, "Could not resolve Yahoo NBA game key");
  const leagueKey = `${gameKeyCache}.l.${leagueId}`;
  const picks = parseDraftResults(await api(token, `league/${leagueKey}/draftresults`));
  const missing = [...new Set(picks.map((p) => p.playerKey).filter((k): k is string => !!k && !nameCache.has(k)))];
  for (let i = 0; i < missing.length; i += 25) {
    const batch = missing.slice(i, i + 25);
    const names = parsePlayerNames(await api(token, `league/${leagueKey}/players;player_keys=${batch.join(",")}`));
    for (const [k, n] of names) nameCache.set(k, n);
  }
  return {
    leagueKey,
    fetchedAt: new Date().toISOString(),
    fetchMs: Date.now() - t0,
    picks: picks.map((p) => ({ ...p, name: p.playerKey ? (nameCache.get(p.playerKey) ?? null) : null })),
  };
}

export async function disconnect() {
  const jar = await cookies();
  for (const k of [C.at, C.rt, C.exp]) jar.delete(k);
}
