# Generic Playwright QA Automation Agent

A requirements-driven Playwright QA agent with a human approval gate; Jira is optional.

> **Current verified status:** the status table in section 3 is authoritative. "Project History" near the end is historical context, not a claim of current behavior.

## 1. What this agent does

The agent explores a supplied website, generates test cases from requirements and observed UI, waits for human approval, generates TypeScript Page Objects and Playwright specs for eligible ready cases, executes them, parses **real per-test results** out of Playwright's JSON reporter, classifies failures, optionally validates locator repairs on the same page, and produces JSON and PDF reports. The optional Jira defect path is dry-run by default. The `qa` command stops at the approval gate; use the separate commands below to continue.

## 2. Requirements and pinned versions

```text
Node.js   >= 22
Playwright 1.62.1  (pinned exactly — no ^ or ~)
```

```powershell
npm ci
npx playwright install chromium
```

**Why Playwright is pinned exactly.** `src/execution-engine.ts` (JSON reporter parsing) and `src/failure-classifier.ts` (message-text classification) both depend on the **Playwright 1.62** reporter schema and error-message wording. 1.62 moved the per-test outcome, duration and errors into `test.results[last]`, made `test.status` an expectation resolution, and renders a missing element as the literal placeholder `<element(s) not found>`. Both modules are verified against **1.62.1** only. A minor or major bump may silently break parsing or classification, so treat an upgrade as a code change and re-run the full suites.

### Configuration

`.env.example` at the repository root documents every environment variable the code reads, with a placeholder value and a one-line note on what each one is and whether it is optional:

```powershell
Copy-Item .env.example .env    # PowerShell
```

Only `src/jira.ts` requires configuration (`JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`) and it throws when they are missing. Every other integration — GitHub, Notion, Slack — is optional: when its variable is absent the adapter reports `UNAVAILABLE` and the core engine still runs against a supplied URL or the local fixture.

`.env` is gitignored and must never be committed; `.env.example` is tracked and contains placeholders only.

## 3. How to run it

Run from the repository root.

> **Command syntax note — Windows PowerShell only.** In Windows PowerShell 5.1 the bare command `npm` resolves to the **`npm.ps1` shim** (`ExternalScript` outranks `Application` in command precedence). That shim re-quotes its arguments before calling `npm-cli.js`, and in doing so it destroys the `--` separator, so npm then parses your `--flag` tokens as **its own** config and drops them. Measured with an argv echo script:
>
> | Invocation | ARGV received by the script |
> | --- | --- |
> | `npm run x -- --url X --module Y` (PowerShell → `npm.ps1`) | `["X","Y"]` — **flags lost** |
> | `npm.cmd run x -- --url X --module Y` | `["--url","X","--module","Y"]` ✅ |
> | `cmd /c "npm run x -- --url X --module Y"` | `["--url","X","--module","Y"]` ✅ |
> | `npm run x '--' --url X --module Y` | `["--url","X","--module","Y"]` ✅ |
>
> This is **not** an npm bug and **not** a general PowerShell parsing limitation — `npm.cmd` from the same shell works fine, and quoting the separator as a literal `'--'` string also works. Without the separator both wrappers behave identically (npm treats `--url` as config), which is expected npm behaviour.
>
> The simplest shell-independent form is to call `node` directly, and that is what this README uses:
>
> ```powershell
> node scripts/explore.js --url "<url>" ...     # always works
> ```
>
> Working `npm` alternatives in PowerShell: `npm.cmd run <script> -- --flag value`, or `npm run <script> '--' --flag value`.
>
> `npm run <script>` works unchanged for scripts that take no flags (`typecheck`, `lint`, `demo-site`).

```powershell
node scripts/explore.js --url "<url>" --module "<module>" --scope "<scope>" --requirement "<requirement>" --output "exploration.json"
```
Explore the site and save observed pages, controls, locator candidates and provenance.

