import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

test("JPA-5: navigate to YouTube Home", async ({ page }) => {
  const navigation = page.getByRole("navigation").first();
  const homeLink = navigation
    .getByRole("link", { name: "Home", exact: true })
    .first();

  await test.step("Open https://www.youtube.com/", async () => {
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });
    await page.goto("https://www.youtube.com/");
    await expect(page).toHaveTitle("YouTube");
  });

  await test.step("Locate the Home navigation item", async () => {
    await expect(page.getByRole("button", { name: "Guide" })).toBeVisible();
    await expect(homeLink).toBeVisible();
  });

  await test.step("Select Home", async () => {
    await expect(homeLink).toBeEnabled();
    await homeLink.click();
  });

  await test.step("Wait for the Home page to load", async () => {
    await expect(page).toHaveURL(/youtube\.com\/(?:\?.*)?$/);
    await expect(page).toHaveTitle("YouTube");
    await expect(page.getByRole("main")).toContainText(
      "Try searching to get started"
    );
  });
});
