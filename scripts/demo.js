"use strict";
// `npm run demo` -- no flags. One command that runs the full chain against the
// local fixture (fixtures/demo-site): explore, generate cases, scripted
// approval, run-approved (execution, healing, classification, Jira dry-run),
// smoke, regression, report-final (JSON + PDF), and a console summary table.
//
// DEMO ONLY. The scripted approval below exists ONLY in this file -- it is
// never called from the production pipeline (src/qa-pipeline.ts stops at the
// approval gate and returns; scripts/approve-tests.js is the real,
// human-driven approval CLI). This mirrors scripts/demo-approve.js, which
// carries the same warning.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const typescript = require("typescript");
require.extensions[".ts"] = function (module, filename) {
  const out = typescript.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};

const REPO_ROOT = path.resolve(__dirname, "..");
const { createApprovalStore, saveApprovalStore, approveTestCase, markReadyForAutomation } = require(path.join(REPO_ROOT, "src/approval-store.ts"));
const { runApprovedCases } = require(path.join(REPO_ROOT, "src/approved-runner.ts"));
const { aggregateFinalReport, saveFinalReport, finalReportText } = require(path.join(REPO_ROOT, "src/final-report.ts"));
const { runSmoke, runRegression } = require("./suite-runner.js");

const DEFAULT_PORT = 4199;

function waitForDemoSite(url, attempts = 50) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;
    const tryOnce = () => {
      fetch(url).then((response) => { if (response.ok) resolve(); else retry(); }).catch(retry);
    };
    const retry = () => {
      remaining -= 1;
      if (remaining <= 0) { reject(new Error("Demo site did not start")); return; }
      setTimeout(tryOnce, 100);
    };
    tryOnce();
  });
}

/** The four demo test cases: PASS, HEAL (broken locator), REMOVED, DEFECT (real mismatch). */
function buildDemoCases(url) {
  const elements = [
    { id: "LOGIN", type: "button", role: "button", name: "Login", selectorCandidates: ["getByRole('button', { name: 'Login' })"], url, source: "browser-exploration" },
    { id: "HEADING", type: "heading", role: "heading", name: "Welcome back", selectorCandidates: ["getByRole('heading', { name: 'Welcome back' })"], url, source: "browser-exploration" },
    // Observed with this identity (role=button, name="Removed action") so
    // automation-generator wraps the step in the try/catch that attempts
    // healing -- but no element with this name actually exists on the real
    // page, so the live candidate validation in healOnSamePage fails and the
    // outcome is NOT_HEALED, not skipped. Without an observed element here,
    // automation-generator never wraps the step at all (see renderSpec's
    // `locator && step.expectedAssertion && observedElement` guard), so
    // healing would never even be attempted -- a different, less honest demo
    // of "removed element" than what the production pipeline actually does.
    { id: "REMOVED", type: "button", role: "button", name: "Removed action", selectorCandidates: ["getByRole('button', { name: 'Removed action' })"], url, source: "browser-exploration" },
  ];
  const exploration = {
    target: { url, module: "Demo", scope: "EndToEnd", requirements: ["Login is visible", "Heading is correct"] },
    status: "SUCCESS", explorationStatus: "SUCCESS", exploredAt: new Date().toISOString(), pagesVisited: [url],
    elements, workflows: [], observations: [], requirementsCoverage: [], warnings: [], provenance: [], secretsMaskedCount: 0, promptInjectionDetected: false,
  };
  const now = () => new Date().toISOString();
  const testCases = [
    {
      testCaseId: "TC-DEMO-PASS", title: "Login is visible", objective: "A genuinely passing case", preconditions: [], testData: "demo",
      steps: [{ step: 1, action: "Inspect login button", expected: "Login is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Login' })", sourceElementId: "LOGIN" }],
      expectedResult: "Login is visible", priority: "High", testType: "Functional", module: "Demo", sourceRequirements: ["Login is visible"], explorationReferences: ["LOGIN"], assumptions: [], risks: [],
      status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "LOGIN", page: url }], generatedAt: now(),
    },
    {
      testCaseId: "TC-DEMO-HEAL", title: "Broken login locator heals", objective: "A stale locator that same-page healing repairs", preconditions: [], testData: "demo",
      // selectorHint deliberately references a name that no longer exists ("Old Login"); the real element has role=button name="Login".
      steps: [{ step: 1, action: "Click Login", expected: "Login is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Old Login' })", sourceElementId: "LOGIN" }],
      expectedResult: "Login is visible", priority: "High", testType: "Functional", module: "Demo", sourceRequirements: ["Login is visible"], explorationReferences: ["LOGIN"], assumptions: [], risks: [],
      status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "LOGIN", page: url }], generatedAt: now(),
    },
    {
      testCaseId: "TC-DEMO-REMOVED", title: "Removed element stays FAIL", objective: "Nothing on the page matches; healing must not invent a match", preconditions: [], testData: "demo",
      steps: [{ step: 1, action: "Click removed action", expected: "Removed action is visible", expectedAssertion: { type: "visible" }, selectorHint: "getByRole('button', { name: 'Old Removed action' })", sourceElementId: "REMOVED" }],
      expectedResult: "Removed action is visible", priority: "High", testType: "Functional", module: "Demo", sourceRequirements: ["Click removed action"], explorationReferences: ["REMOVED"], assumptions: [], risks: [],
      status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "REMOVED", page: url }], generatedAt: now(),
    },
    {
      testCaseId: "TC-DEMO-DEFECT", title: "Real assertion mismatch", objective: "A verified application defect, classified A", preconditions: [], testData: "demo",
      steps: [{ step: 1, action: "Inspect heading", expected: "Wrong heading is displayed", expectedAssertion: { type: "text", value: "Wrong heading" }, selectorHint: "getByRole('heading', { name: 'Welcome back' })", sourceElementId: "HEADING" }],
      expectedResult: "Wrong heading is displayed", priority: "High", testType: "Functional", module: "Demo", sourceRequirements: ["Heading is correct"], explorationReferences: ["HEADING"], assumptions: [], risks: [],
      status: "PENDING_APPROVAL", automationEligibility: "ELIGIBLE", sources: [{ type: "browser-exploration", observationId: "HEADING", page: url }], generatedAt: now(),
    },
  ];
  return { exploration, testCases };
}

