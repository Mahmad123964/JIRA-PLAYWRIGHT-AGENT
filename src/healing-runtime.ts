import type { Locator, Page } from "@playwright/test";
import type { DiscoveredElement } from "./browser-explorer";
import { validatedHeal, type LiveCandidateValidation, type ValidatedHealingResult } from "./validated-healing";

export function locatorForObservedElement(page: Page, element: DiscoveredElement): Locator {
  if (element.role && element.name) return page.getByRole(element.role as any, { name: element.name });
  if (element.ariaLabel) return page.getByLabel(element.ariaLabel);
  if (element.placeholder) return page.getByPlaceholder(element.placeholder);
  if (element.dataTestId) return page.getByTestId(element.dataTestId);
  if (element.name) return page.getByText(element.name);
  throw new Error(`No safe locator can be built for observed element ${element.id}`);
}

export async function validateObservedCandidate(page: Page, element: DiscoveredElement): Promise<LiveCandidateValidation> {
  try {
    const locator = locatorForObservedElement(page, element);
    const count = await locator.count();
    const visible = count === 1 && await locator.isVisible();
    const enabled = count === 1 ? await locator.isEnabled().catch(() => true) : false;
    return { count, visible, enabled, role: element.role, name: element.name };
  } catch {
    return { count: 0, visible: false, enabled: false, role: element.role, name: element.name };
  }
}

export async function healOnSamePage(input: {
  page: Page;
  originalLocator: string;
  originalRole?: string;
  originalName?: string;
  expectedText?: string;
  failureKind: "LOCATOR_NOT_FOUND" | "LOCATOR_EMPTY" | "ASSERTION_FAILURE" | "TIMEOUT" | "NETWORK_ERROR" | "NAVIGATION_ERROR" | "OTHER";
  elements: DiscoveredElement[];
  rerun: (element: DiscoveredElement) => Promise<{ action: "PASS" | "FAIL"; assertion: "PASS" | "FAIL"; detail?: string }>;
}): Promise<ValidatedHealingResult> {
  return validatedHeal({
    originalLocator: input.originalLocator,
    originalRole: input.originalRole,
    originalName: input.originalName,
    expectedText: input.expectedText,
    failureKind: input.failureKind,
    elements: input.elements,
    validateCandidate: (element) => validateObservedCandidate(input.page, element),
    rerun: input.rerun,
  });
}
