import { test, expect } from "@playwright/test";
import fs from "fs";
import { createApprovalStore, saveApprovalStore, approveTestCase, markReadyForAutomation } from "../../src/approval-store";
import { runApprovedCases } from "../../src/approved-runner";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";

// This URL is never actually dereferenced by either test below: both cases
// are blocked before execution reaches the generated spec (no READY case in
// the first, a missing expectedAssertion in the second), so no network call
// is made. A placeholder is used rather than a real external site (compare
// tests/integration/approved-runner-execution.spec.ts, which genuinely
// executes against the local fixture and needs a real, reachable target).
function makeExploration(): ExplorationResult {
  return { target: { url: "http://127.0.0.1:0/", module: "Auth", scope: "Login", requirements: ["Login works"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: ["http://127.0.0.1:0/"], elements: [], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
}
function makeCase(status: TestCase["status"], withAssertion = true): TestCase {
  const step: TestCase["steps"][number] = withAssertion
    ? {
      step: 1,
      action: "Inspect login",
      expected: "Login is visible",
      selectorHint: "getByRole('button', { name: 'Login' })",
      expectedAssertion: { type: "visible" },
    }
    : {
      step: 1,
      action: "Inspect login",
      expected: "Login is visible",
      selectorHint: "getByRole('button', { name: 'Login' })",
    };

  return {
    testCaseId: `TC-${status}`,
    title: "Login",
    objective: "Login",
    preconditions: [],
    testData: "fixture",
    steps: [step],
    expectedResult: "Login works",
    priority: "High",
    testType: "Functional",
    module: "Auth",
    sourceRequirements: ["Login works"],
    explorationReferences: [],
    assumptions: [],
    risks: [],
    status,
    automationEligibility: "ELIGIBLE",
    sources: [{ type: "requirement", requirement: "Login works" }],
    generatedAt: new Date().toISOString(),
  };
}

test("approved runner blocks when exploration is absent and does not approve cases", async () => {
  const store = createApprovalStore("Auth", "Login", [makeCase("PENDING_APPROVAL")]);
  const storePath = saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "approved-missing-exploration" });
  expect(result.status).toBe("BLOCKED");
  expect(result.approval.readyCaseIds).toEqual([]);
  expect(result.approval.blockedCases[0].reason).toContain("status");
  expect(fs.existsSync(storePath)).toBe(true);
});

test("approved runner lists READY cases missing expected assertions", async () => {
  const exploration = makeExploration();
  const store = createApprovalStore("Auth", "Login", [makeCase("PENDING_APPROVAL", false)], exploration);
  approveTestCase(store, "TC-PENDING_APPROVAL", "reviewer");
  markReadyForAutomation(store, "TC-PENDING_APPROVAL");
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "approved-missing-assertion" });
  expect(result.status).toBe("BLOCKED");
  expect(result.approval.blockedCases[0].reason).toContain("expectedAssertion");
});

// "approved runner generates and executes only ready verified cases" moved to
// tests/integration/approved-runner-execution.spec.ts: it spawns a real
// nested Playwright process that executes the generated spec, which needs a
// real, reachable target. It previously navigated to https://example.com --
// an external network dependency inside a suite documented as pure and fast
// with no network -- replaced there with the local demo-site fixture.
