/**
 * Copilot grounding. The analytics engine computes everything; this module turns
 * the computed state into (a) a compact JSON "fact sheet" sent to the language
 * model and (b) deterministic, template-based answers used when no AI key is
 * configured. The LLM explains numbers — it never produces them.
 */
import { CAT_BY_KEY } from "./categories";
import { FORMAT_LABEL } from "./league";
import type { AnalysisContext } from "./engine/context";
import type { RecommendationSet } from "./engine/recommend";
import type { StrategyAdvice, StrategyResult } from "./engine/strategy";
import type { ChampionshipVerdict } from "./engine/championship";
import type { TeamProfile } from "./engine/opponents";

export interface CopilotFacts {
  league: { teams: number; format: string; categories: string[]; myPosition: number; rounds: number };
  draft: { overall: number; round: number; onClock: string; myTurn: boolean; myNextPicks: number[]; picksBeforeMyNext: number };
  dataNotes: string[];
  myRoster: { name: string; team: string; pos: string; valueRank: number | null }[];
  myCategoryWinProb: Record<string, number>;
  objective: { name: string; baseline: number; metric: string };
  candidates: {
    name: string;
    team: string;
    valueRank: number;
    marketRank: number;
    adp: number | null;
    gain: number;
    strategic: number;
    survivalToNextPick: number;
    downside: number;
    upside: number;
    catImpactPct: Record<string, number>;
    risk: string[];
    tags: string[];
  }[];
  labelledPicks: Record<string, { name: string; why: string }>;
  likelySurvivors: { name: string; survival: number }[];
  scarcity: { cat: string; supplyLeftPct: number; strongLeft: number; index: number }[];
  strategy: { advice: string | null; top: { label: string; deltaVsBalanced: number; se: number }[] } | null;
  championship: { level: string; reason: string; rows: { name: string; pChamp: number; deltaChamp: number; deltaSe: number; pPlayoffs: number }[] } | null;
  opponents: { team: string; inferredPunts: string[]; strengths: string[]; openSlots: string[] }[];
}

const pct = (x: number) => Math.round(x * 1000) / 10;

