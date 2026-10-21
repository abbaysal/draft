"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanOptions, WeekActual } from "@/lib/engine/lineup";
import { isOutFlag, type YahooPaste } from "@/lib/import/yahoo-paste";
import { useActiveSession } from "./store";

/** A Yahoo matchup snapshot pasted by the manager (stored per draft session in this browser). */
export interface MatchupSync {
  syncedAt: string;
  /** Eastern date the snapshot was taken (games before this date are in `actual`). */
  asOf: string;
  week: number;
  mine: string[];
  opp: string[];
  status: Record<string, string>;
  slots: Record<string, string>;
  actual: { me: WeekActual; opp: WeekActual } | null;
  games?: YahooPaste["games"];
}

const key = (id: string) => `wr.v1.yahooSync.${id}`;

/** Today's date in US Eastern time (NBA game dates). */
export function todayET(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function tzOffsetMin(tz: string, t: number): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
  const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - t) / 60000;
}

/** "7:30 PM" Eastern on a date → epoch ms. */
export function etToEpoch(date: string, time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return null;
  const h = (Number(m[1]) % 12) + (m[3].toUpperCase() === "PM" ? 12 : 0);
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, Number(m[2]));
  return guess - tzOffsetMin("America/New_York", guess) * 60000;
}

/** Tip-off in the viewer's own time zone, e.g. "02:30". */
export function localTip(date: string, time?: string): string | null {
  if (!time) return null;
  const t = etToEpoch(date, time);
  return t == null ? null : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", weekday: "short" }).format(new Date(t));
}

export function syncFromPaste(r: YahooPaste, today: string): MatchupSync {
  const all = [...r.left, ...r.right];
  return {
    syncedAt: new Date().toISOString(),
    asOf: today,
    week: r.week ?? 0,
    mine: r.left.map((x) => x.playerId),
    opp: r.right.map((x) => x.playerId),
    status: Object.fromEntries(all.filter((x) => x.status).map((x) => [x.playerId, x.status!])),
    slots: Object.fromEntries(all.filter((x) => x.slot).map((x) => [x.playerId, x.slot!])),
    actual: r.totals.length >= 2 ? { me: r.totals[0], opp: r.totals[1] } : null,
    games: r.games,
  };
}

export function useMatchupSync() {
  const session = useActiveSession();
  const [sync, setSync] = useState<MatchupSync | null>(null);
  useEffect(() => {
    if (!session) return;
    try {
      setSync(JSON.parse(localStorage.getItem(key(session.id)) ?? "null"));
    } catch {
      setSync(null);
    }
  }, [session]);
  const save = useCallback(
    (s: MatchupSync | null) => {
      setSync(s);
      if (!session) return;
      try {
        if (s) localStorage.setItem(key(session.id), JSON.stringify(s));
        else localStorage.removeItem(key(session.id));
      } catch {
        /* storage unavailable */
      }
    },
    [session],
  );
  return { sync, save };
}

/**
 * Planner options for a matchup period: real rosters, totals so far and injury flags from the
 * Yahoo snapshot when it is for this week, and "only the remaining days" for the current week.
 */
export function usePlanOptions(sync: MatchupSync | null, period: number): PlanOptions {
  return useMemo(() => {
    const opts: PlanOptions = {};
    if (sync && sync.week === period) {
      opts.rosters = { mine: sync.mine, opp: sync.opp.length ? sync.opp : undefined };
      // Totals cover games completed before the snapshot day (synced before that day's tip-offs);
      // from that day on the plan projects. Without totals the whole week is projected.
      if (sync.actual) {
        opts.actual = sync.actual;
        opts.fromDate = sync.asOf;
      }
      const unavailable: Record<string, string[] | "all"> = {};
      for (const [id, st] of Object.entries(sync.status)) {
        if (st === "INJ" || st === "IL" || st === "SUSP") unavailable[id] = "all";
        else if (isOutFlag(st)) unavailable[id] = [sync.asOf];
      }
      opts.unavailable = unavailable;
    }
    return opts;
  }, [sync, period]);
}
