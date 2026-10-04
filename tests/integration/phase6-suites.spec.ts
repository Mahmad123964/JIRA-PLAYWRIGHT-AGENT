import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { loadSmokeConfig, suiteOutcomeFor } from "../../src/smoke-config";
import { readStoredRuns, buildLastKnownResults, buildApprovedSpecIndex, selectRegressionSpecs } from "../../src/regression-selection";
import { discoverRegressionTests } from "../../src/test-discovery";
import { aggregateFinalReport, normalizeSuiteSection } from "../../src/final-report";

/**
 * Phase 6 integration coverage.
 *
 * Runs the real discovery + selection logic over this repository's ACTUAL
 * on-disk state (real qa.config.json, real tests/generated specs, real stored
 * approved-run results), then asserts the reporting contract: a suite that did
 * not run, or that is not clean, is never presented as a pass.
 */

const REPO_ROOT = path.resolve(".");

test("the committed smoke config resolves to real specs on disk", () => {
  const config = loadSmokeConfig(REPO_ROOT);
  expect(config.configured).toBe(true);
  expect(config.paths.length).toBeGreaterThan(0);
  for (const declared of config.paths) {
    expect(fs.existsSync(path.resolve(REPO_ROOT, declared))).toBe(true);
  }
});

test("regression selection over real repository state excludes the non-application suites", () => {
  const runs = readStoredRuns(path.resolve(REPO_ROOT, "reports"));
  const discovered = discoverRegressionTests(REPO_ROOT);

  // Discovery is scoped to the application suites only.
  for (const spec of discovered.paths) {
    expect(spec.startsWith("tests/generated/") || spec.startsWith("tests/api/")).toBe(true);
  }

  const lastKnown = buildLastKnownResults(runs, REPO_ROOT);
  const approved = buildApprovedSpecIndex({ runs, testCasesRoot: path.resolve(REPO_ROOT, "test-cases"), root: REPO_ROOT });
  const { included, candidates } = selectRegressionSpecs({ specPaths: discovered.paths, root: REPO_ROOT, lastKnown, approved });

  // Every candidate carries an auditable reason, and nothing is included by accident.
  expect(candidates.length).toBe(discovered.paths.length);
  for (const candidate of candidates) {
    expect(candidate.reason).toMatch(/^(included|excluded):/);
    if (candidate.included) {
      // Included implies BOTH a READY approval and a real per-test PASS baseline.
      expect(candidate.approvalStatus).toBe("READY_FOR_AUTOMATION");
      expect(candidate.lastSource).toBe("playwright-json");
      expect(candidate.lastStatus).toBe("PASS");
    }
  }
  expect(included.every((spec) => candidates.find((item) => item.specPath === spec)?.included)).toBe(true);
});

test("no stored fallback-sourced result can create a regression baseline", () => {
  const runs = readStoredRuns(path.resolve(REPO_ROOT, "reports"));
  const lastKnown = buildLastKnownResults(runs, REPO_ROOT);
  for (const entry of lastKnown.values()) {
    expect(entry.source).toBe("playwright-json");
  }
});

test("an empty regression selection is reported as not configured, not as a pass", () => {
  const outcome = suiteOutcomeFor({ total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 });
  const section = normalizeSuiteSection({ suite: "regression", outcome: "SKIPPED_NOT_CONFIGURED", configured: true, executed: false, reason: "no spec met the bar" });
  expect(section!.pass).toBe(false);
  expect(outcome).toBe("BLOCKED");
});

test("the final report merges both suite sections and never shows a non-pass as a pass", () => {
  const report = aggregateFinalReport("phase6-it", { status: "SUCCESS", execution: { totals: { total: 1, passed: 1, failed: 0, blocked: 0, skipped: 0 } } }, {
    smoke: { suite: "smoke", outcome: "SUCCESS", configured: true, executed: true, totals: { total: 1, passed: 1, failed: 0, blocked: 0, skipped: 0 } },
    regression: { suite: "regression", outcome: "SKIPPED_NOT_CONFIGURED", configured: true, executed: false, reason: "nothing qualified" },
  });
  expect((report.sections.smoke as { pass: boolean }).pass).toBe(true);
  expect((report.sections.regression as { pass: boolean }).pass).toBe(false);
  // Neither suite may leak into the run-level status.
  expect(report.status).toBe("SUCCESS");
});
