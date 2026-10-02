const path = require("path");
const fs = require("fs");
const typescript = require("typescript");
require("dotenv").config();

// Register the .ts loader so that notion-ingestion.ts can require
// ./document-ingestion.ts (nested TypeScript import) at runtime.
require.extensions[".ts"] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: filename,
  });
  module._compile(compiled.outputText, filename);
};

const { ingestNotion } = require("../src/notion-ingestion.ts");

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
}

function parseArgs(argv) {
  // Positional query is the first non-flag argument.
  const queryArg = argv.find((arg) => !arg.startsWith("--"));
  return {
    query: queryArg || undefined,
    jiraKey: readFlag(argv, "--jira-key"),
    summary: readFlag(argv, "--summary"),
    feature: readFlag(argv, "--feature"),
    project: readFlag(argv, "--project"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const result = await ingestNotion({
    query: args.query,
    jiraTicketKey: args.jiraKey,
    jiraSummary: args.summary,
    featureName: args.feature,
    projectName: args.project,
  });

  console.log(JSON.stringify(result, null, 2));

  process.exit(result.status === "AVAILABLE" || result.status === "PARTIALLY_AVAILABLE" ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
