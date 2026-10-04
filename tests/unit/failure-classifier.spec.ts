import { test, expect } from "@playwright/test";
import { classifyFailure, messageHead, reporterBody } from "../../src/failure-classifier";

/**
 * Every error string below is taken from, or byte-identical in shape to, real
 * Playwright 1.62.1 JSON reporter output captured in this repository (see
 * reports/integration-defect and reports/integration-removed).
 */

// Real toContainText mismatch. The locator RESOLVED ("locator resolved to
// <h1>Welcome back</h1>") and then the value did not match the requirement.
const VERIFIED_MISMATCH = `Error: expect(locator).toContainText(expected) failed

Locator: getByRole('heading', { name: 'Welcome back' })
Expected substring: "Wrong heading"
Received string:    "Welcome back"
Timeout: 5000ms

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Welcome back' })
    13 × locator resolved to <h1>Welcome back</h1>
       - unexpected value "Welcome back"
`;

// Real LOCATOR_NOT_FOUND. Note the code frame quotes the generated spec's own
// healing regex, which contains the literal text "no element", "not found" and
// "resolved to 0". Those must not be read as this run's failure reason.
const LOCATOR_NOT_FOUND = `Error: LOCATOR_NOT_FOUND

  18 |     await test.step("Step 1: Click removed action", async () => {
  19 |       try { const target = page.getByRole('button', { name: 'Old Removed action' });
> 20 |       if ((await target.count()) === 0) throw new Error("LOCATOR_NOT_FOUND");
  21 |       await target.click();
  22 |       await expect(target).toBeVisible(); } catch (error) {
  23 |         const message = error instanceof Error ? error.message : String(error);
  24 |         if (!/locator|strict mode|no element|not found|resolved to 0/i.test(message)) throw error;
    at C:\\repo\\tests\\generated\\DemoRemoved\\TC-DEMO-REMOVED.spec.ts:20:45
`;

const BROWSER_MISSING = "browserType.launch: Executable doesn't exist at C:\\ms-playwright\\chromium-1187\\chrome-win\\chrome.exe. Please run the following command to download new browsers:\nnpx playwright install";

const SERVICE_UNAVAILABLE = "received 503 Service Unavailable while loading https://example.test/api/orders";

const AUTH_WALL = "login required before the target page could be reached";

const UNRECOGNIZED = "Something entirely unexpected happened during fixture teardown";

