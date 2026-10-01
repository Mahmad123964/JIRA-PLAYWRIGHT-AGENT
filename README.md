# Generic Playwright QA Automation Agent
A requirements-driven Playwright QA agent with a human approval gate; Jira is optional.

> **Current verified status:** The Phases 1–5 status below is authoritative. Project History is historical context, not a claim of current end-to-end behavior.

## 1. What this agent does
The agent explores a supplied website, generates test cases from requirements and observed UI, waits for human approval, generates TypeScript Page Objects and Playwright specs for eligible ready cases, executes them, validates eligible locator repairs on the same page, classifies failures, and produces JSON and PDF reports. The optional Jira defect path is dry-run by default. The initial `qa` command stops at approval; use the separate commands below to continue.

## 2. How to run it
Install dependencies with `npm install` and the browser with `npx playwright install chromium`. Run commands from the repository root; use `--` before script arguments.

```powershell
npm run explore --url "<url>" --module "<module>" --scope "<scope>" --requirement "<requirement>" --output "exploration.json"
```
Explore the site and save observed pages, controls, locator candidates and provenance.

```powershell
npm run generate-tests --exploration "exploration.json" --output "generated.json"
npm run generate-tests --exploration "exploration.json" --requirement "<requirement>" --human-outcome "<requirement>|text|<human-supplied exact text>" --output "generated.json"
```
Generate `PENDING_APPROVAL` cases and print flagged steps. Human outcome syntax is `<requirement>|visible|<value>`, `<requirement>|text|<value>` or `<requirement>|url|<value>`; the generator does not infer the value. The output includes the approval store ID.

```powershell
npm run approve-tests -- approve --store "<store-id>" --id "<test-case-id>" --reviewer "human" --comment "Reviewed"
npm run approve-tests -- ready --store "<store-id>"
```
Human review is required. Only approved cases can become `READY_FOR_AUTOMATION`; editing invalidates approval and returns a case to `PENDING_APPROVAL`.

```powershell
npm run-approved --store "<store-id>" --run-id "<run-id>"
```
Generate and execute eligible ready cases; record classified failures, evidence and eligible healing in `reports/<run-id>/approved-run-result.json`. Cases missing evidence or assertions remain blocked.

```powershell
npm run report-final --run-id "<run-id>"
```
Aggregate the approved-run output into `reports/<run-id>/final-report.json` and `reports/<run-id>/qa-report.pdf`.

```powershell
npm run defect-dry-run --run-id "<run-id>" --test-case "<test-case-id>"
```
Write a dry-run defect plan without creating a Jira issue. The separate `run-approved` path also routes eligible category-A failures to a dry-run result.

```powershell
npm run demo-site
npm run typecheck
npm run lint
```
Serve the local fixture site; run TypeScript validation; run the targeted forbidden-pattern check. The fixture's scripted approval helper is demo-only, not a production approval path.

## 3. Status table
| Capability | Status |
| --- | --- |
| Website exploration | IMPLEMENTED |
| Test-case generation | IMPLEMENTED |
| Human approval gate | IMPLEMENTED |
| `expectedAssertion`: verified observations | IMPLEMENTED |
| `expectedAssertion`: human-supplied outcomes | IMPLEMENTED |
| `expectedAssertion`: unverifiable outcomes flagged | IMPLEMENTED |
| POM/Playwright spec generation | IMPLEMENTED for eligible ready cases |
| Test execution | IMPLEMENTED for focused approved cases |
| Failure classification A–E | IMPLEMENTED; evidence-based confirmation remains necessary |
| Validated same-page locator healing with re-execution | IMPLEMENTED for eligible locator failures |
| Final JSON report aggregation | IMPLEMENTED for approved-run output |
| PDF report | PARTIAL — structured text-based renderer, not rich layout |
| Jira defect sink, dry-run | IMPLEMENTED; no real issue created |
| Jira defect sink, real creation | PARTIAL — injected client and explicit opt-in path, not verified against live Jira |
| Smoke test wiring | PARTIAL — discovery exists; automatic config-driven runs are not wired |
| Regression test wiring | PARTIAL — discovery exists; automatic config-driven runs are not wired |
| Packaged end-to-end demo script (Phase 7) | NOT STARTED |
| Phase 6 automatic smoke/regression wiring | NOT STARTED |

