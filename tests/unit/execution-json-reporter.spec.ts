import { test, expect } from "@playwright/test";
import { parsePlaywrightJson, classifyReporterOutcome, buildExecutionTests } from "../../src/execution-engine";

// Fixtures below reproduce the exact Playwright 1.62.1 JSON reporter shape
// captured from a real run (pass + fail + skip in one invocation):
//   * specs live at suites[].specs[] for a flat spec, and one level deeper at
//     suites[].suites[].specs[] when the spec calls test.describe()
//   * test.status is the EXPECTATION resolution ("expected"/"unexpected"/
//     "skipped"), never the outcome
//   * the outcome, duration and errors live in test.results[last]
const flatPass = {
  config: { version: "1.62.1" },
  suites: [
    {
      title: "probe-json.spec.ts",
      file: "probe-json.spec.ts",
      specs: [
        {
          title: "probe passing case",
          ok: true,
          file: "probe-json.spec.ts",
          tests: [{ status: "expected", expectedStatus: "passed", results: [{ status: "passed", duration: 791, errors: [] }] }],
        },
      ],
    },
  ],
  errors: [],
  stats: { duration: 12995.002, expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
};

const flatFail = {
  suites: [
    {
      title: "probe-json.spec.ts",
      file: "probe-json.spec.ts",
      specs: [
        {
          title: "probe failing case",
          ok: false,
          file: "probe-json.spec.ts",
          tests: [
            {
              status: "unexpected",
              expectedStatus: "passed",
              results: [
                {
                  status: "failed",
                  duration: 7070,
                  errors: [{ message: "Error: expect(locator).toHaveText(expected) failed", location: { file: "probe-json.spec.ts", line: 14, column: 7 } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
  stats: { duration: 7070, expected: 0, skipped: 0, unexpected: 1, flaky: 0 },
};

const flatSkip = {
  suites: [
    {
      title: "probe-json.spec.ts",
      file: "probe-json.spec.ts",
      specs: [
        {
          title: "probe skipped case",
          ok: true,
          file: "probe-json.spec.ts",
          tests: [{ status: "skipped", expectedStatus: "skipped", results: [{ status: "skipped", duration: 11, errors: [] }] }],
        },
      ],
    },
  ],
  errors: [],
  stats: { duration: 11, expected: 0, skipped: 1, unexpected: 0, flaky: 0 },
};

// Mirrors tests/generated/Auth/TC-AUTH-001.spec.ts: a test.describe() wrapper
// pushes the real spec down one level, leaving the outermost suite empty.
const nestedPass = {
  suites: [
    {
      title: "generated\\Auth\\TC-AUTH-001.spec.ts",
      file: "generated/Auth/TC-AUTH-001.spec.ts",
      specs: [],
      suites: [
        {
          title: "Auth",
          specs: [
            {
              title: "TC-AUTH-001: [Positive] Welcome heading is displayed on the page",
              ok: true,
              file: "generated/Auth/TC-AUTH-001.spec.ts",
              tests: [{ status: "expected", expectedStatus: "passed", results: [{ status: "passed", duration: 1771, errors: [] }] }],
            },
          ],
        },
      ],
    },
  ],
  errors: [],
  stats: { duration: 6990.015, expected: 1, skipped: 0, unexpected: 0, flaky: 0 },
};

test("a passing spec yields a real per-test result from test.results[], not test.status", () => {
  const parsed = parsePlaywrightJson(JSON.stringify(flatPass));
  expect(parsed.ok).toBe(true);
  expect(parsed.tests).toHaveLength(1);
  const only = parsed.tests[0];
  expect(only.title).toBe("probe passing case");
  expect(only.path).toBe("probe-json.spec.ts");
  expect(only.status).toBe("PASS");
  // The test's own duration, not the 12995ms wall-clock in stats.duration.
  expect(only.durationMs).toBe(791);
  expect(only.error).toBeUndefined();
});

test("test.status 'expected' is never mistaken for the outcome", () => {
  // Guards the original defect directly: the old parser mapped the
  // expectation resolution "expected" through its else-branch to FAIL.
  const parsed = parsePlaywrightJson(JSON.stringify(flatPass));
  expect(parsed.tests[0].status).not.toBe("FAIL");
});

test("a failing spec reports FAIL and attributes the error message to that test", () => {
  const parsed = parsePlaywrightJson(JSON.stringify(flatFail));
  expect(parsed.tests).toHaveLength(1);
  const only = parsed.tests[0];
  expect(only.status).toBe("FAIL");
  expect(only.title).toBe("probe failing case");
  expect(only.durationMs).toBe(7070);
  expect(only.error).toContain("expect(locator).toHaveText(expected) failed");
  expect(only.error).toContain("probe-json.spec.ts:14:7");
});

test("a skipped test is SKIPPED, never PASS", () => {
  const parsed = parsePlaywrightJson(JSON.stringify(flatSkip));
  expect(parsed.tests).toHaveLength(1);
  expect(parsed.tests[0].status).toBe("SKIPPED");
  expect(parsed.tests[0].status).not.toBe("PASS");
});

test("nested suites are walked so test.describe() specs are found", () => {
  const parsed = parsePlaywrightJson(JSON.stringify(nestedPass));
  expect(parsed.ok).toBe(true);
  expect(parsed.tests).toHaveLength(1);
  expect(parsed.tests[0].title).toBe("TC-AUTH-001: [Positive] Welcome heading is displayed on the page");
  expect(parsed.tests[0].status).toBe("PASS");
  expect(parsed.tests[0].durationMs).toBe(1771);
});

test("malformed JSON is reported as unparseable so callers fall back", () => {
  const parsed = parsePlaywrightJson("{ this is not json at all");
  expect(parsed.ok).toBe(false);
  expect(parsed.reason).toContain("not valid JSON");
  expect(parsed.tests).toHaveLength(0);
});

test("empty stdout is reported as unparseable", () => {
  const parsed = parsePlaywrightJson("");
  expect(parsed.ok).toBe(false);
  expect(parsed.tests).toHaveLength(0);
});

test("valid JSON with no tests keeps top-level errors instead of inventing a verdict", () => {
  // What Playwright emits for a missing test path.
  const parsed = parsePlaywrightJson(JSON.stringify({ suites: [], errors: [{ message: "Error: No tests found." }], stats: { duration: 65.58 } }));
  expect(parsed.ok).toBe(true);
  expect(parsed.tests).toHaveLength(0);
  expect(parsed.topLevelErrors).toHaveLength(1);
  expect(parsed.topLevelErrors[0]).toContain("No tests found.");
  expect(parsed.totalDurationMs).toBe(66);
});

test("all three specs in one run are reported separately", () => {
  const combined = {
    suites: [
      {
        title: "probe-json.spec.ts",
        file: "probe-json.spec.ts",
        specs: [
          { ...flatPass.suites[0].specs[0] },
          { ...flatFail.suites[0].specs[0] },
          { ...flatSkip.suites[0].specs[0] },
        ],
      },
    ],
  };
  const parsed = parsePlaywrightJson(JSON.stringify(combined));
  expect(parsed.tests.map((item) => [item.title, item.status])).toEqual([
    ["probe passing case", "PASS"],
    ["probe failing case", "FAIL"],
    ["probe skipped case", "SKIPPED"],
  ]);
});

test("outcome classification never maps skipped or interrupted to PASS", () => {
  expect(classifyReporterOutcome("skipped", "passed")).toBe("SKIPPED");
  // A timeout and an interruption both mean the test executed and did not
  // pass, so both are FAIL -- not BLOCKED, which is reserved for no-verdict
  // outcomes (zero tests executed, runner categories E/C).
  expect(classifyReporterOutcome("timedOut", "passed")).toBe("FAIL");
  expect(classifyReporterOutcome("interrupted", "passed")).toBe("FAIL");
  expect(classifyReporterOutcome("", "passed")).toBe("FAIL");
  expect(classifyReporterOutcome("some-future-status", "passed")).toBe("FAIL");
});

test("test.fail() semantics: an expected failure is a PASS and an unexpected success is a FAIL", () => {
  // A test declared test.fail() is a PASS when the assertion fails as intended.
  expect(classifyReporterOutcome("failed", "failed")).toBe("PASS");
  // ...and a FAIL when the code under test unexpectedly succeeds.
  expect(classifyReporterOutcome("passed", "failed")).toBe("FAIL");
});

test("the last retry attempt determines the outcome", () => {
  const retried = {
    suites: [
      {
        title: "r.spec.ts",
        file: "r.spec.ts",
        specs: [
          {
            title: "flaky then green",
            ok: true,
            file: "r.spec.ts",
            tests: [
              {
                status: "flaky",
                expectedStatus: "passed",
                results: [
                  { status: "failed", duration: 100, errors: [{ message: "first attempt failed" }], retry: 0 },
                  { status: "passed", duration: 120, errors: [], retry: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  const parsed = parsePlaywrightJson(JSON.stringify(retried));
  expect(parsed.tests[0].status).toBe("PASS");
  expect(parsed.tests[0].durationMs).toBe(120);
  expect(parsed.tests[0].error).toBeUndefined();
});

test("a test with no attempt entry is never reported as PASS", () => {
  const noAttempt = {
    suites: [{ title: "s.spec.ts", file: "s.spec.ts", specs: [{ title: "never ran", ok: false, file: "s.spec.ts", tests: [{ status: "expected", expectedStatus: "passed", results: [] }] }] }],
  };
  const parsed = parsePlaywrightJson(JSON.stringify(noAttempt));
  expect(parsed.tests[0].status).toBe("BLOCKED");
  expect(parsed.tests[0].durationMs).toBe(0);
});
test("malformed JSON produces an exit-code fallback that is labelled as a fallback", () => {
  const malformed = "{ truncated, not json";
  const built = buildExecutionTests({
    parsedJson: parsePlaywrightJson(malformed),
    testPaths: ["tests/whatever.spec.ts"],
    wallClockMs: 4321,
    exitCodeStatus: "FAIL",
    stdout: malformed,
    stderr: "",
  });
  expect(built).toHaveLength(1);
  expect(built[0].source).toBe("exit-code-fallback");
  // Never mistakable for a real per-test result: no fabricated spec title and
  // the reason is stated on the record itself.
  expect(built[0].title).toBe("(runner output could not be parsed)");
  expect(built[0].error).toContain("exit-code fallback");
  expect(built[0].error).toContain("not valid JSON");
  expect(built[0].durationMs).toBe(4321);
});

test("parseable JSON never yields the exit-code fallback", () => {
  const built = buildExecutionTests({
    parsedJson: parsePlaywrightJson(JSON.stringify(flatPass)),
    testPaths: ["tests/whatever.spec.ts"],
    wallClockMs: 9999,
    exitCodeStatus: "PASS",
    stdout: "",
    stderr: "",
  });
  expect(built).toHaveLength(1);
  expect(built[0].source).toBe("playwright-json");
  expect(built[0].source).not.toBe("exit-code-fallback");
  // Per-test duration, not the wall-clock that was passed in.
  expect(built[0].durationMs).toBe(791);
});

test("valid JSON with zero tests is labelled no-tests rather than fallback", () => {
  const built = buildExecutionTests({
    parsedJson: parsePlaywrightJson(JSON.stringify({ suites: [], errors: [{ message: "Error: No tests found." }] })),
    testPaths: ["tests/whatever.spec.ts"],
    wallClockMs: 9999,
    exitCodeStatus: "FAIL",
    stdout: "",
    stderr: "",
  });
  expect(built[0].source).toBe("playwright-json-no-tests");
  expect(built[0].source).not.toBe("exit-code-fallback");
  expect(built[0].error).toContain("No tests found.");
});
