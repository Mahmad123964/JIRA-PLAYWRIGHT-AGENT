import fs from "fs";
import path from "path";
import { exploreUrl, type ExplorationInput, type ExplorationResult } from "./browser-explorer";
import { generateTestCases, type TestCase } from "./test-case-generator";
import { createApprovalStore, saveApprovalStore } from "./approval-store";
import { generateAutomation } from "./automation-generator";
import { AuditTrail } from "./security-audit";
import { createQaReport, saveQaReport, type QaReport } from "./qa-report";
import { normalizeRequirementsAsync, type RequirementInput } from "./requirement-sources";
import { getIntegrationHealth } from "./integration-health";
import type { RequirementSource, SourcePolicy } from "./core-models";

export interface QaPipelineInput extends Omit<ExplorationInput, "requirements">, RequirementInput {
  requirements?: string[];
  sources?: RequirementSource[];
  policy?: SourcePolicy;
  runId?: string;
  jiraKey?: string;
  environment?: string;
  headless?: boolean;
  outputRoot?: string;
}
export interface QaPipelineResult { runId: string; exploration: ExplorationResult; testCases: TestCase[]; approvalStoreId?: string; automation: ReturnType<typeof generateAutomation>; report: QaReport; }

export async function runQaPipeline(input: QaPipelineInput): Promise<QaPipelineResult> {
  const runId = input.runId || `qa-${Date.now()}`;
  const context = await normalizeRequirementsAsync({ requirements: input.requirements, sources: input.sources, specFile: input.specFile, policy: input.policy });
  const requirements = context.requirements.map((requirement) => requirement.description);
  const explorationInput: ExplorationInput = { url: input.url, module: input.module, scope: input.scope, requirements };
  const audit = new AuditTrail(runId);
  audit.record({ phase: "REQUIREMENTS", action: "NORMALIZED", decision: `${requirements.length} requirement(s)`, reason: context.warnings.join("; ") || undefined });
  audit.record({ phase: "INTEGRATIONS", action: "HEALTH_CHECKED", decision: getIntegrationHealth().map((item) => `${item.name}:${item.status}`).join(", ") });
  audit.record({ phase: "EXPLORATION", action: "STARTED", source: input.url, decision: "RUN" });
  const exploration = await exploreUrl(explorationInput, { headless: input.headless !== false });
  audit.record({ phase: "EXPLORATION", action: "COMPLETED", source: input.url, decision: exploration.explorationStatus || exploration.status, reason: exploration.error });
  const generated = generateTestCases({ requirements, explorationResult: exploration, module: input.module, scope: input.scope, jiraTicketKey: input.jiraKey });
  const store = createApprovalStore(input.module, input.scope, generated.testCases); const storePath = saveApprovalStore(store);
  audit.record({ phase: "APPROVAL", action: "CREATED", outputReference: storePath, decision: "PENDING_APPROVAL" });
  const reportDir = path.resolve(input.outputRoot || "reports", runId); fs.mkdirSync(reportDir, { recursive: true });
  const report = createQaReport({ runId, environment: input.environment || "unknown", module: input.module, scope: input.scope, url: input.url, status: exploration.explorationStatus === "SUCCESS" ? "PARTIAL" : "BLOCKED", sections: { integrations: getIntegrationHealth(), requirements: context, exploration, testCases: generated, approvalStore: store.storeId, automation: { status: "BLOCKED", reason: "Human approval is a hard gate; no READY_FOR_AUTOMATION cases were supplied to this pipeline run." } }, auditTrail: audit.events });
  saveQaReport(report, path.join(reportDir, "qa-report.json")); audit.save(path.join(reportDir, "audit.json"));
  return { runId, exploration, testCases: generated.testCases, approvalStoreId: store.storeId, automation: { status: "BLOCKED", generated: [], blocked: generated.testCases.map((tc) => ({ testCaseId: tc.testCaseId, reason: "Human approval is required before automation generation" })), warnings: [] }, report };
}
