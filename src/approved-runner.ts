import fs from "fs";
import path from "path";
import { loadApprovalStore, type ApprovalStore } from "./approval-store";
import { generateAutomation, type AutomationGenerationResult } from "./automation-generator";
import { executePlaywright, type ExecutionResult } from "./execution-engine";
import type { ExplorationResult } from "./browser-explorer";
import type { TestCase } from "./test-case-generator";
import { validatedHeal, type ValidatedHealingResult } from "./validated-healing";
import { createDefect, selectJiraEligibleFailure, type DefectResult } from "./jira-defects";

export interface ApprovedRunnerOptions {
  storeId: string;
  outputRoot?: string;
  environment?: string;
  browser?: string;
  project?: string;
  runId?: string;
  captureArtifacts?: boolean;
  automationRoot?: string;
}

export interface BlockedApprovedCase {
  testCaseId: string;
  status: string;
  reason: string;
}

export interface ApprovedRunResult {
  runId: string;
  storeId: string;
  status: "SUCCESS" | "PARTIAL" | "BLOCKED" | "FAILED";
  approval: {
    readyCaseIds: string[];
    excludedCaseIds: string[];
    blockedCases: BlockedApprovedCase[];
  };
  exploration: {
    status?: string;
    source: "store" | "file" | "missing";
    path?: string;
    reason?: string;
  };
  automation: AutomationGenerationResult;
  execution?: Omit<ExecutionResult, "healing">;
  healing?: ValidatedHealingResult[];
  defects?: DefectResult[];
  resultPath?: string;
}

