const {
  appendDescription,
  moveTicket,
  verifyTicket,
} = require("./jira-ops.js");

const resultText = `--- Automation Result (JPA-24) ---
Test path: tests/api/JPA-24.spec.ts
Test type: API (Playwright APIRequestContext)
Execution command: npx playwright test tests/api/JPA-24.spec.ts
Execution result: PASSED (1 passed, 4.0s)
Target: GET https://dummyjson.com/products/categories (verified against repository docs dummyjson-docs-products.html and live API probe)
Expected vs Actual:
- API endpoint responds successfully: expected true, actual response.ok()=true - PASS
- HTTP status 200: expected 200, actual 200 - PASS
- Response Content-Type: expected application/json, actual application/json; charset=utf-8 - PASS
- Response body is valid JSON array: expected Array.isArray=true, actual 24 categories array - PASS
- Required fields present (slug, name, url): expected all fields present on each category, actual verified - PASS
- Field data types match contract: expected string types for slug, name, url, actual verified - PASS
Conclusion: all acceptance criteria verified.`;

(async () => {
  await appendDescription("JPA-24", resultText);
  console.log("JPA-24 description updated.");
  await moveTicket("JPA-24", "31");
  console.log("JPA-24 moved to Done.");
  const ver = await verifyTicket("JPA-24");
  console.log("JPA-24 VERIFIED:", JSON.stringify(ver));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
