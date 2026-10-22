"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { CAT_BY_KEY } from "@/lib/categories";
import type { CategoryKey, SlotPos } from "@/lib/types";
import type { WaiverAdvice } from "@/lib/coach";
import { nameKey } from "@/lib/names";
import { planWeek } from "@/lib/engine/lineup";
import { dropCandidates, scanFreeAgents, teamNeeds, upcomingGames, type FreeAgentRow } from "@/lib/engine/freeagents";
import { useEngineContext } from "@/client/analysis";
import { currentPeriod, useMatchupSchedule } from "@/client/matchups";
import { todayET, useLeagueSync, useMatchupSync, usePlanOptions } from "@/client/matchup-sync";
import { useRecordMove } from "@/client/roster-moves";
import { useStore } from "@/client/store";
import { Badge, Button, cn, inputCls, Panel, ProbBar, Spinner, Tabs } from "@/components/ui";
import { PlayerLink } from "@/components/player";
import { LeagueSyncPanel } from "@/components/free-agents/league-sync-panel";

type View = "season" | "stream" | "hot" | "category" | "next" | "stash" | "watch";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dow = (d: string) => DOW[new Date(d + "T12:00:00Z").getUTCDay()];
const sign = (v: number, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
const NEED_TONE = { strong: "good", swing: "accent", weak: "warn", punt: "bad" } as const;

export default function FreeAgentsPage() {
  const ctx = useEngineContext();
  const { opponents } = useMatchupSchedule(ctx);
  const { sync } = useMatchupSync();
  const { sync: league } = useLeagueSync();
  const watch = useStore((s) => s.watchlist);
  const toggleWatch = useStore((s) => s.toggleWatch);
  const record = useRecordMove();
  const today = todayET();
  const period = currentPeriod(opponents.length || 21);
  const planOpts = usePlanOptions(sync, period);
  const [view, setView] = useState<View>("season");
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<SlotPos | "ALL">("ALL");
  const [cat, setCat] = useState<CategoryKey>("blk");
  const [hideInjured, setHideInjured] = useState(true);
  const [minGames, setMinGames] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [stream, setStream] = useState<Map<string, { gain: number; drop: string | null; days: string[] }> | null>(null);

  const mine = useMemo(() => (ctx ? ctx.rosters[ctx.myIndex] : []), [ctx]);
  const needs = useMemo(() => (ctx ? teamNeeds(ctx) : []), [ctx]);
  const drops = useMemo(() => (ctx ? dropCandidates(ctx) : []), [ctx]);
  const rows = useMemo(() => (ctx ? scanFreeAgents(ctx, { period, today }) : []), [ctx, period, today]);

  // Weekly streaming gain from the daily planner (schedule + open slots), computed after first paint.
  useEffect(() => {
    if (!ctx) return;
    setStream(null);
    const opp = opponents[period - 1];
    if (opp == null || opp < 0) return setStream(new Map());
    const t = setTimeout(() => {
      const pool = rows.filter((r) => !r.injured).slice(0, 90).map((r) => r.id);
      const plan = planWeek(ctx, period, opp, { ...planOpts, pickupPool: pool, pickupCount: pool.length });
      setStream(new Map(plan.pickups.map((p) => [p.id, { gain: p.gain, drop: p.replaces, days: p.days ?? [] }])));
    }, 30);
    return () => clearTimeout(t);
  }, [ctx, rows, opponents, period, planOpts]);

  const list = useMemo(() => {
    const k = nameKey(q);
    let r = rows.filter((x) => {
      const p = ctx?.byId.get(x.id);
      if (!p) return false;
      if (k && !nameKey(p.name).includes(k)) return false;
      if (pos !== "ALL" && !p.elig.includes(pos)) return false;
      if (view === "stash") return x.injured;
      if (view === "watch") return watch.includes(x.id);
      if (hideInjured && x.injured) return false;
      if (minGames && x.gamesLeftWeek < minGames) return false;
      return true;
    });
    const key = (x: FreeAgentRow): number => {
      switch (view) {
        case "stream":
          return stream?.get(x.id)?.gain ?? -99;
        case "hot":
          return x.recent ? x.recent.value : -99;
        case "category":
          return x.catZ[cat] ?? -99;
        case "next":
          return x.gamesNextWeek * 10 + x.value;
        case "stash":
          return x.value;
        default:
          return x.seasonGain;
      }
    };
    r = [...r].sort((a, b) => key(b) - key(a));
    if (view === "hot") r = r.filter((x) => x.recent);
    return r.slice(0, 60);
  }, [rows, q, pos, view, hideInjured, minGames, watch, stream, cat, ctx]);

  if (!ctx) return <Spinner />;
  const name = (id: string | null | undefined) => (id ? (ctx.byId.get(id)?.name ?? id) : "—");
  const poolSource = league ? `Yahoo league rosters (synced ${new Date(league.syncedAt).toLocaleDateString()})` : sync ? "draft board + your Yahoo matchup sync" : "draft board";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Free Agents</h1>
          <div className="text-xs text-mute">{ctx.available.length} free agents · pool from {poolSource}{!league && <span className="text-warn"> — sync league rosters for an exact pool</span>}</div>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <LeagueSyncPanel ctx={ctx} />
        <Panel title="Your team's needs (vs the league)">
          <div className="space-y-1 text-xs" data-testid="team-needs">
            {needs.map((n) => (
              <div key={n.cat} className="flex items-center gap-2">
                <span className="w-10 font-semibold">{CAT_BY_KEY[n.cat].short}</span>
                <ProbBar p={n.pWin} width={110} />
                <Badge tone={NEED_TONE[n.label]}>{n.label}</Badge>
              </div>
            ))}
            <div className="pt-1 text-[10px] text-dim">P(win category) per week vs the average team. Free agents get the most credit for swing categories; punted ones barely count.</div>
          </div>
        </Panel>
        <Panel title="Drop candidates" bodyClass="p-0">
          <table className="w-full text-xs" data-testid="drop-candidates">
            <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">Player</th><th className="text-right" title="Change in expected categories per week if swapped for the best free agent (positive = upgrade)">Swap Δ</th><th className="px-2 text-left">Best replacement · note</th></tr></thead>
            <tbody>
              {drops.slice(0, 6).map((d) => (
                <tr key={d.id} className="border-t border-line/50">
                  <td className="px-2 py-1"><PlayerLink p={ctx.byId.get(d.id)!} /></td>
                  <td className={cn("num text-right", d.lossIfDropped > 0.005 ? "text-good" : d.lossIfDropped < -0.1 ? "text-bad" : "")}>{sign(d.lossIfDropped)}</td>
                  <td className="px-2 text-mute">{d.replacement ? `${name(d.replacement)} · ` : ""}{d.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
          <Tabs
            value={view}
            onChange={setView}
            options={[
              { value: "season", label: "Best adds" },
              { value: "stream", label: "Stream this week" },
              { value: "hot", label: "Hot (14 days)" },
              { value: "category", label: "By category" },
              { value: "next", label: "Next week" },
              { value: "stash", label: "Injured stash" },
              { value: "watch", label: `Watchlist (${watch.length})` },
            ]}
          />
          {view === "category" && (
            <select value={cat} onChange={(e) => setCat(e.target.value as CategoryKey)} className={cn(inputCls, "h-7")}>
              {ctx.cats.map((c) => <option key={c} value={c}>{CAT_BY_KEY[c].short}</option>)}
            </select>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={cn(inputCls, "h-7 w-36")} />
          <select value={pos} onChange={(e) => setPos(e.target.value as SlotPos | "ALL")} className={cn(inputCls, "h-7")}>
            {["ALL", "PG", "SG", "SF", "PF", "C"].map((x) => <option key={x}>{x}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={hideInjured} onChange={(e) => setHideInjured(e.target.checked)} /> hide injured</label>
          <label className="flex items-center gap-1 text-xs">min games left this week
            <select value={minGames} onChange={(e) => setMinGames(Number(e.target.value))} className={cn(inputCls, "h-7")}>{[0, 1, 2, 3, 4].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          {view === "stream" && !stream && <Spinner label="planning the week…" />}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs [&_td]:px-1.5 [&_th]:px-1.5" data-testid="fa-table">
            <thead className="text-[10px] text-dim uppercase">
              <tr>
                <th className="px-2 py-1 text-left">Player</th>
                <th className="text-right" title="Expected categories won per week vs the league, rest of season, with the best drop">Season Δ</th>
                <th className="text-left">Drop</th>
                <th className="text-right" title="Expected categories gained in this matchup from the games he would actually start">Week Δ</th>
                <th className="text-left" title="Remaining game days this matchup">This week</th>
                <th className="text-right" title="Games next matchup (back-to-backs)">Next</th>
                <th className="text-right" title="Value of his last-14-days line (games)">Last 14d</th>
                <th className="text-right" title="Projected per-game value (total z)">Value</th>
                <th className="text-left">Strengths</th>
                <th className="text-right" title="How well his strengths match your swing/weak categories">Fit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const p = ctx.byId.get(r.id)!;
                const st = stream?.get(r.id);
                const isOpen = open === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={cn("cursor-pointer border-t border-line/50 hover:bg-panel2", isOpen && "bg-panel2")} onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td className="px-2 py-1 whitespace-nowrap">
                        <PlayerLink p={p} /> {r.status && <Badge tone={r.injured ? "bad" : "warn"}>{r.status.replace(/_/g, " ")}</Badge>}
                      </td>
                      <td className={cn("num text-right", r.seasonGain > 0.02 ? "text-good" : r.seasonGain < 0 ? "text-dim" : "")}>{sign(r.seasonGain)}</td>
                      <td className="px-2 text-mute">{view === "stream" ? (st && st.gain > 0 ? name(st.drop) : "—") : r.seasonGain > 0 ? name(r.seasonDrop) : "—"}</td>
                      <td className={cn("num text-right", st && st.gain > 0.02 ? "text-good" : "text-dim")}>{st ? sign(st.gain) : stream ? "—" : "…"}</td>
                      <td className="whitespace-nowrap text-mute">{r.gamesLeftWeek} {st?.days.length ? `(${st.days.map(dow).join(" ")})` : ""}</td>
                      <td className="num text-right">{r.gamesNextWeek}{r.b2bNextWeek ? <span className="text-dim"> ({r.b2bNextWeek} b2b)</span> : ""}</td>
                      <td className={cn("num text-right", r.recent && r.recent.trend > 1 ? "text-good" : r.recent && r.recent.trend < -1 ? "text-bad" : "")}>{r.recent ? `${r.recent.value.toFixed(1)} (${r.recent.games})` : "—"}</td>
                      <td className="num text-right">{r.value.toFixed(2)}</td>
                      <td>{r.topCats.map((c) => <span key={c} className="mr-1 rounded bg-panel2 px-1 text-[10px]">{CAT_BY_KEY[c].short}</span>)}</td>
                      <td className="num text-right">{r.fit.toFixed(1)}</td>
                      <td className="px-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => toggleWatch(r.id)} className={cn("mr-2", watch.includes(r.id) ? "text-accent" : "text-dim")} title="Watchlist">★</button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-panel2/50">
                        <td colSpan={11} className="px-3 py-2">
                          <FaDetail ctx={ctx} row={r} today={today} mine={mine} stream={st} preferStream={view === "stream"} onRecord={(drop) => record(r.id, drop)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && <div className="p-3 text-xs text-mute">No free agents match these filters.</div>}
        </div>
        <div className="border-t border-line px-2 py-1.5 text-[10px] text-dim">
          Season Δ = change in expected categories won per week vs the whole league if he replaces the suggested drop (rest of season). Week Δ = this matchup only, counting just the games he would start on open-slot days. Click a row for category impact, schedule and the add/drop button.
        </div>
      </Panel>

      <WaiverAdvisor ctx={ctx} rows={rows} stream={stream} needs={needs} drops={drops} today={today} period={period} />
    </div>
  );
}

function FaDetail({ ctx, row, today, mine, stream, preferStream, onRecord }: { ctx: NonNullable<ReturnType<typeof useEngineContext>>; row: FreeAgentRow; today: string; mine: string[]; stream?: { gain: number; drop: string | null; days: string[] }; preferStream?: boolean; onRecord: (drop: string) => void }) {
  const p = ctx.byId.get(row.id)!;
  const j = p.proj;
  const games = upcomingGames(ctx, p.team, today, 14);
  const [drop, setDrop] = useState<string>((preferStream ? stream?.drop : row.seasonDrop) ?? row.seasonDrop ?? stream?.drop ?? mine[0] ?? "");
  const r = p.live?.recent;
  return (
    <div className="grid gap-3 text-xs md:grid-cols-3">
      <div>
        <div className="mb-1 text-[10px] tracking-wider text-dim uppercase">Category impact (season move)</div>
        {ctx.cats.map((c) => {
          const d = row.catDelta[c] ?? 0;
          return (
            <div key={c} className="flex items-center gap-2">
              <span className="w-10">{CAT_BY_KEY[c].short}</span>
              <div className="relative h-2 w-28 rounded bg-panel">
                <div className={cn("absolute top-0 h-2 rounded", d >= 0 ? "left-1/2 bg-good/70" : "right-1/2 bg-bad/70")} style={{ width: `${Math.min(50, Math.abs(d) * 500)}%` }} />
              </div>
              <span className={cn("num", d > 0.005 ? "text-good" : d < -0.005 ? "text-bad" : "text-dim")}>{d >= 0 ? "+" : ""}{(d * 100).toFixed(1)}pp</span>
            </div>
          );
        })}
      </div>
      <div>
        <div className="mb-1 text-[10px] tracking-wider text-dim uppercase">Next 14 days ({games.length} games)</div>
        <div className="flex flex-wrap gap-1">
          {games.map((g) => <span key={g.date} className="rounded bg-panel px-1.5 py-0.5"><b>{dow(g.date)} {Number(g.date.slice(5, 7))}/{Number(g.date.slice(8))}</b> {g.home ? "vs" : "@"} {g.opp}</span>)}
        </div>
        {j && (
          <div className="mt-2 text-mute">
            Projection: {j.pts.toFixed(1)} pts · {j.fg3m.toFixed(1)} 3pm · {j.reb.toFixed(1)} reb · {j.ast.toFixed(1)} ast · {j.stl.toFixed(1)} stl · {j.blk.toFixed(1)} blk · {j.fga ? ((j.fgm / j.fga) * 100).toFixed(1) : "—"}% FG · {j.fta ? ((j.ftm / j.fta) * 100).toFixed(1) : "—"}% FT · {j.tov.toFixed(1)} to · {j.min.toFixed(0)} min
          </div>
        )}
        {r && r.gp > 0 && (
          <div className="mt-1 text-mute">
            Last 14 days ({r.gp} G): {(r.tot.pts / r.gp).toFixed(1)} pts · {(r.tot.reb / r.gp).toFixed(1)} reb · {(r.tot.ast / r.gp).toFixed(1)} ast · {(r.tot.min / r.gp).toFixed(0)} min
          </div>
        )}
      </div>
      <div className="space-y-2">
        <div className="text-[10px] tracking-wider text-dim uppercase">Make the move</div>
        <div className="flex items-center gap-2">
          <span>Drop</span>
          <select value={drop} onChange={(e) => setDrop(e.target.value)} className={cn(inputCls, "h-7 max-w-48")}>
            {mine.map((id) => <option key={id} value={id}>{ctx.byId.get(id)?.name}</option>)}
          </select>
          <Button size="sm" variant="primary" onClick={() => drop && onRecord(drop)} data-testid="record-add">Record add</Button>
        </div>
        <div className="text-[10px] text-dim">Make the add on Yahoo, then record it here so lineups, matchups and trades use the new roster.</div>
      </div>
    </div>
  );
}

function WaiverAdvisor({ ctx, rows, stream, needs, drops, today, period }: { ctx: NonNullable<ReturnType<typeof useEngineContext>>; rows: FreeAgentRow[]; stream: Map<string, { gain: number; drop: string | null; days: string[] }> | null; needs: ReturnType<typeof teamNeeds>; drops: ReturnType<typeof dropCandidates>; today: string; period: number }) {
  const record = useRecordMove();
  const [lang, setLang] = useState<"en" | "tr">(() => (typeof navigator !== "undefined" && navigator.language.startsWith("tr") ? "tr" : "en"));
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<{ loading: boolean; advice?: WaiverAdvice; error?: string; model?: string }>({ loading: false });
  const name = (id: string | null | undefined) => (id ? (ctx.byId.get(id)?.name ?? id) : null);
  const idByName = (n: string) => {
    const k = nameKey(n);
    return ctx.players.find((p) => nameKey(p.name) === k)?.id ?? null;
  };

  const ask = async () => {
    setState({ loading: true });
    const pick = new Set<string>();
    [...rows].sort((a, b) => b.seasonGain - a.seasonGain).slice(0, 12).forEach((r) => pick.add(r.id));
    if (stream) [...stream.entries()].sort((a, b) => b[1].gain - a[1].gain).slice(0, 8).forEach(([id]) => pick.add(id));
    rows.filter((r) => r.recent).sort((a, b) => (b.recent!.value - a.recent!.value)).slice(0, 5).forEach((r) => pick.add(r.id));
    rows.filter((r) => r.injured).slice(0, 3).forEach((r) => pick.add(r.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const facts = {
      today,
      matchupWeek: period,
      league: { categories: ctx.cats.map((c) => CAT_BY_KEY[c].short), ilSlots: ctx.settings.slots.IL, rosterSize: ctx.rosterSlots },
      teamProfile: needs.map((n) => ({ cat: CAT_BY_KEY[n.cat].short, pWinVsLeague: Math.round(n.pWin * 100) / 100, label: n.label })),
      myRoster: ctx.rosters[ctx.myIndex].map((id) => ({ player: name(id), status: ctx.byId.get(id)?.availability?.status ?? "HEALTHY" })),
      dropCandidates: drops.slice(0, 6).map((d) => ({ player: name(d.id), expectedCatsLostPerWeek: Math.round(d.lossIfDropped * 1000) / 1000, note: d.note, status: d.status ?? null })),
      freeAgents: [...pick].map((id) => {
        const r = byId.get(id)!;
        const p = ctx.byId.get(id)!;
        const s = stream?.get(id);
        return {
          player: p.name,
          team: p.team,
          positions: p.elig.join(","),
          status: r.status ?? "HEALTHY",
          seasonGainCatsPerWeek: Math.round(r.seasonGain * 1000) / 1000,
          suggestedDrop: name(r.seasonDrop),
          thisWeek: s ? { gain: Math.round(s.gain * 1000) / 1000, startDays: s.days, drop: name(s.drop) } : null,
          gamesLeftThisWeek: r.gamesLeftWeek,
          gamesNextWeek: r.gamesNextWeek,
          backToBacksNextWeek: r.b2bNextWeek,
          last14Days: r.recent ? { games: r.recent.games, value: Math.round(r.recent.value * 100) / 100, vsProjection: Math.round(r.recent.trend * 100) / 100 } : null,
          projectedValue: Math.round(r.value * 100) / 100,
          strengths: r.topCats.map((c) => CAT_BY_KEY[c].short),
        };
      }),
    };
    try {
      const res = await fetch("/api/waiver-coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts, language: lang, question: question || undefined }) });
      const d = (await res.json()) as { advice?: WaiverAdvice; error?: string; model?: string };
      setState({ loading: false, advice: d.advice, error: d.advice ? undefined : (d.error ?? `HTTP ${res.status}`), model: d.model });
    } catch (e) {
      setState({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const a = state.advice;
  const KIND = { "long-term": "good", stream: "accent", stash: "neutral", category: "warn" } as const;
  return (
    <Panel
      title="AI waiver advisor"
      right={
        <div className="flex items-center gap-2">
          <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "tr")} className="h-7 rounded border border-line bg-panel2 px-1 text-xs" aria-label="Language">
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
          <Button size="sm" variant="primary" onClick={ask} disabled={state.loading} data-testid="ask-waiver">{state.loading ? "Thinking…" : a ? "Ask again" : "Ask the AI"}</Button>
        </div>
      }
    >
      <div className="space-y-2 text-xs" data-testid="waiver-advisor">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Optional, e.g. “I need blocks without killing FT%” or “who should I stream this weekend?”" className="h-8 w-full rounded-md border border-line bg-bg px-2" />
        {state.loading && <Spinner label="Claude is weighing season value, this week's schedule, form and your needs…" />}
        {state.error && <div className="text-bad">{state.error}</div>}
        {!a && !state.loading && !state.error && <div className="text-mute">Sends the engine&apos;s scan (season and weekly gains, schedule, form, your category needs and drop candidates) to Claude for a prioritised plan: long-term adds, streams, stashes and who to keep.</div>}
        {a && (
          <div className="space-y-2">
            <div className="rounded-md border border-accent/40 bg-accent/10 p-2 text-sm font-semibold">{a.headline}</div>
            {a.moves.map((m, i) => {
              const add = idByName(m.add);
              const drop = idByName(m.drop);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND[m.kind]}>{m.kind}</Badge>
                  <span className="text-good">+ {m.add}</span>
                  <span className="text-bad">− {m.drop}</span>
                  <span className="text-dim">({m.timing})</span>
                  <span className="text-mute">{m.reason}</span>
                  {add && drop && <Button size="sm" variant="ghost" onClick={() => record(add, drop)}>Record</Button>}
                </div>
              );
            })}
            {a.watch.length > 0 && <div><span className="text-dim">Watch:</span> {a.watch.map((w) => `${w.player} — ${w.reason}`).join(" · ")}</div>}
            {a.keep.length > 0 && <div><span className="text-dim">Keep:</span> {a.keep.map((w) => `${w.player} — ${w.reason}`).join(" · ")}</div>}
            <div className="text-mute">{a.summary}</div>
            <div className="text-[10px] text-dim">AI advice by {state.model ?? "Claude"} based on the engine&apos;s numbers — check news before moving.</div>
          </div>
        )}
      </div>
    </Panel>
  );
}
