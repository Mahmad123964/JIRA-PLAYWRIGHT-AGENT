"use strict";
const fs = require("fs");
const path = require("path");

const roots = ["src", "tests/generated"];
const offenders = [];
function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(filePath);
    else if (/\.(ts|js)$/.test(entry.name)) {
      const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/waitForTimeout\s*\(|\.nth\s*\(|xpath/i.test(line))
          offenders.push(`${filePath}:${index + 1}`);
      });
    }
  }
}
roots.forEach(walk);
if (offenders.length) {
  console.error(`Forbidden locator/wait usage found:\n${offenders.join("\n")}`);
  process.exitCode = 1;
} else
  console.log(
    "Lint passed: no waitForTimeout, nth(), or XPath usage detected.",
  );
