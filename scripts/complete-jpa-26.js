const {
  appendDescription,
  moveTicket,
  verifyTicket,
} = require("./jira-ops.js");

const resultText = `--- Automation Result (JPA-26) ---
Test path: tests/generated/JPA-26.spec.ts
Test type: UI (Playwright browser automation, role-based selectors, no XPath)
Execution command: npx playwright test tests/generated/JPA-26.spec.ts
Execution result: PASSED (1 passed, 7.6s)
Target: https://www.wikipedia.org/ (verified live before test generation)
Expected vs Actual:
- Target website loads successfully: expected HTTP 200 + title Wikipedia, actual 200 and title matched - PASS
- English language link is visible and clickable: expected visible+enabled, actual toBeVisible/toBeEnabled passed - PASS
- User is navigated to English Main Page: expected URL match /wiki/Main_Page, actual toHaveURL matched - PASS
- Page title and main welcome heading are visible: expected title Wikipedia, the free encyclopedia and heading Welcome to Wikipedia, actual both present - PASS
- No unexpected error is displayed: expected zero error notices, actual count 0 - PASS
Conclusion: all acceptance criteria verified.`;

(async () => {
  await appendDescription("JPA-26", resultText);
  console.log("JPA-26 description updated.");
  await moveTicket("JPA-26", "31");
  console.log("JPA-26 moved to Done.");
  const ver = await verifyTicket("JPA-26");
  console.log("JPA-26 VERIFIED:", JSON.stringify(ver));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
