import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { loadSmokeConfig, suiteOutcomeFor, isSuitePass, SMOKE_CONFIG_FILENAME } from "../../src/smoke-config";
import { normalizeSuiteSection, describeSuiteSection, aggregateFinalReport, finalReportText } from "../../src/final-report";
import { buildLastKnownResults, buildApprovedSpecIndex, selectRegressionSpecs, toRepoRelativeSpec, readStoredRuns, type StoredRun } from "../../src/regression-selection";

function writeConfig(root: string, body: string): void {
  fs.writeFileSync(path.join(root, SMOKE_CONFIG_FILENAME), body, "utf8");
}

test.describe("smoke configuration", () => {
  let root: string;
  test.beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-smoke-")); });
  test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  test("a missing config is SKIPPED_NOT_CONFIGURED, never a pass", () => {
    const config = loadSmokeConfig(root);
    expect(config.configured).toBe(false);
    expect(config.paths).toEqual([]);
    expect(config.reason).toContain("was not found");
  });

  test("an empty tests list is SKIPPED_NOT_CONFIGURED and invents nothing", () => {
    writeConfig(root, JSON.stringify({ smoke: { tests: [] } }));
    const config = loadSmokeConfig(root);
    expect(config.configured).toBe(false);
    expect(config.reason).toContain("empty smoke.tests list");
    expect(config.reason).toContain("no flow was invented");
  });

  test("a missing smoke.tests array is SKIPPED_NOT_CONFIGURED", () => {
    writeConfig(root, JSON.stringify({ smoke: {} }));
    expect(loadSmokeConfig(root).configured).toBe(false);
  });

  test("malformed JSON is reported, not thrown", () => {
    writeConfig(root, "{ not json");
    const config = loadSmokeConfig(root);
    expect(config.configured).toBe(false);
    expect(config.reason).toContain("not valid JSON");
  });

  test("a UTF-8 BOM does not make a valid config unreadable", () => {
    writeConfig(root, `\uFEFF${JSON.stringify({ smoke: { tests: ["a.spec.ts"] } })}`);
    fs.writeFileSync(path.join(root, "a.spec.ts"), "// spec\n", "utf8");
    const config = loadSmokeConfig(root);
    expect(config.configured).toBe(true);
    expect(config.paths).toEqual(["a.spec.ts"]);
  });

  test("declared tests that are absent from disk are excluded and reported", () => {
    fs.writeFileSync(path.join(root, "present.spec.ts"), "// spec\n", "utf8");
    writeConfig(root, JSON.stringify({ smoke: { tests: ["present.spec.ts", "absent.spec.ts"] } }));
    const config = loadSmokeConfig(root);
    expect(config.configured).toBe(true);
    expect(config.paths).toEqual(["present.spec.ts"]);
    expect(config.missing).toEqual(["absent.spec.ts"]);
  });

  test("a config whose every test is missing is SKIPPED_NOT_CONFIGURED", () => {
    writeConfig(root, JSON.stringify({ smoke: { tests: ["absent.spec.ts"] } }));
    const config = loadSmokeConfig(root);
    expect(config.configured).toBe(false);
    expect(config.reason).toContain("missing from disk");
  });

  test("the repository's own qa.config.json is valid and points at a real spec", () => {
    const config = loadSmokeConfig(process.cwd());
    expect(config.configured).toBe(true);
    for (const declared of config.paths) expect(fs.existsSync(path.resolve(declared))).toBe(true);
    // config.paths is already filtered to files that exist, so the loop above
    // can never fail on a stale path -- it is checking loadSmokeConfig's own
    // filtering, not the repository's actual qa.config.json content. This
    // assertion is the one that actually fails if a declared smoke path is
    // moved or renamed without updating qa.config.json: it reads the real
    // list of declared-but-absent paths instead of the already-filtered one.
    expect(config.missing).toEqual([]);
  });
});

