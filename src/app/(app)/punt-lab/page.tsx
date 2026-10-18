"use client";
import { useEffect, useMemo, useState } from "react";
import { CAT_BY_KEY, describeWeights, uniformWeights, type CategoryWeights } from "@/lib/categories";
import { rankShifts, valuePlayers } from "@/lib/engine/valuation";
import type { StrategyResult } from "@/lib/engine/strategy";
import type { CategoryKey } from "@/lib/types";
import { useCurrentKey, useEngineContext, useStrategies } from "@/client/analysis";
import { nextId, strategyWorker } from "@/client/engine";
import { useActiveSession, useDataset, useStore } from "@/client/store";
import type { StrategiesResult } from "@/workers/protocol";
import { Badge, Button, cn, Delta, Panel, ProbBar, Spinner, Tabs } from "@/components/ui";
import { PlayerLink } from "@/components/player";
import { WeightsEditor } from "@/components/weights";

function StrategyRow({ r, best, onPick }: { r: StrategyResult; best: number; onPick: () => void }) {
  const ctx = useEngineContext();
  if (!ctx) return null;
  const sig = r.deltaVsBalanced > 2 * r.deltaSe;
  return (
    <tr className="border-b border-line/50 hover:bg-panel2">
      <td className="px-2 py-1">
        <button onClick={onPick} className="text-left hover:text-accent">
          {r.label}
        </button>{" "}
        <span className="text-[10px] text-dim">{r.kind}</span>
      </td>
      <td className="num px-2 py-1 text-right">
        {r.meanObj.toFixed(3)} <span className="text-dim">±{r.sdObj.toFixed(2)}</span>
      </td>
      <td className="px-2 py-1 text-right">
        <Delta v={r.deltaVsBalanced} /> <span className="num text-[10px] text-dim">±{r.deltaSe.toFixed(3)}</span> {sig && r.kind !== "balanced" && <Badge tone="good">sig</Badge>}
      </td>
      <td className="num px-2 py-1 text-right">{r.expectedCatWins.toFixed(2)}</td>
      <td className="num px-2 py-1 text-right">{(r.matchupWinProb * 100).toFixed(0)}%</td>
      <td className="px-2 py-1">
        <div className="flex gap-0.5">
          {ctx.cats.map((c) => {
            const p = r.perCategory[c];
            return (
              <span key={c} title={`${CAT_BY_KEY[c].short} ${(p * 100).toFixed(0)}%`} className="inline-block h-3 w-3 rounded-sm" style={{ background: p >= 0.6 ? "#16a34a" : p >= 0.45 ? "#a16207" : "#b91c1c", opacity: 0.4 + Math.abs(p - 0.5) * 1.2 }} />
            );
          })}
        </div>
      </td>
      <td className="max-w-64 truncate px-2 py-1 text-[11px] text-mute">{r.targets.slice(0, 3).map((id) => ctx.byId.get(id)?.name).join(", ")}</td>
      <td className="num px-2 py-1 text-right text-[10px] text-dim">{(best - r.meanObj).toFixed(3)}</td>
    </tr>
  );
}

