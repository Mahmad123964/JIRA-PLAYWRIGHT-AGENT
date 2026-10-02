import crypto from "crypto";
import { sanitizeSecrets } from "./document-ingestion";

export interface DefectInput {
  projectKey: string;
  sourceIssueKey: string;
  summary: string;
  requirement: string;
  expected: string;
  actual: string;
  environment: string;
  browser?: string;
  url?: string;
  runId: string;
  evidence?: string;
  provenance?: unknown;
}
interface JiraSearchIssue {
  key: string;
  fields?: { summary?: string };
}

export interface JiraDefectClient {
  search(jql: string): Promise<JiraSearchIssue[]>;
  createIssue(payload: unknown): Promise<{ key: string }>;
  getIssue(issueKey: string): Promise<{ key: string; fields?: unknown }>;
  linkIssues(sourceKey: string, targetKey: string): Promise<void>;
  addComment(issueKey: string, body: string): Promise<void>;
}
export type JiraDefectStatus = "WOULD_CREATE" | "WOULD_LINK_EXISTING" | "CREATED" | "DUPLICATE" | "UNCONFIRMED" | "EXCLUDED" | "UNAVAILABLE";
export interface DefectResult { fingerprint: string; status: JiraDefectStatus; bugKey?: string; reason?: string; dryRun: boolean; payload?: unknown; }

export function defectFingerprint(input: DefectInput): string {
  return crypto.createHash("sha256").update([input.projectKey, input.sourceIssueKey, input.summary, input.requirement, input.actual, input.environment].join("|"), "utf8").digest("hex");
}

export interface JiraSinkOptions { dryRun?: boolean; createReal?: boolean; }

export function selectJiraEligibleFailure(failure: { diagnosis?: { category?: string } }): boolean {
  return failure.diagnosis?.category === "A. REAL APPLICATION DEFECT";
}

export async function createDefect(input: DefectInput, client?: JiraDefectClient, options: JiraSinkOptions = {}): Promise<DefectResult> {
  const fingerprint = defectFingerprint(input);
  const dryRun = options.createReal !== true;
  if (!client) {
    if (dryRun) return { fingerprint, status: "WOULD_CREATE", reason: "Jira is not configured; dry-run payload generated without network mutation", dryRun };
    return { fingerprint, status: "UNAVAILABLE", reason: "Jira is not configured", dryRun };
  }
  const safeSummary = sanitizeSecrets(input.summary).sanitized;
  const existing = await client.search(`project = "${input.projectKey.replace(/"/g, '\\"')}" AND text ~ "${fingerprint}" AND statusCategory != Done`);
  if (existing.length) {
    if (dryRun) return { fingerprint, status: "WOULD_LINK_EXISTING", bugKey: existing[0].key, reason: "Existing open issue found; no duplicate would be created", dryRun };
    await client.linkIssues(input.sourceIssueKey, existing[0].key);
    await client.addComment(existing[0].key, `Automation duplicate detected for fingerprint ${fingerprint}. Source issue: ${input.sourceIssueKey}`);
    return { fingerprint, status: "DUPLICATE", bugKey: existing[0].key, dryRun };
  }
  const description = [`BUG REPORT`, `Fingerprint: ${fingerprint}`, `Originating Jira Ticket: ${input.sourceIssueKey}`, `Test Case ID: ${input.sourceIssueKey}`, `Steps to reproduce: execute the originating test scenario`, `Requirement: ${sanitizeSecrets(input.requirement).sanitized}`, `Expected: ${sanitizeSecrets(input.expected).sanitized}`, `Actual: ${sanitizeSecrets(input.actual).sanitized}`, `Environment: ${sanitizeSecrets(input.environment).sanitized}`, `Browser: ${input.browser || "Not available / not applicable."}`, `URL: ${input.url || "Not available / not applicable."}`, `Run ID: ${input.runId}`, `Evidence: ${sanitizeSecrets(input.evidence || "Not available / not applicable.").sanitized}`, `Provenance: ${JSON.stringify(input.provenance || {})}`].join("\n");
  const payload = { fields: { project: { key: input.projectKey }, issuetype: { name: "Bug" }, summary: `[Defect] ${safeSummary}`, description } };
  if (dryRun) return { fingerprint, status: "WOULD_CREATE", reason: "Dry-run default; no Jira mutation performed", dryRun, payload };
  const created = await client.createIssue(payload);
  try {
    const verified = await client.getIssue(created.key);
    await client.linkIssues(input.sourceIssueKey, created.key);
    await client.addComment(input.sourceIssueKey, `Automation defect created: ${created.key}. Fingerprint: ${fingerprint}`);
    return { fingerprint, status: verified.key === created.key ? "CREATED" : "UNCONFIRMED", bugKey: verified.key, dryRun: false };
  } catch (error) {
    return { fingerprint, status: "UNCONFIRMED", bugKey: created.key, reason: error instanceof Error ? error.message : String(error), dryRun: false };
  }
}
