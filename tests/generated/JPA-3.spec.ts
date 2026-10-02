import { expect, test } from "@playwright/test";

test("JPA-3: navigate from YouTube Home to Subscriptions", async ({ page }) => {
  const guideButton = page.getByRole("button", { name: "Guide" });
  const navigation = page.getByRole("navigation").first();
  const homeLink = navigation.getByRole("link", { name: "Home", exact: true }).first();
  const subscriptionsLink = navigation
    .getByRole("link", { name: "Subscriptions", exact: true })
    .last();

  await test.step("Open https://www.youtube.com/", async () => {
    await page.goto("https://www.youtube.com/");
  });

  await test.step("Locate the Home navigation item", async () => {
    await guideButton.click();
    await expect(homeLink).toBeVisible();
  });

  await test.step("Verify that the Home page is displayed", async () => {
    await expect(page).toHaveURL(/youtube\.com\/(?:\?.*)?$/);
    await expect(page).toHaveTitle("YouTube");
  });

  await test.step("Locate the Subscriptions navigation item", async () => {
    await expect(subscriptionsLink).toBeVisible();
  });

  await test.step("Select Subscriptions", async () => {
    await subscriptionsLink.click();
    await expect(page).toHaveURL(/youtube\.com\/feed\/subscriptions/);
  });

  await test.step("Wait for the page to load", async () => {
    await expect(page).toHaveTitle("Subscriptions - YouTube");
    await expect(page.getByRole("main")).toContainText(
      "Sign in to see updates from your favorite YouTube channels"
    );
  });
});