```powershell
node scripts/generate-tests.js --exploration "exploration.json" --output "generated.json"
node scripts/generate-tests.js --exploration "exploration.json" --requirement "<requirement>" --human-outcome "<requirement>|text|<human-supplied exact text>" --output "generated.json"
```
Generate `PENDING_APPROVAL` cases and print flagged steps. Human outcome syntax is `<requirement>|visible|<value>`, `<requirement>|text|<value>` or `<requirement>|url|<value>`; the generator does not infer the value. The output includes the approval store ID.

```powershell
node scripts/approve-tests.js approve --store "<store-id>" --id "<test-case-id>" --reviewer "human" --comment "Reviewed"
node scripts/approve-tests.js ready --store "<store-id>"
```
Human review is required. Only approved cases can become `READY_FOR_AUTOMATION`; editing invalidates approval and returns a case to `PENDING_APPROVAL`.

```powershell
node scripts/run-approved.js --store "<store-id>" --run-id "<run-id>"
```
Generate and execute eligible ready cases; record classified failures, evidence and eligible healing in `reports/<run-id>/approved-run-result.json`. Cases missing evidence or assertions remain blocked.

```powershell
node scripts/report-final.js --run-id "<run-id>"
```
Aggregate the approved-run output into `reports/<run-id>/final-report.json` and `reports/<run-id>/qa-report.pdf`.

```powershell
node scripts/defect-dry-run.js --run-id "<run-id>" --test-case "<test-case-id>"
```
Write a dry-run defect plan without creating a Jira issue. The separate `run-approved` path also routes eligible category-A failures to a dry-run result.

```powershell
npm run smoke
npm run regression
```
Run the smoke and regression suites. Neither takes path arguments.

`npm run smoke` reads the explicit list in `qa.config.json`. Smoke flows are never inferred: if the file is missing, malformed, lists no tests, or every declared test is absent from disk, the suite reports **`SKIPPED_NOT_CONFIGURED`** — never a pass. Each run writes `reports/<run-id>/smoke-report.json`.

`npm run regression` derives its selection from evidence rather than a filesystem scan. A spec is included only when it is `READY_FOR_AUTOMATION` in an approval store **and** its last recorded per-test result was `PASS` **and** that result came from source `playwright-json`. Results from `exit-code-fallback` or `playwright-json-no-tests` are rejected outright, because they carry no per-test outcome. Every candidate is written to `reports/<run-id>/regression-selection.json` with an explicit include or exclude reason, and results to `reports/<run-id>/regression-report.json`.

To attach both suites to one report, run them under the same run id and then aggregate:

```powershell
node scripts/smoke.js --run-id "<run-id>"
node scripts/regression.js --run-id "<run-id>"
node scripts/report-final.js --run-id "<run-id>"
```

`report-final` picks up `smoke-report.json` and `regression-report.json` automatically. `BLOCKED`, `SKIPPED` and `SKIPPED_NOT_CONFIGURED` are never rendered as a pass in the JSON or the PDF.

```powershell
npm run demo-site
npm run typecheck
npm run lint
```
Serve the local fixture site; run TypeScript validation; run the targeted forbidden-pattern check. The fixture's scripted approval helper is demo-only, not a production approval path.

### Run the demo

```powershell
npm run demo
```

One command, no flags. Runs the full chain against `fixtures/demo-site`: starts the fixture server, explores it, generates four test cases, runs a scripted `DEMO ONLY` approval (`scripts/demo.js` only -- this never runs in the production pipeline; `src/qa-pipeline.ts` still stops at the human approval gate), executes them, heals, classifies, runs smoke and regression, aggregates the final JSON report and PDF, and prints a console summary table (case, status, category, healing outcome, defect dry-run). No real Jira issue is ever created.

The demo produces, on every run, by design:

| Case | What it proves |
| --- | --- |
| `TC-DEMO-PASS` | A genuinely passing case -- correct selector, no healing. |
| `TC-DEMO-HEAL` | A stale locator (`"Old Login"`) that same-page healing repairs to `PASS_AFTER_HEALING`. |
| `TC-DEMO-REMOVED` | An observed-but-absent element: healing is attempted (the element was "seen" with a verified role/name) and correctly fails live validation (`NOT_HEALED`); the case stays `FAIL` and surfaces in `Needs human review`. |
| `TC-DEMO-DEFECT` | A real assertion mismatch (the heading says "Welcome back", the case expects "Wrong heading") -- classified **A**, shown as `WOULD_CREATE` in the Jira dry-run. |

