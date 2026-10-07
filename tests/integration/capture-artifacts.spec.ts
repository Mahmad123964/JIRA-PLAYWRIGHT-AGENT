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

  // Results must come from a real JSON reporter payload, NOT the exit-code
  // fallback. Grepping stdout proves nothing about how stdout was parsed --
  // the raw payload is present either way -- so attribution is asserted on the
  // parsed result itself: a real spec title, the reporter as the source, and
  // the test's own duration rather than wall-clock.
  expect(result.tests[0].source).toBe("playwright-json");
  expect(result.tests[0].title).toBe("artifact capture self check");
  expect(result.tests[0].status).toBe("PASS");
  expect(result.tests[0].durationMs).toBeGreaterThan(0);
  expect(result.totals).toMatchObject({ total: 1, passed: 1, failed: 0 });
});

test("captureArtifacts false also executes cleanly", async () => {
  const result = await executePlaywright(["tests/integration/fixtures/selfcheck.spec.ts"], {
    runId: "capture-artifacts-disabled",
    captureArtifacts: false,
  });

  expect(result.command).not.toContain("--trace");
  expect(result.exitCode).toBe(0);
  expect(result.tests[0].source).toBe("playwright-json");
  expect(result.tests[0].status).toBe("PASS");
});

/**
 * Regression guard for shared test-results/ clobbering concurrent nested runs.
 *
 * Before this fix, a caller that omitted outputDir fell back to Playwright's
 * own default output directory ("<cwd>/test-results"), which Playwright wipes
 * at startup. Two such nested runs executing concurrently -- exactly what
 * happens under the integration suite's default multi-worker execution --
 * could delete each other's artifacts mid-run. The engine now always resolves
 * a private, salted --output directory per call, even when every caller uses
 * the SAME runId, so concurrent runs can never share one.
 */
test("concurrent nested runs with the same runId get isolated output directories", async () => {
  const [first, second] = await Promise.all([
    executePlaywright(["tests/integration/fixtures/selfcheck.spec.ts"], { runId: "same-run-id" }),
    executePlaywright(["tests/integration/fixtures/selfcheck.spec.ts"], { runId: "same-run-id" }),
  ]);

  const outputDirOf = (command: string): string => {
    const match = command.match(/--output\s+(\S+)/);
    if (!match) throw new Error(`--output flag not found in command: ${command}`);
    return match[1];
  };

  const firstOutputDir = outputDirOf(first.command);
  const secondOutputDir = outputDirOf(second.command);

  expect(firstOutputDir).not.toBe(secondOutputDir);
  expect(first.exitCode).toBe(0);
  expect(second.exitCode).toBe(0);
  expect(first.tests[0].status).toBe("PASS");
  expect(second.tests[0].status).toBe("PASS");
});
