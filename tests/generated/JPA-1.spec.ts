import { expect, test } from "@playwright/test";

test("JPA-1: search for a video on YouTube", async ({ page }) => {
  const searchInput = page.getByRole("combobox", { name: "Search" });
  const searchButton = page.getByRole("button", {
    name: "Search",
    exact: true,
  });

  await test.step("Open https://www.youtube.com/", async () => {
    await page.goto("https://www.youtube.com/");
  });

  await test.step("Locate the main search input", async () => {
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();
  });

  await test.step("Enter Playwright testing into the search input", async () => {
    await searchInput.fill("Playwright testing");
    await expect(searchInput).toHaveValue("Playwright testing");
  });

  await test.step("Submit the search", async () => {
    await searchButton.click();
    await expect(page).toHaveURL(/\/results\?search_query=Playwright\+testing/);
  });

  await test.step("Wait for the search results page to load", async () => {
    await expect(page).toHaveTitle(/Playwright testing - YouTube/);
    await expect(page.getByRole("main")).toContainText("Playwright", {
      timeout: 10_000,
    });
  });
});
