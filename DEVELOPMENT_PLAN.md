# Development Plan & Progress

Status as of 2026-10-18. ✅ = implemented and verified by tests or browser runs. ◐ = implemented with documented limitations.

## Stage 1: Research ✅
- ✅ 9-cat formats, valuation literature (Z/G/dynamic), punt analysis, scarcity, ADP → RESEARCH.md
- ✅ 2026 offseason moves, injuries, rookies with sources → `data/research/*.csv`
- ◐ Primary fantasy sites blocked from the environment, so web-search summaries and GitHub datasets were used (documented)

## Stage 2: Data architecture ✅
- ✅ Prisma schema, migration, idempotent seed, immutable projection sets, overrides, audit
- ✅ Build pipeline: validation, identity matching, dedupe, normalisation, projections, report
- ✅ CSV import system (projections / ADP / schedule / metadata / history) with aliases, dry runs, versioning, consensus
- ◐ No bundled ADP, schedule or platform eligibility (not obtainable); import pathways provided

## Stage 3: Quantitative engine ✅
- ✅ Z/G-scores, volume-weighted percentages, frozen baselines, punts, replacement level, roster aggregation (unit-tested)

## Stage 4: Core website ✅
- ✅ Design system (dark, dense), Players DB, player profiles, Punt Lab, Team Analyzer, Library

## Stage 5: Live draft ✅
- ✅ League settings and presets (BİLLUR CUP), snake board, picks, undo/redo, corrections, traded picks, auto-save, restore, export/import, multiple sessions, keyboard shortcuts
- ✅ Server persistence with optimistic concurrency, an offline queue, and a local-mode fallback

## Stage 6: Decision intelligence ✅
- ✅ Marginal roster value, two-pick lookahead, scarcity, availability Monte Carlo, opponent analysis, alerts

## Stage 7: Advanced modelling ✅
- ✅ Weekly matchup model, championship Monte Carlo with CRN and fallback verdict, strategy engine, risk and portfolio, playoff analytics, mock simulator with distributions
- ◐ Playoff schedule analysis needs an imported schedule (uniform until then)

## Stage 8: AI assistant ✅
- ✅ Grounded fact sheet; deterministic explainer; Claude Opus 5.5 integration (optional key) with server-side refusal fallbacks

## Stage 9: QA ✅
- ✅ 67 unit tests, 8 Postgres integration tests, 4 Playwright end-to-end tests (local and DB modes); lint with 0 warnings; production build

## Stage 10: Delivery ✅
- ✅ README with Vercel deployment and checklist; `.env.example`; `vercel.json` (build command + cron)

## Next steps (recommended)
1. Import your platform's ADP (Yahoo) and position eligibility before drafting.
2. Import the 2026-27 schedule CSV for playoff-week analytics.
3. Import one or more external projection sets and build a consensus.
4. Calibrate the dispersion constants (φ) from 2025-26 game logs if they become available.
