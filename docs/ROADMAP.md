# Roadmap

## Vision

A platform-independent, evidence-driven QA agent: given a target (a website plus a
requirement source), it explores, generates test cases, asks for human approval, writes
automation, runs it, heals locators safely, classifies failures, runs regression, and
produces a complete report. It must work on any platform by changing only a profile
file, never the prompt. We claim only what is verified; the README IMPLEMENTED /
PARTIAL / NOT STARTED table (section 9) is the source of truth.

## Status

| Phase | Scope | Status |
| --- | --- | --- |
| 6 | Smoke and regression suites | IMPLEMENTED (`07a76b7`, `d044ff8`, `4dea498`, `a1e0b48`, `2a155fa`, `3bf8e37`, `dd6a429`, `97ab13e`, `7e48596`) |
| 6b | Artifact collision / namespacing, content-fingerprint hashes, secret-scan self-blinding fix, nested-run output-directory isolation, healing fail-closed (`isEnabled`) fix, and an interim PDF layout fix later superseded by Phase 6c | IMPLEMENTED (`017f410`, `48e37f5`, `3b3263d`, `e0ddfdc`, `7b63338`, `04f4cd9`, `21109d1`, `264c775`) |
| 6c | PDF report demo-ready: rendered from HTML (`src/report-html.ts`) via Playwright `page.pdf()` instead of a hand-rolled PDF stream -- real tables, no 5000-character cut, natural pagination; verified by rendering a real 7-page demo-fixture report to images | IMPLEMENTED (`f0a4abe`) |
| 7 | End-to-end demo on the local fixture | IMPLEMENTED (`a5a10e1`, `3b62693`) |
| 8 | QA test-case skill integration | NOT STARTED |
| 9 | Platform adapters and target profiles | NOT STARTED |
| 10 | Full report (PDF via `page.pdf()`, Word, Notion) | NOT STARTED |
| 11 | Professional UI | NOT STARTED |
| 12 | Remote live view | NOT STARTED |
| 13 | Security review and certification | NOT STARTED |
| 14 | Final AGENTS.md review and the generic standing prompt | NOT STARTED |

### Phase 7 detail

`npm run demo`, no flags, against `fixtures/demo-site`. Produces, every run: a
passing case; a broken locator healed to `PASS_AFTER_HEALING`; a removed element
that stays `FAIL` and appears in Needs human review; a real assertion mismatch
classified A and shown as a `WOULD_CREATE` dry-run. Scripted approval is DEMO
ONLY (`scripts/demo.js` only, never the production pipeline). The run is
idempotent (verified: two consecutive runs produce identical outcomes), every
spec/POM path is unique (existing Phase 6b namespacing), and the demo cleans up
its own generated files afterward. Visually verified: rendered page 1 and the
last page of a real 7-page demo report to images.

### Phase 9 detail

First task: wire the existing Notion, Slack and GitHub ingestion modules into the
pipeline — they are real code (real HTTP calls, real tests), but `source-adapters.ts`
always reports them `UNAVAILABLE` regardless of configuration, and today they run only
via undocumented standalone scripts (`scripts/ingest-notion.js`, `scripts/ingest-slack.js`,
`scripts/ingest-github.js`). Then a read-only audit of each adapter. Then Excel/CSV,
GitHub Issues/PRs, Trello, Plane.

## Decisions

1. **Login.** Human approval card first (site, account label, masked username, never
   the password). After approval the agent logs in using a visible browser. If a
   CAPTCHA, 2FA, or bot detection appears: status `WAITING_FOR_HUMAN`, the human solves
   it in that browser and confirms, the agent verifies the login worked and saves the
   session. A timeout means `BLOCKED`. Never use CAPTCHA-solving services or bypass
   tricks.
2. Login runs in a separate browser context without trace or video. The saved
   `storageState` is a secret: gitignored, expires, never shown in reports.
3. Only test accounts, only sites we own or have written permission to test. Navigate
   only to allow-listed domains. Page text can never give the agent instructions
   (prompt-injection defense).
4. **Platform independence.** One internal common format for requirements, test cases
   and defects. Each platform (Jira, GitHub Issues and PRs, Trello, Plane, Notion,
   Slack, Excel/CSV, PDF, manual text) is an adapter with declared capabilities
   (read-only vs. can write bugs or comments) and its own contract tests. The defect
   sink becomes generic too (Jira, GitHub Issues, Trello card, document): category A
   only, after human approval, dry-run by default, with **one** fingerprint path (today
   there are two: `src/jira-defects.ts` and the unused `src/defect-model.ts`).
