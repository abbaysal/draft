"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CAT_BY_KEY, uniformWeights } from "@/lib/categories";
import { valuePlayers } from "@/lib/engine/valuation";
import { evaluateRoster } from "@/lib/engine/recommend";
import { playerRisk } from "@/lib/engine/risk";
import { useEngineContext, useFast } from "@/client/analysis";
import { useStore } from "@/client/store";
import { Badge, Button, Delta, Panel, Spinner, ZCell } from "@/components/ui";
import { PlayerLink, PlayerSearch, useDraftPlayer } from "@/components/player";
import { CatImpact } from "@/components/recs";

function Compare() {
  const params = useSearchParams();
  const ctx = useEngineContext();
  const fast = useFast();
  const punt = useStore((s) => s.puntWeights);
  const draft = useDraftPlayer();
  const [ids, setIds] = useState<string[]>(() => (params.get("ids") ?? "").split(",").filter(Boolean).slice(0, 5));
  const rows = useMemo(() => {
    if (!ctx) return [];
    const pv = valuePlayers(ctx.players, ctx.baseline, punt ?? uniformWeights(ctx.cats));
    const field = fast.result && !fast.stale ? fast.result.rec.field : null;
    return ids
      .map((id) => ctx.byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p && !!p.proj)
      .map((p) => {
        const ev = field && !ctx.drafted.has(p.id) ? evaluateRoster(ctx, field, [p.id]) : null;
        const impact: Record<string, number> = {};
        if (ev && field) for (const c of ctx.cats) impact[c] = ev.ev.perCategory[c] - field.baseline.perCategory[c];
        return { p, v: ctx.values.get(p.id)!, pv: pv.get(p.id), gain: ev && field ? ev.obj - field.baselineObj : null, impact, risk: playerRisk(p)!, surv: fast.result?.avail.survival.get(p.id), strat: fast.result?.rec.candidates.find((c) => c.id === p.id)?.strategic };
      });
  }, [ctx, ids, punt, fast.result, fast.stale]);
  if (!ctx) return <Spinner />;
  const best = rows.filter((r) => r.gain != null && !ctx.drafted.has(r.p.id)).sort((a, b) => (b.strat ?? b.gain!) - (a.strat ?? a.gain!))[0];
  const fmt = (x: number, d = 1) => x.toFixed(d);
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">Player Comparison</h1>
      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-72"><PlayerSearch players={ctx.players} drafted={new Set(ids)} autoFocusKey="__none__" placeholder="Add player (2–5)…" onPick={(p) => setIds((s) => [...s, p.id].slice(-5))} /></div>
          {ids.map((id) => <Badge key={id}>{ctx.byId.get(id)?.name} <button className="ml-1" onClick={() => setIds((s) => s.filter((x) => x !== id))}>✕</button></Badge>)}
        </div>
      </Panel>
      {rows.length < 2 ? <Panel><div className="text-sm text-mute">Add at least two projected players.</div></Panel> : (
        <>
          {best && (
            <Panel title="Recommendation" className="border-accent/40">
              <div className="text-sm">
                <span className="font-semibold">{best.p.name}</span> adds the most to <em>your</em> roster ({fast.result?.rec.objectiveName.toLowerCase()} <Delta v={best.strat ?? best.gain!} />)
                {best.surv != null && best.surv > 0.6 ? `, and has a ${(best.surv * 100).toFixed(0)}% chance of lasting to your next pick — consider taking someone scarcer first.` : best.surv != null ? `; only ${(best.surv * 100).toFixed(0)}% chance he lasts to your next pick.` : "."}
              </div>
            </Panel>
          )}
          <Panel bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Metric</th>{rows.map((r) => <th key={r.p.id} className="px-2 py-1 text-right"><PlayerLink p={r.p} compact /></th>)}</tr></thead>
                <tbody className="num">
                  {[
                    ["Value rank", (r: (typeof rows)[number]) => `#${r.v.rank}`],
                    ["Punt-adjusted rank", (r: (typeof rows)[number]) => (r.pv ? `#${r.pv.rank}` : "—")],
                    [ctx.marketSource === "proxy" ? "Market proxy" : "ADP", (r: (typeof rows)[number]) => (r.p.adp != null ? r.p.adp.toFixed(1) : `#${ctx.marketRank.get(r.p.id)}`)],
                    ["GP / MIN", (r: (typeof rows)[number]) => `${fmt(r.p.proj!.gp, 0)} / ${fmt(r.p.proj!.min)}`],
                    ["PTS", (r: (typeof rows)[number]) => `${fmt(r.p.proj!.pts)} (${fmt(r.p.proj!.pts * r.p.proj!.gp, 0)})`],
                    ["3PM", (r: (typeof rows)[number]) => `${fmt(r.p.proj!.fg3m)} (${fmt(r.p.proj!.fg3m * r.p.proj!.gp, 0)})`],
                    ["REB", (r: (typeof rows)[number]) => `${fmt(r.p.proj!.reb)} (${fmt(r.p.proj!.reb * r.p.proj!.gp, 0)})`],
                    ["AST", (r: (typeof rows)[number]) => `${fmt(r.p.proj!.ast)} (${fmt(r.p.proj!.ast * r.p.proj!.gp, 0)})`],
                    ["STL", (r: (typeof rows)[number]) => fmt(r.p.proj!.stl)],
                    ["BLK", (r: (typeof rows)[number]) => fmt(r.p.proj!.blk)],
                    ["FG% (FGA)", (r: (typeof rows)[number]) => `${fmt((r.p.proj!.fgm / Math.max(r.p.proj!.fga, 1e-9)) * 100)}% (${fmt(r.p.proj!.fga)})`],
                    ["FT% (FTA)", (r: (typeof rows)[number]) => `${fmt((r.p.proj!.ftm / Math.max(r.p.proj!.fta, 1e-9)) * 100)}% (${fmt(r.p.proj!.fta)})`],
                    ["TO", (r: (typeof rows)[number]) => fmt(r.p.proj!.tov)],
                    ["Total z", (r: (typeof rows)[number]) => fmt(r.v.total, 2)],
                    ["Risk (overall)", (r: (typeof rows)[number]) => r.risk.overall],
                    ["Survive to next pick", (r: (typeof rows)[number]) => (r.surv != null ? `${(r.surv * 100).toFixed(0)}%` : "—")],
                  ].map(([label, f]) => (
                    <tr key={label as string} className="border-t border-line/50"><td className="px-2 py-1 font-sans text-mute">{label as string}</td>{rows.map((r) => <td key={r.p.id} className="px-2 py-1 text-right">{(f as (r: (typeof rows)[number]) => string)(r)}</td>)}</tr>
                  ))}
                  {ctx.cats.map((c) => (
                    <tr key={c} className="border-t border-line/50"><td className="px-2 py-1 font-sans text-mute">z {CAT_BY_KEY[c].short}</td>{rows.map((r) => <ZCell key={r.p.id} z={r.v.cat[c]} />)}</tr>
                  ))}
                  <tr className="border-t border-line/50"><td className="px-2 py-1 font-sans text-mute">Roster fit (Δ objective)</td>{rows.map((r) => <td key={r.p.id} className="px-2 py-1 text-right">{r.gain != null ? <Delta v={r.gain} /> : "drafted"}</td>)}</tr>
                  <tr className="border-t border-line/50"><td className="px-2 py-1 font-sans text-mute">Category impact</td>{rows.map((r) => <td key={r.p.id} className="px-2 py-1"><CatImpact impact={r.impact} max={4} /></td>)}</tr>
                  <tr className="border-t border-line/50"><td></td>{rows.map((r) => <td key={r.p.id} className="px-2 py-1 text-right">{!ctx.drafted.has(r.p.id) && <Button size="sm" onClick={() => void draft(r.p.id)}>Draft</Button>}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  return <Suspense><Compare /></Suspense>;
}
