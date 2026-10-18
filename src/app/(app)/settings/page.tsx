"use client";
import { useEffect, useState } from "react";
import { CAT_BY_KEY, CAT_KEYS } from "@/lib/categories";
import { FORMAT_LABEL, LEAGUE_PRESETS, LeagueSettingsSchema, normaliseSettings, type LeagueSettings, type SlotCounts } from "@/lib/league";
import { TOTAL_WEEKS, weekRange } from "@/lib/engine/schedule";
import { DraftStateSchema } from "@/server/drafts.schema";
import { useActiveSession, useStore } from "@/client/store";
import { downloadText } from "@/client/csv";
import { Badge, Button, Field, inputCls, Panel } from "@/components/ui";

export default function SettingsPage() {
  const session = useActiveSession();
  const sessions = useStore((s) => s.sessions);
  const select = useStore((s) => s.selectSession);
  const create = useStore((s) => s.createSession);
  const del = useStore((s) => s.deleteSession);
  const update = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const mode = useStore((s) => s.mode);
  const [form, setForm] = useState<LeagueSettings | null>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (session) {
      setForm(session.settings);
      setName(session.name);
    }
  }, [session]);
  if (!session || !form) return null;
  const hasPicks = session.state.picks.length > 0;
  const set = <K extends keyof LeagueSettings>(k: K, v: LeagueSettings[K]) => setForm(normaliseSettings({ ...form, [k]: v }));
  const num = (v: string) => Math.max(0, Number(v) || 0);
  const save = async () => {
    const parsed = LeagueSettingsSchema.safeParse(normaliseSettings(form));
    if (!parsed.success) return toast("error", parsed.error.issues.map((i) => i.message).join("; "));
    if (await update(parsed.data, name)) toast("success", "League settings saved");
  };
  const exportDraft = () =>
    downloadText(`draft-${session.name.replace(/\W+/g, "-")}.json`, JSON.stringify({ format: "warroom-draft-v1", exportedAt: new Date().toISOString(), session }, null, 2), "application/json");
  const importDraft = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== "warroom-draft-v1") throw new Error("Not a War Room draft export");
      const settings = LeagueSettingsSchema.parse(data.session.settings);
      const state = DraftStateSchema.parse(data.session.state);
      await create(`${data.session.name} (restored)`, settings, state);
      toast("success", "Draft restored");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Import failed");
    }
  };
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold tracking-tight">League & Draft Sessions</h1>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="League settings" className="xl:col-span-2" right={hasPicks ? <Badge tone="warn">Draft in progress — team count / rounds locked by existing picks</Badge> : null}>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Field label="Apply preset">
              <select className={inputCls} onChange={(e) => { const p = LEAGUE_PRESETS.find((x) => x.key === e.target.value); if (p) { setForm(p.settings); setName(p.settings.name); } }} defaultValue="">
                <option value="" disabled>Choose…</option>
                {LEAGUE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Draft name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Teams"><input type="number" min={2} max={20} className={inputCls} value={form.teams} disabled={hasPicks} onChange={(e) => set("teams", Math.max(2, Math.min(20, num(e.target.value))))} /></Field>
            <Field label="My draft position"><input type="number" min={1} max={form.teams} className={inputCls} value={form.myPosition} onChange={(e) => set("myPosition", Math.max(1, Math.min(form.teams, num(e.target.value))))} /></Field>
            <Field label="Rounds"><input type="number" min={1} max={30} className={inputCls} value={form.rounds} disabled={hasPicks} onChange={(e) => set("rounds", Math.max(1, num(e.target.value)))} /></Field>
            <Field label="Draft type">
              <select className={inputCls} value={form.draftType} disabled={hasPicks} onChange={(e) => set("draftType", e.target.value as LeagueSettings["draftType"])}>
                <option value="snake">Snake</option>
                <option value="linear">Linear</option>
              </select>
            </Field>
            <Field label="Scoring format">
              <select className={inputCls} value={form.format} onChange={(e) => set("format", e.target.value as LeagueSettings["format"])}>
                {Object.entries(FORMAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Lineup changes">
              <select className={inputCls} value={form.lineupMode} onChange={(e) => set("lineupMode", e.target.value as LeagueSettings["lineupMode"])}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </Field>
            <Field label="Bench utilisation" hint="Share of bench games that reach a lineup (daily)"><input type="number" step={0.05} min={0} max={1} className={inputCls} value={form.benchUtilization} onChange={(e) => set("benchUtilization", Math.min(1, Number(e.target.value)))} /></Field>
            <Field label="Weekly games cap" hint="Blank = none"><input type="number" className={inputCls} value={form.weeklyGamesCap ?? ""} onChange={(e) => set("weeklyGamesCap", e.target.value ? num(e.target.value) : null)} /></Field>
            <Field label="Regular-season weeks"><input type="number" min={1} max={26} className={inputCls} value={form.regularSeasonWeeks} onChange={(e) => set("regularSeasonWeeks", Math.max(1, num(e.target.value)))} /></Field>
            <Field label="Playoff teams"><input type="number" min={0} max={16} className={inputCls} value={form.playoffTeams} onChange={(e) => set("playoffTeams", num(e.target.value))} /></Field>
            <Field label="Playoff weeks" hint={`Weeks 1–${TOTAL_WEEKS}; e.g. 23,24,25`}>
              <input className={inputCls} defaultValue={form.playoffWeeks.join(",")} onBlur={(e) => set("playoffWeeks", e.target.value.split(/[ ,]+/).map(Number).filter((x) => x >= 1 && x <= TOTAL_WEEKS))} />
            </Field>
            <Field label="Valuation">
              <select className={inputCls} value={`${form.valuationBasis}|${form.valuationMethod}`} onChange={(e) => { const [b, m] = e.target.value.split("|"); setForm({ ...form, valuationBasis: b as "perGame", valuationMethod: m as "z" }); }}>
                <option value="perGame|z">Per-game Z-score</option>
                <option value="perGame|g">Per-game G-score (H2H variance-aware)</option>
                <option value="season|z">Season-total Z-score</option>
                <option value="season|g">Season-total G-score</option>
              </select>
            </Field>
            <Field label="Risk aversion λ" hint="0 = neutral, 1 = very risk-averse"><input type="number" step={0.05} min={0} max={1} className={inputCls} value={form.riskAversion} onChange={(e) => set("riskAversion", Math.min(1, Number(e.target.value)))} /></Field>
            <Field label="ADP spread σ = a + b·ADP" hint="Opponent randomness">
              <div className="flex gap-1">
                <input type="number" step={0.5} className={inputCls + " w-16"} value={form.adpSigmaBase} onChange={(e) => set("adpSigmaBase", Number(e.target.value))} />
                <input type="number" step={0.02} className={inputCls + " w-20"} value={form.adpSigmaSlope} onChange={(e) => set("adpSigmaSlope", Number(e.target.value))} />
              </div>
            </Field>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-xs text-mute">Roster slots</div>
            <div className="grid grid-cols-5 gap-2 md:grid-cols-10">
              {(Object.keys(form.slots) as (keyof SlotCounts)[]).map((k) => (
                <Field key={k} label={k}><input type="number" min={0} className={inputCls} value={form.slots[k]} onChange={(e) => set("slots", { ...form.slots, [k]: num(e.target.value) })} /></Field>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-xs text-mute">Scoring categories</div>
            <div className="flex flex-wrap gap-2">
              {CAT_KEYS.map((c) => (
                <label key={c} className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={form.categories.includes(c)} onChange={(e) => set("categories", e.target.checked ? CAT_KEYS.filter((k) => form.categories.includes(k) || k === c) : form.categories.filter((k) => k !== c))} />
                  {CAT_BY_KEY[c].short}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-xs text-mute">Team names (draft order)</div>
            <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
              {form.teamNames.map((n, i) => (
                <input key={i} className={inputCls + (i + 1 === form.myPosition ? " border-accent" : "")} value={n} onChange={(e) => set("teamNames", form.teamNames.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" onClick={() => void save()} data-testid="save-settings">Save settings</Button>
            <span className="text-[11px] text-dim">Playoff weeks {form.playoffWeeks.map((w) => `${w} (${weekRange(w).start}→${weekRange(w).end})`).join(", ")}</span>
          </div>
        </Panel>
        <div className="space-y-3">
          <Panel title={`Draft sessions (${mode === "server" ? "database" : "this browser"})`}>
            <ul className="space-y-1 text-xs">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <button onClick={() => select(s.id)} className={s.id === session.id ? "font-semibold text-accent" : "text-ink hover:text-accent"}>
                    {s.name} <span className="text-dim">· {s.state.picks.length} picks{s.local ? " · local" : ""}</span>
                  </button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete draft "${s.name}"?`)) void del(s.id); }}>✕</Button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              {LEAGUE_PRESETS.map((p) => (
                <Button key={p.key} size="sm" onClick={() => void create(p.settings.name, p.settings)}>+ New: {p.label}</Button>
              ))}
            </div>
          </Panel>
          <Panel title="Backup & restore">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={exportDraft}>Export current draft (JSON)</Button>
              <label className="inline-flex h-7 cursor-pointer items-center rounded-md border border-line bg-panel2 px-2 text-xs">
                Import draft JSON
                <input type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && void importDraft(e.target.files[0])} />
              </label>
              <Button size="sm" variant="danger" onClick={() => { if (confirm("Reset all picks in this draft? (Undo is not possible after reset)")) void useStore.getState().dispatch({ type: "reset" }); }}>Reset picks</Button>
            </div>
            <div className="mt-2 text-[11px] text-dim">Every pick is also mirrored to this browser&apos;s storage for crash recovery.</div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
