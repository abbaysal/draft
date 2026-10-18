/**
 * Evidence-based player classification. Every tag carries the evidence that
 * triggered it and a confidence level; thresholds are listed in METHODOLOGY.md §9.
 */
import { CAT_BY_KEY, CAT_KEYS } from "../categories";
import type { HistSeason, Player, PlayerTag } from "../types";
import type { PlayerValue } from "./valuation";

const fmt = (x: number, d = 1) => x.toFixed(d);

function season(p: Player, s: string): HistSeason | undefined {
  return p.hist.find((h) => h.season === s);
}

export interface TagContext {
  /** Per-game values for every projected player. */
  values: Map<string, PlayerValue>;
  /** Teams that lost high-usage players in the offseason: team -> list of names. */
  departures: Record<string, { name: string; fga: number }[]>;
}

export function classifyPlayer(p: Player, ctx: TagContext): PlayerTag[] {
  const tags: PlayerTag[] = [];
  const v = ctx.values.get(p.id);
  const cur = season(p, "2025-26");
  const prev = season(p, "2024-25");

  if (!p.proj) {
    if (p.rookie)
      tags.push({
        kind: "rookie_no_projection",
        label: "Rookie – no projection",
        confidence: "high",
        evidence: [`#${p.rookie.pick} pick (2026 draft, ${p.rookie.college}); no NBA statistics exist. Import a projection to rank him.`],
      });
    return tags;
  }

  if (p.teamChange)
    tags.push({
      kind: "new_team",
      label: `New team (${p.teamChange.to})`,
      confidence: p.teamChange.confidence,
      evidence: [`${p.teamChange.type.replace(/_/g, " ")} ${p.teamChange.from} → ${p.teamChange.to} (${p.teamChange.sourceName})`],
    });

  if (p.availability && ["RETURNING", "OUT_START", "OUT_EXTENDED", "OUT_SEASON"].includes(p.availability.status))
    tags.push({
      kind: "returning_injury",
      label: p.availability.status === "RETURNING" ? "Returning from injury" : "Injured",
      confidence: p.availability.confidence,
      evidence: [`${p.availability.injury ?? "Injury"} — ${p.availability.estimateBasis ?? ""} (${p.availability.sourceName ?? "source"})`],
    });

  if (v) {
    if (v.rank <= 15 && p.proj.confidence >= 0.5)
      tags.push({
        kind: "elite_anchor",
        label: "Elite anchor",
        confidence: "medium",
        evidence: [`Per-game 9-cat value rank #${v.rank} (total z ${fmt(v.total, 2)})`],
      });
    const positives = CAT_KEYS.filter((c) => v.cat[c] >= 0).length;
    if (positives >= 7 && v.rank <= 100)
      tags.push({
        kind: "balanced",
        label: "Balanced contributor",
        confidence: "medium",
        evidence: [`Above-average in ${positives} of 9 categories`],
      });
    // Turnovers are excluded: a low-TO "specialist" is usually just a low-usage player.
    const specCats = CAT_KEYS.filter((c) => c !== "tov");
    const best = specCats.reduce((a, c) => (v.cat[c] > v.cat[a] ? c : a), specCats[0]);
    const negatives = CAT_KEYS.filter((c) => v.cat[c] < -0.5).length;
    if (v.cat[best] >= 2 && (v.rank > 50 || negatives >= 3))
      tags.push({
        kind: "specialist",
        label: `${CAT_BY_KEY[best].short} specialist`,
        confidence: "medium",
        evidence: [`${CAT_BY_KEY[best].short} z = ${fmt(v.cat[best], 2)} with ${negatives} categories below −0.5`],
      });
  }

  // Breakout: young + rising minutes or production, or vacated usage on the team.
  if (p.age != null && p.age <= 25 && cur && p.proj.min >= 15 && p.availability?.status !== "OUT_SEASON") {
    const ev: string[] = [];
    if (prev && cur.min - prev.min >= 4) ev.push(`Minutes up ${fmt(prev.min)} → ${fmt(cur.min)} MPG (2024-25 → 2025-26)`);
    if (prev && prev.min > 10 && cur.min > 10) {
      const per36 = (h: HistSeason) => ((h.pts + h.reb + h.ast) / h.min) * 36;
      if (per36(cur) - per36(prev) >= 3) ev.push(`PTS+REB+AST per 36 up ${fmt(per36(prev))} → ${fmt(per36(cur))}`);
    }
    const lost = (ctx.departures[p.team] ?? []).filter((d) => d.fga >= 12 && d.name !== p.name);
    if (lost.length) ev.push(`Team lost usage: ${lost.map((d) => `${d.name} (${fmt(d.fga)} FGA)`).join(", ")}`);
    if (ev.length)
      tags.push({ kind: "breakout", label: "Breakout candidate", confidence: ev.length >= 2 ? "medium" : "low", evidence: ev });
  }

  // Regression: shooting spike vs prior seasons on meaningful volume, or advanced age.
  if (cur) {
    const prior = p.hist.filter((h) => h.season !== "2025-26" && h.gp >= 20);
    const ev: string[] = [];
    if (prior.length && cur.fga >= 8) {
      const pm = prior.reduce((a, h) => a + h.fgm * h.gp, 0);
      const pa = prior.reduce((a, h) => a + h.fga * h.gp, 0);
      if (pa > 0 && cur.fgm / cur.fga - pm / pa >= 0.04)
        ev.push(`FG% ${fmt((cur.fgm / cur.fga) * 100)}% in 2025-26 vs ${fmt((pm / pa) * 100)}% prior`);
    }
    if (prior.length && cur.fta >= 3) {
      const pm = prior.reduce((a, h) => a + h.ftm * h.gp, 0);
      const pa = prior.reduce((a, h) => a + h.fta * h.gp, 0);
      if (pa > 0 && cur.ftm / cur.fta - pm / pa >= 0.06)
        ev.push(`FT% ${fmt((cur.ftm / cur.fta) * 100)}% in 2025-26 vs ${fmt((pm / pa) * 100)}% prior`);
    }
    if (p.age != null && p.age >= 33) ev.push(`Age ${p.age} at season start`);
    if (ev.length)
      tags.push({ kind: "regression", label: "Regression risk", confidence: ev.length >= 2 ? "medium" : "low", evidence: ev });
  }

  // Bounce-back: injury-shortened 2025-26 with a clear per-game drop from 2024-25.
  if (cur && prev && cur.gp < 50 && prev.gp >= 50 && prev.pts - cur.pts >= 3)
    tags.push({
      kind: "bounce_back",
      label: "Bounce-back candidate",
      confidence: "low",
      evidence: [`${cur.gp} GP in 2025-26 with ${fmt(cur.pts)} PPG vs ${fmt(prev.pts)} PPG in ${prev.gp} GP (2024-25)`],
    });

  const gpHist = p.hist.filter((h) => h.season !== "2025-26" || h.gp > 0);
  const avgGp = gpHist.length ? gpHist.reduce((a, h) => a + h.gp, 0) / gpHist.length : 0;
  const riskEv: string[] = [];
  if (p.proj.confidence < 0.45) riskEv.push(`Projection confidence ${fmt(p.proj.confidence * 100, 0)}%`);
  if (avgGp < 55 && gpHist.length >= 2) riskEv.push(`Averaged ${fmt(avgGp, 0)} GP over ${gpHist.length} seasons`);
  if (p.availability && !["HEALTHY", "DAY_TO_DAY"].includes(p.availability.status)) riskEv.push(`Status: ${p.availability.status}`);
  if (riskEv.length) tags.push({ kind: "high_risk", label: "High risk", confidence: "medium", evidence: riskEv });
  else if (p.proj.confidence >= 0.7 && avgGp >= 68 && !p.teamChange)
    tags.push({
      kind: "stable",
      label: "Stable contributor",
      confidence: "medium",
      evidence: [`Avg ${fmt(avgGp, 0)} GP, projection confidence ${fmt(p.proj.confidence * 100, 0)}%, same team`],
    });

  return tags;
}
