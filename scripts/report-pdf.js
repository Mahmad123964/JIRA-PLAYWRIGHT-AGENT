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
const { renderReportHtml } = require(
  path.join(__dirname, "../src/report-html.ts"),
);
const { sanitizeSecrets } = require(
  path.join(__dirname, "../src/document-ingestion.ts"),
);

/**
 * Renders final-report.json as HTML (src/report-html.ts -- the same data
 * finalReportText() renders as plain text) and turns it into a real,
 * paginated PDF with Playwright's page.pdf(). No new dependency:
 * @playwright/test is already a devDependency and already provides chromium.
 *
 * Replaces the old hand-rolled single-content-stream PDF, which (a) cut the
 * report at 5000 characters and (b) joined every line with a space onto one
 * text row that ran off the page's right edge after ~100 characters -- so
 * nearly the entire report was invisible both on screen and to text
 * extraction despite being present in the file's raw bytes. There is no
 * length cut here: long content wraps (CSS white-space: pre-wrap /
 * word-break: break-word) and paginates (page.pdf()'s normal page breaks)
 * instead of being clipped or discarded.
 *
 * Secret masking: final-report.json is already sanitized when it is written
 * (saveFinalReport), but the rendered HTML is sanitized again here as a
 * second, independent layer before it ever reaches the browser or the PDF --
 * the same defense-in-depth already used elsewhere in this codebase (e.g.
 * final-report.ts's own raw-then-verify secret scan).
 */
async function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(path.resolve(input)))
    throw new Error("Provide a final report JSON path");
  const output = path.resolve(process.argv[3] || "qa-report.pdf");
  const report = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  const html = sanitizeSecrets(renderReportHtml(report)).sanitized;

  const { chromium } = require("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.pdf({ path: output, format: "A4", printBackground: true, margin: { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" } });
  } finally {
    await browser.close();
  }

  console.log(
    JSON.stringify(
      {
        status: fs.existsSync(output) ? "AVAILABLE" : "UNAVAILABLE",
        path: output,
      },
      null,
      2,
    ),
  );
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { main };
