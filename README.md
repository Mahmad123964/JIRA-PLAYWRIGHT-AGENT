# JIRA Playwright QA Automation Agent

## 📌 Overview

This project is a QA automation agent that connects **Jira, Codex, Jira REST API, and Playwright MCP**.

The purpose of this project is to automate the QA workflow from a Jira ticket to an automated Playwright test and then update the Jira ticket with the test result.

---

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

````text
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

Run the generated test:

npx playwright test tests/generated/JPA-1.spec.ts

Run all tests:

npx playwright test
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
Automate multiple Jira tickets.
Improve handling of dynamic websites.
Add screenshots on test failure.
Add better retry/recovery logic.
Integrate CI/CD.
Generate automated test reports.
Improve autonomous Jira task processing.
👨‍💻 Project Status
Component	Status
Jira REST API	✅
.env configuration	✅
.gitignore	✅
Codex workflow	✅
Playwright	✅
Playwright MCP	✅
JPA-1 test generation	✅
JPA-1 test execution	✅
Jira update	✅
Jira transition to Done	✅
🎥 Demonstration

A screen recording demonstrates the complete JPA-1 workflow from Jira task processing to Playwright test execution and Jira completion.


### Bas itna.

**README ko abhi aur complicated mat karo.** Ye GitHub par sir ko project samajhne ke liye enough hai.

Save karo:

**`Ctrl + S`**

Phir terminal mein:

```powershell
git add README.md
git status
````
