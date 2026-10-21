"use client";
import { useState } from "react";
import type { CoachAdvice } from "@/lib/coach";
import type { AnalysisContext } from "@/lib/engine/context";
import type { LineupOverrides, PlanOptions, WeekPlan } from "@/lib/engine/lineup";
import { nameKey } from "@/lib/names";
import { buildCoachFacts } from "@/client/coach-facts";
import type { MatchupSync } from "@/client/matchup-sync";
import { Badge, Button, cn, Panel, Spinner } from "@/components/ui";

const STANCE: Record<string, "good" | "warn" | "bad" | "neutral" | "accent"> = { push: "accent", protect: "good", concede: "bad", locked: "neutral" };

/** AI lineup coach: reviews the engine plan with Claude; suggested changes can be applied and re-scored. */
export function CoachPanel({ ctx, plan, opts, sync, today, onApply }: { ctx: AnalysisContext; plan: WeekPlan; opts: PlanOptions; sync: MatchupSync | null; today: string; onApply: (o: LineupOverrides) => void }) {
  const [lang, setLang] = useState<"en" | "tr">(() => (typeof navigator !== "undefined" && navigator.language.startsWith("tr") ? "tr" : "en"));
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<{ loading: boolean; advice?: CoachAdvice; error?: string; model?: string }>({ loading: false });

  const ask = async () => {
    setState({ loading: true });
    try {
      const facts = buildCoachFacts(ctx, plan, opts, sync, today);
      const r = await fetch("/api/lineup-coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facts, language: lang, question: question || undefined }) });
      const d = (await r.json()) as { advice?: CoachAdvice; error?: string; model?: string };
      setState({ loading: false, advice: d.advice, error: d.advice ? undefined : (d.error ?? `HTTP ${r.status}`), model: d.model });
    } catch (e) {
      setState({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const idOf = (n: string) => {
    const k = nameKey(n);
    return plan.lineup.find((l) => nameKey(ctx.byId.get(l.id)?.name ?? "") === k)?.id ?? null;
  };
  const applyChanges = () => {
    const a = state.advice;
    if (!a) return;
    const o: LineupOverrides = {};
    for (const c of a.changes) {
      const id = idOf(c.player);
      if (!id || !plan.daily.some((d) => d.date === c.date)) continue;
      (o[c.date] ??= {})[id] = c.action;
    }
    onApply(o);
  };
  const a = state.advice;
  const applicable = a ? a.changes.filter((c) => idOf(c.player) && plan.daily.some((d) => d.date === c.date)).length : 0;

  return (
    <Panel
      title="AI lineup coach"
      right={
        <div className="flex items-center gap-2">
          <select value={lang} onChange={(e) => setLang(e.target.value as "en" | "tr")} className="h-7 rounded border border-line bg-panel2 px-1 text-xs" aria-label="Language">
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
          <Button size="sm" variant="primary" onClick={ask} disabled={state.loading} data-testid="ask-coach">{state.loading ? "Thinking…" : a ? "Ask again" : "Ask the AI coach"}</Button>
        </div>
      }
    >
      <div className="space-y-2 text-xs" data-testid="coach-panel">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Optional question, e.g. “Should I stream a center for blocks?”" className="h-8 w-full rounded-md border border-line bg-bg px-2" />
        {state.loading && <Spinner label="Claude is reviewing the plan, the NBA schedule and the matchup…" />}
        {state.error && <div className="text-bad">{state.error}</div>}
        {!a && !state.loading && !state.error && <div className="text-mute">The engine already builds the best lineup for every day from the NBA schedule. The AI coach reviews it like a human expert: injury flags, rest risk on back-to-backs, late tip-offs, and which categories to push, protect or concede. Any start/sit change it suggests can be applied below and is re-scored by the engine.</div>}
        {a && (
          <div className="space-y-3">
            <div className="rounded-md border border-accent/40 bg-accent/10 p-2 text-sm font-semibold">{a.headline}</div>
            <div>
              <div className="mb-1 text-[10px] tracking-wider text-dim uppercase">Today · {a.today.date}</div>
              <div className="flex flex-wrap gap-1">
                {a.today.start.map((s) => <span key={s.player} className="rounded bg-panel2 px-1.5 py-0.5" title={s.note}><b className="text-accent">{s.slot}</b> {s.player}</span>)}
              </div>
              {a.today.bench.length > 0 && <div className="mt-1 text-mute">Bench: {a.today.bench.map((b) => `${b.player} (${b.reason})`).join(" · ")}</div>}
            </div>
            {a.changes.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between text-[10px] tracking-wider text-dim uppercase">
                  <span>Suggested changes to the engine plan</span>
                  <Button size="sm" variant="ghost" onClick={applyChanges} disabled={!applicable} data-testid="apply-coach">Apply {applicable} &amp; compare</Button>
                </div>
                {a.changes.map((c, i) => (
                  <div key={i} className="flex gap-2"><Badge tone={c.action === "start" ? "good" : "warn"}>{c.action.toUpperCase()}</Badge><span className="num text-dim">{c.date.slice(5)}</span><b>{c.player}</b><span className="text-mute">{c.reason}</span></div>
                ))}
              </div>
            )}
            <div>
              <div className="mb-1 text-[10px] tracking-wider text-dim uppercase">Category plan</div>
              <div className="grid gap-1 md:grid-cols-2">
                {a.categoryPlan.map((c) => (
                  <div key={c.cat} className="flex gap-2"><span className="w-10 font-semibold">{c.cat}</span><Badge tone={STANCE[c.stance]}>{c.stance}</Badge><span className="text-mute">{c.reason}</span></div>
                ))}
              </div>
            </div>
            {a.streaming.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] tracking-wider text-dim uppercase">Streaming</div>
                {a.streaming.map((s, i) => <div key={i}><span className="text-good">+ {s.add}</span> <span className="text-bad">− {s.drop}</span> <span className="text-mute">{s.reason}</span></div>)}
              </div>
            )}
            {a.risks.length > 0 && <div className="text-warn">Risks: {a.risks.join(" · ")}</div>}
            <div className={cn("text-mute")}>{a.summary}</div>
            <div className="text-[10px] text-dim">AI review by {state.model ?? "Claude"} of the engine&apos;s numbers — it can be wrong; the engine plan and probabilities above are the reference.</div>
          </div>
        )}
      </div>
    </Panel>
  );
}
