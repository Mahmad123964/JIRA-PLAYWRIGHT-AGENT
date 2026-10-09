import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { createApprovalStore, saveApprovalStore, approveTestCase, markReadyForAutomation } from "../../src/approval-store";
import { runApprovedCases } from "../../src/approved-runner";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";
import { removeScopedArtifacts } from "./support/run-artifacts";

/**
 * Moved from tests/unit/approved-runner.spec.ts: this test spawns a real
 * nested Playwright process that executes the generated spec, which needs a
 * real, reachable target -- it previously navigated to https://example.com,
 * an external network dependency inside a suite documented as pure, fast and
 * requiring no prior artifacts (let alone the network). Replaced with the
 * local demo-site fixture, the same pattern every other integration test in
 * this directory already uses.
 */

let server: ChildProcess;
const port = 4211;
const url = `http://127.0.0.1:${port}/`;

async function waitForDemoSite(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Demo site did not start");
}

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.resolve("fixtures/demo-site/server.js")], { env: { ...process.env, DEMO_SITE_PORT: String(port) }, stdio: "ignore" });
  await waitForDemoSite();
});
test.afterAll(() => { server.kill(); });

function makeExploration(): ExplorationResult {
  return { target: { url, module: "Auth", scope: "Login", requirements: ["Login works"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url], elements: [], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
}
function makeCase(): TestCase {
  return {
    testCaseId: "TC-PENDING_APPROVAL",
    title: "Login",
    objective: "Login",
    preconditions: [],
    testData: "fixture",
    steps: [{ step: 1, action: "Inspect login", expected: "Login is visible", selectorHint: "getByRole('button', { name: 'Login' })", expectedAssertion: { type: "visible" } }],
    expectedResult: "Login works",
    priority: "High",
    testType: "Functional",
    module: "Auth",
    sourceRequirements: ["Login works"],
    explorationReferences: [],
    assumptions: [],
    risks: [],
    status: "PENDING_APPROVAL",
    automationEligibility: "ELIGIBLE",
    sources: [{ type: "requirement", requirement: "Login works" }],
    generatedAt: new Date().toISOString(),
  };
}

test("approved runner generates and executes only ready verified cases", async () => {
  const exploration = makeExploration();
  const store = createApprovalStore("Auth", "Login", [makeCase()], exploration);
  approveTestCase(store, "TC-PENDING_APPROVAL", "reviewer");
  markReadyForAutomation(store, "TC-PENDING_APPROVAL");
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "approved-ready-case", captureArtifacts: false });
  removeScopedArtifacts(store.storeId);

  expect(["SUCCESS", "FAILED", "BLOCKED", "PARTIAL"]).toContain(result.status);
  expect(result.approval.readyCaseIds).toEqual(["TC-PENDING_APPROVAL"]);
  expect(result.automation.generated.some((file) => file.kind === "spec")).toBe(true);
  expect(result.resultPath).toBeTruthy();
  expect(fs.existsSync(path.resolve(result.resultPath!))).toBe(true);
  // Against the real fixture, the Login button is genuinely visible: a real
  // per-test PASS, not just a non-crash outcome.
  expect(result.status).toBe("SUCCESS");
  expect(result.execution?.totals.passed).toBe(1);
});
