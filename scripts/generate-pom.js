"use strict";
const fs = require("fs");
const path = require("path");
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
const { generateAutomation } = require(
  path.join(__dirname, "../src/automation-generator.ts"),
);
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : undefined;
}
function main() {
  const inputPath = flag(process.argv.slice(2), "--input");
  if (!inputPath || !fs.existsSync(path.resolve(inputPath)))
    throw new Error(
      "--input must point to an approval store or JSON containing testCases",
    );
  const value = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
  const result = generateAutomation({
    testCases: value.testCases || value,
    explorationResult: value.explorationResult,
    outputRoot: flag(process.argv.slice(2), "--output-root"),
    allowPartialExploration: process.argv.includes("--allow-partial"),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "SUCCESS" ? 0 : 1;
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { main };
