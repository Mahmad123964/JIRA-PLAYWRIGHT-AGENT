"use strict";
const path = require("path");
const fs = require("fs");
const typescript = require("typescript");
require.extensions[".ts"] = function loadTs(module, filename) {
  const src = fs.readFileSync(filename, "utf8");
  const out = typescript.transpileModule(src, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};
const { discoverRegressionTests, discoverSmokeTests } = require(
  path.join(__dirname, "../src/test-discovery.ts"),
);
const { executePlaywright } = require(
  path.join(__dirname, "../src/execution-engine.ts"),
);
const { saveQaReport, createQaReport } = require(
  path.join(__dirname, "../src/qa-report.ts"),
);
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : undefined;
}
async function main() {
  const argv = process.argv.slice(2);
  const smoke = argv.includes("--smoke");
  const suite = smoke
    ? discoverSmokeTests(
        process.cwd(),
        argv.filter((a) => a.endsWith(".spec.ts")),
      )
    : discoverRegressionTests();
  console.error(JSON.stringify(suite, null, 2));
  if (!suite.paths.length) {
    console.log(
      JSON.stringify(
        {
          ...suite,
          totals: { total: 0, passed: 0, failed: 0, blocked: 0, skipped: 0 },
        },
        null,
        2,
      ),
    );
    return;
  }
  const result = await executePlaywright(suite.paths, {
    runId:
      flag(argv, "--run-id") ||
      `${smoke ? "smoke" : "regression"}-${Date.now()}`,
    environment: flag(argv, "--environment"),
  });
  const report = createQaReport({ runId: result.runId, environment: flag(argv, "--environment") || "unknown", status: result.totals.failed || result.totals.blocked ? "FAILED" : "SUCCESS", sections: { [smoke ? "smoke" : "regression"]: result }, auditTrail: [] }); const reportPath = saveQaReport(report, path.resolve("reports", result.runId, smoke ? "smoke-report.json" : "regression-report.json")); console.log(JSON.stringify({ ...suite, ...result, reportPath }, null, 2)); process.exitCode = result.totals.failed || result.totals.blocked ? 1 : 0; }
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
