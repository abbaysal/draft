"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CAT_KEYS, CAT_BY_KEY, uniformWeights, type CategoryWeights } from "@/lib/categories";
import { valuePlayers } from "@/lib/engine/valuation";
import { playerRisk } from "@/lib/engine/risk";
import type { Player, SlotPos } from "@/lib/types";
import { nameKey } from "@/lib/names";
import { useEngineContext, useFast } from "@/client/analysis";
import { useStore } from "@/client/store";
import { downloadText, toCsv } from "@/client/csv";
import { Badge, Button, cn, inputCls, Panel, Tabs } from "@/components/ui";
import { PlayerLink, useDraftPlayer } from "@/components/player";
import { WeightsEditor } from "@/components/weights";

type ColKey = "team" | "pos" | "rank" | "puntRank" | "adp" | "adpDiff" | "pts" | "fg3m" | "reb" | "ast" | "stl" | "blk" | "fgPct" | "fga" | "ftPct" | "fta" | "tov" | "gp" | "min" | "risk" | "avail" | "status" | "z";

const COLS: { key: ColKey; label: string; title?: string; def: boolean }[] = [
  { key: "team", label: "Team", def: true },
  { key: "pos", label: "Pos", def: true },
  { key: "rank", label: "Rank", title: "League value rank (league categories, chosen basis/method)", def: true },
  { key: "puntRank", label: "Punt rk", title: "Rank under the weights above", def: true },
  { key: "adp", label: "ADP", title: "Imported ADP (market proxy rank if none)", def: true },
  { key: "adpDiff", label: "ADP Δ", title: "ADP − value rank (positive = value)", def: true },
  { key: "gp", label: "GP", def: true },
  { key: "min", label: "MIN", def: false },
  { key: "pts", label: "PTS", def: true },
  { key: "fg3m", label: "3PM", def: true },
  { key: "reb", label: "REB", def: true },
  { key: "ast", label: "AST", def: true },
  { key: "stl", label: "STL", def: true },
  { key: "blk", label: "BLK", def: true },
  { key: "fgPct", label: "FG%", def: true },
  { key: "fga", label: "FGA", def: true },
  { key: "ftPct", label: "FT%", def: true },
  { key: "fta", label: "FTA", def: true },
  { key: "tov", label: "TO", def: true },
  { key: "z", label: "Total z", def: true },
  { key: "risk", label: "Risk", def: true },
  { key: "avail", label: "Surv", title: "P(available at your next pick)", def: true },
  { key: "status", label: "Status", def: true },
];

