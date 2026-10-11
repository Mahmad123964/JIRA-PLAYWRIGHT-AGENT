import { test, expect } from "@playwright/test";
import { computeAutomatable } from "../../src/test-case-generator";
import type { TestCase } from "../../src/test-case-generator";
import type { ExplorationResult } from "../../src/browser-explorer";
import { createApprovalStore, approveTestCase, markReadyForAutomation, editTestCase } from "../../src/approval-store";
import { importSkillOutput } from "../../src/skill-import";

function makeExploration(): ExplorationResult {
  return {
    target: { url: "https://example.com", module: "Auth", scope: "Login", requirements: ["Login works"] },
    status: "SUCCESS",
    explorationStatus: "SUCCESS",
    exploredAt: new Date().toISOString(),
    pagesVisited: ["https://example.com"],
    elements: [
      { id: "LOGIN", type: "button", role: "button", name: "Login", selectorCandidates: ["getByRole('button', { name: 'Login' })"], url: "https://example.com", source: "browser-exploration" },
    ],
    workflows: [],
    observations: [],
    requirementsCoverage: [],
    warnings: [],
    provenance: [],
    secretsMaskedCount: 0,
    promptInjectionDetected: false,
  };
}

function baseCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    testCaseId: "TC-AUTOMATABLE-1",
    title: "Login works",
    objective: "Verify login works",
    preconditions: [],
    testData: "demo",
    steps: [
      {
        step: 1,
        action: "Click Login",
        expected: "Login is visible",
        selectorHint: "getByRole('button', { name: 'Login' })",
        sourceElementId: "LOGIN",
        expectedAssertion: { type: "visible" },
        assertionProvenance: [{ type: "browser-exploration", observationId: "LOGIN", page: "https://example.com" }],
      },
    ],
    expectedResult: "Login is visible",
    priority: "High",
    testType: "Functional",
    module: "Auth",
    sourceRequirements: ["Login works"],
    explorationReferences: ["LOGIN"],
    assumptions: [],
    risks: [],
    status: "PENDING_APPROVAL",
    automationEligibility: "ELIGIBLE",
    automatable: "yes", // matches this fixture's fully verified default steps; computeAutomatable(exploration) agrees (see test 1)
    sources: [{ type: "browser-exploration", observationId: "LOGIN", page: "https://example.com" }],
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test.describe("computeAutomatable (Phase 8b automation bridge)", () => {
  test("1. verified selector + proven assertion => yes", () => {
    const exploration = makeExploration();
    const tc = baseCase();
    expect(computeAutomatable(tc, exploration)).toBe("yes");
  });

  test("2. missing assertion => needs-human-input", () => {
    const exploration = makeExploration();
    const tc = baseCase({
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible", selectorHint: "getByRole('button', { name: 'Login' })", sourceElementId: "LOGIN" }],
    });
    expect(computeAutomatable(tc, exploration)).toBe("needs-human-input");
  });

  test("3. missing selector (unverified) => needs-human-input", () => {
    const exploration = makeExploration();
    const tc = baseCase({
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible", expectedAssertion: { type: "visible" }, assertionProvenance: [{ type: "browser-exploration" }] }],
    });
    expect(computeAutomatable(tc, exploration)).toBe("needs-human-input");
  });

  test("4. Inferred QA Risk only => never yes, even with a verified selector but no assertion", () => {
    const exploration = makeExploration();
    const tc = baseCase({
      sources: [{ type: "manual-skill-import", requirement: "Inferred QA Risk" }],
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible", selectorHint: "getByRole('button', { name: 'Login' })", sourceElementId: "LOGIN" }],
    });
    // Has a verified target (selector resolves) but no assertion -> needs-human-input, not manual-only, and never yes.
    expect(computeAutomatable(tc, exploration)).toBe("needs-human-input");
  });

  test("4b. Inferred QA Risk with no verified UI target at all => manual-only, never yes", () => {
    const exploration = makeExploration();
    const tc = baseCase({
      sources: [{ type: "manual-skill-import", requirement: "Inferred QA Risk" }],
      steps: [{ step: 1, action: "Leave session idle", expected: "Session expires" }],
    });
    expect(computeAutomatable(tc, exploration)).toBe("manual-only");
  });

  test("4c. Inferred QA Risk case becomes eligible once it gains a verified selector and proven assertion", () => {
    const exploration = makeExploration();
    const tc = baseCase({ sources: [{ type: "manual-skill-import", requirement: "Inferred QA Risk" }] });
    // Same steps as test 1 (fully verified) -- even an Inferred QA Risk tag doesn't block "yes" once evidence exists.
    expect(computeAutomatable(tc, exploration)).toBe("yes");
  });

  test("5. imported manual case (8a) => never yes", () => {
    const text = [
      "| Test Case ID | Module / Feature | Test Scenario | Test Steps | Expected Result | Priority |",
      "|---|---|---|---|---|---|",
      "| TC-IMPORT-001 | Login | Valid login succeeds | Enter valid credentials and click Login | User is redirected | High |",
    ].join("\n");
    const result = importSkillOutput(text, "Login");
    expect(result.accepted.length).toBe(1);
    expect(result.accepted[0].automatable).not.toBe("yes");
    expect(["needs-human-input", "manual-only"]).toContain(result.accepted[0].automatable);
  });

  test("6. edit recomputes automatable: adding a verified selector+assertion flips needs-human-input to yes", () => {
    const exploration = makeExploration();
    const tc = baseCase({
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible" }],
      automatable: "needs-human-input",
    });
    const store = createApprovalStore("Auth", "Login", [tc], exploration);
    expect(store.testCases[0].automatable).toBe("needs-human-input");

    const editResult = editTestCase(store, tc.testCaseId, "reviewer", {
      steps: [{
        step: 1,
        action: "Click Login",
        expected: "Login is visible",
        selectorHint: "getByRole('button', { name: 'Login' })",
        sourceElementId: "LOGIN",
        expectedAssertion: { type: "visible" },
        assertionProvenance: [{ type: "browser-exploration", observationId: "LOGIN" }],
      }],
    });
    expect(editResult.success).toBe(true);
    expect(store.testCases[0].automatable).toBe("yes");
    expect(store.testCases[0].status).toBe("PENDING_APPROVAL");
  });

  test("6b. edit recomputes automatable: removing the assertion flips yes back to needs-human-input", () => {
    const exploration = makeExploration();
    const tc = baseCase();
    const store = createApprovalStore("Auth", "Login", [tc], exploration);
    expect(store.testCases[0].automatable).toBe("yes");

    editTestCase(store, tc.testCaseId, "reviewer", {
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible", selectorHint: "getByRole('button', { name: 'Login' })", sourceElementId: "LOGIN" }],
    });
    expect(store.testCases[0].automatable).toBe("needs-human-input");
  });

  test("6c. a caller cannot hand-set automatable through editTestCase -- it is always recomputed", () => {
    const exploration = makeExploration();
    const tc = baseCase({
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible" }],
    });
    const store = createApprovalStore("Auth", "Login", [tc], exploration);
    editTestCase(store, tc.testCaseId, "reviewer", { automatable: "yes" } as Partial<TestCase>);
    expect(store.testCases[0].automatable).toBe("needs-human-input");
  });

  test("7. READY_FOR_AUTOMATION is refused for a non-yes case, naming the reason", () => {
    const exploration = makeExploration();
    const tc = baseCase({
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible" }],
      automatable: "needs-human-input",
    });
    const store = createApprovalStore("Auth", "Login", [tc], exploration);
    expect(store.testCases[0].automatable).toBe("needs-human-input");

    approveTestCase(store, tc.testCaseId, "reviewer");
    expect(store.testCases[0].status).toBe("APPROVED");

    const result = markReadyForAutomation(store, tc.testCaseId);
    expect(result.success).toBe(false);
    expect(result.error).toContain('automatable is "needs-human-input"');
    expect(result.error).toContain("not \"yes\"");
    expect(store.testCases[0].status).toBe("APPROVED"); // unchanged
  });

  test("7b. READY_FOR_AUTOMATION succeeds once automatable is yes", () => {
    const exploration = makeExploration();
    const tc = baseCase();
    const store = createApprovalStore("Auth", "Login", [tc], exploration);
    approveTestCase(store, tc.testCaseId, "reviewer");
    const result = markReadyForAutomation(store, tc.testCaseId);
    expect(result.success).toBe(true);
    expect(store.testCases[0].status).toBe("READY_FOR_AUTOMATION");
  });

  test("8. a case requiring visual/subjective judgment is manual-only even with verified evidence", () => {
    const exploration = makeExploration();
    const tc = baseCase({ title: "Visual layout looks correct on mobile" });
    expect(computeAutomatable(tc, exploration)).toBe("manual-only");
  });
});
