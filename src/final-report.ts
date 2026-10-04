import fs from "fs";
import path from "path";
import { sanitizeSecrets } from "./document-ingestion";
import { scanSecrets, verifyArtifact, type SecretScanResult } from "./security-audit";

export type FinalStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "BLOCKED";
export interface FinalEvidence { kind: string; status: "AVAILABLE" | "MISSING"; path: string; }
export interface HumanReviewItem { source: "healing" | "failure-classification"; test?: string; category?: string; reason: string; possibleRealDefect: boolean; }
export interface HumanReviewSection { count: number; distinctTests: number; items: HumanReviewItem[]; }
export interface FinalReport { runId: string; timestamp: string; status: FinalStatus; environment: string; url?: string; module?: string; scope?: string; sections: Record<string, unknown>; evidence: FinalEvidence[]; security: SecretScanResult; }

/**
 * Phrases that mark a case as needing a human decision rather than a verdict.
 * A removed element is classified B (automation) because no assertion was ever
 * compared, but it may genuinely be an application change -- so it must stay
 * visible instead of disappearing into a B bucket. `possible real application
 * change` is the shared phrase used by both validated-healing and the failure
 * classifier.
 */
const HUMAN_REVIEW_MARKERS = /HUMAN_REVIEW_REQUIRED|possible real application change|possible application defect|need[s]? human review|unclassified/i;

export function collectHumanReview(runResult: Record<string, unknown>, failures: unknown[]): HumanReviewSection {
  const items: HumanReviewItem[] = [];
  const failingTests = (Array.isArray(failures) ? failures : []).map((failure) => String((failure as { path?: string }).path || (failure as { title?: string }).title || "")).filter(Boolean);
  for (const entry of (Array.isArray(runResult.healing) ? runResult.healing : []) as Array<{ outcome?: string; reason?: string }>) {
    const reason = String(entry?.reason || "");
    if (entry?.outcome === "NOT_HEALED" || HUMAN_REVIEW_MARKERS.test(reason)) {
      items.push({
        source: "healing",
        // ValidatedHealingResult carries no spec path. When the run had exactly one
        // failing test the attribution is unambiguous and is recorded; otherwise
        // the finding is genuinely run-level and must not claim a test, rather
        // than silently reporting "0 tests".
        test: failingTests.length === 1 ? failingTests[0] : undefined,
        reason,
        possibleRealDefect: true,
      });
    }
  }
  for (const failure of failures) {
    const diagnosis = (failure as { diagnosis?: { category?: string; rationale?: string } } | undefined)?.diagnosis;
    const rationale = String(diagnosis?.rationale || "");
    if (rationale && HUMAN_REVIEW_MARKERS.test(rationale)) {
      items.push({
        source: "failure-classification",
        test: String((failure as { path?: string }).path || (failure as { title?: string }).title || "unknown"),
        category: String(diagnosis?.category || "UNKNOWN"),
        reason: rationale,
        possibleRealDefect: true,
      });
    }
  }
  // One removed element produces two corroborating findings: the healing entry
  // (NOT_HEALED) and the B classification. They come from different layers and
  // are listed separately, so `count` is the number of findings while
  // `distinctTests` is the number of affected failing tests.
  const distinctTests = new Set(items.map((item) => item.test).filter(Boolean)).size;
  return { count: items.length, distinctTests, items };
}

/** Grammatical, unambiguous rendering of the human-review counts. */
export function humanReviewLabel(section: HumanReviewSection | undefined): string {
  if (!section || section.count === 0) return "NEEDS HUMAN REVIEW: none";
  const findings = section.count === 1 ? "1 finding" : `${section.count} findings`;
  if (section.distinctTests === 0) return `NEEDS HUMAN REVIEW: ${findings} (run-level; no single failing test could be attributed)`;
  const tests = section.distinctTests === 1 ? "1 failing test" : `${section.distinctTests} failing tests`;
  return `NEEDS HUMAN REVIEW: ${findings} across ${tests}`;
}

