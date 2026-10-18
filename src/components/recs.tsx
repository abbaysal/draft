"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CAT_BY_KEY } from "@/lib/categories";
import type { CandidateEval } from "@/lib/engine/recommend";
import type { ChampionshipSummary } from "@/lib/engine/championship";
import { useCurrentKey, useEngineContext, useFast } from "@/client/analysis";
import { useStore } from "@/client/store";
import { Badge, Button, cn, Delta, Empty, Panel, Spinner } from "./ui";
import { PlayerLink, useDraftPlayer } from "./player";

export interface RankedCandidate extends CandidateEval {
  champ?: ChampionshipSummary;
}

/** Primary ranking: Δ championship (level 0) → Δ playoffs (level 1) → fast expected-outcome lookahead (level 2). */
export function usePrimaryRanking() {
  const fast = useFast();
  const champ = useStore((s) => s.champ);
  const key = useCurrentKey();
  return useMemo(() => {
    const rec = fast.result?.rec;
    if (!rec) return null;
    const current = champ && champ.key === key ? champ : null;
    const verdict = current?.verdict ?? null;
    const byId = new Map((verdict?.summaries ?? []).map((s) => [s.id, s]));
    let ranked: RankedCandidate[] = rec.candidates.map((c) => ({ ...c, champ: byId.get(c.id) }));
    const level = verdict?.level ?? 2;
    if (level < 2 && verdict) {
      const simIds = verdict.summaries.map((s) => s.id);
      const sims = simIds.map((id) => ranked.find((r) => r.id === id)!).filter(Boolean);
      const rest = ranked.filter((r) => !simIds.includes(r.id));
      ranked = [...sims, ...rest];
    }
    return {
      ranked,
      level,
      label: verdict && level < 2 ? verdict.label : rec.metricName,
      reason: verdict?.reason ?? (current?.running ? "Championship simulations running…" : "Championship simulations not yet available."),
      champ: current,
      rec,
      stale: fast.stale,
    };
  }, [fast.result, fast.stale, champ, key]);
}

export function MetricBanner() {
  const pr = usePrimaryRanking();
  const champ = useStore((s) => s.champ);
  if (!pr) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="metric-banner">
      <span className="text-dim">Optimization metric in use:</span>
      <Badge tone={pr.level === 0 ? "good" : pr.level === 1 ? "info" : "accent"}>{pr.label}</Badge>
      <span className="text-mute">{pr.reason}</span>
      {champ?.running && <Spinner label={`${champ.done}/${champ.sims} sims`} />}
    </div>
  );
}

function fmtPct(x: number, d = 0) {
  return `${(x * 100).toFixed(d)}%`;
}

export function CatImpact({ impact, max = 5, wrap = true }: { impact: Record<string, number>; max?: number; wrap?: boolean }) {
  const rows = Object.entries(impact)
    .filter(([, v]) => Math.abs(v) >= 0.003)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, max);
  if (!rows.length) return <span className="text-dim">—</span>;
  return (
    <span className={cn("flex gap-1", wrap ? "flex-wrap" : "flex-nowrap")}>
      {rows.map(([k, v]) => (
        <span key={k} className={cn("num rounded px-1 text-[10px]", v > 0 ? "bg-green-950 text-green-300" : "bg-red-950 text-red-300")}>
          {CAT_BY_KEY[k as keyof typeof CAT_BY_KEY].short} {v > 0 ? "+" : ""}
          {(v * 100).toFixed(1)}
        </span>
      ))}
    </span>
  );
}

