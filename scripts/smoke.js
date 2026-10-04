"use strict";
// `npm run smoke` -- no path arguments. The smoke selection comes from
// qa.config.json (see src/smoke-config.ts). An absent or empty config yields
// SKIPPED_NOT_CONFIGURED, never a pass.
process.env.QA_SUITE = "smoke";
const { main } = require("./suite-runner.js");
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
