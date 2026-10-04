import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { createApprovalStore, saveApprovalStore, approveTestCase, markReadyForAutomation } from "../../src/approval-store";
import { runApprovedCases } from "../../src/approved-runner";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";
import { removeScopedArtifacts } from "./support/run-artifacts";

let server: ChildProcess;
const port = 4191;
const url = `http://127.0.0.1:${port}/`;

async function waitForDemoSite(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Demo site did not start");
}

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.resolve("fixtures/demo-site/server.js")], { env: { ...process.env, DEMO_SITE_PORT: String(port) }, stdio: "ignore" });
  await waitForDemoSite();
});
test.afterAll(() => { server.kill(); });

test("run-approved performs same-page healing and persists PASS_AFTER_HEALING", async () => {
  const login = { id: "LOGIN", type: "button", role: "button", name: "Login", selectorCandidates: ["getByRole('button', { name: 'Login' })"], url, source: "browser-exploration" as const };
  const exploration: ExplorationResult = { target: { url, module: "DemoHealing", scope: "Login", requirements: ["Click Login"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url], elements: [login], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
  const testCase: TestCase = { testCaseId: "TC-DEMO-HEAL", title: "Broken login locator", objective: "Validate healing", preconditions: [], testData: "demo", steps: [{ step: 1, action: "Click Login", expected: "Login is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Old Login' })", sourceElementId: "LOGIN" }], expectedResult: "Login is visible", priority: "High", testType: "Functional", module: "DemoHealing", sourceRequirements: ["Click Login"], explorationReferences: ["LOGIN"], assumptions: [], risks: [], status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "LOGIN", page: url }], generatedAt: new Date().toISOString() };
  const store = createApprovalStore("DemoHealing", "Login", [testCase], exploration);
  approveTestCase(store, testCase.testCaseId, "integration-reviewer");
  markReadyForAutomation(store, testCase.testCaseId);
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "integration-healing", captureArtifacts: false });
  removeScopedArtifacts(store.storeId);
  expect(result.resultPath).toBeTruthy();
  const saved = JSON.parse(fs.readFileSync(path.resolve(result.resultPath!), "utf8"));
  expect(saved.healing.some((item: { outcome: string }) => item.outcome === "PASS_AFTER_HEALING")).toBe(true);
  expect(saved.healing[0].attempts.length).toBeGreaterThan(0);
  expect(saved.execution.healing).toBeUndefined();
});

test("run-approved routes a real assertion failure to Jira dry-run defect output", async () => {
  const heading = { id: "HEADING", type: "heading", role: "heading", name: "Welcome back", selectorCandidates: ["getByRole('heading', { name: 'Welcome back' })"], url, source: "browser-exploration" as const };
  const exploration: ExplorationResult = { target: { url, module: "DemoDefect", scope: "Login", requirements: ["Heading is correct"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url], elements: [heading], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
  const testCase: TestCase = { testCaseId: "TC-DEMO-A", title: "Real assertion mismatch", objective: "Detect wrong heading", preconditions: [], testData: "demo", steps: [{ step: 1, action: "Inspect heading", expected: "Wrong heading is displayed", expectedAssertion: { type: "text", value: "Wrong heading" }, selectorHint: "getByRole('heading', { name: 'Welcome back' })", sourceElementId: "HEADING" }], expectedResult: "Wrong heading is displayed", priority: "High", testType: "Functional", module: "DemoDefect", sourceRequirements: ["Heading is correct"], explorationReferences: ["HEADING"], assumptions: [], risks: [], status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "HEADING", page: url }], generatedAt: new Date().toISOString() };
  const store = createApprovalStore("DemoDefect", "Login", [testCase], exploration);
  approveTestCase(store, testCase.testCaseId, "integration-reviewer");
  markReadyForAutomation(store, testCase.testCaseId);
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "integration-defect", captureArtifacts: false });
  removeScopedArtifacts(store.storeId);
  const saved = JSON.parse(fs.readFileSync(path.resolve(result.resultPath!), "utf8"));
  expect(saved.defects).toHaveLength(1);
  expect(saved.defects[0].status).toBe("WOULD_CREATE");
  expect(saved.defects[0].dryRun).toBe(true);
});

test("run-approved records removed-element healing rejection as FAIL for human review", async () => {
  const removed = { id: "REMOVED", type: "button", role: "button", name: "Removed action", selectorCandidates: ["getByRole('button', { name: 'Removed action' })"], url, source: "browser-exploration" as const };
  const exploration: ExplorationResult = { target: { url, module: "DemoRemoved", scope: "Removed", requirements: ["Click removed action"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url], elements: [removed], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
  const testCase: TestCase = { testCaseId: "TC-DEMO-REMOVED", title: "Removed element", objective: "Verify removed element is not silently healed", preconditions: [], testData: "demo", steps: [{ step: 1, action: "Click removed action", expected: "Removed action is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Old Removed action' })", sourceElementId: "REMOVED" }], expectedResult: "Removed action is visible", priority: "High", testType: "Functional", module: "DemoRemoved", sourceRequirements: ["Click removed action"], explorationReferences: ["REMOVED"], assumptions: [], risks: [], status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "REMOVED", page: url }], generatedAt: new Date().toISOString() };
  const store = createApprovalStore("DemoRemoved", "Removed", [testCase], exploration);
  approveTestCase(store, testCase.testCaseId, "integration-reviewer");
  markReadyForAutomation(store, testCase.testCaseId);
  saveApprovalStore(store);
  const result = await runApprovedCases({ storeId: store.storeId, runId: "integration-removed", captureArtifacts: false });
  removeScopedArtifacts(store.storeId);
  expect(result.resultPath).toBeTruthy();
  const saved = JSON.parse(fs.readFileSync(path.resolve(result.resultPath!), "utf8"));
  expect(saved.status).toBe("FAILED");
  expect(saved.healing[0].outcome).toBe("NOT_HEALED");
  expect(saved.healing[0].attempts[0].validationResult).toBe("FAIL");
  expect(saved.healing[0].reason).toContain("HUMAN_REVIEW_REQUIRED");
  expect(saved.execution.healing).toBeUndefined();
});