export function TopPickCard() {
  const pr = usePrimaryRanking();
  const ctx = useEngineContext();
  const draft = useDraftPlayer();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const first = pr?.ranked[0]?.id ?? id;
      if (confirm(`Draft ${ctx?.byId.get(first)?.name}?`)) void draft(first);
    };
    document.addEventListener("wr:draft-top", h);
    return () => document.removeEventListener("wr:draft-top", h);
  }, [pr, ctx, draft]);
  if (!pr || !ctx) return <Panel title="Best strategic pick now"><Spinner label="Computing recommendations…" /></Panel>;
  const top = pr.ranked[0];
  if (!top) return <Panel title="Best strategic pick now"><Empty>No available players.</Empty></Panel>;
  const p = ctx.byId.get(top.id)!;
  const fmt = pr.rec.objectiveName;
  return (
    <Panel title="Best strategic pick now" right={pr.stale ? <Spinner label="updating" /> : <Badge tone="good">LIVE</Badge>} className="border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-bold">
            <PlayerLink p={p} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {p.tags.slice(0, 4).map((t) => (
              <Badge key={t.kind + t.label} tone="neutral" title={t.evidence.join("\n")}>
                {t.label}
              </Badge>
            ))}
          </div>
        </div>
        <Button variant="primary" onClick={() => void draft(top.id)} data-testid="draft-top">
          Draft
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] text-dim uppercase">Strategic Δ</div>
          <div className="text-base"><Delta v={top.strategic} /></div>
          <div className="text-[10px] text-dim">{fmt}</div>
        </div>
        <div>
          <div className="text-[10px] text-dim uppercase">Survives to next pick</div>
          <div className={cn("num text-base", top.survival < 0.3 ? "text-bad" : top.survival < 0.6 ? "text-warn" : "text-good")}>{fmtPct(top.survival)}</div>
        </div>
        <div>
          <div className="text-[10px] text-dim uppercase">Δ P(title)</div>
          <div className="text-base">{top.champ ? <><Delta v={top.champ.deltaChamp} pct digits={1} /><span className="num text-[11px] text-dim"> ±{(top.champ.deltaChampSe * 100).toFixed(1)}</span></> : <span className="text-dim">—</span>}</div>
          <div className="text-[10px] text-dim">{top.champ ? `P(title) ${fmtPct(top.champ.pChamp, 1)}` : "sim pending"}</div>
        </div>
        <div>
          <div className="text-[10px] text-dim uppercase">Value rank / market</div>
          <div className="num text-base">
            #{top.valueRank} <span className="text-dim">/ {top.adp != null ? `ADP ${top.adp.toFixed(1)}` : `#${top.marketRank}`}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 text-sm">
        <CatImpact impact={top.catImpact} max={6} />
      </div>
      <ul className="mt-2 space-y-0.5 text-xs text-mute">
        {top.reasons.map((r) => (
          <li key={r}>• {r}</li>
        ))}
      </ul>
      <button onClick={() => setOpen(!open)} className="mt-2 flex items-center gap-1 text-xs text-accent2">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} Detailed breakdown
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-panel2 p-2 text-xs">
          <span className="text-mute">Immediate roster fit (vs expected pick at slot)</span>
          <Delta v={top.gain} />
          <span className="text-mute">Two-pick lookahead (pick now vs wait)</span>
          <Delta v={top.strategic} />
          <span className="text-mute">Downside (P10 games & production)</span>
          <span className="num text-bad">−{top.downside.toFixed(3)}</span>
          <span className="text-mute">Upside (P90)</span>
          <span className="num text-good">+{top.upside.toFixed(3)}</span>
          <span className="text-mute">Risk-aversion λ × downside</span>
          <span className="num">−{(ctx.settings.riskAversion * top.downside).toFixed(3)}</span>
          <span className="text-mute">Final fast score</span>
          <Delta v={top.score} />
          <span className="text-mute">Expected draft position (if taken before your pick)</span>
          <span className="num">{top.expectedPick ? top.expectedPick.toFixed(1) : "—"}</span>
          <span className="text-mute">Baseline objective</span>
          <span className="num">{pr.rec.baselineObj.toFixed(3)}</span>
        </div>
      )}
    </Panel>
  );
}

