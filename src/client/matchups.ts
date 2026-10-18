"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BILLUR_SCHEDULE } from "@/lib/league";
import { periodOf, resolveTeam } from "@/lib/engine/lineup";
import type { AnalysisContext } from "@/lib/engine/context";
import { useActiveSession } from "./store";

const key = (id: string) => `wr.v1.matchups.${id}`;

/** Weekly opponents of my team (team names by matchup period), stored per session in this browser. */
export function useMatchupSchedule(ctx: AnalysisContext | null) {
  const session = useActiveSession();
  const [schedule, setSchedule] = useState<string[]>([]);
  useEffect(() => {
    if (!session) return;
    let saved: string[] | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(key(session.id)) ?? "null");
    } catch {
      saved = null;
    }
    const isBillur = session.settings.teamNames.some((n) => n.startsWith("Barış"));
    setSchedule(saved ?? (isBillur ? BILLUR_SCHEDULE : []));
  }, [session]);
  const save = useCallback(
    (names: string[]) => {
      setSchedule(names);
      if (!session) return;
      try {
        localStorage.setItem(key(session.id), JSON.stringify(names));
      } catch {
        /* storage unavailable */
      }
    },
    [session],
  );
  const opponents = useMemo(() => (ctx ? schedule.map((n) => resolveTeam(n, ctx.settings.teamNames)) : []), [ctx, schedule]);
  return { schedule, opponents, save };
}

/** Current matchup period (1-based), clamped to the scheduled regular season. */
export function currentPeriod(weeks: number): number {
  return Math.max(1, Math.min(Math.max(1, weeks), periodOf(new Date().toISOString().slice(0, 10))));
}
