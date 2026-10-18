# Testing

| Suite | Command | Count | Needs |
|---|---|---|---|
| Unit (engine, imports, projection, draft) | `npm run test` | 67 | — |
| Integration (PostgreSQL) | `npm run test:db` | 8 | `DATABASE_URL` in `.env`, migrated |
| End-to-end, local mode | `npm run build && npm run test:e2e` | 4 | Chromium (Playwright) |
| End-to-end, database mode | `npm run build && npm run test:e2e:db` | 4 | DB + Chromium |
| Engine smoke / timings | `npm run engine:smoke` | — | — |

## What is covered

**Valuation (`tests/unit/valuation.test.ts`)**: z-normalisation over the draftable pool; reversed turnovers; FG% impact = FGM − baseline × FGA (high- vs low-volume shooters); extremely high-volume poor FT shooter vs high-percentage low-volume shooter; zero shot attempts (no NaN); missing projections excluded; punts don't re-centre the baseline; several punts plus soft weights; rank shifts; replacement level and VORP; G-score shrinkage; season basis rewards games; team percentages from aggregated makes/attempts.

**Draft (`draft.test.ts`)**: snake order; linear order; a team's picks including back-to-back turns; very long intervals between picks (20 teams); pick assignment; duplicate prevention; unknown players; undo/redo; redo invalidation; pick corrections without duplicates; traded picks; a completed (nearly complete) draft; versioning; corrupted-state detection.

**Matchup model (`team.ts`)**: volume-weighted team FG%; identical teams split 50/50; P(A>B)+P(B>A)=1; turnovers favour the lower team; injured players contribute nothing; Poisson-binomial consistency.

**Simulations (`engine.test.ts`)**: availability reproducibility (seeded), probability bounds, horizon equals the snake gap, expected taken = horizon; recommendation ordering and labelled picks; sudden injury lowers a star immediately; nearly complete draft; championship sims reproducible and chunk-mergeable (CRN); fallback level with too few sims; round-robin correctness (including odd team counts); strategy catalogue and paired deltas; scarcity bounds; opponent profiles; opponents repeatedly drafting one position; position eligibility and lineup matching.

**Imports & projection (`import.test.ts`)**: identity matching (diacritics, suffixes, apostrophes); header aliases and percentage+attempts input; rejection of files without attempts; season-totals normalisation; unmatched and invalid rows reported, never invented; makes > attempts; volume-aware consensus; immutable application of projection sets; ADP and metadata imports; schedule parsing (full names, BR-style headers), weeks, back-to-backs; uniform schedule sums to 82; attempts estimation identity; small-sample regression; team change widens uncertainty.

**Integration (`tests/integration/drafts.db.test.ts`)**: persisted pick + audit + pick row; stale version → 409; duplicate → 422; **two concurrent requests for the same version → exactly one succeeds**; undo/redo keep pick rows in sync; corrections keep rows unique; settings conflicting with picks rejected; seed idempotent and the projection set immutable.

**End-to-end (`tests/e2e/draft.spec.ts`)**: fresh draft → top recommendation → one-click draft → keyboard search-to-draft → drafted players blocked → table drafting → **reload persistence** → undo/redo → snake board; all 13 pages render with live data; player what-if and copilot answer; ADP CSV import with unmatched reporting.

## Last verified run (2026-10-18)

- `npm run lint`: 0 problems
- `npm run test`: 67 passed
- `npm run test:db`: 8 passed
- `npm run test:e2e`: 4 passed (local mode); `npm run test:e2e:db`: 4 passed
- `npm run build`: success

Performance (engine smoke, Node 22, real dataset): context build ~4 ms; availability Monte Carlo (400 sims) ~140 ms; fast recommendations ~70 ms; strategy lab (56 builds × 12 runs) ~2.3 s in a worker; championship simulation ~4 ms per simulated draft+season, parallelised across up to 4 workers.
