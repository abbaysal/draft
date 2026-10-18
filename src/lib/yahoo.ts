/**
 * Yahoo Fantasy draft-results parsing. Yahoo's JSON nests resources in mixed
 * arrays/objects ({"0": {...}, "count": n}), so we search recursively instead of
 * relying on fixed paths.
 */
export interface YahooPick {
  pick: number;
  round: number;
  teamKey: string;
  playerKey: string | null;
}

function walk(node: unknown, visit: (obj: Record<string, unknown>) => void) {
  if (Array.isArray(node)) for (const x of node) walk(x, visit);
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    for (const v of Object.values(node)) walk(v, visit);
  }
}

export function parseDraftResults(json: unknown): YahooPick[] {
  const out: YahooPick[] = [];
  walk(json, (o) => {
    const r = o.draft_result as Record<string, unknown> | undefined;
    if (r && typeof r === "object" && r.pick != null) {
      out.push({
        pick: Number(r.pick),
        round: Number(r.round),
        teamKey: String(r.team_key ?? ""),
        playerKey: r.player_key ? String(r.player_key) : null,
      });
    }
  });
  const seen = new Set<number>();
  return out.filter((p) => (seen.has(p.pick) ? false : (seen.add(p.pick), true))).sort((a, b) => a.pick - b.pick);
}

/** Collect player_key → full name pairs from a players collection response. */
export function parsePlayerNames(json: unknown): Map<string, string> {
  const map = new Map<string, string>();
  walk(json, (o) => {
    const p = o.player;
    if (!Array.isArray(p)) return;
    let key: string | null = null;
    let name: string | null = null;
    walk(p[0], (q) => {
      if (typeof q.player_key === "string") key = q.player_key;
      const n = q.name as Record<string, unknown> | undefined;
      if (n && typeof n.full === "string") name = n.full;
    });
    if (key && name) map.set(key, name);
  });
  return map;
}

export function findFirst(json: unknown, field: string): string | null {
  let found: string | null = null;
  walk(json, (o) => {
    if (found == null && (typeof o[field] === "string" || typeof o[field] === "number")) found = String(o[field]);
  });
  return found;
}
