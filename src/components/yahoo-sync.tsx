"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createMatcher } from "@/lib/import/csv";
import { useActiveSession, useDataset, useStore } from "@/client/store";
import { Badge, Button, Panel, Spinner } from "./ui";

interface YPick {
  pick: number;
  round: number;
  teamKey: string;
  playerKey: string | null;
  name: string | null;
}
interface YResp {
  configured?: boolean;
  error?: string;
  picks?: YPick[];
  fetchedAt?: string;
  fetchMs?: number;
}

/**
 * Live Yahoo draft sync. Polls /api/yahoo/draft and records any picks Yahoo has
 * that the board does not, in order. Existing picks are never overwritten
 * automatically — mismatches are shown with a one-click fix.
 */
export function YahooSync() {
  const session = useActiveSession();
  const ds = useDataset();
  const dispatch = useStore((s) => s.dispatch);
  const toast = useStore((s) => s.toast);
  const [state, setState] = useState<{ status: "idle" | "ok" | "error" | "notconnected" | "unconfigured"; msg?: string; fetchedAt?: string; fetchMs?: number; yahooCount?: number }>({ status: "idle" });
  const [auto, setAuto] = useState(false);
  const [mismatch, setMismatch] = useState<{ overall: number; yahoo: string; site: string; id: string | null }[]>([]);
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (busy.current || !session || !ds) return;
    busy.current = true;
    try {
      const r = await fetch("/api/yahoo/draft", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as YResp;
      if (r.status === 501) return setState({ status: "unconfigured", msg: d.error });
      if (r.status === 401) return setState({ status: "notconnected", msg: d.error });
      if (!r.ok || !d.picks) return setState({ status: "error", msg: d.error ?? `HTTP ${r.status}` });
      const made = d.picks.filter((p) => p.playerKey && p.name);
      setState({ status: "ok", fetchedAt: d.fetchedAt, fetchMs: d.fetchMs, yahooCount: made.length });
      const matcher = createMatcher(ds.players);
      const byId = new Map(ds.players.map((p) => [p.id, p]));
      const current = useStore.getState().sessions.find((s) => s.id === session.id)!;
      const mm: typeof mismatch = [];
      for (const yp of made) {
        const existing = current.state.picks.find((p) => p.overall === yp.pick);
        const m = matcher.match(yp.name!);
        if (existing && m && existing.playerId !== m.id) mm.push({ overall: yp.pick, yahoo: yp.name!, site: byId.get(existing.playerId)?.name ?? existing.playerId, id: m.id });
      }
      setMismatch(mm);
      // Append missing picks strictly in order.
      let st = useStore.getState().sessions.find((s) => s.id === session.id)!;
      for (const yp of made) {
        if (yp.pick !== st.state.picks.length + 1) continue;
        let m = matcher.match(yp.name!);
        if (!m || st.state.picks.some((p) => p.playerId === m!.id)) {
          const used = new Set(st.state.picks.map((p) => p.playerId));
          m = ds.players.find((p) => p.id.startsWith("other-") && !used.has(p.id)) ?? null;
          toast("info", `Yahoo pick #${yp.pick} "${yp.name}" not in database — recorded as placeholder`);
        }
        if (!m) break;
        const ok = await dispatch({ type: "pick", playerId: m.id, at: new Date().toISOString() });
        if (!ok) break;
        st = useStore.getState().sessions.find((s) => s.id === session.id)!;
      }
    } catch (e) {
      setState({ status: "error", msg: e instanceof Error ? e.message : "network error" });
    } finally {
      busy.current = false;
    }
  }, [session, ds, dispatch, toast]);

  useEffect(() => {
    if (!auto) return;
    void sync();
    const t = setInterval(() => void sync(), 5000);
    return () => clearInterval(t);
  }, [auto, sync]);

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("yahoo") === "connected") {
      setAuto(true);
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const age = state.fetchedAt ? Math.round((Date.now() - new Date(state.fetchedAt).getTime()) / 1000) : null;
  return (
    <Panel
      title="Yahoo live sync"
      right={
        <>
          {state.status === "ok" && <Badge tone="good">{state.yahooCount} picks on Yahoo · API {state.fetchMs} ms{age != null ? ` · ${age}s ago` : ""}</Badge>}
          {state.status === "notconnected" && <Badge tone="warn">not connected</Badge>}
          {state.status === "unconfigured" && <Badge tone="neutral">Yahoo app not configured</Badge>}
          {state.status === "error" && <Badge tone="bad" title={state.msg}>error</Badge>}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <a href="/api/yahoo/login">
          <Button size="sm">Connect Yahoo</Button>
        </a>
        <Button size="sm" variant={auto ? "primary" : "default"} onClick={() => setAuto(!auto)} data-testid="yahoo-auto">
          {auto ? "Auto-sync ON (5s)" : "Auto-sync OFF"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void sync()}>
          Sync now
        </Button>
        {auto && busy.current && <Spinner />}
        {state.msg && state.status !== "ok" && <span className="text-mute">{state.msg}</span>}
      </div>
      {mismatch.length > 0 && (
        <div className="mt-2 space-y-1 text-xs">
          {mismatch.map((m) => (
            <div key={m.overall} className="flex items-center gap-2 text-yellow-300">
              Pick #{m.overall}: board has {m.site}, Yahoo has {m.yahoo}
              {m.id && (
                <Button size="sm" variant="ghost" onClick={() => void dispatch({ type: "edit", overall: m.overall, playerId: m.id! })}>
                  use Yahoo
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 text-[10px] text-dim">Manual entry still works; sync only adds picks the board is missing, in order.</div>
    </Panel>
  );
}
