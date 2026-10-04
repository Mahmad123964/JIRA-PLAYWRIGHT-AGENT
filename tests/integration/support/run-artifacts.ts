import fs from "fs";
import path from "path";

/**
 * Helpers for integration tests that drive a real approved run.
 *
 * GENERATION TARGET. These runs generate into the repository tree (the default
 * outputRoot) rather than into test-results/, because Playwright's testDir is the
 * repository's ./tests: a spec written under test-results/ is outside testDir and
 * the runner reports "No tests found", so the test would assert against a run that
 * never executed anything.
 *
 * That is safe now because generation is namespaced per approval store
 * (artifactScope), so a test can never overwrite another run's POM or spec. Each
 * test removes its own scoped directories via `removeScopedArtifacts`.
 */

const REPO_ROOT = process.cwd();

/** Removes pages/<Module>__<storeId> and tests/generated/<Module>__<storeId>. */
export function removeScopedArtifacts(storeId: string, moduleName?: string): void {
  if (!storeId) return;
  const scope = storeId;
  const moduleDirs = moduleName ? [moduleName] : listGeneratedModuleDirs();
  for (const name of moduleDirs) {
    fs.rmSync(path.join(REPO_ROOT, "pages", `${name}__${scope}`), { recursive: true, force: true });
    fs.rmSync(path.join(REPO_ROOT, "tests", "generated", `${name}__${scope}`), { recursive: true, force: true });
  }
}

/** Scoped module directory names currently present, e.g. "DemoHealing__store-1". */
export function listGeneratedModuleDirs(): string[] {
  const names = new Set<string>();
  for (const base of [path.join(REPO_ROOT, "pages"), path.join(REPO_ROOT, "tests", "generated")]) {
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.includes("__")) names.add(entry.name.split("__")[0]);
    }
  }
  return [...names];
}

/** Every generated artifact (POM or spec) recorded for a run, by absolute path. */
export function generatedPathsFor(generated: Array<{ path: string }>): string[] {
  return (generated || []).map((file) => file.path);
}