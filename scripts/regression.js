"use strict";
// `npm run regression` -- no path arguments. The selection is derived from
// approval stores plus stored per-test results (see src/regression-selection.ts).
const { main } = require("./suite-runner.js");
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
