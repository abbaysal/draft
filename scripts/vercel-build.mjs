/**
 * Vercel build: generate the Prisma client, apply migrations and seed (idempotent)
 * when a database is configured, then build Next.js. Without DATABASE_URL the app
 * builds in bundled/local mode.
 */
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });
run("npx prisma generate");
// Vercel's Neon / Postgres integrations use different variable names; map them.
// Integrations may add a custom prefix (e.g. STORAGE_DATABASE_URL).
const findEnv = (sufs) => {
  for (const suf of sufs) {
    if (process.env[suf]) return process.env[suf];
    const key = Object.keys(process.env).find((k) => k.endsWith(`_${suf}`) && process.env[k]);
    if (key) return process.env[key];
  }
  return "";
};
process.env.DATABASE_URL ||= findEnv(["DATABASE_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL"]);
process.env.DIRECT_URL ||= findEnv(["DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"]) || process.env.DATABASE_URL;
if (process.env.DATABASE_URL) {
  run("npx prisma migrate deploy");
  if (process.env.SKIP_SEED !== "true") run("npx tsx prisma/seed.ts");
} else {
  console.warn("[vercel-build] DATABASE_URL not set — building without database (local mode only).");
}
run("npx next build");
