import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { EvidenceManager } from "./evidence-engine";
import { classifyFailure, type FailureDiagnosis } from "./failure-classifier";
import { sanitizeSecrets } from "./document-ingestion";
import type { ValidatedHealingResult } from "./validated-healing";

export interface ExecutionOptions { runId: string; cwd?: string; browser?: string; project?: string; environment?: string; timeoutMs?: number; outputRoot?: string; storageState?: string; captureArtifacts?: boolean; healingFile?: string; configPath?: string; }
export type ExecutionTestStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";
/**
 * Where a reported per-test result actually came from. `playwright-json` is a
 * real per-test result read out of Playwright's JSON reporter. The other two
 * are synthetic and must never be mistaken for one:
 *  - `playwright-json-no-tests`: JSON parsed fine but Playwright ran no tests
 *    (e.g. "No tests found"). Carries Playwright's own top-level error.
 *  - `exit-code-fallback`: the JSON could not be parsed at all, so only the
 *    process exit code is known.
 */
export type TestResultSource = "playwright-json" | "playwright-json-no-tests" | "exit-code-fallback";
export interface ExecutionTestResult { path: string; title?: string; status: ExecutionTestStatus; durationMs: number; error?: string; source: TestResultSource; stdout: string; stderr: string; diagnosis?: FailureDiagnosis; }
export interface ExecutionResult { runId: string; timestamp: string; environment: string; module?: string; command: string; exitCode: number | null; tests: ExecutionTestResult[]; totals: { total: number; passed: number; failed: number; blocked: number; skipped: number }; evidence: ReturnType<EvidenceManager["finalize"]>; failures: ExecutionTestResult[]; healing?: ValidatedHealingResult[]; }

