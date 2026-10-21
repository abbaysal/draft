"use client";
import { useState } from "react";
import { parseYahooPaste, type YahooPaste } from "@/lib/import/yahoo-paste";
import type { MetadataRow } from "@/lib/import/csv";
import type { AnalysisContext } from "@/lib/engine/context";
import { syncFromPaste, todayET, type MatchupSync } from "@/client/matchup-sync";
import { useStore } from "@/client/store";
import { Badge, Button, Panel } from "@/components/ui";

/** Paste the Yahoo matchup page → real rosters, injury flags, week-to-date totals (and team/position fixes). */
export function YahooSyncPanel({ ctx, sync, onSave, week }: { ctx: AnalysisContext; sync: MatchupSync | null; onSave: (s: MatchupSync | null) => void; week: number }) {
  const [open, setOpen] = useState(!sync);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<YahooPaste | null>(null);
  const setLocal = useStore((s) => s.setLocalImports);
  const localImports = useStore((s) => s.localImports);
  const toast = useStore((s) => s.toast);

  const apply = () => {
    if (!parsed) return;
    const s = syncFromPaste(parsed, todayET());
    if (!s.week) s.week = week;
    onSave(s);
    // Team and position fixes from Yahoo go into the local metadata layer (affects every page).
    const rows: MetadataRow[] = [...parsed.left, ...parsed.right]
      .filter((x) => x.team || x.positions?.length)
      .filter((x) => {
        const p = ctx.byId.get(x.playerId);
        return p && ((x.team && x.team !== p.team) || (x.positions?.length && x.positions.join(",") !== p.elig.join(",")));
      })
      .map((x) => ({ playerId: x.playerId, name: x.name, elig: x.positions?.length ? x.positions : null, team: x.team ?? null }));
    if (rows.length) {
      const keep = (localImports.metadata ?? []).filter((m) => !rows.some((r) => r.playerId === m.playerId));
      setLocal({ metadata: [...keep, ...rows] });
    }
    toast("success", `Synced week ${s.week}: ${s.mine.length} + ${s.opp.length} players${s.actual ? ", totals so far" : ""}${rows.length ? `, ${rows.length} team/position fixes` : ""}.`);
    setText("");
    setParsed(null);
    setOpen(false);
  };

  return (
    <Panel
      title="Sync from Yahoo"
      right={
        <div className="flex items-center gap-2">
          {sync ? <Badge tone={sync.week === week ? "good" : "warn"}>{sync.week === week ? `week ${sync.week} synced ${new Date(sync.syncedAt).toLocaleString()}` : `last sync: week ${sync.week}`}</Badge> : <Badge>not synced</Badge>}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? "Hide" : sync ? "Re-sync" : "Open"}</Button>
          {sync && <Button size="sm" variant="ghost" onClick={() => onSave(null)}>Clear</Button>}
        </div>
      }
    >
      {open && (
        <div className="space-y-2 text-xs" data-testid="yahoo-sync">
          <div className="text-mute">
            On Yahoo open <b>Matchups</b> (Totals tab), press <kbd>Ctrl/⌘ + A</kbd> then <kbd>Ctrl/⌘ + C</kbd>, and paste here. The site reads both rosters, injury flags (O, GTD, INJ), NBA teams and positions, and the category totals so far. Sync before the day&apos;s first tip-off; re-sync any day.
          </div>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setParsed(null); }} placeholder="Paste the Yahoo matchup page here…" className="h-32 w-full rounded-md border border-line bg-bg p-2 font-mono text-[11px]" data-testid="yahoo-paste" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setParsed(parseYahooPaste(text, ctx.players))} disabled={text.length < 20}>Read</Button>
            <Button size="sm" variant="primary" onClick={apply} disabled={!parsed || (!parsed.left.length && !parsed.right.length)} data-testid="yahoo-apply">Apply</Button>
          </div>
          {parsed && (
            <div className="rounded-md bg-panel2 p-2" data-testid="yahoo-preview">
              <div>
                {parsed.kind === "matchup" ? "Matchup page" : "Roster page"} {parsed.week ? `· week ${parsed.week}` : ""} · your team <b>{parsed.left.length}</b> players{parsed.kind === "matchup" && <> · opponent <b>{parsed.right.length}</b></>}
                {parsed.totals.length >= 2 && <> · totals {parsed.totals[0].score ?? "?"}–{parsed.totals[1].score ?? "?"}</>}
                {parsed.games && <> · games played {parsed.games.leftPlayed}/{parsed.games.leftTotal} vs {parsed.games.rightPlayed}/{parsed.games.rightTotal}</>}
              </div>
              <div className="mt-1 text-mute">Flags: {[...parsed.left, ...parsed.right].filter((x) => x.status).map((x) => `${x.name} (${x.status})`).join(", ") || "none"}</div>
              {parsed.unmatched.length > 0 && <div className="mt-1 text-warn">Not found in the player database: {parsed.unmatched.join(", ")}</div>}
            </div>
          )}
        </div>
      )}
      {!open && sync && (
        <div className="text-xs text-mute">
          Using Yahoo rosters ({sync.mine.length} vs {sync.opp.length}){sync.actual ? `, totals through ${sync.asOf} (before that day's games)` : ""}{Object.keys(sync.status).length ? `, flags: ${Object.entries(sync.status).map(([id, s]) => `${ctx.byId.get(id)?.name} ${s}`).join(", ")}` : ""}.
        </div>
      )}
    </Panel>
  );
}
