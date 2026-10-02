import { expect, test } from "@playwright/test";

/**
 * JPA-24: API - Verify GET /products/categories returns valid category list
 * Target (authoritative): GET https://dummyjson.com/products/categories
 * Contract source: dummyjson-docs-products.html ("Get all products categories")
 */
test("JPA-24: categories endpoint returns a valid category list", async ({ request }) => {
  let response;
  let body: unknown;

  await test.step("Send a GET request to the categories endpoint", async () => {
    response = await request.get("https://dummyjson.com/products/categories");
  });

  await test.step("Verify the API endpoint responds successfully with HTTP 200", async () => {
    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);
  });

  await test.step("Verify response Content-Type is application/json", async () => {
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
  });

  await test.step("Verify response body is a valid JSON array", async () => {
    body = await response.json(); // throws if invalid JSON
    expect(Array.isArray(body)).toBe(true);
    expect((body as Array<unknown>).length).toBeGreaterThan(0);
  });

  await test.step("Verify each category object contains documented fields (slug, name, url)", async () => {
    const categories = body as Array<Record<string, unknown>>;
    for (const category of categories) {
      expect(category).toEqual(
        expect.objectContaining({
          slug: expect.anything(),
          name: expect.anything(),
          url: expect.anything(),
        })
      );
    }
  });

  await test.step("Verify field data types match the contract", async () => {
    const categories = body as Array<{ slug: unknown; name: unknown; url: unknown }>;
    for (const category of categories) {
      expect(typeof category.slug).toBe("string");
      expect(typeof category.name).toBe("string");
      expect(typeof category.url).toBe("string");
      expect((category.slug as string).trim()).not.toBe("");
      expect((category.name as string).trim()).not.toBe("");
      expect((category.url as string).startsWith("http")).toBe(true);
    }
  });
});