export default function PuntLab() {
  const ctx = useEngineContext();
  const strat = useStrategies();
  const ds = useDataset();
  const session = useActiveSession();
  const key = useCurrentKey();
  const setPuntWeights = useStore((s) => s.setPuntWeights);
  const [weights, setWeights] = useState<CategoryWeights>(useStore.getState().puntWeights ?? uniformWeights());
  const [filter, setFilter] = useState<"all" | "single" | "double" | "triple" | "soft">("all");
  const [custom, setCustom] = useState<StrategiesResult | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [focus, setFocus] = useState<StrategyResult | null>(null);

  const isUniform = ctx ? ctx.cats.every((c) => weights[c] === 1) : true;
  useEffect(() => {
    setPuntWeights(isUniform ? null : weights);
    if (!ds || !session || isUniform) {
      setCustom(null);
      return;
    }
    let live = true;
    setCustomLoading(true);
    const t = setTimeout(() => {
      strategyWorker(ds)
        .run<StrategiesResult>({ type: "strategies", id: nextId(), datasetKey: ds.key, state: { settings: session.settings, draft: session.state }, runs: 16, custom: { label: describeWeights(weights), weights }, onlyCustom: true })
        .then((r) => live && setCustom(r))
        .finally(() => live && setCustomLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [weights, ds, session, key, isUniform, setPuntWeights]);

  const ranking = useMemo(() => {
    if (!ctx) return null;
    const base = ctx.values;
    const nv = valuePlayers(ctx.players, ctx.baseline, weights);
    const shifts = rankShifts(base, nv, 150);
    const avail = new Set(ctx.available);
    return {
      nv,
      risers: shifts.filter((s) => avail.has(s.id)).slice(0, 10),
      fallers: [...shifts].reverse().filter((s) => avail.has(s.id)).slice(0, 10),
      targets: ctx.available.filter((id) => nv.has(id)).sort((a, b) => nv.get(a)!.rank - nv.get(b)!.rank).slice(0, 15),
    };
  }, [ctx, weights]);

  if (!ctx || !ranking) return <Spinner />;
  const results = strat.result?.results ?? [];
  const shown = results.filter((r) => filter === "all" || r.kind === filter || r.kind === "balanced");
  const best = results[0]?.meanObj ?? 0;
  const customRes = custom?.results.find((r) => r.kind === "custom");
  const customBal = custom?.results.find((r) => r.kind === "balanced");
  const myZ = ctx.cats.map((c) => ({ c, z: ctx.rosters[ctx.myIndex].reduce((a, id) => a + (ctx.values.get(id)?.cat[c] ?? 0), 0) }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold tracking-tight">Punt Strategy Laboratory</h1>
        <div className="text-xs text-mute">
          Builds are scored with the league&apos;s real objective over <em>all</em> categories — a punt only wins if it yields more expected wins.
        </div>
      </div>
      {strat.result?.advice && (
        <Panel title="Engine verdict" right={strat.stale ? <Spinner label="re-simulating" /> : <span className="text-dim">{results[0]?.runs} completions per build · {(strat.result.ms / 1000).toFixed(1)}s</span>}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold">{strat.result.advice.recommended.label}</span>
            <Badge tone={strat.result.advice.commit ? "good" : "neutral"}>{strat.result.advice.commit ? "COMMIT" : "STAY FLEXIBLE"}</Badge>
            <span className="text-mute">{strat.result.advice.message}</span>
          </div>
        </Panel>
      )}
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Custom build (toggle categories; click cycles full → soft ×½ → punt)" className="xl:col-span-2">
          <WeightsEditor weights={weights} onChange={setWeights} active={ctx.cats} />
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-mute">{describeWeights(weights)}</span>
            <Button size="sm" variant="ghost" onClick={() => setWeights(uniformWeights())}>
              Reset
            </Button>
          </div>
          {!isUniform && (
            <div className="mt-3 rounded-md bg-panel2 p-2 text-xs">
              {customLoading || !customRes ? (
                <Spinner label="Simulating this build vs balanced…" />
              ) : (
                <div className="flex flex-wrap items-center gap-4">
                  <span>
                    Expected objective <span className="num text-ink">{customRes.meanObj.toFixed(3)}</span> vs balanced <span className="num">{customBal?.meanObj.toFixed(3)}</span>
                  </span>
                  <span>
                    Δ <Delta v={customRes.deltaVsBalanced} /> ± {customRes.deltaSe.toFixed(3)}
                  </span>
                  <span>Matchup win {(customRes.matchupWinProb * 100).toFixed(0)}%</span>
                  <span className="flex gap-1">
                    {ctx.cats.map((c) => (
                      <span key={c} className="text-[10px]">
                        {CAT_BY_KEY[c].short} <span className={cn("num", customRes.perCategory[c] >= 0.5 ? "text-good" : "text-bad")}>{(customRes.perCategory[c] * 100).toFixed(0)}</span>
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </div>
          )}
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <div className="mb-1 text-[10px] text-dim uppercase">Top available targets</div>
              <ol className="space-y-0.5 text-xs">
                {ranking.targets.map((id) => (
                  <li key={id} className="flex justify-between gap-2">
                    <PlayerLink p={ctx.byId.get(id)!} compact />
                    <span className="num text-dim">
                      #{ranking.nv.get(id)?.rank} <span className="text-[10px]">(base #{ctx.values.get(id)?.rank})</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="mb-1 text-[10px] text-dim uppercase">Biggest risers (available)</div>
              <ol className="space-y-0.5 text-xs">
                {ranking.risers.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <PlayerLink p={ctx.byId.get(s.id)!} compact />
                    <span className="num text-good">+{s.delta}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <div className="mb-1 text-[10px] text-dim uppercase">Biggest fallers (available)</div>
              <ol className="space-y-0.5 text-xs">
                {ranking.fallers.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <PlayerLink p={ctx.byId.get(s.id)!} compact />
                    <span className="num text-bad">{s.delta}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Panel>
        <Panel title="My roster category z-sums">
          {ctx.rosters[ctx.myIndex].length === 0 ? (
            <div className="text-xs text-dim">No players yet — every build is still open. Punting before round 3–4 closes doors cheaply avoided.</div>
          ) : (
            <div className="space-y-1">
              {myZ.map(({ c, z }) => (
                <div key={c} className="flex items-center justify-between text-xs">
                  <span className="w-10">{CAT_BY_KEY[c as CategoryKey].short}</span>
                  <div className="relative h-2 flex-1 rounded bg-line">
                    <div className={cn("absolute top-0 h-2 rounded", z >= 0 ? "bg-good" : "bg-bad")} style={{ left: z >= 0 ? "50%" : `${50 + Math.max(-50, z * 8)}%`, width: `${Math.min(50, Math.abs(z) * 8)}%` }} />
                    <div className="absolute top-[-2px] left-1/2 h-3 w-px bg-dim" />
                  </div>
                  <span className="num w-10 text-right">{z.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
          {focus && (
            <div className="mt-3 border-t border-line pt-2 text-xs">
              <div className="font-semibold">{focus.label}: example completion of your roster</div>
              <ol className="mt-1 space-y-0.5">
                {focus.sampleRoster.map((id) => (
                  <li key={id}>
                    <PlayerLink p={ctx.byId.get(id)!} compact />
                  </li>
                ))}
              </ol>
              <div className="mt-1 space-y-0.5">
                {ctx.cats.map((c) => (
                  <div key={c} className="flex justify-between">
                    <span>{CAT_BY_KEY[c].short}</span>
                    <ProbBar p={focus.perCategory[c]} width={90} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>
      <Panel
        title={`Strategy comparison (${results.length} builds)`}
        right={<Tabs value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "single", label: "Single" }, { value: "double", label: "Double" }, { value: "triple", label: "Triple" }, { value: "soft", label: "Soft" }]} />}
        bodyClass="p-0"
      >
        {!strat.result ? (
          <div className="p-3">
            <Spinner label="Simulating all builds from the current draft state…" />
          </div>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="grid-table w-full text-xs" data-testid="strategy-table">
              <thead className="text-[10px] text-dim uppercase">
                <tr>
                  <th className="px-2 py-1 text-left">Build</th>
                  <th className="px-2 py-1 text-right">Objective ± sd</th>
                  <th className="px-2 py-1 text-right">Δ vs balanced ± SE</th>
                  <th className="px-2 py-1 text-right">Exp. cat wins</th>
                  <th className="px-2 py-1 text-right">Matchup win</th>
                  <th className="px-2 py-1 text-left">Category win % (PTS→TO)</th>
                  <th className="px-2 py-1 text-left">Targets now</th>
                  <th className="px-2 py-1 text-right">Gap to best</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <StrategyRow key={r.key} r={r} best={best} onPick={() => setFocus(r)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-2 py-1.5 text-[10px] text-dim">
          Each build completes the remaining draft {results[0]?.runs ?? "N"} times with common random numbers; opponents follow the market model. &quot;sig&quot; = beats balanced by &gt; 2 SE. Multi-category punts are only advised when they also beat the best single punt and it is past round 3.
        </div>
      </Panel>
    </div>
  );
}
