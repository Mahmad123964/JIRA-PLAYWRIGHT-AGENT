import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { aggregateFinalReport, saveFinalReport, finalReportText, collectHumanReview } from "../../src/final-report";

const REMOVED_RATIONALE = "The locator did not resolve to the intended element, so the test never reached the assertion and no contract mismatch can be proven. A removed or renamed element is a possible real application change: validated-healing flags it as HUMAN_REVIEW_REQUIRED for a human to judge, and it is not auto-filed as a defect.";

function removedElementRun() {
    return {
        runId: "removed-element",
        status: "FAILED",
        environment: "test",
        execution: {
            totals: { total: 1, passed: 0, failed: 1, blocked: 0, skipped: 0 },
            failures: [{
                path: "generated/DemoRemoved/TC-DEMO-REMOVED.spec.ts",
                title: "TC-DEMO-REMOVED: Removed element",
                status: "FAIL",
                diagnosis: { category: "B. AUTOMATION / TEST IMPLEMENTATION ISSUE", rationale: REMOVED_RATIONALE, bugEligible: false }
            }]
        },
        healing: [{ outcome: "NOT_HEALED", attempts: [], reason: "No candidate passed strict live validation and original assertion re-execution; HUMAN_REVIEW_REQUIRED" }]
    };
}

function runResult() {
    return {
        runId: "final-test",
        status: "PARTIAL",
        environment: "test",
        exploration: { target: { url: "http://fixture", module: "Demo", scope: "Login" }, explorationStatus: "SUCCESS" },
        approval: { blockedCases: [{ testCaseId: "TC-BLOCKED", reason: "NEEDS_HUMAN_INPUT" }] },
        testCases: [{ testCaseId: "TC-PASS", status: "READY_FOR_AUTOMATION" }, { testCaseId: "TC-BLOCKED", status: "PENDING_APPROVAL" }],
        execution: { totals: { total: 4, passed: 1, failed: 1, blocked: 1, skipped: 1 }, failures: [{ diagnosis: { category: "A. REAL APPLICATION DEFECT" } }] },
        healing: [{ outcome: "PASS_AFTER_HEALING", attempts: [] }],
        evidence: { artifacts: [{ kind: "log", status: "AVAILABLE", path: "test-results/final-test/runner.log" }, { kind: "trace", status: "UNAVAILABLE", path: "test-results/final-test/missing.zip" }] },
        audit: [{ phase: "APPROVAL", action: "APPROVED" }]
    };
}

test("aggregates mixed statuses and keeps healing at one final-report location", () => {
    const report = aggregateFinalReport("final-test", runResult()); expect(report.status).toBe("PARTIAL"); expect(report.sections.healing).toHaveLength(1); expect(report.status).not.toBe("SUCCESS");
    expect((report.sections.execution as { totals: { passed: number; blocked: number; skipped: number } }).totals.passed).toBe(1); expect((report.sections.execution as { totals: { blocked: number; skipped: number } }).totals.blocked).toBe(1);
});

test("missing evidence is explicitly listed", () => { const report = aggregateFinalReport("final-test", runResult()); expect(report.evidence.some((item) => item.status === "MISSING" && item.path.endsWith("missing.zip"))).toBe(true); });

test("final report text preserves blocked status", () => { const report = aggregateFinalReport("final-test", runResult()); expect(finalReportText(report)).toContain("Status: PARTIAL"); });

test("final report persists sanitized JSON", () => { const report = aggregateFinalReport("final-test", runResult()); const output = saveFinalReport(report, "reports/final-test/final-report-test.json"); expect(fs.existsSync(path.resolve(output))).toBe(true); expect(fs.readFileSync(output, "utf8")).not.toContain("JIRA_API_TOKEN="); });

test("a removed element is surfaced as a visible human-review section, not buried in rationale text", () => {
    const report = aggregateFinalReport("removed-element", removedElementRun());
    const humanReview = report.sections.humanReview as { count: number; distinctTests: number; items: Array<{ source: string; reason: string; possibleRealDefect: boolean }> };
    expect(humanReview.count).toBe(2);
    // Two corroborating signals (healing + classification) about one test.
    expect(humanReview.distinctTests).toBe(1);
    expect(humanReview.items.map((item) => item.source)).toEqual(["healing", "failure-classification"]);
    for (const item of humanReview.items) {
        expect(item.possibleRealDefect).toBe(true);
        expect(item.reason).toMatch(/HUMAN_REVIEW_REQUIRED|possible real application change/);
    }
});

test("human review is counted separately from the failure classification buckets", () => {
    // A removed element is category B, so it would otherwise be indistinguishable
    // from an ordinary typo'd selector inside failureClassification.
    const report = aggregateFinalReport("removed-element", removedElementRun());
    expect(report.sections.failureClassification).toEqual({ "B. AUTOMATION / TEST IMPLEMENTATION ISSUE": 1 });
    expect((report.sections.humanReview as { count: number }).count).toBeGreaterThan(0);
});

test("a clean run reports zero human-review cases", () => {
    const report = aggregateFinalReport("final-test", runResult());
    expect((report.sections.humanReview as { count: number }).count).toBe(0);
    expect((report.sections.humanReview as { items: unknown[] }).items).toHaveLength(0);
});

test("final report text states the human-review count and lists each case", () => {
    const text = finalReportText(aggregateFinalReport("removed-element", removedElementRun()));
    expect(text).toContain("NEEDS HUMAN REVIEW: 2 signal(s) across 1 test(s)");
    expect(text).toContain("[healing]");
    expect(text).toContain("[failure-classification]");
    expect(text).toContain("TC-DEMO-REMOVED.spec.ts");
});

test("an unclassified failure is flagged for human review rather than lost", () => {
    const section = collectHumanReview({}, [{
        diagnosis: { category: "B. AUTOMATION / TEST IMPLEMENTATION ISSUE", rationale: "Unclassified: the failure matched no known pattern. Unclassified failures need human review." }
    }]);
    expect(section.count).toBe(1);
    expect(section.items[0].source).toBe("failure-classification");
});
