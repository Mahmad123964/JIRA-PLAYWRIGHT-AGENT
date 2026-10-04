export type FailureCategory = "A. REAL APPLICATION DEFECT" | "B. AUTOMATION / TEST IMPLEMENTATION ISSUE" | "C. ENVIRONMENT / INFRASTRUCTURE ISSUE" | "D. FLAKY / TRANSIENT FAILURE" | "E. BLOCKED / MISSING REQUIREMENT";
export interface FailureInput { message: string; stack?: string; status?: number; test?: string; locator?: string; requirement?: string; environment?: string; timedOut?: boolean; browserUnavailable?: boolean; explorationStatus?: string; reporterStatus?: string; }
export interface FailureDiagnosis { category: FailureCategory; rationale: string; retryAllowed: boolean; bugEligible: boolean; }

const CATEGORY_A: FailureCategory = "A. REAL APPLICATION DEFECT";
const CATEGORY_B: FailureCategory = "B. AUTOMATION / TEST IMPLEMENTATION ISSUE";
const CATEGORY_C: FailureCategory = "C. ENVIRONMENT / INFRASTRUCTURE ISSUE";
const CATEGORY_D: FailureCategory = "D. FLAKY / TRANSIENT FAILURE";
const CATEGORY_E: FailureCategory = "E. BLOCKED / MISSING REQUIREMENT";

