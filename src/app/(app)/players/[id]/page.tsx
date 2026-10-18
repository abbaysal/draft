"use client";
import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CAT_BY_KEY, puntWeights } from "@/lib/categories";
import { valuePlayers } from "@/lib/engine/valuation";
import { playerRisk } from "@/lib/engine/risk";
import { evaluateRoster } from "@/lib/engine/recommend";
import { playoffTable } from "@/lib/engine/playoffs";
import { POLICY, mergeChunks, summarise, type ChampionshipVerdict } from "@/lib/engine/championship";
import type { CategoryKey } from "@/lib/types";
import { runChampionship, useCurrentKey, useEngineContext, useFast } from "@/client/analysis";
import { useActiveSession, useDataset, useStore } from "@/client/store";
import { Badge, Button, cn, Delta, Panel, ProbBar, Spinner, Stat } from "@/components/ui";
import { PlayerLink, StatusBadge, useDraftPlayer } from "@/components/player";
import { CatImpact } from "@/components/recs";

interface NewsRow {
  id: string;
  title: string;
  body: string | null;
  status: string;
  confidence: string;
  sourceName: string;
  sourceUrl: string | null;
  publishedAt: string;
}

export default function PlayerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = use(params);
  const id = decodeURIComponent(rawId);
  const ctx = useEngineContext();
  const fast = useFast();
  const ds = useDataset();
  const session = useActiveSession();
  const key = useCurrentKey();
  const mode = useStore((s) => s.mode);
  const draft = useDraftPlayer();
  const [news, setNews] = useState<NewsRow[] | null>(null);
  const [whatIf, setWhatIf] = useState(false);
  const [sim, setSim] = useState<{ running: boolean; done: number; verdict: ChampionshipVerdict | null } | null>(null);

  useEffect(() => {
    if (mode !== "server") return;
    fetch(`/api/news?playerId=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d: { items?: NewsRow[] }) => setNews(d.items ?? []))
      .catch(() => setNews([]));
  }, [id, mode]);

  const p = ctx?.byId.get(id);
  const punts = useMemo(() => {
    if (!ctx || !p?.proj) return [];
    return ctx.cats.map((c) => ({ c, rank: valuePlayers(ctx.players, ctx.baseline, puntWeights([c])).get(id)?.rank ?? 0 }));
  }, [ctx, p, id]);

  const hypo = useMemo(() => {
    if (!ctx || !fast.result || fast.stale || !p?.proj || !whatIf) return null;
    const field = fast.result.rec.field;
    const r = evaluateRoster(ctx, field, [id]);
    const impact: Record<string, number> = {};
    for (const c of ctx.cats) impact[c] = r.ev.perCategory[c] - field.baseline.perCategory[c];
    return { obj: r.obj, delta: r.obj - field.baselineObj, ev: r.ev, impact };
  }, [ctx, fast.result, fast.stale, p, whatIf, id]);

  const complements = useMemo(() => {
    if (!ctx || !p?.proj) return [];
    const v = ctx.values.get(id);
    if (!v) return [];
    const weak = ctx.cats.filter((c) => v.cat[c] < -0.25);
    return ctx.available
      .filter((x) => x !== id)
      .slice(0, 150)
      .map((x) => {
        const w = ctx.values.get(x);
        if (!w) return { id: x, s: -99 };
        const fill = weak.reduce((a, c) => a + Math.max(0, w.cat[c]), 0);
        return { id: x, s: fill + 0.25 * w.total };
      })
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
  }, [ctx, p, id]);

  if (!ctx) return <Spinner />;
  if (!p) return <Panel><div className="text-sm">Player not found. <Link href="/players" className="text-accent">Back to players</Link></div></Panel>;
  const j = p.proj;
  const v = ctx.values.get(id);
  const risk = playerRisk(p);
  const po = j ? playoffTable(ctx, [id])[0] : null;
  const drafted = ctx.drafted.has(id);
  const draftedBy = ctx.draft.picks.find((x) => x.playerId === id);
  const surv = fast.result?.avail.survival.get(id);
  const chart = v ? ctx.cats.map((c) => ({ cat: CAT_BY_KEY[c].short, z: +v.cat[c].toFixed(2), color: CAT_BY_KEY[c].color })) : [];
  const cv = j && j.pts > 0 ? (j.sd.pts ?? 0) / j.pts : 0;
  const pct = (m: number, a: number) => (a > 0 ? `${((m / a) * 100).toFixed(1)}%` : "—");

  const runSim = async () => {
    if (!ds || !session) return;
    setSim({ running: true, done: 0, verdict: null });
    const k = `${key}|whatif|${id}`;
    await runChampionship({
      ds,
      state: { settings: session.settings, draft: session.state },
      key: k,
      candidates: [POLICY, id],
      sims: 400,
      isCurrent: () => true,
      onProgress: (chunks, done) => setSim({ running: true, done, verdict: summarise(mergeChunks(chunks), 200) }),
    });
    setSim((s) => (s ? { ...s, running: false } : s));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            {p.name} <StatusBadge p={p} />
          </h1>
          <div className="text-sm text-mute">
            {p.team} · NBA position {p.nbaPos} · fantasy eligibility {p.elig.join("/")} <span className="text-dim">({p.eligSource})</span>
            {p.age != null && ` · age ${p.age}`}
            {p.experience != null && ` · ${p.experience} yrs exp`}
            {p.nbaId && <span className="text-dim"> · NBA id {p.nbaId}</span>}
          </div>
          {p.teamChange && (
            <div className="mt-1 text-xs text-sky-300">
              {p.teamChange.type.replace(/_/g, " ")}: {p.teamChange.from} → {p.teamChange.to} ({p.teamChange.confidence} confidence,{" "}
              <a className="underline" href={p.teamChange.sourceUrl} target="_blank" rel="noreferrer">
                {p.teamChange.sourceName}
              </a>
              )
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            {p.tags.map((t) => (
              <Badge key={t.kind + t.label} tone={t.kind === "breakout" ? "good" : t.kind === "regression" || t.kind === "high_risk" ? "bad" : "neutral"} title={t.evidence.join("\n")}>
                {t.label} · {t.confidence}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {!drafted && j && (
            <>
              <Button onClick={() => setWhatIf(true)} data-testid="what-if">
                What happens if I draft this player?
              </Button>
              <Button variant="primary" onClick={() => void draft(id)}>
                Draft now
              </Button>
            </>
          )}
          {drafted && draftedBy && <Badge>Drafted #{draftedBy.overall} by {ctx.settings.teamNames[draftedBy.teamIndex]}</Badge>}
        </div>
      </div>

      {whatIf && (
        <Panel title="Hypothetical: you draft this player now (not saved)" className="border-accent2/40">
          {!hypo ? (
            <Spinner label="Evaluating…" />
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Stat label={`Δ ${fast.result!.rec.objectiveName}`} value={<Delta v={hypo.delta} />} sub={`${fast.result!.rec.baselineObj.toFixed(3)} → ${hypo.obj.toFixed(3)} (vs expected pick at this slot)`} />
                <Stat label="Matchup win probability" value={`${(hypo.ev.matchupWinProb * 100).toFixed(1)}%`} sub={`baseline ${(fast.result!.rec.field.baseline.matchupWinProb * 100).toFixed(1)}%`} />
                <div className="text-xs text-mute">Survival to your next pick if you wait: {surv != null ? `${(surv * 100).toFixed(0)}%` : "—"}</div>
              </div>
              <div>
                <div className="mb-1 text-[10px] text-dim uppercase">Category win-probability change</div>
                <CatImpact impact={hypo.impact} max={9} />
                <div className="mt-2 space-y-0.5">
                  {ctx.cats.map((c) => (
                    <div key={c} className="flex items-center justify-between text-xs">
                      <span className="w-10">{CAT_BY_KEY[c].short}</span>
                      <ProbBar p={hypo.ev.perCategory[c]} width={120} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-[10px] text-dim uppercase">Δ championship probability (400 paired sims)</div>
                {!sim ? (
                  <Button size="sm" onClick={() => void runSim()}>
                    Run championship simulation
                  </Button>
                ) : sim.verdict ? (
                  <div className="text-xs">
                    {sim.verdict.summaries.map((s) => (
                      <div key={s.id}>
                        P(title) {(s.pChamp * 100).toFixed(1)}% vs default {(((sim.verdict!.baseline?.pChamp ?? 0)) * 100).toFixed(1)}% → Δ <Delta v={s.deltaChamp} pct digits={1} /> ± {(s.deltaChampSe * 100).toFixed(1)} pts
                      </div>
                    ))}
                    {sim.running && <Spinner label={`${sim.done}/400`} />}
                  </div>
                ) : (
                  <Spinner label="Simulating…" />
                )}
                <Button size="sm" variant="ghost" onClick={() => { setWhatIf(false); setSim(null); }}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </Panel>
      )}

      {!j ? (
        <Panel title="Projection">
          <div className="text-sm text-mute">
            No projection is available for this player{p.rookie ? ` (2026 rookie, #${p.rookie.pick} pick — no NBA statistics exist)` : ""}. The platform does not invent one: import projections on the Data page to include him in rankings.
          </div>
        </Panel>
      ) : (
        <div className="grid gap-3 xl:grid-cols-3">
          <Panel title="2026-27 projection" right={<Badge tone={j.kind === "projection" ? "info" : "accent"}>{j.kind === "estimate" ? "MODEL ESTIMATE" : "IMPORTED PROJECTION"} · {j.source}</Badge>}>
            <div className="grid grid-cols-4 gap-3">
              <Stat label="GP" value={j.gp.toFixed(0)} sub={`± ${j.gpSd.toFixed(0)}`} />
              <Stat label="MIN" value={j.min.toFixed(1)} />
              <Stat label="Value rank" value={`#${v?.rank ?? "—"}`} sub={`total z ${v?.total.toFixed(2)}`} />
              <Stat label={p.adp != null ? "ADP" : "Market*"} value={p.adp != null ? p.adp.toFixed(1) : `#${ctx.marketRank.get(id)}`} sub={v ? `${((p.adp ?? ctx.marketRank.get(id) ?? 0) - v.rank > 0 ? "+" : "")}${Math.round((p.adp ?? ctx.marketRank.get(id) ?? 0) - v.rank)} vs value` : ""} />
            </div>
            <table className="mt-3 w-full text-xs">
              <thead className="text-[10px] text-dim uppercase">
                <tr>
                  <th className="text-left"></th>
                  {["PTS", "3PM", "REB", "AST", "STL", "BLK", "FG%", "FT%", "TO"].map((h) => (
                    <th key={h} className="text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="num">
                <tr>
                  <td className="text-mute">Per game</td>
                  {[j.pts, j.fg3m, j.reb, j.ast, j.stl, j.blk].map((x, i) => <td key={i} className="text-right">{x.toFixed(1)}</td>)}
                  <td className="text-right">{pct(j.fgm, j.fga)}</td>
                  <td className="text-right">{pct(j.ftm, j.fta)}</td>
                  <td className="text-right">{j.tov.toFixed(1)}</td>
                </tr>
                <tr>
                  <td className="text-mute">Season</td>
                  {[j.pts, j.fg3m, j.reb, j.ast, j.stl, j.blk].map((x, i) => <td key={i} className="text-right">{(x * j.gp).toFixed(0)}</td>)}
                  <td className="text-right text-dim">{(j.fgm * j.gp).toFixed(0)}/{(j.fga * j.gp).toFixed(0)}</td>
                  <td className="text-right text-dim">{(j.ftm * j.gp).toFixed(0)}/{(j.fta * j.gp).toFixed(0)}</td>
                  <td className="text-right">{(j.tov * j.gp).toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-2 text-xs text-mute">
              Shooting volume: {j.fga.toFixed(1)} FGA / {j.fta.toFixed(1)} FTA per game · Upside/downside (P90/P10 production): ±{(1.28 * cv * 100).toFixed(0)}% · Confidence {(j.confidence * 100).toFixed(0)}%
            </div>
            {j.flags.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-dim">
                {j.flags.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Category z-scores">
            <div className="h-48">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ left: -20, right: 4, top: 4, bottom: 0 }}>
                  <CartesianGrid stroke="#1f2a37" vertical={false} />
                  <XAxis dataKey="cat" tick={{ fill: "#8a97a8", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#8a97a8", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#141b24", border: "1px solid #1f2a37", fontSize: 12 }} />
                  <Bar dataKey="z">
                    {chart.map((d) => (
                      <Cell key={d.cat} fill={d.z >= 0 ? "#22c55e" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-[10px] text-dim uppercase">Rank when punting one category</div>
            <div className="mt-1 grid grid-cols-3 gap-1 text-xs">
              {punts.map((x) => (
                <span key={x.c} className="num">
                  −{CAT_BY_KEY[x.c as CategoryKey].short}: <span className={cn(x.rank < (v?.rank ?? 0) ? "text-good" : x.rank > (v?.rank ?? 0) ? "text-bad" : "")}>#{x.rank}</span>
                </span>
              ))}
            </div>
          </Panel>
          <Panel title="Risk & availability">
            {risk && (
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-mute">Availability (games history)</span><Badge tone={risk.availability === "high" ? "bad" : risk.availability === "medium" ? "warn" : "good"}>{risk.availability}</Badge></div>
                <div className="text-[11px] text-dim">{risk.availabilityEvidence}</div>
                <div className="flex justify-between"><span className="text-mute">Games-played uncertainty</span><span className="num">± {risk.gamesSd.toFixed(0)} GP</span></div>
                <div className="flex justify-between"><span className="text-mute">Projection uncertainty (CV)</span><Badge tone={risk.projection === "high" ? "bad" : risk.projection === "medium" ? "warn" : "good"}>{(risk.projectionCv * 100).toFixed(0)}%</Badge></div>
                <div className="flex justify-between"><span className="text-mute">Role uncertainty</span><Badge tone={risk.role === "high" ? "bad" : risk.role === "medium" ? "warn" : "good"}>{risk.role}</Badge></div>
                {risk.roleEvidence.map((e) => <div key={e} className="text-[11px] text-dim">• {e}</div>)}
                {p.availability && (
                  <div className="mt-2 rounded bg-panel2 p-2">
                    <div className="font-medium">{p.availability.status}: {p.availability.injury}</div>
                    <div className="text-mute">{p.availability.estimateBasis}</div>
                    <div className="text-[10px] text-dim">
                      {p.availability.sourceUrl ? <a className="underline" href={p.availability.sourceUrl} target="_blank" rel="noreferrer">{p.availability.sourceName}</a> : p.availability.sourceName} · {p.availability.reportedDate} · {p.availability.confidence} confidence
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-dim">No medical probabilities are invented; levels summarise observed games history, current reports and projection sample size.</div>
              </div>
            )}
          </Panel>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Historical performance (actual, per game)" className="xl:col-span-2" bodyClass="p-0">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-dim uppercase">
              <tr className="border-b border-line">
                {["Season", "Source", "GP", "MIN", "PTS", "3PM", "REB", "AST", "STL", "BLK", "FG%", "FGA", "FT%", "FTA", "TO"].map((h) => (
                  <th key={h} className="px-1.5 py-1 text-right first:text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="num">
              {p.hist.map((h) => (
                <tr key={h.season + h.source} className="border-b border-line/50">
                  <td className="px-1.5 py-1">{h.season}</td>
                  <td className="px-1.5 py-1 text-right text-dim">{h.source}</td>
                  <td className="px-1.5 py-1 text-right">{h.gp}</td>
                  {[h.min, h.pts, h.fg3m, h.reb, h.ast, h.stl, h.blk].map((x, i) => <td key={i} className="px-1.5 py-1 text-right">{x.toFixed(1)}</td>)}
                  <td className="px-1.5 py-1 text-right">{pct(h.fgm, h.fga)}</td>
                  <td className={cn("px-1.5 py-1 text-right", h.attemptsEstimated && "text-dim italic")} title={h.attemptsEstimated ? "Estimated from points and percentages" : ""}>{h.fga.toFixed(1)}</td>
                  <td className="px-1.5 py-1 text-right">{pct(h.ftm, h.fta)}</td>
                  <td className={cn("px-1.5 py-1 text-right", h.attemptsEstimated && "text-dim italic")}>{h.fta.toFixed(1)}</td>
                  <td className="px-1.5 py-1 text-right">{h.tov.toFixed(1)}</td>
                </tr>
              ))}
              {!p.hist.length && (
                <tr>
                  <td colSpan={15} className="px-2 py-3 text-center text-dim">No NBA history in the dataset.</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="px-2 py-1 text-[10px] text-dim">Italic attempts = estimated (source had percentages only). 2025-26 = official NBA Stats totals; earlier seasons from per-game aggregates.</div>
        </Panel>
        <div className="space-y-3">
          {po && (
            <Panel title="Fantasy playoff schedule">
              <div className="text-xs text-mute">
                Weeks {ctx.settings.playoffWeeks.join(", ")}: <span className="num text-ink">{po.playoffGames.map((g) => g.toFixed(ctx.schedule.source === "uniform" ? 1 : 0)).join(" / ")}</span> scheduled games · expected counted {po.expectedCounted.toFixed(1)} · back-to-backs {po.backToBacks}
                {ctx.schedule.source === "uniform" && <div className="mt-1 text-[10px] text-dim">No schedule imported — uniform estimate (cannot distinguish teams).</div>}
              </div>
            </Panel>
          )}
          <Panel title="Best complements (available)">
            <ul className="space-y-1 text-xs">
              {complements.map((c) => (
                <li key={c.id}>
                  <PlayerLink p={ctx.byId.get(c.id)!} compact />
                </li>
              ))}
            </ul>
            <div className="mt-1 text-[10px] text-dim">Strongest in this player&apos;s weak categories, weighted by overall value.</div>
          </Panel>
          <Panel title="News">
            {mode !== "server" ? (
              <div className="text-xs text-dim">News feed requires the database (server mode).</div>
            ) : news == null ? (
              <Spinner />
            ) : news.length === 0 ? (
              <div className="text-xs text-dim">No news items for this player.</div>
            ) : (
              <ul className="space-y-2 text-xs">
                {news.map((n) => (
                  <li key={n.id}>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={n.status === "confirmed" ? "good" : n.status === "rumor" ? "bad" : "info"}>{n.status}</Badge>
                      <span>{n.title}</span>
                    </div>
                    {n.body && <div className="text-mute">{n.body}</div>}
                    <div className="text-[10px] text-dim">
                      {n.sourceUrl ? <a className="underline" href={n.sourceUrl} target="_blank" rel="noreferrer">{n.sourceName}</a> : n.sourceName} · {new Date(n.publishedAt).toLocaleDateString()} · {n.confidence} confidence
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <div className="text-xs text-dim">
        <Link href="/players" className="hover:text-ink">← All players</Link> · <PlayerLink p={p} compact />
      </div>
    </div>
  );
}
