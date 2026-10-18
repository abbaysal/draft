"use client";
import { CAT_BY_KEY } from "@/lib/categories";
import { useEngineContext, useFast } from "@/client/analysis";
import { Badge, Panel, ProbBar, Spinner } from "@/components/ui";
import { PlayerLink } from "@/components/player";

export default function OpponentsPage() {
  const ctx = useEngineContext();
  const fast = useFast();
  if (!ctx || !fast.result) return <Spinner label="Analysing opponents…" />;
  const { profiles, rival, avail } = fast.result;
  const rivalBy = new Map(rival.map((r) => [r.index, r]));
  const nextPicks = (t: number) => avail.teamPredictions.filter((p) => p.teamIndex === t);
  const challengers = ctx.cats.map((c) => {
    const ranked = profiles.filter((p) => p.index !== ctx.myIndex).sort((a, b) => a.catRank[c] - b.catRank[c]);
    return { c, top: ranked.slice(0, 2) };
  });
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">Opponent Intelligence</h1>
      <Panel title="Rival matrix — your projected final roster vs each opponent's (P(win category) per week)" bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" data-testid="rival-matrix">
            <thead className="text-[10px] text-dim uppercase">
              <tr>
                <th className="px-2 py-1 text-left">Opponent</th>
                {ctx.cats.map((c) => <th key={c} className="px-1 py-1 text-right">{CAT_BY_KEY[c].short}</th>)}
                <th className="px-2 py-1 text-right">Exp. cats</th>
                <th className="px-2 py-1">Matchup</th>
              </tr>
            </thead>
            <tbody>
              {rival.map((r) => (
                <tr key={r.index} className="border-t border-line/50">
                  <td className="px-2 py-1">{r.name}</td>
                  {ctx.cats.map((c) => {
                    const p = r.catProbs[c];
                    return <td key={c} className="num px-1 py-1 text-right" style={{ background: p >= 0.5 ? `rgba(34,197,94,${(p - 0.5) * 0.8})` : `rgba(239,68,68,${(0.5 - p) * 0.8})` }}>{(p * 100).toFixed(0)}</td>;
                  })}
                  <td className="num px-2 py-1 text-right">{r.expectedCatWins.toFixed(2)}</td>
                  <td className="px-2 py-1"><ProbBar p={r.winProb} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-2 py-1 text-[10px] text-dim">Opponents&apos; unfilled picks are projected with expected market fills at their draft slots. Strategic importance: lowest matchup-win rows are your main title threats.</div>
      </Panel>
      <Panel title="Who challenges you in each category">
        <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-9">
          {challengers.map(({ c, top }) => (
            <div key={c}>
              <div className="font-semibold" style={{ color: CAT_BY_KEY[c].color }}>{CAT_BY_KEY[c].short}</div>
              {top.map((t) => <div key={t.index} className="truncate text-mute">{t.name}</div>)}
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {profiles.filter((p) => p.index !== ctx.myIndex).map((p) => {
          const r = rivalBy.get(p.index);
          return (
            <Panel key={p.index} title={p.name} right={r ? <span className="text-dim">you win {(r.winProb * 100).toFixed(0)}%</span> : null}>
              <div className="space-y-1.5 text-xs">
                <div className="flex flex-wrap gap-1">
                  <span className="text-dim">Strengths:</span>
                  {p.strengths.length ? p.strengths.map((c) => <Badge key={c} tone="good">{CAT_BY_KEY[c].short}</Badge>) : <span className="text-dim">—</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className="text-dim">Weaknesses:</span>
                  {p.weaknesses.length ? p.weaknesses.map((c) => <Badge key={c} tone="bad">{CAT_BY_KEY[c].short}</Badge>) : <span className="text-dim">—</span>}
                </div>
                <div>
                  <span className="text-dim">Likely strategy (estimate): </span>
                  {p.inferredPunts.length ? p.inferredPunts.map((x) => `punt ${CAT_BY_KEY[x.cat].short} (${x.confidence})`).join(", ") : p.roster.length < 4 ? "too early to infer" : "balanced"}
                </div>
                <div><span className="text-dim">Tendency: </span>{p.tendencyNote}</div>
                <div><span className="text-dim">Open starting slots: </span>{p.openSlots.join(", ") || "none"}</div>
                <div className="text-dim">Roster:</div>
                <div className="flex flex-col gap-0.5">
                  {p.roster.map((id) => <PlayerLink key={id} p={ctx.byId.get(id)!} compact />)}
                  {!p.roster.length && <span className="text-dim">—</span>}
                </div>
                {nextPicks(p.index).length > 0 && (
                  <div className="mt-1 rounded bg-panel2 p-1.5">
                    <div className="text-dim">Projected picks before your next turn:</div>
                    {nextPicks(p.index).map((np) => (
                      <div key={np.overall}>#{np.overall}: {np.options.slice(0, 3).map((o) => `${ctx.byId.get(o.id)?.name} ${(o.p * 100).toFixed(0)}%`).join(", ")}</div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