function evidenceFor(pathValue: string, kind: string): FinalEvidence { const checked = verifyArtifact(pathValue); return { kind, status: checked.status === "AVAILABLE" ? "AVAILABLE" : "MISSING", path: checked.path }; }
function collectEvidence(value: unknown, result: FinalEvidence[], seen = new Set<string>(), key = ""): void {
    if (!value) return;
    if (typeof value === "string" && /^(path|resultPath|outputReference)$/i.test(key)) {
        const resolved = path.resolve(value);
        if (!seen.has(resolved)) { seen.add(resolved); result.push(evidenceFor(resolved, path.extname(resolved).slice(1) || "artifact")); }
        return;
    }
    if (Array.isArray(value)) value.forEach((item) => collectEvidence(item, result, seen, key));
    else if (typeof value === "object") Object.entries(value as Record<string, unknown>).forEach(([childKey, item]) => collectEvidence(item, result, seen, childKey));
}
function determineStatus(run: Record<string, unknown>): FinalStatus {
    const status = run.status;
    if (status === "FAILED" || status === "BLOCKED" || status === "PARTIAL" || status === "SUCCESS") return status;
    const execution = run.execution as { totals?: { failed?: number; blocked?: number; skipped?: number } | undefined };
    if (execution?.totals?.failed) return "FAILED";
    if (execution?.totals?.blocked || execution?.totals?.skipped) return "PARTIAL";
    return "BLOCKED";
}
/**
 * Normalises a suite payload for the final report.
 *
 * A suite that did not run, or that ran with blocked/skipped work, must never
 * read as a pass. `SKIPPED_NOT_CONFIGURED` is preserved verbatim and `pass` is
 * true only for a clean SUCCESS outcome, so a reader (or the PDF) cannot mistake
 * BLOCKED / SKIPPED / SKIPPED_NOT_CONFIGURED for a pass.
 */
export interface SuiteSection {
  suite: string;
  outcome: string;
  pass: boolean;
  configured: boolean;
  executed: boolean;
  reason?: string;
  selectionPath?: string;
  included?: string[];
  totals?: Record<string, number>;
}

const CLEAN_SUITE_OUTCOME = "SUCCESS";

export function normalizeSuiteSection(value: unknown): SuiteSection | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const outcome = String(payload.outcome || payload.status || "UNKNOWN");
  return {
    suite: String(payload.suite || "unknown"),
    outcome,
    pass: outcome === CLEAN_SUITE_OUTCOME,
    configured: payload.configured === true,
    executed: payload.executed === true,
    reason: typeof payload.reason === "string" ? payload.reason : undefined,
    selectionPath: typeof payload.selectionPath === "string" ? payload.selectionPath : undefined,
    included: Array.isArray(payload.included) ? (payload.included as string[]) : undefined,
    totals: payload.totals && typeof payload.totals === "object" ? (payload.totals as Record<string, number>) : undefined,
  };
}

/** One-line rendering used by both the text report and the PDF. */
export function describeSuiteSection(section: SuiteSection | null, label: string): string[] {
  if (!section) return [`${label}: NOT RUN`];
  const lines = [`${label}: ${section.outcome}${section.pass ? "" : " (not a pass)"}`];
  if (!section.configured) lines.push(`  reason: ${section.reason || "not configured"}`);
  if (section.included) lines.push(`  specs: ${section.included.length ? section.included.join(", ") : "none"}`);
  if (section.totals) lines.push(`  totals: ${JSON.stringify(section.totals)}`);
  return lines;
}

