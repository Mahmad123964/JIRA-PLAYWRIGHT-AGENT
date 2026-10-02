const {
  appendDescription,
  moveTicket,
  verifyTicket,
} = require("./jira-ops.js");

const resultText = `--- Automation Result (JPA-27) ---
Test path: tests/api/JPA-27.spec.ts
Test type: API (Playwright APIRequestContext)
Execution command: npx playwright test tests/api/JPA-27.spec.ts
Execution result: PASSED (1 passed, 4.3s)
Target: GET https://dummyjson.com/products?limit=10&skip=20 (verified against dummyjson-docs-products.html and live API probe)
Expected vs Actual:
- GET /products?limit=10&skip=20 responds successfully: expected true, actual response.ok()=true - PASS
- HTTP status 200: expected 200, actual 200 - PASS
- Response is valid JSON: expected application/json, actual application/json; charset=utf-8, parsed - PASS
- Returned products array length equals requested limit (10): expected length=10, actual length=10 - PASS
- Response limit equals 10 and skip equals 20: expected limit=10, skip=20, actual limit=10, skip=20 - PASS
- Returned product objects contain required product fields: expected valid id, title, price, category, thumbnail; expected offset start id=21, actual verified - PASS
Conclusion: all acceptance criteria verified.`;

(async () => {
  await appendDescription("JPA-27", resultText);
  console.log("JPA-27 description updated.");
  await moveTicket("JPA-27", "31");
  console.log("JPA-27 moved to Done.");
  const ver = await verifyTicket("JPA-27");
  console.log("JPA-27 VERIFIED:", JSON.stringify(ver));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
