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
const { executePlaywright } = require(
  path.join(__dirname, "../src/execution-engine.ts"),
);
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : undefined;
}
async function main() {
  const argv = process.argv.slice(2);
  const paths = argv.filter((item) => item.endsWith(".spec.ts"));
  if (!paths.length) throw new Error("Provide one or more .spec.ts paths");
  const result = await executePlaywright(paths, {
    runId: flag(argv, "--run-id") || `run-${Date.now()}`,
    environment: flag(argv, "--environment"),
    project: flag(argv, "--project"),
    browser: flag(argv, "--browser"),
    storageState: flag(argv, "--storage-state"),
    captureArtifacts: !argv.includes("--no-artifacts"),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.totals.failed || result.totals.blocked ? 1 : 0;
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