export function aggregateFinalReport(runId: string, runResult: Record<string, unknown>, options: { environment?: string; smoke?: unknown; regression?: unknown } = {}): FinalReport {
  const evidence: FinalEvidence[] = [];
  collectEvidence(runResult, evidence);
  const sanitized = sanitizeSecrets(JSON.stringify(runResult));
  const security = scanSecrets([{ path: `reports/${runId}/final-report.json`, content: sanitized.sanitized }]);
  type Exec = { tests?: Array<{ path?: string; status?: string }>; totals?: unknown; failures?: unknown[] };
  type Case = { testCaseId?: string; sourceRequirements?: string[]; steps?: Array<{ expectedAssertion?: unknown; needsHumanInput?: string }> };
  const execution = (runResult.execution || {}) as Exec;
  const testCases: Case[] = Array.isArray(runResult.testCases) ? runResult.testCases as Case[] : [];
  const requirementCoverage = testCases.map((testCase) => ({ testCaseId: testCase.testCaseId, requirements: testCase.sourceRequirements || [], executableSteps: (testCase.steps || []).filter((step) => Boolean(step.expectedAssertion) && !step.needsHumanInput).length, flaggedSteps: (testCase.steps || []).filter((step) => Boolean(step.needsHumanInput)).map((step) => step.needsHumanInput) }));
  const classifications: Record<string, number> = {};
  for (const failure of execution.failures || []) {
    const category = failure && typeof failure === "object" && "diagnosis" in failure ? String((failure as { diagnosis?: { category?: string } }).diagnosis?.category || "UNKNOWN") : "UNKNOWN";
    classifications[category] = (classifications[category] || 0) + 1;
  }
  const exploration = runResult.exploration as { target?: { url?: string; module?: string; scope?: string } | undefined };
  const executionEnvironment = String((runResult.execution as { environment?: string } | undefined)?.environment || "");
  const executionCommand = String((runResult.execution as { command?: string } | undefined)?.command || "");
  const browser = executionCommand.match(/--browser\s+([^\s]+)/)?.[1] || "";
  const project = executionCommand.match(/--project\s+([^\s]+)/)?.[1] || "";
  const explicitEnvironment = String(options.environment || runResult.environment || "");
  const verifiedEnvironment = explicitEnvironment && explicitEnvironment !== "unknown" ? explicitEnvironment : executionEnvironment && executionEnvironment !== "unknown" ? executionEnvironment : `${process.platform}/${process.arch}`;
  return {
    runId,
    timestamp: new Date().toISOString(),
    status: determineStatus(runResult),
    environment: verifiedEnvironment,
    url: String(exploration?.target?.url || ""),
    module: String(exploration?.target?.module || ""),
    scope: String(exploration?.target?.scope || ""),
    evidence,
    security,
    sections: {
      run: { runId, status: determineStatus(runResult), environment: verifiedEnvironment, browser: browser || "unknown", project: project || "unknown" },
      exploration: runResult.exploration,
      requirements: { coverage: requirementCoverage },
      testCases: runResult.testCases || runResult.approval,
      approval: runResult.approval,
      execution: runResult.execution,
      results: execution.tests || [],
      healing: runResult.healing || [],
      failureClassification: classifications,
      humanReview: collectHumanReview(runResult, execution.failures || []),
      smoke: normalizeSuiteSection(options.smoke),
      regression: normalizeSuiteSection(options.regression),
      failures: execution.failures || [],
      blockers: (runResult.automation as { blocked?: unknown } | undefined)?.blocked || (runResult.approval as { blockedCases?: unknown } | undefined)?.blockedCases || [],
      defects: runResult.defects || null,
      audit: runResult.audit || []
    }
  };
}
export function saveFinalReport(report: FinalReport, outputPath = path.resolve("reports", report.runId, "final-report.json")): string { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); const sanitized = sanitizeSecrets(JSON.stringify(report, null, 2)).sanitized; fs.writeFileSync(outputPath, sanitized, "utf8"); return outputPath; }
export function finalReportText(report: FinalReport): string { const execution = report.sections.execution as { totals?: unknown } | undefined; const humanReview = report.sections.humanReview as HumanReviewSection | undefined; return ["FINAL QA REPORT", `Run ID: ${report.runId}`, `Status: ${report.status}`, `Environment: ${report.environment}`, `URL: ${report.url || "Not available / not applicable."}`, `Module: ${report.module || "Not available / not applicable."}`, `Scope: ${report.scope || "Not available / not applicable."}`, `Execution: ${JSON.stringify(execution?.totals || {})}`, `Healing entries: ${Array.isArray(report.sections.healing) ? report.sections.healing.length : 0}`, ...describeSuiteSection(report.sections.smoke as SuiteSection | null, "Smoke suite"), ...describeSuiteSection(report.sections.regression as SuiteSection | null, "Regression suite"), humanReviewLabel(humanReview), ...(humanReview?.items || []).map((item, index) => `  ${index + 1}. [${item.source}] ${item.test || item.category || "run"} - ${item.reason}`), `Evidence artifacts: ${report.evidence.length}`, `Security: ${report.security.status}`].join("\n"); }
