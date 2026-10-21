"use client";
import { useMemo, useState } from "react";
import { CAT_BY_KEY } from "@/lib/categories";
import { weekRange } from "@/lib/engine/schedule";
import { matchupPeriods, parseSchedule, planWeek, type LineupOverrides } from "@/lib/engine/lineup";
import { currentPeriod, useMatchupSchedule } from "@/client/matchups";
import { todayET, useMatchupSync, usePlanOptions } from "@/client/matchup-sync";
import { YahooSyncPanel } from "@/components/lineup/yahoo-sync-panel";
import { TodayCard } from "@/components/lineup/today-card";
import { CoachPanel } from "@/components/lineup/coach-panel";
import { useEngineContext } from "@/client/analysis";
import { useActiveSession } from "@/client/store";
import { Badge, Button, cn, Panel, ProbBar, Spinner } from "@/components/ui";
import { PlayerLink } from "@/components/player";

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
  const { schedule, opponents, save } = useMatchupSchedule(ctx);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [week, setWeek] = useState(() => currentPeriod(21));

  const today = todayET();
  const { sync, save: saveSync } = useMatchupSync();
  const planOpts = usePlanOptions(sync, week);
  const [overrides, setOverrides] = useState<Record<number, LineupOverrides>>({});
  const ov = overrides[week];
  const optimal = useMemo(() => {
    const opp = opponents[week - 1];
    if (!ctx || opp == null || opp < 0) return null;
    return planWeek(ctx, week, opp, planOpts);
  }, [ctx, opponents, week, planOpts]);
  const plan = useMemo(() => {
    const opp = opponents[week - 1];
    if (!ctx || !optimal || !ov || !Object.keys(ov).length) return optimal;
    return planWeek(ctx, week, opp, { ...planOpts, overrides: ov });
  }, [ctx, opponents, week, optimal, ov, planOpts]);
  /** Lineup analyzer: clicking a game day flips start ↔ sit for that player. */
  const toggleCell = (date: string, id: string, started: boolean) => {
    const day = { ...(ov?.[date] ?? {}) };
    const want = started ? "sit" : "start";
    const recommended = optimal?.daily.find((d) => d.date === date)?.starters.some((x) => x.id === id) ? "start" : "sit";
    if (want === recommended) delete day[id];
    else day[id] = want;
    const next = { ...(ov ?? {}), [date]: day };
    if (!Object.keys(day).length) delete next[date];
    setOverrides({ ...overrides, [week]: next });
  };
  const nOverrides = ov ? Object.values(ov).reduce((a, d) => a + Object.keys(d).length, 0) : 0;
  const season = useMemo(() => {
    if (!ctx) return [];
    // Your synced Yahoo roster is the best guess for future weeks too.
    return opponents
      .map((opp, i) => (opp >= 0 ? { week: i + 1, opp, plan: planWeek(ctx, i + 1, opp, i + 1 === week ? { ...planOpts, pickups: false } : { pickups: false, rosters: sync ? { mine: sync.mine } : null }) } : null))
      .filter(Boolean) as { week: number; opp: number; plan: ReturnType<typeof planWeek> }[];
  }, [ctx, opponents, week, planOpts, sync]);

  if (!ctx || !session) return <Spinner />;
  const myCount = sync?.week === week ? sync.mine.length : ctx.rosters[ctx.myIndex].length;
  const saveSchedule = () => {
    const parsed = parseSchedule(text);
    if (!parsed.length) return;
    save(parsed);
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
      <div className="grid gap-3 xl:grid-cols-2">
        <YahooSyncPanel ctx={ctx} sync={sync} onSave={saveSync} week={week} />
        {plan && plan.daily.length > 0 && today >= plan.dates.start && today <= plan.dates.end && <TodayCard ctx={ctx} plan={plan} today={today} />}
      </div>
      {myCount < ctx.starters && <Panel><div className="text-sm text-yellow-300">Your roster has {myCount} players — sync from Yahoo (above) or enter the full draft so lineups and matchups are accurate.</div></Panel>}
      {plan && <CoachPanel ctx={ctx} plan={plan} opts={planOpts} sync={sync?.week === week ? sync : null} today={today} onApply={(o) => setOverrides({ ...overrides, [week]: o })} />}
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
            <div className="mt-2 text-[10px] text-dim">
              {plan.remaining.actualUsed ? `Projected final totals = Yahoo totals so far + projected games from ${plan.remaining.fromDate} (${plan.remaining.me} starts left for you, ${plan.remaining.opp} for them).` : "Projected weekly totals."} SWING = categories between 30% and 70% — where lineup and pickup decisions matter most.
            </div>
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
          <Panel title="Streaming: best adds for the rest of this matchup" bodyClass="p-0">
            <table className="w-full text-xs" data-testid="streaming">
              <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Add</th><th className="text-left">Games left</th><th className="text-left">Drop</th><th className="px-2 text-right" title="Expected categories gained this week from the games he would actually start">Gain</th></tr></thead>
              <tbody>
                {plan.pickups.map((p) => (
                  <tr key={p.id} className="border-t border-line/50">
                    <td className="px-2 py-1"><PlayerLink p={ctx.byId.get(p.id)!} /></td>
                    <td className="text-mute">{(p.days ?? []).map((d) => DOW[new Date(d + "T12:00:00Z").getUTCDay()]).join(" ") || "—"}</td>
                    <td className="text-mute">{p.replaces ? ctx.byId.get(p.replaces)?.name : "—"}</td>
                    <td className={cn("num px-2 text-right", p.gain > 0 ? "text-good" : "text-dim")}>{p.gain > 0 ? "+" : ""}{p.gain.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-2 py-1.5 text-[10px] text-dim">Schedule-aware: counts only the games he would actually start on the remaining days (open slots or beating a starter), minus the dropped player&apos;s lost starts. Free agents = players on no roster (draft board / Yahoo sync).</div>
          </Panel>
        </div>
      )}
      {plan && plan.daily.length > 0 && (
        <Panel
          title="Day-by-day lineup & lineup analyzer"
          right={nOverrides > 0 && <Button size="sm" variant="ghost" onClick={() => setOverrides({ ...overrides, [week]: {} })}>Reset to recommended</Button>}
          bodyClass="p-0 overflow-x-auto"
        >
          {nOverrides > 0 && optimal && (
            <div className="flex flex-wrap items-center gap-4 border-b border-line bg-panel2 px-2 py-2 text-xs" data-testid="lineup-analyzer">
              <span>Your lineup ({nOverrides} change{nOverrides > 1 ? "s" : ""}):</span>
              <span>win <b className="num">{(plan.winProb * 100).toFixed(0)}%</b> vs recommended <b className="num">{(optimal.winProb * 100).toFixed(0)}%</b></span>
              <span>categories <b className="num">{plan.expectedCats.toFixed(2)}</b> vs <b className="num">{optimal.expectedCats.toFixed(2)}</b></span>
              <span className={cn("font-semibold", plan.expectedCats - optimal.expectedCats < -0.005 ? "text-bad" : plan.expectedCats - optimal.expectedCats > 0.005 ? "text-good" : "text-dim")}>
                {plan.expectedCats - optimal.expectedCats < -0.005 ? `costs ${(optimal.expectedCats - plan.expectedCats).toFixed(2)} expected categories` : plan.expectedCats - optimal.expectedCats > 0.005 ? "better than recommended" : "no meaningful difference"}
              </span>
              <span className="text-dim">
                {plan.categories.filter((c, i) => Math.abs(c.pWin - optimal.categories[i].pWin) > 0.01).map((c) => `${CAT_BY_KEY[c.cat].short} ${((c.pWin - optimal.categories.find((o) => o.cat === c.cat)!.pWin) * 100).toFixed(0)}pp`).slice(0, 9).join(" · ") || ""}
              </span>
            </div>
          )}
          <table className="w-full text-xs" data-testid="daily-table">
            <thead className="text-[10px] text-dim uppercase">
              <tr>
                <th className="px-2 py-1 text-left">Player</th>
                {plan.daily.map((d) => (
                  <th key={d.date} className={cn("px-1 text-center", d.date === today && "text-accent")}>
                    {d.date === today ? "Today" : DOW[new Date(d.date + "T12:00:00Z").getUTCDay()]} {md(d.date)}
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
                    const prot = d.protect?.includes(r.id);
                    const out = d.out?.includes(r.id);
                    const forced = ov?.[d.date]?.[r.id];
                    return (
                      <td
                        key={d.date}
                        onClick={st || sit ? () => toggleCell(d.date, r.id, !!st) : undefined}
                        title={out ? "Reported out" : prot ? "Benched on purpose: expected to cost more (FG%/FT%/TO) than he adds — click to start anyway" : st || sit ? (st ? "Click to sit him this day" : "Click to start him this day") : undefined}
                        className={cn("px-1 text-center font-semibold", (st || sit) && "cursor-pointer hover:bg-panel2", d.date === today && "bg-accent/5", st ? "text-accent" : out ? "text-bad" : prot ? "bg-yellow-500/10 text-warn" : sit ? "bg-red-500/10 text-bad" : "text-dim/40", forced && "ring-1 ring-inset ring-sky-400")}
                      >
                        {st ? st.slot : out ? "OUT" : prot ? "BN*" : sit ? "BN" : "·"}
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
          <div className="px-2 py-1.5 text-[10px] text-dim">Slot = where to put him that day · BN (red) = has a game but no slot fits · BN* (amber) = benched on purpose (his game is expected to hurt FG%/FT%/TO more than it helps) · OUT = reported out · “·” = no NBA game.{plan.remaining.fromDate ? ` Days before ${plan.remaining.fromDate} are already in the Yahoo totals.` : ""} Lineup analyzer: click any game day to start/sit a player your way — the matchup is re-projected and compared with the recommended lineup (blue outline = your change). Uses the official 2026-27 NBA schedule; re-check injuries before lock.</div>
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
