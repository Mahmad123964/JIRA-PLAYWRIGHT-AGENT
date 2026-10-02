import { test, expect } from "@playwright/test";
import { createDefect, type DefectInput } from "../../src/jira-defects";

test("fixture category-A defect produces a Jira dry-run plan without network mutation", async () => {
  const input: DefectInput = { projectKey: "QA", sourceIssueKey: "TC-DEMO-DEFECT", summary: "Demo application behavior mismatch", requirement: "Demo requirement", expected: "Expected demo behavior", actual: "Observed demo behavior", environment: "fixture-demo", url: "http://127.0.0.1:4191/", runId: "phase5-demo", evidence: "reports/phase5-demo/evidence.log" };
  const result = await createDefect(input);
  expect(result.status).toBe("WOULD_CREATE");
  expect(result.dryRun).toBe(true);
  expect(result.reason).toContain("dry-run");
});
