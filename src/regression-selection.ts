import fs from "fs";
import path from "path";

/**
 * Regression selection.
 *
 * A regression suite is NOT a filesystem scan. A spec qualifies only when all
 * three hold:
 *
 *   1. it was previously approved and is READY_FOR_AUTOMATION in an approval
 *      store on disk (test-cases/*.json);
 *   2. its last recorded per-test result was PASS, taken from a stored
 *      approved-run result;
 *   3. that result came from a REAL per-test JSON payload -- source
 *      "playwright-json". Results synthesised from the exit code
 *      ("exit-code-fallback") or from a no-tests payload
 *      ("playwright-json-no-tests") are explicitly rejected, because they carry
 *      no per-test outcome and must never become a passing baseline.
 *
 * Approval stores do not record the generated spec path, so the spec path is
 * recovered by joining testCaseId against automation.generated[] in the stored
 * run. Every candidate is written out with an explicit include or exclude
 * reason, so the selection is auditable rather than a bare list of paths.
 */
import type { TestResultSource } from "./execution-engine";

export interface SelectionCandidate {
  /** Repo-relative, forward-slash spec path. */
  specPath: string;
  included: boolean;
  reason: string;
  /** Last recorded status, when a stored result mentioned this spec. */
  lastStatus?: string;
  /** Source of that last result, e.g. "playwright-json". */
  lastSource?: TestResultSource | string;
  /** Approval store that lists this case as READY_FOR_AUTOMATION. */
  approvedIn?: string;
  testCaseId?: string;
  approvalStatus?: string;
}

export interface RegressionSelection {
  runId: string;
  selectionPath: string;
  included: string[];
  candidates: SelectionCandidate[];
  warnings: string[];
}

interface StoredTest { path?: string; title?: string; status?: string; source?: string }
interface StoredGenerated { path?: string; kind?: string; testCaseId?: string }
interface StoredRun {
  runId?: string;
  timestamp?: string;
  storeId?: string;
  automation?: { generated?: StoredGenerated[] };
  execution?: { tests?: StoredTest[] };
}

const REPO_RELATIVE_SPEC = /(?:^|[\\/])tests[\\/](generated|api)[\\/].+\.spec\.ts$/;

/**
 * Normalises a spec path to a repo-relative posix path.
 *
 * Paths reach us in three shapes: absolute (automation.generated[].path),
 * repo-relative (the discovery scan), and relative to Playwright's testDir
 * (execution.tests[].path, e.g. "generated/Demo/TC-1.spec.ts"). The last shape
 * is the trap: without prefixing "tests/" it would never match a discovered
 * candidate and every spec would look unrecorded.
 */
