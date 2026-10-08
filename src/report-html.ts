import type { FinalReport, HumanReviewSection, SuiteSection } from "./final-report";
import { humanReviewLabel, describeSuiteSection } from "./final-report";

/**
 * Renders the PDF report as HTML from the same FinalReport object
 * finalReportText() already renders as plain text -- one data source, two
 * presentations. Playwright's page.pdf() turns this into the PDF; there is no
 * 5000-character cut and no single-line-per-report layout, so long content
 * wraps and paginates instead of running off the page or being discarded.
 */

const FAILURE_CATEGORIES = [
  "A. REAL APPLICATION DEFECT",
  "B. AUTOMATION / TEST IMPLEMENTATION ISSUE",
  "C. ENVIRONMENT / INFRASTRUCTURE ISSUE",
  "D. FLAKY / TRANSIENT FAILURE",
  "E. BLOCKED / MISSING REQUIREMENT",
] as const;

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function na(value: unknown): string {
  return value === undefined || value === null || value === "" ? "Not available / not applicable." : esc(value);
}

function section(title: string, body: string): string {
  return `<section class="section"><h2>${esc(title)}</h2>${body}</section>`;
}

function table(headers: string[], rows: string[][]): string {
  if (!rows.length) return "<p class=\"empty\">None.</p>";
  const head = `<tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`;
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("");
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function runSummary(report: FinalReport): string {
  const execution = report.sections.execution as { totals?: Record<string, number> } | undefined;
  const healingCount = Array.isArray(report.sections.healing) ? report.sections.healing.length : 0;
  const rows: Array<[string, string]> = [
    ["Run ID", esc(report.runId)],
    ["Status", esc(report.status)],
    ["Environment", esc(report.environment)],
    ["URL", na(report.url)],
    ["Module", na(report.module)],
    ["Scope", na(report.scope)],
    ["Execution totals", esc(JSON.stringify(execution?.totals || {}))],
    ["Healing entries", esc(healingCount)],
    ["Security", esc(report.security.status)],
  ];
  return section("Run summary", table(["Field", "Value"], rows.map(([k, v]) => [k, v])));
}

function needsHumanReview(report: FinalReport): string {
  const humanReview = report.sections.humanReview as HumanReviewSection | undefined;
  const label = humanReviewLabel(humanReview);
  const items = humanReview?.items || [];
  const rows = items.map((item) => [esc(item.source), esc(item.test || item.category || "run"), esc(item.reason)]);
  return section("Needs human review", `<p class="label">${esc(label)}</p>${table(["Source", "Test / Category", "Reason"], rows)}`);
}

function suiteSection(report: FinalReport, key: "smoke" | "regression", label: string): string {
  const lines = describeSuiteSection(report.sections[key] as SuiteSection | null, label);
  return section(label, `<pre class="wrap">${lines.map(esc).join("\n")}</pre>`);
}

function requirementCoverage(report: FinalReport): string {
  const coverage = ((report.sections.requirements as { coverage?: Array<{ testCaseId?: string; requirements?: string[]; executableSteps?: number; flaggedSteps?: string[] }> } | undefined)?.coverage) || [];
  const rows = coverage.map((item) => [
    esc(item.testCaseId || "unknown"),
    esc((item.requirements || []).join("; ")),
    esc(item.executableSteps ?? 0),
    esc((item.flaggedSteps || []).join("; ") || "none"),
  ]);
  return section("Requirement coverage", table(["Test case", "Requirements", "Executable steps", "Flagged steps"], rows));
}

/**
 * A real table, not a JSON blob. BLOCKED/SKIPPED/FAIL render as their real
 * status text -- there is no special-casing that could make a non-pass read
 * as PASS.
 */
function resultsTable(report: FinalReport): string {
  const results = (report.sections.results as Array<{ path?: string; title?: string; status?: string; durationMs?: number; source?: string; error?: string }>) || [];
  const rows = results.map((item) => [
    `<span class="wrap">${esc(item.title || item.path || "unknown")}</span>`,
    `<span class="status status-${esc((item.status || "").toLowerCase())}">${esc(item.status || "UNKNOWN")}</span>`,
    esc(item.durationMs ?? ""),
    esc(item.source || ""),
    `<span class="wrap">${esc(item.error || "")}</span>`,
  ]);
  return section("Results table", table(["Test", "Status", "Duration (ms)", "Source", "Error"], rows));
}

function failureClassification(report: FinalReport): string {
  const counts = (report.sections.failureClassification as Record<string, number>) || {};
  const known = new Set<string>(FAILURE_CATEGORIES);
  const rows = FAILURE_CATEGORIES.map((category) => [esc(category), esc(counts[category] || 0)]);
  for (const [category, count] of Object.entries(counts)) {
    if (!known.has(category)) rows.push([esc(category), esc(count)]);
  }
  return section("Failure classification", table(["Category", "Count"], rows));
}

/** Original locator, candidate, confidence, outcome; suggested patches marked not-applied. */
function healingLog(report: FinalReport): string {
  const entries = (report.sections.healing as Array<{ outcome?: string; reason?: string; suggestedPatch?: { originalLocator?: string; replacement?: string; confidence?: number }; attempts?: Array<{ originalLocator?: string; candidate?: string; confidence?: number; validationResult?: string }> }>) || [];
  if (!entries.length) return section("Healing log (suggested patches are not applied automatically)", "<p class=\"empty\">None.</p>");
  const blocks = entries.map((entry) => {
    const attemptRows = (entry.attempts || []).map((a) => [
      `<span class="wrap">${esc(a.originalLocator || "")}</span>`,
      `<span class="wrap">${esc(a.candidate || "(none)")}</span>`,
      esc(a.confidence ?? 0),
      esc(a.validationResult || "NOT_RUN"),
    ]);
    const patch = entry.suggestedPatch
      ? `<p class="label">Suggested patch: <span class="wrap">${esc(entry.suggestedPatch.originalLocator)} -&gt; ${esc(entry.suggestedPatch.replacement)}</span> (confidence ${esc(entry.suggestedPatch.confidence)}) -- not applied automatically.</p>`
      : "";
    return `<div class="healing-entry"><p class="label">Outcome: <strong>${esc(entry.outcome || "UNKNOWN")}</strong> -- ${esc(entry.reason || "")}</p>${table(["Original locator", "Candidate", "Confidence", "Validation result"], attemptRows)}${patch}</div>`;
  });
  return section("Healing log (suggested patches are not applied automatically)", blocks.join(""));
}

function evidenceIndex(report: FinalReport): string {
  const rows = report.evidence.map((item) => [esc(item.kind), `<span class="status status-${esc(item.status.toLowerCase())}">${esc(item.status)}</span>`, `<span class="wrap">${esc(item.path)}</span>`]);
  return section("Evidence index", table(["Kind", "Status", "Path"], rows));
}

function auditTrail(report: FinalReport): string {
  const events = (report.sections.audit as Array<{ timestamp?: string; phase?: string; action?: string; decision?: string; reason?: string }>) || [];
  const rows = events.map((event) => [esc(event.timestamp || ""), esc(event.phase || ""), esc(event.action || ""), esc(event.decision || ""), `<span class="wrap">${esc(event.reason || "")}</span>`]);
  return section("Audit trail", table(["Timestamp", "Phase", "Action", "Decision", "Reason"], rows));
}

function blockersAndLimitations(report: FinalReport): string {
  const blockers = (report.sections.blockers as Array<Record<string, unknown>>) || [];
  const rows = blockers.map((item) => {
    const testCaseId = item.testCaseId ?? item.id;
    const status = item.status;
    const reason = item.reason;
    if (testCaseId !== undefined || reason !== undefined) {
      return [esc(testCaseId ?? "unknown"), esc(status ?? ""), `<span class="wrap">${esc(reason ?? "")}</span>`];
    }
    return ["", "", `<span class="wrap">${esc(JSON.stringify(item))}</span>`];
  });
  return section("Blockers and limitations", table(["Test case", "Status", "Reason"], rows));
}

const STYLE = `
  @page { size: A4; margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; color: #1a1a1a; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 4mm 0; }
  h2 { font-size: 12pt; margin: 6mm 0 2mm 0; border-bottom: 1px solid #ccc; padding-bottom: 1mm; }
  .section { page-break-inside: auto; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; table-layout: fixed; }
  th, td { border: 1px solid #ccc; padding: 1.5mm 2mm; text-align: left; vertical-align: top; font-size: 9pt; }
  th { background: #f0f0f0; }
  .wrap { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; }
  pre.wrap { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; font-family: inherit; margin: 0; }
  .label { margin: 1mm 0 2mm 0; }
  .empty { color: #666; font-style: italic; }
  .status-pass { color: #0a6b00; font-weight: bold; }
  .status-fail { color: #a40000; font-weight: bold; }
  .status-blocked, .status-skipped { color: #a66a00; font-weight: bold; }
  .healing-entry { margin-bottom: 3mm; }
`;

export function renderReportHtml(report: FinalReport): string {
  const body = [
    `<h1>FINAL QA REPORT</h1>`,
    runSummary(report),
    needsHumanReview(report),
    suiteSection(report, "smoke", "Smoke suite"),
    suiteSection(report, "regression", "Regression suite"),
    requirementCoverage(report),
    resultsTable(report),
    failureClassification(report),
    healingLog(report),
    evidenceIndex(report),
    auditTrail(report),
    blockersAndLimitations(report),
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.runId)} QA Report</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}