function loadExploration(store: ApprovalStore): { result?: ExplorationResult; source: "store" | "file" | "missing"; path?: string; reason?: string } {
  if (store.explorationResult) return { result: store.explorationResult, source: "store" };
  if (store.explorationResultPath) {
    const filePath = path.resolve(store.explorationResultPath);
    if (!fs.existsSync(filePath)) return { source: "missing", path: filePath, reason: `Exploration result file not found: ${filePath}` };
    try {
      return { result: JSON.parse(fs.readFileSync(filePath, "utf8")) as ExplorationResult, source: "file", path: filePath };
    } catch (error) {
      return { source: "missing", path: filePath, reason: `Exploration result could not be parsed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return { source: "missing", reason: "Approval store has no saved exploration result or exploration result path" };
}

function caseBlockReason(testCase: TestCase, exploration?: ExplorationResult): string | undefined {
  if (testCase.status !== "READY_FOR_AUTOMATION") return `Case status is ${testCase.status}; only READY_FOR_AUTOMATION cases may run`;
  if (testCase.automationEligibility !== "ELIGIBLE") return `Automation eligibility is ${testCase.automationEligibility}`;
  if (!exploration) return "Verified exploration result is unavailable";
  if (exploration.explorationStatus !== "SUCCESS") return `Exploration status is ${exploration.explorationStatus || "UNKNOWN"}`;
  for (const step of testCase.steps) {
    if (!step.selectorHint) return `Step ${step.step} has no verified selector hint`;
    if (!step.expectedAssertion || step.needsHumanInput) return `Step ${step.step} ${step.needsHumanInput || "has no verified expectedAssertion; NEEDS_HUMAN_INPUT"}`;
  }
  if (/UNKNOWN|BLOCKED|NEEDS_HUMAN_INPUT|MANUAL VERIFICATION/i.test(`${testCase.expectedResult} ${testCase.testData}`)) return "Case contains UNKNOWN/BLOCKED/manual-verification data";
  return undefined;
}

export async function runApprovedCases(options: ApprovedRunnerOptions): Promise<ApprovedRunResult> {
  const runId = options.runId || `approved-${Date.now()}`;
  const store = loadApprovalStore(options.storeId);
  if (!store) {
    const automation: AutomationGenerationResult = { status: "BLOCKED", generated: [], blocked: [], warnings: [`Approval store not found: ${options.storeId}`] };
    return { runId, storeId: options.storeId, status: "BLOCKED", approval: { readyCaseIds: [], excludedCaseIds: [], blockedCases: [] }, exploration: { source: "missing", reason: "Approval store not found" }, automation };
  }

  const exploration = loadExploration(store);
  const blockedCases: BlockedApprovedCase[] = [];
  const readyCaseIds: string[] = [];
  const executable: TestCase[] = [];
  for (const testCase of store.testCases) {
    const reason = caseBlockReason(testCase, exploration.result);
    if (reason) {
      if (testCase.status === "READY_FOR_AUTOMATION" || testCase.status === "APPROVED" || testCase.status === "PENDING_APPROVAL") blockedCases.push({ testCaseId: testCase.testCaseId, status: testCase.status, reason });
      continue;
    }
    readyCaseIds.push(testCase.testCaseId);
    executable.push(testCase);
  }

  const blockedByExploration = exploration.result ? [] : executable.map((testCase) => ({ testCaseId: testCase.testCaseId, status: testCase.status, reason: exploration.reason || "Verified exploration result is unavailable" }));
  blockedCases.push(...blockedByExploration);
  if (!exploration.result || exploration.result.explorationStatus !== "SUCCESS" || !executable.length) {
    const automation: AutomationGenerationResult = { status: "BLOCKED", generated: [], blocked: blockedCases.map((item) => ({ testCaseId: item.testCaseId, reason: item.reason })), warnings: [exploration.reason || "No executable READY_FOR_AUTOMATION cases were found"] };
    return { runId, storeId: store.storeId, status: "BLOCKED", approval: { readyCaseIds, excludedCaseIds: store.testCases.filter((item) => !readyCaseIds.includes(item.testCaseId)).map((item) => item.testCaseId), blockedCases }, exploration: { status: exploration.result?.explorationStatus, source: exploration.source, path: exploration.path, reason: exploration.reason }, automation };
  }

  // `outputRoot` is what callers actually pass; `automationRoot` is kept as an
  // explicit alias. Previously only `automationRoot` was read, so every caller
  // that passed `outputRoot` silently fell back to process.cwd() and generated
  // POMs and specs INTO THE PRODUCT TREE. A unit test with module "Auth" and an
  // example.com exploration therefore overwrote the real
  // pages/Auth/AuthPage.ts, leaving a spec generated against a fixture port
  // paired with a POM that navigated somewhere else entirely.
  const generationRoot = options.automationRoot || options.outputRoot || process.cwd();
  const automation = generateAutomation({ testCases: executable, explorationResult: exploration.result, outputRoot: generationRoot, artifactScope: store.storeId, source: { jiraKey: undefined, sourceReferences: executable.flatMap((item) => item.sources), explorationReferences: executable.flatMap((item) => item.explorationReferences) } });
  if (automation.status !== "SUCCESS") return { runId, storeId: store.storeId, status: "BLOCKED", approval: { readyCaseIds, excludedCaseIds: store.testCases.filter((item) => !readyCaseIds.includes(item.testCaseId)).map((item) => item.testCaseId), blockedCases }, exploration: { status: exploration.result.explorationStatus, source: exploration.source, path: exploration.path, reason: exploration.reason }, automation };

  const specPaths = automation.generated.filter((file) => file.kind === "spec").map((file) => file.path);
  const reportRoot = path.resolve("reports", runId);
  fs.mkdirSync(reportRoot, { recursive: true });
  const healingFile = path.join(reportRoot, "healing.ndjson");
  fs.writeFileSync(healingFile, "", "utf8");
  const execution = await executePlaywright(specPaths, { runId, environment: options.environment, browser: options.browser, project: options.project, outputRoot: options.outputRoot, captureArtifacts: options.captureArtifacts, healingFile });
  const healing: ValidatedHealingResult[] = execution.healing || [];
  const status = execution.totals.failed > 0 ? "FAILED" : execution.totals.blocked > 0 || execution.totals.skipped > 0 ? "PARTIAL" : "SUCCESS";
  const { healing: executionHealing, ...executionWithoutHealing } = execution;
  const defects: DefectResult[] = [];
  for (const failure of execution.failures) {
    if (!selectJiraEligibleFailure(failure)) continue;
    defects.push(await createDefect({ projectKey: process.env.JIRA_PROJECT_KEY || "LOCAL", sourceIssueKey: failure.path, summary: "Verified application assertion failure", requirement: executable.map((item) => item.sourceRequirements.join("; ")).join("; "), expected: "Requirement expected result", actual: failure.stderr || failure.stdout, environment: options.environment || execution.environment, browser: options.browser, url: exploration.result.target.url, runId, evidence: JSON.stringify(execution.evidence) }));
  }
  const result: ApprovedRunResult = { runId, storeId: store.storeId, status, approval: { readyCaseIds, excludedCaseIds: store.testCases.filter((item) => !readyCaseIds.includes(item.testCaseId)).map((item) => item.testCaseId), blockedCases }, exploration: { status: exploration.result.explorationStatus, source: exploration.source, path: exploration.path }, automation, execution: executionWithoutHealing, healing: executionHealing || healing, defects };
  fs.mkdirSync(reportRoot, { recursive: true });
  const resultPath = path.join(reportRoot, "approved-run-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  result.resultPath = resultPath;
  return result;
}
