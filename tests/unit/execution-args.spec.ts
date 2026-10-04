import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { buildPlaywrightArgs, ALLOWED_TEST_CLI_FLAGS, resolveRepoConfigPath } from "../../src/execution-engine";

const spec = "tests/generated/JPA-1.spec.ts";

function flagsOf(args: string[]): string[] {
  return args.filter((arg) => arg.startsWith("--")).map((arg) => arg.split("=")[0]);
}

test("default captureArtifacts passes only flags the Playwright CLI actually supports", () => {
  const args = buildPlaywrightArgs([spec], { runId: "args", captureArtifacts: true }, process.cwd());
  const flags = flagsOf(args);

  for (const flag of flags) {
    expect(ALLOWED_TEST_CLI_FLAGS.has(flag), `unsupported CLI flag: ${flag}`).toBe(true);
  }
  expect(flags).not.toContain("--video");
  expect(flags).not.toContain("--screenshot");
  expect(flags).toContain("--trace");
});

test("captureArtifacts defaults to on when the option is omitted", () => {
  const args = buildPlaywrightArgs([spec], { runId: "args" }, process.cwd());
  expect(flagsOf(args)).toContain("--trace");
  expect(flagsOf(args)).not.toContain("--video");
  expect(flagsOf(args)).not.toContain("--screenshot");
});

test("captureArtifacts false omits trace", () => {
  const args = buildPlaywrightArgs([spec], { runId: "args", captureArtifacts: false }, process.cwd());
  expect(flagsOf(args)).not.toContain("--trace");
  expect(flagsOf(args)).not.toContain("--video");
  expect(flagsOf(args)).not.toContain("--screenshot");
});

test("optional runner options only appear when supplied", () => {
  const bare = flagsOf(buildPlaywrightArgs([spec], { runId: "args" }, process.cwd()));
  expect(bare).not.toContain("--project");
  expect(bare).not.toContain("--browser");

  const full = flagsOf(buildPlaywrightArgs([spec], { runId: "args", project: "chromium", browser: "chromium" }, process.cwd()));
  expect(full).toContain("--project");
  expect(full).toContain("--browser");
});

test("--config is always passed and is independent of storageState", () => {
  // The config carries the use.video/use.screenshot artifact settings, so the
  // runner must always be pointed at it. It used to be gated on storageState,
  // which is semantically unrelated.
  const withoutStorageState = flagsOf(buildPlaywrightArgs([spec], { runId: "args" }, process.cwd()));
  expect(withoutStorageState).toContain("--config");

  // storageState no longer changes whether --config appears.
  const withStorageState = flagsOf(buildPlaywrightArgs([spec], { runId: "args", storageState: "state.json" }, process.cwd()));
  expect(withStorageState).toContain("--config");
});

test("--config points at the repository config, not at the caller's cwd", () => {
  const args = buildPlaywrightArgs([spec], { runId: "args" }, process.cwd());
  const index = args.indexOf("--config");
  expect(index).toBeGreaterThan(-1);
  const configPath = args[index + 1];

  // Absolute, and anchored on the repo root rather than the runtime cwd.
  expect(path.isAbsolute(configPath)).toBe(true);
  expect(configPath).toBe(resolveRepoConfigPath());
  expect(configPath.endsWith("playwright.config.ts")).toBe(true);
  expect(fs.existsSync(configPath)).toBe(true);

  // An explicit, unrelated cwd must not change where the config is found.
  const elsewhere = buildPlaywrightArgs([spec], { runId: "args" }, path.join(path.sep, "tmp", "some-other-cwd"));
  expect(elsewhere[elsewhere.indexOf("--config") + 1]).toBe(configPath);
});
