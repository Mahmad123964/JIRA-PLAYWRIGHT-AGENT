"use strict";
const fs = require("fs");
const path = require("path");
const typescript = require("typescript");
require.extensions[".ts"] = function loadTs(module, filename) {
  const out = typescript.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(out, filename);
};
const {
  loadApprovalStore,
  approveSelected,
  markReadyForAutomation,
  saveApprovalStore,
} = require(path.join(__dirname, "../src/approval-store.ts"));
const storeId = process.argv[2];
if (!storeId)
  throw new Error("Demo-only usage: node scripts/demo-approve.js <store-id>");
const store = loadApprovalStore(storeId);
if (!store) throw new Error(`Approval store not found: ${storeId}`);
console.warn(
  "DEMO ONLY: scripted approval is not part of the production approval path.",
);
const pending = store.testCases.filter(
  (testCase) => testCase.status === "PENDING_APPROVAL",
);
approveSelected(
  store,
  pending.map((testCase) => testCase.testCaseId),
  "demo-reviewer",
  "DEMO ONLY approval",
);
for (const testCase of store.testCases.filter(
  (item) => item.status === "APPROVED",
))
  markReadyForAutomation(store, testCase.testCaseId);
const filePath = saveApprovalStore(store);
console.log(
  JSON.stringify(
    {
      demoOnly: true,
      storeId: store.storeId,
      filePath,
      ready: store.testCases
        .filter((item) => item.status === "READY_FOR_AUTOMATION")
        .map((item) => item.testCaseId),
    },
    null,
    2,
  ),
);
