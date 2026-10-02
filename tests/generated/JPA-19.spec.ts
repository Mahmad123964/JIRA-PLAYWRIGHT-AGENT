import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

/**
 * JPA-19: UI - Verify search functionality
 * Target (authoritative): Wikipedia search — the repo's existing verified UI search
 * target (tests/generated/JPA-13.spec.ts), re-verified live before this test was written.
 * Verified live: searchbox "Search Wikipedia" visible; submit navigates to the search
 * results page (.mw-search-result entries are rendered for a multi-match query).
 */
test("JPA-19: user can search the target website and see relevant results", async ({ page }) => {
  const searchInput = page.getByRole("searchbox", { name: "Search Wikipedia" });
  const searchButton = page.getByRole("button", { name: "Search", exact: true });

  await test.step("Target website loads successfully", async () => {
    const response = await page.goto("https://www.wikipedia.org/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Wikipedia");
  });

  await test.step("Search input is visible and usable", async () => {
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();
  });

  await test.step("A valid search query can be entered and submitted", async () => {
    await searchInput.fill("Playwright testing");
    await expect(searchInput).toHaveValue("Playwright testing");
    await searchButton.click();
    await expect(page).toHaveURL(/Special:Search\?search=Playwright\+testing/);
  });

  await test.step("Search results load successfully", async () => {
    await expect(page).toHaveTitle(/Search results - Wikipedia/);
    await expect(page.locator(".mw-search-result").first()).toBeVisible();
    const count = await page.locator(".mw-search-result").count();
    expect(count).toBeGreaterThan(0);
  });

  await test.step("Search results are relevant to the submitted query", async () => {
    const firstHeading = page.locator(".mw-search-result-heading").first();
    await expect(firstHeading).toContainText(/Playwright/i);
  });
});
