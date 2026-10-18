/**
 * Draft alerts. Each alert states its trigger; duplicates are suppressed and the
 * list is capped so alerts stay signal, not spam.
 */
import { CAT_BY_KEY } from "../categories";
import type { AnalysisContext } from "./context";
import type { RecommendationSet } from "./recommend";
import { playerRisk } from "./risk";
import { positionScarcity } from "./scarcity";

export type AlertSeverity = "info" | "warn" | "critical";

export interface DraftAlert {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  trigger: string;
  playerId?: string;
}

export function draftAlerts(ctx: AnalysisContext, rec: RecommendationSet | null, maxAlerts = 8): DraftAlert[] {
  const out: DraftAlert[] = [];
  const name = (id: string) => ctx.byId.get(id)?.name ?? id;
  const remainingPicks = ctx.totalPicks - ctx.overall + 1;
  if (remainingPicks <= 0) return out;

  // Falling value: available players whose value rank is far ahead of the current pick.
  for (const id of ctx.available.slice(0, 80)) {
    const v = ctx.values.get(id);
    if (!v) continue;
    const st = ctx.byId.get(id)?.availability?.status;
    if (st === "OUT_SEASON" || st === "OUT_EXTENDED") continue;
    if (v.rank <= ctx.overall - 15) {
      out.push({
        id: `fall-${id}`,
        kind: "falling",
        severity: "warn",
        title: `${name(id)} is falling`,
        detail: `Value rank #${v.rank}, still available at pick ${ctx.overall}.`,
        trigger: "value rank at least 15 spots ahead of the current pick",
        playerId: id,
      });
      break;
    }
  }

  // ADP outperformers (only with real ADP).
  if (ctx.marketSource !== "proxy") {
    const best = ctx.available
      .map((id) => ({ id, adp: ctx.byId.get(id)?.adp, v: ctx.values.get(id)?.rank }))
      .filter((x) => x.adp != null && x.v != null && x.adp > ctx.overall && x.adp - x.v! >= 25)
      .sort((a, b) => b.adp! - b.v! - (a.adp! - a.v!))[0];
    if (best)
      out.push({
        id: `adp-${best.id}`,
        kind: "adp_value",
        severity: "info",
        title: `${name(best.id)} outperforms ADP`,
        detail: `Value rank #${best.v} vs ADP ${best.adp!.toFixed(1)}.`,
        trigger: "projection rank ≥ 25 spots better than imported ADP",
        playerId: best.id,
      });
  }

  if (rec) {
    const myCats = rec.field.baseline.perCategory;
    // Category scarcity where I am weak.
    for (const s of rec.scarcity) {
      if (s.scarcityIndex >= 1.35 && (myCats[s.cat] ?? 0.5) < 0.5)
        out.push({
          id: `scarce-${s.cat}`,
          kind: "category_scarcity",
          severity: "warn",
          title: `${s.label} is drying up`,
          detail: `${(s.supplyShare * 100).toFixed(0)}% of draft-start supply remains; ${s.strongLeft} strong (z ≥ 1) contributors left${s.strongAtMyPick != null ? `, ~${s.strongAtMyPick.toFixed(1)} expected at your next pick` : ""}. Your projected win rate: ${((myCats[s.cat] ?? 0) * 100).toFixed(0)}%.`,
          trigger: "scarcity index ≥ 1.35 and your projected category win rate < 50%",
        });
    }
    // Roster imbalance (≥ 3 weak categories).
    const weak = ctx.cats.filter((c) => (myCats[c] ?? 0.5) < 0.3);
    if (weak.length >= 3 && ctx.rosters[ctx.myIndex].length >= 3)
      out.push({
        id: "imbalance",
        kind: "imbalance",
        severity: "critical",
        title: "Roster imbalance",
        detail: `Projected win rate below 30% in ${weak.map((c) => CAT_BY_KEY[c].short).join(", ")}. Three or more lost categories caps weekly upside unless this is a deliberate punt.`,
        trigger: "≥ 3 categories with projected win rate < 30%",
      });
    // Strong value unlikely to survive.
    const urgent = rec.candidates.slice(0, 5).find((c) => c.survival < 0.25 && rec.myTurn);
    if (urgent)
      out.push({
        id: `urgent-${urgent.id}`,
        kind: "urgency",
        severity: "warn",
        title: `${name(urgent.id)} won't last`,
        detail: `Only ${(urgent.survival * 100).toFixed(0)}% chance he survives to your next pick.`,
        trigger: "top-5 recommendation with survival < 25%",
        playerId: urgent.id,
      });
    // Poor fit despite high rank.
    const topValue = [...ctx.available].sort((a, b) => (ctx.values.get(a)?.rank ?? 1e9) - (ctx.values.get(b)?.rank ?? 1e9))[0];
    const fitIdx = rec.candidates.findIndex((c) => c.id === topValue);
    if (topValue && fitIdx >= 8)
      out.push({
        id: `poorfit-${topValue}`,
        kind: "poor_fit",
        severity: "info",
        title: `${name(topValue)}: high rank, poor fit`,
        detail: `Best available by league value but only #${fitIdx + 1} for your roster.`,
        trigger: "best available by value ranks ≥ 9th in roster-specific recommendations",
        playerId: topValue,
      });
  }

  // Positional scarcity (centers / guards running out).
  for (const ps of positionScarcity(ctx)) {
    const teamsNeeding = ctx.settings.teams;
    if (ps.aboveReplacement < Math.ceil(teamsNeeding / 2) && remainingPicks > ctx.settings.teams)
      out.push({
        id: `pos-${ps.pos}`,
        kind: "position_scarcity",
        severity: "info",
        title: `${ps.pos} pool thin`,
        detail: `Only ${ps.aboveReplacement} ${ps.pos}-eligible players above replacement remain (derived eligibility).`,
        trigger: "fewer above-replacement players than half the league",
      });
  }

  // Injury concentration on my roster.
  const mine = ctx.rosters[ctx.myIndex];
  const risky = mine.filter((id) => playerRisk(ctx.byId.get(id)!)?.overall === "high");
  if (mine.length >= 4 && risky.length / mine.length >= 0.4)
    out.push({
      id: "risk-concentration",
      kind: "risk",
      severity: "warn",
      title: "Injury-risk concentration",
      detail: `${risky.length} of ${mine.length} rostered players are high-risk (${risky.map(name).join(", ")}).`,
      trigger: "≥ 40% of my roster rated high overall risk",
    });

  // News for top available players.
  for (const id of ctx.available.slice(0, 60)) {
    const a = ctx.byId.get(id)?.availability;
    if (a && ["OUT_START", "OUT_EXTENDED", "OUT_SEASON"].includes(a.status)) {
      out.push({
        id: `news-${id}`,
        kind: "news",
        severity: "info",
        title: `${name(id)}: ${a.status.replace("_", " ").toLowerCase()}`,
        detail: `${a.injury ?? ""} — ${a.estimateBasis ?? ""} (${a.sourceName ?? "source"}, ${a.reportedDate ?? ""})`,
        trigger: "researched availability item for a top-60 available player",
        playerId: id,
      });
    }
  }

  const sevOrder = { critical: 0, warn: 1, info: 2 };
  const seen = new Set<string>();
  return out
    .filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity])
    .slice(0, maxAlerts);
}
