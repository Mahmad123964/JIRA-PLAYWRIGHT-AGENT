require("dotenv").config();
const { appendDescription, verifyTicket } = require("./jira-ops.js");

const auth = Buffer.from(
  `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`,
).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");
const projectKey = process.env.JIRA_PROJECT_KEY;

function textToAdf(text) {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\r?\n/).map((l) => ({
      type: "paragraph",
      content: l ? [{ type: "text", text: l }] : [],
    })),
  };
}

async function createBugForJPA28() {
  const bugSummary =
    "[Defect] UI: Welcome heading text does not match expected requirement";
  const bugDescription = `Originating Ticket: JPA-28
Test File Path: tests/generated/JPA-28.spec.ts
Scenario: Detect incorrect welcome heading with visual evidence

Steps to Reproduce:
1. Open https://www.wikipedia.org/
2. Click English portal link to navigate to https://en.wikipedia.org/wiki/Main_Page
3. Locate primary welcome heading (role=heading, level 1)
4. Check heading text

Expected Result:
Heading text should be "This heading should intentionally not exist"

Actual Result:
Heading text is "Welcome to Wikipedia"

Failing Assertion:
expect(welcomeHeading).toHaveText("This heading should intentionally not exist", { timeout: 3000 })

Evidence Collected:
- Screenshot: test-results/generated-JPA-28-JPA-28-de-f802c-eading-with-visual-evidence-chromium/test-failed-1.png
- Video: test-results/generated-JPA-28-JPA-28-de-f802c-eading-with-visual-evidence-chromium/video.webm
- Trace: test-results/generated-JPA-28-JPA-28-de-f802c-eading-with-visual-evidence-chromium/trace.zip
- DOM element: <h1 id="Welcome_to_Wikipedia" class="html-heading mw-html-heading">Welcome to Wikipedia</h1>

Failure Classification: A. REAL APPLICATION DEFECT / Requirement Mismatch`;

  // Fetch issue types
  const metaRes = await fetch(
    `${baseUrl}/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes.fields`,
    {
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  const meta = await metaRes.json();
  const bugType =
    meta.projects[0].issuetypes.find((t) => t.name.toLowerCase() === "bug") ||
    meta.projects[0].issuetypes[0];

  const bugBody = {
    fields: {
      project: { key: projectKey },
      summary: bugSummary,
      issuetype: { id: bugType.id },
      priority: { id: "1" }, // Highest
      description: textToAdf(bugDescription),
    },
  };

  const createRes = await fetch(`${baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bugBody),
  });

  const createdBug = await createRes.json();
  console.log("Bug created:", createdBug.key);

  // Link bug to JPA-28
  if (createdBug.key) {
    const linkRes = await fetch(`${baseUrl}/rest/api/3/issueLink`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: { name: "Relates" },
        inwardIssue: { key: "JPA-28" },
        outwardIssue: { key: createdBug.key },
      }),
    });
    console.log("Link status:", linkRes.status);
  }

  return createdBug.key;
}

async function updateJPA28(bugKey) {
  const resultText = `--- Automation Result (JPA-28) ---
Test path: tests/generated/JPA-28.spec.ts
Test type: UI (Playwright browser automation, role-based selectors, no XPath)
Execution command: npx playwright test tests/generated/JPA-28.spec.ts
Execution result: FAILED (1 failed, 1 worker, 3.0s timeout on failing assertion)
Target: https://www.wikipedia.org/ -> https://en.wikipedia.org/wiki/Main_Page
Classification: FAILED / A. REAL APPLICATION DEFECT

Expected vs Actual:
- Step 1 (Open target website): Expected HTTP 200 & title "Wikipedia", Actual 200 & title matched - PASS
- Step 2 (Navigate to English Main Page): Expected URL /wiki/Main_Page, Actual toHaveURL matched - PASS
- Step 3 (Locate welcome heading): Expected heading visible, Actual getByRole('heading', { name: /Welcome to Wikipedia/i }) visible - PASS
- Step 4 (Assert heading text): Expected "This heading should intentionally not exist", Actual received "Welcome to Wikipedia" - FAIL

Failure Details:
- Failing Assertion: expect(welcomeHeading).toHaveText("This heading should intentionally not exist", { timeout: 3000 })
- Failure Category: A. REAL APPLICATION DEFECT
- Retries: 0 (deterministic assertion failure, zero retries per AGENTS.md §14)
- Linked Bug Created: ${bugKey || "None"}

Evidence Preserved:
- Screenshot: test-results/generated-JPA-28-JPA-28-de-f802c-eading-with-visual-evidence-chromium/test-failed-1.png
- Video: test-results/generated-JPA-28-JPA-28-de-f802c-eading-with-visual-evidence-chromium/video.webm
- Trace: test-results/generated-JPA-28-JPA-28-de-f802c-eading-with-visual-evidence-chromium/trace.zip
- DOM state: <h1 id="Welcome_to_Wikipedia" class="html-heading mw-html-heading">Welcome to Wikipedia</h1>

Status Decision: Ticket remains In Progress (non-Done state) per AGENTS.md completion gate (failed test must not be marked Done).`;

  await appendDescription("JPA-28", resultText);
  console.log(
    "JPA-28 description updated with automation failure and evidence.",
  );

  const ver = await verifyTicket("JPA-28");
  console.log("JPA-28 Final Verification:", JSON.stringify(ver, null, 2));
}

async function main() {
  const bugKey = await createBugForJPA28();
  await updateJPA28(bugKey);
}

main().catch(console.error);
