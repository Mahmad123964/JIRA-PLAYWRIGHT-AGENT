const fs = require("fs");
const typescript = require("typescript");

require.extensions[".ts"] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
    fileName: filename,
  });

  module._compile(compiled.outputText, filename);
};

const { getTodoTasks } = require("./src/jira.ts");

async function main() {
  try {
    const tasks = await getTodoTasks("JPA");
    console.log("Jira To Do tasks for project JPA:");
    console.log(JSON.stringify(tasks, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Jira read-only test failed: ${message}`);
    process.exitCode = 1;
  }
}

main();
