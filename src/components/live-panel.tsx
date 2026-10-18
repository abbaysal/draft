"use client";
import { useDataset, useStore } from "@/client/store";
import { Badge, Button, Panel } from "./ui";

/** Status and switches for the live in-season feeds (/api/live). */
export function LivePanel() {
  const live = useStore((s) => s.live);
  const status = useStore((s) => s.liveStatus);
  const opts = useStore((s) => s.liveOpts);
  const setOpts = useStore((s) => s.setLiveOpts);
  const load = useStore((s) => s.loadLive);
  const ds = useDataset();
  const report = ds?.live?.report;
  return (
    <Panel
      title="Live in-season data"
      right={
        <div className="flex items-center gap-2">
          <Badge tone={status.state === "ok" ? "good" : status.state === "error" ? "bad" : "neutral"}>{status.state === "ok" ? "CONNECTED" : status.state.toUpperCase()}</Badge>
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={status.state === "loading"}>Refresh</Button>
        </div>
      }
    >
      <div className="space-y-2 text-xs" data-testid="live-panel">
        {status.state === "error" && <div className="text-bad">Live feed unavailable: {status.error}. The bundled dataset is used.</div>}
        {live && (
          <>
            <table className="w-full">
              <tbody>
                {live.sources.map((s) => (
                  <tr key={s.id} className="border-t border-line/50">
                    <td className="py-1"><a href={s.url.includes("<") ? undefined : s.url} target="_blank" rel="noreferrer" className="hover:text-accent">{s.name}</a></td>
                    <td className="num text-right">{s.count}</td>
                    <td className="pl-2">{s.ok ? <Badge tone="good">OK</Badge> : <Badge tone="warn">{s.error ?? "failed"}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-mute">
              Updated {new Date(live.generatedAt).toLocaleString()} · {live.stats.length} players with 2026-27 games · {live.injuries.length} injury entries
              {live.schedule ? ` · live NBA schedule (${live.schedule.length} games)` : " · bundled NBA schedule"}
            </div>
            {report && (
              <div className="text-dim">
                Matched {report.statsMatched} stat lines and {report.injuriesMatched} injuries to the player database
                {report.statsUnmatched.length > 0 && <> · not in database: {report.statsUnmatched.slice(0, 8).join(", ")}{report.statsUnmatched.length > 8 ? "…" : ""}</>}
                {report.injuriesUnmatched.length > 0 && <> · injuries unmatched: {report.injuriesUnmatched.length}</>}
              </div>
            )}
            {live.warnings.map((w) => <div key={w} className="text-warn">{w}</div>)}
          </>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={opts.stats} onChange={(e) => setOpts({ stats: e.target.checked })} className="accent-amber-500" />
          Blend 2026-27 box scores into rest-of-season projections
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={opts.injuries} onChange={(e) => setOpts({ injuries: e.target.checked })} className="accent-amber-500" />
          Apply the live injury report (status, IL, expected games missed)
        </label>
        <div className="text-[10px] text-dim">
          Projections shrink toward actual play: by ~15 games, 2026-27 stats carry half the weight; percentages are blended on attempts. Sources: NBA.com box scores and schedule (CDN), ESPN injury report — refreshed every 15 minutes on the server. Statistics are used for personal analysis under each source&apos;s terms.
        </div>
      </div>
    </Panel>
  );
}