export function toRepoRelativeSpec(value: string, root: string): string {
  const normalised = value.replace(/\\/g, "/");
  const isAbsolute = path.isAbsolute(value) || /^[A-Za-z]:\//.test(normalised);
  if (isAbsolute) {
    const marker = "/tests/";
    const index = normalised.lastIndexOf(marker);
    return index >= 0 ? normalised.slice(index + 1) : normalised;
  }
  const relative = normalised.replace(/^\.\//, "");
  return relative.startsWith("tests/") ? relative : `tests/${relative}`;
}

/** Reads every stored approved-run result under reports/<runId>/. */
export function readStoredRuns(reportsRoot: string): StoredRun[] {
  if (!fs.existsSync(reportsRoot)) return [];
  const runs: StoredRun[] = [];
  for (const entry of fs.readdirSync(reportsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(reportsRoot, entry.name, "approved-run-result.json");
    if (!fs.existsSync(file)) continue;
    try { runs.push(JSON.parse(fs.readFileSync(file, "utf8")) as StoredRun); } catch { /* skip corrupt artifact */ }
  }
  return runs;
}

/**
 * Last known per-spec outcome, keyed by repo-relative spec path.
 *
 * Only source "playwright-json" entries are considered, so a fallback-derived or
 * no-tests result can never establish (or overwrite) a baseline. Later runs win.
 */
export function buildLastKnownResults(runs: StoredRun[], root: string): Map<string, { status: string; source: string; runId: string }> {
  const latest = new Map<string, { status: string; source: string; runId: string }>();
  const ordered = [...runs].sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  for (const run of ordered) {
    for (const test of run.execution?.tests || []) {
      if (!test?.path) continue;
      if (String(test.source || "") !== "playwright-json") continue;
      latest.set(toRepoRelativeSpec(test.path, root), { status: String(test.status || ""), source: "playwright-json", runId: String(run.runId || "") });
    }
  }
  return latest;
}

/**
 * Spec paths for READY_FOR_AUTOMATION cases, joined through the stored run's
 * automation.generated[] (testCaseId -> spec path).
 */
export function buildApprovedSpecIndex(input: { runs: StoredRun[]; testCasesRoot: string; root: string }): Map<string, { storeId: string; testCaseId: string; status: string }> {
  const specByCaseId = new Map<string, string>();
  for (const run of input.runs) {
    for (const generated of run.automation?.generated || []) {
      if (generated?.kind !== "spec" || !generated.path || !generated.testCaseId) continue;
      specByCaseId.set(generated.testCaseId, toRepoRelativeSpec(generated.path, input.root));
    }
  }
  const approved = new Map<string, { storeId: string; testCaseId: string; status: string }>();
  if (!fs.existsSync(input.testCasesRoot)) return approved;
  for (const entry of fs.readdirSync(input.testCasesRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    let store: { storeId?: string; testCases?: Array<{ testCaseId?: string; status?: string }> };
    try { store = JSON.parse(fs.readFileSync(path.join(input.testCasesRoot, entry.name), "utf8")) as typeof store; } catch { continue; }
    for (const testCase of store.testCases || []) {
      if (testCase?.status !== "READY_FOR_AUTOMATION" || !testCase.testCaseId) continue;
      const specPath = specByCaseId.get(testCase.testCaseId);
      if (!specPath) continue;
      approved.set(specPath, { storeId: String(store.storeId || entry.name.replace(/\.json$/, "")), testCaseId: testCase.testCaseId, status: testCase.status });
    }
  }
  return approved;
}

/**
 * Selects regression specs from a candidate pool, recording a reason for each.
 *
 * Candidates outside tests/generated and tests/api are rejected outright: the
 * repository's own unit and integration suites are not application regression
 * targets.
 */
export function selectRegressionSpecs(input: { specPaths: string[]; root: string; lastKnown: Map<string, { status: string; source: string; runId: string }>; approved: Map<string, { storeId: string; testCaseId: string; status: string }> }): { included: string[]; candidates: SelectionCandidate[] } {
  const candidates: SelectionCandidate[] = [];
  const included: string[] = [];
  for (const raw of input.specPaths) {
    const specPath = toRepoRelativeSpec(raw, input.root);
    const approval = input.approved.get(specPath);
    const last = input.lastKnown.get(specPath);
    let reason: string;
    if (!REPO_RELATIVE_SPEC.test(specPath)) {
      reason = "excluded: not an application regression target (must live under tests/generated or tests/api)";
    } else if (!approval) {
      reason = "excluded: no approval store lists this spec as READY_FOR_AUTOMATION";
    } else if (!last) {
      reason = "excluded: no stored per-test result with source playwright-json, so there is no verified PASS baseline";
    } else if (last.source !== "playwright-json") {
      reason = `excluded: last recorded result came from source "${last.source}", which is not a real per-test result`;
    } else if (last.status !== "PASS") {
      reason = `excluded: last recorded per-test status was ${last.status}, not PASS`;
    } else {
      reason = `included: READY_FOR_AUTOMATION in ${approval.storeId} and last per-test result was PASS (run ${last.runId})`;
    }
    const candidate: SelectionCandidate = { specPath, included: reason.startsWith("included:"), reason, lastStatus: last?.status, lastSource: last?.source, approvedIn: approval?.storeId, testCaseId: approval?.testCaseId, approvalStatus: approval?.status };
    candidates.push(candidate);
    if (candidate.included) included.push(specPath);
  }
  return { included: [...new Set(included)].sort(), candidates };
}

/** Persists the selection document so the choice is auditable after the fact. */
export function saveRegressionSelection(selection: RegressionSelection): string {
  fs.mkdirSync(path.dirname(selection.selectionPath), { recursive: true });
  fs.writeFileSync(selection.selectionPath, JSON.stringify(selection, null, 2), "utf8");
  return selection.selectionPath;
}
