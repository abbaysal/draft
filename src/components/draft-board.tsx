"use client";
import { useMemo, useState } from "react";
import { ownerOf, totalPicks } from "@/lib/engine/draft";
import { useActiveSession, useDataset, useStore } from "@/client/store";
import { Button, cn, Panel } from "./ui";
import { PlayerSearch } from "./player";

/** Snake draft grid: rounds × teams. Click a made pick to correct it, a future pick to reassign ownership (trades). */
export function DraftBoard() {
  const session = useActiveSession();
  const ds = useDataset();
  const dispatch = useStore((s) => s.dispatch);
  const [edit, setEdit] = useState<{ overall: number; mode: "player" | "owner" } | null>(null);
  const byId = useMemo(() => new Map((ds?.players ?? []).map((p) => [p.id, p])), [ds]);
  if (!session || !ds) return null;
  const { settings, state } = session;
  const shape = { teams: settings.teams, rounds: settings.rounds, draftType: settings.draftType };
  const byOverall = new Map(state.picks.map((p) => [p.overall, p]));
  const current = state.picks.length + 1;
  const drafted = new Set(state.picks.map((p) => p.playerId));
  const myIdx = settings.myPosition - 1;
  return (
    <Panel title="Draft board" right={<span className="text-dim">{state.picks.length}/{totalPicks(shape)} picks · click a pick to correct it, a future slot to trade it</span>} bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11px]" data-testid="draft-board">
          <thead>
            <tr>
              <th className="w-8 border-b border-line bg-panel2 px-1 py-1 text-dim">R</th>
              {settings.teamNames.map((n, i) => (
                <th key={i} className={cn("min-w-24 border-b border-line bg-panel2 px-1 py-1 text-left font-medium", i === myIdx ? "text-accent" : "text-mute")}>
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: settings.rounds }, (_, r) => {
              const cells = Array.from({ length: settings.teams }, (_, k) => r * settings.teams + k + 1).map((overall) => ({ overall, owner: ownerOf(overall, shape, state.ownerOverrides) }));
              cells.sort((a, b) => a.owner - b.owner);
              return (
                <tr key={r}>
                  <td className="border-b border-line px-1 text-center text-dim">{r + 1}</td>
                  {Array.from({ length: settings.teams }, (_, t) => {
                    const slots = cells.filter((c) => c.owner === t);
                    return (
                      <td key={t} className={cn("border-b border-l border-line p-0 align-top", t === myIdx && "bg-amber-500/5")}>
                        {slots.length === 0 && <div className="px-1.5 py-1 text-dim">—</div>}
                        {slots.map(({ overall }) => {
                          const pick = byOverall.get(overall);
                          const p = pick ? byId.get(pick.playerId) : null;
                          const isCurrent = overall === current;
                          return (
                            <button
                              key={overall}
                              onClick={() => setEdit({ overall, mode: pick ? "player" : "owner" })}
                              className={cn("block w-full px-1.5 py-1 text-left hover:bg-panel2", isCurrent && "ring-1 ring-accent ring-inset", state.ownerOverrides[overall] != null && "italic")}
                              title={pick ? `Pick ${overall}: ${p?.name ?? pick.playerId} — click to correct` : `Pick ${overall} — click to reassign (trade)`}
                            >
                              <span className="num mr-1 text-dim">{overall}</span>
                              {p ? <span className="text-ink">{p.name}</span> : <span className="text-dim">{isCurrent ? "on the clock" : ""}</span>}
                              {p && <span className="ml-1 text-dim">{p.elig.join("/")}</span>}
                            </button>
                          );
                        })}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setEdit(null)}>
          <div className="w-[420px] space-y-3 rounded-lg border border-line bg-panel p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">Pick {edit.overall}</div>
            {edit.mode === "player" ? (
              <>
                <div className="text-xs text-mute">Replace the player recorded at this pick (pick correction). Other picks are unchanged.</div>
                <PlayerSearch
                  players={ds.players}
                  drafted={drafted}
                  autoFocusKey="__none__"
                  placeholder="Search replacement player…"
                  onPick={async (pl) => {
                    if (await dispatch({ type: "edit", overall: edit.overall, playerId: pl.id })) setEdit(null);
                  }}
                />
              </>
            ) : (
              <>
                <div className="text-xs text-mute">Reassign this pick to another team (traded pick).</div>
                <div className="grid grid-cols-2 gap-1">
                  {settings.teamNames.map((n, i) => (
                    <Button
                      key={i}
                      size="sm"
                      onClick={async () => {
                        if (await dispatch({ type: "setOwner", overall: edit.overall, teamIndex: i })) setEdit(null);
                      }}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </>
            )}
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setEdit(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
