import { test, expect } from "@playwright/test";
import { generateTestCases, type GeneratorInput } from "../../src/test-case-generator";
import type { ExplorationResult } from "../../src/browser-explorer";

function input(overrides: Partial<GeneratorInput> = {}): GeneratorInput {
  const url = "https://example.com/login";
  const element = {
    id: "E-BUTTON",
    type: "button",
    role: "button",
    name: "Login",
    selectorCandidates: ["getByRole('button', { name: 'Login' })"],
    url,
    source: "browser-exploration" as const,
  };
  const heading = {
    id: "E-HEADING",
    type: "heading",
    role: "heading",
    name: "Welcome back",
    selectorCandidates: ["getByRole('heading', { name: 'Welcome back' })"],
    url,
    source: "browser-exploration" as const,
  };
  const exploration: ExplorationResult = {
    target: { url, module: "Authentication", scope: "Login", requirements: [] },
    status: "SUCCESS",
    explorationStatus: "SUCCESS",
    exploredAt: new Date().toISOString(),
    pagesVisited: [url],
    elements: [element, heading],
    workflows: [],
    observations: [{ id: "OBS-HEADING", type: "element-found", description: "Captured heading text: Welcome back", url, detail: "Welcome back" }],
    requirementsCoverage: [], warnings: [], provenance: [{ url, pageTitle: "Login", visitedAt: new Date().toISOString(), elementCount: 2 }],
    secretsMaskedCount: 0, promptInjectionDetected: false,
  };
  return { requirements: ["User can log in"], explorationResult: exploration, module: "Authentication", scope: "Login", ...overrides };
}

test("discovered button gets a verified visible assertion and provenance", () => {
  const result = generateTestCases(input({ requirements: ["User can click Login"] }));
  const step = result.testCases.find((tc) => tc.title.startsWith("[Positive]"))!.steps.find((item) => item.sourceElementId === "E-BUTTON")!;
  expect(step.expectedAssertion).toEqual({ type: "visible" });
  expect(step.selectorHint).toBe("getByRole('button', { name: 'Login' })");
  expect(step.assertionProvenance?.[0].observationId).toBe("E-BUTTON");
});

test("captured heading gets exact text assertion", () => {
  const result = generateTestCases(input({ requirements: ["Welcome back is displayed"] }));
  const step = result.testCases.find((tc) => tc.title.startsWith("[Positive]"))!.steps.find((item) => item.sourceElementId === "E-HEADING");
  expect(step?.expectedAssertion).toEqual({ type: "text", value: "Welcome back" });
});

test("unverifiable expectation is flagged without an assertion", () => {
  const result = generateTestCases(input({ requirements: ["Invalid credentials show an error message"] }));
  const steps = result.testCases.flatMap((tc) => tc.steps);
  expect(steps.some((step) => step.needsHumanInput?.startsWith("NEEDS_HUMAN_INPUT"))).toBe(true);
  expect(steps.filter((step) => step.needsHumanInput).every((step) => !step.expectedAssertion)).toBe(true);
});

test("generator reports executable and flagged step ratio", () => {
  const result = generateTestCases(input({ requirements: ["User can click Login", "Invalid credentials show an error message"] }));
  const summary = result.coverageSummary.stepSummary;
  expect(summary.total).toBeGreaterThan(0);
  expect(summary.executable + summary.flagged).toBe(summary.total);
  expect(summary.executableRatio).toBe(summary.executable / summary.total);
});
