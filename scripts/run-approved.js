"use strict";
const fs = require("fs");
const path = require("path");
const typescript = require("typescript");
require.extensions[".ts"] = function loadTs(module, filename) {
  const out = typescript.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};
const { runApprovedCases } = require(
  path.join(__dirname, "../src/approved-runner.ts"),
);
function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--")
    ? argv[index + 1]
    : undefined;
}
async function main() {
  const argv = process.argv.slice(2);
  const storeId = flag(argv, "--store");
  if (!storeId)
    throw new Error(
      "Usage: npm run-approved --store <store-id> [--run-id <id>] [--output-root <dir>] [--browser <name>] [--project <name>]",
    );
  const result = await runApprovedCases({
    storeId,
    runId: flag(argv, "--run-id"),
    outputRoot: flag(argv, "--output-root"),
    environment: flag(argv, "--environment"),
    browser: flag(argv, "--browser"),
    project: flag(argv, "--project"),
    captureArtifacts: !argv.includes("--no-artifacts"),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "SUCCESS" ? 0 : 1;
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
module.exports = { main };