// Real Playwright 1.62 rendering when the element is gone from the page. The
// Received value is Playwright's literal placeholder, and an expected/received
// diff IS present -- so only the placeholder identifies this as unresolved.
// Verbatim failure payload from a real approved-run execution.
const STORED_INTEGRATION_DEFECT_ERROR =
  'Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoContainText\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m failed\n' +
  '\nLocator: getByRole(\'heading\', { name: \'Welcome back\' })\nExpected substring: \u001b[32m"W\u001b[7mrong heading\u001b[27m"\u001b[39m\n' +
  'Received string:    \u001b[31m"W\u001b[7melcome back\u001b[27m"\u001b[39m\nTimeout: 5000ms\n\nCall log:\n' +
  '\u001b[2m  - Expect "toContainText" with timeout 5000ms\u001b[22m\n\u001b[2m  - waiting for getByRole(\'heading\', { name: \'Welcome back\' })\u001b[22m\n' +
  '\u001b[2m    13 × locator resolved to <h1>Welcome back</h1>\u001b[22m\n\u001b[2m       - unexpected value "Welcome back"\u001b[22m\n' +
  '\n\n\u001b[0m \u001b[90m 20 |\u001b[39m       \u001b[36mif\u001b[39m (\u001b[36mawait\u001b[39m target\u001b[33m.\u001b[39mcount() \u001b[33m===\u001b[39m \u001b[35m0\u001b[39m) \u001b[36mthrow\u001b[39m \u001b[36mnew\u001b[39m \u001b[33mError\u001b[39m(\u001b[32m"LOCATOR_NOT_FOUND"\u001b[39m)\u001b[33m;\u001b[39m\n' +
  ' \u001b[90m 21 |\u001b[39m       \n\u001b[31m\u001b[1m>\u001b[22m\u001b[39m\u001b[90m 22 |\u001b[39m       \u001b[36mawait\u001b[39m expect(target)\u001b[33m.\u001b[39mtoContainText(\u001b[32m"Wrong heading"\u001b[39m)\u001b[33m;\u001b[39m } \u001b[36mcatch\u001b[39m (error) {\n' +
  ' \u001b[90m    |\u001b[39m                            \u001b[31m\u001b[1m^\u001b[22m\u001b[39m\n \u001b[90m 23 |\u001b[39m         \u001b[36mconst\u001b[39m message \u001b[33m=\u001b[39m error \u001b[36minstanceof\u001b[39m \u001b[33mError\u001b[39m \u001b[33m?\u001b[39m error\u001b[33m.\u001b[39mmessage \u001b[33m:\u001b[39m \u001b[33mString\u001b[39m(error)\u001b[33m;\u001b[39m\n' +
  ' \u001b[90m 24 |\u001b[39m         \u001b[36mif\u001b[39m (\u001b[33m!\u001b[39m\u001b[35m/locator|strict mode|no element|not found|resolved to 0/i\u001b[39m\u001b[33m.\u001b[39mtest(message)) \u001b[36mthrow\u001b[39m error\u001b[33m;\u001b[39m\n' +
  ' \u001b[90m 25 |\u001b[39m         \u001b[36mconst\u001b[39m healing \u001b[33m=\u001b[39m \u001b[36mawait\u001b[39m healOnSamePage({ page\u001b[33m,\u001b[39m originalLocator\u001b[33m:\u001b[39m \u001b[32m"getByRole(\'heading\', { name: \'Welcome back\' })"\u001b[39m\u001b[33m,\u001b[39m originalRole\u001b[33m:\u001b[39m \u001b[32m"heading"\u001b[39m\u001b[33m,\u001b[39m originalName\u001b[33m:\u001b[39m \u001b[32m"Welcome back"\u001b[39m\u001b[33m,\u001b[39m expectedText\u001b[33m:\u001b[39m \u001b[32m"Wrong heading"\u001b[39m\u001b[33m,\u001b[39m failureKind\u001b[33m:\u001b[39m \u001b[35m/resolved to 0|no element|not found/i\u001b[39m\u001b[33m.\u001b[39mtest(message) \u001b[33m?\u001b[39m \u001b[32m"LOCATOR_NOT_FOUND"\u001b[39m \u001b[33m:\u001b[39m \u001b[32m"LOCATOR_EMPTY"\u001b[39m\u001b[33m,\u001b[39m elements\u001b[33m:\u001b[39m observedElements\u001b[33m,\u001b[39m rerun\u001b[33m:\u001b[39m \u001b[36masync\u001b[39m (candidate) \u001b[33m=>\u001b[39m { \u001b[36mconst\u001b[39m healed \u001b[33m=\u001b[39m locatorForObservedElement(page\u001b[33m,\u001b[39m candidate)\u001b[33m;\u001b[39m \u001b[36mtry\u001b[39m {  \u001b[36mawait\u001b[39m expect(healed)\u001b[33m.\u001b[39mtoContainText(\u001b[32m"Wrong heading"\u001b[39m)\u001b[33m;\u001b[39m \u001b[36mreturn\u001b[39m { action\u001b[33m:\u001b[39m \u001b[32m"PASS"\u001b[39m\u001b[33m,\u001b[39m assertion\u001b[33m:\u001b[39m \u001b[32m"PASS"\u001b[39m }\u001b[33m;\u001b[39m } \u001b[36mcatch\u001b[39m (rerunError) { \u001b[36mreturn\u001b[39m { action\u001b[33m:\u001b[39m \u001b[32m"PASS"\u001b[39m\u001b[33m,\u001b[39m assertion\u001b[33m:\u001b[39m \u001b[32m"FAIL"\u001b[39m\u001b[33m,\u001b[39m detail\u001b[33m:\u001b[39m \u001b[33mString\u001b[39m(rerunError) }\u001b[33m;\u001b[39m } }} )\u001b[0m\n' +
  '\u001b[2m    at C:\\Users\\haali\\Videos\\New\\JIRA-PLAYWRIGHT-AGENT\\tests\\generated\\DemoDefect\\TC-DEMO-A.spec.ts:22:28\u001b[22m\n' +
  '\u001b[2m    at C:\\Users\\haali\\Videos\\New\\JIRA-PLAYWRIGHT-AGENT\\tests\\generated\\DemoDefect\\TC-DEMO-A.spec.ts:18:5\u001b[22m (at C:\\Users\\haali\\Videos\\New\\JIRA-PLAYWRIGHT-AGENT\\tests\\generated\\DemoDefect\\TC-DEMO-A.spec.ts:22:28)';


