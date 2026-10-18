"use client";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CAT_BY_KEY } from "@/lib/categories";
import { teamPct } from "@/lib/engine/valuation";
import { playerRisk } from "@/lib/engine/risk";
import { useEngineContext, useFast } from "@/client/analysis";
import { Badge, Panel, ProbBar, Spinner, Stat, ZCell } from "@/components/ui";
import { PlayerLink } from "@/components/player";
import { CategoryOutlook, MyRoster } from "@/components/panels";

export default function TeamPage() {
  const ctx = useEngineContext();
  const fast = useFast();
  const mine = useMemo(() => (ctx ? ctx.rosters[ctx.myIndex] : []), [ctx]);
  if (!ctx) return <Spinner />;
  const players = mine.map((id) => ctx.byId.get(id)!).filter((p) => p.proj);
  const tot = (k: "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "tov") => players.reduce((a, p) => a + p.proj![k], 0);
  const fg = teamPct(players.map((p) => ({ m: p.proj!.fgm, a: p.proj!.fga })));
  const ft = teamPct(players.map((p) => ({ m: p.proj!.ftm, a: p.proj!.fta })));
  const zsum = Object.fromEntries(ctx.cats.map((c) => [c, mine.reduce((a, id) => a + (ctx.values.get(id)?.cat[c] ?? 0), 0)]));
  const radar = ctx.cats.map((c) => ({ cat: CAT_BY_KEY[c].short, win: fast.result ? +(fast.result.rec.field.baseline.perCategory[c] * 100).toFixed(1) : 50 }));
  const contrib = ctx.cats.map((c) => {
    const row: Record<string, number | string> = { cat: CAT_BY_KEY[c].short };
    for (const id of mine) row[ctx.byId.get(id)!.name.split(" ").slice(-1)[0]] = +(ctx.values.get(id)?.cat[c] ?? 0).toFixed(2);
    return row;
  });
  const colors = ["#f5a524", "#38bdf8", "#22c55e", "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#f43f5e", "#84cc16", "#06b6d4", "#3b82f6", "#e879f9", "#fb923c"];
  const pos = (["PG", "SG", "SF", "PF", "C"] as const).map((x) => ({ pos: x, n: players.filter((p) => p.elig.includes(x)).length }));
  const port = fast.result?.portfolio;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">My Team Analyzer</h1>
      {mine.length === 0 ? (
        <Panel><div className="text-sm text-mute">No players drafted yet. Your projected outlook below uses expected picks at your draft slots.</div></Panel>
      ) : null}
      <div className="grid gap-3 xl:grid-cols-4">
        <Panel title="Per-game category totals (projected)" className="xl:col-span-2">
          <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
            <Stat label="PTS" value={tot("pts").toFixed(1)} />
            <Stat label="3PM" value={tot("fg3m").toFixed(1)} />
            <Stat label="REB" value={tot("reb").toFixed(1)} />
            <Stat label="AST" value={tot("ast").toFixed(1)} />
            <Stat label="STL" value={tot("stl").toFixed(1)} />
            <Stat label="BLK" value={tot("blk").toFixed(1)} />
            <Stat label="TO" value={tot("tov").toFixed(1)} />
            <Stat label="FG% (Σmakes/Σatt)" value={fg != null ? `${(fg * 100).toFixed(1)}%` : "—"} sub={`${players.reduce((a, p) => a + p.proj!.fga, 0).toFixed(1)} FGA`} />
            <Stat label="FT% (Σmakes/Σatt)" value={ft != null ? `${(ft * 100).toFixed(1)}%` : "—"} sub={`${players.reduce((a, p) => a + p.proj!.fta, 0).toFixed(1)} FTA`} />
          </div>
          <div className="mt-3 text-[10px] text-dim uppercase">Category z-sum</div>
          <table className="mt-1 w-full text-xs">
            <tbody>
              <tr>
                {ctx.cats.map((c) => <th key={c} className="px-1 text-right text-dim">{CAT_BY_KEY[c].short}</th>)}
              </tr>
              <tr>{ctx.cats.map((c) => <ZCell key={c} z={zsum[c]} />)}</tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="Projected weekly win % by category (final roster vs field)">
          <div className="h-56">
            <ResponsiveContainer>
              <RadarChart data={radar}>
                <PolarGrid stroke="#1f2a37" />
                <PolarAngleAxis dataKey="cat" tick={{ fill: "#8a97a8", fontSize: 11 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar dataKey="win" stroke="#f5a524" fill="#f5a524" fillOpacity={0.35} />
                <Tooltip contentStyle={{ background: "#141b24", border: "1px solid #1f2a37", fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Portfolio risk">
          {!port ? (
            <div className="text-xs text-dim">Draft players to evaluate roster risk.</div>
          ) : (
            <div className="space-y-2 text-xs">
              <Stat label="Season value P10 / P50 / P90" value={`${port.totalValue.p10.toFixed(1)} / ${port.totalValue.p50.toFixed(1)} / ${port.totalValue.p90.toFixed(1)}`} sub={`${port.sims} joint sims (games + production)`} />
              <Stat label="Games lost to injury (P50 / P90)" value={`${port.gamesLost.p50.toFixed(0)} / ${port.gamesLost.p90.toFixed(0)}`} />
              <div>High-risk share of value: <span className="num">{(port.highRiskShare * 100).toFixed(0)}%</span></div>
              {port.concentrationWarning && <Badge tone="warn">{port.concentrationWarning}</Badge>}
            </div>
          )}
          <div className="mt-3 text-[10px] text-dim uppercase">Positional allocation (derived eligibility)</div>
          <div className="mt-1 flex gap-2 text-xs">
            {pos.map((x) => <span key={x.pos}>{x.pos} <span className="num text-ink">{x.n}</span></span>)}
          </div>
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Player contributions by category (z)" className="xl:col-span-2">
          {mine.length === 0 ? <div className="text-xs text-dim">—</div> : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={contrib}>
                  <CartesianGrid stroke="#1f2a37" vertical={false} />
                  <XAxis dataKey="cat" tick={{ fill: "#8a97a8", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8a97a8", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#141b24", border: "1px solid #1f2a37", fontSize: 12 }} />
                  {mine.map((id, i) => <Bar key={id} dataKey={ctx.byId.get(id)!.name.split(" ").slice(-1)[0]} stackId="a" fill={colors[i % colors.length]} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <CategoryOutlook />
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <MyRoster />
        <Panel title="Expected matchup outcomes vs each opponent" className="xl:col-span-2" bodyClass="p-0">
          {!fast.result ? <div className="p-3"><Spinner /></div> : (
            <table className="w-full text-xs">
              <thead className="text-[10px] text-dim uppercase">
                <tr><th className="px-2 py-1 text-left">Opponent</th><th className="px-2 py-1 text-right">Exp. cat wins</th><th className="px-2 py-1">Matchup win</th><th className="px-2 py-1 text-left">Categories at risk</th></tr>
              </thead>
              <tbody>
                {fast.result.rival.map((r) => (
                  <tr key={r.index} className="border-t border-line/50">
                    <td className="px-2 py-1">{r.name}</td>
                    <td className="num px-2 py-1 text-right">{r.expectedCatWins.toFixed(2)}</td>
                    <td className="px-2 py-1"><ProbBar p={r.winProb} /></td>
                    <td className="px-2 py-1 text-mute">{r.threatCats.map((c) => CAT_BY_KEY[c].short).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      <Panel title="Roster risk detail" bodyClass="p-0">
        <table className="w-full text-xs">
          <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Player</th><th>Availability</th><th>GP ± </th><th>Projection CV</th><th>Role</th><th className="text-left">Evidence</th></tr></thead>
          <tbody>
            {players.map((p) => {
              const r = playerRisk(p)!;
              return (
                <tr key={p.id} className="border-t border-line/50">
                  <td className="px-2 py-1"><PlayerLink p={p} compact /></td>
                  <td className="text-center"><Badge tone={r.availability === "high" ? "bad" : r.availability === "medium" ? "warn" : "good"}>{r.availability}</Badge></td>
                  <td className="num text-center">{p.proj!.gp.toFixed(0)} ± {r.gamesSd.toFixed(0)}</td>
                  <td className="num text-center">{(r.projectionCv * 100).toFixed(0)}%</td>
                  <td className="text-center"><Badge tone={r.role === "high" ? "bad" : r.role === "medium" ? "warn" : "good"}>{r.role}</Badge></td>
                  <td className="px-2 text-mute">{[r.availabilityEvidence, ...r.roleEvidence].join(" · ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
