"use strict";
// Shared implementation for `npm run smoke` and `npm run regression`.
//
// Both suites run real Playwright specs through the same execution engine, so
// they get real per-test results, the failure classifier and evidence handling
// for free. Two rules are enforced here rather than left to the caller:
//
//   1. A suite ALWAYS writes its report, including when it could not run. The
//      previous runner returned early on an empty selection and wrote nothing.
//   2. SKIPPED_NOT_CONFIGURED, BLOCKED and SKIPPED are never reported as a pass.
//      `suiteOutcomeFor` only returns SUCCESS for a clean run.
const fs = require("fs");
const path = require("path");
const typescript = require("typescript");
require.extensions[".ts"] = function loadTs(module, filename) {
  const src = fs.readFileSync(filename, "utf8");
  const out = typescript.transpileModule(src, {
    compilerOptions: { esModuleInterop: true, module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};

const REPO_ROOT = process.cwd();
const { executePlaywright } = require(path.join(REPO_ROOT, "src/execution-engine.ts"));
const { loadSmokeConfig, suiteOutcomeFor, isSuitePass } = require(path.join(REPO_ROOT, "src/smoke-config.ts"));
const { discoverRegressionTests } = require(path.join(REPO_ROOT, "src/test-discovery.ts"));
const {
  readStoredRuns,
  buildLastKnownResults,
  buildApprovedSpecIndex,
  selectRegressionSpecs,
  saveRegressionSelection,
} = require(path.join(REPO_ROOT, "src/regression-selection.ts"));
const { createQaReport, saveQaReport } = require(path.join(REPO_ROOT, "src/qa-report.ts"));

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : undefined;
}

function writeReport(runId, mode, payload) {
  const file = path.resolve("reports", runId, `${mode}-report.json`);
  const report = createQaReport({
    runId,
    environment: payload.environment || process.platform + "/" + process.arch,
    status: payload.status === "SKIPPED_NOT_CONFIGURED" ? "BLOCKED" : payload.status,
    sections: { [mode]: payload },
    auditTrail: [],
  });
  // The suite outcome is preserved verbatim inside the section, so a
  // SKIPPED_NOT_CONFIGURED suite is never flattened into a report-level PASS.
  report.security = report.security;
  saveQaReport(report, file);
  return file;
}

async function runSmoke(argv) {
  const runId = flag(argv, "--run-id") || `smoke-${Date.now()}`;
  const config = loadSmokeConfig(REPO_ROOT);
  if (!config.configured) {
    const payload = { suite: "smoke", outcome: "SKIPPED_NOT_CONFIGURED", status: "SKIPPED_NOT_CONFIGURED", configured: false, configPath: config.configPath, paths: [], missing: config.missing, reason: config.reason, totals: { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 }, executed: false };
    const reportPath = writeReport(runId, "smoke", payload);
    return { payload, reportPath, exitCode: 0 };
  }
  const result = await executePlaywright(config.paths, { runId, environment: flag(argv, "--environment"), outputRoot: path.resolve("test-results", runId) });
  const outcome = suiteOutcomeFor(result.totals);
  const payload = {
    suite: "smoke",
    outcome,
    status: outcome,
    configured: true,
    configPath: config.configPath,
    paths: config.paths,
    missing: config.missing,
    reason: config.missing.length ? `${config.missing.length} declared smoke test(s) are missing from disk and were not run: ${config.missing.join(", ")}` : undefined,
    totals: result.totals,
    tests: result.tests,
    failures: result.failures,
    executed: true,
  };
  const reportPath = writeReport(runId, "smoke", payload);
  return { payload, reportPath, exitCode: isSuitePass(outcome) ? 0 : 1 };
}

async function runRegression(argv) {
  const runId = flag(argv, "--run-id") || `regression-${Date.now()}`;
  const reportsRoot = path.resolve("reports");
  const testCasesRoot = path.resolve("test-cases");
  const runs = readStoredRuns(reportsRoot);
  const lastKnown = buildLastKnownResults(runs, REPO_ROOT);
  const approved = buildApprovedSpecIndex({ runs, testCasesRoot, root: REPO_ROOT });
  const discovered = discoverRegressionTests(REPO_ROOT);
  const { included, candidates } = selectRegressionSpecs({ specPaths: discovered.paths, root: REPO_ROOT, lastKnown, approved });

  const selectionPath = path.resolve("reports", runId, "regression-selection.json");
  saveRegressionSelection({
    runId,
    selectionPath,
    included,
    candidates,
    warnings: [
      ...discovered.warnings,
      ...(runs.length ? [] : ["No stored approved-run results were found, so no spec has a verified PASS baseline"]),
    ],
  });

  if (!included.length) {
    const payload = {
      suite: "regression",
      outcome: "SKIPPED_NOT_CONFIGURED",
      status: "SKIPPED_NOT_CONFIGURED",
      configured: true,
      reason: "No spec met the regression bar: it must be READY_FOR_AUTOMATION and have a last per-test result of PASS from source playwright-json",
      selectionPath,
      included: [],
      candidates,
      totals: { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 },
      tests: [],
      executed: false,
    };
    const reportPath = writeReport(runId, "regression", payload);
    return { payload, reportPath, exitCode: 0 };
  }

  const result = await executePlaywright(included, { runId, environment: flag(argv, "--environment"), outputRoot: path.resolve("test-results", runId) });
  const outcome = suiteOutcomeFor(result.totals);
  const payload = {
    suite: "regression",
    outcome,
    status: outcome,
    configured: true,
    selectionPath,
    included,
    candidates,
    totals: result.totals,
    tests: result.tests,
    failures: result.failures,
    executed: true,
  };
  const reportPath = writeReport(runId, "regression", payload);
  return { payload, reportPath, exitCode: isSuitePass(outcome) ? 0 : 1 };
}

async function main() {
  const argv = process.argv.slice(2);
  // Mode is explicit: --smoke selects smoke, anything else selects regression.
  const mode = argv.includes("--smoke") ? "smoke" : process.env.QA_SUITE === "smoke" ? "smoke" : "regression";
  const { payload, reportPath, exitCode } = mode === "smoke" ? await runSmoke(argv) : await runRegression(argv);
  console.log(JSON.stringify({ suite: mode, outcome: payload.outcome, configured: payload.configured, reason: payload.reason, included: payload.included, totals: payload.totals, selectionPath: payload.selectionPath, reportPath }, null, 2));
  process.exitCode = exitCode;
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, runSmoke, runRegression };
