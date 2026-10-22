"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CAT_BY_KEY } from "@/lib/categories";
import { planWeek } from "@/lib/engine/lineup";
import { findTrades, powerRankings, waiverMoves, type TradeIdea } from "@/lib/engine/trade";
import { recentForm } from "@/lib/live/form";
import { useEngineContext } from "@/client/analysis";
import { currentPeriod, useMatchupSchedule } from "@/client/matchups";
import { useMatchupSync, usePlanOptions } from "@/client/matchup-sync";
import { useDataset } from "@/client/store";
import { useRecordMove } from "@/client/roster-moves";
import { Badge, Button, cn, Panel, ProbBar, Spinner, Stat } from "@/components/ui";
import { PlayerLink } from "@/components/player";

const sign = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

/** Post-draft home: this week's matchup, league power ratings, waiver moves and trade ideas. */
export function SeasonHome() {
  const ctx = useEngineContext();
  const recordMove = useRecordMove();
  const { opponents } = useMatchupSchedule(ctx);
  const period = currentPeriod(opponents.length || 21);
  const [trades, setTrades] = useState<TradeIdea[] | null>(null);

  const { sync } = useMatchupSync();
  const planOpts = usePlanOptions(sync, period);
  const week = useMemo(() => {
    const opp = opponents[period - 1];
    return ctx && opp != null && opp >= 0 ? planWeek(ctx, period, opp, { ...planOpts, pickups: false }) : null;
  }, [ctx, opponents, period, planOpts]);
  const upcoming = useMemo(
    () => (ctx ? opponents.map((opp, i) => ({ period: i + 1, opp })).filter((x) => x.period >= period && x.opp >= 0).slice(0, 6).map((x) => ({ ...x, plan: planWeek(ctx, x.period, x.opp, { pickups: false }) })) : []),
    [ctx, opponents, period],
  );
  const power = useMemo(() => (ctx ? powerRankings(ctx) : []), [ctx]);
  const moves = useMemo(() => (ctx ? waiverMoves(ctx, 6) : []), [ctx]);
  const ds = useDataset();
  const hot = useMemo(() => (ctx ? recentForm(ctx, ctx.available).slice(0, 8) : []), [ctx]);
  const injured = useMemo(() => {
    if (!ctx) return [];
    const opp = opponents[period - 1];
    const teams = [ctx.myIndex, ...(opp != null && opp >= 0 ? [opp] : [])];
    return teams.flatMap((t) =>
      ctx.rosters[t]
        .map((id) => ctx.byId.get(id)!)
        .filter((p) => p.availability && !["HEALTHY", "UNKNOWN", "RETURNING"].includes(p.availability.status))
        .map((p) => ({ p, team: t })),
    );
  }, [ctx, opponents, period]);
  useEffect(() => {
    if (!ctx) return;
    setTrades(null);
    const t = setTimeout(() => setTrades(findTrades(ctx, { limit: 5 })), 50);
    return () => clearTimeout(t);
  }, [ctx]);

  if (!ctx) return <Spinner />;
  const names = ctx.settings.teamNames;
  const me = power.find((r) => r.team === ctx.myIndex);
  const addDrop = (add: string, drop: string) => void recordMove(add, drop);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold tracking-tight">Season HQ — {names[ctx.myIndex]}</h1>
        <div className="flex gap-2">
          <Link href="/lineup"><Button size="sm" variant="primary">Set lineup</Button></Link>
          <Link href="/trade"><Button size="sm">Trade analyzer</Button></Link>
          <Link href="/draft"><Button size="sm" variant="ghost">Draft board</Button></Link>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title={week ? `This week · Week ${period} vs ${names[week.opponent]}` : "This week"}>
          {!week ? (
            <div className="text-sm text-mute">Set your matchup schedule on the Matchups & Lineup page.</div>
          ) : (
            <div className="space-y-2" data-testid="season-week">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Win probability" value={`${(week.winProb * 100).toFixed(0)}%`} tone={week.winProb >= 0.55 ? "good" : week.winProb >= 0.45 ? "warn" : "bad"} />
                <Stat label="Expected categories" value={`${week.expectedCats.toFixed(1)} – ${(ctx.cats.length - week.expectedCats).toFixed(1)}`} />
              </div>
              <div className="flex flex-wrap gap-1 text-[11px]">
                {week.categories.map((c) => (
                  <span key={c.cat} className={cn("rounded px-1.5 py-0.5", c.pWin >= 0.7 ? "bg-green-950 text-good" : c.pWin <= 0.3 ? "bg-red-950 text-bad" : "bg-yellow-950/50 text-warn")}>
                    {CAT_BY_KEY[c.cat].short} {(c.pWin * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-dim">Yellow = swing categories: these decide the week. Daily start/sit is on Matchups & Lineup.</div>
            </div>
          )}
        </Panel>
        <Panel title="Your team vs the league">
          {me && (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Power rank" value={`#${me.rank}`} sub={`of ${names.length}`} tone={me.rank <= 3 ? "good" : me.rank <= 6 ? "warn" : "bad"} />
                <Stat label="Cats / week" value={me.expectedCatWins.toFixed(2)} sub="vs avg team" />
                <Stat label="Playoff weeks" value={me.playoffCatWins.toFixed(2)} sub="cats / week" />
              </div>
              <div className="space-y-1">
                {ctx.cats.map((c) => (
                  <div key={c} className="flex items-center gap-2 text-xs">
                    <span className="w-10 font-semibold">{CAT_BY_KEY[c].short}</span>
                    <ProbBar p={me.perCategory[c]} width={140} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Upcoming matchups" bodyClass="p-0">
          <table className="w-full text-xs">
            <tbody>
              {upcoming.map((u) => (
                <tr key={u.period} className="border-t border-line/50">
                  <td className="num px-2 py-1">W{u.period}</td>
                  <td>{names[u.opp]}</td>
                  <td className="px-2"><ProbBar p={u.plan.winProb} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {upcoming.length === 0 && <div className="p-3 text-xs text-mute">No schedule set.</div>}
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Injury report — your team & this week's opponent" right={<span className="text-[10px] text-dim">{ds?.live?.opts.injuries ? "live ESPN report" : "preseason research"}</span>} bodyClass="p-0">
          <table className="w-full text-xs" data-testid="injury-report">
            <tbody>
              {injured.map(({ p, team }) => (
                <tr key={p.id} className="border-t border-line/50">
                  <td className="px-2 py-1"><PlayerLink p={p} /></td>
                  <td className={cn("text-[11px]", team === ctx.myIndex ? "text-accent" : "text-mute")}>{team === ctx.myIndex ? "You" : names[team]}</td>
                  <td><Badge tone={p.availability!.status.startsWith("OUT") ? "bad" : "warn"}>{p.availability!.status.replace(/_/g, " ")}</Badge></td>
                  <td className="max-w-64 truncate px-2 text-mute" title={p.availability!.injury}>{p.availability!.injury ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {injured.length === 0 && <div className="p-3 text-xs text-mute">No injuries reported for either roster.</div>}
          <div className="px-2 py-1.5 text-[10px] text-dim">Players listed as out go to IL automatically in the lineup plan.</div>
        </Panel>
        <Panel title="Hot free agents (last 14 days)" bodyClass="p-0">
          <table className="w-full text-xs" data-testid="hot-free-agents">
            <thead className="text-[10px] text-dim uppercase">
              <tr><th className="px-2 py-1 text-left">Player</th><th className="text-right">G</th><th className="text-right" title="Value of his last-14-days per-game line">Recent</th><th className="px-2 text-right" title="Recent value − projected value">vs proj</th></tr>
            </thead>
            <tbody>
              {hot.map((h) => (
                <tr key={h.id} className="border-t border-line/50">
                  <td className="px-2 py-1"><PlayerLink p={ctx.byId.get(h.id)!} /></td>
                  <td className="num text-right">{h.games}</td>
                  <td className="num text-right">{h.recentValue.toFixed(2)}</td>
                  <td className={cn("num px-2 text-right", h.trend > 0 ? "text-good" : "text-bad")}>{sign(h.trend, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hot.length === 0 && <div className="p-3 text-xs text-mute">Appears once 2026-27 games are played (live NBA box scores; season starts Oct 20).</div>}
        </Panel>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="League power rankings" bodyClass="p-0">
          <table className="w-full text-xs" data-testid="power-rankings">
            <thead className="text-[10px] text-dim uppercase">
              <tr><th className="px-2 py-1 text-left">#</th><th className="text-left">Team</th><th className="text-right" title="Expected categories won per week vs every other team">Cats/wk</th><th className="px-2" title="Average matchup win probability vs the league">Win %</th></tr>
            </thead>
            <tbody>
              {[...power].sort((a, b) => a.rank - b.rank).map((r) => (
                <tr key={r.team} className={cn("border-t border-line/50", r.team === ctx.myIndex && "bg-accent/10 font-semibold")}>
                  <td className="num px-2 py-1">{r.rank}</td>
                  <td>{names[r.team]}</td>
                  <td className="num text-right">{r.expectedCatWins.toFixed(2)}</td>
                  <td className="px-2"><ProbBar p={r.winProb} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Waiver wire: best add / drop" right={<Link href="/free-agents" className="text-xs text-accent">All free agents →</Link>} bodyClass="p-0">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-dim uppercase">
              <tr><th className="px-2 py-1 text-left">Add</th><th className="text-left">Drop</th><th className="text-right" title="Δ expected categories won per week">Gain</th><th /></tr>
            </thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.add} className="border-t border-line/50">
                  <td className="px-2 py-1"><PlayerLink p={ctx.byId.get(m.add)!} /></td>
                  <td className="text-mute">{ctx.byId.get(m.drop)?.name}</td>
                  <td className="num text-right text-good">{sign(m.delta)}</td>
                  <td className="px-2 text-right"><Button size="sm" variant="ghost" onClick={() => addDrop(m.add, m.drop)}>Record</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {moves.length === 0 && <div className="p-3 text-xs text-mute">No free agent improves your team right now.</div>}
          <div className="px-2 py-1.5 text-[10px] text-dim">Free agents = players not on the board. Make the move in Yahoo first, then “Record” it here.</div>
        </Panel>
        <Panel title="Trade ideas" right={<Link href="/trade" className="text-xs text-accent">Open analyzer →</Link>} bodyClass="p-0">
          {!trades ? (
            <div className="p-3"><Spinner label="Searching trades…" /></div>
          ) : trades.length === 0 ? (
            <div className="p-3 text-xs text-mute">No trade found that clearly improves your team.</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {trades.map((t, i) => (
                  <tr key={i} className="border-t border-line/50">
                    <td className="px-2 py-1">
                      <div><span className="text-bad">−</span> {t.trade.give.map((id) => ctx.byId.get(id)?.name).join(" + ")}</div>
                      <div><span className="text-good">+</span> {t.trade.get.map((id) => ctx.byId.get(id)?.name).join(" + ")}</div>
                      <div className="text-[10px] text-dim">with {names[t.trade.partner]}</div>
                    </td>
                    <td className="num px-2 text-right">
                      <div className="text-good">{sign(t.myDelta)}</div>
                      {t.theirDelta > 0.02 && <Badge tone="good">WIN-WIN</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
