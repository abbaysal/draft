"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CAT_BY_KEY } from "@/lib/categories";
import { startingSlots } from "@/lib/league";
import { matchLineup } from "@/lib/positions";
import type { SlotPos } from "@/lib/types";
import { useEngineContext, useFast } from "@/client/analysis";
import { useStore } from "@/client/store";
import { Badge, Button, cn, Empty, Panel, ProbBar, Spinner, Tabs, inputCls } from "./ui";
import { PlayerLink, PlayerSearch, useDraftPlayer } from "./player";

export function MyRoster({ teamIndex }: { teamIndex?: number }) {
  const ctx = useEngineContext();
  if (!ctx) return null;
  const t = teamIndex ?? ctx.myIndex;
  const ids = ctx.rosters[t];
  const slots = startingSlots(ctx.settings);
  const sorted = [...ids].sort((a, b) => (ctx.values.get(b)?.total ?? -99) - (ctx.values.get(a)?.total ?? -99));
  const { assignment } = matchLineup(slots, sorted.map((id) => ctx.byId.get(id)!.elig));
  const used = new Set(assignment.filter((x) => x >= 0));
  const bench = sorted.filter((_, i) => !used.has(i));
  return (
    <Panel title={t === ctx.myIndex ? `My roster (${ids.length}/${ctx.settings.rounds})` : `${ctx.settings.teamNames[t]} roster`} bodyClass="p-0">
      <table className="w-full text-xs">
        <tbody>
          {slots.map((s, i) => {
            const pi = assignment[i];
            const p = pi >= 0 ? ctx.byId.get(sorted[pi]) : null;
            return (
              <tr key={i} className="border-b border-line/50">
                <td className="w-12 px-2 py-1 text-dim">{s}</td>
                <td className="px-2 py-1">{p ? <PlayerLink p={p} /> : <span className="text-dim italic">open</span>}</td>
                <td className="num px-2 py-1 text-right text-mute">{p ? (ctx.values.get(p.id)?.total.toFixed(1) ?? "—") : ""}</td>
              </tr>
            );
          })}
          {bench.map((id) => {
            const p = ctx.byId.get(id)!;
            return (
              <tr key={id} className="border-b border-line/50">
                <td className="w-12 px-2 py-1 text-dim">BN</td>
                <td className="px-2 py-1"><PlayerLink p={p} /></td>
                <td className="num px-2 py-1 text-right text-mute">{ctx.values.get(id)?.total.toFixed(1) ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export function CategoryOutlook() {
  const fast = useFast();
  const ctx = useEngineContext();
  if (!fast.result || !ctx) return <Panel title="Category outlook"><Spinner /></Panel>;
  const per = fast.result.rec.field.baseline.perCategory;
  const scar = new Map(fast.result.rec.scarcity.map((s) => [s.cat, s]));
  return (
    <Panel title="Category outlook" right={<span className="text-dim" title="Projected weekly win rate of your projected final roster vs the field">vs projected field</span>}>
      <div className="space-y-1">
        {ctx.cats.map((c) => {
          const s = scar.get(c);
          return (
            <div key={c} className="flex items-center justify-between gap-2 text-xs">
              <span className="w-10 font-medium" style={{ color: CAT_BY_KEY[c].color }}>{CAT_BY_KEY[c].short}</span>
              <ProbBar p={per[c]} width={110} />
              <span className="w-20 text-right text-[10px] text-dim" title="Share of draft-start supply left in the pool / strong (z≥1) contributors left">
                {s ? `${(s.supplyShare * 100).toFixed(0)}% · ${s.strongLeft} left` : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-mute">
        Expected category wins/week: <span className="num text-ink">{fast.result.rec.field.baseline.expectedCatWins.toFixed(2)}</span> · Matchup win: <span className="num text-ink">{(fast.result.rec.field.baseline.matchupWinProb * 100).toFixed(0)}%</span>
      </div>
    </Panel>
  );
}

export function AlertsPanel() {
  const fast = useFast();
  const ctx = useEngineContext();
  if (!fast.result || !ctx) return null;
  const alerts = fast.result.alerts;
  return (
    <Panel title={`Alerts (${alerts.length})`}>
      {alerts.length === 0 ? (
        <div className="text-xs text-dim">No alerts — nothing unusual right now.</div>
      ) : (
        <ul className="space-y-2" data-testid="alerts">
          {alerts.map((a) => (
            <li key={a.id} className="text-xs" title={`Trigger: ${a.trigger}`}>
              <div className="flex items-center gap-1.5">
                <Badge tone={a.severity === "critical" ? "bad" : a.severity === "warn" ? "warn" : "info"}>{a.severity.toUpperCase()}</Badge>
                <span className="font-medium">{a.title}</span>
              </div>
              <div className="mt-0.5 text-mute">{a.detail}</div>
              <div className="text-[10px] text-dim">Trigger: {a.trigger}</div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function RecentPicks({ n = 10 }: { n?: number }) {
  const ctx = useEngineContext();
  if (!ctx) return null;
  const picks = [...ctx.draft.picks].reverse().slice(0, n);
  return (
    <Panel title="Recent picks">
      {picks.length === 0 ? (
        <div className="text-xs text-dim">No picks yet.</div>
      ) : (
        <ul className="space-y-1 text-xs">
          {picks.map((p) => {
            const pl = ctx.byId.get(p.playerId);
            const mr = ctx.marketRank.get(p.playerId);
            return (
              <li key={p.overall} className="flex items-center justify-between gap-2">
                <span className="num w-8 text-dim">{p.overall}</span>
                <span className={cn("w-20 truncate", p.teamIndex === ctx.myIndex ? "text-accent" : "text-mute")}>{ctx.settings.teamNames[p.teamIndex]}</span>
                <span className="flex-1 truncate">{pl ? <PlayerLink p={pl} compact /> : p.playerId}</span>
                {mr != null && <span className={cn("num text-[10px]", mr - p.overall > 10 ? "text-good" : p.overall - mr > 10 ? "text-bad" : "text-dim")} title="Market rank of this player (positive = value, negative = reach)">{mr - p.overall > 0 ? "+" : ""}{mr - p.overall}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function OpponentPredictions({ max = 6 }: { max?: number }) {
  const fast = useFast();
  const ctx = useEngineContext();
  if (!fast.result || !ctx) return null;
  const preds = fast.result.avail.teamPredictions.slice(0, max);
  return (
    <Panel title="Before your next pick" right={<span className="text-dim">{fast.result.avail.horizon} opponent picks · {fast.result.avail.sims} sims</span>}>
      {preds.length === 0 ? (
        <div className="text-xs text-dim">You pick again immediately — no opponent picks in between.</div>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {preds.map((tp) => (
            <li key={tp.overall}>
              <div className="flex justify-between text-mute">
                <span>
                  #{tp.overall} {ctx.settings.teamNames[tp.teamIndex]}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-2 text-[11px]">
                {tp.options.slice(0, 3).map((o) => (
                  <span key={o.id}>
                    {ctx.byId.get(o.id)?.name} <span className="num text-dim">{(o.p * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const POS_FILTERS: ("ALL" | SlotPos)[] = ["ALL", "PG", "SG", "SF", "PF", "C"];

export function AvailableTable({ rows = 40 }: { rows?: number }) {
  const ctx = useEngineContext();
  const fast = useFast();
  const draft = useDraftPlayer();
  const watch = useStore((s) => s.watchlist);
  const toggleWatch = useStore((s) => s.toggleWatch);
  const [pos, setPos] = useState<(typeof POS_FILTERS)[number]>("ALL");
  const [sort, setSort] = useState<"market" | "value">("value");
  const list = useMemo(() => {
    if (!ctx) return [];
    let ids = ctx.available;
    if (pos !== "ALL") ids = ids.filter((id) => ctx.byId.get(id)!.elig.includes(pos));
    if (sort === "value") ids = [...ids].sort((a, b) => (ctx.values.get(a)?.rank ?? 1e9) - (ctx.values.get(b)?.rank ?? 1e9));
    return ids.slice(0, rows);
  }, [ctx, pos, sort, rows]);
  if (!ctx) return null;
  const surv = fast.result && !fast.stale ? fast.result.avail.survival : null;
  return (
    <Panel
      title="Available"
      right={
        <>
          <Tabs value={sort} onChange={setSort} options={[{ value: "value", label: "Value" }, { value: "market", label: ctx.marketSource === "proxy" ? "Market*" : "ADP" }]} />
        </>
      }
      bodyClass="p-0"
    >
      <div className="space-y-2 border-b border-line p-2">
        <PlayerSearch players={ctx.players} drafted={ctx.drafted} onPick={(p) => void draft(p.id)} />
        <div className="flex gap-1">
          {POS_FILTERS.map((p) => (
            <button key={p} onClick={() => setPos(p)} className={cn("rounded px-2 py-0.5 text-[11px]", pos === p ? "bg-line text-ink" : "text-mute hover:text-ink")}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[560px] overflow-y-auto">
        <table className="grid-table w-full text-xs" data-testid="available-table">
          <thead className="text-[10px] text-dim uppercase">
            <tr>
              <th className="px-2 py-1 text-left">Player</th>
              <th className="px-1 py-1 text-right" title="League value rank">Val</th>
              <th className="px-1 py-1 text-right" title={ctx.marketSource === "proxy" ? "Market proxy rank (no ADP imported)" : "Imported ADP"}>{ctx.marketSource === "proxy" ? "Mkt*" : "ADP"}</th>
              <th className="px-1 py-1 text-right" title="P(still available at your next pick)">Surv</th>
              <th className="px-1 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((id) => {
              const p = ctx.byId.get(id)!;
              const s = surv?.get(id);
              return (
                <tr key={id} className="border-b border-line/50 hover:bg-panel2">
                  <td className="max-w-44 px-2 py-1">
                    <button onClick={() => toggleWatch(id)} className={cn("mr-1", watch.includes(id) ? "text-accent" : "text-dim hover:text-mute")} title="Watchlist">
                      ★
                    </button>
                    <PlayerLink p={p} />
                  </td>
                  <td className="num px-1 py-1 text-right">{ctx.values.get(id)?.rank ?? "—"}</td>
                  <td className="num px-1 py-1 text-right text-mute">{p.adp != null ? p.adp.toFixed(0) : ctx.marketRank.get(id)}</td>
                  <td className={cn("num px-1 py-1 text-right", s == null ? "text-dim" : s < 0.3 ? "text-bad" : s < 0.6 ? "text-warn" : "text-good")}>{s == null ? "…" : `${(s * 100).toFixed(0)}%`}</td>
                  <td className="px-1 py-1 text-right">
                    <Button size="sm" onClick={() => void draft(id)} data-testid={`draft-${id}`}>
                      Draft
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.length === 0 && <Empty>No available players match.</Empty>}
      </div>
      {ctx.marketSource === "proxy" && <div className="border-t border-line px-2 py-1 text-[10px] text-dim">* Market proxy — no ADP imported (Data → import ADP).</div>}
    </Panel>
  );
}

export function InjuryWatch() {
  const ctx = useEngineContext();
  if (!ctx) return null;
  const items = ctx.available
    .slice(0, 150)
    .map((id) => ctx.byId.get(id)!)
    .filter((p) => p.availability && p.availability.status !== "HEALTHY")
    .slice(0, 8);
  return (
    <Panel title="Injury & availability watch" right={<Link href="/data" className="text-dim hover:text-ink">sources</Link>}>
      {items.length === 0 ? (
        <div className="text-xs text-dim">No flagged availability issues among top available players.</div>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {items.map((p) => (
            <li key={p.id}>
              <PlayerLink p={p} compact />
              <div className="text-[11px] text-mute">
                {p.availability!.injury} · {p.availability!.estimateBasis} <span className="text-dim">({p.availability!.sourceName}, {p.availability!.reportedDate}, {p.availability!.confidence})</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function NewSessionForm() {
  const create = useStore((s) => s.createSession);
  const [name, setName] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const base = useStore.getState().sessions.find((s) => s.id === useStore.getState().activeId)?.settings;
        if (name.trim() && base) void create(name.trim(), base);
        setName("");
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="New draft name" />
      <Button type="submit">Create</Button>
    </form>
  );
}