export function buildFacts(
  ctx: AnalysisContext,
  rec: RecommendationSet,
  extra: { advice?: StrategyAdvice | null; strategies?: StrategyResult[] | null; verdict?: ChampionshipVerdict | null; profiles?: TeamProfile[] | null } = {},
): CopilotFacts {
  const name = (id: string) => ctx.byId.get(id)?.name ?? id;
  const s = ctx.settings;
  const dataNotes = [
    ctx.players.some((p) => p.proj?.kind === "estimate") ? "Projections include model-generated estimates (WarRoom model v1), not third-party projections." : "",
    ctx.marketSource === "proxy" ? "No ADP imported: opponent behaviour uses a heuristic market proxy." : `Market order from imported ADP (${ctx.marketSource}).`,
    ctx.schedule.source === "uniform" ? "No NBA schedule imported: uniform games per week." : "NBA schedule imported.",
    "Position eligibility is derived from NBA listed positions unless imported.",
  ].filter(Boolean);
  return {
    league: { teams: s.teams, format: FORMAT_LABEL[s.format], categories: s.categories.map((c) => CAT_BY_KEY[c].short), myPosition: s.myPosition, rounds: s.rounds },
    draft: {
      overall: ctx.overall,
      round: Math.floor((ctx.overall - 1) / s.teams) + 1,
      onClock: ctx.onClock >= 0 ? s.teamNames[ctx.onClock] : "draft complete",
      myTurn: ctx.onClock === ctx.myIndex,
      myNextPicks: ctx.myNextPicks.slice(0, 3),
      picksBeforeMyNext: ctx.picksBeforeMyNext,
    },
    dataNotes,
    myRoster: ctx.rosters[ctx.myIndex].map((id) => {
      const p = ctx.byId.get(id)!;
      return { name: p.name, team: p.team, pos: p.elig.join("/"), valueRank: ctx.values.get(id)?.rank ?? null };
    }),
    myCategoryWinProb: Object.fromEntries(ctx.cats.map((c) => [CAT_BY_KEY[c].short, pct(rec.field.baseline.perCategory[c])])),
    objective: { name: rec.objectiveName, baseline: Math.round(rec.baselineObj * 1000) / 1000, metric: rec.metricName },
    candidates: rec.candidates.slice(0, 8).map((c) => {
      const p = ctx.byId.get(c.id)!;
      return {
        name: p.name,
        team: p.team,
        valueRank: c.valueRank,
        marketRank: c.marketRank,
        adp: c.adp,
        gain: Math.round(c.gain * 1000) / 1000,
        strategic: Math.round(c.strategic * 1000) / 1000,
        survivalToNextPick: pct(c.survival),
        downside: Math.round(c.downside * 1000) / 1000,
        upside: Math.round(c.upside * 1000) / 1000,
        catImpactPct: Object.fromEntries(Object.entries(c.catImpact).map(([k, v]) => [CAT_BY_KEY[k as keyof typeof CAT_BY_KEY].short, pct(v)])),
        risk: [p.availability && p.availability.status !== "HEALTHY" ? `${p.availability.status}: ${p.availability.injury ?? ""}` : "", p.proj && p.proj.confidence < 0.55 ? `projection confidence ${pct(p.proj.confidence)}%` : ""].filter(Boolean),
        tags: p.tags.map((t) => t.label),
      };
    }),
    labelledPicks: Object.fromEntries(Object.entries(rec.picks).map(([k, v]) => [k, { name: name(v!.id), why: v!.why }])),
    likelySurvivors: rec.likelySurvivors.map((x) => ({ name: name(x.id), survival: pct(x.survival) })),
    scarcity: rec.scarcity.map((x) => ({ cat: x.label, supplyLeftPct: pct(x.supplyShare), strongLeft: x.strongLeft, index: Math.round(x.scarcityIndex * 100) / 100 })),
    strategy: extra.strategies
      ? { advice: extra.advice?.message ?? null, top: extra.strategies.slice(0, 5).map((r) => ({ label: r.label, deltaVsBalanced: Math.round(r.deltaVsBalanced * 1000) / 1000, se: Math.round(r.deltaSe * 1000) / 1000 })) }
      : null,
    championship: extra.verdict
      ? { level: extra.verdict.label, reason: extra.verdict.reason, rows: extra.verdict.summaries.slice(0, 6).map((r) => ({ name: name(r.id), pChamp: pct(r.pChamp), deltaChamp: pct(r.deltaChamp), deltaSe: pct(r.deltaChampSe), pPlayoffs: pct(r.pPlayoffs) })) }
      : null,
    opponents: (extra.profiles ?? [])
      .filter((p) => p.index !== ctx.myIndex)
      .map((p) => ({ team: p.name, inferredPunts: p.inferredPunts.map((x) => `${CAT_BY_KEY[x.cat].short} (${x.confidence})`), strengths: p.strengths.map((c) => CAT_BY_KEY[c].short), openSlots: p.openSlots })),
  };
}

export const COPILOT_SYSTEM_PROMPT = `You are the draft copilot inside an NBA 9-category fantasy basketball draft tool.
You receive a JSON fact sheet computed by the tool's analytics engine (projections, matchup model, Monte Carlo simulations).
Rules:
- Use only the numbers and names in the fact sheet. Never invent statistics, projections, ADP, injuries or probabilities. If something needed is missing, say it is not available.
- The engine's primary recommendation is the first candidate (highest strategic score); championship deltas override it only when the fact sheet's championship level is "Level 0". Explain, don't overrule, the model.
- Distinguish best player overall, best fit for this roster, and best strategic pick right now.
- Mention relevant data caveats from dataNotes when they affect the answer (for example model-generated projections or missing ADP).
- Format: one or two sentence answer first, then a short "Why" list with the key numbers, then optionally "Watch out" for risks. Keep it under 180 words unless asked for detail.`;

