import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { runQaPipeline } from "../../src/qa-pipeline";
import { approveTestCase, markReadyForAutomation, loadApprovalStore, saveApprovalStore } from "../../src/approval-store";
import { runApprovedCases } from "../../src/approved-runner";

/**
 * End-to-end coverage for the `npm run qa` path.
 *
 * runQaPipeline creates the approval store itself, so it must carry the
 * exploration result into it. runApprovedCases re-validates every case against
 * that exploration (caseBlockReason) and refuses to generate or execute
 * anything without a verified SUCCESS exploration -- so a store saved without
 * it stays BLOCKED with "Verified exploration result is unavailable" and can
 * never reach execution.
 */

let server: ChildProcess;
const port = 4193;
const url = `http://127.0.0.1:${port}/`;

async function waitForDemoSite(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Demo site did not start");
}

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.resolve("fixtures/demo-site/server.js")], { env: { ...process.env, DEMO_SITE_PORT: String(port) }, stdio: "ignore" });
  await waitForDemoSite();
});
test.afterAll(() => { server.kill(); });

test("qa pipeline store carries the exploration so run-approved reaches execution", async () => {
  // Requirement wording deliberately avoids the workflow keywords
  // (fill/submit/login/form) so the generated case resolves to an observed
  // element and is actually executable rather than flagged NEEDS_HUMAN_INPUT.
  const pipeline = await runQaPipeline({
    url,
    module: "Auth",
    scope: "Login",
    requirements: ["Welcome heading is displayed on the page"],
    runId: "qa-pipeline-e2e",
  });

  expect(pipeline.exploration.explorationStatus).toBe("SUCCESS");
  expect(pipeline.approvalStoreId).toBeTruthy();

  // The regression itself: the saved store must contain the exploration.
  const store = loadApprovalStore(pipeline.approvalStoreId!);
  expect(store).not.toBeNull();
  expect(store!.explorationResult).toBeTruthy();
  expect(store!.explorationResult!.explorationStatus).toBe("SUCCESS");
  // Persisted, not just held in memory.
  const onDisk = JSON.parse(fs.readFileSync(path.resolve("test-cases", `${store!.storeId}.json`), "utf8"));
  expect(onDisk.explorationResult.explorationStatus).toBe("SUCCESS");

  // Approve and mark ready, exactly as the CLI scripts do.
  for (const testCase of store!.testCases) {
    approveTestCase(store!, testCase.testCaseId, "qa-e2e-reviewer");
    markReadyForAutomation(store!, testCase.testCaseId);
  }
  saveApprovalStore(store!);

  const result = await runApprovedCases({
    storeId: store!.storeId,
    runId: "qa-pipeline-e2e-run",
    outputRoot: "test-results/qa-pipeline-e2e-run",
    captureArtifacts: false,
  });

  // Reaches execution, not BLOCKED.
  expect(result.status).toBe("SUCCESS");
  expect(result.exploration.source).toBe("store");
  expect(result.automation.status).toBe("SUCCESS");
  expect(result.automation.blocked).toHaveLength(0);

  const saved = JSON.parse(fs.readFileSync(path.resolve(result.resultPath!), "utf8"));
  expect(saved.status).toBe("SUCCESS");
  expect(saved.execution.tests).toHaveLength(1);
  expect(saved.execution.tests[0].status).toBe("PASS");
  expect(saved.execution.tests[0].source).toBe("playwright-json");
  expect(saved.execution.tests[0].durationMs).toBeGreaterThan(0);
  // The generated spec really ran against the live fixture.
  expect(saved.execution.tests[0].title).toContain("Welcome heading is displayed on the page");

  // And the specific failure mode this test guards against cannot occur.
  const blockedReasons = (saved.approval?.blockedCases || []).map((item: { reason: string }) => item.reason);
  expect(blockedReasons).not.toContain("Verified exploration result is unavailable");
});