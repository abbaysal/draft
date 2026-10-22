"use client";
import { useCallback } from "react";
import { useEngineContext } from "./analysis";
import { useActiveSession, useStore } from "./store";

/**
 * Record an add/drop made on Yahoo so every page uses the new roster: updates the Yahoo syncs
 * (matchup snapshot and league rosters) when they hold the dropped player, otherwise swaps the
 * player in the draft-board pick.
 */
export function useRecordMove() {
  const ctx = useEngineContext();
  const session = useActiveSession();
  const syncs = useStore((s) => (session ? s.syncs[session.id] : undefined));
  const setSync = useStore((s) => s.setSync);
  const dispatch = useStore((s) => s.dispatch);
  const toast = useStore((s) => s.toast);
  return useCallback(
    async (add: string, drop: string, confirm = true): Promise<boolean> => {
      if (!ctx || !session) return false;
      const a = ctx.byId.get(add)?.name ?? add;
      const d = ctx.byId.get(drop)?.name ?? drop;
      if (confirm && !window.confirm(`Record on the site: add ${a}, drop ${d}?\n(Make the move in Yahoo too.)`)) return false;
      let done = false;
      const m = syncs?.matchup;
      if (m?.mine.includes(drop)) {
        setSync(session.id, { matchup: { ...m, mine: m.mine.map((x) => (x === drop ? add : x)) } });
        done = true;
      }
      const l = syncs?.league;
      if (l?.rostered.includes(drop)) {
        setSync(session.id, { league: { ...l, teams: l.teams.map((t) => (t?.includes(drop) ? t.map((x) => (x === drop ? add : x)) : t)), rostered: [...l.rostered.filter((x) => x !== drop), add] } });
        done = true;
      }
      if (!done) {
        const pick = ctx.draft.picks.find((p) => p.playerId === drop);
        if (pick) done = await dispatch({ type: "edit", overall: pick.overall, playerId: add });
      }
      toast(done ? "success" : "error", done ? `Recorded: +${a} / −${d}` : `${d} is not on your roster here — sync from Yahoo first.`);
      return done;
    },
    [ctx, session, syncs, setSync, dispatch, toast],
  );
}
