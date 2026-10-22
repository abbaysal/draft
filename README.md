# NBA 9-Cat Draft War Room · 2026-27

A live fantasy-basketball draft decision platform for 9-category leagues. After every pick it re-ranks every available player by how much it improves **your** chances, using this hierarchy of metrics (the UI always says which one is in use):

1. **Δ Championship probability.** Monte Carlo of the remaining draft → regular season → playoffs, with common random numbers across candidates.
2. **Δ Playoff qualification**, when title deltas are not statistically separable.
3. **Expected category wins / matchup win probability / roto points** (format-aware), from a two-pick "pick now vs wait" lookahead over simulated opponent behaviour.

Z-scores, G-scores and punt rankings are supporting inputs, never the final decision.

> **Tonight's draft (BİLLUR CUP):** the app opens with the BİLLUR CUP preset: 12 teams, snake, İlker's Splendid Team at pick 1, PG/SG/G/SF/PF/F/C plus 3 UTIL, 3 BN and 2 IL. Record **every** pick (yours and opponents') with the Draft buttons or `/` search → Enter. Use `Z` to undo and `Y` to redo, and click a draft-board cell to correct a pick.

---

## Contents

- [Features](#features)
- [Quick start (local)](#quick-start-local)
- [Deploying to Vercel](#deploying-to-vercel)
- [Configuration](#configuration)
- [Data](#data)
- [Security](#security)
- [Architecture](#architecture)
- [Scripts](#scripts)
- [Limitations](#limitations)

Related documents: [RESEARCH.md](RESEARCH.md) · [DATA_SOURCES.md](DATA_SOURCES.md) · [METHODOLOGY.md](METHODOLOGY.md) · [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) · [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) · [TESTING.md](TESTING.md)

## Features

| Page | What it does |
|---|---|
| **War Room** (`/`) | Best strategic pick (or best target for your next pick when you're not on the clock), alternatives with ΔTitle ± SE, available players with survival odds, roster and lineup slots, category outlook, alerts, opponent pick predictions, recent picks, injury watch, and the snake draft board with corrections and traded picks. |
| **Season HQ** (`/` after the draft) | Once every pick is in, the home page becomes Season HQ: this week's matchup (win probability, category odds), league power rankings, your category strengths, upcoming matchups, best waiver add/drops (recorded as pick edits) and trade ideas. The draft room moves to **Draft Board** (`/draft`); undo/redo are only offered there. |
| **Matchups & Lineup** (`/lineup`) | **Sync from Yahoo:** paste the Yahoo matchup page to load both real rosters, injury flags (O/GTD/INJ), NBA teams and positions, and the week-to-date category totals. A **Today** card shows who to start in which slot, with tip-off times in ET and your local time. The **daily optimizer** plans the remaining days on top of the real totals using the official NBA schedule; it fills slots by positional matching and benches a player when his game is expected to cost categories (FG%/FT%/TO). **Streaming** counts the games a free agent would actually start. The **AI lineup coach** (Claude) reviews the plan for injuries, back-to-back rest, late tip-offs and which categories to push, protect or concede, and its start/sit changes can be applied and re-scored. The **lineup analyzer** lets you click any day to start or sit a player and compare. A season outlook covers every remaining week. |
| **Free Agents** (`/free-agents`) | **Sync league rosters:** paste Yahoo League → Rosters, then map renamed teams; free agents become every player on no Yahoo roster, and the real rosters feed every page. Also shows your category needs vs the league (strong/swing/weak/punt) and drop candidates (net change when swapped for the best free agent). Views: Best adds (season Δ expected categories per week vs the league, with the best drop and per-category impact), Stream this week (games he would actually start on open-slot days), Hot (last 14 days vs projection), By category, Next week (games, back-to-backs), Injured stash, Watchlist. Filters cover position, injuries and minimum games left. Rows expand to show category impact, a 14-day schedule, projection and recent line, and a **Record add** button. The **AI waiver advisor** (Claude) suggests long-term adds, streams, stashes and players to keep, and each move can be recorded. |
| **Trade Analyzer** (`/trade`) | Pick players on both sides of a trade: Δ expected categories per week vs the league for you and the partner, playoff-week impact, remaining-schedule expected wins, category before/after, roster balancing (drop/add) and an accept/decline verdict with an acceptance estimate. The trade finder scans every 1-for-1 and 2-for-1 trade with every team and lists win-wins first; a trade can be recorded on the board (pick ownership changes). |
| **Player profiles & Players table** | Profiles add an archetype with strengths and weaknesses; bio (age, experience, height and weight, country, team record); shooting, usage and role (TS%, eFG%, 3P%, 3PA rate, FT rate, usage per 36, AST/TO, OREB/DREB, stocks, fouls); category ranks and per-36 stats; fantasy-value trend by season with durability; similar players; and NBA playoff history. On the Players table, **Advanced view** shows these as sortable columns. |
| **Decision Center** | Concise recommendation plus an expandable breakdown, championship-probability comparison chart with 95% intervals, punt status, future targets and risk warnings. |
| **Players** | Sortable, filterable database (search, position, team, tags, risk, watchlist, available/drafted). Custom columns, custom weights and punt rank, per-game or season totals, CSV export, compare selection. |
| **Player profile** | Projection (labelled model estimate vs imported), history, z-scores, punt ranks, risk split into availability, games, projection and role, playoff schedule, complements, news, and **"What happens if I draft this player?"** with an optional title simulation. |
| **Punt Lab** | All 46 single/double punts plus selected triples and soft punts, each scored by completing the draft and evaluating the league's true objective. Paired Δ vs balanced ± SE, risers and fallers, custom builds, and a commit/stay-flexible verdict. |
| **My Team** | Category totals (percentages from Σmakes/Σattempts), z-sums, radar, stacked contributions, per-opponent matchup odds, portfolio risk P10/P50/P90. |
| **Opponents** | Rival matrix (P(win) per category per opponent), per-team strengths and weaknesses, inferred punts (labelled estimates), tendencies, open slots, predicted picks. |
| **Compare** | 2–5 players: per-game and season stats, z, punt rank, ADP, risk, survival, roster fit and category impact, with a recommendation. |
| **Mock Simulator** | Full-draft + season Monte Carlo for one or two options, with outcome distributions, finish histogram and frequent future additions. |
| **Playoffs** | Team playoff-week schedules, roster playoff games and playoff-adjusted values (requires a schedule import for team-specific results). |
| **History & Audit** | Every pick; with a database, an immutable audit of the state before each pick, the model's top-5 at that moment, the metric level, category impact and title-sim results. |
| **Data** | CSV imports (projections, ADP, schedule, eligibility, history) with validation and dry runs, projection versions and consensus, manual availability corrections, source provenance. |
| **Library** | Concise strategy notes with citations. |
| **Copilot** | Grounded Q&A. The engine produces every number. With `ANTHROPIC_API_KEY` set, Claude (Opus 5.5, server-side refusal fallbacks enabled) explains the fact sheet; without a key, a deterministic explainer answers. |

## Quick start (local)

Requirements: Node ≥ 20.9 and npm. PostgreSQL is optional locally: without it the app runs in **local mode**, storing drafts in the browser.

```bash
npm install
npm run dev            # http://localhost:3000 — local mode (no DB needed)
```

With PostgreSQL (full persistence, audit trail, imports stored server-side):

```bash
cp .env.example .env   # set DATABASE_URL and DIRECT_URL (same value locally is fine)
npx prisma migrate deploy
npm run db:seed        # idempotent: players, history, immutable model projection set
npm run dev
```

Production build: `npm run build && npm start`.

## Deploying to Vercel

The app is Vercel-native: Next.js App Router, stateless serverless functions, a managed Postgres, Web Workers for simulations in the browser, and Vercel Cron for refreshes.

**Fastest path (no database, works tonight):**

1. Vercel → *Add New → Project* → import the GitHub repo.
2. Deploy the branch (set *Settings → Git → Production Branch* to your branch, or use the branch's preview URL).
3. No environment variables are required. Drafts are saved in the browser (local mode).
4. Recommended: set `APP_PASSWORD` and `AUTH_SECRET` so the site is private.

**Full production (persistent sessions, audit trail, server-side imports):**

1. Create a Postgres database: **Neon** (Vercel Marketplace → Neon) or **Supabase**.
2. Environment variables (Project → Settings → Environment Variables):
   - `DATABASE_URL`: the **pooled** connection (Neon `-pooler` host; Supabase port 6543 with `?pgbouncer=true&connection_limit=1`)
   - `DIRECT_URL`: the direct connection (used only for migrations)
   - `APP_PASSWORD`, `AUTH_SECRET` (≥ 16 random characters; e.g. `openssl rand -hex 32`)
   - optional: `ANTHROPIC_API_KEY`, `CRON_SECRET`, feed URLs (see `.env.example`)
3. Deploy. `vercel.json` runs `npm run vercel-build`, which runs `prisma generate`, then `prisma migrate deploy`, then the idempotent seed (skip with `SKIP_SEED=true`), then `next build`.
4. Verify: `GET /api/health` should return `database: "ok"`.

**Deployment checklist**

- [ ] `npm run lint`, `npm run test`, `npm run build` pass locally
- [ ] `DATABASE_URL` is the pooled URL; `DIRECT_URL` is direct
- [ ] `APP_PASSWORD` and `AUTH_SECRET` are set (otherwise production writes are disabled and the app uses browser-local drafts)
- [ ] `/api/health` reports `database: ok`, `auth: password`
- [ ] Optional `CRON_SECRET` is set. The daily cron (`vercel.json`, 13:17 UTC) is compatible with the Hobby plan; Pro allows more frequent schedules.
- [ ] Optional `ANTHROPIC_API_KEY` is set; the health check reports `ai: configured`

## Configuration

All league settings are editable on **League & Drafts** and validated with Zod on the client and the server: teams, draft position, snake or linear, rounds, roster slots (PG/SG/G/SF/PF/F/C/UTIL/BN/IL), scoring format (H2H each category, H2H most categories, roto), active categories, daily or weekly lineups, bench utilisation, weekly games cap, regular-season weeks, playoff teams and weeks, Z vs G scores, per-game vs season basis, risk aversion, and the opponent-randomness parameters.

## Data

Real data only, with explicit labels everywhere:

- **2025-26 actual statistics**: official NBA Stats API totals (582 players) via a public GitHub dataset, with checksums recorded.
- **2023-24 and 2024-25**: per-game aggregates. Attempts are estimated from points and percentages and flagged in the UI.
- **2026 offseason moves, availability and rookies**: researched from published reports. Every row in `data/research/*.csv` carries its source URL and a confidence level. Conflicting reports (e.g. Dean Wade) are not applied.
- **2026-27 projections are MODEL ESTIMATES** (WarRoom Projection Model v1, documented in METHODOLOGY.md), not third-party projections. Import Hashtag Basketball / Basketball Monster / other projections and ADP as CSV on the Data page. Imports become new immutable versions, and drafts keep the version they started with.
- **No ADP is bundled.** Until you import ADP, opponents follow a clearly labelled market proxy.
- **No 2026-27 schedule is bundled.** The official schedule could not be retrieved from this environment, so import it as CSV. Until then, a labelled uniform model is used.

Rebuild the bundled dataset with `npm run data:build`, which writes `src/data/dataset.generated.json` and `data/build-report.json`.

## Security

- `APP_PASSWORD` protects every page and API route (HMAC-signed, httpOnly session cookie, constant-time comparison). Login is rate-limited.
- Without `APP_PASSWORD`, production deployments refuse all writes unless `ALLOW_ANONYMOUS_WRITES=true`, and the client falls back to browser-local drafts.
- `/api/cron/refresh` requires `Authorization: Bearer $CRON_SECRET`.
- All inputs are validated with Zod. Secrets are server-only (no `NEXT_PUBLIC_` secrets). Security headers are set in `next.config.ts`.
- Rate limiting is per serverless instance (best effort). For strict limits, add a shared store such as Upstash Redis.

## Architecture

```
src/lib/engine/*      pure TypeScript analytics (runs in workers, server and tests)
  valuation.ts        Z/G scores, volume-weighted FG%/FT% impact, frozen baselines, replacement level
  team.ts             weekly team distributions, category & matchup win probabilities, roto points
  draft.ts            snake draft reducer (pick/undo/redo/edit/trade), validation
  market.ts           opponent pick model (ADP noise, needs, learned tendencies), expected fills
  availability.ts     Monte Carlo survival to my next pick
  recommend.ts        fast two-pick lookahead recommendations (level 2)
  championship.ts     draft→season→playoff Monte Carlo, Δ title / Δ playoffs, fallback verdict
  strategy.ts         punt/build engine with paired comparisons and commitment rule
  scarcity.ts, opponents.ts, risk.ts, playoffs.ts, alerts.ts, tags.ts, schedule.ts
src/lib/projection    WarRoom Projection Model v1
src/lib/import        CSV import, consensus, versioning
src/server            Prisma access, drafts (transactions), imports, refresh, auth
src/workers           Web Worker entry (fast / strategies / championship jobs)
src/client            Zustand store (optimistic updates, offline queue), worker pool
src/app               Next.js App Router pages + API routes
```

Heavy simulations run in **browser Web Workers** (a pool of up to four, in chunks, cancelled when the draft changes), so they never block the draft board and never hit serverless time limits. Completed simulation summaries are stored durably via `/api/drafts/:id/simulations`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` / `typecheck` | ESLint (0 warnings) / tsc |
| `npm run test` | Unit tests (Vitest). DB integration tests are skipped without `DATABASE_URL`. |
| `npm run test:db` | Postgres integration tests (reads `.env`) |
| `npm run test:e2e` / `test:e2e:db` | Playwright end-to-end tests, local mode / database mode (run `npm run build` first) |
| `npm run data:build` | Rebuild the bundled dataset from `data/raw` + `data/research` |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed |
| `npm run engine:smoke` | Engine timings and sample output on real data |

## Limitations

- Projections are model-generated until you import external projections. ADP, the 2026-27 schedule and platform position eligibility are not bundled; import them for best results.
- Absolute championship probabilities are model-dependent and optimistic for your team (your future picks follow the optimiser while opponents follow the market model). Use the **differences** between candidates.
- Auction drafts are not supported (snake and linear only).
- Real-time news requires configured, authorised RSS feeds (`NEWS_FEED_URLS`) or manual entry. Unverified items are labelled and never change projections automatically.