const REMOVED_ELEMENT_VISIBLE = `Error: expect(locator).toBeVisible() failed

Locator:  getByRole('button', { name: 'Old Removed action' })
Expected: visible
Received: <element(s) not found>
Timeout: 5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: 'Old Removed action' })
`;

const URL_MISMATCH = `Error: expect(page).toHaveURL(expected) failed

Expected: "https://example.test/dashboard"
Received: "https://example.test/login"
Timeout: 5000ms
`;

const TEXT_MISMATCH = `Error: expect(locator).toHaveText(expected) failed

Locator: getByRole('heading', { name: 'Welcome back' })
Expected string: "Welcome back, Ahmad"
Received string: "Welcome back"
Timeout: 5000ms
`;

test.describe("failure classifier categories", () => {
  test("A: verified expected/received mismatch after the locator resolved", () => {
    const result = classifyFailure({ message: VERIFIED_MISMATCH, reporterStatus: "failed" });
    expect(result.category).toBe("A. REAL APPLICATION DEFECT");
    expect(result.bugEligible).toBe(true);
    expect(result.retryAllowed).toBe(false);
    expect(result.rationale).toContain("expected/received mismatch");
  });

  test("B: unsupported CLI option is a tooling defect, not a missing requirement", () => {
    const result = classifyFailure({ message: "error: unknown option '--video'\nUsage: node cli.js test" });
    expect(result.category).toBe("B. AUTOMATION / TEST IMPLEMENTATION ISSUE");
    expect(result.bugEligible).toBe(false);
    // It must never be E: nothing about a requirement is missing here.
    expect(result.category).not.toContain("E.");
  });

  test("B: JSON valid but no tests found is a tooling defect", () => {
    const result = classifyFailure({ message: "Error: No tests found.\nMake sure that arguments are regular expressions matching test files." });
    expect(result.category).toBe("B. AUTOMATION / TEST IMPLEMENTATION ISSUE");
    expect(result.bugEligible).toBe(false);
  });

  test("B: locator not found stays automation even though the spec code frame contains assertion keywords", () => {
    const result = classifyFailure({ message: LOCATOR_NOT_FOUND, reporterStatus: "failed" });
    expect(result.category).toBe("B. AUTOMATION / TEST IMPLEMENTATION ISSUE");
    expect(result.bugEligible).toBe(false);
    // The code frame does contain toBeVisible(), not found and resolved to 0.
    expect(LOCATOR_NOT_FOUND).toContain("toBeVisible()");
    expect(LOCATOR_NOT_FOUND).toContain("resolved to 0");
  });

  test("B: strict mode violation is automation", () => {
    const result = classifyFailure({ message: "Error: strict mode violation: getByRole('button') resolved to 3 elements" });
    expect(result.category).toBe("B. AUTOMATION / TEST IMPLEMENTATION ISSUE");
    expect(result.bugEligible).toBe(false);
  });

  test("C: browser executable missing is infrastructure", () => {
    const result = classifyFailure({ message: BROWSER_MISSING });
    expect(result.category).toBe("C. ENVIRONMENT / INFRASTRUCTURE ISSUE");
    expect(result.bugEligible).toBe(false);
  });

  test("C: an interrupted attempt is infrastructure, never a defect", () => {
    const result = classifyFailure({ message: "worker process exited unexpectedly", reporterStatus: "interrupted" });
    expect(result.category).toBe("C. ENVIRONMENT / INFRASTRUCTURE ISSUE");
    expect(result.bugEligible).toBe(false);
    expect(result.retryAllowed).toBe(true);
  });

  test("D: a timedOut attempt is flaky and retryable, never a defect", () => {
    const result = classifyFailure({ message: "Timeout 30000ms exceeded.", reporterStatus: "timedOut" });
    expect(result.category).toBe("D. FLAKY / TRANSIENT FAILURE");
    expect(result.bugEligible).toBe(false);
    expect(result.retryAllowed).toBe(true);
  });

  test("D: 503 service unavailable is transient", () => {
    const result = classifyFailure({ message: SERVICE_UNAVAILABLE });
    expect(result.category).toBe("D. FLAKY / TRANSIENT FAILURE");
    expect(result.retryAllowed).toBe(true);
    expect(result.bugEligible).toBe(false);
  });

  test("E: blocked exploration is a missing requirement", () => {
    const result = classifyFailure({ message: "could not reach target", explorationStatus: "BLOCKED" });
    expect(result.category).toBe("E. BLOCKED / MISSING REQUIREMENT");
    expect(result.bugEligible).toBe(false);
  });

  test("E: an explicit authentication wall is a missing requirement", () => {
    const result = classifyFailure({ message: AUTH_WALL });
    expect(result.category).toBe("E. BLOCKED / MISSING REQUIREMENT");
    expect(result.bugEligible).toBe(false);
  });

  test("E: failed exploration is a missing requirement", () => {
    const result = classifyFailure({ message: "exploration aborted", explorationStatus: "FAILED" });
    expect(result.category).toBe("E. BLOCKED / MISSING REQUIREMENT");
  });
});

