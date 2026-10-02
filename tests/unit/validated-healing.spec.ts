import { test, expect } from "@playwright/test";
import { validatedHeal } from "../../src/validated-healing";
import type { DiscoveredElement } from "../../src/browser-explorer";

function element(overrides: Partial<DiscoveredElement> = {}): DiscoveredElement {
  return { id: "E-1", type: "button", role: "button", name: "Submit", dataTestId: "submit", selectorCandidates: ["getByTestId('submit')"], url: "http://fixture", source: "browser-exploration", ...overrides };
}

test("broken locator heals, reruns action and assertion, and reports PASS_AFTER_HEALING", async () => {
  const result = await validatedHeal({ originalLocator: "getByRole('button', { name: 'Old' })", originalRole: "button", originalName: "Submit", failureKind: "LOCATOR_NOT_FOUND", elements: [element()], threshold: 0.85, rerun: async () => ({ action: "PASS", assertion: "PASS" }) });
  expect(result.outcome).toBe("PASS_AFTER_HEALING");
  expect(result.attempts[0].initialResult).toBe("FAIL");
  expect(result.attempts[0].healedResult).toBe("PASS/PASS");
  expect(result.suggestedPatch?.replacement).toBe("getByTestId('submit')");
});

test("removed element is not healed", async () => {
  const result = await validatedHeal({ originalLocator: "getByRole('button', { name: 'Submit' })", originalRole: "button", originalName: "Submit", failureKind: "LOCATOR_NOT_FOUND", elements: [element({ name: "Save" })] });
  expect(result.outcome).toBe("NOT_HEALED");
  expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0].validationResult).toBe("FAIL");
});

test("candidate below threshold is rejected", async () => {
  const result = await validatedHeal({ originalLocator: "old", originalRole: "button", originalName: "Submit", failureKind: "LOCATOR_EMPTY", elements: [element({ dataTestId: undefined })], threshold: 0.99 });
  expect(result.outcome).toBe("NOT_HEALED");
});

test("assertion failure is not healed", async () => {
  const result = await validatedHeal({ originalLocator: "old", originalRole: "button", originalName: "Submit", failureKind: "ASSERTION_FAILURE", elements: [element()] });
  expect(result.outcome).toBe("NOT_ELIGIBLE");
});

test("matching text with wrong role is rejected", async () => {
  const result = await validatedHeal({ originalLocator: "old", originalRole: "button", originalName: "Submit", failureKind: "LOCATOR_NOT_FOUND", elements: [element({ role: "link" })] });
  expect(result.outcome).toBe("NOT_HEALED");
});
