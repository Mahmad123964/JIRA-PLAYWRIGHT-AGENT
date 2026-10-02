"use strict";

const path = require("path");
const fs = require("fs");
const typescript = require("typescript");
require("dotenv").config();

// Register .ts loader so TypeScript source files can be required at runtime.
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

// Load document-ingestion first (github-ingestion imports from it)
require(path.join(__dirname, "../src/document-ingestion.ts"));
const { ingestGitHub } = require(path.join(__dirname, "../src/github-ingestion.ts"));

// ----------------------------------------------------------------------------
// Argument parsing
// ----------------------------------------------------------------------------

function readFlag(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) return undefined;
  return value;
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
  // First non-flag argument is the positional query
  const queryArg = argv.find((arg) => !arg.startsWith("--"));
  return {
    query: queryArg || undefined,
    jiraKey: readFlag(argv, "--jira-key"),
    summary: readFlag(argv, "--summary"),
    feature: readFlag(argv, "--feature"),
    repository: readFlag(argv, "--repository"),
    branch: readFlag(argv, "--branch"),
    endpoint: readMultiFlag(argv, "--endpoint"),
    testName: readMultiFlag(argv, "--test-name"),
    maxFiles: readFlag(argv, "--max-files"),
  };
}

// ----------------------------------------------------------------------------
// Config builder — never hardcodes credentials
// ----------------------------------------------------------------------------

function buildConfig(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  // Repository can come from CLI arg or environment
  const repoArg = args.repository || process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repoArg.includes("/")
    ? repoArg.split("/", 2)
    : [process.env.GITHUB_OWNER || "", process.env.GITHUB_REPO || repoArg];

  if (!owner || !repo) return null;

  return {
    token,
    apiBaseUrl: (process.env.GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/+$/, ""),
    repository: repo,
    owner,
    ref: args.branch || process.env.GITHUB_REF || process.env.GITHUB_BRANCH || "main",
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const config = buildConfig(args);

  const featureKeywords = [];
  if (args.query) featureKeywords.push(args.query);
  if (args.feature) featureKeywords.push(args.feature);

  const result = await ingestGitHub({
    githubConfig: config,
    jiraTicketKey: args.jiraKey,
    jiraSummary: args.summary,
    featureKeywords: featureKeywords.length > 0 ? featureKeywords : undefined,
    endpointNames: args.endpoint,
    testNames: args.testName,
    maxFiles: args.maxFiles ? parseInt(args.maxFiles, 10) : undefined,
  });

  // Output structured JSON — never print the token
  const output = {
    status: result.status,
    authenticated: result.integrationHealth.authenticated,
    repository: result.repository,
    ref: result.ref,
    recordsFound: result.integrationHealth.recordsInspected,
    recordsAccepted: result.integrationHealth.recordsAccepted,
    recordsRejected: result.integrationHealth.recordsRejected,
    conflicts: result.conflicts.map((c) => ({
      kind: c.kind,
      jiraFact: c.jiraFact,
      detail: c.detail,
      path: c.githubSource.path,
    })),
    conflictResult: result.conflictResult,
    promptInjectionDetected: result.promptInjectionDetected,
    secretsMaskedCount: result.secretsMaskedCount,
    technicalFactsExtracted: result.technicalFacts.length,
    error: result.error || null,
    integrationHealth: {
      status: result.integrationHealth.status,
      authenticated: result.integrationHealth.authenticated,
      searchAvailable: result.integrationHealth.searchAvailable,
      fileReadAvailable: result.integrationHealth.fileReadAvailable,
    },
  };

  console.log(JSON.stringify(output, null, 2));

  const exitCode =
    result.status === "AVAILABLE" || result.status === "PARTIALLY_AVAILABLE" ? 0 : 1;
  process.exit(exitCode);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}

module.exports = { main, parseArgs, buildConfig };
