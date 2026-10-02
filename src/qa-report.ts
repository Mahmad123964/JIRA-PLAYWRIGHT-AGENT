import fs from "fs";
import path from "path";
import { scanSecrets, type AuditEvent, type SecretScanResult, verifyArtifact } from "./security-audit";

export interface QaReport { runId: string; timestamp: string; environment: string; module?: string; scope?: string; url?: string; status: "SUCCESS" | "PARTIAL" | "FAILED" | "BLOCKED"; sections: Record<string, unknown>; security: SecretScanResult; auditTrail: AuditEvent[]; }

export function createQaReport(input: Omit<QaReport, "timestamp" | "security"> & { security?: SecretScanResult }): QaReport {
  const text = JSON.stringify(input.sections || {});
  const security = input.security || scanSecrets([{ path: "report", content: text }]);
  return { ...input, timestamp: new Date().toISOString(), security };
}

export function saveQaReport(report: QaReport, outputPath = path.resolve("reports", report.runId, "qa-report.json")): string {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  return outputPath;
}

export function verifyReport(outputPath: string): { status: "AVAILABLE" | "UNAVAILABLE"; path: string } { return verifyArtifact(outputPath); }

export function renderReportText(report: QaReport): string {
  const totals = report.sections.execution || report.sections.totals || {};
  return [`QA REPORT`, `Run ID: ${report.runId}`, `Status: ${report.status}`, `Environment: ${report.environment}`, `URL: ${report.url || "Not available / not applicable."}`, `Module: ${report.module || "Not available / not applicable."}`, `Scope: ${report.scope || "Not available / not applicable."}`, `Security: ${report.security.status}`, `Execution: ${JSON.stringify(totals)}`, `Audit events: ${report.auditTrail.length}`].join("\n");
}
