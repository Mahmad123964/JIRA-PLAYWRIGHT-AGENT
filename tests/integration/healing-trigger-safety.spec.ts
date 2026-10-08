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
 * Guards the healing-trigger safety fix in src/automation-generator.ts's
 * renderSpec: the generated spec's try/catch must enter healing ONLY for a
 * genuine locator-not-found/empty signal, never for a plain assertion
 * mismatch where the locator resolved fine. The previous gate matched the
 * bare word "locator", which Playwright's own call log includes in almost
 * every role-based assertion failure (e.g. "waiting for getByRole(...)" /
 * "locator resolved to <h1>..."), so a genuine Expected/Received text
 * mismatch was still routed into a (harmless but incorrect) healing attempt.
 */

let server: ChildProcess;
const port = 4210;
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

test("(a) a plain assertion mismatch (toContainText) never calls healing", async () => {
  const heading = { id: "HEADING", type: "heading", role: "heading", name: "Welcome back", selectorCandidates: ["getByRole('heading', { name: 'Welcome back' })"], url, source: "browser-exploration" as const };
  const exploration: ExplorationResult = { target: { url, module: "TriggerSafety", scope: "Mismatch", requirements: ["Heading is correct"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url], elements: [heading], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
  // Locator resolves fine (role=heading name="Welcome back" exists); only the
  // text assertion fails. This must never reach healOnSamePage.
  const testCase: TestCase = { testCaseId: "TC-TRIGGER-MISMATCH", title: "Plain assertion mismatch", objective: "Healing must not trigger", preconditions: [], testData: "demo", steps: [{ step: 1, action: "Inspect heading", expected: "Wrong heading is displayed", expectedAssertion: { type: "text", value: "Wrong heading" }, selectorHint: "getByRole('heading', { name: 'Welcome back' })", sourceElementId: "HEADING" }], expectedResult: "Wrong heading is displayed", priority: "High", testType: "Functional", module: "TriggerSafety", sourceRequirements: ["Heading is correct"], explorationReferences: ["HEADING"], assumptions: [], risks: [], status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "HEADING", page: url }], generatedAt: new Date().toISOString() };
  const store = createApprovalStore("TriggerSafety", "Mismatch", [testCase], exploration);
  approveTestCase(store, testCase.testCaseId, "integration-reviewer");
  markReadyForAutomation(store, testCase.testCaseId);
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "integration-trigger-mismatch", captureArtifacts: false });
  removeScopedArtifacts(store.storeId);

  expect(result.execution?.failures?.length).toBe(1);
  expect((result.execution!.failures[0] as { diagnosis?: { category?: string } }).diagnosis?.category).toBe("A. REAL APPLICATION DEFECT");
  // The real assertion failure text (Expected/Received) must be present...
  expect(result.execution!.failures[0].error).toMatch(/Expected|Received/i);
  // ...and healing must never have been attempted for it.
  expect(result.healing).toHaveLength(0);
});

test("(b) toBeVisible on a removed element calls healing and ends NOT_HEALED", async () => {
  const removed = { id: "REMOVED", type: "button", role: "button", name: "Removed action", selectorCandidates: ["getByRole('button', { name: 'Removed action' })"], url, source: "browser-exploration" as const };
  const exploration: ExplorationResult = { target: { url, module: "TriggerSafety", scope: "Removed", requirements: ["Click removed action"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url], elements: [removed], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
  const testCase: TestCase = { testCaseId: "TC-TRIGGER-REMOVED", title: "Removed element", objective: "Healing must trigger and fail validation", preconditions: [], testData: "demo", steps: [{ step: 1, action: "Click removed action", expected: "Removed action is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Old Removed action' })", sourceElementId: "REMOVED" }], expectedResult: "Removed action is visible", priority: "High", testType: "Functional", module: "TriggerSafety", sourceRequirements: ["Click removed action"], explorationReferences: ["REMOVED"], assumptions: [], risks: [], status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "REMOVED", page: url }], generatedAt: new Date().toISOString() };
  const store = createApprovalStore("TriggerSafety", "Removed", [testCase], exploration);
  approveTestCase(store, testCase.testCaseId, "integration-reviewer");
  markReadyForAutomation(store, testCase.testCaseId);
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "integration-trigger-removed", captureArtifacts: false });
  removeScopedArtifacts(store.storeId);

  expect(result.healing).toHaveLength(1);
  expect(result.healing![0].outcome).toBe("NOT_HEALED");
});

test("(c) a broken locator with a role+name match heals to PASS_AFTER_HEALING", async () => {
  const login = { id: "LOGIN", type: "button", role: "button", name: "Login", selectorCandidates: ["getByRole('button', { name: 'Login' })"], url, source: "browser-exploration" as const };
  const exploration: ExplorationResult = { target: { url, module: "TriggerSafety", scope: "Heal", requirements: ["Click Login"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url], elements: [login], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
  const testCase: TestCase = { testCaseId: "TC-TRIGGER-HEAL", title: "Broken login locator", objective: "Healing must trigger and succeed", preconditions: [], testData: "demo", steps: [{ step: 1, action: "Click Login", expected: "Login is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Old Login' })", sourceElementId: "LOGIN" }], expectedResult: "Login is visible", priority: "High", testType: "Functional", module: "TriggerSafety", sourceRequirements: ["Click Login"], explorationReferences: ["LOGIN"], assumptions: [], risks: [], status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "LOGIN", page: url }], generatedAt: new Date().toISOString() };
  const store = createApprovalStore("TriggerSafety", "Heal", [testCase], exploration);
  approveTestCase(store, testCase.testCaseId, "integration-reviewer");
  markReadyForAutomation(store, testCase.testCaseId);
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "integration-trigger-heal", captureArtifacts: false });
  removeScopedArtifacts(store.storeId);

  expect(result.healing).toHaveLength(1);
  expect(result.healing![0].outcome).toBe("PASS_AFTER_HEALING");
});
