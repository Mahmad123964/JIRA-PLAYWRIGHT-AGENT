import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'https://codemify.com',
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