/** Deterministic answers (no AI key required). */
export function answerDeterministic(question: string, f: CopilotFacts): string {
  const q = question.toLowerCase();
  const top = f.candidates[0];
  const alt = f.candidates[1];
  const weakest = Object.entries(f.myCategoryWinProb).sort((a, b) => a[1] - b[1]);
  const strongest = [...weakest].reverse();
  const impact = (c: CopilotFacts["candidates"][number]) =>
    Object.entries(c.catImpactPct)
      .filter(([, v]) => Math.abs(v) >= 0.5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v.toFixed(1)}`)
      .join(", ");
  const caveat = f.dataNotes.length ? `\n\n_Data notes: ${f.dataNotes.join(" ")}_` : "";
  if (!top) return "No candidates available — the draft may be complete.";
  const why = (c: CopilotFacts["candidates"][number]) =>
    `- Strategic score ${c.strategic >= 0 ? "+" : ""}${c.strategic.toFixed(3)} on ${f.objective.name.toLowerCase()} (immediate fit ${c.gain >= 0 ? "+" : ""}${c.gain.toFixed(3)})\n- Category win-% impact: ${impact(c) || "small"}\n- ${c.survivalToNextPick.toFixed(0)}% chance he is still there at your next pick\n- League value rank #${c.valueRank}${c.adp != null ? `, ADP ${c.adp}` : `, market proxy #${c.marketRank}`}${c.risk.length ? `\n- Risk: ${c.risk.join("; ")}` : ""}`;

  if (/punt|strategy|build/.test(q)) {
    const s = f.strategy;
    if (!s) return "Strategy simulations have not finished yet — open the Punt Strategy Lab or wait for the background run." + caveat;
    return `**${s.advice ?? "No strong signal."}**\n\nTop builds vs balanced (expected-outcome delta ± SE):\n${s.top.map((t) => `- ${t.label}: ${t.deltaVsBalanced >= 0 ? "+" : ""}${t.deltaVsBalanced} ± ${t.se}`).join("\n")}\n\nYour weakest categories now: ${weakest.slice(0, 3).map(([k, v]) => `${k} (${v}%)`).join(", ")}.` + caveat;
  }
  if (/weak|strength|categor/.test(q))
    return `**Weakest:** ${weakest.slice(0, 3).map(([k, v]) => `${k} ${v}%`).join(", ")}. **Strongest:** ${strongest.slice(0, 3).map(([k, v]) => `${k} ${v}%`).join(", ")}.\n\n(Projected weekly category win rate of your projected final roster vs the field.)` + caveat;
  if (/next round|available next|still be there|survive|wait/.test(q))
    return `Likely to survive to your next pick (#${f.draft.myNextPicks[f.draft.myTurn ? 1 : 0] ?? "—"}):\n${f.likelySurvivors.map((x) => `- ${x.name}: ${x.survival}%`).join("\n") || "- none of the top candidates are likely to survive"}\n\nTop candidates at risk: ${f.candidates.filter((c) => c.survivalToNextPick < 40).slice(0, 3).map((c) => `${c.name} (${c.survivalToNextPick}%)`).join(", ") || "none"}.` + caveat;
  if (/reach/.test(q)) {
    const reach = f.candidates.find((c) => c.marketRank > f.draft.overall + 10);
    return reach
      ? `**${reach.name}** is ranked #${reach.marketRank} by the market but helps you now (${reach.strategic.toFixed(3)}). He has a ${reach.survivalToNextPick}% chance to survive to your next pick — ${reach.survivalToNextPick > 60 ? "you can probably wait" : "reaching is justified if he is your target"}.` + caveat
      : "None of the top candidates is a meaningful reach relative to market order." + caveat;
  }
  if (/upside|consisten|safe|risk/.test(q)) {
    const up = f.labelledPicks.bestUpside;
    const safe = f.labelledPicks.bestLowRisk;
    return `**Upside:** ${up?.name ?? "n/a"} — ${up?.why ?? ""}\n**Consistency:** ${safe?.name ?? "n/a"} — ${safe?.why ?? ""}\n\nThe main recommendation already subtracts a risk penalty; prefer upside when you are behind the projected field, consistency when ahead.` + caveat;
  }
  if (/playoff|champion/.test(q)) {
    const c = f.championship;
    if (!c) return "The championship simulation has not finished yet. It runs in the background on the Decision Center." + caveat;
    return `**${c.level}** — ${c.reason}\n\n${c.rows.map((r) => `- ${r.name}: P(title) ${r.pChamp}% (Δ ${r.deltaChamp >= 0 ? "+" : ""}${r.deltaChamp} ± ${r.deltaSe}), P(playoffs) ${r.pPlayoffs}%`).join("\n")}` + caveat;
  }
  if (/complement|pair|fit/.test(q)) {
    const fit = f.labelledPicks.bestFit;
    return `**Best roster fit: ${fit?.name ?? top.name}.** ${fit?.why ?? ""}\n\nYour roster: ${f.myRoster.map((r) => r.name).join(", ") || "empty"}.` + caveat;
  }
  if (/alternative|instead|backup|second/.test(q) && alt) return `**Best alternative: ${alt.name}.**\n${why(alt)}` + caveat;
  return `**Draft ${top.name}** (${top.team}).\n\n**Why**\n${why(top)}${alt ? `\n\n**Alternative:** ${alt.name} (strategic ${alt.strategic.toFixed(3)}, ${alt.survivalToNextPick}% survival)` : ""}\n\nMetric: ${f.objective.metric}.` + caveat;
}
