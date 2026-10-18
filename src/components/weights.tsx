"use client";
import { CAT_KEYS, CAT_BY_KEY, type CategoryWeights } from "@/lib/categories";
import { cn } from "./ui";

/** Category toggles with soft weights: click cycles 1 → 0.5 → 0 (punt) → 1. */
export function WeightsEditor({ weights, onChange, active }: { weights: CategoryWeights; onChange: (w: CategoryWeights) => void; active: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {CAT_KEYS.filter((k) => active.includes(k)).map((k) => {
        const w = weights[k];
        return (
          <button
            key={k}
            onClick={() => onChange({ ...weights, [k]: w === 1 ? 0.5 : w === 0.5 ? 0 : 1 })}
            className={cn("rounded border px-2 py-1 text-xs font-medium", w === 1 ? "border-line bg-panel2 text-ink" : w === 0 ? "border-red-900 bg-red-950/40 text-red-300 line-through" : "border-yellow-900 bg-yellow-950/40 text-yellow-300")}
            title={w === 1 ? "Full weight — click for soft punt" : w === 0.5 ? "Soft punt ×0.5 — click to punt" : "Punted — click to restore"}
            data-testid={`weight-${k}`}
          >
            {CAT_BY_KEY[k].short}
            {w === 0.5 ? " ×½" : ""}
          </button>
        );
      })}
    </div>
  );
}
