import { test, expect } from "@playwright/test";
import { renderReportHtml } from "../../src/report-html";
import { aggregateFinalReport } from "../../src/final-report";

/**
 * Fast, pure structural checks on the HTML renderer -- no browser launch.
 * tests/integration/report-pdf-html.spec.ts covers the same content surviving
 * real PDF rendering and text extraction.
 */

function baseRunResult() {
    return {
        runId: "html-test",
        status: "PARTIAL",
        environment: "test",
        exploration: { target: { url: "http://fixture", module: "Demo", scope: "Login" }, explorationStatus: "SUCCESS" },
        approval: { blockedCases: [{ testCaseId: "TC-BLOCKED", reason: "NEEDS_HUMAN_INPUT" }] },
        testCases: [{ testCaseId: "TC-PASS", status: "READY_FOR_AUTOMATION", sourceRequirements: ["Req 1"], steps: [{ expectedAssertion: { type: "visible" } }] }],
        execution: {
            totals: { total: 3, passed: 1, failed: 1, blocked: 1, skipped: 0 },
            tests: [
                { path: "a.spec.ts", title: "A passes", status: "PASS", durationMs: 10, source: "playwright-json" },
                { path: "b.spec.ts", title: "B is blocked", status: "BLOCKED", durationMs: 0, source: "playwright-json-no-tests" },
                { path: "c.spec.ts", title: "C fails", status: "FAIL", durationMs: 20, source: "playwright-json", error: "Expected: 1\nReceived: 2" },
            ],
            failures: [{ path: "c.spec.ts", diagnosis: { category: "A. REAL APPLICATION DEFECT" } }],
        },
        healing: [{ outcome: "PASS_AFTER_HEALING", attempts: [{ originalLocator: "old-locator", candidate: "new-locator", confidence: 0.9, validationResult: "PASS" }], suggestedPatch: { originalLocator: "old-locator", replacement: "new-locator", confidence: 0.9 } }],
        evidence: { artifacts: [{ kind: "log", status: "AVAILABLE", path: "test-results/html-test/runner.log" }] },
        audit: [{ timestamp: "2026-01-01T00:00:00.000Z", phase: "APPROVAL", action: "APPROVED", decision: "APPROVED" }],
    };
}

test("every required section heading is present", () => {
    const report = aggregateFinalReport("html-test", baseRunResult());
    const html = renderReportHtml(report);
    for (const heading of [
        "Run summary",
        "Needs human review",
        "Smoke suite",
        "Regression suite",
        "Requirement coverage",
        "Results table",
        "Failure classification",
        "Healing log",
        "Evidence index",
        "Audit trail",
        "Blockers and limitations",
    ]) {
        expect(html).toContain(heading);
    }
});

test("failure classification shows all five categories, zero-filled", () => {
    const report = aggregateFinalReport("html-test", baseRunResult());
    const html = renderReportHtml(report);
    for (const category of [
        "A. REAL APPLICATION DEFECT",
        "B. AUTOMATION / TEST IMPLEMENTATION ISSUE",
        "C. ENVIRONMENT / INFRASTRUCTURE ISSUE",
        "D. FLAKY / TRANSIENT FAILURE",
        "E. BLOCKED / MISSING REQUIREMENT",
    ]) {
        expect(html).toContain(category);
    }
});

test("a BLOCKED result renders its real status, never PASS", () => {
    const report = aggregateFinalReport("html-test", baseRunResult());
    const html = renderReportHtml(report);
    // The blocked row carries status-blocked and the literal text BLOCKED; it
    // must not be rendered inside a status-pass element.
    expect(html).toMatch(/status-blocked">BLOCKED</);
    expect(html).not.toMatch(/status-pass">BLOCKED</);
});

test("healing log shows original locator, candidate, confidence and a not-applied-automatically note", () => {
    const report = aggregateFinalReport("html-test", baseRunResult());
    const html = renderReportHtml(report);
    expect(html).toContain("old-locator");
    expect(html).toContain("new-locator");
    expect(html).toContain("0.9");
    expect(html).toContain("not applied automatically");
});

test("there is no length truncation in the renderer itself", () => {
    const longError = "E".repeat(20000);
    const result = baseRunResult();
    (result.execution.tests as Array<Record<string, unknown>>)[2].error = longError;
    const report = aggregateFinalReport("html-test", result);
    const html = renderReportHtml(report);
    expect(html).toContain(longError);
});

// Real Playwright error text, captured verbatim from a run of
// `npm run demo`'s TC-DEMO-DEFECT case (reports/<runId>/approved-run-result.json,
// execution.tests[].error) -- not a synthetic approximation of ANSI codes.
const REAL_ANSI_ERROR = "Error: \u001b[2mexpect(\u001b[22m\u001b[31mlocator\u001b[39m\u001b[2m).\u001b[22mtoContainText\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m failed\n\nLocator: getByRole('heading', { name: 'Welcome back' })\nExpected substring: \u001b[32m\"Wrong heading\"\u001b[39m\nReceived string:    \u001b[31m\"Welcome back\"\u001b[39m";

test("ANSI color-code escape sequences are stripped from rendered text", () => {
    const result = baseRunResult();
    (result.execution.tests as Array<Record<string, unknown>>)[2].error = REAL_ANSI_ERROR;
    const report = aggregateFinalReport("html-test", result);
    const html = renderReportHtml(report);
    // The raw escape bytes must be gone...
    expect(html).not.toContain("\u001b[");
    // ...and the real message text survives intact (quotes are HTML-escaped
    // by the same esc() pass, same as any other rendered text).
    expect(html).toContain("expect(locator).toContainText(expected) failed");
    expect(html).toContain("Expected substring: &quot;Wrong heading&quot;");
    expect(html).toContain("Received string:    &quot;Welcome back&quot;");
});
