import { expect, test } from "@playwright/test";

test("JPA-14: GET product details from DummyJSON", async ({ request }) => {
  let response;
  let responseBody: Record<string, unknown>;

  await test.step("Send a GET request to https://dummyjson.com/products/1", async () => {
    response = await request.get("https://dummyjson.com/products/1");
  });

  await test.step("Verify the HTTP response status", async () => {
    expect(response.status()).toBe(200);
  });

  await test.step("Parse the response as JSON", async () => {
    responseBody = (await response.json()) as Record<string, unknown>;
    expect(responseBody).toBeTruthy();
    expect(typeof responseBody).toBe("object");
  });

  await test.step("Verify the response contains the expected product fields", async () => {
    expect(responseBody).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        title: expect.any(String),
        price: expect.any(Number),
        category: expect.any(String),
      })
    );
  });

  await test.step("Verify the product ID is 1", async () => {
    expect(responseBody).toMatchObject({ id: 1 });
  });

  await test.step("Verify the product title is non-empty", async () => {
    expect(typeof responseBody.title).toBe("string");
    expect((responseBody.title as string).trim()).not.toBe("");
  });
});
