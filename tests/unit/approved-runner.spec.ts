import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { createApprovalStore, saveApprovalStore, approveTestCase, markReadyForAutomation } from "../../src/approval-store";
import { runApprovedCases } from "../../src/approved-runner";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";

function makeExploration(): ExplorationResult {
  return { target: { url: "https://example.com", module: "Auth", scope: "Login", requirements: ["Login works"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: ["https://example.com"], elements: [], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
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

test("approved runner generates and executes only ready verified cases", async () => {
  const exploration = makeExploration();
  const store = createApprovalStore("Auth", "Login", [makeCase("PENDING_APPROVAL")], exploration);
  approveTestCase(store, "TC-PENDING_APPROVAL", "reviewer");
  markReadyForAutomation(store, "TC-PENDING_APPROVAL");
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "approved-ready-case", outputRoot: "test-results/approved-runner", captureArtifacts: false });
  expect(["SUCCESS", "FAILED", "BLOCKED", "PARTIAL"]).toContain(result.status);
  expect(result.approval.readyCaseIds).toEqual(["TC-PENDING_APPROVAL"]);
  expect(result.automation.generated.some((file) => file.kind === "spec")).toBe(true);
  expect(result.resultPath).toBeTruthy();
  expect(fs.existsSync(path.resolve(result.resultPath!))).toBe(true);
});
