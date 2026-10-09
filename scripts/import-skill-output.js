"use strict";

const path = require("path");
const fs = require("fs");
const typescript = require("typescript");
require("dotenv").config();

require.extensions[".ts"] = function loadTs(module, filename) {
  const src = fs.readFileSync(filename, "utf8");
  const out = typescript.transpileModule(src, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};

require(path.join(__dirname, "../src/document-ingestion.ts"));
require(path.join(__dirname, "../src/browser-explorer.ts"));
require(path.join(__dirname, "../src/test-case-generator.ts"));
const { importSkillOutput } = require(path.join(__dirname, "../src/skill-import.ts"));
const { createApprovalStore, saveApprovalStore } = require(path.join(__dirname, "../src/approval-store.ts"));

function readFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const filePath = readFlag(argv, "--file");
  const module_ = readFlag(argv, "--module");
  const scope = readFlag(argv, "--scope");

  if (!filePath || !module_ || !scope) {
    console.error("Usage: node scripts/import-skill-output.js --file <path> --module <m> --scope <s>");
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(resolvedPath, "utf-8");

  let result;
  try {
    result = importSkillOutput(text, module_);
  } catch (err) {
    console.error(`Import rejected: ${err.message}`);
    process.exit(1);
  }

  const store = createApprovalStore(module_, scope, result.accepted);
  const storePath = saveApprovalStore(store);

  console.log(`Accepted: ${result.accepted.length}`);
  console.log(`Rejected: ${result.rejected.length}`);
  for (const r of result.rejected) {
    console.log(`  - row ${r.row}: ${r.reason}`);
  }
  console.log(`Quarantined (secret/injection): ${result.quarantined.length}`);
  for (const q of result.quarantined) {
    console.log(`  - row ${q.row}: ${q.reason}`);
  }
  console.log(`Duplicate groups: ${result.duplicates.length}`);
  for (const d of result.duplicates) {
    console.log(`  - ${d.testCaseIds.join(", ")}`);
  }
  console.log(`Secrets masked: ${result.secretsMaskedCount}`);
  console.log(`Approval store saved: ${storePath}`);

  process.exit(0);
}

main();
