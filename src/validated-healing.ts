import type { DiscoveredElement } from "./browser-explorer";
import { type HealingDecision } from "./locator-healing";

export type HealingFailureKind = "LOCATOR_NOT_FOUND" | "LOCATOR_EMPTY" | "ASSERTION_FAILURE" | "TIMEOUT" | "NETWORK_ERROR" | "NAVIGATION_ERROR" | "OTHER";
export type HealingOutcome = "PASS_AFTER_HEALING" | "NOT_HEALED" | "NOT_ELIGIBLE";

export interface LiveCandidateValidation {
  count: number;
  visible: boolean;
  enabled: boolean;
  role?: string;
  name?: string;
}

export interface HealingAttempt {
  originalLocator: string;
  candidate?: string;
  confidence: number;
  reason: string;
  attemptNumber: number;
  validationResult: "PASS" | "FAIL" | "NOT_RUN";
  timestamp: string;
  initialResult: string;
  healedResult?: string;
}

export interface ValidatedHealingInput {
  originalLocator: string;
  originalRole?: string;
  originalName?: string;
  expectedText?: string;
  failureKind: HealingFailureKind;
  elements: DiscoveredElement[];
  threshold?: number;
  maxAttempts?: number;
  validateCandidate?: (candidate: DiscoveredElement) => LiveCandidateValidation | Promise<LiveCandidateValidation>;
  rerun?: (candidate: DiscoveredElement) => Promise<{ action: "PASS" | "FAIL"; assertion: "PASS" | "FAIL"; detail?: string }>;
}

export interface ValidatedHealingResult {
  outcome: HealingOutcome;
  attempts: HealingAttempt[];
  suggestedPatch?: { originalLocator: string; replacement: string; confidence: number };
  reason: string;
}

function eligibleFailure(kind: HealingFailureKind): boolean {
  return kind === "LOCATOR_NOT_FOUND" || kind === "LOCATOR_EMPTY";
}

function sameIntent(element: DiscoveredElement, role?: string, name?: string): boolean {
  if (role && element.role !== role) return false;
  if (name && element.name !== name) return false;
  return Boolean(element.role && element.name);
}

export async function validatedHeal(input: ValidatedHealingInput): Promise<ValidatedHealingResult> {
  const attempts: HealingAttempt[] = [];
  const maxAttempts = Math.min(Math.max(input.maxAttempts || 2, 1), 2);
  if (!eligibleFailure(input.failureKind)) return { outcome: "NOT_ELIGIBLE", attempts, reason: `Healing is not permitted for failure kind ${input.failureKind}` };

  const intentElements = input.elements.filter((element) => sameIntent(element, input.originalRole, input.originalName));
  if (!intentElements.length) {
    attempts.push({ originalLocator: input.originalLocator, confidence: 0, reason: "No candidate matches the original role and accessible name; possible real application change", attemptNumber: 1, validationResult: "FAIL", timestamp: new Date().toISOString(), initialResult: "FAIL" });
    return { outcome: "NOT_HEALED", attempts, reason: "No candidate matches the original role and accessible name; possible real application change; HUMAN_REVIEW_REQUIRED" };
  }

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    // Ranking is advisory: it proposes by confidence only. Uniqueness is a live
    // property and is established below by validateCandidate, never assumed here.
    const rankedCandidate = (await import("./locator-healing")).rankHealingCandidates(input.originalLocator, intentElements, input.expectedText || input.originalName || "").find((item) => item.confidence >= (input.threshold ?? Number(process.env.SELF_HEALING_MIN_CONFIDENCE || "0.85")));
    const candidateElement = rankedCandidate ? intentElements.find((item) => item.selectorCandidates.includes(rankedCandidate.selector)) : undefined;
    let validationResult: "PASS" | "FAIL" | "NOT_RUN" = "NOT_RUN";
    if (candidateElement) {
      // FAIL CLOSED. Without a live validator there is no evidence that the
      // candidate resolves uniquely, is visible and is enabled on the page, so
      // validation must not be assumed. Previously an omitted validator was
      // replaced by a fabricated {count:1, visible:true, enabled:true} that
      // trivially satisfied every check below and reported PASS.
      if (!input.validateCandidate) {
        validationResult = "FAIL";
      } else {
        const validation = await input.validateCandidate(candidateElement);
        validationResult = validation.count === 1 && validation.visible && validation.enabled && validation.role === candidateElement.role && validation.name === candidateElement.name ? "PASS" : "FAIL";
      }
    }
    const decision: HealingDecision = {
      status: candidateElement && validationResult === "PASS" ? "HEALED" : "NOT_HEALED",
      originalLocator: input.originalLocator,
      healedLocator: candidateElement && validationResult === "PASS" ? rankedCandidate!.selector : undefined,
      confidence: rankedCandidate?.confidence || 0,
      candidates: rankedCandidate ? [rankedCandidate] : [],
      reason: candidateElement && validationResult === "PASS" ? "Candidate passed strict validation" : candidateElement ? "No candidate passed strict validation" : "No candidate met the confidence threshold",
      attemptNumber,
      validationResult,
      timestamp: new Date().toISOString(),
    };
    const validatedElement = decision.healedLocator ? intentElements.find((element) => element.selectorCandidates.includes(decision.healedLocator!)) : undefined;
    const attempt: HealingAttempt = { originalLocator: input.originalLocator, candidate: decision.healedLocator, confidence: decision.confidence, reason: decision.reason, attemptNumber, validationResult: decision.validationResult, timestamp: decision.timestamp, initialResult: "FAIL" };
    if (!validatedElement || !input.rerun) { attempts.push(attempt); continue; }
    const rerun = await input.rerun(validatedElement);
    attempt.healedResult = `${rerun.action}/${rerun.assertion}`;
    attempts.push(attempt);
    if (rerun.action === "PASS" && rerun.assertion === "PASS") return { outcome: "PASS_AFTER_HEALING", attempts, suggestedPatch: { originalLocator: input.originalLocator, replacement: decision.healedLocator!, confidence: decision.confidence }, reason: "Candidate validated and original action plus assertion passed" };
  }
  return { outcome: "NOT_HEALED", attempts, reason: "No candidate passed strict live validation and original assertion re-execution; HUMAN_REVIEW_REQUIRED" };
}
