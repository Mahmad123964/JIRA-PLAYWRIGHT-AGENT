import { test, expect } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * automatable must always come from computeAutomatable() -- never a hand-set literal --
 * everywhere except scripts/demo.js, which is explicitly DEMO ONLY (see its own
 * file-level comment and README section 9c) and simulates already-vetted cases built
 * outside the real generator pipeline.
 */
const HANDSET_PATTERN = /automatable\s*:\s*["'](yes|needs-human-input|manual-only)["']/;

function listFilesRecursive(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

test("no file under src/ hand-sets automatable -- it always comes from computeAutomatable()", () => {
  const srcDir = path.resolve(__dirname, "../../src");
  const offenders: string[] = [];
  for (const file of listFilesRecursive(srcDir, [".ts"])) {
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (HANDSET_PATTERN.test(line)) {
        offenders.push(`${path.relative(srcDir, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

test("no script except scripts/demo.js hand-sets automatable", () => {
  const scriptsDir = path.resolve(__dirname, "../../scripts");
  const offenders: string[] = [];
  for (const file of listFilesRecursive(scriptsDir, [".js", ".ts"])) {
    if (path.basename(file) === "demo.js") continue;
    const content = fs.readFileSync(file, "utf-8");
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (HANDSET_PATTERN.test(line)) {
        offenders.push(`${path.relative(scriptsDir, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

test("scripts/demo.js is the only hand-set exception, and is explicitly marked DEMO ONLY", () => {
  const demoPath = path.resolve(__dirname, "../../scripts/demo.js");
  const content = fs.readFileSync(demoPath, "utf-8");
  const handSetLines = content.split(/\r?\n/).filter((line) => HANDSET_PATTERN.test(line));
  expect(handSetLines.length).toBeGreaterThan(0);
  expect(content).toContain("DEMO ONLY: automatable");
});
