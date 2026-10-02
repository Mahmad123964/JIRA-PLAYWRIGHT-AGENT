import { test, expect } from "@playwright/test";
import { normalizeRequirements } from "../../src/requirement-sources";
import { getIntegrationHealth } from "../../src/integration-health";
import { generateAutomation, validateAutomationInput } from "../../src/automation-generator";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";

const goodExploration: ExplorationResult = { target: { url: "https://example.com", module: "Auth", scope: "Login", requirements: ["Login works"] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: ["https://example.com"], elements: [], workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
const goodCase: TestCase = { testCaseId: "TC-1", title: "Login", objective: "Login", preconditions: [], testData: "fixture", steps: [{ step: 1, action: "Inspect login", expected: "Login control is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Login' })" }], expectedResult: "Login works", priority: "High", testType: "Functional", module: "Auth", sourceRequirements: ["Login works"], explorationReferences: [], assumptions: [], risks: [], status: "READY_FOR_AUTOMATION", automationEligibility: "ELIGIBLE", sources: [{ type: "manual", requirement: "Login works" }], generatedAt: new Date().toISOString() };

test("normalizes manual requirements without Jira", () => { const result = normalizeRequirements({ requirements: ["User can log in"] }); expect(result.requirements[0].source.type).toBe("manual"); expect(result.requirements[0].status).toBe("CONFIRMED"); });

test("detects material HTTP method conflicts", () => { const result = normalizeRequirements({ requirements: ["POST /users creates users", "GET /users lists users"] }); expect(result.conflicts).toHaveLength(1); expect(result.conflicts[0].material).toBe(true); });

test("reports optional integrations without blocking core", () => { const health = getIntegrationHealth(); expect(health.find((item) => item.name === "Core QA Engine")?.status).toBe("AVAILABLE"); expect(health.find((item) => item.name === "Jira")?.status).toBe("UNAVAILABLE"); });

test("requires explicit assertions in executable generated tests", () => { const result = validateAutomationInput({ testCases: [{ ...goodCase, steps: [{ ...goodCase.steps[0], expectedAssertion: undefined }] }], explorationResult: goodExploration }); expect(result.valid).toBe(false); expect(generateAutomation({ testCases: [goodCase], explorationResult: goodExploration, outputRoot: "test-results/generic-core" }).status).toBe("SUCCESS"); });
