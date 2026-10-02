import { expect, test } from "@playwright/test";

/**
 * JPA-21: Verify product API returns valid JSON response
 * Target (authoritative): GET https://dummyjson.com/products/1
 * Contract source: dummyjson-docs-products.html ("Get a single product") saved in repo root.
 */
test("JPA-21: product API returns a valid JSON response", async ({ request }) => {
  let response;
  let body: Record<string, unknown>;

  await test.step("Send a GET request to the product endpoint", async () => {
    response = await request.get("https://dummyjson.com/products/1");
  });

  await test.step("Verify the API endpoint responds successfully with HTTP 200", async () => {
    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);
  });

  await test.step("Verify the response Content-Type is application/json", async () => {
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
  });

  await test.step("Verify the response body is valid JSON", async () => {
    body = (await response.json()) as Record<string, unknown>; // throws (fails the test) if not valid JSON
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });

  await test.step("Verify required documented fields are present", async () => {
    expect(body).toEqual(
      expect.objectContaining({
        id: expect.anything(),
        title: expect.anything(),
        description: expect.anything(),
        category: expect.anything(),
        price: expect.anything(),
        discountPercentage: expect.anything(),
        rating: expect.anything(),
        stock: expect.anything(),
        tags: expect.anything(),
        brand: expect.anything(),
        sku: expect.anything(),
        weight: expect.anything(),
        dimensions: expect.anything(),
        warrantyInformation: expect.anything(),
        shippingInformation: expect.anything(),
        availabilityStatus: expect.anything(),
        reviews: expect.anything(),
        returnPolicy: expect.anything(),
        minimumOrderQuantity: expect.anything(),
        meta: expect.anything(),
        thumbnail: expect.anything(),
        images: expect.anything(),
      })
    );
  });

  await test.step("Verify field data types match the documented contract", async () => {
    expect(typeof body.id).toBe("number");
    expect(typeof body.title).toBe("string");
    expect(typeof body.description).toBe("string");
    expect(typeof body.category).toBe("string");
    expect(typeof body.price).toBe("number");
    expect(typeof body.discountPercentage).toBe("number");
    expect(typeof body.rating).toBe("number");
    expect(typeof body.stock).toBe("number");
    expect(Array.isArray(body.tags)).toBe(true);
    expect(typeof body.brand).toBe("string");
    expect(typeof body.sku).toBe("string");
    expect(typeof body.weight).toBe("number");
    expect(typeof body.dimensions).toBe("object");
    expect(typeof body.warrantyInformation).toBe("string");
    expect(typeof body.shippingInformation).toBe("string");
    expect(typeof body.availabilityStatus).toBe("string");
    expect(Array.isArray(body.reviews)).toBe(true);
    expect(typeof body.returnPolicy).toBe("string");
    expect(typeof body.minimumOrderQuantity).toBe("number");
    expect(typeof body.meta).toBe("object");
    expect(typeof body.thumbnail).toBe("string");
    expect(Array.isArray(body.images)).toBe(true);
  });
});
