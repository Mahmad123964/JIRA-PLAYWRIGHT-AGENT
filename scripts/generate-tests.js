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
const { generateTestCases } = require(path.join(__dirname, "../src/test-case-generator.ts"));
const { createApprovalStore, saveApprovalStore } = require(path.join(__dirname, "../src/approval-store.ts"));

function readFlag(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function readMultiFlag(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      values.push(argv[i + 1]);
    }
  }
  return values.length > 0 ? values : undefined;
}

function parseArgs(argv) {
  return {
    exploration: readFlag(argv, "--exploration"),
    jiraKey: readFlag(argv, "--jira-key"),
    notionPageId: readFlag(argv, "--notion-page-id"),
    humanOutcome: readMultiFlag(argv, "--human-outcome"),
    output: readFlag(argv, "--output"),
    requirements: readMultiFlag(argv, "--requirement"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.exploration) {
    console.error("Usage: node scripts/generate-tests.js --exploration <exploration-json-file> [--jira-key <key>] [--output <file>]");
    process.exit(1);
  }

  const explorationPath = path.resolve(args.exploration);
  if (!fs.existsSync(explorationPath)) {
    console.error(`Exploration file not found: ${explorationPath}`);
    process.exit(1);
  }

  let explorationResult;
  try {
    explorationResult = JSON.parse(fs.readFileSync(explorationPath, "utf-8"));
  } catch (err) {
    console.error(`Failed to parse exploration file: ${err.message}`);
    process.exit(1);
  }

  const requirements = args.requirements && args.requirements.length > 0
    ? args.requirements
    : explorationResult.target?.requirements || [];
  if (["FAILED", "BLOCKED"].includes(explorationResult.explorationStatus) || ["ERROR", "BLOCKED", "BLOCKED / AUTH REQUIRED", "BLOCKED / MISSING REQUIREMENT"].includes(explorationResult.status)) {
    console.error(`[generate-tests] Exploration is ${explorationResult.explorationStatus || explorationResult.status}; generated cases will be blocked/manual-verification only.`);
  }
  const module = explorationResult.target?.module || "Unknown";
  const scope = explorationResult.target?.scope || module;

  console.error(`[generate-tests] Generating test cases for module: ${module}`);
  console.error(`[generate-tests] Requirements: ${requirements.length}`);

  const humanExpectedOutcomes = (args.humanOutcome || []).map((value) => {
    const [requirement, type, outcomeValue] = value.split("|");
    if (!["visible", "text", "url"].includes(type)) throw new Error(`Invalid --human-outcome type: ${type}`);
    return { requirement, type, value: outcomeValue, provenance: "human-supplied" };
  });

  const generatorResult = generateTestCases({
    requirements,
    explorationResult,
    module,
    scope,
    humanExpectedOutcomes,
    jiraTicketKey: args.jiraKey,
    notionPageId: args.notionPageId,
  });

  // Create approval store — all test cases start as PENDING_APPROVAL
  const store = createApprovalStore(
    module,
    scope,
    generatorResult.testCases,
    explorationResult,
    explorationPath,
  );
  const storePath = saveApprovalStore(store);

  console.error(`[generate-tests] Generated ${generatorResult.totalGenerated} test cases`);
  console.error(`[generate-tests] Approval store saved: ${storePath}`);
  console.error(`[generate-tests] Store ID: ${store.storeId}`);
  console.error(`[generate-tests] Step coverage: ${JSON.stringify(generatorResult.coverageSummary.stepSummary)}`);
  for (const testCase of generatorResult.testCases) {
    for (const step of testCase.steps) {
      if (step.needsHumanInput) console.error(`[generate-tests] NEEDS_HUMAN_INPUT ${testCase.testCaseId} step ${step.step}: ${step.needsHumanInput}`);
    }
  }

  const output = JSON.stringify({
    ...generatorResult,
    approvalStoreId: store.storeId,
    approvalStorePath: storePath,
  }, null, 2);

  if (args.output) {
    const outDir = path.dirname(path.resolve(args.output));
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.output, output, "utf-8");
    console.error(`[generate-tests] Result saved to: ${args.output}`);
  }

  console.log(output);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
