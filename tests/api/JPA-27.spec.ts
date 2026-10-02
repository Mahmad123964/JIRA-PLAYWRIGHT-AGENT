import { expect, test } from "@playwright/test";

/**
 * JPA-27: API - Verify product pagination parameters limit and skip
 * Target (authoritative): GET https://dummyjson.com/products?limit=10&skip=20
 * Contract source: dummyjson-docs-products.html ("Limit and skip products")
 */
test("JPA-27: pagination parameters limit and skip control response array and offset", async ({ request }) => {
  let response;
  let body: unknown;

  await test.step("Send a GET request to /products?limit=10&skip=20", async () => {
    response = await request.get("https://dummyjson.com/products?limit=10&skip=20");
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

  await test.step("Verify returned products array length equals requested limit (10)", async () => {
    const data = body as { products: Array<unknown> };
    expect(Array.isArray(data.products)).toBe(true);
    expect(data.products.length).toBe(10);
  });

  await test.step("Verify response limit equals 10 and skip equals 20", async () => {
    const data = body as { limit: unknown; skip: unknown; total: unknown };
    expect(data.limit).toBe(10);
    expect(data.skip).toBe(20);
    expect(typeof data.total).toBe("number");
    expect((data.total as number)).toBeGreaterThanOrEqual(30);
  });

  await test.step("Verify returned product objects contain required product fields", async () => {
    const data = body as {
      products: Array<{
        id: number;
        title: string;
        price: number;
        category: string;
        thumbnail: string;
      }>;
    };

    for (const product of data.products) {
      expect(typeof product.id).toBe("number");
      expect(typeof product.title).toBe("string");
      expect(typeof product.price).toBe("number");
      expect(typeof product.category).toBe("string");
      expect(typeof product.thumbnail).toBe("string");
      expect(product.title.trim()).not.toBe("");
    }

    // Verify offset behavior: items should start with id 21
    expect(data.products[0].id).toBe(21);
  });
});
