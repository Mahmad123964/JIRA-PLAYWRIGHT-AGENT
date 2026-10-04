import { test, expect } from "@playwright/test";

/**
 * PREFLIGHT -- environment and runner sanity, NOT a product smoke test.
 *
 * What a pass here actually proves:
 *   - the Playwright browser runtime is installed and launches;
 *   - the repository playwright.config.ts is being applied (trace/video/screenshot
 *     capture hooks run);
 *   - the execution engine can spawn the runner, parse its JSON reporter into a
 *     real per-test result, and produce a report;
 *   - the reporting and secret-scan path completes.
 *
 * What it does NOT prove: anything about the product under test. It navigates a
 * data: URL and never touches a real target, so it says nothing about the
 * application. Real product smoke flows belong in their own profile and are added
 * to qa.config.json explicitly -- they are never inferred (AGENTS.md Section 6).
 *
 * It is deliberately self-contained: no fixture server, no network, no credentials.
 */
test("browser runtime is available and can navigate", async ({ page }) => {
  await page.goto("data:text/html,<h1>preflight ok</h1>");
  await expect(page.getByRole("heading")).toHaveText("preflight ok");
});