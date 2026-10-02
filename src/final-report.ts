import fs from "fs";
import path from "path";
import { sanitizeSecrets } from "./document-ingestion";
import { scanSecrets, verifyArtifact, type SecretScanResult } from "./security-audit";

export type FinalStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "BLOCKED";
export interface FinalEvidence { kind: string; status: "AVAILABLE" | "MISSING"; path: string; }
export interface FinalReport { runId: string; timestamp: string; status: FinalStatus; environment: string; url?: string; module?: string; scope?: string; sections: Record<string, unknown>; evidence: FinalEvidence[]; security: SecretScanResult; }

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
      smoke: options.smoke || null,
      regression: options.regression || null,
      failures: execution.failures || [],
      blockers: (runResult.automation as { blocked?: unknown } | undefined)?.blocked || (runResult.approval as { blockedCases?: unknown } | undefined)?.blockedCases || [],
      defects: runResult.defects || null,
      audit: runResult.audit || []
    }
  };
}
export function saveFinalReport(report: FinalReport, outputPath = path.resolve("reports", report.runId, "final-report.json")): string { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); const sanitized = sanitizeSecrets(JSON.stringify(report, null, 2)).sanitized; fs.writeFileSync(outputPath, sanitized, "utf8"); return outputPath; }
export function finalReportText(report: FinalReport): string { const execution = report.sections.execution as { totals?: unknown } | undefined; return ["FINAL QA REPORT", `Run ID: ${report.runId}`, `Status: ${report.status}`, `Environment: ${report.environment}`, `URL: ${report.url || "Not available / not applicable."}`, `Module: ${report.module || "Not available / not applicable."}`, `Scope: ${report.scope || "Not available / not applicable."}`, `Execution: ${JSON.stringify(execution?.totals || {})}`, `Healing entries: ${Array.isArray(report.sections.healing) ? report.sections.healing.length : 0}`, `Evidence artifacts: ${report.evidence.length}`, `Security: ${report.security.status}`].join("\n"); }
