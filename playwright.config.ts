import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
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
