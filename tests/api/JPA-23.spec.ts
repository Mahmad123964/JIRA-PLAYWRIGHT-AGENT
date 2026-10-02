import { expect, test } from "@playwright/test";

/**
 * JPA-23: Verify invalid product API returns documented error
 * Target (authoritative): GET https://dummyjson.com/products/{id} — the product API
 * documented in dummyjson-docs-products.html (repo root).
 * Error contract verified live before writing this test:
 *   GET /products/999999 -> 404, content-type application/json,
 *   body {"message":"Product with id '999999' not found"}
 */
test("JPA-23: invalid product request returns the documented error response", async ({ request }) => {
  let response;
  let body: unknown;

  await test.step("Send an invalid product request", async () => {
    response = await request.get("https://dummyjson.com/products/999999");
  });

  await test.step("Verify the API returns the documented HTTP error status", async () => {
    expect(response.status()).toBe(404);
  });

  await test.step("Verify the error response is valid JSON", async () => {
    const contentType = response.headers()["content-type"] ?? "";
    expect(contentType).toContain("application/json");
    body = await response.json(); // throws (fails the test) if not valid JSON
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });

  await test.step("Verify the error response contains the documented error message field", async () => {
    expect(body).toEqual(
      expect.objectContaining({
        message: expect.any(String),
      })
    );
    expect((body as { message: string }).message).toContain("not found");
  });

  await test.step("Verify no successful product object is returned", async () => {
    expect(body).not.toEqual(
      expect.objectContaining({
        id: expect.anything(),
        title: expect.anything(),
        price: expect.anything(),
      })
    );
  });
});
