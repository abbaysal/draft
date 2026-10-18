# Research Notes: 9-Category Fantasy Basketball (2026-27)

Research conducted on 2026-10-18, two days before the 2026-27 season opens (Tue Oct 20 2026; the regular season ends Sun Apr 11 2027, per NBA.com / pr.nba.com). Several primary sites (nba.com, ESPN, Basketball-Reference, Hashtag Basketball, Basketball Monster, RotoWire, Yahoo) were **not reachable** from the build environment, so web-search summaries were used for news and context, and published GitHub datasets for statistics. Every claim below that came from search is attributed. Facts, estimates and assumptions are labelled.

## 1. Nine-category scoring

Categories: PTS, 3PM, REB, AST, STL, BLK, FG%, FT%, TO (lower is better).

| Format | What wins | Optimisation objective used here |
|---|---|---|
| H2H each category | Each category is a separate weekly W/L/T | Expected category wins per week vs the projected field |
| H2H most categories | One weekly W/L for winning ≥ 5 of 9 | Probability of winning the matchup (Poisson-binomial over category win probabilities) |
| Rotisserie | Season-total ranks per category | Expected roto points (1 + #opponents beaten, per category) |

These objectives differ materially. For example, in most-categories leagues, "winning big" in a category has no extra value, and punting is more natural. The engine never applies the same objective to all formats.

**Percentages are ratios of totals.** Team FG% = ΣFGM/ΣFGA. A player's contribution is therefore volume-dependent: impact = FGM − baseline% × FGA. This is industry-standard practice (Basketball Monster, Hashtag Basketball and similar tools use volume-weighted percentage z-scores) and is the only mathematically consistent approach.

**Per-game vs season totals.** H2H with daily lineups rewards per-game quality (you stream around absences). Roto and weekly-lineup leagues reward games played more. Both bases are supported, and availability always enters the matchup model through projected games.

**Daily vs weekly lineups, roster size, games limits, IL.** With daily lineups and ~10 starters out of 13 roster spots, most bench games still count. The model uses a bench-utilisation parameter (default 0.6, an assumption). A weekly games cap scales counted games proportionally. IL slots are not drafted.

**Fantasy playoffs** usually occupy the last 2–3 weeks of the NBA regular season. Schedule density in those weeks matters only for playoff teams and requires the actual schedule (import it).

## 2. Valuation methods

- **Z-scores** standardise each category over a pool of draftable players. Limitations: they treat categories as independent and equally scaled, and ignore week-to-week variance.
- **G-scores.** Rosenof (arXiv:2307.02188, "Static quantification of player value for fantasy basketball") shows that in H2H formats the right denominator includes within-player weekly variance: G = (μ − μ_pool)/√(σ²_between + σ²_within). Z-scores are the special case with known performance. The paper reports G-scores outperforming Z-scores in simulated H2H seasons. Volatile categories (steals especially) get less weight. The tool implements G-scores with within-player variance from Poisson/binomial assumptions (METHODOLOGY §3).
- **Dynamic / H-scoring.** Rosenof's follow-up (arXiv:2409.09884, "Dynamic quantification of player value…") adapts values to already-drafted players and remaining picks. Our marginal approach (gain in expected category wins for *this* roster against the *projected* field, with a lookahead) follows the same principle: value is roster-dependent.
- **Rotisserie.** arXiv:2501.00933 ("Optimizing for Rotisserie Fantasy Basketball") extends this to roto. The roto objective here uses pairwise season-total win probabilities.
- **Replacement level / VORP.** Value relative to the best freely available players (just outside the draftable pool) is what a pick actually adds.

## 3. Punt strategies: a critical assessment

- **Why punts work.** Removing a category lets you collect players whose value is concentrated elsewhere (e.g. punt FT% → elite bigs become cheaper). Retained-category z-sums rise.
- **Why they are overrated.** In H2H each-category you concede roughly one category every week. A double punt starts each week 0–2 and must win 5 of the remaining 7. Retained-category z-score gains overstate the benefit if the remaining categories are not *won* more often. Most-categories leagues reward punting more than each-category leagues.
- **Evidence-based approach used here.** Every strategy (balanced, 9 single, 36 double, selected triple, soft punts and custom weights) is simulated from the current draft state: opponents follow a market model, you follow the strategy, and the realised rosters are scored with the league's actual objective across **all** categories. Paired simulations give Δ vs balanced ± SE.
- **When to commit.** Expert consensus (RotoWire, Hashtag Basketball writers, community guides) is to stay flexible in the first two or three rounds and let the board steer you. The engine encodes this: it advises committing only after round 3, only when a build beats balanced by more than 2 SE, and multi-category punts only if they also beat the best single punt.
- **When to abandon a punt.** When the punted category's scarcity collapses (cheap strong contributors remain) or a different build overtakes it by a significant margin. The lab re-simulates after every pick.
- **Punting TO.** It looks attractive in z-score tables because high-usage stars carry high TO. The matchup model only rewards it if the extra production wins more of the other categories.

## 4. Scarcity, ADP and market inefficiency

- Scarcity is about *what remains*, not average category depth: supply share of the best remaining players, strong (z ≥ 1) contributors left, and the expected number surviving to your next pick.
- ADP is a market signal with a dispersion that widens later in drafts. Platform ADPs differ meaningfully in 2026-27, e.g. a Slamdex comparison (via search, 2026-10) showed Chet Holmgren ~25 Fantrax / ~28 Yahoo / ~64 ESPN, and Jalen Brunson 12.9 ESPN / 21.4 Yahoo / 31.4 Fantrax. Import the ADP of **your** platform.
- 2026-27 consensus early ADP (Slamdex, via search): Jokić 1.4, Wembanyama 2.3, Dončić 3.5, Gilgeous-Alexander 3.6. Our per-game 9-cat model ranks Jokić, Wembanyama and SGA as the top three, consistent with the market.
- A frequent inefficiency is the market valuing points and name recognition over category balance. For example, our model ranks Giannis (projected 65% FT on 9.6 FTA) far below his ADP in 9-cat. This is the "overvalued by ADP" case.

## 5. 2026-27 landscape (researched via web search, 2026-10-18)

The full list with sources is in `data/research/offseason_moves_2026.csv`. Highlights:

- Giannis Antetokounmpo traded MIL → MIA (with Bobby Portis). Tyler Herro, Kel'el Ware, Jaime Jaquez Jr. and Kasparas Jakučionis went to MIL (ESPN).
- Jaylen Brown traded BOS → PHI for Paul George and picks (official July 6, ESPN / Celtics).
- LeBron James signed with PHI (NBA.com). Kawhi Leonard traded LAC → TOR (completed Sept 14 after a league investigation), with Brandon Ingram and Gradey Dick to LAC (ESPN, CBC).
- Ja Morant traded MEM → POR, with Jerami Grant and Kris Murray to MEM. Walker Kessler sign-and-trade UTA → LAL.
- Free agency (single-source items marked medium confidence): Mitchell Robinson → BOS, Norman Powell → CHI, John Collins → DET, Tobias Harris → SAS, Rui Hachimura → LAC, Kelly Oubre Jr. → IND, Anfernee Simons → PHI, Julius Randle → BKN, Nic Claxton → CHI, among others.
- Injury returns: Tyrese Haliburton (cleared after the 2025 Finals Achilles injury), Damian Lillard, Kyrie Irving, Fred VanVleet and Jimmy Butler (ACL, ~9 months post-surgery in Sept). Jayson Tatum returned late in 2025-26 (16 games).
- Out or limited: Ariel Hukporti (Achilles, season), Shaedon Sharpe (meniscus, ~6 months), Donte DiVincenzo (Achilles), Dereck Lively II (foot), plus several short-term preseason injuries (Strus, Stewart, Nurkić, White, Harris, Claxton, F. Wagner).
- 2026 draft top 10: Dybantsa (WAS), Peterson (UTA), Boozer (MEM), Wilson (CHI), Wagler (LAC), Brown Jr. (BKN), Acuff Jr. (SAC), Flemings (ATL), Johnson Jr. (DAL), Burries (MIL). Rookies have **no projection** in the bundled data (no NBA statistics exist); import projections to rank them.

Sources disagreed on some dates and details. Conflicting items (e.g. Dean Wade's destination) are recorded but not applied.

## 6. Areas of expert disagreement

- **Z vs G scores** for H2H. G-scores are better supported by simulation evidence; many public rankings still use Z.
- **Early punting.** Some analysts endorse committing to punt FT% with a big-man first pick. Simulation-based analysis generally supports staying flexible.
- **Per-game vs total value.** Injury-prone stars are valued very differently by per-game (BBM default) and total (Yahoo default) rankings.
- **ADP differences across platforms** (§4) reflect different default formats (points vs categories).

## 7. Data limitations

- No licensed third-party projections were obtainable, so 2026-27 projections are model-generated estimates (METHODOLOGY §2).
- 2023-25 seasons lack shot attempts, so they were estimated (METHODOLOGY §2.3) and flagged.
- No ADP, official schedule or platform eligibility was obtainable. All three are import pathways.
- Position eligibility is derived from NBA listings (G/F/C), which can differ from Yahoo/ESPN eligibility.
- News is a static research snapshot (2026-10-18) plus optional RSS feeds and manual entry.

## 8. Implications for the algorithms

1. Value is roster- and format-dependent, so recommendations maximise the format's true objective for *this* roster against the projected field.
2. Percentages are volume-weighted everywhere.
3. Punts emerge from the objective (categories you can't win get no gradient) and are validated by simulation. They are never imposed by z-score sums.
4. Availability (survival to the next pick) and opportunity cost are explicit, via the two-pick lookahead.
5. Championship probability is the top-level metric, with an explicit statistical-separability check and a labelled fallback.

## Sources

- Rosenof, *Static quantification of player value for fantasy basketball*, arXiv:2307.02188 — https://arxiv.org/abs/2307.02188
- Rosenof, *Dynamic quantification of player value for fantasy basketball*, arXiv:2409.09884 — https://arxiv.org/abs/2409.09884
- *Optimizing for Rotisserie Fantasy Basketball*, arXiv:2501.00933 — https://arxiv.org/html/2501.00933v1
- NBA 2026-27 schedule announcement — https://pr.nba.com/2026-27-nba-regular-season-schedule/
- ESPN Giannis trade — https://www.espn.com/nba/story/_/id/49149967
- ESPN Brown–George trade — https://www.espn.com/nba/story/_/id/49241843/sources-celtics-sending-brown-76ers-george-picks
- NBA.com LeBron signing — https://www.nba.com/news/lebron-james-free-agency-sixers-2026
- ESPN Kawhi trade completed — https://www.espn.com/nba/story/_/id/49941983/clippers-raptors-complete-kawhi-leonard-trade-sources-say
- ESPN biggest injury returns 2026-27 — https://www.espn.com/nba/story/_/id/49827564/biggest-injury-returns-2026-27-nba-season-irving-haliburton-doncic-butler-lillard
- Fantasy Alarm injury report 2026-27 — https://www.fantasyalarm.com/articles/nba/fantasy-basketball-injury-report/nba-injury-report-heading-into-2026-27-season/197178
- Covers injury report — https://www.covers.com/sport/basketball/nba/injuries
- Olympics.com trade tracker — https://www.olympics.com/en/news/nba-trade-tracker-2026-live-free-agency
- CBS Sports free agency recap — https://www.cbssports.com/nba/news/nba-free-agency-2026-live-updates-trade-rumors-news-june-30/live/
- ClutchPoints FA trackers — https://clutchpoints.com/nba/nba-stories/nba-free-agency-2026-tracker
- NBA.com 2026 draft takeaways — https://www.nba.com/news/five-takeaways-2026-draft-1st-round
- Slamdex ADP comparison — https://slamdex.com/tools/adp/
- Yahoo ADP risers/fallers 2026-27 — https://sports.yahoo.com/articles/2026-27-fantasy-basketball-adp-074600811.html
- RotoWire 2026-27 category rankings — https://www.rotowire.com/basketball/
- NBA.com fantasy top 250 category rankings (requested starting resource; not reachable from the build environment) — https://www.nba.com/news/nba-fantasy-top-250-category-league-rankings
- 9cat.app rankings (requested starting resource; not reachable) — https://9cat.app/rankings/
