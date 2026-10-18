/**
 * Vercel build: generate the Prisma client, apply migrations and seed (idempotent)
 * when a database is configured, then build Next.js. Without DATABASE_URL the app
 * builds in bundled/local mode.
 */
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit", env: process.env });
run("npx prisma generate");
// Vercel's Neon / Postgres integrations use different variable names; map them.
process.env.DATABASE_URL ||= process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || "";
process.env.DIRECT_URL ||= process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (process.env.DATABASE_URL) {
  run("npx prisma migrate deploy");
  if (process.env.SKIP_SEED !== "true") run("npx tsx prisma/seed.ts");
} else {
  console.warn("[vercel-build] DATABASE_URL not set — building without database (local mode only).");
}
run("npx next build");