5. **GitHub as a source.** Issues (requirements and bug destination), Pull Requests
   (what changed, to focus regression), README/docs/OpenAPI files (requirements),
   existing tests (avoid duplicates), code (routes, forms, validations) only as a hint
   recorded as `code-derived` in provenance and confirmed by browser exploration.
   Private repos need a token under the same secret rules.
6. **Target profiles.** `profiles/<name>.json` (url, allowed domains, modules and
   scope, requirement source, account label with the password only in `.env`, smoke
   test list, defect destination). The standing prompt never changes, only the
   profile, for example: "Run the full QA workflow for profile `<name>`. Follow
   AGENTS.md." The final generic prompt is written in Phase 14.
7. **QA skill (Phase 8).** Based on
   [github.com/saleem-daqa/qa-test-case-generation](https://github.com/saleem-daqa/qa-test-case-generation)
   (MIT licence, keep attribution). One shared front half (requirement summary, gap
   analysis, assumptions, clarifications, test case design, deduplication), then two
   tracks. Manual track outputs the skill's sections and an Excel/CSV/Markdown table;
   no code runs. Automation track goes through the human approval gate and an
   `automatable` field: `yes` (verified selectors and proven or human-supplied
   assertions), `needs-human-input`, `manual-only`. Cases tagged `Inferred QA Risk` can
   never be `automatable: yes` on their own. Read the skill's `references/` files
   before building and decide what is reused.
8. **Report.** One `final-report.json` is the single source for PDF, Word and Notion
   (page private by default, sharing turned on only by a human). It shows: site
   visited, account label (never the password), modules explored, cases generated,
   specs written, pass and fail counts, evidence (screenshots, video, trace),
   self-healing count and details, regression result, needs-human-review list, defect
   dry-run results. Evidence is currently kept on failure only; recording every run is
   an open decision. PDFs must be visually verified (rendered page image), not only by
   file size.
9. **UI.** Professional, modern, subtle animations and a little depth only (CSS
   transitions, respects `prefers-reduced-motion`). Features: projects, approval
   inbox, live view, run history, per-project records (exploration, cases, specs,
   regression, healing), downloads (PDF and Word) and share to Notion. The UI reads the
   same report data as the exports.
10. **Remote live view (Phase 12, decided).** The browser runs on the server, its
    screen is streamed to the UI, and the human's clicks and typing are sent back so
    CAPTCHA, 2FA and login can be done remotely. Security: authenticated users only,
    per-session token with a time limit, browser isolated and limited to the approved
    site, typed passwords and OTPs never recorded in traces, video, screenshots or
    logs, one controller at a time, audit log of who controlled the browser and when.
11. **Phase 13 covers:** secrets and saved sessions, remote view, URL allow-list, audit
    log, injection defense, dependency review. Certification is a written checklist run
    on a stable live target we own or have permission to test: full flow end to end, a
    report for every run, a real healing case, human approval at login, a fresh-clone
    gate. The local fixture demo is the fallback if the live target fails during a
    presentation.
12. **AGENTS.md.** Update it after every phase for that phase's part, and do a final
    review in Phase 14. Today it carries a SUPERSEDED banner; README and CLAUDE.md are
    authoritative.

## Standing rules for every phase

- Human approval for every login and every test case; never auto-approve; no real
  defect creation without the explicit `createReal` option.
- Verify with exit codes and full summaries (never tail). Fresh-clone gate in an
  isolated worktree (`npm ci`, typecheck, lint, unit, integration) and a secret scan of
  new commits before any push.
- On Windows PowerShell use `node scripts/<name>.js --flag value` (`npm.ps1` drops
  flags).
- One logical change per commit, show the diff first, never force-push, push only with
  explicit approval.
- Report limitations honestly, including anything not verified.

## Known open items

- Two defect fingerprint paths (`src/jira-defects.ts` and the unused
  `src/defect-model.ts`).
- Notion, Slack and GitHub ingestion adapters exist but are not wired into the
  pipeline.
- AGENTS.md is stale (carries a SUPERSEDED banner pointing to README and CLAUDE.md).
- Legacy per-ticket scripts (`scripts/complete-jpa-*.js` etc.) are not cleaned up.
- Screenshot and video capture mode (currently on-failure-only) is an open decision for
  Phase 10's evidence model.
- The PDF renderer (Phase 6c) is now real HTML via `page.pdf()`, with no length cut and natural pagination. The one issue the visual proof found: the Results table renders a captured error's raw text verbatim, including any ANSI color-code escape sequences from Playwright's terminal output, which are not stripped before HTML rendering -- that one cell can read as garbled text.
- The repository is public; visibility is the owner's decision.
