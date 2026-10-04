import { test, expect } from "@playwright/test";
import { executePlaywright } from "../../src/execution-engine";

/**
 * Regression guard for the --video/--screenshot defect.
 *
 * The engine used to pass `--video retain-on-failure --screenshot only-on-failure`
 * to `playwright test`. Neither is a real CLI option, so Playwright exited with
 * "error: unknown option '--video'" before running anything. This failure was
 * invisible to the suite because every existing test set captureArtifacts: false.
 *
 * captureArtifacts is deliberately omitted here so the DEFAULT (true) path runs.
 */
test("default artifact capture executes a real spec instead of failing on CLI flags", async () => {
  const result = await executePlaywright(["tests/integration/fixtures/selfcheck.spec.ts"], {
    runId: "capture-artifacts-check",
  });

  // The spawned command must not contain the unsupported flags.
  expect(result.command).not.toContain("--video");
  expect(result.command).not.toContain("--screenshot");
  expect(result.command).toContain("--trace");

  // The runner must have started and completed successfully.
  expect(result.exitCode).toBe(0);

  // Results must come from a real JSON reporter payload, NOT the single-test
  // fallback path that executePlaywright synthesises when stdout is not JSON.
  // Without this an exit-code-0 run that produced no output would still pass.
  expect(result.tests[0].stdout).toContain('"suites"');
  expect(result.tests[0].stdout).toContain('"expected": 1');

  // The reporter recorded a real passing test. Asserted against the raw
  // payload on purpose: in Playwright 1.62 the per-attempt outcome moved to
  // tests[].results[].status while tests[].status is now "expected"/"unexpected",
  // so parseJsonReporter currently mis-maps this to FAIL. That is a separate
  // defect (see TODO in src/execution-engine.ts) and is deliberately NOT
  // asserted through here -- this test guards the CLI-flag regression only.
  expect(result.tests[0].stdout).toContain('"status": "passed"');
});

test("captureArtifacts false also executes cleanly", async () => {
  const result = await executePlaywright(["tests/integration/fixtures/selfcheck.spec.ts"], {
    runId: "capture-artifacts-disabled",
    captureArtifacts: false,
  });

  expect(result.command).not.toContain("--trace");
  expect(result.exitCode).toBe(0);
  expect(result.tests[0].stdout).toContain('"status": "passed"');
});
