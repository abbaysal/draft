# Database Schema (PostgreSQL via Prisma)

Source of truth: `prisma/schema.prisma`. Migrations: `prisma/migrations/`. Apply with `npm run db:migrate` (`prisma migrate deploy`) and seed with `npm run db:seed` (idempotent).

## Source-of-truth separation

| Concern | Table(s) | Mutability |
|---|---|---|
| Player identity & metadata | `Player` (+ `PlayerOverride` for manual corrections) | Upserted by seed; corrections stored separately, never overwrite raw data |
| Historical / current actual stats | `SeasonStat` (`kind`: historical / current_actual; unique per player+season+source) | Insert-only |
| Third-party / model / consensus / custom projections | `ProjectionSet` + `Projection` | **Immutable** per set; a new import = a new set; `isActive` selects the default |
| ADP | `AdpSet` + `AdpEntry` | Immutable per set |
| NBA schedule | `ScheduleGame` (season, date, home, away) | Replaced per season on import |
| News | `NewsItem` (status confirmed/reported/rumor, confidence, source, dedupeKey) | Insert-only (deduplicated) |
| Draft sessions | `DraftSession` (settings JSON, reducer state JSON, `version`, frozen `projectionSetId`) | Updated transactionally |
| Picks | `DraftPick` — **unique (sessionId, overall)** and **unique (sessionId, playerId)** | Synced in the same transaction as the session |
| Audit | `DraftAudit` (state before, recommendation snapshot, category impact, simulation summary, projection version) | Insert-only |
| Simulation results | `SimulationResult` (session, state version, kind, params, result) | Insert-only |
| Import & refresh logs | `ImportLog`, `RefreshRun` | Insert-only |
| Config | `AppConfig` (e.g. `dataVersion`, content hashes for idempotent refresh) | Key-value |

## Tables

- **Player**: `id` (e.g. `nba-1641705`, `espn-…`, `rookie-2026-1`), `nbaId` (unique), `espnId`, `name`, `nameKey` (indexed, for identity matching), `team` (indexed), `nbaPos`, `elig[]`, `eligSource`, `age`, `birthdate`, `experience`, `heightM`, `weightKg`, `rookie`, `teamChange`, `availability` and `tags` (JSON with sources and confidence).
- **SeasonStat**: per-game line (`gp, min, pts, fg3m, reb, ast, stl, blk, tov, fgm, fga, ftm, fta`), `attemptsEstimated`, `source`, `team`.
- **ProjectionSet**: `id`, `label`, `source`, `kind` (model / external / consensus / custom), `isActive`, `notes`.
- **Projection**: per-game line plus `gp`, `sd` (JSON), `gpSd`, `confidence`, `kind` (estimate / projection), `flags[]`. Unique (setId, playerId).
- **DraftSession**: `settings` (validated `LeagueSettings`), `state` (`DraftState`: picks, redo, ownerOverrides, version), `version` (optimistic concurrency), `projectionSetId` (frozen at creation), `archived`.
- **DraftPick**, **DraftAudit**, **SimulationResult**, **ImportLog**, **RefreshRun**, **AppConfig**, **NewsItem**, **ScheduleGame**, **AdpSet/AdpEntry**, **PlayerOverride**: see the schema file for exact fields.

## Draft transaction (`src/server/drafts.ts → applyAction`)

1. Load the session, then compare `expectedVersion` with `version`. A mismatch returns **409** with the current state.
2. Apply the pure reducer: it validates order, duplicates, ownership and completion. Validation failures return **422**.
3. Sync `DraftPick` rows: delete changed or removed overall slots, then insert new ones. The unique constraints make a duplicate selection impossible even under concurrent requests (P2002 is mapped to 409).
4. `updateMany … where version = expectedVersion` (a second concurrency guard).
5. Insert a `DraftAudit` row with the state before the action and the client's recommendation snapshot.

All steps run in one interactive transaction. The integration tests (`tests/integration/drafts.db.test.ts`) verify that exactly one of two concurrent requests for the same version succeeds.

## Indexes

`Player(nameKey)`, `Player(team)`, `SeasonStat(season)`, `ProjectionSet(isActive)`, `Projection(setId)`, `ScheduleGame(season)`, `NewsItem(playerId)`, `NewsItem(publishedAt)`, `DraftSession(updatedAt)`, `DraftAudit(sessionId, version)`, `SimulationResult(sessionId, stateVersion)`, `RefreshRun(job, startedAt)`, plus every unique constraint.

## Connection strategy (Vercel)

- `DATABASE_URL`: pooled connection (Neon `-pooler` / Supabase pgbouncer, `connection_limit=1`), used by serverless functions through a singleton `PrismaClient`.
- `DIRECT_URL`: direct connection, used by `prisma migrate deploy` during the build.
