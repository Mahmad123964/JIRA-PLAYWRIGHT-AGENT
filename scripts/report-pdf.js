"use strict";
const fs = require("fs");
const path = require("path");
function escape(value) {
  return String(value)
    .replace(/\\/g, "\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}
function makePdf(text) {
  const stream = `BT /F1 10 Tf 50 760 Td (${escape(text.slice(0, 5000))}) Tj ET`;
  const objects = [
    `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj`,
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj`,
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>/Contents 4 0 R>>endobj`,
    `4 0 obj<</Length ${Buffer.byteLength(stream)}>>stream\n${stream}\nendstream endobj`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += `${object}\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
    .join(
      "",
    )}trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
function main() {
  const input = process.argv[2];
  if (!input || !fs.existsSync(path.resolve(input)))
    throw new Error("Provide a final report JSON path");
  const output = path.resolve(process.argv[3] || "qa-report.pdf");
  const report = JSON.parse(fs.readFileSync(path.resolve(input), "utf8"));
  const sections = report.sections || {};
  const humanReview = sections.humanReview || { count: 0, distinctTests: 0, items: [] };
  const smoke = sections.smoke;
  const regression = sections.regression;
  // Rendered before the large JSON blocks: the PDF text is truncated at 5000
  // characters, so a suite line placed later would be cut off entirely.
  const suiteLine = (label, section) => {
    if (!section) return `${label}: NOT RUN`;
    const verdict = section.pass ? "" : " (not a pass)";
    const reason = section.reason ? ` | ${section.reason}` : "";
    const specs = Array.isArray(section.included) ? ` | specs: ${section.included.length}` : "";
    return `${label}: ${section.outcome}${verdict}${specs}${reason}`;
  };
  const lines = [
    "FINAL QA REPORT",
    `Run summary: ${report.runId} | ${report.status} | ${report.environment}`,
    // Suite verdicts are placed immediately after the run summary, before the
    // large JSON blocks: the PDF text is truncated at 5000 characters, so
    // anything later would be cut off and these cases would be invisible.
    suiteLine("Smoke suite", smoke),
    suiteLine("Regression suite", regression),
    `NEEDS HUMAN REVIEW: ${humanReview.count} signal(s) across ${humanReview.distinctTests} test(s) (not auto-filed; possible real application defects)`,
    ...(humanReview.items || []).map(
      (item, index) =>
        `  ${index + 1}. [${item.source}] ${item.test || item.category || "run"} - ${item.reason}`,
    ),
    `URL: ${report.url || "Not available / not applicable."}`,
    `Module: ${report.module || "Not available / not applicable."} | Scope: ${report.scope || "Not available / not applicable."}`,
    "Requirement coverage",
    JSON.stringify(sections.exploration || sections.requirements || {}),
    "Results table",
    JSON.stringify(sections.execution || {}),
    "Failure classification",
    JSON.stringify(sections.failures || []),
    "Healing log (suggested patches are not applied automatically)",
    JSON.stringify(sections.healing || []),
    "Evidence index",
    JSON.stringify(report.evidence || []),
    "Audit trail",
    JSON.stringify(sections.audit || []),
    "Blockers and limitations",
    JSON.stringify(sections.blockers || []),
    `Security: ${report.security?.status || "Not available / not applicable."}`,
  ];
  fs.writeFileSync(
    output,
    makePdf(lines.join("\n")),
  );
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
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
module.exports = { main };