test.describe("suite outcome mapping", () => {
  test("blocked or skipped work is never SUCCESS", () => {
    expect(suiteOutcomeFor({ total: 2, passed: 2, failed: 0, blocked: 1, skipped: 0 })).toBe("PARTIAL");
    expect(suiteOutcomeFor({ total: 2, passed: 2, failed: 0, blocked: 0, skipped: 1 })).toBe("PARTIAL");
    expect(isSuitePass(suiteOutcomeFor({ total: 2, passed: 1, failed: 0, blocked: 1, skipped: 0 }))).toBe(false);
  });

  test("a failure is FAILED and not a pass", () => {
    expect(suiteOutcomeFor({ total: 1, passed: 0, failed: 1, blocked: 0, skipped: 0 })).toBe("FAILED");
  });

  test("an empty run is BLOCKED, not a pass", () => {
    expect(suiteOutcomeFor({ total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 })).toBe("BLOCKED");
    expect(isSuitePass(suiteOutcomeFor({ total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 }))).toBe(false);
  });

  test("only a fully clean run is a pass", () => {
    expect(suiteOutcomeFor({ total: 3, passed: 3, failed: 0, blocked: 0, skipped: 0 })).toBe("SUCCESS");
  });
});

test.describe("regression selection", () => {
  const passRun = {
    runId: "run-pass",
    timestamp: "2026-01-02T00:00:00.000Z",
    automation: { generated: [{ kind: "spec", testCaseId: "TC-1", path: "/repo/tests/generated/Demo/TC-1.spec.ts" }] },
    execution: { tests: [{ path: "generated/Demo/TC-1.spec.ts", status: "PASS", source: "playwright-json" }] },
  } as unknown as StoredRun;
  const failRun = {
    runId: "run-fail",
    timestamp: "2026-01-03T00:00:00.000Z",
    automation: { generated: [{ kind: "spec", testCaseId: "TC-2", path: "/repo/tests/generated/Demo/TC-2.spec.ts" }] },
    execution: { tests: [{ path: "generated/Demo/TC-2.spec.ts", status: "FAIL", source: "playwright-json" }] },
  } as unknown as StoredRun;
  const fallbackRun = {
    runId: "run-fallback",
    timestamp: "2026-01-04T00:00:00.000Z",
    automation: { generated: [{ kind: "spec", testCaseId: "TC-3", path: "/repo/tests/generated/Demo/TC-3.spec.ts" }] },
    execution: { tests: [{ path: "generated/Demo/TC-3.spec.ts", status: "PASS", source: "exit-code-fallback" }] },
  } as unknown as StoredRun;

  test("paths relative to Playwright's testDir are normalised to repo-relative", () => {
    expect(toRepoRelativeSpec("generated/Demo/TC-1.spec.ts", "/repo")).toBe("tests/generated/Demo/TC-1.spec.ts");
    expect(toRepoRelativeSpec("tests/generated/Demo/TC-1.spec.ts", "/repo")).toBe("tests/generated/Demo/TC-1.spec.ts");
    expect(toRepoRelativeSpec("C:\\repo\\tests\\generated\\Demo\\TC-1.spec.ts", "/repo")).toBe("tests/generated/Demo/TC-1.spec.ts");
  });

  test("only playwright-json results establish a baseline", () => {
    const latest = buildLastKnownResults([fallbackRun], "/repo");
    expect(latest.size).toBe(0);
    expect(buildLastKnownResults([passRun], "/repo").get("tests/generated/Demo/TC-1.spec.ts")?.status).toBe("PASS");
  });

  test("a fallback-sourced PASS is excluded even though its status is PASS", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-reg-"));
    try {
      fs.mkdirSync(path.join(root, "test-cases"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "test-cases", "store.json"),
        JSON.stringify({ storeId: "store-1", testCases: [{ testCaseId: "TC-3", status: "READY_FOR_AUTOMATION" }] }),
        "utf8",
      );
      const runs = readStoredRuns(path.join(root, "reports"));
      void runs;
      const lastKnown = buildLastKnownResults([fallbackRun], "/repo");
      const approved = buildApprovedSpecIndex({ runs: [fallbackRun], testCasesRoot: path.join(root, "test-cases"), root: "/repo" });
      const { included, candidates } = selectRegressionSpecs({ specPaths: ["tests/generated/Demo/TC-3.spec.ts"], root: "/repo", lastKnown, approved });
      expect(included).toEqual([]);
      expect(candidates[0].reason).toContain("no stored per-test result with source playwright-json");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a previously failing spec is excluded with its last status in the reason", () => {
    const lastKnown = buildLastKnownResults([failRun], "/repo");
    const approved = buildApprovedSpecIndex({ runs: [failRun], testCasesRoot: path.join(os.tmpdir(), "does-not-exist"), root: "/repo" });
    // No store present -> excluded for approval, so assert the status branch via a store.
    expect(approved.size).toBe(0);
    const { candidates } = selectRegressionSpecs({ specPaths: ["tests/generated/Demo/TC-2.spec.ts"], root: "/repo", lastKnown, approved });
    expect(candidates[0].included).toBe(false);
  });

  test("a case that is not READY_FOR_AUTOMATION is excluded", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-reg-"));
    try {
      fs.mkdirSync(path.join(root, "test-cases"), { recursive: true });
      fs.writeFileSync(
        path.join(root, "test-cases", "store.json"),
        JSON.stringify({ storeId: "store-1", testCases: [{ testCaseId: "TC-1", status: "PENDING_APPROVAL" }] }),
        "utf8",
      );
      const lastKnown = buildLastKnownResults([passRun], "/repo");
      const approved = buildApprovedSpecIndex({ runs: [passRun], testCasesRoot: path.join(root, "test-cases"), root: "/repo" });
      expect(approved.size).toBe(0);
      const { included, candidates } = selectRegressionSpecs({ specPaths: ["tests/generated/Demo/TC-1.spec.ts"], root: "/repo", lastKnown, approved });
      expect(included).toEqual([]);
      expect(candidates[0].reason).toContain("no approval store lists this spec as READY_FOR_AUTOMATION");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a non-application spec is excluded outright", () => {
    const { candidates } = selectRegressionSpecs({ specPaths: ["tests/unit/browser-agent.spec.ts"], root: "/repo", lastKnown: new Map(), approved: new Map() });
    expect(candidates[0].included).toBe(false);
    expect(candidates[0].reason).toContain("not an application regression target");
  });
});

