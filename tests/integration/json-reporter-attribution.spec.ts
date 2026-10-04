import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { executePlaywright } from "../../src/execution-engine";

// End-to-end proof that per-test attribution now comes from Playwright's JSON
// reporter instead of the exit-code fallback.
//
// These assertions deliberately do NOT grep stdout for `"status": "passed"`:
// that check passed even when every real test result was discarded, because the
// raw JSON is always present in stdout regardless of how it was parsed.
//
// The fixture spec is generated at test time into tests/integration/fixtures/,
// which is outside the suites normal collection covers (tests/unit,
// tests/generated, tests/api) and is removed afterwards -- so the deliberately
// failing test never pollutes a normal run. Playwright refuses explicit spec
// paths outside its configured testDir, which is why this cannot live in the
// OS temp directory.
//
// CRASH SAFETY. If the process is killed, afterAll never runs and the file
// survives. Three layers keep that harmless:
//   1. the generated name is unique per run, so a survivor cannot collide with
//      or overwrite a concurrent run's fixture;
//   2. .gitignore covers the pattern, so a survivor is never committed;
//   3. every test in the generated file is guarded by QA_RUN_GENERATED_FIXTURES,
//      so a survivor is collected but skips itself during normal runs and
//      cannot fail or pollute a result. playwright.config.ts testIgnore was NOT
//      used for this because testIgnore also blocks the explicit invocation
//      this test depends on.

const FIXTURE_DIR = path.resolve("tests/integration/fixtures");
const FIXTURE_PREFIX = "json-attribution-generated-";
const FIXTURE_GLOB = new RegExp(`^${FIXTURE_PREFIX}.*\\.spec\\.ts$`);
const FIXTURE = path.join(FIXTURE_DIR, `${FIXTURE_PREFIX}${process.pid}-${Date.now()}.spec.ts`);
const FIXTURE_GUARD = "QA_RUN_GENERATED_FIXTURES";

const FIXTURE_SOURCE = `import { test, expect } from '@playwright/test';

// Layer 3 of crash safety: a surviving generated file collects but never runs.
const active = !!process.env.${FIXTURE_GUARD};
test.describe('generated attribution fixture', () => {
  test.skip(!active, 'generated fixture: only runs when ${FIXTURE_GUARD} is set');

  test('generated passing case', async ({ page }) => {
    await page.goto('data:text/html,<h1>attribution probe</h1>');
    await expect(page.locator('h1')).toHaveText('attribution probe');
  });

  test('generated failing case', async () => {
    expect('actual value').toBe('DELIBERATE ATTRIBUTION FAILURE');
  });

  test('generated skipped case', async () => {
    test.skip(true, 'deliberate skip for attribution coverage');
  });
});
`;

function sweepStaleFixtures(): void {
  if (!fs.existsSync(FIXTURE_DIR)) return;
  for (const entry of fs.readdirSync(FIXTURE_DIR)) {
    if (FIXTURE_GLOB.test(entry)) fs.rmSync(path.join(FIXTURE_DIR, entry), { force: true });
  }
}

test.describe("real Playwright execution attribution", () => {
  test.beforeAll(() => {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    sweepStaleFixtures();
    fs.writeFileSync(FIXTURE, FIXTURE_SOURCE, "utf8");
    // Inherited by the nested Playwright process via executePlaywright's env.
    process.env[FIXTURE_GUARD] = "1";
  });

  test.afterAll(() => {
    delete process.env[FIXTURE_GUARD];
    if (fs.existsSync(FIXTURE)) fs.rmSync(FIXTURE, { force: true });
  });

  test("reports real per-test results instead of one exit-code fallback entry", async () => {
    const startedAt = Date.now();
    const result = await executePlaywright([FIXTURE], { runId: "json-attribution", captureArtifacts: false });
    const wallClockMs = Date.now() - startedAt;

    // A fallback would collapse the whole invocation into exactly ONE entry.
    expect(result.tests).toHaveLength(3);

    for (const entry of result.tests) {
      expect(entry.source).toBe("playwright-json");
      expect(entry.source).not.toBe("exit-code-fallback");
    }

    const passing = result.tests.find((item) => item.title === "generated passing case");
    const failing = result.tests.find((item) => item.title === "generated failing case");
    const skipped = result.tests.find((item) => item.title === "generated skipped case");

    expect(passing).toBeDefined();
    expect(failing).toBeDefined();
    expect(skipped).toBeDefined();

    expect(passing!.status).toBe("PASS");
    expect(failing!.status).toBe("FAIL");
    expect(skipped!.status).toBe("SKIPPED");

    // The failure is attributed to the failing test, with a real message.
    expect(failing!.error).toContain("DELIBERATE ATTRIBUTION FAILURE");
    expect(failing!.path).toContain(FIXTURE_PREFIX);

    // Duration is the test's own, not wall-clock (which includes booting node
    // and Playwright and therefore always exceeds any single test).
    expect(passing!.durationMs).toBeGreaterThan(0);
    expect(passing!.durationMs).toBeLessThan(wallClockMs);
    expect(wallClockMs).toBeGreaterThan(passing!.durationMs);

    expect(result.totals).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1, blocked: 0 });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].title).toBe("generated failing case");
  });

  test("a missing test path is reported as no-tests, not as a fallback pass", async () => {
    const result = await executePlaywright(["tests/does-not-exist-1b.spec.ts"], { runId: "json-no-tests", captureArtifacts: false });
    expect(result.tests).toHaveLength(1);
    // Parsable JSON with zero tests is NOT an exit-code fallback.
    expect(result.tests[0].source).toBe("playwright-json-no-tests");
    expect(result.tests[0].source).not.toBe("exit-code-fallback");
    expect(["FAIL", "BLOCKED"]).toContain(result.tests[0].status);
    expect(result.tests[0].error).toContain("No tests found");
  });
});