export function CandidateTable({ limit = 8, title = "Top alternatives" }: { limit?: number; title?: string }) {
  const pr = usePrimaryRanking();
  const ctx = useEngineContext();
  const draft = useDraftPlayer();
  if (!pr || !ctx) return <Panel title={title}><Spinner /></Panel>;
  return (
    <Panel title={title} right={<span className="text-dim">{pr.label}</span>} bodyClass="p-0">
      <table className="w-full text-xs" data-testid="candidate-table">
        <thead className="text-[10px] text-dim uppercase">
          <tr className="border-b border-line">
            <th className="px-2 py-1 text-left">#</th>
            <th className="px-2 py-1 text-left">Player</th>
            <th className="px-2 py-1 text-right" title="Two-pick lookahead score minus risk penalty">Score</th>
            <th className="px-2 py-1 text-right" title="Immediate improvement vs expected pick at this slot">Fit</th>
            <th className="px-2 py-1 text-right">Survive</th>
            <th className="px-2 py-1 text-right" title="Δ championship probability ± SE (common random numbers)">ΔTitle</th>
            <th className="hidden px-2 py-1 text-left 2xl:table-cell">Category impact</th>
            <th className="px-2 py-1"></th>
          </tr>
        </thead>
        <tbody>
          {pr.ranked.slice(0, limit).map((c, i) => {
            const p = ctx.byId.get(c.id)!;
            return (
              <tr key={c.id} className="border-b border-line/60 hover:bg-panel2">
                <td className="num px-2 py-1 text-dim">{i + 1}</td>
                <td className="max-w-56 px-2 py-1">
                  <PlayerLink p={p} compact />
                </td>
                <td className="px-2 py-1 text-right"><Delta v={c.score} /></td>
                <td className="px-2 py-1 text-right"><Delta v={c.gain} /></td>
                <td className={cn("num px-2 py-1 text-right", c.survival < 0.3 ? "text-bad" : c.survival < 0.6 ? "text-warn" : "text-good")}>{fmtPct(c.survival)}</td>
                <td className="px-2 py-1 text-right">
                  {c.champ ? (
                    <span title={`P(title) ${fmtPct(c.champ.pChamp, 1)} · P(playoffs) ${fmtPct(c.champ.pPlayoffs)}`}>
                      <Delta v={c.champ.deltaChamp} pct digits={1} />
                      <span className="num text-[10px] text-dim">±{(c.champ.deltaChampSe * 100).toFixed(1)}</span>
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </td>
                <td className="hidden px-2 py-1 2xl:table-cell"><CatImpact impact={c.catImpact} max={3} wrap={false} /></td>
                <td className="px-2 py-1 text-right">
                  <Button size="sm" onClick={() => void draft(c.id)}>
                    Draft
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

const PICK_LABEL: Record<string, string> = {
  bestStrategic: "Best strategic pick",
  bestFit: "Best roster fit",
  bestOverall: "Best player overall",
  bestValueAdp: "Best value vs ADP",
  bestScarcity: "Best scarcity play",
  bestUpside: "Best upside",
  bestLowRisk: "Best low-risk",
};

export function LabelledPicks() {
  const fast = useFast();
  const ctx = useEngineContext();
  const draft = useDraftPlayer();
  if (!fast.result || !ctx) return null;
  const picks = fast.result.rec.picks;
  return (
    <Panel title="Pick lenses">
      <div className="space-y-1.5 text-xs">
        {Object.entries(PICK_LABEL).map(([k, label]) => {
          const v = picks[k as keyof typeof picks];
          if (!v) return (
            <div key={k} className="flex justify-between text-dim">
              <span>{label}</span>
              <span>{k === "bestValueAdp" ? "needs imported ADP" : "—"}</span>
            </div>
          );
          const p = ctx.byId.get(v.id);
          return (
            <div key={k} className="flex items-center justify-between gap-2" title={v.why}>
              <span className="text-mute">{label}</span>
              <span className="flex items-center gap-2">
                {p && <PlayerLink p={p} compact />}
                <Button size="sm" variant="ghost" onClick={() => void draft(v.id)}>
                  +
                </Button>
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