const ANSI_ESCAPE = /\u001b\[[0-9;]*m/g;

/**
 * A Playwright error payload is: message head, then an optional "Locator:" /
 * "Expected:" / "Received:" block, then "Call log:", then a code frame of the
 * spec's own source, then `at ...` stack frames.
 *
 * The code frame quotes the generated spec verbatim, so assertion keywords
 * appear there constantly -- e.g. a run that failed with LOCATOR_NOT_FOUND
 * still echoes `await expect(target).toBeVisible()` from the spec body. The
 * previous classifier matched those and reported every locator failure as a
 * verified application assertion failure. The verdict must therefore come from
 * the message head only.
 */
export function messageHead(message: string): string {
  const lines = String(message || "").replace(ANSI_ESCAPE, "").split(/\r?\n/);
  const head: string[] = [];
  for (const line of lines) {
    if (/^\s*call log:/i.test(line)) break;
    if (/^\s*at\s+\S/.test(line)) break;
    if (/^\s*\d+\s*\|/.test(line)) break;
    head.push(line);
  }
  return head.join("\n");
}

/**
 * Everything Playwright itself reported -- message head plus the "Call log:"
 * section -- stopping at the spec code frame and stack frames. Locator and
 * transient signals are read from here rather than from the raw payload,
 * because the generated spec quotes its own healing regexes verbatim: a run
 * that failed with LOCATOR_NOT_FOUND still contains the literal text
 * "resolved to 0" inside `if (!/locator|strict mode|no element|not
 * found|resolved to 0/i.test(message))`, which would otherwise be read as a
 * real locator failure in a run that has nothing to do with one.
 */
export function reporterBody(message: string): string {
  const lines = String(message || "").replace(ANSI_ESCAPE, "").split(/\r?\n/);
  const body: string[] = [];
  for (const line of lines) {
    if (/^\s*at\s+\S/.test(line)) break;
    if (/^\s*\d+\s*\|/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

/** Browser/runtime is unavailable. Must precede the tooling rule. */
const BROWSER_UNAVAILABLE = /executable doesn't exist|executable does not exist|browser.*not installed|please run the following command to download new browsers|\bchrom(e|ium)\b.*(?:launch|executable)/i;

/**
 * The runner was invoked wrongly, or never got as far as executing a test.
 * Category B: this is our tooling defect, never an application defect.
 * Deliberately does NOT include a bare /unknown/ -- "unknown option" is a CLI
 * usage error, not a missing requirement.
 */
const TOOLING_INVOCATION = /unknown option|unknown argument|unrecognized option|unrecognized argument|no tests found|did not run any tests|cannot find module|\bENOENT\b|failed to start|spawn\w*\s+error|runner error|test suite failed to collect|is not recognized|browser type .*? is not/i;

/**
 * The locator never resolved to the intended element. Automation, category B.
 *
 * `element(?:\(s\))? not found` matches BOTH "element not found" and Playwright's
 * literal Received placeholder `<element(s) not found>`. The placeholder matters:
 * a removed element fails an ordinary toBeVisible() assertion with an
 * expected/received diff present, so without this alternative the payload falls
 * through to the category A gate below and a removed element is auto-confirmed as
 * a defect instead of being flagged for human review (Phase 3C).
 *
 * "waiting for getByRole(...)" is deliberately NOT an indicator: Playwright
 * narrates every wait that way, including in call logs that end with "locator
 * resolved to <h1>...</h1>" and then fail on the assertion -- which is category A.
 */
const LOCATOR_UNRESOLVED = /locator_not_found|locator_notfound|strict mode violation|resolved to 0\b|no element(?:s)? (?:matching|found|visible)|element(?:\(s\))? not found|target (?:was )?not found|no nodes found/i;

/**
 * Genuinely missing or unclear requirements only. The bare /unknown/ and bare
 * /blocked/ that used to live here matched CLI errors ("unknown option") and
 * arbitrary prose, so E is now reachable only from an explicit requirement
 * statement or from a blocked/failed exploration.
 */
const REQUIREMENT_UNAVAILABLE = /missing requirement|requirement (?:is )?(?:missing|unclear|ambiguous|not (?:provided|specified|documented))|no requirement (?:was )?(?:provided|supplied)|authentication required|credentials? (?:are )?(?:not (?:available|provided|configured|supplied)|missing|unavailable)|login required|sign[- ]?in required|cannot be established with high confidence/i;

/**
 * Transient conditions. Note the ABSENCE of the bare words "timeout" and
 * "network": a passing-then-mismatching assertion head always contains
 * "Timeout: 5000ms" (the per-assertion budget), which previously dragged
 * genuine defects into D. A real timeout is signalled authoritatively by
 * reporterStatus === "timedOut".
 */
const TRANSIENT = /connection reset|econnreset|socket hang up|temporarily unavailable|service unavailable|\b50[234]\b|net::err_|eai_again|epipe|rate limit/i;

function hasVerifiedAssertionDiff(head: string): boolean {
  // Playwright's own mismatch block: an "Expected ...:" line AND a
  // "Received ...:" line. This is the positive evidence that execution
  // reached the application and compared a real value against a requirement.
  return /^\s*expected[^\n]*:\s*\S/im.test(head) && /^\s*received[^\n]*:\s*\S/im.test(head);
}

export function classifyFailure(input: FailureInput): FailureDiagnosis {
  const raw = `${input.message || ""} ${input.stack || ""}`;
  const text = raw.replace(ANSI_ESCAPE, "");
  const head = messageHead(input.message || "");
  // Locator and transient signals are read only from Playwright's own output,
  // never from the spec code frame quoted inside the payload.
  const body = reporterBody(input.message || "");
  const reporterStatus = (input.reporterStatus || "").toLowerCase();

  // 1. Browser/runtime missing. Checked first because it reads like a tooling
  //    failure but is an environment problem, not our invocation.
  if (input.browserUnavailable || BROWSER_UNAVAILABLE.test(text)) {
    return { category: CATEGORY_C, rationale: "Playwright browser runtime is unavailable; install browsers with npx playwright install.", retryAllowed: false, bugEligible: false };
  }

  // 2. The run was cut short before a verdict: infrastructure, retryable.
  if (reporterStatus === "interrupted") {
    return { category: CATEGORY_C, rationale: "The Playwright run was interrupted before the test produced a verdict, so this is an infrastructure condition rather than an application outcome.", retryAllowed: true, bugEligible: false };
  }

  // 3. CLI/tooling invocation failure. Category B, never Jira-eligible.
  if (TOOLING_INVOCATION.test(text)) {
    return { category: CATEGORY_B, rationale: "The Playwright runner was invoked incorrectly or failed before executing any test. This is a tooling/invocation defect in this repository, not an application failure and not a missing requirement.", retryAllowed: false, bugEligible: false };
  }

  // 4. Blocked/failed exploration, or an explicitly stated missing/unclear
  //    requirement, missing credentials, or an authentication wall.
  if (input.explorationStatus === "BLOCKED" || input.explorationStatus === "FAILED" || REQUIREMENT_UNAVAILABLE.test(text)) {
    return { category: CATEGORY_E, rationale: "The requirement, target, or credentials needed to execute were not available, so no application verdict can be drawn.", retryAllowed: false, bugEligible: false };
  }

  // 5. Locator problems stay B. Evaluated before the assertion gate on
  //    purpose: if the element never resolved there is no comparison against a
  //    requirement, so it can never be a verified application defect.
  if (LOCATOR_UNRESOLVED.test(body)) {
    return { category: CATEGORY_B, rationale: "The locator did not resolve to the intended element, so the test never reached the assertion and no contract mismatch can be proven. A removed or renamed element is a possible real application change: validated-healing flags it as HUMAN_REVIEW_REQUIRED for a human to judge, and it is not auto-filed as a defect.", retryAllowed: false, bugEligible: false };
  }

  // 6. Transient / flaky. Keyed on the reporter's own verdict where possible.
  if (reporterStatus === "timedout" || input.timedOut || TRANSIENT.test(body)) {
    return { category: CATEGORY_D, rationale: reporterStatus === "timedout" || input.timedOut ? "The test timed out after execution began. A timeout carries no evidence of a verified contract mismatch, so the documented controlled retry applies rather than defect creation." : "The failure shows transient timing or infrastructure indicators.", retryAllowed: true, bugEligible: false };
  }

  // 7. Explicit infrastructure status with no transient marker.
  if (typeof input.status === "number" && input.status >= 500) {
    return { category: CATEGORY_C, rationale: `The target returned infrastructure status ${input.status}.`, retryAllowed: true, bugEligible: false };
  }

  // 8. Category A requires POSITIVE evidence: Playwright produced an
  //    expected/received diff, so a real value was compared to a requirement
  //    after the locator resolved.
  if (hasVerifiedAssertionDiff(head)) {
    return { category: CATEGORY_A, rationale: "A verified assertion failed after the locator resolved and execution reached the application: Playwright reported an expected/received mismatch against the requirement.", retryAllowed: false, bugEligible: true };
  }

  // 9. Default. Deliberately NOT A: an unrecognised failure must never become
  //    Jira-eligible. Human review decides.
  return { category: CATEGORY_B, rationale: "Unclassified: the failure matched no known automation, infrastructure, requirement, or verified-assertion pattern. Unclassified failures need human review and are never auto-filed as defects.", retryAllowed: false, bugEligible: false };
}
