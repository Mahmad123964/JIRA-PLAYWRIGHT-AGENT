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
const { classifyFailure } = require(
  path.join(__dirname, "../src/failure-classifier.ts"),
);
function main() {
  const input = process.argv.slice(2).join(" ") || "";
  console.log(JSON.stringify(classifyFailure({ message: input }), null, 2));
}
if (require.main === module) main();
module.exports = { main };