Earlier phase verification reported 125 passing unit tests and 152 discovered tests in 39 files. These are historical run counts, not a claim about a fresh run.

## 4. Known limitations
- Executable-vs-flagged assertion coverage on the real local fixture was **1/8 = 12.5%** before human-supplied outcomes. Other sites and requirements can differ.
- Healing only repairs locator-not-found or locator-empty failures. It never heals assertion failures, and never heals without a live role/name match. This is intentional.
- Jira real creation is off by default and requires an explicitly supplied Jira client plus `createReal: true`; no live creation was verified.
- Smoke and regression discovery are not wired into automatic config-driven runs (Phase 6 not started).
- No packaged end-to-end demo script exists (Phase 7 not started). The local fixture and integration tests are separate.
- `npm run lint` is a targeted check for `waitForTimeout`, `nth()` and XPath, **not** ESLint with TypeScript coverage.
- The PDF renderer is text-based and limited; it is not a rich paginated layout engine.
- Evidence paths are checked; a missing artifact is reported as missing, not proof of a passing run. No real Jira issue creation has been validated.

## 5. Architecture overview
- `src/qa-pipeline.ts` — normalizes requirements, explores, generates cases and stops at the approval gate.
- `src/approval-store.ts` — persists cases and enforces approval states.
- `src/test-case-generator.ts` — creates cases, assertions, provenance, flags and coverage counts.
- `src/automation-generator.ts` — generates TypeScript Page Objects and Playwright specs from eligible ready cases.
- `src/execution-engine.ts` — invokes Playwright and captures execution and evidence metadata.
- `src/validated-healing.ts` — bounds and validates candidate locator repairs.
- `src/healing-runtime.ts` — validates/reruns repairs in the original Playwright page context.
- `src/approved-runner.ts` — connects approved cases to generation, execution, healing and defect dry-runs.
- `src/final-report.ts` — aggregates run data, verifies evidence paths and saves sanitized JSON.
- `src/jira-defects.ts` — handles optional defect fingerprints, dry-run and injected Jira client operations.

---

## Project History
The original Jira/JPA workflow below is historical and superseded by the verified status table above.

## 🔄 Project Workflow

The agent follows this workflow:

Jira Ticket
↓
Read Jira Task
↓
Move Ticket to In Progress
↓
Inspect Website using Playwright MCP
↓
Find and Verify Real Selectors
↓
Generate Playwright Test
↓
Run Test
↓
Fix Test if Failed
↓
Append Test Result to Jira
↓
Move Ticket to Done

---

## 🛠️ Technologies Used

- Codex
- Jira
- Jira REST API v3
- Playwright
- Playwright MCP
- TypeScript
- Node.js
- Axios
- dotenv
- Git
- GitHub

---

## 📁 Project Structure

```text
JIRA-PLAYWRIGHT-AGENT/
│
├── .gitignore
├── AGENTS.md
├── package.json
├── package-lock.json
├── playwright.config.ts
│
├── jira-client.js
├── test-browser.js
├── test-jira.js
│
├── src/
│   └── jira.ts
│
└── tests/
    └── generated/
        └── JPA-1.spec.ts
```

🔐 Environment Variables

Jira credentials are stored in a local .env file.

JIRA_BASE_URL=https://your-site.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token

The .env file is included in .gitignore and is not uploaded to GitHub.

Credentials are never hardcoded in the source code.

🔌 Jira API Integration

The Jira integration is implemented in:

src/jira.ts

It provides four main functions:

getTodoTasks(projectKey)

Finds Jira issues with To Do status using JQL.

getTaskDescription(issueKey)

Gets a Jira issue description and converts Jira's ADF format into plain text.

moveTask(issueKey, transitionName)

Gets available Jira transitions and moves an issue to the requested status.

Example:

To Do → In Progress
In Progress → Done
updateDescription(issueKey, appendText)

Adds test execution results to the existing Jira description without overwriting the existing content.

🤖 AGENTS.md

AGENTS.md contains the instructions for the Codex QA automation workflow.

The agent is instructed to:

Fetch a Jira task.
Read its description.
Move it to In Progress.
Inspect the website using Playwright MCP.
Verify real selectors.
Generate a Playwright test.
Run the test.
Fix failures if required.
Append the test result to Jira.
Move the Jira task to Done after a successful test.

The intended final interaction is:

pick up JPA-X

The agent should then perform the workflow automatically.

🎭 Playwright MCP

