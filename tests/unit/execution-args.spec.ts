import { test, expect } from "@playwright/test";
import { buildPlaywrightArgs, ALLOWED_TEST_CLI_FLAGS } from "../../src/execution-engine";

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
  expect(bare).not.toContain("--config");

  const full = flagsOf(buildPlaywrightArgs([spec], { runId: "args", project: "chromium", browser: "chromium", storageState: "state.json" }, process.cwd()));
  expect(full).toContain("--project");
  expect(full).toContain("--browser");
  expect(full).toContain("--config");
});
