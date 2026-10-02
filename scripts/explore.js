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
const { exploreUrl, validateExplorationInput } = require(path.join(__dirname, "../src/browser-explorer.ts"));

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
    url: readFlag(argv, "--url"),
    module: readFlag(argv, "--module"),
    scope: readFlag(argv, "--scope"),
    requirements: readMultiFlag(argv, "--requirement") || [],
    maxPages: readFlag(argv, "--max-pages") ? parseInt(readFlag(argv, "--max-pages"), 10) : undefined,
    authRequired: argv.includes("--auth-required"),
    output: readFlag(argv, "--output"),
    headless: !argv.includes("--headed"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url || !args.module) {
    console.error("Usage: node scripts/explore.js --url <url> --module <module> [--scope <scope>] [--requirement <req>] [--output <file>] [--max-pages <n>] [--headed]");
    process.exit(1);
  }

  const input = {
    url: args.url,
    module: args.module,
    scope: args.scope || args.module,
    requirements: args.requirements,
    maxPages: args.maxPages,
    authRequired: args.authRequired,
  };

  const validation = validateExplorationInput(input);
  if (!validation.valid) {
    console.error(`Invalid input: ${validation.error}`);
    process.exit(1);
  }

  console.error(`[explore] Starting exploration of ${args.url} — module: ${args.module}`);

  const result = await exploreUrl(input, { headless: args.headless });

  const output = JSON.stringify(result, null, 2);

  if (args.output) {
    const outDir = path.dirname(path.resolve(args.output));
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(args.output, output, "utf-8");
    console.error(`[explore] Result saved to: ${args.output}`);
  }

  console.log(output);

  process.exit(result.status === "SUCCESS" || result.status === "PARTIAL" ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
