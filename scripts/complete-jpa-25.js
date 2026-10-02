const {
  appendDescription,
  moveTicket,
  verifyTicket,
} = require("./jira-ops.js");

const resultText = `--- Automation Result (JPA-25) ---
Test path: tests/api/JPA-25.spec.ts
Test type: API (Playwright APIRequestContext)
Execution command: npx playwright test tests/api/JPA-25.spec.ts
Execution result: PASSED (1 passed, 3.2s)
Target: GET https://dummyjson.com/products/search?q=phone (verified against dummyjson-docs-products.html and live API probe)
Expected vs Actual:
- GET /products/search?q=phone responds successfully: expected true, actual response.ok()=true - PASS
- HTTP status 200: expected 200, actual 200 - PASS
- Response is valid JSON: expected application/json, actual application/json; charset=utf-8, parsed - PASS
- products array is non-empty and items match query: expected non-empty array with phone matches, actual 23 matching products - PASS
- Pagination fields (total, skip, limit) are present with numeric values: expected numbers (total>=0, skip>=0, limit>0), actual total=23, skip=0, limit=23 - PASS
Conclusion: all acceptance criteria verified.`;

(async () => {
  await appendDescription("JPA-25", resultText);
  console.log("JPA-25 description updated.");
  await moveTicket("JPA-25", "31");
  console.log("JPA-25 moved to Done.");
  const ver = await verifyTicket("JPA-25");
  console.log("JPA-25 VERIFIED:", JSON.stringify(ver));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
