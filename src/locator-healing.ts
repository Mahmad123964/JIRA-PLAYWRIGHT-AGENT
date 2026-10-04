import type { DiscoveredElement } from "./browser-explorer";

/**
 * A ranked proposal. This is ADVISORY ONLY: ranking is a static heuristic over
 * exploration data and has no knowledge of the live page. It deliberately does
 * NOT claim a candidate is unique, visible or enabled -- those are live
 * properties that only a validator (or the real rerun) can establish. Anything
 * that needs a verdict must supply a validator and see it fail closed.
 */
export interface HealingCandidate { selector: string; confidence: number; rank: number; reasons: string[]; }
export interface HealingDecision { status: "HEALED" | "NOT_HEALED"; originalLocator: string; healedLocator?: string; confidence: number; candidates: HealingCandidate[]; reason: string; attemptNumber: number; validationResult: "NOT_RUN" | "PASS" | "FAIL"; timestamp: string; }

export function rankHealingCandidates(originalLocator: string, elements: DiscoveredElement[], expectedText = ""): HealingCandidate[] {
  const words = expectedText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return elements.map((element) => {
    const haystack = [element.name, element.ariaLabel, element.placeholder, element.dataTestId, element.nameAttr].filter(Boolean).join(" ").toLowerCase();
    const reasons: string[] = [];
    let confidence = 0.1;
    if (element.role && element.name) { confidence += 0.65; reasons.push("accessible role and name"); }
    if (element.dataTestId || element.elementId || element.nameAttr) { confidence += 0.25; reasons.push("stable attribute"); }
    if (element.ariaLabel || element.placeholder) { confidence += 0.15; reasons.push("accessible label or placeholder"); }
    if (element.name && words.some((word) => element.name!.toLowerCase() === word)) { confidence += 0.15; reasons.push("exact accessible-name match"); }
    else if (words.some((word) => haystack.includes(word))) { confidence += 0.1; reasons.push("semantic text match"); }
    return { selector: element.selectorCandidates[0], confidence: Math.min(confidence, 0.99), rank: 0, reasons };
  }).sort((a, b) => b.confidence - a.confidence).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

/**
 * Ranking-only helper. Returns a HEALED verdict ONLY when an explicit
 * `validate` callback confirms the candidate; without one it fails closed with
 * NOT_HEALED / NOT_RUN, because an unvalidated proposal is not evidence.
 *
 * This is not the production healing path. Production runs go through
 * `healOnSamePage` (src/healing-runtime.ts) -> `validatedHeal`
 * (src/validated-healing.ts), which performs live validation AND re-executes
 * the original action and assertion before accepting a repair.
 */
export function healLocator(originalLocator: string, elements: DiscoveredElement[], expectedText: string, threshold = Number(process.env.SELF_HEALING_MIN_CONFIDENCE || "0.85"), attemptNumber = 1, validate?: (selector: string) => boolean): HealingDecision {
  const candidates = rankHealingCandidates(originalLocator, elements, expectedText);
  const candidate = candidates.find((item) => item.confidence >= threshold);
  if (!candidate) return { status: "NOT_HEALED", originalLocator, confidence: candidates[0]?.confidence || 0, candidates, reason: "No candidate met the confidence threshold", attemptNumber, validationResult: "NOT_RUN", timestamp: new Date().toISOString() };
  // Fail closed: with no validator there is no evidence the candidate resolves
  // on the page, so the proposal stays unverified and is never reported healed.
  if (!validate) return { status: "NOT_HEALED", originalLocator, confidence: candidate.confidence, candidates, reason: "Candidate met the confidence threshold but no validator was supplied, so it was not verified; ranking alone is not evidence", attemptNumber, validationResult: "NOT_RUN", timestamp: new Date().toISOString() };
  const valid = validate(candidate.selector);
  return { status: valid ? "HEALED" : "NOT_HEALED", originalLocator, healedLocator: valid ? candidate.selector : undefined, confidence: candidate.confidence, candidates, reason: valid ? "Candidate passed controlled validation" : "Candidate failed controlled validation", attemptNumber, validationResult: valid ? "PASS" : "FAIL", timestamp: new Date().toISOString() };
}
