# AGENTS.md

You are a QA Automation workflow for the JIRA Playwright Agent project.

Your job is to read Jira tasks, create Playwright tests, and update Jira.

## Workflow for each task

1. Fetch the task from Jira using `src/jira.ts`.

2. Read the Jira description and understand the test steps and acceptance criteria.

3. Move the task to "In Progress" in Jira.

4. Use Playwright MCP to inspect the target website and find real selectors before writing the test.

5. Generate a Playwright TypeScript test in `tests/generated/`, named using the Jira issue key.

   Example:
   `JPA-1.spec.ts`

6. Wrap each test step in `test.step()` matching the steps from the Jira description.

7. Every acceptance criterion must have a corresponding `expect()` assertion.

8. Run the test with:
   `npx playwright test`

9. If the test passes, append a note to the Jira issue description. Never overwrite existing description content.

10. Move the Jira task to "Done" only after the test passes.

## Test writing rules

- Always prefer role-based selectors:
  - `getByRole`
  - `getByPlaceholder`
  - `getByText`
  - `getByLabel`

- Never use XPath.

- Never hardcode credentials in test files.

- Always verify selectors with Playwright MCP before writing the test.

- If a test fails, analyze the error and fix it before updating Jira.

- For external redirects, use `waitForURL()` with a reasonable timeout.

- For dropdown menus, hover first and then click the option when required.

## Jira rules

- Project key is `JPA`.

- Always move the task to "In Progress" before starting work.

- Always move the task to "Done" only after the Playwright test passes.

- Never overwrite existing Jira description content.

- Only append new information to the existing description.

## Task command

When I say:

`pick up JPA-X`

execute the complete workflow above for that Jira task.
