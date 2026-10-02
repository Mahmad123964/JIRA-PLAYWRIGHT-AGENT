import { test, expect } from "@playwright/test";
import { generateAutomation } from "../../src/automation-generator";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";

const exploration: ExplorationResult = {
  target: { url: "https://example.com", module: "Auth", scope: "Login", requirements: ["Login works"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: ["https://example.com"], elements: [], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false,
};
const tc: TestCase = { testCaseId: "TC-1", title: "Login", objective: "Login", preconditions: [], testData: "valid", steps: [{ step: 1, action: "Click login", expected: "Login control is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Login' })" }], expectedResult: "Login succeeds", priority: "High", testType: "Functional", module: "Auth", sourceRequirements: ["Login works"], explorationReferences: [], assumptions: [], risks: [], status: "READY_FOR_AUTOMATION", automationEligibility: "ELIGIBLE", sources: [{ type: "requirement", requirement: "Login works" }], generatedAt: new Date().toISOString() };

test("automation generator blocks unknown selector and writes safe files for ready cases", () => {
  const result = generateAutomation({ testCases: [tc], explorationResult: exploration, outputRoot: "test-results/automation-fixture" });
  expect(result.status).toBe("SUCCESS");
  expect(result.generated.some((file) => file.kind === "pom")).toBe(true);
  expect(result.generated.some((file) => file.kind === "spec")).toBe(true);
});

test("automation generator never accepts pending approval", () => {
  expect(generateAutomation({ testCases: [{ ...tc, status: "PENDING_APPROVAL" }], explorationResult: exploration }).status).toBe("BLOCKED");
});
