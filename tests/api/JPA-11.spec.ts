import { expect, test } from "@playwright/test";

test("JPA-11: POST creates a new JSONPlaceholder resource", async ({ request }) => {
  const submittedData = {
    title: "QA API Test",
    body: "Testing POST request",
    userId: 1,
  };
  let response;
  let responseBody: Record<string, unknown>;

  await test.step("Send a POST request to https://jsonplaceholder.typicode.com/posts", async () => {
    response = await request.post("https://jsonplaceholder.typicode.com/posts", {
      data: submittedData,
    });
  });

  await test.step("Send the JSON request body", async () => {
    expect(submittedData).toEqual({
      title: "QA API Test",
      body: "Testing POST request",
      userId: 1,
    });
  });

  await test.step("Verify the HTTP response status", async () => {
    expect(response.status()).toBe(201);
  });

  await test.step("Read the JSON response body", async () => {
    responseBody = (await response.json()) as Record<string, unknown>;
    expect(responseBody).toBeTruthy();
    expect(typeof responseBody).toBe("object");
  });

  await test.step("Verify the returned fields match the submitted data", async () => {
    expect(responseBody).toHaveProperty("id");
    expect(typeof responseBody.id).toBe("number");
    expect(responseBody).toMatchObject(submittedData);
  });
});
