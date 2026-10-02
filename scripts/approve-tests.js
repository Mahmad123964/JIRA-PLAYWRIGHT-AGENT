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
const {
  loadApprovalStore,
  saveApprovalStore,
  approveTestCase,
  rejectTestCase,
  editTestCase,
  approveSelected,
  rejectSelected,
  markReadyForAutomation,
  getApprovalSummary,
  getPendingApproval,
  getReadyForAutomation,
  listApprovalStores,
} = require(path.join(__dirname, "../src/approval-store.ts"));

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
  const positional = argv.find((a) => !a.startsWith("--"));
  return {
    command: positional,
    storeId: readFlag(argv, "--store"),
    testCaseId: readFlag(argv, "--id"),
    testCaseIds: readMultiFlag(argv, "--id"),
    reviewer: readFlag(argv, "--reviewer") || "human",
    comment: readFlag(argv, "--comment"),
    output: readFlag(argv, "--output"),
  };
}

function printUsage() {
  console.error(`
Usage: node scripts/approve-tests.js <command> --store <storeId> [options]

Commands:
  list              List all approval stores
  status            Show approval summary for a store
  pending           Show pending test cases
  approve           Approve a test case (--id <testCaseId>)
  reject            Reject a test case (--id <testCaseId>)
  approve-all       Approve all pending test cases
  reject-all        Reject all pending test cases
  ready             Mark approved test cases as READY_FOR_AUTOMATION
  show              Show all test cases in a store

Options:
  --store <id>      Approval store ID (required for most commands)
  --id <id>         Test case ID (can be repeated for multiple)
  --reviewer <name> Reviewer name (default: human)
  --comment <text>  Comment for the decision
  --output <file>   Save result to file
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.command || args.command === "help") {
    printUsage();
    process.exit(0);
  }

  // List stores — no store ID needed
  if (args.command === "list") {
    const stores = listApprovalStores();
    const result = { stores, count: stores.length };
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (!args.storeId) {
    console.error("--store <storeId> is required");
    printUsage();
    process.exit(1);
  }

  const store = loadApprovalStore(args.storeId);
  if (!store) {
    console.error(`Approval store not found: ${args.storeId}`);
    process.exit(1);
  }

  let result;

  switch (args.command) {
    case "status": {
      const summary = getApprovalSummary(store);
      result = { storeId: store.storeId, module: store.module, scope: store.scope, summary };
      break;
    }

    case "pending": {
      const pending = getPendingApproval(store);
      result = {
        storeId: store.storeId,
        pending: pending.map((tc) => ({
          testCaseId: tc.testCaseId,
          title: tc.title,
          priority: tc.priority,
          testType: tc.testType,
          status: tc.status,
        })),
        count: pending.length,
      };
      break;
    }

    case "show": {
      result = {
        storeId: store.storeId,
        module: store.module,
        scope: store.scope,
        summary: getApprovalSummary(store),
        testCases: store.testCases,
      };
      break;
    }

    case "approve": {
      if (!args.testCaseId && (!args.testCaseIds || args.testCaseIds.length === 0)) {
        console.error("--id <testCaseId> is required for approve");
        process.exit(1);
      }
      const ids = args.testCaseIds || [args.testCaseId];
      const { approved, failed } = approveSelected(store, ids, args.reviewer, args.comment);
      saveApprovalStore(store);
      result = { approved, failed, summary: getApprovalSummary(store) };
      break;
    }

    case "reject": {
      if (!args.testCaseId && (!args.testCaseIds || args.testCaseIds.length === 0)) {
        console.error("--id <testCaseId> is required for reject");
        process.exit(1);
      }
      const ids = args.testCaseIds || [args.testCaseId];
      const { rejected, failed } = rejectSelected(store, ids, args.reviewer, args.comment);
      saveApprovalStore(store);
      result = { rejected, failed, summary: getApprovalSummary(store) };
      break;
    }

    case "approve-all": {
      const pending = getPendingApproval(store);
      const ids = pending.map((tc) => tc.testCaseId);
      const { approved, failed } = approveSelected(store, ids, args.reviewer, args.comment || "Bulk approved");
      saveApprovalStore(store);
      result = { approved, failed, summary: getApprovalSummary(store) };
      break;
    }

    case "reject-all": {
      const pending = getPendingApproval(store);
      const ids = pending.map((tc) => tc.testCaseId);
      const { rejected, failed } = rejectSelected(store, ids, args.reviewer, args.comment || "Bulk rejected");
      saveApprovalStore(store);
      result = { rejected, failed, summary: getApprovalSummary(store) };
      break;
    }

    case "ready": {
      // Mark all APPROVED test cases as READY_FOR_AUTOMATION
      const approved = store.testCases.filter((tc) => tc.status === "APPROVED" || tc.status === "EDITED");
      const markedReady = [];
      const markFailed = [];
      for (const tc of approved) {
        const r = markReadyForAutomation(store, tc.testCaseId);
        if (r.success) markedReady.push(tc.testCaseId);
        else markFailed.push({ id: tc.testCaseId, error: r.error });
      }
      saveApprovalStore(store);
      result = {
        markedReady,
        failed: markFailed,
        readyForAutomation: getReadyForAutomation(store).map((tc) => ({
          testCaseId: tc.testCaseId,
          title: tc.title,
          status: tc.status,
        })),
        summary: getApprovalSummary(store),
      };
      break;
    }

    default:
      console.error(`Unknown command: ${args.command}`);
      printUsage();
      process.exit(1);
  }

  const output = JSON.stringify(result, null, 2);

  if (args.output) {
    const outDir = path.dirname(path.resolve(args.output));
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.output, output, "utf-8");
    console.error(`[approve-tests] Result saved to: ${args.output}`);
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
