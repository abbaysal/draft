import type { Player, Projection, StatLine } from "@/lib/types";
import { deriveEligibility } from "@/lib/positions";

let n = 0;
export function mkPlayer(line: Partial<StatLine> & { gp?: number; pos?: string; name?: string; team?: string; id?: string }): Player {
  n++;
  const base: StatLine = { min: 30, pts: 15, fg3m: 1.5, reb: 5, ast: 3, stl: 1, blk: 0.5, tov: 1.8, fgm: 6, fga: 13, ftm: 2, fta: 2.5 };
  const l = { ...base, ...line };
  const proj: Projection = {
    ...l,
    gp: line.gp ?? 70,
    sd: { pts: l.pts * 0.1, reb: l.reb * 0.1, ast: l.ast * 0.1, stl: l.stl * 0.1, blk: l.blk * 0.1, tov: l.tov * 0.1, fg3m: l.fg3m * 0.1, fgm: 0.2, ftm: 0.1, fga: 1, fta: 0.3 },
    gpSd: 8,
    confidence: 0.7,
    source: "test",
    version: "t",
    kind: "estimate",
    flags: [],
  };
  const pos = line.pos ?? "G";
  return {
    id: line.id ?? `p${n}`,
    name: line.name ?? `Player ${n}`,
    team: line.team ?? "AAA",
    nbaPos: pos,
    elig: deriveEligibility(pos),
    eligSource: "derived",
    proj,
    hist: [],
    tags: [],
    adp: null,
    adpSource: null,
  };
}

/** A deterministic synthetic league pool with varied profiles. */
export function syntheticPool(size = 220): Player[] {
  const out: Player[] = [];
  for (let i = 0; i < size; i++) {
    const t = (i * 37) % 101 / 100; // pseudo-random in [0,1)
    const u = (i * 53) % 97 / 97;
    const scale = 1.4 - i / size; // better players first
    const fga = 8 + 10 * scale * t;
    const fta = 1.5 + 5 * scale * u;
    out.push(
      mkPlayer({
        id: `s${i}`,
        name: `Synthetic ${i}`,
        team: ["AAA", "BBB", "CCC", "DDD"][i % 4],
        pos: ["G", "F", "C", "G-F", "F-C"][i % 5],
        pts: 8 + 16 * scale * (0.5 + t / 2),
        fg3m: 0.3 + 2.5 * scale * u,
        reb: 3 + 7 * scale * (1 - u),
        ast: 1 + 6 * scale * t,
        stl: 0.5 + 1 * scale * u,
        blk: 0.2 + 1.5 * scale * (1 - t),
        tov: 1 + 2 * scale * t,
        fga,
        fgm: fga * (0.42 + 0.12 * (1 - u)),
        fta,
        ftm: fta * (0.65 + 0.25 * u),
        gp: 55 + 25 * u,
      }),
    );
  }
  return out;
}
