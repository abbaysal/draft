"use client";
import type { AnalysisContext } from "@/lib/engine/context";
import type { WeekPlan } from "@/lib/engine/lineup";
import { localTip } from "@/client/matchup-sync";
import { Badge, Panel } from "@/components/ui";
import { PlayerLink } from "@/components/player";

/** Today's start/sit for my roster with tip-off times (Eastern and the viewer's local time). */
export function TodayCard({ ctx, plan, today }: { ctx: AnalysisContext; plan: WeekPlan; today: string }) {
  const day = plan.daily.find((d) => d.date === today);
  const roster = plan.lineup.map((r) => r.id);
  const rows = roster
    .map((id) => {
      const p = ctx.byId.get(id)!;
      const g = ctx.schedule.gameOn(p.team, today);
      const st = day?.starters.find((s) => s.id === id);
      const status = !g ? "no game" : day?.out?.includes(id) ? "OUT" : st ? st.slot : day?.protect?.includes(id) ? "BENCH (protect)" : "BENCH";
      return { id, p, g, st, status };
    })
    .sort((a, b) => (a.g ? 0 : 1) - (b.g ? 0 : 1) || (a.st ? 0 : 1) - (b.st ? 0 : 1));
  const playing = rows.filter((r) => r.g).length;
  return (
    <Panel title={`Today · ${today}`} right={<span className="text-[10px] text-dim">{day ? `${day.starters.length}/${ctx.starters} slots filled · ${playing} of your players play` : "no games for your roster today"}</span>} bodyClass="p-0">
      <table className="w-full text-xs" data-testid="today-card">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.g ? "border-t border-line/50" : "border-t border-line/50 opacity-45"}>
              <td className="px-2 py-1"><PlayerLink p={r.p} /></td>
              <td className="text-mute">{r.g ? `${r.g.home ? "vs" : "@"} ${r.g.opp}` : "—"}</td>
              <td className="num text-mute">{r.g?.time ? `${r.g.time} ET` : ""}</td>
              <td className="num text-dim">{r.g ? localTip(today, r.g.time) ?? "" : ""}</td>
              <td className="px-2 text-right">
                {r.status === "no game" ? <span className="text-dim">no game</span> : r.status === "OUT" ? <Badge tone="bad">OUT → bench</Badge> : r.st ? <Badge tone="accent">START {r.status}</Badge> : <Badge tone="warn">{r.status}</Badge>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="px-2 py-1.5 text-[10px] text-dim">Set these slots in Yahoo before the first tip-off; each player locks at his own game time (local time shown in your time zone).</div>
    </Panel>
  );
}
