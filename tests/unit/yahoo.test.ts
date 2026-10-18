import { describe, expect, it } from "vitest";
import { findFirst, parseDraftResults, parsePlayerNames } from "@/lib/yahoo";

// Shapes follow Yahoo Fantasy API JSON (mixed arrays / numbered-key objects).
const draft = {
  fantasy_content: {
    league: [
      { league_key: "466.l.254849", name: "BİLLUR CUP" },
      {
        draft_results: {
          "0": { draft_result: { pick: 2, round: 1, team_key: "466.l.254849.t.2", player_key: "466.p.6014" } },
          "1": { draft_result: { pick: 1, round: 1, team_key: "466.l.254849.t.1", player_key: "466.p.5352" } },
          "2": { draft_result: { pick: 3, round: 1, team_key: "466.l.254849.t.3" } },
          count: 3,
        },
      },
    ],
  },
};
const players = {
  fantasy_content: {
    league: [
      {},
      {
        players: {
          "0": { player: [[{ player_key: "466.p.5352" }, { player_id: "5352" }, { name: { full: "Nikola Jokić", first: "Nikola" } }], {}] },
          "1": { player: [[{ player_key: "466.p.6014" }, { name: { full: "Victor Wembanyama" } }]] },
          count: 2,
        },
      },
    ],
  },
};

describe("Yahoo parsing", () => {
  it("parses draft results in pick order, including unmade picks", () => {
    const p = parseDraftResults(draft);
    expect(p.map((x) => x.pick)).toEqual([1, 2, 3]);
    expect(p[0].playerKey).toBe("466.p.5352");
    expect(p[2].playerKey).toBeNull();
  });
  it("maps player keys to names", () => {
    const m = parsePlayerNames(players);
    expect(m.get("466.p.5352")).toBe("Nikola Jokić");
    expect(m.get("466.p.6014")).toBe("Victor Wembanyama");
  });
  it("finds the game key", () => {
    expect(findFirst({ fantasy_content: { game: [{ game_key: "466", code: "nba" }] } }, "game_key")).toBe("466");
  });
});
