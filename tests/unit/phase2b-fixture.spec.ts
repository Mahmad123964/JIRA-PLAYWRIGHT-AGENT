import { test, expect } from "@playwright/test";
import { generateTestCases, type GeneratorInput } from "../../src/test-case-generator";
import type { ExplorationResult } from "../../src/browser-explorer";

function fixtureInput(): GeneratorInput {
  const url = "http://127.0.0.1:4173/";
  const elements = [
    { id: "LOGIN", type: "button", role: "button", name: "Login", selectorCandidates: ["getByRole('button', { name: 'Login' })"], url, source: "browser-exploration" as const },
    { id: "HEADING", type: "heading", role: "heading", name: "Welcome back", selectorCandidates: ["getByRole('heading', { name: 'Welcome back' })"], url, source: "browser-exploration" as const },
    { id: "EMAIL", type: "input", role: "textbox", name: "Email", placeholder: "Email", selectorCandidates: ["getByLabel('Email')", "getByPlaceholder('Email')"], url, source: "browser-exploration" as const },
  ];
  const exploration: ExplorationResult = { target: { url, module: "Demo", scope: "Login", requirements: [] }, status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url, `${url}dashboard.html`], elements, workflows: [], observations: [{ id: "NAV-1", type: "navigation", description: "Dashboard navigation observed", url: `${url}dashboard.html` }], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false };
  return { requirements: ["User can click Login", "Invalid credentials show an error message"], explorationResult: exploration, module: "Demo", scope: "Login" };
}

test("fixture-shaped exploration reports real executable and flagged step counts", () => {
  const result = generateTestCases(fixtureInput());
  const summary = result.coverageSummary.stepSummary;
  expect(summary.total).toBeGreaterThan(0);
  expect(summary.executable).toBeGreaterThan(0);
  expect(summary.flagged).toBeGreaterThan(0);
  expect(summary.executable + summary.flagged).toBe(summary.total);
  expect(summary.executableRatio).toBe(summary.executable / summary.total);
});

test("human supplied text outcome becomes executable with human provenance", () => {
  const result = generateTestCases({ ...fixtureInput(), requirements: ["Invalid credentials show an error message"], humanExpectedOutcomes: [{ requirement: "Invalid credentials show an error message", step: 1, type: "text", value: "Invalid credentials", provenance: "human-supplied" }] });
  const step = result.testCases.find((item) => item.title.startsWith("[Positive]"))!.steps[0];
  expect(step.expectedAssertion).toEqual({ type: "text", value: "Invalid credentials" });
  expect(step.assertionProvenance?.[0].type).toBe("human-supplied");
  expect(step.assertionProvenance?.[0].requirement).toBe("human-supplied expected outcome");
  expect(step.needsHumanInput).toBeUndefined();
});
