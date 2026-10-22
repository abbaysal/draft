"use client";
import { useState } from "react";
import type { AnalysisContext } from "@/lib/engine/context";
import { parseLeagueRosters, type LeagueRosterGroup } from "@/lib/import/yahoo-paste";
import { useLeagueSync } from "@/client/matchup-sync";
import { useStore } from "@/client/store";
import { Badge, Button, Panel } from "@/components/ui";

/** Paste Yahoo League → Rosters: every team's real roster, so free agents = everyone else. */
export function LeagueSyncPanel({ ctx }: { ctx: AnalysisContext }) {
  const { sync, save } = useLeagueSync();
  const toast = useStore((s) => s.toast);
  const [open, setOpen] = useState(!sync);
  const [text, setText] = useState("");
  const [groups, setGroups] = useState<LeagueRosterGroup[] | null>(null);
  const [extra, setExtra] = useState<{ rostered: string[]; unmatched: string[] } | null>(null);
  const names = ctx.settings.teamNames;

  const read = () => {
    const r = parseLeagueRosters(text, ctx.players, names);
    // Pre-assign unknown groups to unused teams in order (e.g. a renamed team on Yahoo).
    const used = new Set(r.groups.map((g) => g.teamIndex).filter((t) => t >= 0));
    setGroups(r.groups.map((g) => g));
    setExtra({ rostered: r.rostered, unmatched: r.unmatched });
    if (r.groups.length && r.groups.some((g) => g.teamIndex < 0) && used.size === r.groups.length - 1) {
      const free = names.findIndex((_, i) => !used.has(i));
      setGroups(r.groups.map((g) => (g.teamIndex < 0 ? { ...g, teamIndex: free } : g)));
    }
  };
  const apply = () => {
    if (!groups || !extra) return;
    const teams: (string[] | null)[] = names.map(() => null);
    for (const g of groups) if (g.teamIndex >= 0) teams[g.teamIndex] = [...(teams[g.teamIndex] ?? []), ...g.players];
    save({ syncedAt: new Date().toISOString(), teams, rostered: extra.rostered });
    toast("success", `League rosters synced: ${extra.rostered.length} rostered players, ${teams.filter(Boolean).length} teams mapped.`);
    setOpen(false);
    setGroups(null);
    setText("");
  };

  return (
    <Panel
      title="Sync league rosters"
      right={
        <div className="flex items-center gap-2">
          {sync ? <Badge tone="good">{sync.rostered.length} rostered · {new Date(sync.syncedAt).toLocaleDateString()}</Badge> : <Badge tone="warn">not synced</Badge>}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : sync ? "Re-sync" : "Open"}</Button>
          {sync && <Button size="sm" variant="ghost" onClick={() => save(null)}>Clear</Button>}
        </div>
      }
    >
      {!open ? (
        <div className="text-xs text-mute">{sync ? "Free agents = every player not on a Yahoo roster. Re-sync after other teams make moves." : "Without a sync, free agents are players not on your draft board."}</div>
      ) : (
        <div className="space-y-2 text-xs" data-testid="league-sync">
          <div className="text-mute">On Yahoo open <b>League → Rosters</b> (all teams on one page), press <kbd>Ctrl/⌘ + A</kbd>, <kbd>Ctrl/⌘ + C</kbd> and paste. Team pages pasted one after another also work.</div>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setGroups(null); }} placeholder="Paste Yahoo League → Rosters here…" className="h-28 w-full rounded-md border border-line bg-bg p-2 font-mono text-[11px]" data-testid="league-paste" />
          <div className="flex gap-2">
            <Button size="sm" onClick={read} disabled={text.length < 20}>Read</Button>
            <Button size="sm" variant="primary" onClick={apply} disabled={!groups?.length} data-testid="league-apply">Apply</Button>
          </div>
          {groups && extra && (
            <div className="space-y-1 rounded-md bg-panel2 p-2">
              <div>{extra.rostered.length} rostered players in {groups.length} rosters. Check each roster&apos;s team:</div>
              {groups.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select value={g.teamIndex} onChange={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, teamIndex: Number(e.target.value) } : x)))} className="h-6 max-w-52 rounded border border-line bg-bg px-1">
                    <option value={-1}>— not mapped (still counted as rostered) —</option>
                    {names.map((n, t) => <option key={t} value={t}>{n}</option>)}
                  </select>
                  <span className="text-dim">{g.label || "?"}</span>
                  <span className="truncate text-mute">{g.players.length} players: {g.players.slice(0, 3).map((id) => ctx.byId.get(id)?.name).join(", ")}…</span>
                </div>
              ))}
              {extra.unmatched.length > 0 && <div className="text-warn">Not in the player database: {extra.unmatched.join(", ")}</div>}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
