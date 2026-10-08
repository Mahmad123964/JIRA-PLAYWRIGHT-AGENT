import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";
import { aggregateFinalReport, saveFinalReport, finalReportText, collectHumanReview, humanReviewLabel } from "../../src/final-report";

/**
 * Renders runResult through the real pipeline (aggregateFinalReport ->
 * saveFinalReport -> scripts/report-pdf.js's page.pdf()) and extracts the
 * PDF's text. Needs a real Chromium launch, so it lives here rather than in
 * tests/unit, which is documented as pure and fast with no browser.
 */
async function renderPdfText(runId: string, result: Record<string, unknown>): Promise<{ report: ReturnType<typeof aggregateFinalReport>; pdfText: string }> {
  const report = aggregateFinalReport(runId, result);
  const reportPath = saveFinalReport(report, `reports/${runId}/final-report-test.json`);
  const pdfPath = path.resolve(`reports/${runId}/qa-report-test.pdf`);
  const { main } = require("../../scripts/report-pdf.js");
  const originalArgv = process.argv;
  process.argv = [originalArgv[0], originalArgv[1], reportPath, pdfPath];
  try {
    await main();
  } finally {
    process.argv = originalArgv;
  }
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  const textData = await parser.getText();
  return { report, pdfText: (textData.pages || []).map((p) => p.text || "").join("\n") };
}

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
        diagnosis: { category: "B. AUTOMATION / TEST IMPLEMENTATION ISSUE", rationale: REMOVED_RATIONALE, bugEligible: false },
      }],
    },
    healing: [{ outcome: "NOT_HEALED", attempts: [], reason: "No candidate passed strict live validation and original assertion re-execution; HUMAN_REVIEW_REQUIRED" }],
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
    audit: [{ phase: "APPROVAL", action: "APPROVED" }],
  };
}

const PLANTED_FAKE_SECRET = "ATATT3xFfGF0rZ1234567890abcdefFAKE";

function runResultWithPlantedSecret() {
  return {
    ...runResult(),
    execution: {
      ...runResult().execution,
      failures: [{
        path: "generated/Demo/TC-DEMO.spec.ts",
        diagnosis: { category: "A. REAL APPLICATION DEFECT" },
        error: `Request failed. JIRA_API_TOKEN=${PLANTED_FAKE_SECRET}`,
      }],
    },
  };
}

test("every required section heading survives real PDF rendering and text extraction", async () => {
  const { pdfText } = await renderPdfText("pdf-headings", runResult());
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
    expect(pdfText).toContain(heading);
  }
});

test("a report longer than 5000 characters is not truncated", async () => {
  const result = runResult();
  // 50 audit entries x ~150 chars each comfortably exceeds the old 5000-char
  // cut. The last entry's unique marker must survive if nothing is truncated.
  const bigAudit = Array.from({ length: 50 }, (_, i) => ({
    phase: "PADDING",
    action: `PADDING_ACTION_${i}`,
    decision: `decision-${i}`,
    reason: `padding reason entry number ${i} repeated to add bulk and exceed five thousand characters total across the whole report`,
  }));
  bigAudit.push({ phase: "MARKER", action: "FINAL_AUDIT_MARKER", decision: "UNIQUE_END_OF_REPORT_MARKER_7f3a9c", reason: "last entry" });
  (result as Record<string, unknown>).audit = bigAudit;
  const { pdfText } = await renderPdfText("pdf-long-report", result);
  expect(pdfText.length).toBeGreaterThan(5000);
  expect(pdfText).toContain("UNIQUE_END_OF_REPORT_MARKER_7f3a9c");
});

test("a very long single line wraps instead of being clipped at the page edge", async () => {
  const result = runResult();
  // A single unbroken token (no spaces) long enough that the old
  // single-row-per-report layout would have run off the page and been
  // clipped well before the end. CSS word-break: break-word wraps it instead.
  const longToken = `START_MARKER_${"X".repeat(3000)}_END_MARKER`;
  (result.execution as Record<string, unknown>).tests = [{ path: "long.spec.ts", title: "Long error case", status: "FAIL", durationMs: 5, source: "playwright-json", error: longToken }];
  (result.execution as Record<string, unknown>).failures = [{ path: "long.spec.ts", diagnosis: { category: "A. REAL APPLICATION DEFECT" }, error: longToken }];
  const { pdfText } = await renderPdfText("pdf-long-line", result);
  // Word-wrap legitimately inserts a line break somewhere inside the 3000-char
  // run (that is the fix working), and pdf-parse's text extraction turns that
  // visual wrap point into a newline -- which can land mid-marker (observed:
  // "_E" / "ND_MARKER" split across two lines). Stripping whitespace proves
  // the content survived intact regardless of exactly where it wrapped,
  // without re-demanding the old single-unbroken-line layout this fix removed.
  const collapsed = pdfText.replace(/\s+/g, "");
  expect(collapsed).toContain("START_MARKER_");
  expect(collapsed).toContain("_END_MARKER");
  expect(collapsed).toContain("X".repeat(100));
});

