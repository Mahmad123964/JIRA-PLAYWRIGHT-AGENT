import { test, expect } from "@playwright/test";
import { healLocator, rankHealingCandidates } from "../../src/locator-healing";
import { validatedHeal } from "../../src/validated-healing";
import { validateObservedCandidate } from "../../src/healing-runtime";
import type { DiscoveredElement } from "../../src/browser-explorer";
import type { Page } from "@playwright/test";

/**
 * Guards the fail-closed contract:
 *   a ranking-only proposal is not evidence, so nothing may report HEALED (or
 *   PASS_AFTER_HEALING) without an explicit live validator. These cases pin the
 *   behaviour that previously failed open.
 */

const element: DiscoveredElement = {
  id: "E-1",
  type: "button",
  role: "button",
  name: "Submit",
  dataTestId: "submit",
  selectorCandidates: ["getByTestId('submit')"],
  url: "https://example.com",
  source: "browser-exploration",
};

const OTHER: DiscoveredElement = {
  ...element,
  id: "E-2",
  name: "Cancel",
  dataTestId: "cancel",
  selectorCandidates: ["getByTestId('cancel')"],
};

test.describe("ranking is advisory only", () => {
  test("candidates do not claim live-only properties", () => {
    const [candidate] = rankHealingCandidates("getByRole('button', { name: 'Old' })", [element], "Submit");
    // Ranking has no knowledge of the live page, so it must not assert these.
    expect(candidate).not.toHaveProperty("unique");
    expect(candidate).not.toHaveProperty("visible");
    expect(candidate).not.toHaveProperty("enabled");
    expect(candidate.selector).toBe("getByTestId('submit')");
    expect(candidate.confidence).toBeGreaterThan(0);
  });
});

test.describe("healLocator fails closed without a validator", () => {
  test("omitted validator does NOT heal", () => {
    const decision = healLocator("getByRole('button', { name: 'Old' })", [element], "Submit", 0.85, 1);
    expect(decision.status).toBe("NOT_HEALED");
    expect(decision.healedLocator).toBeUndefined();
    expect(decision.validationResult).toBe("NOT_RUN");
    expect(decision.reason).toContain("no validator was supplied");
  });

  test("a validator that returns false does not heal", () => {
    const decision = healLocator("getByRole('button', { name: 'Old' })", [element], "Submit", 0.85, 1, () => false);
    expect(decision.status).toBe("NOT_HEALED");
    expect(decision.healedLocator).toBeUndefined();
    expect(decision.validationResult).toBe("FAIL");
  });

  test("heals only when a validator confirms the candidate", () => {
    const decision = healLocator("getByRole('button', { name: 'Old' })", [element], "Submit", 0.85, 1, () => true);
    expect(decision.status).toBe("HEALED");
    expect(decision.healedLocator).toBe("getByTestId('submit')");
    expect(decision.validationResult).toBe("PASS");
  });

  test("the threshold still applies before validation", () => {
    // A candidate with no accessible role/name and no label scores below the
    // 0.85 default threshold, so it is never proposed and never validated.
    const weak: DiscoveredElement = {
      id: "E-9",
      type: "div",
      elementId: "mystery-node",
      selectorCandidates: ["locator('#mystery-node')"],
      url: "https://example.com",
      source: "browser-exploration",
    };
    const decision = healLocator("getByRole('button', { name: 'Old' })", [weak], "Submit", 0.85, 1, () => true);
    expect(decision.status).toBe("NOT_HEALED");
    expect(decision.validationResult).toBe("NOT_RUN");
    expect(decision.reason).toContain("confidence threshold");
  });
});

