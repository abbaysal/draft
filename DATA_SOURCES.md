# Data Sources

All data used by the app, with provenance and limitations. Retrieval date for everything bundled: **2026-10-18**. Raw files are committed under `data/raw/`; their checksums are listed in `data/raw/MANIFEST.json` and displayed on the Data page.

| # | Name | URL | Season | Type | Licensing | Reliability | Refresh | Missing |
|---|---|---|---|---|---|---|---|---|
| 1 | NBA Stats API totals via **EasySportsApps/nba_api_25_26_data** | https://github.com/EasySportsApps/nba_api_25_26_data | 2025-26 regular season (complete) | Actual season totals: GP (W+L), MIN, 1/2/3-pt makes & attempts, OREB, DREB, AST, TOV, STL, BLK, PF; bio (team, position, birthdate, experience, height, weight); NBA person IDs | No license file. Statistics originate from stats.nba.com and are subject to NBA terms. Personal, non-commercial analytical use. | **High.** Cross-checked: Dončić 64 GP / 33.5 PPG / 7.7 RPG / 8.3 APG matches Land of Basketball. 582 rows; 6 rows lack weight only. | Static (season complete). Re-run the repo's script for updates. | Usage %, advanced stats, game logs; team = team at time of collection |
| 2 | **willccbb/nbabench-data** `data/2025/season.jsonl` | https://github.com/willccbb/nbabench-data | 2024-25 regular season | Per-game: GP, MPG, FG%, FT%, 3PM, REB, AST, STL, BLK, TO, PTS; ESPN ids | No license file. Facts/statistics. Personal use. | **Medium-high** (values consistent with known 2024-25 lines, e.g. SGA 32.7 PPG / 76 GP) | Static | **No FGA/FTA.** Attempts are estimated (METHODOLOGY §2.3) and flagged. The `team` field reflects the scrape-time team, so it is not used. |
| 3 | willccbb/nbabench-data `data/2024/season.jsonl` | same | 2023-24 | Same as #2 | Same | Medium-high | Static | Same as #2 |
| 4 | Researched offseason moves (`data/research/offseason_moves_2026.csv`) | ESPN, NBA.com, CBS Sports, ClutchPoints, Olympics.com, Bleacher Report (per row) | 2026 offseason | Team changes with type, date, confidence and source URL | Facts reported by news outlets; only short factual summaries stored | High/medium/low per row; conflicting items stored with `apply=false` | Manual (Data page overrides or edit CSV + `npm run data:build`) | Not exhaustive: depth-chart and role changes are not captured |
| 5 | Researched availability (`data/research/availability_2026-27.csv`) | NBC Sports, ESPN, Fantasy Alarm, Covers, RotoWire (per row) | 2026-27 preseason | Status, injury, games-missed estimate, estimate basis, confidence | Same as #4 | Mixed. Games-missed numbers are **assumptions** when no timeline was published (labelled in `estimate_basis`). | Manual or Data page overrides / news | Official injury reports start with regular-season games |
| 6 | 2026 draft top 10 (`data/research/rookies_2026.csv`) | NBA.com, Yardbarker | 2026 draft | Pick, team, college, position | Facts | High (sources agree on order; spellings vary) | Static | **No projections** (no NBA stats); import to rank |
| 7 | Biographical supplement (`data/research/player_metadata_supplement.csv`) | Public NBA.com bios (well-known facts) | — | Birthdates for 4 players absent from the 2025-26 file | Facts | Medium (verify) | Static | — |
| 8 | Slamdex ADP snapshot (search summary only, **not bundled**) | https://slamdex.com/tools/adp/ | 2026-27 | Top-4 average ADP (Jokić 1.4, Wembanyama 2.3, Dončić 3.5, SGA 3.6) | Not redistributed | Medium (search summary) | — | Full table not accessible; used only as a sanity check |
| 9 | 2026-27 NBA schedule | https://pr.nba.com/2026-27-nba-regular-season-schedule/ (PDFs on cdn.nba.com) | 2026-27 | Opening night Oct 20, last day Apr 11 2027 (used for fantasy week boundaries) | NBA | High | — | **Game-level schedule not retrievable here.** Import CSV (date,home,away). |
| 10 | Academic methodology | arXiv 2307.02188, 2409.09884, 2501.00933 | — | G-score and dynamic valuation methodology | arXiv | High | — | — |

## Requested starting resources

| Resource | Status |
|---|---|
| https://www.nba.com/news/nba-fantasy-top-250-category-league-rankings | Blocked from the build environment (network policy); not used |
| https://9cat.app/rankings/ | Blocked; not used |
| https://www.rotowire.com/basketball/ | Blocked for direct fetch; search summaries referenced in RESEARCH.md only |
| https://www.nbcsports.com/fantasy/ | Blocked for direct fetch; search summaries referenced for injury news |

Hashtag Basketball, Basketball Monster, ESPN, Yahoo and Basketball-Reference were also blocked. No access controls or paywalls were bypassed. Premium projections are **not** included. Use the CSV import system for any projections or ADP you are entitled to use.

## Ingestion pipeline (`scripts/build-dataset.ts`)

1. **Retrieval.** Raw files are committed with sha256 hashes.
2. **Identity reconciliation.** NBA person id is the primary key. ESPN-keyed seasons are matched by a normalised name key (diacritics, suffixes, punctuation, aliases). Duplicate keys disable name matching for that key and are reported.
3. **Schema validation.** Each source row is validated with Zod; invalid rows are logged and skipped, never guessed. For example, 6 rows of the 2025-26 file lack only weight, so the rows are kept and weight is left blank.
4. **Deduplication.** One player per NBA id.
5. **Normalisation.** Totals become per-game lines. Missing attempts are estimated and flagged per season.
6. **Projection.** WarRoom Projection Model v1, versioned `warroom-model-v1.0`.
7. **Output.** `src/data/dataset.generated.json` (bundled) and the database seed.
8. **Ranking recalculation and evidence tags.**
9. **Data-quality report.** `data/build-report.json`.
10. **Error logging.** Warnings and info entries go to the build report.

Runtime imports (Data page / `POST /api/import/:kind`) follow the same validate → match → report flow. Each projections or ADP import creates a **new immutable version**. Draft sessions keep the projection version they were created with (frozen snapshot for auditing). The scheduled refresh (`/api/cron/refresh`) only pulls URLs you configure (`PROJECTIONS_CSV_URL`, `ADP_CSV_URL`, `SCHEDULE_CSV_URL`, `NEWS_FEED_URLS`) and skips unchanged content by hash.

## NBA schedule 2026-27 (bundled)

- **File:** `data/research/nba_schedule_2026-27.csv` → `src/data/schedule.generated.json` (`npm run data:schedule`).
- **Source:** official NBA "2026-27 NBA Regular Season Schedule" PDF (as of August 13, 2026, subject to change), supplied by the user and transcribed verbatim (game number, date, home, away, neutral-site flag).
- **Coverage:** 1,200 of 1,230 games, 80 per team. The 30 Emirates NBA Cup knockout games (Dec 2026) are TBD and absent until the NBA publishes them, so the week of Dec 7–13 is under-counted.
- **Use:** default schedule whenever no schedule has been imported into the database. It drives weekly games, playoff-week games, back-to-backs and the day-by-day lineup on *Matchups & Lineup*. A CSV import (date, home, away) replaces it.
- **Matchup periods:** Yahoo merges the All-Star-break week (Feb 15–28, 2027) into one matchup, so the 25 calendar weeks map to 21 regular-season and 3 playoff matchups.