test("BLOCKED and SKIPPED results never render as PASS", async () => {
  const result = runResult();
  (result.execution as Record<string, unknown>).tests = [
    { path: "blocked.spec.ts", title: "Blocked case", status: "BLOCKED", durationMs: 0, source: "playwright-json-no-tests" },
    { path: "skipped.spec.ts", title: "Skipped case", status: "SKIPPED", durationMs: 0, source: "playwright-json" },
  ];
  const { pdfText } = await renderPdfText("pdf-blocked-skipped", result);
  expect(pdfText).toContain("BLOCKED");
  expect(pdfText).toContain("SKIPPED");
  // Neither row claims PASS: the real status text for each case is the only
  // status text adjacent to its own title.
  expect(pdfText).not.toMatch(/Blocked case[\s\S]{0,40}PASS\b/);
  expect(pdfText).not.toMatch(/Skipped case[\s\S]{0,40}PASS\b/);
});

test("the generated PDF never contains the planted secret text", async () => {
  const { pdfText } = await renderPdfText("secret-test", runResultWithPlantedSecret());
  expect(pdfText).not.toContain(PLANTED_FAKE_SECRET);
  const pdfPath = path.resolve("reports/secret-test/qa-report-test.pdf");
  const pdfBytes = fs.readFileSync(pdfPath);
  expect(pdfBytes.includes(Buffer.from(PLANTED_FAKE_SECRET))).toBe(false);
});

// report-pdf.js must render the same sentence as humanReviewLabel(), never a
// hand-rebuilt one.

test("PDF and JSON agree: zero signals", async () => {
  const { report, pdfText } = await renderPdfText("human-review-none", runResult());
  const expected = humanReviewLabel(report.sections.humanReview as ReturnType<typeof collectHumanReview>);
  expect(expected).toBe("NEEDS HUMAN REVIEW: none");
  expect(finalReportText(report)).toContain(expected);
  expect(pdfText).toContain(expected);
});

test("PDF and JSON agree: a signal attributed to a single failing test", async () => {
  const { report, pdfText } = await renderPdfText("human-review-attributed", removedElementRun());
  const humanReview = report.sections.humanReview as ReturnType<typeof collectHumanReview>;
  const expected = humanReviewLabel(humanReview);
  expect(humanReview.distinctTests).toBe(1);
  expect(expected).toContain("across 1 failing test");
  expect(finalReportText(report)).toContain(expected);
  expect(pdfText).toContain(expected);
});

test("PDF and JSON agree: a run-level signal with distinctTests = 0, and the real PDF text is shown", async () => {
  const runLevelResult = {
    runId: "human-review-run-level",
    status: "FAILED",
    environment: "test",
    execution: { totals: { total: 2, passed: 0, failed: 2, blocked: 0, skipped: 0 }, failures: [{ path: "a.spec.ts" }, { path: "b.spec.ts" }] },
    healing: [{ outcome: "NOT_HEALED", attempts: [], reason: "No candidate passed strict live validation and original assertion re-execution; HUMAN_REVIEW_REQUIRED" }],
  };
  const { report, pdfText } = await renderPdfText("human-review-run-level", runLevelResult);
  const humanReview = report.sections.humanReview as ReturnType<typeof collectHumanReview>;
  const expected = humanReviewLabel(humanReview);
  expect(humanReview.count).toBe(1);
  expect(humanReview.distinctTests).toBe(0);
  expect(expected).toBe("NEEDS HUMAN REVIEW: 1 finding (run-level; no single failing test could be attributed)");
  expect(finalReportText(report)).toContain(expected);
  expect(pdfText).toContain(expected);
  console.log("Real PDF text (run-level case):\n" + pdfText);
});
