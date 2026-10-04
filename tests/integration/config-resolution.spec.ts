import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { executePlaywright, resolveRepoConfigPath } from "../../src/execution-engine";

/**
 * Proves the runner is pointed at this repository's playwright.config.ts no
 * matter what cwd the child process gets.
 *
 * The cwd used here is the repository's PARENT directory, which contains no
 * playwright.config.ts, so Playwright's implicit auto-discovery from cwd cannot
 * find one. The spec still runs and still records video + screenshot, which can
 * only come from the `use` options in the repo config. Before the fix, --config
 * was gated on the unrelated storageState option and was therefore absent, so
 * `use.video` / `use.screenshot` would have been silently dropped.
 */

const REPO_ROOT = path.resolve(".");
const PARENT_DIR = path.dirname(REPO_ROOT);
const FIXTURE_DIR = path.join(REPO_ROOT, "tests/integration/fixtures");
const FIXTURE_PREFIX = "generated-artifact-";
const FIXTURE = path.join(FIXTURE_DIR, `${FIXTURE_PREFIX}${process.pid}-${Date.now()}.spec.ts`);
const RUN_ID = "config-resolution";

/** Must drive the `page` fixture: video and screenshot need a real page. */
const FIXTURE_SOURCE = `import { test, expect } from '@playwright/test';

test('artifact capture config failure', async ({ page }) => {
  await page.goto('data:text/html,<h1>artifact probe</h1>');
  await expect(page.getByRole('heading')).toHaveText('DELIBERATE ARTIFACT FAILURE');
});
`;

function artifactsUnder(dir: string, extension: string, depth = 0): string[] {
  if (depth > 5 || !fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...artifactsUnder(full, extension, depth + 1));
    else if (entry.name.endsWith(extension)) found.push(full);
  }
  return found;
}

/** Artifacts written at or after `since` (ms epoch). */
function freshArtifacts(dir: string, extension: string, since: number): string[] {
  return artifactsUnder(dir, extension).filter((file) => fs.statSync(file).mtimeMs >= since - 2000);
}

test.describe("playwright config resolution", () => {
  test.beforeAll(() => {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(FIXTURE, FIXTURE_SOURCE, "utf8");
  });

  test.afterAll(() => {
    if (fs.existsSync(FIXTURE)) fs.rmSync(FIXTURE, { force: true });
  });

  test("the runner cwd has no auto-discoverable config", () => {
    // Precondition for this test to be meaningful.
    expect(fs.existsSync(path.join(PARENT_DIR, "playwright.config.ts"))).toBe(false);
  });

  test("--config is passed with the repo config even for an explicit foreign cwd", () => {
    const outputRoot = path.join(REPO_ROOT, "test-results", RUN_ID);
    return executePlaywright([FIXTURE], { runId: RUN_ID, cwd: PARENT_DIR, captureArtifacts: true, outputRoot }).then((result) => {
      expect(result.command).toContain("--config");
      expect(result.command).toContain(resolveRepoConfigPath());
      // The child really ran with that cwd.
      expect(fs.existsSync(path.join(PARENT_DIR, "playwright.config.ts"))).toBe(false);
      expect(outputRoot).toContain(RUN_ID);
    });
  });

  test("an explicit foreign cwd still gets video and screenshot from the config", async () => {
    const resultsRoot = path.join(REPO_ROOT, "test-results");
    // Playwright derives its output directory from the spec file name and
    // abbreviates long words in the slug, so it is not predictable. Keying on
    // write time avoids guessing the slug and avoids relying on a clean tree.
    const startedAt = Date.now();

    const result = await executePlaywright([FIXTURE], {
      runId: RUN_ID,
      cwd: PARENT_DIR,
      captureArtifacts: true,
      outputRoot: path.join(resultsRoot, RUN_ID),
    });

    // The spec ran and failed for real, from a per-test JSON result.
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].source).toBe("playwright-json");
    expect(result.tests[0].status).toBe("FAIL");

    // retain-on-failure only keeps artifacts for a failing run, and this one failed.
    const videos = freshArtifacts(resultsRoot, ".webm", startedAt);
    const shots = freshArtifacts(resultsRoot, ".png", startedAt);

    expect(videos.length, "use.video retain-on-failure should record a video").toBeGreaterThan(0);
    expect(shots.length, "use.screenshot only-on-failure should capture a screenshot").toBeGreaterThan(0);
    for (const file of [...videos, ...shots]) {
      expect(fs.statSync(file).size).toBeGreaterThan(0);
    }
  });

  test("captureArtifacts false omits trace but still resolves the config", async () => {
    const result = await executePlaywright([FIXTURE], {
      runId: `${RUN_ID}-no-trace`,
      cwd: PARENT_DIR,
      captureArtifacts: false,
      outputRoot: path.join(REPO_ROOT, "test-results", `${RUN_ID}-no-trace`),
    });
    expect(result.command).toContain("--config");
    expect(result.command).not.toContain("--trace");
    expect(result.tests[0].source).toBe("playwright-json");
  });
});
