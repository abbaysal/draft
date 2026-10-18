"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CAT_BY_KEY } from "@/lib/categories";
import type { Player } from "@/lib/types";
import { nameKey } from "@/lib/names";
import { Badge, cn, inputCls } from "./ui";
import { useStore } from "@/client/store";
import { useFast } from "@/client/analysis";

export function StatusBadge({ p }: { p: Player }) {
  const a = p.availability;
  if (!a || a.status === "HEALTHY") return null;
  const tone = a.status === "OUT_SEASON" || a.status === "OUT_EXTENDED" ? "bad" : a.status === "DAY_TO_DAY" ? "warn" : "info";
  const label = { OUT_SEASON: "OUT SZN", OUT_EXTENDED: "OUT EXT", OUT_START: "OUT", DAY_TO_DAY: "DTD", RETURNING: "RET", UNKNOWN: "?", HEALTHY: "" }[a.status];
  return (
    <Badge tone={tone} title={`${a.injury ?? ""} — ${a.estimateBasis ?? ""} (${a.sourceName ?? ""}, ${a.reportedDate ?? ""}; ${a.confidence} confidence)`}>
      {label}
    </Badge>
  );
}

export function PlayerLink({ p, compact = false }: { p: Player; compact?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Link href={`/players/${encodeURIComponent(p.id)}`} className="truncate font-medium text-ink hover:text-accent">
        {p.name}
      </Link>
      {!compact && <span className="text-[10px] text-dim">{p.team}·{p.elig.join("/")}</span>}
      <StatusBadge p={p} />
      {p.teamChange && <Badge tone="info" title={`${p.teamChange.from}→${p.teamChange.to} (${p.teamChange.sourceName})`}>NEW</Badge>}
      {!p.proj && <Badge tone="neutral" title="No projection available">NO PROJ</Badge>}
    </span>
  );
}

export function catShort(k: string) {
  return CAT_BY_KEY[k as keyof typeof CAT_BY_KEY]?.short ?? k;
}

/** Search-to-draft combobox. Enter drafts the highlighted player. */
export function PlayerSearch({ players, drafted, onPick, placeholder = "Search player to draft… ( / )", autoFocusKey = "/" }: { players: Player[]; drafted: Set<string>; onPick: (p: Player) => void; placeholder?: string; autoFocusKey?: string }) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const index = useMemo(() => players.map((p) => ({ p, k: nameKey(p.name) })), [players]);
  const results = useMemo(() => {
    const k = nameKey(q);
    if (!k) return [];
    return index
      .filter((x) => x.k.includes(k) || x.p.team.toLowerCase() === k)
      .sort((a, b) => Number(drafted.has(a.p.id)) - Number(drafted.has(b.p.id)) || Number(!a.k.startsWith(k)) - Number(!b.k.startsWith(k)))
      .slice(0, 8)
      .map((x) => x.p);
  }, [q, index, drafted]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === autoFocusKey && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [autoFocusKey]);
  return (
    <div className="relative w-full">
      <input
        ref={ref}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((h) => Math.min(h + 1, results.length - 1));
          if (e.key === "ArrowUp") setHi((h) => Math.max(h - 1, 0));
          if (e.key === "Escape") setQ("");
          if (e.key === "Enter" && results[hi] && !drafted.has(results[hi].id)) {
            onPick(results[hi]);
            setQ("");
          }
        }}
        placeholder={placeholder}
        className={cn(inputCls, "w-full")}
        aria-label="Search players"
        data-testid="player-search"
      />
      {results.length > 0 && (
        <ul className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-line bg-panel2 shadow-xl">
          {results.map((p, i) => (
            <li
              key={p.id}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                if (!drafted.has(p.id)) {
                  onPick(p);
                  setQ("");
                }
              }}
              className={cn("flex cursor-pointer items-center justify-between px-2 py-1.5 text-sm", i === hi && "bg-line", drafted.has(p.id) && "opacity-40")}
            >
              <span>
                {p.name} <span className="text-[11px] text-dim">{p.team} · {p.elig.join("/")}</span>
              </span>
              <span className="text-[11px] text-mute">{drafted.has(p.id) ? "drafted" : "Enter ↵"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Audit snapshot sent with each pick so the history shows what the model recommended at that moment. */
export function useAuditSnapshot() {
  const fast = useFast();
  const champ = useStore((s) => s.champ);
  return (pickedId: string) => {
    const r = fast.result?.rec;
    if (!r) return undefined;
    const picked = r.candidates.find((c) => c.id === pickedId);
    return {
      recommendation: {
        metric: champ?.verdict && champ.verdict.level < 2 ? champ.verdict.label : r.metricName,
        objective: r.objectiveName,
        baselineObj: r.baselineObj,
        stale: fast.stale,
        top: r.candidates.slice(0, 5).map((c) => ({ id: c.id, score: c.score, gain: c.gain, strategic: c.strategic, survival: c.survival })),
        picks: Object.fromEntries(Object.entries(r.picks).map(([k, v]) => [k, v?.id])),
      },
      categoryImpact: picked?.catImpact ?? null,
      simulation: champ?.verdict
        ? { level: champ.verdict.level, label: champ.verdict.label, sims: champ.done, rows: champ.verdict.summaries.map((s) => ({ id: s.id, pChamp: s.pChamp, deltaChamp: s.deltaChamp, deltaChampSe: s.deltaChampSe })) }
        : null,
    };
  };
}

export function useDraftPlayer() {
  const dispatch = useStore((s) => s.dispatch);
  const snap = useAuditSnapshot();
  return (id: string) => dispatch({ type: "pick", playerId: id, at: new Date().toISOString() }, snap(id));
}
