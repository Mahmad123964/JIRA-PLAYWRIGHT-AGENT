import { expect, test } from "@playwright/test";

test("JPA-12: invalid user returns the expected error", async ({ request }) => {
  let response;
  let responseBody: unknown;

  await test.step("Send a GET request to https://jsonplaceholder.typicode.com/users/9999", async () => {
    response = await request.get("https://jsonplaceholder.typicode.com/users/9999");
  });

  await test.step("Verify the HTTP response status", async () => {
    expect(response.status()).toBe(404);
  });

  await test.step("Verify the response body represents an empty result", async () => {
    responseBody = await response.json();
    expect(responseBody).toEqual({});
    expect(responseBody).not.toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        username: expect.any(String),
        email: expect.any(String),
      })
    );
  });
});
