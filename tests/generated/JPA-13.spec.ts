import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

test("JPA-13: search Wikipedia for Playwright", async ({ page }) => {
  const searchInput = page.getByRole("searchbox", {
    name: "Search Wikipedia",
  });
  const searchButton = page.getByRole("button", {
    name: "Search",
    exact: true,
  });

  await test.step("Open the Wikipedia homepage", async () => {
    await page.goto("https://www.wikipedia.org/");
    await expect(page).toHaveTitle("Wikipedia");
  });

  await test.step("Locate the search input", async () => {
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeEnabled();
  });

  await test.step("Enter Playwright into the search input", async () => {
    await searchInput.fill("Playwright");
    await expect(searchInput).toHaveValue("Playwright");
  });

  await test.step("Submit the search", async () => {
    await searchButton.click();
    await expect(page).toHaveURL(/https:\/\/en\.wikipedia\.org\/wiki\/Playwright/);
  });

  await test.step("Verify the resulting article/search page loads successfully", async () => {
    await expect(page).toHaveTitle("Playwright - Wikipedia");
    await expect(page.getByRole("heading", { name: "Playwright", level: 1 })).toBeVisible();
  });
});
