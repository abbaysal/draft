import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a production build (`npm run build` first).
 *  - Default: local mode (no database) — DATABASE_URL is blanked for the server.
 *  - E2E_DB=1: server mode against the DATABASE_URL in the environment / .env.
 */
const port = Number(process.env.E2E_PORT ?? 3300);
const withDb = process.env.E2E_DB === "1";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1600, height: 1000 } },
  webServer: {
    command: `npx next start -p ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 60_000,
    env: withDb ? { ALLOW_ANONYMOUS_WRITES: "true" } : { DATABASE_URL: "", DIRECT_URL: "" },
  },
});