test.describe("safety properties", () => {
  test("an unrecognised failure is never Jira-eligible", () => {
    const result = classifyFailure({ message: UNRECOGNIZED });
    expect(result.bugEligible).toBe(false);
    expect(result.category).not.toBe("A. REAL APPLICATION DEFECT");
    expect(result.rationale).toContain("human review");
  });

  test("A is reachable only with an expected/received diff", () => {
    // Same runner output, but no expected/received block: not a defect.
    const withoutDiff = `Error: expect(locator).toContainText(expected) failed

Locator: getByRole('heading', { name: 'Welcome back' })
Timeout: 5000ms
`;
    const result = classifyFailure({ message: withoutDiff, reporterStatus: "failed" });
    expect(result.category).not.toBe("A. REAL APPLICATION DEFECT");
    expect(result.bugEligible).toBe(false);
  });

  test("a bare 'timeout' in the assertion budget does not become flaky", () => {
    // A passing-then-mismatching assertion head always carries "Timeout: 5000ms".
    expect(VERIFIED_MISMATCH).toContain("Timeout: 5000ms");
    const result = classifyFailure({ message: VERIFIED_MISMATCH, reporterStatus: "failed" });
    expect(result.category).toBe("A. REAL APPLICATION DEFECT");
  });

  test("the bare word 'unknown' no longer forces category E", () => {
    const result = classifyFailure({ message: "unknown error while tearing down the worker" });
    expect(result.category).not.toBe("E. BLOCKED / MISSING REQUIREMENT");
  });

  test("a removed element is not auto-filed, and healing still flags human review", () => {
    const result = classifyFailure({ message: LOCATOR_NOT_FOUND, reporterStatus: "failed" });
    expect(result.bugEligible).toBe(false);
    // Phase 3C: the removed-element signal survives in the rationale and in the
    // healing layer's HUMAN_REVIEW_REQUIRED flag, rather than as a Jira defect.
    expect(result.rationale).toContain("HUMAN_REVIEW_REQUIRED");
    expect(result.rationale).toContain("not auto-filed");
  });
});

