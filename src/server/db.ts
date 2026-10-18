import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton. On Vercel each serverless instance reuses one client; use a
 * POOLED connection string (Neon "-pooler" host or Supabase pgbouncer, with
 * `?pgbouncer=true&connection_limit=1`) for DATABASE_URL and the direct host for DIRECT_URL.
 */
const g = globalThis as unknown as { __prisma?: PrismaClient };

// Accept the variable names used by Vercel's Neon / Postgres integrations.
if (!process.env.DATABASE_URL && (process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL))
  process.env.DATABASE_URL = process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL;
if (!process.env.DIRECT_URL && process.env.DATABASE_URL)
  process.env.DIRECT_URL = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

export function db(): PrismaClient {
  if (!hasDatabase()) throw new Error("DATABASE_URL is not configured");
  if (!g.__prisma) g.__prisma = new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
  return g.__prisma;
}

export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  const row = await db().appConfig.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setConfig(key: string, value: unknown) {
  await db().appConfig.upsert({ where: { key }, update: { value: value as object }, create: { key, value: value as object } });
}

/** Monotonic data version; bumped by every import so clients refetch the dataset. */
export async function bumpDataVersion(): Promise<number> {
  const v = (await getConfig<number>("dataVersion", 0)) + 1;
  await setConfig("dataVersion", v);
  return v;
}
