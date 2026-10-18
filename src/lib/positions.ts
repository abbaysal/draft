import type { LineupSlot, SlotPos } from "./types";

/**
 * NBA.com lists only G / F / C (and hyphenated combos). Fantasy platforms use
 * PG/SG/SF/PF/C. Without platform eligibility data we DERIVE eligibility with
 * the mapping below and label it as derived in the UI. Users can import exact
 * platform eligibility through the player-metadata CSV.
 */
const MAP: Record<string, SlotPos[]> = {
  G: ["PG", "SG"],
  F: ["SF", "PF"],
  C: ["C"],
  "G-F": ["SG", "SF"],
  "F-G": ["SF", "SG"],
  "F-C": ["PF", "C"],
  "C-F": ["C", "PF"],
  PG: ["PG"],
  SG: ["SG"],
  SF: ["SF"],
  PF: ["PF"],
};

export function deriveEligibility(nbaPos: string): SlotPos[] {
  const key = nbaPos.trim().toUpperCase();
  if (MAP[key]) return MAP[key];
  const parts = key.split(/[-/,\s]+/).filter(Boolean);
  const out = new Set<SlotPos>();
  for (const p of parts) for (const s of MAP[p] ?? []) out.add(s);
  return out.size ? [...out] : ["SF", "PF"];
}

export function slotAccepts(slot: LineupSlot, elig: SlotPos[]): boolean {
  switch (slot) {
    case "G":
      return elig.includes("PG") || elig.includes("SG");
    case "F":
      return elig.includes("SF") || elig.includes("PF");
    case "UTIL":
    case "BN":
    case "IL":
      return true;
    default:
      return elig.includes(slot);
  }
}

/**
 * Maximum bipartite matching of players to starting slots (Kuhn's algorithm).
 * Returns the assignment (slot index -> player index) and number of slots filled.
 */
export function matchLineup(slots: LineupSlot[], eligs: SlotPos[][]): { filled: number; assignment: number[] } {
  const slotOf = new Array<number>(eligs.length).fill(-1);
  const playerOf = new Array<number>(slots.length).fill(-1);
  const tryAssign = (p: number, seen: boolean[]): boolean => {
    for (let s = 0; s < slots.length; s++) {
      if (seen[s] || !slotAccepts(slots[s], eligs[p])) continue;
      seen[s] = true;
      if (playerOf[s] === -1 || tryAssign(playerOf[s], seen)) {
        playerOf[s] = p;
        slotOf[p] = s;
        return true;
      }
    }
    return false;
  };
  let filled = 0;
  for (let p = 0; p < eligs.length; p++) if (tryAssign(p, new Array(slots.length).fill(false))) filled++;
  return { filled, assignment: playerOf };
}

/** Which unfilled starting slots remain given current roster eligibilities. */
export function openSlots(slots: LineupSlot[], eligs: SlotPos[][]): LineupSlot[] {
  const { assignment } = matchLineup(slots, eligs);
  return slots.filter((_, i) => assignment[i] === -1);
}
