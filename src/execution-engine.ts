import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { EvidenceManager } from "./evidence-engine";
import { classifyFailure, type FailureDiagnosis } from "./failure-classifier";
import { sanitizeSecrets } from "./document-ingestion";
import type { ValidatedHealingResult } from "./validated-healing";

export interface ExecutionOptions { runId: string; cwd?: string; browser?: string; project?: string; environment?: string; timeoutMs?: number; outputRoot?: string; storageState?: string; captureArtifacts?: boolean; healingFile?: string; }
export interface ExecutionTestResult { path: string; status: "PASS" | "FAIL" | "BLOCKED" | "SKIPPED"; durationMs: number; stdout: string; stderr: string; diagnosis?: FailureDiagnosis; }
export interface ExecutionResult { runId: string; timestamp: string; environment: string; module?: string; command: string; exitCode: number | null; tests: ExecutionTestResult[]; totals: { total: number; passed: number; failed: number; blocked: number; skipped: number }; evidence: ReturnType<EvidenceManager["finalize"]>; failures: ExecutionTestResult[]; healing?: ValidatedHealingResult[]; }

function classifyProcessFailure(stdout: string, stderr: string): FailureDiagnosis {
  return classifyFailure({ message: `${stdout}\n${stderr}`, browserUnavailable: /executable doesn't exist|browser.*not installed/i.test(`${stdout} ${stderr}`), timedOut: /timeout|timed out/i.test(`${stdout} ${stderr}`) });
}

interface JsonReporterTest { status?: string; duration?: number; error?: { message?: string }; }
interface JsonReporterSpec { file?: string; tests?: JsonReporterTest[]; }
interface JsonReporterSuite { specs?: JsonReporterSpec[]; }
interface JsonReporterOutput { suites?: JsonReporterSuite[]; }

function parseJsonReporter(stdout: string): Array<{ path: string; status: ExecutionTestResult["status"]; durationMs: number; error?: string }> {
  try {
    const parsed = JSON.parse(stdout) as JsonReporterOutput;
    const results: Array<{ path: string; status: ExecutionTestResult["status"]; durationMs: number; error?: string }> = [];
    for (const suite of parsed.suites || []) {
      for (const spec of suite.specs || []) {
        for (const test of spec.tests || []) {
          const raw = (test.status || "failed").toLowerCase();
          const status: ExecutionTestResult["status"] = raw === "passed" ? "PASS" : raw === "skipped" || raw === "pending" ? "SKIPPED" : raw === "timedout" ? "BLOCKED" : "FAIL";
          results.push({ path: spec.file || "unknown", status, durationMs: test.duration || 0, error: test.error?.message });
        }
      }
    }
    return results;
  } catch { return []; }
}

export async function executePlaywright(testPaths: string[], options: ExecutionOptions): Promise<ExecutionResult> {
  const cwd = options.cwd || process.cwd(); const outputRoot = options.outputRoot || path.resolve("test-results", options.runId); const evidence = new EvidenceManager(options.runId, outputRoot);
  const cliPath = require.resolve("@playwright/test/cli");
  const runnerPaths = testPaths.map((testPath) => path.relative(cwd, path.resolve(testPath)).replace(/\\/g, "/"));
  const args = [cliPath, "test", ...runnerPaths];
  if (options.project) args.push("--project", options.project);
  if (options.browser) args.push("--browser", options.browser);
  if (options.storageState) args.push("--config", path.resolve(cwd, "playwright.config.ts"));
  if (options.captureArtifacts !== false) args.push("--trace", "retain-on-failure", "--video", "retain-on-failure", "--screenshot", "only-on-failure");
  args.push("--reporter", "json");
  const command = `${process.execPath} ${args.join(" ")}`; const started = Date.now();
  const childEnv = { ...process.env, ...(options.healingFile ? { QA_HEALING_FILE: path.resolve(options.healingFile) } : {}) };
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => { const child = spawn(process.execPath, args, { cwd, shell: false, env: childEnv }); let stdout = ""; let stderr = ""; child.stdout.on("data", (d) => { stdout += d.toString(); }); child.stderr.on("data", (d) => { stderr += d.toString(); }); child.on("close", (code) => resolve({ code, stdout, stderr })); child.on("error", (error) => resolve({ code: null, stdout, stderr: `${stderr}${error.message}` })); });
  const diagnosis = result.code === 0 ? undefined : classifyProcessFailure(result.stdout, result.stderr);
  const parsedTests = parseJsonReporter(result.stdout);
  const fallbackStatus = result.code === 0 ? "PASS" : diagnosis?.category.startsWith("E.") || diagnosis?.category.startsWith("C.") ? "BLOCKED" : "FAIL";
  const tests: ExecutionTestResult[] = parsedTests.length
    ? parsedTests.map((item) => ({ path: item.path, status: item.status, durationMs: item.durationMs, stdout: result.stdout, stderr: result.stderr, diagnosis: item.status === "PASS" || item.status === "SKIPPED" ? undefined : diagnosis }))
    : [{ path: testPaths.join(","), status: fallbackStatus as ExecutionTestResult["status"], durationMs: Date.now() - started, stdout: result.stdout, stderr: result.stderr, diagnosis }];
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
