"use client";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CandidateTable, MetricBanner, TopPickCard, usePrimaryRanking } from "@/components/recs";
import { AlertsPanel, CategoryOutlook, InjuryWatch } from "@/components/panels";
import { useEngineContext, useFast, useStrategies } from "@/client/analysis";
import { useStore } from "@/client/store";
import { Badge, Panel, Spinner } from "@/components/ui";
import { PlayerLink } from "@/components/player";
import { POLICY } from "@/lib/engine/championship";

function ChampionshipComparison() {
  const pr = usePrimaryRanking();
  const ctx = useEngineContext();
  const champ = useStore((s) => s.champ);
  const data = useMemo(() => {
    if (!pr?.champ?.verdict || !ctx) return [];
    return pr.champ.verdict.summaries.map((s) => ({
      name: ctx.byId.get(s.id)?.name.split(" ").slice(-1)[0] ?? s.id,
      delta: +(s.deltaChamp * 100).toFixed(2),
      err: +(1.96 * s.deltaChampSe * 100).toFixed(2),
      p: +(s.pChamp * 100).toFixed(1),
      po: +(s.pPlayoffs * 100).toFixed(0),
    }));
  }, [pr, ctx]);
  if (!pr || !ctx) return null;
  const v = pr.champ?.verdict;
  return (
    <Panel title="Δ Championship probability (Monte Carlo)" right={champ?.running ? <Spinner label={`${champ.done}/${champ.sims}`} /> : v ? <Badge tone="neutral">{champ?.done} sims / candidate</Badge> : null}>
      {!v ? (
        <Spinner label="Simulating remaining draft → season → playoffs…" />
      ) : (
        <>
          <div className="mb-2 text-xs text-mute">
            Baseline (your default policy pick): P(title) <span className="num text-ink">{((v.baseline?.pChamp ?? 0) * 100).toFixed(1)}%</span>, P(playoffs) <span className="num text-ink">{((v.baseline?.pPlayoffs ?? 0) * 100).toFixed(0)}%</span>. Bars show Δ vs baseline with 95% intervals from paired common-random-number sims.
          </div>
          <div className="h-48">
            <ResponsiveContainer>
              <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid stroke="#1f2a37" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#8a97a8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#8a97a8", fontSize: 11 }} unit=" pts" />
                <Tooltip contentStyle={{ background: "#141b24", border: "1px solid #1f2a37", fontSize: 12 }} formatter={(val: number, n: string) => [`${val}`, n === "delta" ? "Δ P(title) pts" : n]} />
                <Bar dataKey="delta" fill="#f5a524">
                  <ErrorBar dataKey="err" width={4} stroke="#e6ebf2" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="mt-2 w-full text-xs">
            <thead className="text-[10px] text-dim uppercase">
              <tr>
                <th className="text-left">Candidate</th>
                <th className="text-right">P(title)</th>
                <th className="text-right">Δ ± SE</th>
                <th className="text-right">P(playoffs)</th>
                <th className="text-right">Final roster obj (mean ± sd)</th>
                <th className="text-right">Gone before pick</th>
              </tr>
            </thead>
            <tbody>
              {v.summaries.map((s) => (
                <tr key={s.id} className="border-t border-line/50">
                  <td className="py-1">{s.id === POLICY ? "Default policy" : <PlayerLink p={ctx.byId.get(s.id)!} compact />}</td>
                  <td className="num text-right">{(s.pChamp * 100).toFixed(1)}%</td>
                  <td className="num text-right">
                    {(s.deltaChamp * 100).toFixed(1)} ± {(s.deltaChampSe * 100).toFixed(1)}
                  </td>
                  <td className="num text-right">{(s.pPlayoffs * 100).toFixed(0)}%</td>
                  <td className="num text-right">
                    {s.meanFinalObj.toFixed(2)} ± {s.sdFinalObj.toFixed(2)}
                  </td>
                  <td className="num text-right">{(s.unavailableRate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-dim">
            Absolute title odds are model-dependent (projections are model estimates; opponents follow a market model while your future picks follow the optimiser, which is optimistic for you). Use the deltas, not the levels. Fallback hierarchy: Δ title → Δ playoffs → expected category outcomes.
          </p>
        </>
      )}
    </Panel>
  );
}

function FutureTargets() {
  const fast = useFast();
  const ctx = useEngineContext();
  if (!fast.result || !ctx) return null;
  return (
    <Panel title="Likely available at your next pick">
      <ul className="space-y-1 text-xs">
        {fast.result.rec.likelySurvivors.map((s) => (
          <li key={s.id} className="flex justify-between">
            <PlayerLink p={ctx.byId.get(s.id)!} compact />
            <span className="num text-good">{(s.survival * 100).toFixed(0)}%</span>
          </li>
        ))}
        {!fast.result.rec.likelySurvivors.length && <li className="text-dim">None of the top-ranked candidates is likely to survive.</li>}
      </ul>
    </Panel>
  );
}

function PuntStatus() {
  const s = useStrategies();
  if (!s.result?.advice) return null;
  return (
    <Panel title="Current punt strategy">
      <div className="text-sm font-semibold">{s.result.advice.recommended.label}</div>
      <div className="mt-1 text-xs text-mute">{s.result.advice.message}</div>
    </Panel>
  );
}

export default function DecisionCenter() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold tracking-tight">Draft Decision Center</h1>
        <MetricBanner />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <TopPickCard />
          <CandidateTable limit={10} title="Top candidates" />
          <ChampionshipComparison />
        </div>
        <div className="space-y-3">
          <PuntStatus />
          <CategoryOutlook />
          <FutureTargets />
          <AlertsPanel />
          <InjuryWatch />
        </div>
      </div>
    </div>
  );
}
