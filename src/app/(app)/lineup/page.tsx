"use client";
import { useEffect, useMemo, useState } from "react";
import { CAT_BY_KEY } from "@/lib/categories";
import { BILLUR_SCHEDULE } from "@/lib/league";
import { weekRange } from "@/lib/engine/schedule";
import { matchupPeriods, parseSchedule, periodOf, planWeek, resolveTeam } from "@/lib/engine/lineup";
import { useEngineContext } from "@/client/analysis";
import { useActiveSession } from "@/client/store";
import { Badge, Button, cn, Panel, ProbBar, Spinner } from "@/components/ui";
import { PlayerLink } from "@/components/player";

const key = (id: string) => `wr.v1.matchups.${id}`;
const PERIODS = matchupPeriods();
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const periodLabel = (i: number) => {
  const w = PERIODS[i - 1];
  return w ? `${md(weekRange(w[0]).start)}–${md(weekRange(w[w.length - 1]).end)}` : "";
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function LineupPage() {
  const ctx = useEngineContext();
  const session = useActiveSession();
  const [schedule, setSchedule] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [week, setWeek] = useState(() => Math.max(1, Math.min(21, periodOf(new Date().toISOString().slice(0, 10)))));

  useEffect(() => {
    if (!session) return;
    let saved: string[] | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key(session.id)) ?? "null");
    } catch {
      saved = null;
    }
    const isBillur = session.settings.teamNames.some((n) => n.startsWith("Barış"));
    setSchedule(saved ?? (isBillur ? BILLUR_SCHEDULE : []));
  }, [session]);

  const opponents = useMemo(() => (ctx ? schedule.map((n) => resolveTeam(n, ctx.settings.teamNames)) : []), [ctx, schedule]);
  const plan = useMemo(() => {
    const opp = opponents[week - 1];
    if (!ctx || opp == null || opp < 0) return null;
    return planWeek(ctx, week, opp);
  }, [ctx, opponents, week]);
  const season = useMemo(() => {
    if (!ctx) return [];
    return opponents.map((opp, i) => (opp >= 0 ? { week: i + 1, opp, plan: planWeek(ctx, i + 1, opp) } : null)).filter(Boolean) as { week: number; opp: number; plan: ReturnType<typeof planWeek> }[];
  }, [ctx, opponents]);

  if (!ctx || !session) return <Spinner />;
  const myCount = ctx.rosters[ctx.myIndex].length;
  const saveSchedule = () => {
    const parsed = parseSchedule(text);
    if (!parsed.length) return;
    setSchedule(parsed);
    try {
      localStorage.setItem(key(session.id), JSON.stringify(parsed));
    } catch {
      /* storage unavailable */
    }
    setEditing(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold tracking-tight">Matchups & Lineup</h1>
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="ghost" disabled={week <= 1} onClick={() => setWeek(week - 1)}>
            ◀
          </Button>
          <select className="h-7 rounded border border-line bg-panel2 px-2" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
            {schedule.map((n, i) => (
              <option key={i} value={i + 1}>
                Week {i + 1} ({periodLabel(i + 1)}) — {n}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" disabled={week >= schedule.length} onClick={() => setWeek(week + 1)}>
            ▶
          </Button>
          <Button size="sm" onClick={() => { setText(schedule.map((n, i) => `${i + 1}\t${n}`).join("\n")); setEditing(!editing); }}>
            Edit schedule
          </Button>
        </div>
      </div>
      {editing && (
        <Panel title="Paste your Yahoo schedule (week number + opponent per line)">
          <textarea value={text} onChange={(e) => setText(e.target.value)} className="h-40 w-full rounded-md border border-line bg-bg p-2 font-mono text-xs" />
          <Button size="sm" variant="primary" className="mt-2" onClick={saveSchedule}>
            Save schedule
          </Button>
        </Panel>
      )}
      {myCount < ctx.starters && <Panel><div className="text-sm text-yellow-300">Your roster on the draft board has {myCount} players — enter the full draft (all teams) so lineups and matchups are accurate.</div></Panel>}
      {!plan ? (
        <Panel><div className="text-sm text-mute">No opponent resolved for week {week}. Edit the schedule so team names match the league settings.</div></Panel>
      ) : (
        <div className="grid gap-3 xl:grid-cols-3">
          <Panel title={`Week ${week} · ${md(plan.dates.start)}–${md(plan.dates.end)}${plan.weeks.length > 1 ? " (All-Star break, 2 weeks)" : ""} · vs ${ctx.settings.teamNames[plan.opponent]}`} className="xl:col-span-1">
            <div className="mb-2 flex items-center gap-3">
              <div>
                <div className="text-[10px] text-dim uppercase">Win probability</div>
                <div className={cn("num text-2xl font-bold", plan.winProb >= 0.6 ? "text-good" : plan.winProb >= 0.45 ? "text-warn" : "text-bad")}>{(plan.winProb * 100).toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-[10px] text-dim uppercase">Expected categories</div>
                <div className="num text-2xl font-bold">{plan.expectedCats.toFixed(1)} – {(ctx.cats.length - plan.expectedCats).toFixed(1)}</div>
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="text-[10px] text-dim uppercase"><tr><th className="text-left">Cat</th><th className="text-right">You</th><th className="text-right">Them</th><th className="pl-2 text-left">P(win)</th></tr></thead>
              <tbody>
                {plan.categories.map((c) => {
                  const pct = CAT_BY_KEY[c.cat].kind === "percentage";
                  return (
                    <tr key={c.cat} className="border-t border-line/50">
                      <td className="py-1">
                        {CAT_BY_KEY[c.cat].short} {c.swing && <Badge tone="accent">SWING</Badge>}
                      </td>
                      <td className="num text-right">{pct ? `${(c.mine * 100).toFixed(1)}%` : c.mine.toFixed(1)}</td>
                      <td className="num text-right">{pct ? `${(c.theirs * 100).toFixed(1)}%` : c.theirs.toFixed(1)}</td>
                      <td className="pl-2"><ProbBar p={c.pWin} width={70} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 text-[10px] text-dim">Weekly totals with projected games for this week. SWING = categories between 30% and 70% — where lineup and pickup decisions matter most.</div>
            {plan.notes.map((n) => <div key={n} className="mt-1 text-[11px] text-yellow-300">{n}</div>)}
          </Panel>
          <Panel title="Recommended lineup (this matchup)" bodyClass="p-0">
            <table className="w-full text-xs" data-testid="lineup-table">
              <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Slot</th><th className="text-left">Player</th><th className="text-right" title="Scheduled NBA games in this matchup">Gm</th>{plan.daily.length > 0 && <th className="text-right" title="Days he gets a starting slot in the daily plan">Starts</th>}<th className="px-2 text-right" title="Expected categories gained this week">Impact</th></tr></thead>
              <tbody>
                {plan.lineup.map((r) => (
                  <tr key={r.id} className={cn("border-t border-line/50", r.slot === "BN" && "opacity-70", r.slot === "IL" && "opacity-50")}>
                    <td className={cn("px-2 py-1 font-semibold", r.slot === "BN" ? "text-dim" : r.slot === "IL" ? "text-bad" : "text-accent")}>{r.slot}</td>
                    <td><PlayerLink p={ctx.byId.get(r.id)!} /></td>
                    <td className="num text-right">{plan.daily.length > 0 ? r.scheduled : r.games.toFixed(1)}</td>
                    {plan.daily.length > 0 && <td className={cn("num text-right", r.starts < r.scheduled && "text-warn")}>{r.slot === "IL" ? "—" : r.starts}</td>}
                    <td className="num px-2 text-right">{r.slot === "IL" ? "—" : `+${r.score.toFixed(2)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 py-1.5 text-[10px] text-dim">Slots = best lineup for the whole matchup. In a daily league use the day-by-day plan below: it re-slots every game day. Impact = expected categories won added this week, so it favours swing categories over ones you already win or lose.</div>
          </Panel>
          <Panel title="Waiver pickups for this matchup" bodyClass="p-0">
            <table className="w-full text-xs">
              <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Free agent</th><th className="px-2 text-right">Impact</th><th className="px-2 text-right">vs worst rostered</th></tr></thead>
              <tbody>
                {plan.pickups.map((p) => (
                  <tr key={p.id} className="border-t border-line/50">
                    <td className="px-2 py-1"><PlayerLink p={ctx.byId.get(p.id)!} /></td>
                    <td className="num px-2 text-right">+{p.score.toFixed(2)}</td>
                    <td className={cn("num px-2 text-right", p.gain > 0 ? "text-good" : "text-dim")}>{p.gain > 0 ? "+" : ""}{p.gain.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 py-1.5 text-[10px] text-dim">Free agents = players not on the draft board. Positive “vs worst rostered” means he would help this week more than {plan.pickups[0]?.replaces ? ctx.byId.get(plan.pickups[0].replaces)?.name : "your weakest player"}.</div>
          </Panel>
        </div>
      )}
      {plan && plan.daily.length > 0 && (
        <Panel title="Day-by-day lineup (set this in Yahoo each day)" bodyClass="p-0 overflow-x-auto">
          <table className="w-full text-xs" data-testid="daily-table">
            <thead className="text-[10px] text-dim uppercase">
              <tr>
                <th className="px-2 py-1 text-left">Player</th>
                {plan.daily.map((d) => (
                  <th key={d.date} className="px-1 text-center">
                    {DOW[new Date(d.date + "T12:00:00Z").getUTCDay()]} {md(d.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plan.lineup.filter((r) => r.slot !== "IL").map((r) => (
                <tr key={r.id} className="border-t border-line/50">
                  <td className="px-2 py-1 whitespace-nowrap"><PlayerLink p={ctx.byId.get(r.id)!} /></td>
                  {plan.daily.map((d) => {
                    const st = d.starters.find((x) => x.id === r.id);
                    const sit = d.sit.includes(r.id);
                    return (
                      <td key={d.date} className={cn("px-1 text-center font-semibold", st ? "text-accent" : sit ? "bg-red-500/10 text-bad" : "text-dim/40")}>
                        {st ? st.slot : sit ? "BN" : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t border-line text-[10px] text-dim">
                <td className="px-2 py-1">Starters / slots</td>
                {plan.daily.map((d) => (
                  <td key={d.date} className="num px-1 text-center">{d.starters.length}/{ctx.starters}</td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="px-2 py-1.5 text-[10px] text-dim">Slot = where to put him that day · BN (red) = has a game but no slot fits (sit him; pick the lower-impact player) · “·” = no NBA game. Uses the official 2026-27 NBA schedule; re-check injuries before lock.</div>
        </Panel>
      )}
      <Panel title="Season outlook (regular season)" bodyClass="p-0">
        <table className="w-full text-xs">
          <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Week</th><th className="text-left">Opponent</th><th className="text-right">Exp. cats</th><th className="px-2">Win prob</th><th className="text-left">Swing categories</th></tr></thead>
          <tbody>
            {season.map((s) => (
              <tr key={s.week} className={cn("cursor-pointer border-t border-line/50 hover:bg-panel2", s.week === week && "bg-panel2")} onClick={() => setWeek(s.week)}>
                <td className="num px-2 py-1">{s.week} <span className="text-dim">{periodLabel(s.week)}</span></td>
                <td>{ctx.settings.teamNames[s.opp]}</td>
                <td className="num text-right">{s.plan.expectedCats.toFixed(1)}</td>
                <td className="px-2"><ProbBar p={s.plan.winProb} /></td>
                <td className="text-mute">{s.plan.categories.filter((c) => c.swing).map((c) => CAT_BY_KEY[c.cat].short).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-2 py-1.5 text-[10px] text-dim">
          Expected record: {season.reduce((a, s) => a + s.plan.winProb, 0).toFixed(1)} – {(season.length - season.reduce((a, s) => a + s.plan.winProb, 0)).toFixed(1)} (most-categories view) · {season.reduce((a, s) => a + s.plan.expectedCats, 0).toFixed(0)} expected category wins.
        </div>
      </Panel>
    </div>
  );
}
