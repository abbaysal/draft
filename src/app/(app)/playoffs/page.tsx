"use client";
import { useMemo } from "react";
import { playoffTable, teamPlayoffGames } from "@/lib/engine/playoffs";
import { weekRange } from "@/lib/engine/schedule";
import { useEngineContext } from "@/client/analysis";
import { Badge, Panel, Spinner } from "@/components/ui";
import { PlayerLink } from "@/components/player";

export default function PlayoffsPage() {
  const ctx = useEngineContext();
  const data = useMemo(() => {
    if (!ctx) return null;
    return { teams: teamPlayoffGames(ctx).sort((a, b) => b.total - a.total), mine: playoffTable(ctx, ctx.rosters[ctx.myIndex]), avail: playoffTable(ctx, ctx.available.slice(0, 120)).sort((a, b) => b.playoffAdjValue - a.playoffAdjValue).slice(0, 30) };
  }, [ctx]);
  if (!ctx || !data) return <Spinner />;
  const uniform = ctx.schedule.source === "uniform";
  const weeks = ctx.settings.playoffWeeks;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">Fantasy Playoff Optimizer</h1>
      <Panel>
        <div className="text-xs text-mute">
          Playoff weeks: {weeks.map((w) => `W${w} (${weekRange(w).start} → ${weekRange(w).end})`).join(" · ")} — change in League settings.{" "}
          {uniform ? <Badge tone="warn">No NBA schedule imported — every team shows the same uniform estimate. Import the 2026-27 schedule on the Data page.</Badge> : <Badge tone="good">{ctx.schedule.label}</Badge>}
        </div>
        <div className="mt-1 text-[10px] text-dim">Nominal games = scheduled; expected counted = scheduled × projected availability. Back-to-backs are shown as congestion only — no rest is assumed.</div>
      </Panel>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="NBA team playoff-week schedules" bodyClass="p-0">
          <div className="max-h-[540px] overflow-auto">
            <table className="grid-table w-full text-xs">
              <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Team</th>{weeks.map((w) => <th key={w} className="text-right">W{w}</th>)}<th className="text-right">Total</th><th className="px-2 text-right">B2B</th></tr></thead>
              <tbody>{data.teams.map((t) => <tr key={t.team} className="border-t border-line/50"><td className="px-2 py-1">{t.team}</td>{t.games.map((g, i) => <td key={i} className="num text-right">{g.toFixed(uniform ? 1 : 0)}</td>)}<td className="num text-right">{t.total.toFixed(uniform ? 1 : 0)}</td><td className="num px-2 text-right">{t.b2b}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
        <Panel title="My roster in the playoffs" bodyClass="p-0">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Player</th><th className="text-right">Games</th><th className="text-right">Exp. counted</th><th className="px-2 text-right">Reg → playoff value</th></tr></thead>
            <tbody>{data.mine.map((r) => <tr key={r.id} className="border-t border-line/50"><td className="px-2 py-1"><PlayerLink p={ctx.byId.get(r.id)!} compact /></td><td className="num text-right">{r.playoffTotal.toFixed(uniform ? 1 : 0)}</td><td className="num text-right">{r.expectedCounted.toFixed(1)}</td><td className="num px-2 text-right">{r.regValue.toFixed(2)} → {r.playoffAdjValue.toFixed(2)}</td></tr>)}</tbody>
          </table>
          {data.mine.length === 0 && <div className="p-3 text-xs text-dim">No players drafted yet.</div>}
        </Panel>
        <Panel title="Best playoff-adjusted values available" bodyClass="p-0">
          <div className="max-h-[540px] overflow-auto">
            <table className="grid-table w-full text-xs">
              <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Player</th><th className="text-right">Games</th><th className="text-right">Reg</th><th className="px-2 text-right">Playoff adj</th></tr></thead>
              <tbody>{data.avail.map((r) => <tr key={r.id} className="border-t border-line/50"><td className="px-2 py-1"><PlayerLink p={ctx.byId.get(r.id)!} compact /></td><td className="num text-right">{r.playoffTotal.toFixed(uniform ? 1 : 0)}</td><td className="num text-right">{r.regValue.toFixed(2)}</td><td className="num px-2 text-right">{r.playoffAdjValue.toFixed(2)}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
