/** Smoke-run the analytics engine on the bundled dataset and print timings. Run: npx tsx scripts/engine-smoke.ts */
import data from "../src/data/dataset.generated.json";
import type { Dataset } from "../src/lib/types";
import { DEFAULT_SETTINGS } from "../src/lib/league";
import { buildContext } from "../src/lib/engine/context";
import { EMPTY_DRAFT, applyDraftAction, type DraftState } from "../src/lib/engine/draft";
import { simulateAvailability } from "../src/lib/engine/availability";
import { recommend } from "../src/lib/engine/recommend";
import { evaluateStrategies, strategyAdvice } from "../src/lib/engine/strategy";
import { POLICY, simulateChampionship, summarise } from "../src/lib/engine/championship";
import { draftAlerts } from "../src/lib/engine/alerts";

const ds = data as unknown as Dataset;
const settings = { ...DEFAULT_SETTINGS, myPosition: 6 };
let draft: DraftState = EMPTY_DRAFT;
const shape = { teams: 12, rounds: 13, draftType: "snake" as const };
const t = (label: string, f: () => unknown) => { const s = performance.now(); const r = f(); console.log(`${label}: ${(performance.now() - s).toFixed(0)}ms`); return r; };

// Simulate 5 market picks so it's my turn at 6.
let ctx = buildContext({ players: ds.players, settings, draft });
for (let i = 0; i < 5; i++) {
  const r = applyDraftAction(draft, { type: "pick", playerId: ctx.available[i] }, shape);
  if (!r.ok) throw new Error(r.error);
  draft = r.state;
}
ctx = t("context", () => buildContext({ players: ds.players, settings, draft })) as typeof ctx;
const name = (id: string) => ctx.byId.get(id)!.name;
console.log("drafted:", draft.picks.map((p) => name(p.playerId)).join(", "), "| on clock team", ctx.onClock, "picksBeforeMyNext", ctx.picksBeforeMyNext);
const avail = t("availability 400", () => simulateAvailability(ctx, { sims: 400 })) as ReturnType<typeof simulateAvailability>;
const rec = t("recommend", () => recommend(ctx, avail)) as ReturnType<typeof recommend>;
console.log("baseline obj", rec.baselineObj.toFixed(3));
for (const c of rec.candidates.slice(0, 8)) console.log(`  ${name(c.id).padEnd(26)} gain ${c.gain.toFixed(3)} strat ${c.strategic.toFixed(3)} surv ${(c.survival * 100).toFixed(0)}% down ${c.downside.toFixed(3)} score ${c.score.toFixed(3)} vr ${c.valueRank} mr ${c.marketRank}`);
for (const [k, v] of Object.entries(rec.picks)) console.log(`  ${k}: ${name(v!.id)} — ${v!.why}`);
const strat = t("strategies x12", () => evaluateStrategies(ctx, { runs: 12 })) as ReturnType<typeof evaluateStrategies>;
console.log(strat.slice(0, 6).map((s) => `${s.label} ${s.meanObj.toFixed(3)} Δ${s.deltaVsBalanced.toFixed(3)}±${s.deltaSe.toFixed(3)}`).join("\n"));
console.log(strategyAdvice(strat, 1)?.message);
const cands = [POLICY, ...rec.candidates.slice(0, 4).map((c) => c.id)];
const ch = t("championship 5 cands x 200", () => simulateChampionship(ctx, { candidates: cands, sims: 200, seed: 7 })) as ReturnType<typeof simulateChampionship>;
const v = summarise(ch.tallies, 150);
console.log(v.label, "|", v.reason);
for (const s of v.summaries) console.log(`  ${name(s.id).padEnd(26)} P(champ) ${(s.pChamp * 100).toFixed(1)}% Δ ${(s.deltaChamp * 100).toFixed(1)}±${(s.deltaChampSe * 100).toFixed(1)} P(po) ${(s.pPlayoffs * 100).toFixed(0)}% finalObj ${s.meanFinalObj.toFixed(2)}`);
console.log("baseline P(champ)", ((v.baseline?.pChamp ?? 0) * 100).toFixed(1));
console.log(draftAlerts(ctx, rec).map((a) => `[${a.severity}] ${a.title}: ${a.detail}`).join("\n"));
