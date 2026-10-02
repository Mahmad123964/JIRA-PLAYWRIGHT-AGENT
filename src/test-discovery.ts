import fs from "fs";
import path from "path";

export interface DiscoveredSuite { mode: "regression" | "smoke"; paths: string[]; warnings: string[]; }

function walk(dir: string, pattern: RegExp, result: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, pattern, result);
    else if (pattern.test(entry.name)) result.push(path.relative(process.cwd(), full).replace(/\\/g, "/"));
  }
}

export function discoverRegressionTests(root = process.cwd()): DiscoveredSuite {
  const paths: string[] = [];
  walk(path.join(root, "tests", "api"), /\.spec\.ts$/i, paths);
  walk(path.join(root, "tests", "generated"), /\.spec\.ts$/i, paths);
  paths.sort();
  return { mode: "regression", paths, warnings: paths.length ? [] : ["No tests discovered under tests/api or tests/generated"] };
}

export function discoverSmokeTests(root = process.cwd(), configured: string[] = []): DiscoveredSuite {
  const valid = configured.filter((item) => fs.existsSync(path.resolve(root, item))).map((item) => path.relative(root, path.resolve(root, item)).replace(/\\/g, "/"));
  return { mode: "smoke", paths: [...new Set(valid)].sort(), warnings: valid.length ? [] : ["No smoke tests were explicitly configured; no business flow was invented"] };
}
