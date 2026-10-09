import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * Drives the real `npm run demo` chain (scripts/demo.js's runDemo()) against
 * the local fixture and asserts the four required outcomes from the actual
 * written output files (reports/<runId>/approved-run-result.json and
 * final-report.json) -- not from in-memory return values alone, so this also
 * proves the files on disk are correct.
 *
 * Uses a dedicated port (distinct from other integration tests that start
 * their own fixture server) so it can run concurrently under the default
 * multi-worker suite without a port clash.
 */

const DEMO_PORT = 4200;

test("npm run demo produces all four required outcomes from real output files", async ({}, testInfo) => {
  testInfo.setTimeout(60000);
  const { runDemo } = require("../../scripts/demo.js");
  const { runId, store, reportPath, pdfPath, rows } = await runDemo({ port: DEMO_PORT });

  // The approved-run-result.json and final-report.json this run actually wrote.
  const resultPath = path.resolve("reports", runId, "approved-run-result.json");
  expect(fs.existsSync(resultPath)).toBe(true);
  const savedResult = JSON.parse(fs.readFileSync(resultPath, "utf8"));

  expect(fs.existsSync(reportPath)).toBe(true);
  const savedReport = JSON.parse(fs.readFileSync(reportPath, "utf8"));

  expect(fs.existsSync(pdfPath)).toBe(true);
  expect(fs.statSync(pdfPath).size).toBeGreaterThan(0);

  // (a) one passing case.
  const pass = rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-PASS");
  expect(pass?.status).toBe("PASS");
  expect(pass?.healingOutcome).toBe("n/a");

  // (b) one broken-locator case that heals to PASS_AFTER_HEALING.
  const heal = rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-HEAL");
  expect(heal?.status).toBe("PASS");
  expect(heal?.healingOutcome).toBe("PASS_AFTER_HEALING");
  expect(savedResult.healing.some((h: { outcome: string }) => h.outcome === "PASS_AFTER_HEALING")).toBe(true);

  // (c) one removed-element case that stays FAIL and appears in Needs human review.
  const removed = rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-REMOVED");
  expect(removed?.status).toBe("FAIL");
  expect(removed?.healingOutcome).toBe("NOT_HEALED");
  const humanReview = savedReport.sections.humanReview;
  expect(humanReview.count).toBeGreaterThan(0);
  const removedInReview = humanReview.items.some((item: { test?: string; reason: string }) =>
    (item.test && item.test.includes("TC-DEMO-REMOVED")) || item.reason.includes("possible real application change"));
  expect(removedInReview).toBe(true);

  // (d) one real assertion mismatch classified A and shown as WOULD_CREATE.
  const defect = rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-DEFECT");
  expect(defect?.status).toBe("FAIL");
  expect(defect?.category).toBe("A. REAL APPLICATION DEFECT");
  expect(savedResult.defects).toHaveLength(1);
  expect(savedResult.defects[0].status).toBe("WOULD_CREATE");
  expect(savedResult.defects[0].dryRun).toBe(true);

  // Never a real Jira mutation.
  expect(JSON.stringify(savedResult.defects)).not.toContain("CREATED");

  // Cleanup left nothing behind for the next test collection: the scoped
  // directories runDemo() wrote to (and removed in its finally block) are gone.
  expect(fs.existsSync(path.resolve("tests/generated", `Demo__${store.storeId}`))).toBe(false);
  expect(fs.existsSync(path.resolve("pages", `Demo__${store.storeId}`))).toBe(false);
});

test("running the demo twice is idempotent: same four outcomes, no leftover generated files", async ({}, testInfo) => {
  // Two full demo cycles (each spawns the fixture server and drives four real
  // Playwright executions); under the default 30s timeout this flaked when
  // the integration suite's other tests were contending for the same CPU.
  testInfo.setTimeout(90000);
  const { runDemo } = require("../../scripts/demo.js");
  // Scoped to "Demo__" specifically: tests/generated/ is shared with every
  // other integration test running concurrently in other workers, each
  // creating and cleaning up its own "<Module>__<storeId>" directory on its
  // own schedule. Counting all "__"-scoped directories made this assertion
  // racy against that unrelated, constantly-changing noise.
  const countDemoDirs = () => fs.existsSync(path.resolve("tests/generated"))
    ? fs.readdirSync(path.resolve("tests/generated")).filter((name) => name.startsWith("Demo__")).length
    : 0;
  const generatedBefore = countDemoDirs();

  const first = await runDemo({ port: DEMO_PORT + 1 });
  const second = await runDemo({ port: DEMO_PORT + 1 });

  expect(first.runId).not.toBe(second.runId);
  for (const id of ["TC-DEMO-PASS", "TC-DEMO-HEAL", "TC-DEMO-REMOVED", "TC-DEMO-DEFECT"]) {
    const a = first.rows.find((r: { testCaseId: string }) => r.testCaseId === id);
    const b = second.rows.find((r: { testCaseId: string }) => r.testCaseId === id);
    expect(a?.status).toBe(b?.status);
    expect(a?.category).toBe(b?.category);
    expect(a?.healingOutcome).toBe(b?.healingOutcome);
  }

  expect(countDemoDirs()).toBe(generatedBefore);
});

test("a stale server and leftover generated files from a crashed run are cleaned up before starting", async ({}, testInfo) => {
  testInfo.setTimeout(60000);
  const crashPort = DEMO_PORT + 2;

  // Plant leftovers exactly like a hard-killed previous run would leave:
  // generated spec/POM directories under the Demo__ namespace...
  const staleSpecDir = path.resolve("tests/generated/Demo__fake-crashed-run");
  const stalePageDir = path.resolve("pages/Demo__fake-crashed-run");
  fs.mkdirSync(staleSpecDir, { recursive: true });
  fs.writeFileSync(path.join(staleSpecDir, "TC-FAKE.spec.ts"), "// leftover from a crashed run\n", "utf8");
  fs.mkdirSync(stalePageDir, { recursive: true });
  fs.writeFileSync(path.join(stalePageDir, "FakePage.ts"), "// leftover from a crashed run\n", "utf8");

  // ...and an orphaned server still listening on the port this run will use.
  const { spawn } = require("child_process");
  const orphan = spawn(process.execPath, [path.resolve("fixtures/demo-site/server.js")], { env: { ...process.env, DEMO_SITE_PORT: String(crashPort) }, stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${crashPort}/`)).ok; } catch { return false; }
  }, { timeout: 5000 }).toBe(true);

  try {
    const { runDemo } = require("../../scripts/demo.js");
    const { rows } = await runDemo({ port: crashPort });

    // The leftovers are gone -- cleaned up before this run even started.
    expect(fs.existsSync(staleSpecDir)).toBe(false);
    expect(fs.existsSync(stalePageDir)).toBe(false);

    // The run still completed normally with the real four outcomes, proving
    // the stale-port server was freed rather than causing a startup hang or
    // a collision with this run's own fixture server.
    expect(rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-PASS")?.status).toBe("PASS");
    expect(rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-HEAL")?.healingOutcome).toBe("PASS_AFTER_HEALING");
    expect(rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-REMOVED")?.healingOutcome).toBe("NOT_HEALED");
    expect(rows.find((r: { testCaseId: string }) => r.testCaseId === "TC-DEMO-DEFECT")?.category).toBe("A. REAL APPLICATION DEFECT");
  } finally {
    // In case cleanup somehow didn't reach the orphan (it should have).
    orphan.kill();
  }
});