function classifyProcessFailure(stdout: string, stderr: string): FailureDiagnosis {
  return classifyFailure({ message: `${stdout}\n${stderr}`, browserUnavailable: /executable doesn't exist|browser.*not installed/i.test(`${stdout} ${stderr}`), timedOut: /timeout|timed out/i.test(`${stdout} ${stderr}`) });
}

interface JsonReporterError { message?: string; stack?: string; location?: { file?: string; line?: number; column?: number } }
interface JsonReporterAttempt { status?: string; duration?: number; errors?: JsonReporterError[] }
interface JsonReporterTest { status?: string; expectedStatus?: string; results?: JsonReporterAttempt[] }
interface JsonReporterSpec { title?: string; file?: string; tests?: JsonReporterTest[] }
interface JsonReporterSuite { title?: string; file?: string; specs?: JsonReporterSpec[]; suites?: JsonReporterSuite[] }
interface JsonReporterOutput { suites?: JsonReporterSuite[]; errors?: JsonReporterError[]; stats?: { duration?: number } }

export interface ParsedPlaywrightTest { title: string; path: string; status: ExecutionTestStatus; durationMs: number; error?: string; reporterStatus?: string }
export interface PlaywrightJsonParse { ok: boolean; reason?: string; tests: ParsedPlaywrightTest[]; topLevelErrors: string[]; totalDurationMs: number }

/**
 * Playwright 1.62 JSON reporter shape, verified against a real 1.62.1 run:
 *
 * - SUITES NEST ARBITRARILY DEEP. A spec that calls `test.describe()` puts its
 *   specs in `suites[].suites[].specs[]`, and the outermost suite carries
 *   `specs: []`. A flat spec puts them straight in `suites[].specs[]`. So the
 *   walk must recurse, and must read `specs` at every level.
 * - `test.status` IS NOT THE OUTCOME. It is the expectation resolution:
 *   "expected" | "unexpected" | "flaky" | "skipped". A passing test reports
 *   "expected" -- mapping that to a result status (as the previous parser did)
 *   reports every green test as a failure.
 * - THE OUTCOME IS `test.results[last].status`: "passed" | "failed" |
 *   "skipped" | "timedOut" | "interrupted".
 * - DURATION MOVED. `test.duration` no longer exists; it is
 *   `test.results[last].duration`.
 * - ERRORS MOVED. `test.error` no longer exists; failures carry
 *   `test.results[last].errors[]` as `{ message, location: { file, line, column } }`.
 * - `expectedStatus` matters for `test.fail()` tests: an actual failure is the
 *   expected outcome and therefore a PASS, and vice versa.
 *
 * STATUS MAPPING for the non-outcome attempt statuses. `timedOut` and
 * `interrupted` used to be reported as BLOCKED. That was wrong: in this codebase
 * BLOCKED means "no verdict is possible because the target, requirement or
 * credentials were unavailable" (it is what category E maps to, and it drives
 * run status PARTIAL). Neither a timeout nor an interruption means that -- in
 * both cases the test DID execute against a reachable target and did not pass.
 *
 *  - timedOut     -> FAIL. Execution reached the application and did not
 *                    complete within the limit. It is a failure, and it carries
 *                    no evidence of a missing requirement. The classifier reads
 *                    `reporterStatus: "timedOut"` and assigns D (flaky /
 *                    transient, retryAllowed), so the documented 1-2 controlled
 *                    retries apply. An identical repeat stays D and is never
 *                    auto-filed, because only A is bug-eligible.
 *  - interrupted  -> FAIL. The run was cut short (SIGINT, maxFailures, worker
 *                    crash), so this is an infrastructure condition. The
 *                    classifier assigns C for it via the same `reporterStatus`
 *                    channel, which is retryable and not bug-eligible.
 *
 * BLOCKED is now reserved for genuine no-verdict outcomes: valid JSON with zero
 * tests executed, and runner categories E/C.
 */
export function classifyReporterOutcome(actualStatus: string, expectedStatus: string): ExecutionTestStatus {
  const actual = (actualStatus || "").toLowerCase();
  const expected = (expectedStatus || "passed").toLowerCase();
  if (actual === "skipped" || actual === "pending" || actual === "ignored") return "SKIPPED";
  if (actual === "interrupted") return "FAIL";
  if (actual === "timedout") return "FAIL";
  if (actual === "failed") return expected === "failed" ? "PASS" : "FAIL";
  if (actual === "passed") return expected === "failed" ? "FAIL" : "PASS";
  // Unknown/absent attempt status: never claim a pass.
  return "FAIL";
}

function formatReporterError(error: JsonReporterError): string {
  const message = (error.message || "Unknown error").trim();
  const location = error.location;
  if (location?.file) return `${message} (at ${location.file}:${location.line ?? 0}:${location.column ?? 0})`;
  return message;
}

/**
 * Extracts real per-test results from Playwright's JSON reporter output.
 * Returns `ok: false` only when stdout genuinely is not parseable JSON, which
 * is the one case that may legitimately fall back to the exit code.
 */
export function parsePlaywrightJson(stdout: string): PlaywrightJsonParse {
  const blank: PlaywrightJsonParse = { ok: false, reason: "runner produced no stdout", tests: [], topLevelErrors: [], totalDurationMs: 0 };
  if (!stdout || !stdout.trim()) return blank;
  let parsed: JsonReporterOutput;
  try { parsed = JSON.parse(stdout) as JsonReporterOutput; }
  catch (error) { return { ...blank, reason: `runner stdout is not valid JSON: ${(error as Error).message}` }; }

  const tests: ParsedPlaywrightTest[] = [];
  const walk = (suites: JsonReporterSuite[] | undefined, inheritedFile?: string): void => {
    for (const suite of suites || []) {
      if (!suite || typeof suite !== "object") continue;
      const suiteFile = suite.file || inheritedFile;
      for (const spec of suite.specs || []) {
        if (!spec || typeof spec !== "object") continue;
        for (const test of spec.tests || []) {
          if (!test || typeof test !== "object") continue;
          const attempts = Array.isArray(test.results) ? test.results : [];
          const attempt = attempts.length ? attempts[attempts.length - 1] : undefined;
          const messages = (attempt?.errors || []).map(formatReporterError);
          const status = attempt
            ? classifyReporterOutcome(attempt.status || "", test.expectedStatus || "passed")
            : ((test.status || "").toLowerCase() === "skipped" ? "SKIPPED" : "BLOCKED");
          tests.push({
            title: spec.title || "(untitled spec)",
            path: spec.file || suiteFile || "unknown",
            status,
            durationMs: typeof attempt?.duration === "number" ? attempt.duration : 0,
            error: messages.length ? messages.join("\n") : undefined,
            reporterStatus: attempt?.status,
          });
        }
      }
      walk(suite.suites, suiteFile);
    }
  };
  walk(parsed.suites);

  return {
    ok: true,
    tests,
    topLevelErrors: (parsed.errors || []).map(formatReporterError),
    totalDurationMs: typeof parsed.stats?.duration === "number" ? Math.round(parsed.stats.duration) : 0,
  };
}

/**
 * Playwright `test` command flags this runner is permitted to pass.
 * Anything outside this set is a tooling defect in this repository, not an
 * application failure. Verified against the `testOptions` table in
 * playwright/lib/program.js -- notably there is NO --video and NO
 * --screenshot CLI option; those exist only as `use` options in the config.
 */
export const ALLOWED_TEST_CLI_FLAGS = new Set([
  "--project", "--browser", "--config", "--trace", "--reporter",
  "--retries", "--workers", "--timeout", "--output", "--grep", "--max-failures",
]);

/**
 * Absolute path to this repository's playwright.config.ts, resolved from the
 * module's own location rather than the runtime working directory.
 *
 * Playwright only auto-discovers a config by walking up from its process cwd.
 * Because `executePlaywright` runs the runner as a child process whose cwd may
 * be set explicitly, relying on auto-discovery would silently drop
 * `use.video` / `use.screenshot` and any other `use` setting. Resolving from the
 * repo root makes the config independent of `options.cwd`.
 */
export function resolveRepoConfigPath(): string {
  return path.resolve(__dirname, "..", "playwright.config.ts");
}

export function buildPlaywrightArgs(testPaths: string[], options: ExecutionOptions, cwd: string): string[] {
  const runnerPaths = testPaths.map((testPath) => path.relative(cwd, path.resolve(testPath)).replace(/\\/g, "/"));
  const args = ["test", ...runnerPaths];
  if (options.project) args.push("--project", options.project);
  if (options.browser) args.push("--browser", options.browser);
  // Always point the runner at this repository's config, independent of
  // storageState and of the child process cwd, so the `use` options it carries
  // (video, screenshot) always apply. Gated on the file existing rather than on
  // any unrelated option.
  const configPath = options.configPath || resolveRepoConfigPath();
  if (fs.existsSync(configPath)) args.push("--config", configPath);
  // --trace is the only artifact-capture option the Playwright CLI accepts.
  if (options.captureArtifacts !== false) args.push("--trace", "retain-on-failure");
  args.push("--reporter", "json");
  return args;
}

/**
 * Turns a parsed reporter payload into the reported per-test results.
 *
 * Three outcomes, each explicitly labelled so a synthetic result can never be
 * mistaken for a real per-test one:
 *  - real per-test results straight from `test.results[]`
 *  - `playwright-json-no-tests` when the JSON was valid but Playwright ran
 *    nothing, carrying Playwright's own top-level error
 *  - `exit-code-fallback` only when stdout was not parseable JSON at all
 *
 * `diagnose` is invoked with the real per-test error text and the reporter's own
 * attempt status, so classification reflects THIS test rather than the whole
 * runner payload. It is omitted for non-failing tests, and `runDiagnosis` (a
 * whole-run classification) is used whenever a per-test signal is unavailable.
 */
export function buildExecutionTests(input: { parsedJson: PlaywrightJsonParse; testPaths: string[]; wallClockMs: number; exitCodeStatus: ExecutionTestStatus; runDiagnosis?: FailureDiagnosis; diagnose?: (error: string | undefined, reporterStatus: string | undefined) => FailureDiagnosis; stdout: string; stderr: string }): ExecutionTestResult[] {
  const { parsedJson, testPaths, wallClockMs, exitCodeStatus, runDiagnosis, diagnose, stdout, stderr } = input;
  const runnerOutput = { stdout, stderr };
  if (!parsedJson.ok) {
    return [{ path: testPaths.join(","), title: "(runner output could not be parsed)", status: exitCodeStatus, durationMs: wallClockMs, error: `Playwright JSON reporter output could not be parsed, so this is an exit-code fallback rather than a per-test result: ${parsedJson.reason}`, source: "exit-code-fallback", diagnosis: runDiagnosis, ...runnerOutput }];
  }
  if (!parsedJson.tests.length) {
    return [{ path: testPaths.join(","), title: "(no tests executed)", status: parsedJson.topLevelErrors.length ? exitCodeStatus : "SKIPPED", durationMs: parsedJson.totalDurationMs, error: parsedJson.topLevelErrors.length ? parsedJson.topLevelErrors.join("\n") : "Playwright reported no tests and no errors.", source: "playwright-json-no-tests", diagnosis: runDiagnosis, ...runnerOutput }];
  }
  return parsedJson.tests.map((item) => {
    const failed = item.status === "FAIL" || item.status === "BLOCKED";
    const perTest = failed && diagnose ? diagnose(item.error, item.reporterStatus) : undefined;
    return { path: item.path, title: item.title, status: item.status, durationMs: item.durationMs, error: item.error, source: "playwright-json", diagnosis: failed ? perTest || runDiagnosis : undefined, ...runnerOutput };
  });
}

export async function executePlaywright(testPaths: string[], options: ExecutionOptions): Promise<ExecutionResult> {
  const cwd = options.cwd || process.cwd(); const outputRoot = options.outputRoot || path.resolve("test-results", options.runId); const evidence = new EvidenceManager(options.runId, outputRoot);
  const cliPath = require.resolve("@playwright/test/cli");
  const args = [cliPath, ...buildPlaywrightArgs(testPaths, options, cwd)];
  const command = `${process.execPath} ${args.join(" ")}`; const started = Date.now();
  const childEnv = { ...process.env, ...(options.healingFile ? { QA_HEALING_FILE: path.resolve(options.healingFile) } : {}) };
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => { const child = spawn(process.execPath, args, { cwd, shell: false, env: childEnv }); let stdout = ""; let stderr = ""; child.stdout.on("data", (d) => { stdout += d.toString(); }); child.stderr.on("data", (d) => { stderr += d.toString(); }); child.on("close", (code) => resolve({ code, stdout, stderr })); child.on("error", (error) => resolve({ code: null, stdout, stderr: `${stderr}${error.message}` })); });
  const diagnosis = result.code === 0 ? undefined : classifyProcessFailure(result.stdout, result.stderr);
  const exitCodeStatus: ExecutionTestStatus = result.code === 0 ? "PASS" : diagnosis?.category.startsWith("E.") || diagnosis?.category.startsWith("C.") ? "BLOCKED" : "FAIL";
  const tests = buildExecutionTests({
    parsedJson: parsePlaywrightJson(result.stdout),
    testPaths,
    wallClockMs: Date.now() - started,
    exitCodeStatus,
    runDiagnosis: diagnosis,
    // Classify from THIS test's real error text and the reporter's own attempt
    // status, falling back to the whole-run payload only when the test reported
    // no error of its own.
    diagnose: (error, reporterStatus) => classifyFailure({
      message: error || result.stdout,
      stack: error ? undefined : result.stderr,
      reporterStatus,
      browserUnavailable: /executable doesn't exist|browser.*not installed/i.test(`${result.stdout} ${result.stderr}`),
      timedOut: reporterStatus === "timedOut",
    }),
    stdout: result.stdout,
    stderr: result.stderr,
  });
  const statusCounts = tests.reduce((counts, item) => { counts[item.status.toLowerCase() as "pass" | "fail" | "blocked" | "skipped"]++; return counts; }, { pass: 0, fail: 0, blocked: 0, skipped: 0 });
  evidence.addText("runner-log", "runner.log", `${result.stdout}\n${result.stderr}`);
  const artifactRoot = path.resolve(cwd, "test-results");
  if (fs.existsSync(artifactRoot)) {
    const collect = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) collect(filePath);
        else if (/\.(png|zip|webm|html|json)$/i.test(entry.name)) evidence.addFile(path.extname(entry.name).slice(1), filePath);
      }
    };
    collect(artifactRoot);
  }
  const finalized = evidence.finalize();
  let healing: ValidatedHealingResult[] | undefined;
  if (options.healingFile && fs.existsSync(path.resolve(options.healingFile))) {
    const healingPath = path.resolve(options.healingFile);
    const lines = fs.readFileSync(healingPath, "utf8").split(/\r?\n/).filter(Boolean);
    healing = lines.flatMap((line) => { try { return [JSON.parse(sanitizeSecrets(line).sanitized) as ValidatedHealingResult]; } catch { return []; } });
    evidence.addFile("healing", healingPath);
  }
  return { runId: options.runId, timestamp: new Date().toISOString(), environment: options.environment || "unknown", command, exitCode: result.code, tests, totals: { total: tests.length, passed: statusCounts.pass, failed: statusCounts.fail, blocked: statusCounts.blocked, skipped: statusCounts.skipped }, evidence: finalized, failures: tests.filter((item) => item.status === "FAIL" || item.status === "BLOCKED"), healing };
}
