# Methodology

Every number in the UI comes from the modules described here (`src/lib`). Constants are in code with comments, and anything marked *assumption* is a tunable modelling choice rather than an empirical estimate.

## 1. Data kinds

| Kind | Meaning | Where |
|---|---|---|
| actual | Observed NBA statistics (2025-26 totals, 2023-25 per game) | `Player.hist`, `SeasonStat` |
| estimate | Model-generated 2026-27 projection (WarRoom v1) | `Projection.kind = "estimate"` |
| projection | Imported third-party or custom projection | `Projection.kind = "projection"` |
| derived | z-scores, ranks, scarcity, recommendations | computed at runtime |
| simulated | Monte Carlo outputs | `SimulationResult` |

## 2. WarRoom Projection Model v1 (`src/lib/projection/model.ts`)

A transparent Marcel-style system:

1. **Per-minute rates** for 3PM, REB, AST, STL, BLK, TO, FGM, FGA, FTM and FTA, blended over up to three seasons with recency weights 6/3/1 multiplied by minutes played.
2. **Regression to the mean.** Add 400 "phantom" minutes (× latest weight) of the player's position-group league rate (G/F/C, computed from 2025-26 players with ≥ 500 minutes).
3. **Shooting percentages.** FG% = (weighted FGM + 150 phantom attempts × league FG%) / (weighted FGA + 150). FT% uses 100 phantom attempts. Low-volume hot shooting is regressed strongly; high-volume shooters keep their percentage.
   - **2.3 Attempts for seasons without attempts.** Since PTS = 2·FGM + 3PM + FTM, FGM = FG%·FGA and FTA = r·FGA, we get FGA = (PTS − 3PM)/(2·FG% + FT%·r). Here r is the player's own 2025-26 FTA/FGA ratio, or the position-group ratio if unavailable. These seasons are flagged.
4. **Age adjustment** (assumption, consistent with published aging curves that peak around 26–28) on production rates, not percentages: ≤21 +6%, 22 +5%, 23 +4%, 24 +3%, 25 +2%, 26 +1%, 27–29 0, 30 −1%, 31 −2%, 32 −3%, 33 −4.5%, 34 −6%, 35+ −8%.
5. **Minutes.** Games-weighted MPG (6/3/1), +1.0 for age ≤ 22, −1.5 for age ≥ 34, clamped to [4, 38]. Team changes do **not** change minutes (no depth-chart data); they widen uncertainty instead.
6. **Games.** Recency-weighted GP regressed toward 68 with weight 1.5 seasons, capped at 79, then multiplied by (1 − researched games missed / 82).
7. **Points** are derived from the identity 2·FGM + 3PM + FTM, so the line is internally consistent.
8. **Uncertainty.** CV = 0.06 + 0.5/√(1 + minutes/150), plus 0.04 for a new team, 0.06 for no 2025-26 games, 0.04 if returning from or out with injury, and 0.03 for age ≤ 22. The SD of each per-game stat is mean × CV. Shooting SD is the binomial SE of the regressed estimate. Games SD = 7 + 0.18·(82 − GP), plus 5 if not healthy. Confidence = 1 − 1.6·CV, clamped.

A sample of fewer than 150 total minutes gets **no projection** (never invented). Rookies have no projection.

## 3. Valuation (`valuation.ts`)

- Raw category values per game (or × GP for the season basis). FG and FT impact = makes − baseline% × attempts.
- **Draftable pool.** Value everyone, keep the top N = teams × min(rounds, roster + IL), and recompute means, SDs and the pool baseline percentages (Σmakes/Σattempts of the pool) until membership stabilises (≤ 4 iterations).
- z = direction × (x − μ)/σ, with turnovers reversed.
- **G-score.** z × σ_b/√(σ_b² + σ_w²), where σ_w² is the mean within-player weekly variance on the per-game scale. Counting: φ·μ/gamesPerWeek with φ = PTS 2.2, 3PM 1.0, REB 1.15, AST 1.1, STL 1.0, BLK 1.3, TO 1.0 (assumptions: Poisson-like game-to-game dispersion, overdispersed for points and blocks). Percentages use the binomial att·p(1−p)·φ.
- The **baseline is frozen per league configuration.** Punts and soft weights only re-weight category z's, so they cannot re-scale the remaining categories.
- **Replacement level** = mean value of the 12 players ranked just outside the pool. VORP = total − replacement.

