import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { aggregateFinalReport, saveFinalReport, finalReportText } from "../../src/final-report";

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
