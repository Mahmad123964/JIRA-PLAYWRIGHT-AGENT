import { test, expect } from "@playwright/test";

/**
 * Smoke preflight: the agent can drive a real browser against a real page.
 *
 * Deliberately self-contained -- it uses a data: URL, so it needs no fixture
 * server, no network and no credentials. That is what makes it valid as a smoke
 * check: if the browser runtime is missing or the runner is misconfigured, this
 * fails, and if it passes the pipeline is genuinely wired end to end.
 */
test("browser runtime is available and can navigate", async ({ page }) => {
  await page.goto("data:text/html,<h1>smoke preflight</h1>");
  await expect(page.getByRole("heading")).toHaveText("smoke preflight");
});