Population alternatives (all players, position-specific) are supported by the `population` option. *All draftable* is the default because it matches who is actually drafted. *All players* inflates the value of every rostered player. *Position-specific* pools double-count scarcity that the lineup model already handles.

## 4. Draft state (`draft.ts`)

A pure reducer with pick, undo, redo, edit (correction) and setOwner (traded pick) actions. It validates snake order, ownership, duplicates and completion. The server applies the same reducer inside a transaction (see DATABASE_SCHEMA.md).

## 5. Team and matchup model (`team.ts`)

For each player, expected counted games in a week are e = n·q, where n = scheduled games and q = (projected GP/82) × lineup usage. Lineup usage is 1 for the top S players by value (S = starting slots) and the bench-utilisation setting (default 0.6, assumption) for daily leagues, or 0 for weekly leagues.

- Counting category: mean Σe·μ; variance Σ(e·φ·μ + Var(G)·μ²) + Σ(e·sd_μ)² (projection uncertainty).
- Percentages: p_T = ΣE[makes]/ΣE[attempts]; the variance uses the delta method on (makes − p_T·attempts), including binomial shot noise, attempt-volume noise, games noise and projection uncertainty.
- P(A beats B in a category) = Φ(direction·(μ_A − μ_B)/√(V_A + V_B)).
- Each-category objective: mean over opponents of Σ_c P_c. Most-categories: P(more category wins than losses), via the Poisson-binomial (an exact tie counts ½). Roto: Σ_c (1 + Σ_opp P(beat opp)).
- A weekly games cap scales counted games proportionally (slightly understates capped teams, which start their best options).

## 6. Projected field and fast recommendations (`recommend.ts`)

- **Projected final rosters.** Current picks plus *expected fills*: the k-th future pick is the average contribution of available players around market position k (window ±3), with starter or bench usage by roster position.
- **gain(X)** = Obj(my roster + X + fills for my remaining picks) − Obj(my roster + fills). This is relative to the expected player at the slot.
- **Two-pick lookahead (pick now vs wait).** For the top 18 candidates X and top 26 candidates Y: strategic(X) = E_s[max over Y available in sample s of Obj(roster + X + Y + fills)] − baseline. The expectation runs over the joint availability samples (§7).
- **Risk.** downside(X) = Obj − Obj with X at P10 games and P10 production; upside is the P90 counterpart. On the clock, score = strategic − λ·downside (λ = league risk aversion, default 0.25). Off the clock, score = P(survive to my pick) × (gain − λ·downside): if he's gone you get the expected slot player, whose improvement is 0 by construction.
- **Labelled lenses.** Best overall = league value rank. Best fit = max gain. Best strategic = max score. Value vs ADP needs imported ADP. Scarcity = gains weighted by scarcity index. Upside = gain + upside. Low risk = best gain − downside among confidence ≥ 0.65 healthy players.

## 7. Opponent model and availability (`market.ts`, `availability.ts`)

Each opponent pick takes the argmin of the perceived rank r̃ = market rank + σ(r)·Z − κ·tilt·z + need penalties:

- σ(r) = a + b·r (defaults a = 2, b = 0.16; assumption informed by ADP dispersion growing with ADP).
- tilt = the team's observed per-category z mean minus the league's, shrunk by n/(n+6) so a few picks cannot dominate. κ = 3 ranks per unit.
- Need penalties: +1000 if the team must fill open starting slots with its remaining ≤ 4 picks and the player can't; +8 for a 4th pure center.
- Candidates are restricted to the next 40 available by market order.

**Market rank.** Uses imported ADP. Without ADP it uses a **market proxy** = 0.6 × value rank + 0.4 × points rank (assumption: the market over-weights scoring), labelled in the UI. Availability Monte Carlo: 300–500 seeded simulations of the opponent picks before my next pick. It gives survival probabilities, expected draft positions, per-team pick predictions, and joint samples for the lookahead.

## 8. Championship model (`championship.ts`)

For each candidate (and the default **policy** pick) and each simulation s, the same seed is used (common random numbers):

