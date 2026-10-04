import fs from "fs";
import path from "path";

/**
 * Smoke suite configuration.
 *
 * A smoke list is NEVER inferred. Business flows must be declared explicitly in
 * qa.config.json, because inventing a flow and reporting it as a smoke pass would
 * be fabricated evidence (AGENTS.md Section 6 / Section 26.1).
 *
 * When the config file is absent, unreadable, or lists no tests, the suite is
 * reported as SKIPPED_NOT_CONFIGURED. That is deliberately distinct from PASS:
 * an unconfigured smoke run must never be mistaken for a passing one.
 */
export const SMOKE_CONFIG_FILENAME = "qa.config.json";

/** Suite-level outcome. Note this is NOT the run-level FinalStatus. */
export type SuiteOutcome = "SUCCESS" | "PARTIAL" | "FAILED" | "BLOCKED" | "SKIPPED_NOT_CONFIGURED";

export interface SmokeConfig {
  /** Absolute path to the config file that was read, if any. */
  configPath: string;
  /** True only when a config file was read AND it declared at least one test. */
  configured: boolean;
  /** Repo-relative, forward-slash paths that exist on disk. */
  paths: string[];
  /** Declared paths that do not exist on disk. */
  missing: string[];
  /** Why the suite is not configured. Present only when configured is false. */
  reason?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Reads qa.config.json and returns the declared smoke selection.
 *
 * Never throws: a missing or malformed config is a legitimate "not configured"
 * outcome, not a crash.
 */
export function loadSmokeConfig(root: string = process.cwd()): SmokeConfig {
  const configPath = path.resolve(root, SMOKE_CONFIG_FILENAME);
  if (!fs.existsSync(configPath)) {
    return { configPath, configured: false, paths: [], missing: [], reason: `${SMOKE_CONFIG_FILENAME} was not found; no smoke flows were invented` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    return { configPath, configured: false, paths: [], missing: [], reason: `${SMOKE_CONFIG_FILENAME} is not valid JSON: ${(error as Error).message}` };
  }

  const declared = (parsed as { smoke?: { tests?: unknown } } | null)?.smoke?.tests;
  if (!Array.isArray(declared)) {
    return { configPath, configured: false, paths: [], missing: [], reason: `${SMOKE_CONFIG_FILENAME} has no "smoke.tests" array; no smoke flows were invented` };
  }

  const wanted = declared.filter(isNonEmptyString).map((item) => item.trim());
  if (!wanted.length) {
    return { configPath, configured: false, paths: [], missing: [], reason: `${SMOKE_CONFIG_FILENAME} declares an empty smoke.tests list; nothing to run and no flow was invented` };
  }

  const present: string[] = [];
  const missing: string[] = [];
  for (const item of wanted) {
    if (fs.existsSync(path.resolve(root, item))) present.push(path.relative(root, path.resolve(root, item)).replace(/\\/g, "/"));
    else missing.push(item);
  }

  if (!present.length) {
    return { configPath, configured: false, paths: [], missing, reason: `every smoke test declared in ${SMOKE_CONFIG_FILENAME} is missing from disk: ${missing.join(", ")}` };
  }

  return { configPath, configured: true, paths: [...new Set(present)].sort(), missing };
}

/**
 * Maps execution totals onto a suite outcome.
 *
 * BLOCKED and skipped tests are never folded into a pass: a suite with blocked or
 * skipped work is PARTIAL at best, and only a clean total of zero failures and
 * zero blocked/skipped is SUCCESS.
 */
export function suiteOutcomeFor(totals: { total?: number; passed?: number; failed?: number; blocked?: number; skipped?: number }): SuiteOutcome {
  const failed = totals.failed || 0;
  const blocked = totals.blocked || 0;
  const skipped = totals.skipped || 0;
  if (failed > 0) return "FAILED";
  if (blocked > 0 || skipped > 0) return "PARTIAL";
  if ((totals.total || 0) === 0) return "BLOCKED";
  return "SUCCESS";
}

/** True only for a genuine, fully clean pass. */
export function isSuitePass(outcome: SuiteOutcome): boolean {
  return outcome === "SUCCESS";
}
