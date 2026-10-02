"use strict";
const fs = require("fs");
const path = require("path");
const typescript = require("typescript");
require.extensions[".ts"] = function (module, filename) {
  const out = typescript.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};
const { createDefect, selectJiraEligibleFailure } = require(
  path.join(__dirname, "../src/jira-defects.ts"),
);
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : undefined;
}
async function main() {
  const argv = process.argv.slice(2);
  const runId = flag(argv, "--run-id") || `defect-${Date.now()}`;
  const category = flag(argv, "--category") || "A. REAL APPLICATION DEFECT";
  const failure = { diagnosis: { category } };
  if (!selectJiraEligibleFailure(failure)) {
    const result = {
      status: "EXCLUDED",
      reason: `Category ${category} is not eligible for Jira defect sink`,
      dryRun: true,
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const result = await createDefect({
    projectKey: flag(argv, "--project") || "QA",
    sourceIssueKey: flag(argv, "--test-case") || "TC-DEMO-DEFECT",
    summary: flag(argv, "--summary") || "Demo application behavior mismatch",
    requirement: flag(argv, "--requirement") || "Demo requirement",
    expected: flag(argv, "--expected") || "Expected demo behavior",
    actual: flag(argv, "--actual") || "Observed demo behavior",
    environment: flag(argv, "--environment") || "fixture-demo",
    url: flag(argv, "--url") || "http://127.0.0.1:4191/",
    runId,
    evidence: flag(argv, "--evidence") || `reports/${runId}/evidence.log`,
  });
  const output = path.resolve("reports", runId, "defect-result.json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify({ ...result, output }, null, 2));
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
