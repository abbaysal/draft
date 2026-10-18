import { Panel } from "@/components/ui";

const SECTIONS: { title: string; body: string[]; cites?: { label: string; url: string }[] }[] = [
  {
    title: "Nine-category scoring",
    body: [
      "Standard 9-cat: PTS, 3PM, REB, AST, STL, BLK, FG%, FT%, TO (lower is better). In head-to-head each-category every category is a separate weekly win; in most-categories only the 5-of-9 majority matters; rotisserie ranks season totals.",
      "Because each category counts equally, a player's value is the sum of his contribution across categories — but contributions only matter if they change whether you win a category. That is why this tool optimises expected category wins (or matchup / title probability), not raw z-score sums.",
    ],
  },
  {
    title: "Z-scores and G-scores",
    body: [
      "Z = (projection − pool mean) / pool SD, computed over the draftable pool (teams × roster spots) chosen iteratively. Turnovers are reversed. The baseline is frozen per league configuration so punting re-weights categories without re-centering them.",
      "G-scores (Rosenof) add within-player week-to-week variance to the denominator. In H2H, volatile categories such as steals are less controllable week to week, so their weight shrinks. Choose G-scores for H2H on the League page.",
    ],
    cites: [
      { label: "Rosenof, “Static quantification of player value for fantasy basketball” (arXiv:2307.02188)", url: "https://arxiv.org/abs/2307.02188" },
      { label: "Rosenof, “Dynamic quantification of player value for fantasy basketball” (arXiv:2409.09884)", url: "https://arxiv.org/abs/2409.09884" },
    ],
  },
  {
    title: "Shooting-volume weighting",
    body: [
      "FG% and FT% are team ratios: Σmakes ÷ Σattempts. A 60% shooter on 20 FGA moves your team FG% far more than a 60% shooter on 4 FGA. Impact = makes − league% × attempts captures this; it is standardised like any other category.",
      "Never average individual percentages. All team percentages in this app aggregate makes and attempts.",
    ],
  },
  {
    title: "Punting",
    body: [
      "Punting deliberately concedes a category to over-invest in the rest. It can raise retained-category strength, but in H2H each-category you start every week 0-1 in the punted category, and double/triple punts leave very little margin. The Punt Lab evaluates builds with the league's true objective over all categories, so a punt only wins when it produces more expected category wins.",
      "Commitment rule: the engine advises committing only when a build beats balanced by more than 2 standard errors, after round 3, and (for multi-category punts) only if it also beats the best single punt. Common pairings: punt FT% with big men, punt FG%/blocks with guards, punt turnovers with high-usage creators.",
    ],
  },
  {
    title: "Scarcity and replacement value",
    body: [
      "Replacement level is the average value of the players just outside the draftable pool — what you can get for free. Value over replacement (VORP) is what a pick actually adds.",
      "Category scarcity is measured on the remaining pool after every pick: share of the draft-start supply left among the best remaining players, number of strong (z ≥ 1) contributors left, and how many of them are expected to survive to your next pick.",
    ],
  },
  {
    title: "ADP, opportunity cost and pick-now-vs-wait",
    body: [
      "ADP describes the market, not value. The opponent model treats every team's perceived rank as ADP plus noise whose spread grows later in the draft, plus positional need and (shrunk) observed category tendencies.",
      "The fast recommendation compares the expected outcome of taking X now and the best player likely to survive to your next pick, averaged over Monte Carlo opponent behaviour. That is exactly the opportunity cost of waiting.",
    ],
  },
  {
    title: "Championship probability",
    body: [
      "The deep model simulates the remaining draft, a round-robin regular season with weekly variance and injuries, and a seeded playoff bracket. Candidate picks share the same random scenarios (common random numbers) so differences are low-noise.",
      "Fallback hierarchy: Δ championship probability → Δ playoff probability → expected category outcomes, always labelled. Absolute title odds are model-dependent; rely on differences.",
    ],
  },
  {
    title: "Injury risk",
    body: [
      "Availability risk comes from games-played history and researched current status; projection risk from sample size; role risk from team changes, long absences and minutes swings. No medical probabilities are invented.",
      "Portfolio risk simulates the roster jointly: several fragile players can produce a much worse P10 outcome than a balanced roster with the same mean.",
    ],
  },
  {
    title: "Balanced rosters and draft simulation",
    body: [
      "Early in drafts, flexibility has value: players strong in many categories keep more builds open. The strategy engine reports how many builds are within tolerance of the best — a direct measure of flexibility.",
      "The Mock Draft Simulator shows the distribution of outcomes (P10/P50/P90, finish, title odds), not just averages, and lets you compare two options with paired simulations.",
    ],
  },
];

export default function LibraryPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">Strategy Research Library</h1>
      <div className="grid gap-3 xl:grid-cols-2">
        {SECTIONS.map((s) => (
          <Panel key={s.title} title={s.title}>
            <div className="space-y-2 text-sm leading-relaxed text-ink/90">
              {s.body.map((b) => (
                <p key={b.slice(0, 20)}>{b}</p>
              ))}
              {s.cites && (
                <ul className="text-xs text-mute">
                  {s.cites.map((c) => (
                    <li key={c.url}>
                      ↳{" "}
                      <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                        {c.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        ))}
      </div>
      <p className="text-xs text-dim">Full research notes, source list and methodology live in RESEARCH.md, DATA_SOURCES.md and METHODOLOGY.md in the repository.</p>
    </div>
  );
}
