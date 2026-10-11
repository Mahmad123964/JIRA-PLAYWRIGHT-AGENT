import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Several integration tests (config-resolution, approved-run-healing,
  // healing-trigger-safety, qa-pipeline-e2e, demo) spawn a real nested
  // Playwright process that itself launches a full Chromium instance and
  // waits for it to complete -- all within one test's timeout budget. Under
  // default parallelism (workers = CPU count) on a memory-constrained host,
  // multiple such nested launches compete for scarce RAM at once and the
  // nested process's own Chromium cold-start can exceed the default 30s
  // timeout even though nothing is logically wrong (confirmed: every
  // observed failure was a bare "Test timeout exceeded" with zero assertion
  // mismatches, and the same tests pass reliably and quickly run alone or
  // with --workers=1). Capping workers and raising the timeout here reduces
  // how many concurrent heavy browser launches compete for memory and gives
  // the ones that do run enough budget to finish; unit tests (pure, no
  // nested process spawns, ~15-20s for the whole suite) are unaffected by
  // either change.
  workers: 2,
  timeout: 60000,
  use: {
    // No baseURL. A hardcoded 'https://codemify.com' used to sit here, which
    // meant every relative navigation silently pointed at an unrelated external
    // site: a test could pass or fail against a target nobody under test owned.
    // Every spec must now navigate to an absolute URL, which is what the
    // automation generator already emits (explorationResult.target.url).
    // AGENTS.md Section 6 forbids inventing targets; a shared baseURL is exactly
    // that. Set a per-project baseURL only when a target is genuinely shared.
    // Artifact capture lives here because the Playwright CLI exposes only
    // --trace. There is no --video or --screenshot CLI option; both are
    // config-level `use` options. Passing them to `playwright test` made the
    // runner exit with "unknown option" before executing a single test.
    // Semantics match the previously (invalid) CLI flags exactly:
    // video retains recordings only for failed runs, screenshot captures only
    // on failure.
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