Each run gets a fresh timestamped approval-store ID, so spec and POM paths (`tests/generated/Demo__<storeId>/...`) never collide between runs -- running `npm run demo` twice produces the same four outcomes and leaves no generated spec or POM behind: the demo removes its own scoped `tests/generated/Demo__<storeId>/` and `pages/Demo__<storeId>/` directories when it finishes, so nothing it generates is ever left in normal test collection.

## 4. Test suites

```powershell
npx playwright test tests/unit          # 238 passed, 0 failed, 0 skipped
npx playwright test tests/integration   #  30 passed
```

The **unit** suite is pure and fast and requires no prior artifacts; it includes 16 JSON-reporter parser tests, 29 failure-classifier tests, 13 fail-closed healing tests (locator healing plus `validateObservedCandidate`'s `isEnabled()` fail-closed contract), 14 final-report tests (JSON-level aggregation and the raw-data secret-scan contract; the PDF-generation tests now live in the integration suite below), 5 report-html tests (`src/report-html.ts`'s HTML renderer: every section heading, zero-filled A-E categories, BLOCKED never rendering as PASS, healing-log fields, no truncation), 6 CLI-argument tests, 12 spec/POM namespacing and content-fingerprint tests, and 22 Phase 6 smoke/regression contract tests (including a check that the repository's own `qa.config.json` has no declared-but-absent smoke path).

The **integration** suite drives real Playwright runs and the local fixture server:

| File | Covers |
| --- | --- |
| `approved-run-healing.spec.ts` (3) | same-page healing → `PASS_AFTER_HEALING`; a real assertion failure → Jira dry-run defect; a removed element → `NOT_HEALED` + human review |
| `capture-artifacts.spec.ts` (3) | default artifact capture runs a real spec; `captureArtifacts: false` path; two concurrent nested runs sharing a runId get isolated `--output` directories |
| `json-reporter-attribution.spec.ts` (2) | real per-test `PASS`/`FAIL`/`SKIPPED` attribution instead of the exit-code fallback; a missing test path is `playwright-json-no-tests`, not a fallback pass |
| `jira-defect-dry-run.spec.ts` (1) | a category-A fixture produces a dry-run plan with no network mutation |
| `qa-pipeline-e2e.spec.ts` (1) | the `qa` pipeline store carries its exploration, so `run-approved` reaches execution |
| `config-resolution.spec.ts` (4) | `--config` resolves from the repo root, so an explicit foreign cwd still gets the config's video/screenshot settings |
| `phase6-suites.spec.ts` (5) | smoke config resolves to real specs on disk; regression selection over real repository state; fallback-sourced results never establish a baseline; an empty selection is not configured, not a pass; the final report merges both suite sections |
| `report-pdf-html.spec.ts` (8) | every section heading survives real PDF text extraction; a >5000-character report is not truncated; a very long single value wraps instead of clipping; BLOCKED/SKIPPED never render as PASS; the planted-fake-secret never reaches the rendered PDF; PDF and JSON render the identical `humanReviewLabel()` sentence for zero signals, a signal attributed to one test, and a run-level signal |
| `demo.spec.ts` (2) | `npm run demo` produces all four required outcomes from real output files; running it twice is idempotent and leaves no generated spec or POM behind |
| `fixtures/selfcheck.spec.ts` (1) | minimal spec used by the artifact-capture tests |

Fixture specs written at test time (deliberately failing) are generated into `tests/integration/fixtures/`, deleted in `afterAll`, gitignored, and guarded by `QA_RUN_GENERATED_FIXTURES` so a leftover from a crashed run is collected but skipped.

## 5. Execution results come from the JSON reporter

`executePlaywright` runs Playwright with `--reporter json` and parses the payload. **Every reported test carries a `source` field** so a synthetic result can never be mistaken for a real one:

| `source` | Meaning |
| --- | --- |
| `playwright-json` | A real per-test result read from `test.results[last]` — with the spec title, the test's own duration, and the failure message. |
| `playwright-json-no-tests` | JSON parsed fine but Playwright executed nothing (for example `No tests found.`). Carries Playwright's own top-level error. |
| `exit-code-fallback` | The JSON could not be parsed at all, so only the process exit code is known. Labelled explicitly, never presented as a per-test result. |

Per-test results include `title`, `status` (`PASS` / `FAIL` / `BLOCKED` / `SKIPPED`), `durationMs`, `error`, `source` and a `diagnosis`.

## 6. Failure classification

`src/failure-classifier.ts` classifies from the **real per-test error text** and the reporter's own attempt status.

- **A — real application defect** requires *positive evidence*: Playwright reported an `Expected:` / `Received:` diff, meaning a value was compared against a requirement after the locator resolved. A is the only `bugEligible` category.
- **B — automation / test implementation issue**: CLI or tooling invocation failures (unknown option, process failed to start, `No tests found`) and locator problems (`LOCATOR_NOT_FOUND`, strict-mode violation, `<element(s) not found>`). A removed element lands here because no assertion was ever compared.
- **C — environment / infrastructure**: browser executable missing, interrupted runs, HTTP ≥ 500 without a transient marker.
- **D — flaky / transient**: a `timedOut` attempt or transient timing markers. Retryable.
- **E — blocked / missing requirement**: only from a blocked/failed exploration or an explicit missing-requirement, credentials or authentication statement.

**Unrecognized failures default to B and are never Jira-eligible.** They are labelled *"unclassified, needs human review"*.

`timedOut` and `interrupted` are reported as **FAIL**, not BLOCKED: in both cases the test executed against a reachable target and did not pass. BLOCKED is reserved for genuine no-verdict outcomes (zero tests executed, runner categories E/C).

## 7. Needs Human Review in the final report

`reports/<run-id>/final-report.json` contains a `sections.humanReview` section, and the PDF renders the same content immediately after the run summary:

```text
NEEDS HUMAN REVIEW: 2 signal(s) across 1 test(s)
  1. [healing] No candidate passed strict live validation …; HUMAN_REVIEW_REQUIRED
  2. [failure-classification] generated/DemoRemoved/TC-DEMO-REMOVED.spec.ts — … possible real application change …
```

This exists because a removed element is category **B**, which would otherwise be indistinguishable from an ordinary typo'd selector inside the failure-classification buckets. One removed element produces two corroborating signals — the healing `NOT_HEALED` entry and the B classification — so `count` is the number of signals and `distinctTests` the number of affected tests.

## 8. Artifact capture

Screenshot and video are configured in `playwright.config.ts` as `use` options, **not** as CLI flags:

```text
video:      'retain-on-failure'
screenshot: 'only-on-failure'
```

The Playwright CLI exposes only `--trace`; there is no `--video` or `--screenshot` option, and passing them made the runner exit with `unknown option` before executing a single test. Only `--trace retain-on-failure` is passed on the command line.

Because video is retained *only on failure*, a fully passing run produces no `.webm`. Verifying capture therefore requires a deliberately failing run.

There is no hardcoded `baseURL`. Every spec navigates to an absolute URL, which is what the automation generator emits from `explorationResult.target.url`.

## 9. Status table

| Capability | Status |
| --- | --- |
| Website exploration | IMPLEMENTED |
| Test-case generation | IMPLEMENTED |
| Human approval gate | IMPLEMENTED |
| `expectedAssertion`: verified observations | IMPLEMENTED |
| `expectedAssertion`: human-supplied outcomes | IMPLEMENTED |
| `expectedAssertion`: unverifiable outcomes flagged | IMPLEMENTED |
| POM/Playwright spec generation | IMPLEMENTED for eligible ready cases |
| Test execution | IMPLEMENTED for focused approved cases |
| Per-test JSON reporter parsing | IMPLEMENTED, verified against Playwright 1.62.1 |
| Failure classification A–E | IMPLEMENTED; category A requires a verified assertion diff |
| Validated same-page locator healing with re-execution | IMPLEMENTED for eligible locator failures |
| Final JSON report aggregation | IMPLEMENTED for approved-run output |
| Human-review section in JSON and PDF | IMPLEMENTED |
| PDF report | IMPLEMENTED — rendered from HTML (`src/report-html.ts`) via Playwright `page.pdf()`: real tables, no length cut, paginates naturally; verified by rendering a real 7-page demo-fixture report to images |
| Jira defect sink, dry-run | IMPLEMENTED; no real issue created |
| Jira defect sink, real creation | PARTIAL — injected client and explicit opt-in path, not verified against live Jira |
| Smoke test wiring | IMPLEMENTED — `npm run smoke` reads `qa.config.json`; an absent or empty list reports `SKIPPED_NOT_CONFIGURED` |
| Regression test wiring | IMPLEMENTED — `npm run regression` selects `READY_FOR_AUTOMATION` cases whose last per-test result was `PASS` from source `playwright-json` |
| Packaged end-to-end demo script | IMPLEMENTED — `npm run demo`, no flags; produces a passing case, a healed locator, a removed element surfaced for human review, and a category-A defect dry-run, every run, idempotently |

## 10. Known limitations

Verified as still open:

- Two independent defect-deduplication mechanisms exist and can disagree: a SHA-256 `defectFingerprint` plus a Jira JQL `text ~` search in `src/jira-defects.ts`, and an in-memory `Defect.fingerprint` map with `findByFingerprint` in `src/defect-model.ts`. In practice `src/defect-model.ts` has no importer anywhere in `src/` today, so only the `jira-defects.ts` path is ever exercised by a live run — but the second mechanism is live, reachable code, not deleted, so wiring it in later without reconciling the two fingerprint schemes would reintroduce the disagreement.
- Several adapters are genuinely implemented but **not wired into the requirement pipeline**: `src/notion-ingestion.ts`, `src/slack-ingestion.ts`, `src/github-ingestion.ts`, and `src/jira.ts`/`src/jira-helper.ts` all make real HTTP calls and have real tests, but `src/source-adapters.ts` unconditionally stubs jira/notion/slack/github to `UNAVAILABLE` regardless of configuration, and none of `src/requirement-sources.ts` or `src/qa-pipeline.ts` calls the real adapters. They are reachable only via standalone `scripts/ingest-notion.js` / `scripts/ingest-slack.js` / `scripts/ingest-github.js`, which are undocumented here and untested as pipeline stages.
- Regression and smoke specs that target a live application require that target to be running; `tests/generated/**` specs generally point at the local demo fixture on a specific port, and the port is recorded in the generated file rather than configuration.
- `npm run lint` is a targeted check for `waitForTimeout`, `nth()` and XPath, **not** ESLint with TypeScript coverage.
- The PDF's Results table renders a captured error's raw text verbatim, including any ANSI color-code escape sequences from Playwright's terminal output (e.g. a literal `\u001b[2m`/`\u001b[22m` run around `expect(...)`); these are not stripped before HTML rendering, so that cell can read as garbled text instead of a clean message. Verified visually on a real 7-page demo-fixture report.
- Jira real creation is off by default and requires an explicitly supplied Jira client plus `createReal: true` passed to `createDefect()` in `src/jira-defects.ts`; no live creation was verified, and there is no CLI flag for it today.
- Evidence paths are checked; a missing artifact is reported as missing, not as proof of a passing run.
- `DefectResult` (`src/jira-defects.ts`) carries no field that attributes a dry-run defect back to the test case that produced it; it is fingerprinted from the failure's own text, not keyed by `testCaseId`. Any caller matching a defect to a case (as `scripts/demo.js`'s summary table does) has to do so by other means -- in the demo's case, by knowing only one case is category A.
- The generated spec's healing wrapper (`src/automation-generator.ts`'s `renderSpec`) triggers on any error message containing the word "locator" -- which Playwright's own call log includes for essentially every role-based assertion failure, including a genuine `Expected`/`Received` text mismatch where the locator resolved fine. A healing attempt is harmlessly made and rejected in that case (observed on `npm run demo`'s category-A case), and the final classification is unaffected because the failure classifier reads the original error text independently -- but the healing log can show an entry for a failure that was never a locator problem.
- `AGENTS.md` describes an earlier Jira-ticket-centric workflow that this pipeline no longer implements (dynamic Jira scope discovery, a per-ticket lifecycle, `<ISSUE-KEY>.spec.ts` naming, a per-ticket authentication summary block). It now carries a SUPERSEDED banner pointing here and to `CLAUDE.md`, but the body text itself is kept as historical record and was not rewritten.