test.describe("validatedHeal fails closed without a live validator", () => {
  test("omitted validateCandidate cannot produce PASS_AFTER_HEALING", async () => {
    const result = await validatedHeal({
      originalLocator: "getByRole('button', { name: 'Old' })",
      originalRole: "button",
      originalName: "Submit",
      expectedText: "Submit",
      failureKind: "LOCATOR_NOT_FOUND",
      elements: [element],
      // No validateCandidate: previously fabricated a passing validation.
      rerun: async () => ({ action: "PASS", assertion: "PASS" }),
    });
    expect(result.outcome).toBe("NOT_HEALED");
    expect(result.suggestedPatch).toBeUndefined();
    expect(result.attempts.length).toBeGreaterThan(0);
    for (const attempt of result.attempts) expect(attempt.validationResult).not.toBe("PASS");
    expect(result.reason).toContain("HUMAN_REVIEW_REQUIRED");
  });

  test("omitted validateCandidate and omitted rerun still cannot heal", async () => {
    const result = await validatedHeal({
      originalLocator: "getByRole('button', { name: 'Old' })",
      originalRole: "button",
      originalName: "Submit",
      failureKind: "LOCATOR_NOT_FOUND",
      elements: [element],
    });
    expect(result.outcome).toBe("NOT_HEALED");
    expect(result.suggestedPatch).toBeUndefined();
  });

  test("a passing validator alone is not enough: the rerun must also pass", async () => {
    const result = await validatedHeal({
      originalLocator: "getByRole('button', { name: 'Old' })",
      originalRole: "button",
      originalName: "Submit",
      failureKind: "LOCATOR_NOT_FOUND",
      elements: [element],
      validateCandidate: async (candidate) => ({ count: 1, visible: true, enabled: true, role: candidate.role, name: candidate.name }),
      rerun: async () => ({ action: "PASS", assertion: "FAIL" }),
    });
    expect(result.outcome).toBe("NOT_HEALED");
    expect(result.suggestedPatch).toBeUndefined();
  });

  test("a non-unique match fails validation", async () => {
    const result = await validatedHeal({
      originalLocator: "getByRole('button', { name: 'Old' })",
      originalRole: "button",
      originalName: "Submit",
      failureKind: "LOCATOR_NOT_FOUND",
      elements: [element],
      // Two elements matched the live probe.
      validateCandidate: async (candidate) => ({ count: 2, visible: true, enabled: true, role: candidate.role, name: candidate.name }),
      rerun: async () => ({ action: "PASS", assertion: "PASS" }),
    });
    expect(result.outcome).toBe("NOT_HEALED");
    expect(result.attempts[0].validationResult).toBe("FAIL");
  });

  test("the full production contract still heals", async () => {
    // Validator confirms uniqueness + live rerun passes: this is the only path
    // that may report PASS_AFTER_HEALING, and it is what healing-runtime uses.
    const result = await validatedHeal({
      originalLocator: "getByRole('button', { name: 'Old' })",
      originalRole: "button",
      originalName: "Submit",
      failureKind: "LOCATOR_NOT_FOUND",
      elements: [element],
      validateCandidate: async (candidate) => ({ count: 1, visible: true, enabled: true, role: candidate.role, name: candidate.name }),
      rerun: async () => ({ action: "PASS", assertion: "PASS" }),
    });
    expect(result.outcome).toBe("PASS_AFTER_HEALING");
    expect(result.suggestedPatch?.replacement).toBe("getByTestId('submit')");
  });

  test("a removed element still reports HUMAN_REVIEW_REQUIRED", async () => {
    // Phase 3C: nothing matches the original role+name.
    const result = await validatedHeal({
      originalLocator: "getByRole('button', { name: 'Removed' })",
      originalRole: "button",
      originalName: "Removed",
      failureKind: "LOCATOR_NOT_FOUND",
      elements: [OTHER],
    });
    expect(result.outcome).toBe("NOT_HEALED");
    expect(result.reason).toContain("possible real application change");
    expect(result.reason).toContain("HUMAN_REVIEW_REQUIRED");
  });
});

test.describe("validateObservedCandidate fails closed on a thrown isEnabled()", () => {
  function fakePage(isEnabled: () => Promise<boolean>): Page {
    const locator = { count: async () => 1, isVisible: async () => true, isEnabled };
    return { getByRole: () => locator } as unknown as Page;
  }

  test("an isEnabled() error is reported as not enabled, not as enabled", async () => {
    const page = fakePage(async () => { throw new Error("isEnabled probe failed"); });
    const validation = await validateObservedCandidate(page, element);
    expect(validation.enabled).toBe(false);
    // count/visible are unaffected: only the failed enabled check must fail closed.
    expect(validation.count).toBe(1);
    expect(validation.visible).toBe(true);
  });

  test("a resolving isEnabled() still reports its real value", async () => {
    const page = fakePage(async () => true);
    const validation = await validateObservedCandidate(page, element);
    expect(validation.enabled).toBe(true);
  });
});
