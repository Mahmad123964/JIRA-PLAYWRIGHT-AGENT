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
const { runQaPipeline } = require(
  path.join(__dirname, "../src/qa-pipeline.ts"),
);
function values(argv, name) {
  const result = [];
  for (let i = 0; i < argv.length; i++)
    if (argv[i] === name && argv[i + 1] && !argv[i + 1].startsWith("--"))
      result.push(argv[i + 1]);
  return result;
}
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : undefined;
}
async function main() {
  const argv = process.argv.slice(2);
  const input = {
    url: flag(argv, "--url"),
    module: flag(argv, "--module"),
    scope: flag(argv, "--scope"),
    requirements: values(argv, "--requirement"),
    specFile: flag(argv, "--spec"),
    jiraKey: flag(argv, "--jira-key"),
    environment: flag(argv, "--environment"),
    runId: flag(argv, "--run-id"),
    headless: !argv.includes("--headed"),
  };
  if ((!input.url && !input.jiraKey) || !input.module || !input.scope || (!input.requirements.length && !input.specFile))
    throw new Error(
      "--url or --jira-key, --module, --scope, and --requirement or --spec are required",
    );
  const result = await runQaPipeline(input);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.report.status === "BLOCKED" ? 1 : 0;
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
