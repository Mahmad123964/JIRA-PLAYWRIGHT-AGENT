import { expect, test } from "@playwright/test";

test.use({
  locale: "en-US",
  screenshot: "on",
  trace: "on",
  video: "on",
});

/**
 * JPA-28: UI - Detect incorrect welcome heading with visual evidence
 * Target (authoritative): https://www.wikipedia.org/ -> English Wikipedia Main Page
 * Verified live: Actual welcome heading is "Welcome to Wikipedia"
 * Intended requirement: Assert heading text is "This heading should intentionally not exist"
 * Purpose: Validate failure capture, visual evidence (screenshot, trace, video), and failure classification.
 */
test("JPA-28: detect incorrect welcome heading with visual evidence", async ({ page }) => {
  const englishLink = page.getByRole("link", { name: /English/i }).first();
  const welcomeHeading = page.getByRole("heading", { name: /Welcome to Wikipedia/i });

  await test.step("Step 1: Open the target website", async () => {
    const response = await page.goto("https://www.wikipedia.org/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Wikipedia");
  });

  await test.step("Step 2: Navigate to the English Wikipedia page", async () => {
    await expect(englishLink).toBeVisible();
    await englishLink.click();
    await expect(page).toHaveURL(/https:\/\/en\.wikipedia\.org\/wiki\/Main_Page/);
  });

  await test.step("Step 3: Locate the primary welcome heading", async () => {
    await expect(welcomeHeading).toBeVisible();
  });

  await test.step("Step 4: Assert heading text matches the requirement", async () => {
    // Ticket requirement explicitly mandates asserting heading text is "This heading should intentionally not exist"
    await expect(welcomeHeading).toHaveText("This heading should intentionally not exist", { timeout: 3000 });
  });
});