Now fixed and no longer listed: unsupported `--video`/`--screenshot` CLI flags; exit-code-fallback per-test attribution; Playwright 1.62 reporter parsing; category-A false positives from locator failures; unrecognized failures defaulting to Jira-eligible; the `qa` pipeline losing its exploration result; the hardcoded `baseURL`; `--config` no longer being gated on `storageState`; `healLocator` and `validatedHeal` no longer failing open without a validator; the fabricated `unique`/`visible`/`enabled` ranking flags; the unused `healLocator` import in `scripts/heal.js`; generated specs and Page Objects being keyed by module name alone (now namespaced per approval store, and content-fingerprinted so a regenerated file can never silently inherit an older PASS baseline); the integration suite flaking under default parallel workers (nested Playwright runs now each get a private, salted `--output` directory instead of sharing Playwright's default `test-results/`, which it wipes at startup); `src/final-report.ts`'s secret scan running on text that had already been sanitized, which meant it could never find a real secret in the raw run data (it now scans the raw data first and reports `MASKED <n>` or `FAIL` rather than always `PASS`); `src/healing-runtime.ts`'s `validateObservedCandidate` treating a thrown `isEnabled()` as `enabled: true` instead of failing closed; `scripts/report-pdf.js` rebuilding the `NEEDS HUMAN REVIEW` sentence by hand instead of calling `humanReviewLabel()` (it read "N finding(s) across 0 failing test(s)" for a run-level finding); and `scripts/report-pdf.js`'s `makePdf()` joining every report line onto one text row, which ran off the page's right edge after roughly 100 characters and made nearly the entire report invisible both on screen and to text extraction, despite being present in the PDF's raw bytes; and (replacing that hand-rolled single-content-stream PDF entirely) the hand-rolled renderer's 5000-character truncation and lack of line wrapping -- the PDF is now rendered from real HTML via Playwright `page.pdf()` with no length cut and natural pagination, verified by rendering a real 7-page demo-fixture report to images; and no packaged end-to-end demo script existing (`npm run demo` now runs the full chain against the local fixture and produces all four required outcomes -- a pass, a healed locator, a removed element surfaced for human review, and a category-A defect dry-run -- idempotently, every run).

## 11. Architecture overview

- `src/qa-pipeline.ts` — normalizes requirements, explores, generates cases, stops at the approval gate. Carries the exploration into the approval store so `run-approved` can execute.
- `src/approval-store.ts` — persists cases and enforces approval states.
- `src/test-case-generator.ts` — creates cases, assertions, provenance, flags and coverage counts.
- `src/automation-generator.ts` — generates TypeScript Page Objects and Playwright specs from eligible ready cases.
- `src/execution-engine.ts` — builds the Playwright CLI arguments, parses the JSON reporter into per-test results, and captures evidence metadata.
- `src/failure-classifier.ts` — classifies a real per-test error into A–E.
- `src/validated-healing.ts` — bounds and validates candidate locator repairs.
- `src/healing-runtime.ts` — validates and re-runs repairs in the original Playwright page context.
- `src/approved-runner.ts` — connects approved cases to generation, execution, healing and defect dry-runs.
- `src/final-report.ts` — aggregates run data, collects human-review cases, verifies evidence paths, saves sanitized JSON.
- `src/report-html.ts` — renders the same `FinalReport` object as HTML (real tables, no length cut); `scripts/report-pdf.js` turns it into a PDF with Playwright's `page.pdf()`.
- `src/jira-defects.ts` — optional defect fingerprints, dry-run and injected Jira client operations.
- `scripts/demo.js` — `npm run demo`: runs the full chain against `fixtures/demo-site` and produces a pass, a healed locator, a removed element, and a category-A defect dry-run in one idempotent run. The DEMO ONLY scripted approval lives only here, never in the production pipeline.

---

## Project History

The original Jira/JPA workflow below is historical and superseded by the verified status table above.

### Project Workflow

```text
Jira Ticket
  ↓
Read Jira Task
  ↓
Move Ticket to In Progress
  ↓
Inspect Website using Playwright MCP
  ↓
Find and Verify Real Selectors
  ↓
Generate Playwright Test
  ↓
Run Test
  ↓
Fix Test if Failed
  ↓
Append Test Result to Jira
  ↓
Move Ticket to Done
```

### Environment Variables

Jira credentials are stored in a local `.env` file and are never hardcoded in source code:

```text
JIRA_BASE_URL=https://your-site.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
```

`.env` is in `.gitignore` and is not uploaded. Optional integrations report `AVAILABLE` only when their configuration is present; otherwise they remain `UNAVAILABLE` and do not block the core engine.

### Jira API Integration

`src/jira.ts` provides `getTodoTasks(projectKey)`, `getTaskDescription(issueKey)`, `moveTask(issueKey, transitionName)` and `updateDescription(issueKey, appendText)`. The description update is append-only and never overwrites the original requirement.

### AGENTS.md

`AGENTS.md` is the authoritative QA automation workflow specification for the agent: dynamic Jira scope discovery, priority ordering, dependency graphs, per-ticket isolation, expected-vs-actual validation, the A–E failure taxonomy, controlled retries, evidence rules and the final report format.

### Playwright MCP

Playwright MCP lets the agent open pages, inspect the DOM, find elements, verify selectors, click and type against the real site before any test is generated. Selectors are verified against the live application first.

### Generated Tests

Generated specs live in `tests/generated/` (UI) and `tests/api/` (API) and use role-based locators. XPath is not used.

### JPA-1 Demonstration

JPA-1 exercised YouTube search: open the homepage, locate the search input, enter a query, submit, verify the results URL, page title and result content. Result: 1 passed, then the Jira ticket moved to Done.

### JPA-2 Real-World Failure Handling

During JPA-2 the YouTube homepage exposed no video links in the Playwright browser session. The agent did not invent a selector or a false test; it reported the workflow as blocked. This is the intended behaviour — the live application state is validated before automation is generated.

### Running the Project

```powershell
npm ci
npx playwright install chromium
npx playwright test tests/generated/JPA-1.spec.ts   # a single focused spec
npx playwright test                                   # all collected specs
```

If exploration or execution reports `PLAYWRIGHT_BROWSER_NOT_INSTALLED`, run `npx playwright install` and retry. That is an environment/infrastructure block (category C), not an application defect.

### Generic Requirements and Optional Integrations

```powershell
node scripts/qa.js --url "https://example.com" --module "Authentication" --scope "Login" --requirement "User can log in"
node scripts/qa.js --url "https://example.com" --module "Authentication" --scope "Login" --spec "./specs/auth.md"
```

Supported local source extensions are Markdown/TXT, JSON, YAML and PDF; PDF extraction preserves page provenance. Jira remains an optional adapter and must not be required for local or offline QA workflows.

The core architecture is:

```text
Requirement providers → normalized requirements → exploration → test cases
→ human approval → READY_FOR_AUTOMATION → POM/spec generation → Playwright execution
→ per-test result parsing → classification → healing decision → evidence
→ final report → optional PDF
```

### Security

Never commit `.env`. `.gitignore` protects `node_modules/`, `.env`, `playwright-report/`, `test-results/`, generated module folders under `tests/generated/` and test-time generated fixtures.

### Future Improvements

- Add production adapters for Jira, Notion, Slack and GitHub behind generic interfaces.
- Expand rich PDF rendering and final report aggregation.
- Add configured smoke metadata and full offline end-to-end fixtures.