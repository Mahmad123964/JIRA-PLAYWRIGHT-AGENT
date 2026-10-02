import { expect, test } from "@playwright/test";

test("JPA-10: GET user data from JSONPlaceholder", async ({ request }) => {
  let response;
  let body: unknown;

  await test.step("Send a GET request to https://jsonplaceholder.typicode.com/users/1", async () => {
    response = await request.get("https://jsonplaceholder.typicode.com/users/1");
  });

  await test.step("Verify the HTTP response status", async () => {
    expect(response.status()).toBe(200);
  });

  await test.step("Read the JSON response body", async () => {
    body = await response.json();
    expect(body).toBeTruthy();
    expect(typeof body).toBe("object");
  });

  await test.step("Verify the required user fields are present", async () => {
    expect(body).toEqual(
      expect.objectContaining({
        id: expect.any(Number),
        name: expect.any(String),
        username: expect.any(String),
        email: expect.any(String),
      })
    );
  });

  await test.step("Verify the returned user ID is 1", async () => {
    expect(body).toMatchObject({ id: 1 });
  });
});
