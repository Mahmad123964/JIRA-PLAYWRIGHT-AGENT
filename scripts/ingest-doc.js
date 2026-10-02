const path = require("path");
const fs = require("fs");
const ts = require("typescript");

/**
 * Dynamically loads and transpiles a TypeScript module in-memory.
 */
function loadTsModule(modulePath) {
  const absolutePath = path.resolve(modulePath);
  const tsCode = fs.readFileSync(absolutePath, "utf8");
  const transpiled = ts.transpileModule(tsCode, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const Module = module.constructor;
  const m = new Module(absolutePath, module.parent);
  m.filename = absolutePath;
  m.paths = Module._nodeModulePaths(path.dirname(absolutePath));
  m._compile(transpiled.outputText, absolutePath);
  return m.exports;
}

const docModule = loadTsModule(
  path.join(__dirname, "../src/document-ingestion.ts"),
);
const ingestDocument = docModule.ingestDocument;

async function main() {
  const targetFile = process.argv[2];
  if (!targetFile) {
    console.error("Usage: node scripts/ingest-doc.js <path-to-pdf>");
    process.exit(1);
  }

  const result = await ingestDocument(targetFile);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "SUCCESS" ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  main,
  ingestDocument,
  loadTsModule,
};
