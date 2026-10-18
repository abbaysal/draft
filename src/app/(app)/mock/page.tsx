"use client";
import { useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { POLICY, mergeChunks, type CandidateTally } from "@/lib/engine/championship";
import { quantile } from "@/lib/engine/math";
import { strategyCatalog } from "@/lib/engine/strategy";
import { runChampionship, useCurrentKey, useEngineContext } from "@/client/analysis";
import { cancelDeep } from "@/client/engine";
import { useActiveSession, useDataset } from "@/client/store";
import { Badge, Button, Field, inputCls, Panel, Spinner } from "@/components/ui";
import { PlayerSearch } from "@/components/player";

function hist(xs: number[], bins = 16) {
  if (!xs.length) return [];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const w = (hi - lo) / bins || 1;
  const out = Array.from({ length: bins }, (_, i) => ({ x: +(lo + w * (i + 0.5)).toFixed(2), n: 0 }));
  for (const x of xs) out[Math.min(bins - 1, Math.floor((x - lo) / w))].n++;
  return out;
}

export default function MockPage() {
  const ctx = useEngineContext();
  const ds = useDataset();
  const session = useActiveSession();
  const key = useCurrentKey();
  const [a, setA] = useState<string>(POLICY);
  const [b, setB] = useState<string | null>(null);
  const [strategy, setStrategy] = useState("optimizer");
  const [sims, setSims] = useState(300);
  const [tallies, setTallies] = useState<CandidateTally[] | null>(null);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const runId = useRef(0);
  const catalog = useMemo(() => (ctx ? strategyCatalog(ctx.cats).filter((s) => s.kind !== "double") : []), [ctx]);
  if (!ctx || !ds || !session) return <Spinner />;
  const name = (id: string) => (id === POLICY ? "Optimizer's choice" : (ctx.byId.get(id)?.name ?? id));
  const start = async () => {
    const my = ++runId.current;
    cancelDeep();
    setRunning(true);
    setTallies(null);
    setProgress(0);
    const weights = strategy === "optimizer" ? null : (catalog.find((s) => s.key === strategy)?.weights as unknown as Record<string, number>);
    const cands = [a, ...(b ? [b] : [])];
    try {
      await runChampionship({
        ds,
        state: { settings: session.settings, draft: session.state },
        key: `${key}|mock|${my}`,
        candidates: cands,
        sims,
        collect: true,
        myWeights: weights,
        isCurrent: () => runId.current === my,
        onProgress: (chunks, done) => {
          if (runId.current !== my) return;
          setTallies(mergeChunks(chunks));
          setProgress(done);
        },
      });
    } finally {
      if (runId.current === my) setRunning(false);
    }
  };
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">Mock Draft Simulator</h1>
      <Panel title="Setup — simulate the rest of the draft and the season from the current state">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Option A (your next pick)">
            <div className="flex items-center gap-2">
              <Badge tone="accent">{name(a)}</Badge>
              <div className="w-56"><PlayerSearch players={ctx.players.filter((p) => ctx.availableSet.has(p.id))} drafted={ctx.drafted} autoFocusKey="__none__" placeholder="Pick a player…" onPick={(p) => setA(p.id)} /></div>
              {a !== POLICY && <Button size="sm" variant="ghost" onClick={() => setA(POLICY)}>reset</Button>}
            </div>
          </Field>
          <Field label="Option B (compare)">
            <div className="flex items-center gap-2">
              {b && <Badge tone="info">{name(b)}</Badge>}
              <div className="w-56"><PlayerSearch players={ctx.players.filter((p) => ctx.availableSet.has(p.id))} drafted={ctx.drafted} autoFocusKey="__none__" placeholder="Optional…" onPick={(p) => setB(p.id)} /></div>
              {b && <Button size="sm" variant="ghost" onClick={() => setB(null)}>✕</Button>}
            </div>
          </Field>
          <Field label="My later picks follow">
            <select className={inputCls} value={strategy} onChange={(e) => setStrategy(e.target.value)}>
              <option value="optimizer">Marginal win-probability optimizer</option>
              {catalog.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Simulations"><select className={inputCls} value={sims} onChange={(e) => setSims(Number(e.target.value))}>{[100, 300, 600, 1000].map((n) => <option key={n}>{n}</option>)}</select></Field>
          <Button variant="primary" onClick={() => void start()} disabled={running} data-testid="run-mock">Run</Button>
          {running && <><Spinner label={`${progress}/${sims}`} /><Button size="sm" variant="ghost" onClick={() => { runId.current++; cancelDeep(); setRunning(false); }}>Cancel</Button></>}
        </div>
        <div className="mt-2 text-[10px] text-dim">Seeded and reproducible for a given draft state. Opponents follow the market model with ADP noise, positional needs and learned tendencies.</div>
      </Panel>
      {tallies && (
        <div className="grid gap-3 xl:grid-cols-2">
          {tallies.map((t) => {
            const xs = [...(t.finalObjs ?? [])].sort((x, y) => x - y);
            const freq = new Map<string, number>();
            for (const r of t.rosters ?? []) for (const id of r.slice(ctx.rosters[ctx.myIndex].length)) freq.set(id, (freq.get(id) ?? 0) + 1);
            const top = [...freq.entries()].sort((x, y) => y[1] - x[1]).slice(0, 14);
            const ranks = hist((t.ranks ?? []).map(Number), Math.min(ctx.settings.teams, 12));
            return (
              <Panel key={t.id} title={name(t.id)} right={<span className="text-dim">{t.sims} sims</span>}>
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div><div className="text-dim">P(title)</div><div className="num text-lg">{((t.champ / Math.max(1, t.sims)) * 100).toFixed(1)}%</div></div>
                  <div><div className="text-dim">P(playoffs)</div><div className="num text-lg">{((t.playoffs / Math.max(1, t.sims)) * 100).toFixed(0)}%</div></div>
                  <div><div className="text-dim">Final objective P10/50/90</div><div className="num">{xs.length ? `${quantile(xs, 0.1).toFixed(2)} / ${quantile(xs, 0.5).toFixed(2)} / ${quantile(xs, 0.9).toFixed(2)}` : "—"}</div></div>
                  <div><div className="text-dim">Unavailable at pick</div><div className="num">{((t.unavailable / Math.max(1, t.sims)) * 100).toFixed(0)}%</div></div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div className="h-40">
                    <div className="text-[10px] text-dim uppercase">Final roster strength distribution</div>
                    <ResponsiveContainer><BarChart data={hist(xs)}><CartesianGrid stroke="#1f2a37" vertical={false} /><XAxis dataKey="x" tick={{ fill: "#8a97a8", fontSize: 10 }} /><YAxis tick={{ fill: "#8a97a8", fontSize: 10 }} /><Tooltip contentStyle={{ background: "#141b24", border: "1px solid #1f2a37", fontSize: 12 }} /><Bar dataKey="n" fill="#f5a524" /></BarChart></ResponsiveContainer>
                  </div>
                  <div className="h-40">
                    <div className="text-[10px] text-dim uppercase">Regular-season finish</div>
                    <ResponsiveContainer><BarChart data={ranks}><CartesianGrid stroke="#1f2a37" vertical={false} /><XAxis dataKey="x" tick={{ fill: "#8a97a8", fontSize: 10 }} /><YAxis tick={{ fill: "#8a97a8", fontSize: 10 }} /><Bar dataKey="n" fill="#38bdf8" /></BarChart></ResponsiveContainer>
                  </div>
                </div>
                <div className="mt-6 text-[10px] text-dim uppercase">Most frequent future additions to your roster</div>
                <div className="mt-1 flex flex-wrap gap-1 text-xs">{top.map(([id, n]) => <Badge key={id}>{ctx.byId.get(id)?.name} {((n / t.sims) * 100).toFixed(0)}%</Badge>)}</div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}
