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
const { aggregateFinalReport, saveFinalReport, finalReportText } = require(
  path.join(__dirname, "../src/final-report.ts"),
);
const { execFileSync } = require("child_process");
function flag(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")
    ? argv[i + 1]
    : undefined;
}
function main() {
  const argv = process.argv.slice(2);
  const runId = flag(argv, "--run-id");
  if (!runId) throw new Error("Usage: npm run report-final --run-id <run-id>");
  const inputPath = path.resolve("reports", runId, "approved-run-result.json");
  if (!fs.existsSync(inputPath))
    throw new Error(`Approved run result not found: ${inputPath}`);
  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const report = aggregateFinalReport(runId, input, {
    environment: flag(argv, "--environment"),
  });
  const reportPath = saveFinalReport(report);
  const pdfPath = path.resolve("reports", runId, "qa-report.pdf");
  execFileSync(
    process.execPath,
    [path.join(__dirname, "report-pdf.js"), reportPath, pdfPath],
    { stdio: "inherit" },
  );
  console.log(
    JSON.stringify(
      {
        reportPath,
        pdfPath,
        status: report.status,
        text: finalReportText(report),
      },
      null,
      2,
    ),
  );
}
if (require.main === module)
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
module.exports = { main };
