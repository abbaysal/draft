/**
 * Minimal single-owner authentication (Edge + Node compatible, Web Crypto only).
 * APP_PASSWORD protects the deployment; the session cookie is an HMAC-SHA256 token
 * signed with AUTH_SECRET. Comparison is constant-time.
 */
export const SESSION_COOKIE = "wr_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function authConfigured(): boolean {
  return !!process.env.APP_PASSWORD;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET must be set (≥ 16 chars) when APP_PASSWORD is used");
  return s;
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const issued = Math.floor(now / 1000).toString();
  return `${issued}.${await hmac(secret(), `owner:${issued}`)}`;
}

export async function verifySessionToken(token: string | undefined | null, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [issued, sig] = token.split(".");
  if (!issued || !sig) return false;
  const age = Math.floor(now / 1000) - Number(issued);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_S) return false;
  return timingSafeEqual(sig, await hmac(secret(), `owner:${issued}`));
}

export async function checkPassword(input: string): Promise<boolean> {
  const pw = process.env.APP_PASSWORD ?? "";
  if (!pw) return false;
  // Compare HMACs so timing does not leak length.
  const s = process.env.AUTH_SECRET ?? "pw";
  return timingSafeEqual(await hmac(s, input), await hmac(s, pw));
}

export const SESSION_MAX_AGE = MAX_AGE_S;

/**
 * Write policy:
 *  - APP_PASSWORD set  → writes need a valid session cookie.
 *  - not set, dev      → writes allowed (local development).
 *  - not set, prod     → writes allowed only if ALLOW_ANONYMOUS_WRITES=true (explicit opt-in).
 */
export function anonymousWritesAllowed(): boolean {
  if (authConfigured()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.ALLOW_ANONYMOUS_WRITES === "true";
}