Playwright MCP allows Codex to interact with a real browser.

It is used to:

Open websites
Inspect pages
Find elements
Verify selectors
Click elements
Enter text
Navigate pages

The agent verifies selectors against the real website before generating the test.

🧪 Generated Tests

Generated Playwright tests are stored in:

tests/generated/

Example:

tests/generated/JPA-1.spec.ts

The tests use role-based Playwright locators such as:

page.getByRole()
page.getByPlaceholder()
page.getByText()
page.getByLabel()

XPath is not used.

✅ JPA-1 Demonstration

JPA-1 was created to test YouTube search functionality.

The generated test:

tests/generated/JPA-1.spec.ts

performs these actions:

Opens YouTube.
Locates the search input.
Enters Playwright testing.
Submits the search.
Verifies the search results URL.
Verifies the page title.
Verifies relevant search results content.
Test Result
1 passed

The Jira task was then:

To Do
   ↓
In Progress
   ↓
Test Generated
   ↓
Test Passed
   ↓
Jira Description Updated
   ↓
Done
⚠️ Real-World Failure Handling

During JPA-2 testing, the YouTube homepage did not contain visible video links in the Playwright browser session.

The agent did not invent a selector or create a false test.

Instead, it reported that the workflow was blocked.

This demonstrates that the agent validates the real application state before generating automation.

▶️ Run the Project

Install dependencies:

npm install

Install Playwright browser:

npx playwright install chromium
If exploration or execution reports `PLAYWRIGHT_BROWSER_NOT_INSTALLED`, run `npx playwright install` and retry. This is an environment/infrastructure block, not an application defect.

Run the generated test:

npx playwright test tests/generated/JPA-1.spec.ts

Run all tests:

npx playwright test
## Generic Autonomous QA Agent
The core engine is platform-independent. Jira, Notion, Slack, and GitHub are optional providers; manual requirements and local files work without them. The current implementation supports browser exploration, structured test-case generation, human approval, deterministic POM/spec scaffolding, basic Playwright runner result capture, failure classification, evidence verification, regression discovery, smoke discovery, JSON reporting, PDF export, source normalization, provenance, HTTP-method conflict detection, and an approval-gated pipeline. Jira defect creation is an injected adapter boundary, self-healing is explicitly labeled heuristic candidate ranking, and the end-to-end pipeline stops at the human approval gate unless approved cases are supplied to later stages.

### Generic requirements and optional integrations
```powershell
npm run qa --url "https://example.com" --module "Authentication" --scope "Login" --requirement "User can log in"
npm run qa --url "https://example.com" --module "Authentication" --scope "Login" --spec "./specs/auth.md"
npm run qa --url "https://example.com" --module "Authentication" --scope "Login" --spec "./specs/auth.json"
```