function removeScopedArtifacts(storeId, moduleName) {
  if (!storeId) return;
  fs.rmSync(path.join(REPO_ROOT, "pages", `${moduleName}__${storeId}`), { recursive: true, force: true });
  fs.rmSync(path.join(REPO_ROOT, "tests", "generated", `${moduleName}__${storeId}`), { recursive: true, force: true });
}

function readSuiteSection(runId, mode) {
  const file = path.resolve(REPO_ROOT, "reports", runId, `${mode}-report.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return (parsed.sections && parsed.sections[mode]) || null;
  } catch {
    return null;
  }
}

/** Finds, for a known testCaseId, the per-test execution result and healing entry. */
function summarize(result, testCaseId) {
  const spec = (result.automation.generated || []).find((item) => item.kind === "spec" && item.testCaseId === testCaseId);
  const specPath = spec ? spec.path.replace(/\\/g, "/") : undefined;
  const test = (result.execution && result.execution.tests || []).find((item) => specPath && item.path.replace(/\\/g, "/").endsWith(specPath.split("/").slice(-2).join("/")));
  const failure = (result.execution && result.execution.failures || []).find((item) => test && item.path === test.path);
  // Each generated spec embeds its own testCaseId into the healing call's
  // metadata (see src/automation-generator.ts's renderSpec -> `metadata`),
  // and healOnSamePage/validatedHeal thread that object straight through to
  // ValidatedHealingResult.metadata -- the one real, exact way to attribute a
  // healing entry back to the test case that produced it.
  const healing = (result.healing || []).find((entry) => entry.metadata && entry.metadata.testCaseId === testCaseId);
  return {
    testCaseId,
    status: test ? test.status : "UNKNOWN",
    category: failure && failure.diagnosis ? failure.diagnosis.category : "n/a",
    healingOutcome: healing ? healing.outcome : "n/a",
  };
}

function printSummaryTable(rows, defects) {
  const header = ["Case", "Status", "Category", "Healing outcome", "Defect dry-run"];
  // DefectResult (src/jira-defects.ts) carries no field that attributes a
  // defect back to the test case that produced it -- it is fingerprinted from
  // the failure's own text, not keyed by testCaseId. This demo has exactly
  // one category-A (Jira-eligible) failure by design, so the only defect
  // dry-run result belongs to whichever row is category A.
  const defectFor = (row) => (row.category === "A. REAL APPLICATION DEFECT" && defects && defects[0] ? defects[0].status : "n/a");
  const tableRows = rows.map((row) => [row.testCaseId, row.status, row.category, row.healingOutcome, defectFor(row)]);
  const widths = header.map((h, i) => Math.max(h.length, ...tableRows.map((r) => String(r[i]).length)));
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  |  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("--+--"));
  for (const row of tableRows) console.log(line(row));
}

async function runDemo(options = {}) {
  const port = options.port || DEFAULT_PORT;
  const url = `http://127.0.0.1:${port}/`;
  const runId = options.runId || `demo-${Date.now()}`;

  const server = spawn(process.execPath, [path.join(REPO_ROOT, "fixtures/demo-site/server.js")], { env: { ...process.env, DEMO_SITE_PORT: String(port) }, stdio: "ignore" });
  let store;
  try {
    await waitForDemoSite(url);

    const { exploration, testCases } = buildDemoCases(url);
    store = createApprovalStore("Demo", "EndToEnd", testCases, exploration);

    // DEMO ONLY scripted approval -- see the file-level comment above.
    console.warn("DEMO ONLY: scripted approval is not part of the production approval path.");
    for (const testCase of testCases) {
      approveTestCase(store, testCase.testCaseId, "demo-reviewer", "DEMO ONLY approval");
      markReadyForAutomation(store, testCase.testCaseId);
    }
    saveApprovalStore(store);

    const result = await runApprovedCases({ storeId: store.storeId, runId, captureArtifacts: false });

    await runSmoke(["--run-id", runId]);
    await runRegression(["--run-id", runId]);
    const smoke = readSuiteSection(runId, "smoke");
    const regression = readSuiteSection(runId, "regression");

    const report = aggregateFinalReport(runId, result, { environment: "demo-fixture", smoke, regression });
    const reportPath = saveFinalReport(report);
    const pdfPath = path.resolve(REPO_ROOT, "reports", runId, "qa-report.pdf");
    execFileSync(process.execPath, [path.join(REPO_ROOT, "scripts/report-pdf.js"), reportPath, pdfPath], { stdio: "inherit" });

    const rows = [
      summarize(result, "TC-DEMO-PASS"),
      summarize(result, "TC-DEMO-HEAL"),
      summarize(result, "TC-DEMO-REMOVED"),
      summarize(result, "TC-DEMO-DEFECT"),
    ];
    printSummaryTable(rows, result.defects);
    console.log("");
    console.log(finalReportText(report));
    console.log("");
    console.log(JSON.stringify({ runId, reportPath, pdfPath, status: report.status }, null, 2));

    return { runId, store, result, report, reportPath, pdfPath, rows };
  } finally {
    server.kill();
    if (store) removeScopedArtifacts(store.storeId, "Demo");
  }
}

async function main() {
  await runDemo();
}
if (require.main === module) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, runDemo };