1. **Remaining draft.** Opponents follow §7. My later picks follow a linearised marginal policy: score = Σ_c ∂E[win_c]/∂μ_c × Δμ_c(player) against the projected field, with forced positional feasibility near the end.
2. **Season draws per player.** GP ~ N(gp, gpSd) clipped to [0, 82]; production multiplier ~ N(1, CV); FG%/FT% shocks from projection SD.
3. **Regular season.** Round-robin pairings over the configured weeks. Weekly category totals ~ N(mean, var), with a shared team-week games shock (SD 7%) that correlates counting categories. Standings are category wins (each-category) or matchup wins (most-categories).
4. **Playoffs.** Top P seeds, byes for the top seeds when P is not a power of two, one playoff week per round using that week's schedule, and ties going to the higher seed. Roto ranks season totals instead.

Outputs: P(title), P(playoffs), the final-roster objective distribution, and Δ vs the policy pick with a paired SE.

**Verdict (fallback hierarchy).** Level 0 if the best candidate's Δ title beats the second-best by > 1.96 paired SE (≥ 200 sims). Otherwise Level 1 if Δ playoffs separates them. Otherwise Level 2 (the fast metric). The UI always shows the level and the reason.

**Known bias.** My future picks use the optimiser while opponents follow the market, so absolute title odds are optimistic for me. Deltas between candidates are the meaningful output.

## 9. Strategy engine (`strategy.ts`)

A strategy = weights w_c ∈ {0, 0.4, 0.5, 1}. My picks take the best available by Σw_c·z_c (per-game value discounted by min(1, GP/72) for availability), with positional feasibility. Each strategy is completed R times from the current state with common random numbers and scored with the true objective over all categories. Δ vs balanced uses a paired SE. **Commitment rule:** commit only if Δ > 2 SE, past round 3, and multi-category punts also beat the best single or soft punt. Flexibility = number of builds within tolerance (0.1·SD + 0.02) of the best.

## 10. Scarcity, risk, playoffs, alerts, tags

- **Scarcity** (`scarcity.ts`): supply share of the best remaining (picks-left) players vs draft start, strong (z ≥ 1) contributors left, expected strong contributors at my next pick, and scarcity index = mean share / share. Positional scarcity counts eligible players above replacement.
- **Risk** (`risk.ts`): availability (GP history plus current status), games SD, projection CV, and role (team change, missed season, ±6 MPG swing, age ≤ 21) are kept as **separate** dimensions. No medical probabilities are invented. Portfolio risk is a joint simulation of the roster's season value.
- **Playoffs** (`playoffs.ts`): nominal scheduled games vs expected counted games (× availability). Back-to-backs are shown as congestion only, with no rest assumed. Playoff-adjusted value = value × playoff games / (regular-season games per week × weeks).
- **Alerts** (`alerts.ts`): falling value (value rank ≥ 15 ahead of the pick), ADP outperformers (real ADP only, ≥ 25 spots), scarce category where I'm weak (index ≥ 1.35 and win% < 50%), imbalance (≥ 3 categories < 30%), a top-5 target with < 25% survival, poor fit (best-value player ranked ≥ 9th for me), thin positions, risk concentration (≥ 40% of the roster high-risk), and news for top available players. Deduplicated and capped at 8; each alert shows its trigger.
- **Tags** (`tags.ts`): elite anchor, balanced, specialist (excluding TO), breakout (age ≤ 25 with +4 MPG / +3 PRA-per-36 / vacated usage ≥ 12 FGA), regression (FG% +4 pts on ≥ 8 FGA, FT% +6 pts on ≥ 3 FTA vs prior seasons, age ≥ 33), bounce-back, high-risk, stable, new team, returning injury, rookie without projection. Each tag carries evidence and a confidence level.

## 11. Copilot (`copilot.ts`, `/api/copilot`)

The engine builds a JSON fact sheet (league, draft position, roster, category win rates, top candidates with scores and impacts, lenses, survivors, scarcity, strategies, championship verdict, opponents, data caveats). Without an API key, deterministic templates answer the standard questions. With `ANTHROPIC_API_KEY`, Claude Opus 5.5 (low effort for speed, server-side refusal fallback enabled) explains the fact sheet under a system prompt that forbids inventing numbers. The engine's answer is always shown first; the AI explanation is appended and labelled.
