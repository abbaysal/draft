"use client";
import { useEffect, useState } from "react";
import { useEngineContext } from "@/client/analysis";
import { useActiveSession, useStore } from "@/client/store";
import { downloadText, toCsv } from "@/client/csv";
import { Badge, Button, Panel, Spinner } from "@/components/ui";
import { PlayerLink } from "@/components/player";
import { CatImpact } from "@/components/recs";

interface AuditRow {
  id: string;
  version: number;
  action: string;
  overall: number | null;
  playerId: string | null;
  teamIndex: number | null;
  recommendation: { metric?: string; top?: { id: string; score: number; survival: number }[]; stale?: boolean } | null;
  categoryImpact: Record<string, number> | null;
  simulation: { label?: string; rows?: { id: string; pChamp: number; deltaChamp: number }[] } | null;
  projectionSetId: string | null;
  createdAt: string;
}

export default function HistoryPage() {
  const ctx = useEngineContext();
  const session = useActiveSession();
  const mode = useStore((s) => s.mode);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  useEffect(() => {
    if (!session || session.local || mode !== "server") return;
    fetch(`/api/drafts/${session.id}/audit`).then((r) => r.json()).then((d: { audit?: AuditRow[] }) => setAudit(d.audit ?? []));
  }, [session, session?.version, mode]);
  if (!ctx || !session) return <Spinner />;
  const name = (id: string | null) => (id ? (ctx.byId.get(id)?.name ?? id) : "");
  const exportCsv = () =>
    downloadText(
      `draft-history-${session.name.replace(/\W+/g, "-")}.csv`,
      toCsv([["overall", "round", "team", "player", "player_id", "time"], ...session.state.picks.map((p) => [p.overall, p.round, session.settings.teamNames[p.teamIndex], name(p.playerId), p.playerId, p.at])]),
    );
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight">Draft History & Audit</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={exportCsv}>Export picks CSV</Button>
          {!session.local && mode === "server" && <a href={`/api/drafts/${session.id}/export`}><Button size="sm">Export full audit (JSON)</Button></a>}
        </div>
      </div>
      <Panel title={`Picks (${session.state.picks.length}) · projection version ${session.projectionSetId ?? "bundled"} (frozen for this draft)`} bodyClass="p-0">
        <table className="w-full text-xs">
          <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">#</th><th className="text-left">Rd</th><th className="text-left">Team</th><th className="text-left">Player</th><th className="text-left">Time</th></tr></thead>
          <tbody>
            {session.state.picks.map((p) => (
              <tr key={p.overall} className="border-t border-line/50">
                <td className="num px-2 py-1">{p.overall}</td>
                <td className="num">{p.round}</td>
                <td className={p.teamIndex === ctx.myIndex ? "text-accent" : ""}>{session.settings.teamNames[p.teamIndex]}</td>
                <td>{ctx.byId.get(p.playerId) ? <PlayerLink p={ctx.byId.get(p.playerId)!} compact /> : p.playerId}</td>
                <td className="text-dim">{new Date(p.at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Audit trail — what the model recommended at each moment" bodyClass="p-0">
        {session.local || mode !== "server" ? (
          <div className="p-3 text-xs text-mute">The immutable audit trail (state before each pick, recommendations, simulations, projection version) is stored in the database. Configure DATABASE_URL to enable it; picks above are still kept locally.</div>
        ) : audit == null ? (
          <div className="p-3"><Spinner /></div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-[10px] text-dim uppercase"><tr><th className="px-2 py-1 text-left">v</th><th className="text-left">Action</th><th className="text-left">Pick</th><th className="text-left">Model&apos;s top 3 then</th><th className="text-left">Metric</th><th className="text-left">Category impact</th><th className="text-left">Title sims</th></tr></thead>
            <tbody>
              {audit.map((a) => {
                const followed = a.recommendation?.top?.[0]?.id === a.playerId;
                return (
                  <tr key={a.id} className="border-t border-line/50 align-top">
                    <td className="num px-2 py-1">{a.version}</td>
                    <td>{a.action}</td>
                    <td>{a.overall ? `#${a.overall} ` : ""}{a.teamIndex != null ? session.settings.teamNames[a.teamIndex] : ""} {name(a.playerId)} {a.action === "pick" && a.teamIndex === ctx.myIndex && a.recommendation && <Badge tone={followed ? "good" : "warn"}>{followed ? "followed #1" : "deviated"}</Badge>}</td>
                    <td className="text-mute">{a.recommendation?.top?.slice(0, 3).map((t) => name(t.id)).join(", ") ?? "—"}</td>
                    <td className="text-dim">{a.recommendation?.metric ?? "—"}{a.recommendation?.stale ? " (stale)" : ""}</td>
                    <td>{a.categoryImpact ? <CatImpact impact={a.categoryImpact} max={4} /> : "—"}</td>
                    <td className="text-dim">{a.simulation?.label ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
