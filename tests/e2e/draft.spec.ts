import { expect, test, type Page } from "@playwright/test";

const status = async (page: Page) => (await page.getByTestId("draft-status").innerText()).replace(/\s+/g, " ");

test("complete live-draft workflow: recommend, draft, persist, undo/redo, correct", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Start from a fresh draft (works in local and database mode).
  await page.goto("/settings");
  await page.getByRole("button", { name: /New: BİLLUR CUP/ }).click();
  await page.goto("/");
  await expect(page.getByTestId("draft-top")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("metric-banner")).toContainText("Optimization metric in use");
  const start = await status(page);
  expect(start).toContain("Pick 1/");

  // One-click draft of the top recommendation.
  await page.getByTestId("draft-top").click();
  await expect.poll(() => status(page)).toContain("Pick 2/");

  // Search-to-draft with the keyboard.
  await page.keyboard.press("/");
  await page.getByTestId("player-search").fill("Haliburton");
  await page.keyboard.press("Enter");
  await expect.poll(() => status(page)).toContain("Pick 3/");

  // Drafted players cannot be drafted again: search shows them as drafted.
  await page.getByTestId("player-search").fill("Haliburton");
  await expect(page.locator("li", { hasText: "drafted" }).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Several more picks via the available table.
  for (let i = 0; i < 4; i++) {
    await page.getByTestId("available-table").locator("button", { hasText: "Draft" }).first().click();
    await expect.poll(() => status(page)).toContain(`Pick ${4 + i}/`);
  }

  // Persistence across reload.
  await page.reload();
  await expect.poll(() => status(page), { timeout: 30_000 }).toContain("Pick 7/");

  // Undo / redo.
  await page.getByTestId("undo").click();
  await expect.poll(() => status(page)).toContain("Pick 6/");
  await page.getByTestId("redo").click();
  await expect.poll(() => status(page)).toContain("Pick 7/");

  // The snake board shows the picks.
  await expect(page.getByTestId("draft-board")).toContainText("Haliburton");
  expect(errors).toEqual([]);
});

test("analysis pages render with live data", async ({ page }) => {
  for (const [path, heading] of [
    ["/decision", "Draft Decision Center"],
    ["/players", "Master Player Database"],
    ["/punt-lab", "Punt Strategy Laboratory"],
    ["/team", "My Team Analyzer"],
    ["/opponents", "Opponent Intelligence"],
    ["/compare", "Player Comparison"],
    ["/mock", "Mock Draft Simulator"],
    ["/playoffs", "Fantasy Playoff Optimizer"],
    ["/history", "Draft History & Audit"],
    ["/data", "Data Management"],
    ["/library", "Strategy Research Library"],
    ["/settings", "League & Draft Sessions"],
  ]) {
    await page.goto(path);
    await expect(page.locator("h1").first()).toHaveText(heading, { timeout: 30_000 });
  }
  await page.goto("/players");
  await expect(page.getByTestId("players-table").locator("tbody tr").first()).toBeVisible();
  await page.goto("/punt-lab");
  await expect(page.getByTestId("strategy-table")).toBeVisible({ timeout: 60_000 });
});

test("player profile what-if and copilot answer from engine data", async ({ page }) => {
  await page.goto("/players");
  await page.getByTestId("players-table").locator("a").first().click();
  await expect(page.getByTestId("what-if")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("what-if").click();
  await expect(page.getByText("Hypothetical: you draft this player now")).toBeVisible();
  await page.getByTestId("copilot-open").click();
  await page.getByTestId("copilot-input").fill("Who should I draft?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("ENGINE").first()).toBeVisible({ timeout: 30_000 });
});

test("CSV import validates and applies ADP", async ({ page }) => {
  await page.goto("/data");
  await page.getByRole("button", { name: "ADP" }).click();
  await page.getByTestId("import-text").fill("name,adp\nNikola Jokic,1.4\nVictor Wembanyama,2.3\nNot A Player,3\n");
  await page.getByTestId("import-run").click();
  await expect(page.getByText(/unmatched players: 1/)).toBeVisible({ timeout: 30_000 });
});