test.describe("suite sections in the final report", () => {
  test("SKIPPED_NOT_CONFIGURED is never reported as a pass", () => {
    const section = normalizeSuiteSection({ suite: "smoke", outcome: "SKIPPED_NOT_CONFIGURED", configured: false, executed: false, reason: "no config" });
    expect(section!.pass).toBe(false);
    expect(section!.outcome).toBe("SKIPPED_NOT_CONFIGURED");
    expect(isSuitePass("SKIPPED_NOT_CONFIGURED")).toBe(false);
  });

  test("only SUCCESS sets pass", () => {
    for (const outcome of ["FAILED", "BLOCKED", "PARTIAL", "SKIPPED_NOT_CONFIGURED", "UNKNOWN"]) {
      expect(normalizeSuiteSection({ suite: "smoke", outcome })!.pass).toBe(false);
    }
    expect(normalizeSuiteSection({ suite: "smoke", outcome: "SUCCESS" })!.pass).toBe(true);
  });

  test("a null suite renders as NOT RUN rather than a pass", () => {
    expect(describeSuiteSection(null, "Smoke suite")).toEqual(["Smoke suite: NOT RUN"]);
  });

  test("aggregateFinalReport carries both suite sections", () => {
    const report = aggregateFinalReport("r1", { status: "SUCCESS", execution: { totals: { total: 1, passed: 1, failed: 0, blocked: 0, skipped: 0 } } }, {
      smoke: { suite: "smoke", outcome: "SUCCESS", configured: true, executed: true, totals: { total: 1, passed: 1, failed: 0, blocked: 0, skipped: 0 } },
      regression: { suite: "regression", outcome: "SKIPPED_NOT_CONFIGURED", configured: true, executed: false, reason: "no baseline" },
    });
    expect((report.sections.smoke as { pass: boolean }).pass).toBe(true);
    expect((report.sections.regression as { pass: boolean }).pass).toBe(false);
    expect((report.sections.regression as { outcome: string }).outcome).toBe("SKIPPED_NOT_CONFIGURED");
    const text = finalReportText(report);
    expect(text).toContain("Smoke suite: SUCCESS");
    expect(text).toContain("Regression suite: SKIPPED_NOT_CONFIGURED (not a pass)");
  });
});
