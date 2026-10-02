import { test, expect } from "@playwright/test";
import { generateAutomation, validateAutomationInput } from "../../src/automation-generator";
import { classifyFailure } from "../../src/failure-classifier";
import { healLocator, rankHealingCandidates } from "../../src/locator-healing";
import { discoverRegressionTests, discoverSmokeTests } from "../../src/test-discovery";
import { scanSecrets, verifyArtifact } from "../../src/security-audit";
import { createQaReport, renderReportText } from "../../src/qa-report";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";

function exploration(status: ExplorationResult["explorationStatus"] = "SUCCESS"): ExplorationResult {
  return {
    target: { url: "https://example.com", module: "Auth", scope: "Login", requirements: ["User can log in"] },
    status: status === "SUCCESS" ? "SUCCESS" : "ERROR",
    explorationStatus: status,
    exploredAt: new Date().toISOString(), pagesVisited: ["https://example.com"],
    elements: [{ id: "ELEM-1", type: "button", role: "button", name: "Login", dataTestId: "login", selectorCandidates: ["getByTestId('login')"], url: "https://example.com", source: "browser-exploration" }],
    workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false,
  };
}

function testCase(status: TestCase["status"] = "READY_FOR_AUTOMATION"): TestCase {
  return {
    testCaseId: "TC-AUTH-001", title: "Login", objective: "Verify login", preconditions: [], testData: "No secrets", steps: [{ step: 1, action: "Click Login", expected: "Login action is triggered", selectorHint: "getByTestId('login')", sourceElementId: "ELEM-1" }], expectedResult: "User can log in", priority: "High", testType: "Functional", module: "Auth", sourceRequirements: ["User can log in"], explorationReferences: ["ELEM-1"], assumptions: [], risks: [], status, automationEligibility: "ELIGIBLE", sources: [{ type: "requirement", requirement: "User can log in" }], generatedAt: new Date().toISOString(),
  };
}

test.describe("Remaining autonomous QA pipeline components", () => {
  test("blocks automation when exploration failed", () => {
    const tc = testCase();
    const result = validateAutomationInput({ testCases: [tc], explorationResult: exploration("FAILED") });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("manual verification");
    expect(generateAutomation({ testCases: [tc], explorationResult: exploration("FAILED") }).status).toBe("BLOCKED");
  });

  test("rejects non-ready approval states", () => {
    const result = validateAutomationInput({ testCases: [testCase("PENDING_APPROVAL")], explorationResult: exploration() });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("only READY_FOR_AUTOMATION");
  });

  test("classifies browser absence as infrastructure", () => {
    const result = classifyFailure({ message: "browserType.launch: Executable doesn't exist", browserUnavailable: true });
    expect(result.category).toBe("C. ENVIRONMENT / INFRASTRUCTURE ISSUE");
    expect(result.bugEligible).toBe(false);
  });

  test("ranks and validates deterministic locator healing candidates", () => {
    const candidates = rankHealingCandidates("getByRole('button', { name: 'Submit' })", exploration().elements, "Login");
    expect(candidates[0].selector).toBe("getByTestId('login')");
    const decision = healLocator("old", exploration().elements, "Login", 0.8, 1, () => true);
    expect(decision.status).toBe("HEALED");
    expect(decision.validationResult).toBe("PASS");
  });

  test("discovers regression tests dynamically and does not invent smoke tests", () => {
    const regression = discoverRegressionTests();
    expect(regression.paths.every((file) => file.endsWith(".spec.ts"))).toBe(true);
    const smoke = discoverSmokeTests(process.cwd(), []);
    expect(smoke.paths).toEqual([]);
    expect(smoke.warnings[0]).toContain("No smoke tests");
  });

  test("secret scan fails contaminated evidence and verifies artifacts honestly", () => {
    const scan = scanSecrets([{ path: "fixture", content: "Authorization: Bearer abcdefghijk" }]);
    expect(scan.status).toBe("FAIL");
    expect(verifyArtifact("definitely-not-generated.file").status).toBe("UNAVAILABLE");
  });

  test("final report preserves blocked status", () => {
    const report = createQaReport({ runId: "run-test", environment: "test", status: "BLOCKED", sections: { execution: { blocked: 1 } }, auditTrail: [] });
    expect(report.status).toBe("BLOCKED");
    expect(renderReportText(report)).toContain("Status: BLOCKED");
  });
});