export default function PlayersPage() {
  const ctx = useEngineContext();
  const fast = useFast();
  const router = useRouter();
  const watch = useStore((s) => s.watchlist);
  const toggleWatch = useStore((s) => s.toggleWatch);
  const draft = useDraftPlayer();
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<"ALL" | SlotPos>("ALL");
  const [team, setTeam] = useState("ALL");
  const [view, setView] = useState<"available" | "all" | "drafted" | "watch">("available");
  const [tag, setTag] = useState("ALL");
  const [risk, setRisk] = useState<"ALL" | "low" | "medium" | "high">("ALL");
  const [basis, setBasis] = useState<"perGame" | "season">("perGame");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const [cols, setCols] = useState<Set<ColKey>>(new Set(COLS.filter((c) => c.def).map((c) => c.key)));
  const [weights, setWeights] = useState<CategoryWeights>(uniformWeights());
  const [limit, setLimit] = useState(150);
  const [selected, setSelected] = useState<string[]>([]);
  const [showCols, setShowCols] = useState(false);

  const puntVals = useMemo(() => (ctx ? valuePlayers(ctx.players, ctx.baseline, weights) : null), [ctx, weights]);
  const risks = useMemo(() => new Map((ctx?.players ?? []).map((p) => [p.id, playerRisk(p)])), [ctx]);
  const teams = useMemo(() => [...new Set((ctx?.players ?? []).map((p) => p.team))].sort(), [ctx]);
  const tags = useMemo(() => [...new Set((ctx?.players ?? []).flatMap((p) => p.tags.map((t) => t.kind)))].sort(), [ctx]);

  const rows = useMemo(() => {
    if (!ctx || !puntVals) return [];
    const k = nameKey(q);
    let list = ctx.players.filter((p) => {
      if (view === "available" && ctx.drafted.has(p.id)) return false;
      if (view === "drafted" && !ctx.drafted.has(p.id)) return false;
      if (view === "watch" && !watch.includes(p.id)) return false;
      if (k && !nameKey(p.name).includes(k)) return false;
      if (pos !== "ALL" && !p.elig.includes(pos)) return false;
      if (team !== "ALL" && p.team !== team) return false;
      if (tag !== "ALL" && !p.tags.some((t) => t.kind === tag)) return false;
      if (risk !== "ALL" && risks.get(p.id)?.overall !== risk) return false;
      return true;
    });
    const val = (p: Player): number => {
      const j = p.proj;
      const m = basis === "season" && j ? j.gp : 1;
      switch (sort.key) {
        case "rank":
          return ctx.values.get(p.id)?.rank ?? 9999;
        case "puntRank":
          return puntVals.get(p.id)?.rank ?? 9999;
        case "adp":
          return p.adp ?? ctx.marketRank.get(p.id) ?? 9999;
        case "adpDiff":
          return (p.adp ?? ctx.marketRank.get(p.id) ?? 999) - (ctx.values.get(p.id)?.rank ?? 999);
        case "fgPct":
          return j && j.fga ? j.fgm / j.fga : 0;
        case "ftPct":
          return j && j.fta ? j.ftm / j.fta : 0;
        case "z":
          return ctx.values.get(p.id)?.total ?? -99;
        case "avail":
          return fast.result?.avail.survival.get(p.id) ?? 1;
        case "name":
          return 0;
        default:
          return j ? ((j as unknown as Record<string, number>)[sort.key] ?? 0) * (["gp", "min"].includes(sort.key) ? 1 : m) : -1;
      }
    };
    list = [...list].sort((a, b) => (sort.key === "name" ? a.name.localeCompare(b.name) * sort.dir : (val(a) - val(b)) * sort.dir));
    return list;
  }, [ctx, puntVals, q, view, watch, pos, team, tag, risk, risks, sort, basis, fast.result]);

  if (!ctx || !puntVals) return null;
  const surv = fast.result && !fast.stale ? fast.result.avail.survival : null;
  const th = (key: string, label: string, title?: string) => (
    <th
      key={key}
      title={title}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : ["rank", "puntRank", "adp", "tov", "name"].includes(key) ? 1 : -1 }))}
      className="cursor-pointer px-1.5 py-1 text-right whitespace-nowrap select-none hover:text-ink"
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  const fmt = (x: number, d = 1) => x.toFixed(d);
  const exportCsv = () => {
    const header = ["name", "team", "positions", "value_rank", "punt_rank", "adp_or_market", "gp", "min", "pts", "3pm", "reb", "ast", "stl", "blk", "fg_pct", "fga", "ft_pct", "fta", "tov", "total_z", "projection_source", "risk", "status"];
    const body = rows.map((p) => {
      const j = p.proj;
      return [p.name, p.team, p.elig.join("/"), ctx.values.get(p.id)?.rank, puntVals.get(p.id)?.rank, p.adp ?? ctx.marketRank.get(p.id), j?.gp.toFixed(1), j?.min.toFixed(1), j?.pts.toFixed(2), j?.fg3m.toFixed(2), j?.reb.toFixed(2), j?.ast.toFixed(2), j?.stl.toFixed(2), j?.blk.toFixed(2), j && j.fga ? (j.fgm / j.fga).toFixed(3) : "", j?.fga.toFixed(2), j && j.fta ? (j.ftm / j.fta).toFixed(3) : "", j?.fta.toFixed(2), j?.tov.toFixed(2), ctx.values.get(p.id)?.total.toFixed(3), j ? `${j.source} (${j.kind})` : "none", risks.get(p.id)?.overall, p.availability?.status ?? "HEALTHY"];
    });
    downloadText(`players-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([header, ...body]));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold tracking-tight">Master Player Database</h1>
        <div className="flex items-center gap-2 text-xs text-mute">
          {ctx.players.filter((p) => p.proj).length} projected / {ctx.players.length} players · projections:{" "}
          <Badge tone={ctx.players.some((p) => p.proj?.kind === "projection") ? "info" : "accent"}>{ctx.players.find((p) => p.proj)?.proj?.source ?? "—"}</Badge>
        </div>
      </div>
      <Panel bodyClass="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…" className={cn(inputCls, "w-52")} data-testid="players-search" />
          <Tabs value={view} onChange={setView} options={[{ value: "available", label: "Available" }, { value: "all", label: "All" }, { value: "drafted", label: "Drafted" }, { value: "watch", label: `Watchlist (${watch.length})` }]} />
          <select value={pos} onChange={(e) => setPos(e.target.value as typeof pos)} className={inputCls}>
            {["ALL", "PG", "SG", "SF", "PF", "C"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={inputCls}>
            <option>ALL</option>
            {teams.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select value={tag} onChange={(e) => setTag(e.target.value)} className={inputCls}>
            <option value="ALL">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select value={risk} onChange={(e) => setRisk(e.target.value as typeof risk)} className={inputCls}>
            <option value="ALL">Any risk</option>
            <option value="low">Low risk</option>
            <option value="medium">Medium risk</option>
            <option value="high">High risk</option>
          </select>
          <Tabs value={basis} onChange={setBasis} options={[{ value: "perGame", label: "Per game" }, { value: "season", label: "Season totals" }]} />
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setShowCols(!showCols)}>
              Columns
            </Button>
            <Button size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
            <Button size="sm" variant="primary" disabled={selected.length < 2} onClick={() => router.push(`/compare?ids=${selected.join(",")}`)}>
              Compare ({selected.length})
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-mute">Custom weights / punts (drives “Punt rk”):</span>
          <WeightsEditor weights={weights} onChange={setWeights} active={ctx.cats} />
          <Button size="sm" variant="ghost" onClick={() => setWeights(uniformWeights())}>
            Reset
          </Button>
        </div>
        {showCols && (
          <div className="flex flex-wrap gap-2 text-xs">
            {COLS.map((c) => (
              <label key={c.key} className="flex items-center gap-1">
                <input type="checkbox" checked={cols.has(c.key)} onChange={(e) => setCols((s) => { const n = new Set(s); if (e.target.checked) n.add(c.key); else n.delete(c.key); return n; })} />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </Panel>
      <Panel bodyClass="p-0">
        <div className="max-h-[calc(100vh-280px)] overflow-auto">
          <table className="grid-table w-full text-xs" data-testid="players-table">
            <thead className="text-[10px] text-dim uppercase">
              <tr>
                <th className="px-1 py-1"></th>
                <th onClick={() => setSort((s) => ({ key: "name", dir: s.key === "name" ? ((-s.dir) as 1 | -1) : 1 }))} className="cursor-pointer px-2 py-1 text-left">Player</th>
                {COLS.filter((c) => cols.has(c.key)).map((c) => th(c.key, c.label, c.title))}
                <th className="px-1 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((p) => {
                const j = p.proj;
                const m = basis === "season" && j ? j.gp : 1;
                const v = ctx.values.get(p.id);
                const r = risks.get(p.id);
                const drafted = ctx.drafted.has(p.id);
                const adp = p.adp ?? ctx.marketRank.get(p.id);
                const cell: Record<ColKey, React.ReactNode> = {
                  team: p.team,
                  pos: p.elig.join("/"),
                  rank: v?.rank ?? "—",
                  puntRank: puntVals.get(p.id)?.rank ?? "—",
                  adp: adp != null ? (p.adp != null ? p.adp.toFixed(1) : <span className="text-dim">{adp}*</span>) : "—",
                  adpDiff: adp != null && v ? <span className={cn(adp - v.rank > 10 ? "text-good" : adp - v.rank < -10 ? "text-bad" : "")}>{adp - v.rank > 0 ? "+" : ""}{Math.round(adp - v.rank)}</span> : "—",
                  gp: j ? fmt(j.gp, 0) : "—",
                  min: j ? fmt(j.min) : "—",
                  pts: j ? fmt(j.pts * m, basis === "season" ? 0 : 1) : "—",
                  fg3m: j ? fmt(j.fg3m * m, basis === "season" ? 0 : 1) : "—",
                  reb: j ? fmt(j.reb * m, basis === "season" ? 0 : 1) : "—",
                  ast: j ? fmt(j.ast * m, basis === "season" ? 0 : 1) : "—",
                  stl: j ? fmt(j.stl * m, basis === "season" ? 0 : 1) : "—",
                  blk: j ? fmt(j.blk * m, basis === "season" ? 0 : 1) : "—",
                  fgPct: j && j.fga ? fmt((j.fgm / j.fga) * 100) : "—",
                  fga: j ? fmt(j.fga * m, basis === "season" ? 0 : 1) : "—",
                  ftPct: j && j.fta ? fmt((j.ftm / j.fta) * 100) : "—",
                  fta: j ? fmt(j.fta * m, basis === "season" ? 0 : 1) : "—",
                  tov: j ? fmt(j.tov * m, basis === "season" ? 0 : 1) : "—",
                  z: v ? fmt(v.total, 2) : "—",
                  risk: r ? <Badge tone={r.overall === "high" ? "bad" : r.overall === "medium" ? "warn" : "good"}>{r.overall}</Badge> : "—",
                  avail: drafted ? "—" : surv?.get(p.id) != null ? `${(surv.get(p.id)! * 100).toFixed(0)}%` : "…",
                  status: drafted ? <Badge>drafted</Badge> : p.availability && p.availability.status !== "HEALTHY" ? <Badge tone="warn">{p.availability.status}</Badge> : "",
                };
                return (
                  <tr key={p.id} className={cn("border-b border-line/50 hover:bg-panel2", drafted && "opacity-50")}>
                    <td className="px-1 py-1">
                      <input type="checkbox" checked={selected.includes(p.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, p.id].slice(-5) : s.filter((x) => x !== p.id)))} aria-label={`select ${p.name}`} />
                      <button onClick={() => toggleWatch(p.id)} className={cn("ml-1", watch.includes(p.id) ? "text-accent" : "text-dim")}>
                        ★
                      </button>
                    </td>
                    <td className="max-w-56 px-2 py-1">
                      <PlayerLink p={p} compact />
                    </td>
                    {COLS.filter((c) => cols.has(c.key)).map((c) => (
                      <td key={c.key} className="num px-1.5 py-1 text-right whitespace-nowrap">
                        {cell[c.key]}
                      </td>
                    ))}
                    <td className="px-1 py-1">
                      {!drafted && p.proj && (
                        <Button size="sm" onClick={() => void draft(p.id)}>
                          Draft
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-line px-2 py-1.5 text-xs text-mute">
          <span>
            {Math.min(limit, rows.length)} of {rows.length} shown · {CAT_KEYS.filter((k) => weights[k] === 0).map((k) => CAT_BY_KEY[k].short).join("/") || "no punts"}
          </span>
          {rows.length > limit && (
            <Button size="sm" onClick={() => setLimit(limit + 150)}>
              Show more
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
