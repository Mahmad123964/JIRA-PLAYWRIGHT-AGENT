import { test, expect } from "@playwright/test";
import { createDefect, selectJiraEligibleFailure, type DefectInput, type JiraDefectClient } from "../../src/jira-defects";

const input: DefectInput = { projectKey: "QA", sourceIssueKey: "TC-A", summary: "Broken behavior", requirement: "Expected result", expected: "Expected", actual: "Actual", environment: "test", runId: "run-1", evidence: "masked.log" };
function client(overrides: Partial<JiraDefectClient> = {}): JiraDefectClient { return { search: async () => [], createIssue: async () => ({ key: "QA-1" }), getIssue: async (key) => ({ key }), linkIssues: async () => { }, addComment: async () => { }, ...overrides }; }

test("dry-run returns WOULD_CREATE without mutation", async () => {
    let created = false;
    const mockClient = client({
        createIssue: async () => {
            created = true;
            return { key: "QA-1" };
        },
    });
    const result = await createDefect(input, mockClient);
    expect(result.status).toBe("WOULD_CREATE");
    expect(result.dryRun).toBe(true);
    expect(created).toBe(false);
});
test("duplicate returns WOULD_LINK_EXISTING in dry-run", async () => { const result = await createDefect(input, client({ search: async () => [{ key: "QA-9" }] })); expect(result.status).toBe("WOULD_LINK_EXISTING"); expect(result.bugKey).toBe("QA-9"); });
test("only category A is eligible", () => { expect(selectJiraEligibleFailure({ diagnosis: { category: "A. REAL APPLICATION DEFECT" } })).toBe(true); for (const category of ["B. AUTOMATION / TEST IMPLEMENTATION ISSUE", "C. ENVIRONMENT / INFRASTRUCTURE ISSUE", "D. FLAKY / TRANSIENT FAILURE", "E. BLOCKED / MISSING REQUIREMENT"]) expect(selectJiraEligibleFailure({ diagnosis: { category } })).toBe(false); });
test("verification failure is UNCONFIRMED", async () => { const result = await createDefect(input, client({ getIssue: async () => { throw new Error("verification unavailable"); } }), { createReal: true }); expect(result.status).toBe("UNCONFIRMED"); });
test("unconfigured Jira is UNAVAILABLE for real mode", async () => { const result = await createDefect(input, undefined, { createReal: true }); expect(result.status).toBe("UNAVAILABLE"); });

test("unconfigured Jira dry-run returns a non-mutating WOULD_CREATE plan", async () => { const result = await createDefect(input); expect(result.status).toBe("WOULD_CREATE"); expect(result.dryRun).toBe(true); });
