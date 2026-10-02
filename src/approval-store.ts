import fs from "fs";
import path from "path";
import { sanitizeSecrets } from "./document-ingestion";
import type { TestCase, TestCaseStatus } from "./test-case-generator";
import type { ExplorationResult } from "./browser-explorer";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ApprovalDecision {
  testCaseId: string;
  decision: "APPROVED" | "REJECTED" | "EDITED";
  reviewer: string;
  timestamp: string;
  comment?: string;
  previousVersion?: TestCase;
  updatedVersion?: Partial<TestCase>;
}

export interface ApprovalRecord {
  testCaseId: string;
  status: TestCaseStatus;
  reviewer: string;
  approvedAt?: string;
  rejectedAt?: string;
  editedAt?: string;
  comment?: string;
  previousVersion?: TestCase;
  updatedVersion?: Partial<TestCase>;
}

export interface ApprovalStore {
  storeId: string;
  createdAt: string;
  updatedAt: string;
  module: string;
  scope: string;
  explorationResult?: ExplorationResult;
  explorationResultPath?: string;
  approvalRecords: ApprovalRecord[];
  testCases: TestCase[];
}

export interface ApprovalSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  edited: number;
  readyForAutomation: number;
}

// ----------------------------------------------------------------------------
// Store management
// ----------------------------------------------------------------------------

const STORE_DIR = path.resolve(process.cwd(), "test-cases");

function ensureStoreDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  }
}

function storeFilePath(storeId: string): string {
  return path.join(STORE_DIR, `${storeId}.json`);
}

