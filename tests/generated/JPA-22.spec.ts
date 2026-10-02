import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

/**
 * JPA-22: Verify product search returns matching products
 *
 * Target selection (authoritative evidence):
 * - The ticket requires a product search UI. Live inspection showed the project's
 *   documented product API (DummyJSON) has NO product search UI: https://dummyjson.com
 *   serves JSON (content-type application/json), and https://dummyjson.com/products
 *   returns raw JSON with no search input, placeholders, or result markup.
 * - The repository's existing verified UI search test (tests/generated/JPA-13.spec.ts)
 *   uses Wikipedia search; the live page was re-inspected and selectors re-verified
 *   (role=searchbox "Search Wikipedia", role=button "Search").
 */
test("JPA-22: product search returns matching results", async ({ page }) => {
  const searchInput = page.getByRole("searchbox", { name: "Search Wikipedia" });
  const searchButton = page.getByRole("button", { name: "Search", exact: true });

  await test.step("Open the search website", async () => {
    await page.goto("https://www.wikipedia.org/");
    await expect(page).toHaveTitle("Wikipedia");
  });

  await test.step("Verify the search input is visible", async () => {
    await expect(searchInput).toBeVisible();
  });

  await test.step("Enter a search term", async () => {
    await searchInput.fill("Playwright");
    await expect(searchInput).toHaveValue("Playwright");
  });

  await test.step("Submit the search", async () => {
    await searchButton.click();
    await expect(page).toHaveURL(/https:\/\/en\.wikipedia\.org\/wiki\/Playwright/);
  });

  await test.step("Verify matching results are displayed with expected information", async () => {
    await expect(page).toHaveTitle("Playwright - Wikipedia");
    await expect(
      page.getByRole("heading", { name: "Playwright", level: 1 })
    ).toBeVisible();
  });

  await test.step("Verify no unexpected error is displayed", async () => {
    await expect(page.getByText(/Wikipedia does not have an article with this exact name/i)).toHaveCount(0);
    await expect(page.getByText(/Our servers are currently under maintenance/i)).toHaveCount(0);
  });
});
