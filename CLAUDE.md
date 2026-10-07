# CLAUDE.md

## Non-negotiable rules
- Human approval gate is never bypassed. Never auto-approve test cases, logins, or defects.
- Never invent assertions, URLs, selectors, or business outcomes. No exploration/human-supplied
  proof -> flag NEEDS_HUMAN_INPUT, do not guess.
- BLOCKED / SKIPPED / SKIPPED_NOT_CONFIGURED are never reported as PASS.
- Category A (real app defect) requires a Playwright Expected/Received diff. Only A reaches the
  Jira defect sink. Real Jira issue creation requires an explicitly injected Jira client plus
  `createReal: true` passed to `createDefect()` in src/jira-defects.ts -- there is no CLI flag
  for this; every current CLI entry point (scripts/defect-dry-run.js, approved-runner.ts) stays
  dry-run.
- Healing: eligible only for LOCATOR_NOT_FOUND/EMPTY; role+name must match; live validation is
  mandatory; fails closed with no validator and on a thrown isEnabled()/isVisible(); report
  PASS_AFTER_HEALING, never plain PASS; never auto-apply a suggested patch.
- Never print/log/commit secrets or sessions. src/final-report.ts's secret scan runs on the RAW
  run data in memory (never persisted raw) and reports PASS only when nothing was found, so a
  masked secret now reads `MASKED <n>` rather than a silent PASS.
- AGENTS.md carries a SUPERSEDED banner and is historical/Jira-centric; it does not describe the
  current pipeline. Treat README.md sections 9 and 11 as authoritative for status and
  architecture.

## Commands (run from repo root)
- Windows PowerShell: `npm run <script> -- --flag` DROPS flags via the npm.ps1 shim. Use
  `node scripts/<name>.js --flag value` or `npm.cmd run <script> -- --flag value`.
- `npm run typecheck` / `npm run lint` -- exit 0 required.
- `npx playwright test tests/unit` -- must be 0 failed, 0 skipped to count as green.
- `npx playwright test tests/integration` -- each nested Playwright run now gets its own salted
  --output directory, so concurrent runs under the default worker count no longer clobber a
  shared test-results/. Default workers are fine; no --workers=1 workaround is needed.
- `npm run smoke` / `npm run regression` -- read qa.config.json / approval-store evidence; never
  infer flows.

## Workflow for changes
- One logical change per commit. Show the diff before committing. Never force-push, never push
  without explicit approval, never skip hooks.
- Before any destructive git op, run `git status` and stash/commit anything present.
- Before claiming "done": run the full fresh-clone gate (isolated worktree outside the repo:
  npm ci, typecheck, lint, unit, integration) and a secret scan of new commits (`git log -p`).
- Say what you did NOT verify. If you find a problem in earlier work (yours or another agent's),
  say so plainly.

## Known-stale / do not trust
- scripts/complete-jpa-*.js, process-jpa-28.js, process-ticket.js, verify-jpa28-bug.js,
  jira-ops.js, discover.{js,ts} are legacy per-ticket scripts kept for history. Not wired into
  package.json or the pipeline. Do not delete without being asked.
- src/jira.ts, src/jira-helper.ts, src/defect-model.ts, src/notion-ingestion.ts,
  src/slack-ingestion.ts, src/github-ingestion.ts are real code but NOT called from
  requirement-sources.ts/source-adapters.ts. Reachable only via standalone scripts/ingest-*.js,
  which are undocumented and untested as pipeline stages.
- src/defect-model.ts's LocalDefectSink is a second, non-interoperable defect-dedup mechanism
  (different fingerprint field than src/jira-defects.ts's defectFingerprint()). It is dead code
  today (no importer), but do not wire it in without reconciling the two fingerprint schemes.