export function createApprovalStore(
  module: string,
  scope: string,
  testCases: TestCase[],
  explorationResult?: ExplorationResult,
  explorationResultPath?: string
): ApprovalStore {
  const storeId = `approval-${module.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;
  const store: ApprovalStore = {
    storeId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    module,
    scope,
    explorationResult,
    explorationResultPath,
    testCases: testCases.map((tc) => ({ ...tc, status: "PENDING_APPROVAL" })),
    approvalRecords: [],
  };
  return store;
}

export function saveApprovalStore(store: ApprovalStore): string {
  ensureStoreDir();
  const filePath = storeFilePath(store.storeId);
  store.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf-8");
  return filePath;
}

export function loadApprovalStore(storeId: string): ApprovalStore | null {
  const filePath = storeFilePath(storeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ApprovalStore;
  } catch {
    return null;
  }
}

export function listApprovalStores(): string[] {
  ensureStoreDir();
  return fs
    .readdirSync(STORE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

// ----------------------------------------------------------------------------
// Approval operations
// ----------------------------------------------------------------------------

export function approveTestCase(
  store: ApprovalStore,
  testCaseId: string,
  reviewer: string,
  comment?: string
): { success: boolean; error?: string } {
  const tc = store.testCases.find((t) => t.testCaseId === testCaseId);
  if (!tc) return { success: false, error: `Test case not found: ${testCaseId}` };

  if (tc.status === "REJECTED") {
    return { success: false, error: `Cannot approve a rejected test case: ${testCaseId}` };
  }

  tc.status = "APPROVED";
  const sanitizedComment = comment ? sanitizeSecrets(comment).sanitized : comment;

  const record: ApprovalRecord = {
    testCaseId,
    status: "APPROVED",
    reviewer: sanitizeSecrets(reviewer).sanitized,
    approvedAt: new Date().toISOString(),
    comment: sanitizedComment,
  };

  removeExistingRecord(store, testCaseId);
  store.approvalRecords.push(record);
  return { success: true };
}

export function rejectTestCase(
  store: ApprovalStore,
  testCaseId: string,
  reviewer: string,
  comment?: string
): { success: boolean; error?: string } {
  const tc = store.testCases.find((t) => t.testCaseId === testCaseId);
  if (!tc) return { success: false, error: `Test case not found: ${testCaseId}` };

  tc.status = "REJECTED";

  const record: ApprovalRecord = {
    testCaseId,
    status: "REJECTED",
    reviewer: sanitizeSecrets(reviewer).sanitized,
    rejectedAt: new Date().toISOString(),
    comment: comment ? sanitizeSecrets(comment).sanitized : comment,
  };

  removeExistingRecord(store, testCaseId);
  store.approvalRecords.push(record);
  return { success: true };
}

export function editTestCase(
  store: ApprovalStore,
  testCaseId: string,
  reviewer: string,
  updates: Partial<TestCase>,
  comment?: string
): { success: boolean; error?: string } {
  const tc = store.testCases.find((t) => t.testCaseId === testCaseId);
  if (!tc) return { success: false, error: `Test case not found: ${testCaseId}` };

  if (tc.status === "REJECTED") {
    return { success: false, error: `Cannot edit a rejected test case: ${testCaseId}` };
  }

  // Never allow status to be set to READY_FOR_AUTOMATION directly via edit
  const safeUpdates = { ...updates };
  delete safeUpdates.status;
  delete safeUpdates.testCaseId;

  const previousVersion = { ...tc };
  const sanitizedUpdates = sanitizeTestCaseUpdates(safeUpdates);
  Object.assign(tc, sanitizedUpdates);
  // Editing invalidates the previous approval and returns the case to the human gate.
  tc.status = "PENDING_APPROVAL";

  const record: ApprovalRecord = {
    testCaseId,
    status: "EDITED",
    reviewer: sanitizeSecrets(reviewer).sanitized,
    editedAt: new Date().toISOString(),
    comment: comment ? sanitizeSecrets(comment).sanitized : comment,
    previousVersion,
    updatedVersion: sanitizedUpdates,
  };

  removeExistingRecord(store, testCaseId);
  store.approvalRecords.push(record);
  return { success: true };
}

export function markReadyForAutomation(
  store: ApprovalStore,
  testCaseId: string
): { success: boolean; error?: string } {
  const tc = store.testCases.find((t) => t.testCaseId === testCaseId);
  if (!tc) return { success: false, error: `Test case not found: ${testCaseId}` };

  if (tc.status !== "APPROVED") {
    return {
      success: false,
      error: `Only APPROVED test cases can become READY_FOR_AUTOMATION. Current status: ${tc.status}`,
    };
  }

  tc.status = "READY_FOR_AUTOMATION";
  return { success: true };
}

export function approveSelected(
  store: ApprovalStore,
  testCaseIds: string[],
  reviewer: string,
  comment?: string
): { approved: string[]; failed: Array<{ id: string; error: string }> } {
  const approved: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of testCaseIds) {
    const result = approveTestCase(store, id, reviewer, comment);
    if (result.success) {
      approved.push(id);
    } else {
      failed.push({ id, error: result.error! });
    }
  }

  return { approved, failed };
}

export function rejectSelected(
  store: ApprovalStore,
  testCaseIds: string[],
  reviewer: string,
  comment?: string
): { rejected: string[]; failed: Array<{ id: string; error: string }> } {
  const rejected: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of testCaseIds) {
    const result = rejectTestCase(store, id, reviewer, comment);
    if (result.success) {
      rejected.push(id);
    } else {
      failed.push({ id, error: result.error! });
    }
  }

  return { rejected, failed };
}

// ----------------------------------------------------------------------------
// Query helpers
// ----------------------------------------------------------------------------

export function getApprovalSummary(store: ApprovalStore): ApprovalSummary {
  const counts = { total: 0, pending: 0, approved: 0, rejected: 0, edited: 0, readyForAutomation: 0 };
  for (const tc of store.testCases) {
    counts.total++;
    if (tc.status === "PENDING_APPROVAL") counts.pending++;
    else if (tc.status === "APPROVED") counts.approved++;
    else if (tc.status === "REJECTED") counts.rejected++;
    else if (tc.status === "EDITED") counts.edited++;
    else if (tc.status === "READY_FOR_AUTOMATION") counts.readyForAutomation++;
  }
  return counts;
}

export function getReadyForAutomation(store: ApprovalStore): TestCase[] {
  return store.testCases.filter((tc) => tc.status === "READY_FOR_AUTOMATION");
}

export function getPendingApproval(store: ApprovalStore): TestCase[] {
  return store.testCases.filter((tc) => tc.status === "PENDING_APPROVAL");
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

function sanitizeTestCaseUpdates(updates: Partial<TestCase>): Partial<TestCase> {
  const sanitized: Partial<TestCase> = { ...updates };
  for (const key of Object.keys(sanitized) as Array<keyof TestCase>) {
    const value = sanitized[key];
    if (typeof value === "string") {
      (sanitized[key] as unknown as string) = sanitizeSecrets(value).sanitized;
    }
  }
  return sanitized;
}

function removeExistingRecord(store: ApprovalStore, testCaseId: string): void {
  store.approvalRecords = store.approvalRecords.filter((r) => r.testCaseId !== testCaseId);
}
