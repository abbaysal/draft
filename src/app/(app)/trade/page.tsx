"use client";
import { useMemo, useState } from "react";
import { CAT_BY_KEY } from "@/lib/categories";
import { evaluateTrade, findTrades, type Trade, type TradeIdea } from "@/lib/engine/trade";
import { useEngineContext } from "@/client/analysis";
import { currentPeriod, useMatchupSchedule } from "@/client/matchups";
import { useStore } from "@/client/store";
import { Badge, Button, cn, Delta, Panel, ProbBar, Spinner } from "@/components/ui";
import { PlayerLink } from "@/components/player";

const sign = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

export default function TradePage() {
  const ctx = useEngineContext();
  const dispatch = useStore((s) => s.dispatch);
  const toast = useStore((s) => s.toast);
  const { opponents } = useMatchupSchedule(ctx);
  const [partner, setPartner] = useState<number | null>(null);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [ideas, setIdeas] = useState<TradeIdea[] | null>(null);
  const [searching, setSearching] = useState(false);

  const other = ctx ? (partner ?? (ctx.myIndex === 0 ? 1 : 0)) : 0;
  const ev = useMemo(() => {
    if (!ctx || (!give.length && !get.length)) return null;
    return evaluateTrade(ctx, { partner: other, give, get }, { opponents, fromPeriod: currentPeriod(opponents.length) });
  }, [ctx, other, give, get, opponents]);

  if (!ctx) return <Spinner />;
  const names = ctx.settings.teamNames;
  const val = (id: string) => ctx.values.get(id)?.total ?? 0;
  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const load = (t: Trade) => {
    setPartner(t.partner);
    setGive(t.give);
    setGet(t.get);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const search = (only?: number) => {
    setSearching(true);
    setTimeout(() => {
      setIdeas(findTrades(ctx, { limit: 30, partner: only }));
      setSearching(false);
    }, 20);
  };
  const apply = async () => {
    if (!ev) return;
    if (!window.confirm(`Record this trade on the board?\nYou send: ${give.map((id) => ctx.byId.get(id)?.name).join(", ")}\nYou get: ${get.map((id) => ctx.byId.get(id)?.name).join(", ")}`)) return;
    for (const [ids, team] of [[give, other], [get, ctx.myIndex]] as const) {
      for (const id of ids) {
        const pick = ctx.draft.picks.find((p) => p.playerId === id);
        if (pick && !(await dispatch({ type: "setOwner", overall: pick.overall, teamIndex: team }))) return;
      }
    }
    toast("success", "Trade recorded — rosters, lineups and analysis updated.");
    setGive([]);
    setGet([]);
    setIdeas(null);
  };

  const RosterPick = ({ team, chosen, onToggle, title }: { team: number; chosen: string[]; onToggle: (id: string) => void; title: string }) => (
    <Panel title={title} bodyClass="p-0">
      <table className="w-full text-xs">
        <thead className="text-[10px] text-dim uppercase">
          <tr>
            <th className="w-6" />
            <th className="py-1 text-left">Player</th>
            <th className="px-2 text-right" title="Season value (z-score total)">Value</th>
          </tr>
        </thead>
        <tbody>
          {[...ctx.rosters[team]].sort((a, b) => val(b) - val(a)).map((id) => (
            <tr key={id} onClick={() => onToggle(id)} className={cn("cursor-pointer border-t border-line/50 hover:bg-panel2", chosen.includes(id) && "bg-accent/10")}>
              <td className="pl-2">
                <input type="checkbox" readOnly checked={chosen.includes(id)} className="accent-amber-500" />
              </td>
              <td className="py-1">
                <PlayerLink p={ctx.byId.get(id)!} />
              </td>
              <td className="num px-2 text-right">{val(id).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold tracking-tight">Trade Analyzer</h1>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-mute">Trade with</span>
          <select
            className="h-7 rounded border border-line bg-panel2 px-2"
            value={other}
            onChange={(e) => {
              setPartner(Number(e.target.value));
              setGet([]);
            }}
            data-testid="trade-partner"
          >
            {names.map((n, i) => (i === ctx.myIndex ? null : <option key={i} value={i}>{n}</option>))}
          </select>
          <Button size="sm" variant="ghost" disabled={!give.length && !get.length} onClick={() => { setGive([]); setGet([]); }}>
            Clear
          </Button>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <RosterPick team={ctx.myIndex} chosen={give} onToggle={(id) => toggle(give, setGive, id)} title={`You send — ${names[ctx.myIndex]}`} />
        <RosterPick team={other} chosen={get} onToggle={(id) => toggle(get, setGet, id)} title={`You receive — ${names[other]}`} />
        <Panel title="Verdict">
          {!ev ? (
            <div className="text-sm text-mute">Tick players on both sides (or use the trade finder below) to evaluate a trade.</div>
          ) : (
            <div className="space-y-3 text-xs" data-testid="trade-verdict">
              <div className={cn("rounded-md border p-2 text-sm font-semibold", ev.verdict.tone === "good" ? "border-green-900 bg-green-950/40 text-good" : ev.verdict.tone === "warn" ? "border-yellow-900 bg-yellow-950/30 text-warn" : "border-red-900 bg-red-950/40 text-bad")}>{ev.verdict.text}</div>
              <div className={cn(ev.acceptance.tone === "good" ? "text-good" : ev.acceptance.tone === "warn" ? "text-warn" : "text-bad")}>{ev.acceptance.text}</div>
              <table className="w-full">
                <thead className="text-[10px] text-dim uppercase">
                  <tr><th className="text-left">Metric</th><th className="text-right">You</th><th className="text-right">{names[other].split(" ")[0]}</th></tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line/50"><td className="py-1" title="Expected categories won per week vs every other team">Cats/week vs league</td><td className="num text-right"><Delta v={ev.me.delta} digits={2} /></td><td className="num text-right"><Delta v={ev.them.delta} digits={2} /></td></tr>
                  <tr className="border-t border-line/50"><td className="py-1" title="Same, in the fantasy playoff weeks with their real NBA games">Playoff weeks</td><td className="num text-right"><Delta v={ev.me.playoffDelta} digits={2} /></td><td className="num text-right"><Delta v={ev.them.playoffDelta} digits={2} /></td></tr>
                  <tr className="border-t border-line/50"><td className="py-1">Matchup win % vs league</td><td className="num text-right">{(ev.me.before.matchupWinProb * 100).toFixed(0)}→{(ev.me.after.matchupWinProb * 100).toFixed(0)}%</td><td className="num text-right">{(ev.them.before.matchupWinProb * 100).toFixed(0)}→{(ev.them.after.matchupWinProb * 100).toFixed(0)}%</td></tr>
                </tbody>
              </table>
              {ev.schedule && (
                <div className="rounded-md bg-panel2 p-2">
                  Remaining schedule ({ev.schedule.weeks} matchups): expected wins <span className="num font-semibold">{ev.schedule.winsBefore.toFixed(1)} → {ev.schedule.winsAfter.toFixed(1)}</span> ({sign(ev.schedule.winsAfter - ev.schedule.winsBefore, 1)}), category wins {ev.schedule.catsBefore.toFixed(0)} → {ev.schedule.catsAfter.toFixed(0)}.
                </div>
              )}
              <div className="text-mute">
                Value on paper: {sign(ev.valueBalance, 1)} z for you.
                {ev.me.drops.length > 0 && <> You must drop <b>{ev.me.drops.map((id) => ctx.byId.get(id)?.name).join(", ")}</b>.</>}
                {ev.me.adds.length > 0 && <> Open spot filled with <b>{ev.me.adds.map((id) => ctx.byId.get(id)?.name).join(", ")}</b> (best free agent).</>}
              </div>
              <Button variant="primary" size="sm" onClick={apply} disabled={!give.length || !get.length}>
                Record trade on the board
              </Button>
              <div className="text-[10px] text-dim">Make the trade in Yahoo, then record it here so lineups and matchups use the new rosters.</div>
            </div>
          )}
        </Panel>
      </div>
      {ev && (
        <Panel title="Your category changes (average week)" bodyClass="p-0">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-dim uppercase">
              <tr><th className="px-2 py-1 text-left">Cat</th><th className="text-right">Before</th><th className="text-right">After</th><th className="text-right">Change</th><th className="px-2 text-left">P(win) vs league before → after</th></tr>
            </thead>
            <tbody>
              {ev.categories.map((c) => {
                const pct = CAT_BY_KEY[c.cat].kind === "percentage";
                const f = (v: number) => (pct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1));
                const better = c.pAfter - c.pBefore;
                return (
                  <tr key={c.cat} className="border-t border-line/50">
                    <td className="px-2 py-1 font-semibold">{CAT_BY_KEY[c.cat].short}</td>
                    <td className="num text-right">{f(c.before)}</td>
                    <td className="num text-right">{f(c.after)}</td>
                    <td className={cn("num text-right", better > 0.01 ? "text-good" : better < -0.01 ? "text-bad" : "text-dim")}>{pct ? sign((c.after - c.before) * 100, 1) : sign(c.after - c.before, 1)}</td>
                    <td className="flex items-center gap-2 px-2 py-1"><ProbBar p={c.pBefore} width={60} /> → <ProbBar p={c.pAfter} width={60} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
      <Panel
        title="Trade finder"
        right={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => search(other)} disabled={searching}>Only {names[other].split(" ")[0]}</Button>
            <Button size="sm" variant="primary" onClick={() => search()} disabled={searching} data-testid="find-trades">Search all teams</Button>
          </div>
        }
        bodyClass="p-0"
      >
        {searching ? (
          <div className="p-3"><Spinner label="Evaluating every 1-for-1 and 2-for-1 trade…" /></div>
        ) : !ideas ? (
          <div className="p-3 text-xs text-mute">Searches every 1-for-1 swap and 2-for-1 consolidation (two of yours for one of their top players) and keeps trades that improve your team. Win-wins — where the other team improves too — come first, because those are the ones that get accepted.</div>
        ) : ideas.length === 0 ? (
          <div className="p-3 text-xs text-mute">No trade improves your team by more than 0.01 categories/week.</div>
        ) : (
          <table className="w-full text-xs" data-testid="trade-ideas">
            <thead className="text-[10px] text-dim uppercase">
              <tr><th className="px-2 py-1 text-left">Team</th><th className="text-left">You send</th><th className="text-left">You get</th><th className="text-right">You</th><th className="text-right">Them</th><th className="text-right" title="Value on paper (z)">Value</th><th /></tr>
            </thead>
            <tbody>
              {ideas.map((x, i) => (
                <tr key={i} className="border-t border-line/50">
                  <td className="px-2 py-1">{names[x.trade.partner]}</td>
                  <td>{x.trade.give.map((id) => ctx.byId.get(id)?.name).join(" + ")}</td>
                  <td>{x.trade.get.map((id) => ctx.byId.get(id)?.name).join(" + ")}</td>
                  <td className="num text-right text-good">{sign(x.myDelta)}</td>
                  <td className={cn("num text-right", x.theirDelta > 0 ? "text-good" : "text-bad")}>{sign(x.theirDelta)}</td>
                  <td className="num text-right">{sign(x.valueBalance, 1)}</td>
                  <td className="px-2 text-right">
                    {x.theirDelta > 0.02 && <Badge tone="good">WIN-WIN</Badge>}{" "}
                    <Button size="sm" variant="ghost" onClick={() => load(x.trade)}>Analyze</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <div className="text-[10px] text-dim">
        Method: each team&apos;s average week is projected for its best lineup (healthy players by value; out players on IL); “cats/week vs league” = expected categories won per week against every other team. Playoff weeks use real NBA games in those weeks. Remaining schedule = your scheduled opponents from the current week on. Projections are estimates — check injuries and news before trading.
      </div>
    </div>
  );
}
