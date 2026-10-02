import { test, expect } from "@playwright/test";
import { executePlaywright } from "../../src/execution-engine";
import { EvidenceManager } from "../../src/evidence-engine";
import { healLocator } from "../../src/locator-healing";
import type { DiscoveredElement } from "../../src/browser-explorer";

const element: DiscoveredElement = { id: "E-1", type: "button", role: "button", name: "Submit", dataTestId: "submit", selectorCandidates: ["getByTestId('submit')"], url: "https://example.com", source: "browser-exploration" };

test("healing uses configured confidence threshold", () => {
  const decision = healLocator("getByRole('button', { name: 'Old' })", [element], "Submit", 0.85, 1, () => true);
  expect(decision.status).toBe("HEALED");
  expect(decision.validationResult).toBe("PASS");
  expect(decision.healedLocator).toBe("getByTestId('submit')");
});

test("evidence manager verifies persisted text artifacts", () => {
  const manager = new EvidenceManager("evidence-test", "test-results/evidence-test");
  const artifact = manager.addText("log", "sample.log", "safe output");
  expect(artifact.status).toBe("AVAILABLE");
  expect(manager.finalize().secretScan.status).toBe("PASS");
});

test("execution engine returns structured result for a missing test path", async () => {
  const result = await executePlaywright(["tests/does-not-exist.spec.ts"], { runId: "execution-missing-test", captureArtifacts: false });
  expect(result.tests).toHaveLength(1);
  expect(["FAIL", "BLOCKED"]).toContain(result.tests[0].status);
  expect(result.evidence.artifacts.some((artifact) => artifact.kind === "runner-log")).toBe(true);
});
