import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

/**
 * JPA-26: UI - Verify Wikipedia portal navigation and welcome heading
 * Target (authoritative): https://www.wikipedia.org/ (specified in ticket requirement)
 * Verified live: English portal link navigates to https://en.wikipedia.org/wiki/Main_Page
 * and displays the "Welcome to Wikipedia" heading.
 */
test("JPA-26: user can navigate from Wikipedia portal to English Main Page", async ({ page }) => {
  const englishLink = page.getByRole("link", { name: /English/i }).first();
  const welcomeHeading = page.getByRole("heading", { name: /Welcome to Wikipedia/i });

  await test.step("Target website loads successfully", async () => {
    const response = await page.goto("https://www.wikipedia.org/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Wikipedia");
  });

  await test.step("English language link is visible and clickable", async () => {
    await expect(englishLink).toBeVisible();
    await expect(englishLink).toBeEnabled();
  });

  await test.step("User is navigated to the English Main Page", async () => {
    await englishLink.click();
    await expect(page).toHaveURL(/https:\/\/en\.wikipedia\.org\/wiki\/Main_Page/);
  });

  await test.step("Page title and main welcome heading are visible", async () => {
    await expect(page).toHaveTitle(/Wikipedia, the free encyclopedia/);
    await expect(welcomeHeading).toBeVisible();
  });

  await test.step("No unexpected error is displayed", async () => {
    await expect(page.getByText(/Our servers are currently having technical difficulties/i)).toHaveCount(0);
    await expect(page.getByText(/Wikipedia does not have an article with this exact name/i)).toHaveCount(0);
  });
});
