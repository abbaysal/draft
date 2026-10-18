"use client";
import { useEffect, useState } from "react";
import { importAdp, importMetadata, importProjections, importSchedule, type ImportIssue, type ImportKind } from "@/lib/import/csv";
import { useEngineContext } from "@/client/analysis";
import { useDataset, useStore } from "@/client/store";
import { Badge, Button, Field, inputCls, Panel, Spinner } from "@/components/ui";
import { PlayerSearch } from "@/components/player";

interface ImportSummary {
  rowCount: number;
  imported?: number;
  unmatched: string[];
  issues: ImportIssue[];
  targetId?: string | null;
  dryRun?: boolean;
}

const KINDS: { kind: ImportKind; label: string; help: string }[] = [
  { kind: "projections", label: "Player projections", help: "Per-game (or season totals with basis=total). Needs GP, PTS, 3PM, REB, AST, STL, BLK, TO, FGA + FGM or FG%, FTA + FTM or FT%. Hashtag Basketball / Basketball Monster column names are recognised." },
  { kind: "adp", label: "ADP", help: "name + adp (+ optional team, source). Enables real market modelling and value-vs-ADP." },
  { kind: "schedule", label: "NBA schedule 2026-27", help: "date, home, away (abbreviations or full team names). Enables playoff-week analysis." },
  { kind: "metadata", label: "Player metadata / eligibility", help: "name + positions (e.g. PG/SG) to replace derived eligibility with your platform's." },
  { kind: "history", label: "Historical stats", help: "season (e.g. 2024-25) + per-game stats with attempts." },
];

