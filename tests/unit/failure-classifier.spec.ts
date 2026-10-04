import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
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

test.describe("stored run artifacts", () => {
  const reportPath = path.resolve("reports/integration-defect/approved-run-result.json");
  test.skip(!fs.existsSync(reportPath), "requires reports/integration-defect from a previous integration run");

  test("the stored integration-defect failure is still category A and Jira-eligible", () => {
    const stored = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const failing = stored.execution.tests.find((item: { status: string }) => item.status === "FAIL");
    const result = classifyFailure({ message: failing.error, reporterStatus: "failed" });
    expect(result.category).toBe("A. REAL APPLICATION DEFECT");
    expect(result.bugEligible).toBe(true);
  });
});