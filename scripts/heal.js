"use strict";
// Intentionally does not import healLocator: ranking-only ranking cannot verify
// a candidate, so this CLI is a reporting stub. The production healing path is
// healOnSamePage (src/healing-runtime.ts) -> validatedHeal
// (src/validated-healing.ts), which validates live and re-runs the assertion.
function main() {
  console.error(
    "Self-healing is deterministic and requires an exploration JSON with observed elements.",
  );
  console.log(
    JSON.stringify(
      {
        status: "BLOCKED",
        reason:
          "Provide integration-specific observed elements and validation context; no silent test mutation is performed.",
      },
      null,
      2,
    ),
  );
}
if (require.main === module) main();
module.exports = { main };
