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
const { createQaReport, saveQaReport } = require(
  path.join(__dirname, "../src/qa-report.ts"),
);
function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(path.resolve(input)))
    throw new Error("Provide a JSON input report path");
  const value = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  const report = createQaReport(value);
  const output = saveQaReport(
    report,
    process.argv[3] ? path.resolve(process.argv[3]) : undefined,
  );
  console.log(JSON.stringify({ output, report }, null, 2));
}
if (require.main === module)
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
module.exports = { main };