Supported local source extensions are Markdown/TXT, JSON, YAML, and PDF. PDF extraction preserves page provenance through the asynchronous requirement loader. Optional integrations report `AVAILABLE` only when their configuration is present; otherwise they remain `UNAVAILABLE` and do not block the core engine. Configure `QA_ENVIRONMENT`, `BASE_URL`, `SELF_HEALING_MIN_CONFIDENCE`, and `MAX_HEAL_ATTEMPTS` as non-secret runtime settings. Jira variables such as `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `JIRA_PROJECT_KEY` are optional.

The core architecture is:

```text
Requirement providers → normalized generic requirements → exploration → test cases
→ human approval → READY_FOR_AUTOMATION → POM/spec generation → Playwright execution
→ classification → heuristic healing decision → evidence → generic report → optional PDF
```

Jira remains an adapter and must not be required for local or offline QA workflows.

### Phase 1: Explore a target
```powershell
npm run explore --url "https://example.com" --module "Authentication" --scope "Login and logout" --requirement "User can log in" --requirement "Invalid credentials show an error" --output "exploration.json"
```

The result is structured JSON containing the target and supplied requirements, visited pages, observed elements and semantic selector candidates, inferred workflows, requirement coverage, warnings, and per-page provenance. Exploration follows same-origin, scope-relevant links only, avoids destructive controls, and returns `BLOCKED / AUTH REQUIRED` when an authentication wall is observed without an authenticated session.

### Phase 2: Generate test cases
```powershell
npm run generate-tests --exploration "exploration.json" --jira-key "JPA-123" --output "generated-test-cases.json"
```

Requirements are taken from repeated `--requirement` flags when supplied; otherwise they are read from `exploration.target.requirements`. Generated cases preserve Jira/Notion/requirement provenance and browser observation references. Every case starts as `PENDING_APPROVAL`. Unknown or underspecified requirements are explicitly marked `UNKNOWN / REQUIRES CLARIFICATION`.

### Phase 3: Review and approve
```powershell
npm run approve-tests -- list
npm run approve-tests -- pending --store "<approval-store-id>"
npm run approve-tests -- show --store "<approval-store-id>"
npm run approve-tests -- approve --store "<approval-store-id>" --id "<test-case-id>" --reviewer "human" --comment "Approved for automation"
npm run approve-tests -- reject --store "<approval-store-id>" --id "<test-case-id>" --reviewer "human" --comment "Out of scope"
npm run approve-tests -- ready --store "<approval-store-id>"
```

Approval stores are saved under `test-cases/`. The state gate is explicit: `PENDING_APPROVAL` → `APPROVED` or `REJECTED`; edits invalidate prior approval and return the case to `PENDING_APPROVAL` while preserving an `EDITED` approval record. Rejected cases cannot be approved or automated. Reviewer comments and edited string fields are sanitized before persistence.

### Example exploration output
```json
{
  "target": {
    "url": "https://example.com/login",
    "module": "Authentication",
    "scope": "Login and logout",
    "requirements": ["User can log in", "Invalid credentials show an error"]
  },
  "status": "SUCCESS",
  "pagesVisited": ["https://example.com/login"],
  "elements": [{
    "id": "ELEM-0001",
    "type": "button",
    "role": "button",
    "name": "Login",
    "selectorCandidates": ["getByRole('button', { name: 'Login' })"],
    "url": "https://example.com/login",
    "source": "browser-exploration"
  }],
  "workflows": [],
  "observations": [],
  "requirementsCoverage": [],
  "warnings": [],
  "provenance": []
}
```

### Example generated test case
```json
{
  "testCaseId": "TC-AUTH-001",
  "title": "[Positive] User can log in",
  "objective": "Verify that: User can log in",
  "preconditions": ["Target URL is accessible: https://example.com/login"],
  "testData": "Valid test data as per requirement",
  "steps": [{
    "step": 1,
    "action": "Click \"Login\" button",
    "expected": "Action is triggered successfully",
    "selectorHint": "getByRole('button', { name: 'Login' })",
    "sourceElementId": "ELEM-0001"
  }],
  "expectedResult": "System behaves as specified: User can log in",
  "priority": "Medium",
  "testType": "Functional",
  "module": "Authentication",
  "sourceRequirements": ["User can log in"],
  "explorationReferences": ["ELEM-0001"],
  "assumptions": [],
  "risks": [],
  "status": "PENDING_APPROVAL"
}
```

### Example approval output
```json
{
  "approved": ["TC-AUTH-001"],
  "failed": [],
  "summary": {
    "total": 1,
    "pending": 0,
    "approved": 1,
    "rejected": 0,
    "edited": 0,
    "readyForAutomation": 0
  }
}
```

Only after a separate explicit `ready` command does an approved case become `READY_FOR_AUTOMATION`. POM/spec generation is available through `npm run generate-pom --input <json>`, execution through `npm run execute-tests -- <path.spec.ts>`, and deterministic locator ranking is available as a library. Jira defect creation requires an explicitly configured injected client; no live Jira mutation is performed by default. Regression and smoke commands discover only verified repository tests and never invent smoke flows. The current `heal` command reports that integration-specific observed elements and validation context are required; it does not silently mutate tests.

🔒 Security

Never commit:

.env

The .gitignore file protects:

node_modules/
.env
playwright-report/
test-results/
.playwright-mcp/
🚀 Future Improvements
Complete per-test Playwright JSON parsing and browser artifact orchestration.
Connect heuristic healing decisions to controlled re-execution with explicit validation.
Add production adapters for Jira, Notion, Slack, and GitHub behind generic interfaces.
Expand rich PDF rendering and final report aggregation.
Add configured smoke metadata and full offline end-to-end fixtures.
🎥 Demonstration

A screen recording demonstrates the complete JPA-1 workflow from Jira task processing to Playwright test execution and Jira completion.

The earlier emoji "Project Status" checklist that used to appear here was removed, because it contradicted the verified status table at the top of this file.
