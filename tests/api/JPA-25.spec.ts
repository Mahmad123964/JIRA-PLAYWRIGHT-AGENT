import { expect, test } from "@playwright/test";

/**
 * JPA-25: API - Verify product search query returns matching items
 * Target (authoritative): GET https://dummyjson.com/products/search?q=phone
 * Contract source: dummyjson-docs-products.html ("Search products")
 */
test("JPA-25: product search query returns matching items and pagination metadata", async ({ request }) => {
  let response;
  let body: unknown;

  await test.step("Send a GET request to /products/search?q=phone", async () => {
    response = await request.get("https://dummyjson.com/products/search?q=phone");
  });

  await test.step("Verify the endpoint responds successfully with HTTP 200", async () => {
    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);
  });

  await test.step("Verify the response is valid JSON", async () => {
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
    body = await response.json(); // throws if invalid JSON
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });

  await test.step("Verify products array is non-empty and items match the query", async () => {
    const data = body as { products: Array<{ id: number; title: string; description: string; category: string }> };
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products.length).toBeGreaterThan(0);

    // Verify product objects have required structure
    for (const prod of data.products) {
      expect(typeof prod.id).toBe("number");
      expect(typeof prod.title).toBe("string");
      expect(typeof prod.description).toBe("string");
    }

    // Verify items in the result set correlate with the search query "phone"
    const matchingItems = data.products.filter(
      (p) =>
        p.title.toLowerCase().includes("phone") ||
        p.description.toLowerCase().includes("phone") ||
        (p.category && p.category.toLowerCase().includes("phone")) ||
        (p.category && p.category.toLowerCase().includes("smartphones")) ||
        (p.category && p.category.toLowerCase().includes("mobile-accessories"))
    );
    expect(matchingItems.length).toBeGreaterThan(0);
  });

  await test.step("Verify pagination fields (total, skip, limit) are present with numeric values", async () => {
    const data = body as { total: unknown; skip: unknown; limit: unknown };
    expect(typeof data.total).toBe("number");
    expect(typeof data.skip).toBe("number");
    expect(typeof data.limit).toBe("number");
    expect(data.total).toBeGreaterThanOrEqual(0);
    expect(data.skip).toBeGreaterThanOrEqual(0);
    expect(data.limit).toBeGreaterThan(0);
  });
});