export default function DataPage() {
  const mode = useStore((s) => s.mode);
  const ds = useDataset();
  const ctx = useEngineContext();
  const setLocal = useStore((s) => s.setLocalImports);
  const localImports = useStore((s) => s.localImports);
  const reload = useStore((s) => s.reloadDataset);
  const toast = useStore((s) => s.toast);
  const [kind, setKind] = useState<ImportKind>("projections");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [totals, setTotals] = useState(false);
  const [activate, setActivate] = useState(true);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<Record<string, unknown> | null>(null);
  const [sets, setSets] = useState<{ id: string; label: string; kind: string; isActive: boolean; count: number; createdAt: string }[]>([]);
  const [ovPlayer, setOvPlayer] = useState<string | null>(null);
  const [ovGames, setOvGames] = useState(10);
  const [ovNote, setOvNote] = useState("");

  const loadMeta = () => {
    fetch("/api/freshness").then((r) => r.json()).then(setFresh).catch(() => {});
    if (mode === "server") fetch("/api/projection-sets").then((r) => r.json()).then((d) => setSets(d.sets ?? [])).catch(() => {});
  };
  useEffect(loadMeta, [mode]);

  const run = async (dryRun: boolean) => {
    if (!text.trim() || !ds) return;
    setBusy(true);
    try {
      if (mode === "server") {
        const r = await fetch(`/api/import/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, source: source || "manual", totals, activate, dryRun }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Import failed");
        setResult(d);
        if (!dryRun && d.imported) {
          toast("success", `Imported ${d.imported} rows as a new version`);
          await reload();
          loadMeta();
        }
      } else {
        const players = ds.players;
        const label = source || "manual";
        let res: ImportSummary;
        if (kind === "projections") {
          const r = importProjections(text, players, { totals });
          res = { rowCount: r.rows.length, unmatched: r.unmatched, issues: r.issues };
          if (!dryRun && r.rows.length) setLocal({ projections: { id: `local-${label}-${Date.now()}`, label, source: label, kind: "external", createdAt: new Date().toISOString(), rows: r.rows } });
        } else if (kind === "adp") {
          const r = importAdp(text, players, label);
          res = { rowCount: r.rows.length, unmatched: r.unmatched, issues: r.issues };
          if (!dryRun && r.rows.length) setLocal({ adp: r.rows });
        } else if (kind === "schedule") {
          const r = importSchedule(text);
          res = { rowCount: r.rows.length, unmatched: [], issues: r.issues };
          if (!dryRun && r.rows.length) setLocal({ schedule: r.rows });
        } else if (kind === "metadata") {
          const r = importMetadata(text, players);
          res = { rowCount: r.rows.length, unmatched: r.unmatched, issues: r.issues };
          if (!dryRun && r.rows.length) setLocal({ metadata: r.rows });
        } else {
          res = { rowCount: 0, unmatched: [], issues: [{ row: 0, level: "error", message: "Historical imports require the database (server mode)." }] };
        }
        setResult({ ...res, imported: dryRun ? 0 : res.rowCount, dryRun });
        if (!dryRun && res.rowCount) toast("success", `Applied ${res.rowCount} rows (stored in this browser)`);
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const addOverride = async () => {
    if (!ovPlayer) return;
    if (mode === "server") {
      const r = await fetch("/api/overrides", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ field: "gamesMissed", playerId: ovPlayer, value: { games: ovGames }, note: ovNote || "manual" }) });
      if (r.ok) {
        toast("success", "Override saved");
        await reload();
      } else toast("error", "Override failed");
    } else {
      setLocal({ overrides: [...localImports.overrides.filter((o) => o.playerId !== ovPlayer), { playerId: ovPlayer, games: ovGames, note: ovNote || "manual" }] });
      toast("success", "Override applied (this browser)");
    }
    setOvPlayer(null);
  };

  const k = KINDS.find((x) => x.kind === kind)!;
  const meta = (fresh?.bundled ?? null) as { sources?: { id: string; name: string; url: string; season: string; retrieved: string; sha256?: string }[]; builtAt?: string; notes?: string[] } | null;
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">Data Management</h1>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Import CSV" className="xl:col-span-2" right={<Badge tone={mode === "server" ? "good" : "neutral"}>{mode === "server" ? "Saved to database as a new immutable version" : "Local mode — stored in this browser"}</Badge>}>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((x) => (
              <Button key={x.kind} size="sm" variant={kind === x.kind ? "primary" : "default"} onClick={() => { setKind(x.kind); setResult(null); }}>
                {x.label}
              </Button>
            ))}
          </div>
          <div className="mt-2 text-xs text-mute">{k.help} <a className="text-accent2 underline" href={`/api/import/template/${kind}`}>Download template</a></div>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <Field label="Source name (e.g. hashtag-basketball, yahoo-adp)"><input className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} /></Field>
            <label className="flex cursor-pointer items-center gap-1 text-xs"><input type="file" accept=".csv,text/csv" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); if (!source) setSource(f.name.replace(/\.csv$/i, "")); } }} /></label>
            {kind === "projections" && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={totals} onChange={(e) => setTotals(e.target.checked)} /> values are season totals</label>}
            {kind === "projections" && mode === "server" && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> make active (new drafts use it)</label>}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste CSV here" className="mt-2 h-40 w-full rounded-md border border-line bg-bg p-2 font-mono text-[11px] outline-none focus:border-accent" data-testid="import-text" />
          <div className="mt-2 flex gap-2">
            <Button onClick={() => void run(true)} disabled={busy || !text}>Validate (dry run)</Button>
            <Button variant="primary" onClick={() => void run(false)} disabled={busy || !text} data-testid="import-run">Import</Button>
            {busy && <Spinner />}
          </div>
          {result && (
            <div className="mt-3 space-y-1 rounded-md bg-panel2 p-2 text-xs">
              <div>
                {result.dryRun ? "Valid rows" : "Imported"}: <span className="num text-ink">{result.dryRun ? result.rowCount : (result.imported ?? result.rowCount)}</span> · unmatched players: <span className="num">{result.unmatched.length}</span> · issues: <span className="num">{result.issues.length}</span>
                {result.targetId && <> · version <span className="num">{result.targetId}</span></>}
              </div>
              {result.unmatched.length > 0 && <div className="text-mute">Unmatched (not imported — fix names or add nba_id): {result.unmatched.slice(0, 30).join(", ")}{result.unmatched.length > 30 ? "…" : ""}</div>}
              {result.issues.slice(0, 20).map((i, n) => (
                <div key={n} className={i.level === "error" ? "text-red-400" : "text-yellow-400"}>{i.row ? `Row ${i.row}: ` : ""}{i.message}</div>
              ))}
            </div>
          )}
        </Panel>
        <div className="space-y-3">
          <Panel title="Active data">
            <div className="space-y-1 text-xs">
              <div>Players: <span className="num">{ds?.players.length}</span> · projected <span className="num">{ds?.players.filter((p) => p.proj).length}</span></div>
              <div>Projection version: <span className="num">{ds?.projectionSetId}</span> {ds?.frozen && <Badge tone="info">frozen for this draft</Badge>}</div>
              <div>Market: {ctx?.marketSource === "proxy" ? <Badge tone="warn">proxy — no ADP</Badge> : <Badge tone="good">ADP ({ctx?.marketSource})</Badge>}</div>
              <div>Schedule: {ctx?.schedule.source === "uniform" ? <Badge tone="warn">uniform estimate</Badge> : <Badge tone="good">{ctx?.schedule.label}</Badge>}</div>
              {mode === "local" && (localImports.projections || localImports.adp || localImports.schedule || localImports.metadata || localImports.overrides.length > 0) && (
                <Button size="sm" variant="danger" onClick={() => setLocal({ projections: null, adp: null, schedule: null, metadata: null, overrides: [] })}>Clear local imports</Button>
              )}
            </div>
          </Panel>
          {mode === "server" && (
            <Panel title="Projection versions">
              <ul className="space-y-1 text-xs">
                {sets.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span>{s.label} <span className="text-dim">· {s.kind} · {s.count} · {new Date(s.createdAt).toLocaleDateString()}</span></span>
                    {s.isActive ? <Badge tone="good">active</Badge> : <Button size="sm" variant="ghost" onClick={async () => { await fetch("/api/projection-sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "activate", id: s.id }) }); await reload(); loadMeta(); }}>activate</Button>}
                  </li>
                ))}
              </ul>
              {sets.length > 1 && (
                <Button size="sm" className="mt-2" onClick={async () => { const r = await fetch("/api/projection-sets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "consensus", inputs: sets.slice(0, 4).map((s) => ({ id: s.id, weight: 1 })) }) }); const d = await r.json(); toast(r.ok ? "success" : "error", r.ok ? `Consensus ${d.id} created (${d.count} players)` : d.error); loadMeta(); }}>
                  Build equal-weight consensus of latest sets
                </Button>
              )}
              <div className="mt-1 text-[10px] text-dim">Sets are immutable; drafts keep the version they started with.</div>
            </Panel>
          )}
          <Panel title="Manual availability correction">
            {ctx && <PlayerSearch players={ctx.players} drafted={new Set()} autoFocusKey="__none__" placeholder="Player…" onPick={(p) => setOvPlayer(p.id)} />}
            {ovPlayer && (
              <div className="mt-2 space-y-2 text-xs">
                <div>{ctx?.byId.get(ovPlayer)?.name}</div>
                <Field label="Games expected to miss"><input type="number" min={0} max={82} className={inputCls} value={ovGames} onChange={(e) => setOvGames(Number(e.target.value))} /></Field>
                <Field label="Note / source"><input className={inputCls} value={ovNote} onChange={(e) => setOvNote(e.target.value)} /></Field>
                <Button size="sm" variant="primary" onClick={() => void addOverride()}>Apply</Button>
              </div>
            )}
          </Panel>
        </div>
      </div>
      <Panel title="Source freshness & provenance">
        <table className="w-full text-xs">
          <thead className="text-[10px] text-dim uppercase"><tr><th className="text-left">Source</th><th className="text-left">Season</th><th className="text-left">Retrieved</th><th className="text-left">sha256</th></tr></thead>
          <tbody>
            {meta?.sources?.map((s) => (
              <tr key={s.id} className="border-t border-line/50">
                <td className="py-1">{s.url.startsWith("http") ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}</td>
                <td>{s.season}</td>
                <td>{s.retrieved}</td>
                <td className="num text-dim">{s.sha256?.slice(0, 12) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-2 space-y-0.5 text-[11px] text-mute">{meta?.notes?.map((n) => <li key={n}>• {n}</li>)}</ul>
        <div className="mt-1 text-[10px] text-dim">Dataset built {meta?.builtAt}. See DATA_SOURCES.md for licensing and reliability notes.</div>
      </Panel>
    </div>
  );
}