test.describe("removed element versus genuine mismatch", () => {
  test("toBeVisible on a removed element is B, not an auto-confirmed defect", () => {
    // The payload DOES carry an expected/received diff, so the category A gate
    // would otherwise claim it. Only the literal Received placeholder
    // "<element(s) not found>" reveals the element never resolved.
    const result = classifyFailure({ message: REMOVED_ELEMENT_VISIBLE, reporterStatus: "failed" });
    expect(result.category).toBe("B. AUTOMATION / TEST IMPLEMENTATION ISSUE");
    expect(result.bugEligible).toBe(false);
  });

  test("a removed element is surfaced for human review rather than lost", () => {
    const result = classifyFailure({ message: REMOVED_ELEMENT_VISIBLE, reporterStatus: "failed" });
    // It is B (we cannot prove a contract mismatch), but the "possible real
    // application change" must remain visible so a human can promote it.
    expect(result.rationale).toContain("HUMAN_REVIEW_REQUIRED");
    expect(result.rationale).toContain("possible real application change");
  });

  test("toHaveURL mismatch stays A", () => {
    const result = classifyFailure({ message: URL_MISMATCH, reporterStatus: "failed" });
    expect(result.category).toBe("A. REAL APPLICATION DEFECT");
    expect(result.bugEligible).toBe(true);
  });

  test("toHaveText mismatch stays A", () => {
    const result = classifyFailure({ message: TEXT_MISMATCH, reporterStatus: "failed" });
    expect(result.category).toBe("A. REAL APPLICATION DEFECT");
    expect(result.bugEligible).toBe(true);
  });

  test("the same three cases separate correctly in one batch", () => {
    const categories = [REMOVED_ELEMENT_VISIBLE, URL_MISMATCH, TEXT_MISMATCH].map((message) => classifyFailure({ message, reporterStatus: "failed" }).category.slice(0, 1));
    expect(categories).toEqual(["B", "A", "A"]);
  });
});

test.describe("payload scoping helpers", () => {
  test("messageHead excludes the call log and the code frame", () => {
    const head = messageHead(VERIFIED_MISMATCH);
    expect(head).toContain("Expected substring:");
    expect(head).not.toContain("Call log:");
    expect(head).not.toContain("locator resolved to");
  });

  test("messageHead keeps the locator report line", () => {
    // "Locator:" names the locator that was used; it is not a failure signal.
    expect(messageHead(VERIFIED_MISMATCH)).toContain("Locator: getByRole('heading'");
  });

  test("reporterBody keeps the call log but drops the code frame and stack", () => {
    const body = reporterBody(LOCATOR_NOT_FOUND);
    expect(body).toContain("LOCATOR_NOT_FOUND");
    expect(body).not.toContain("toBeVisible()");
    expect(body).not.toContain("resolved to 0");
  });

  test("reporterBody still exposes call log entries", () => {
    expect(reporterBody(VERIFIED_MISMATCH)).toContain("locator resolved to <h1>Welcome back</h1>");
  });

  test("ANSI colour codes never block a match", () => {
    const coloured = VERIFIED_MISMATCH.replace("Expected substring:", "[32mExpected substring:[39m");
    const result = classifyFailure({ message: coloured, reporterStatus: "failed" });
    expect(result.category).toBe("A. REAL APPLICATION DEFECT");
  });
});

test.describe("real captured payload", () => {
  test("the real integration-defect failure is category A and Jira-eligible", () => {
    // Captured verbatim from a real run of tests/integration/approved-run-healing.spec.ts
    // ("run-approved routes a real assertion failure to Jira dry-run defect output").
    // Embedded here rather than read from reports/ so this guard runs in a fresh
    // clone, where reports/ is gitignored and absent. ANSI colour codes and the
    // spec code frame are preserved on purpose: the frame quotes the generated
    // healing regex containing "no element", "not found" and "resolved to 0",
    // which must not be mistaken for this run's failure reason.
    const result = classifyFailure({ message: STORED_INTEGRATION_DEFECT_ERROR, reporterStatus: "failed" });
    expect(result.category).toBe("A. REAL APPLICATION DEFECT");
    expect(result.bugEligible).toBe(true);
    expect(result.retryAllowed).toBe(false);
  });

  test("the embedded payload still contains the traps it is meant to guard", () => {
    // Guards the guard: if this payload is ever trimmed, the test above could
    // pass for the wrong reason.
    expect(STORED_INTEGRATION_DEFECT_ERROR).toContain("Expected substring:");
    expect(STORED_INTEGRATION_DEFECT_ERROR).toContain("Received string:");
    expect(STORED_INTEGRATION_DEFECT_ERROR).toContain("\u001b[");   // ANSI preserved
    expect(STORED_INTEGRATION_DEFECT_ERROR).toContain("no element"); // spec source trap
    expect(STORED_INTEGRATION_DEFECT_ERROR).toContain("resolved to 0"); // spec source trap
  });
});