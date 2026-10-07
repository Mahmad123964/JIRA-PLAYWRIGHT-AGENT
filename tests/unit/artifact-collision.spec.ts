import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { generateAutomation } from "../../src/automation-generator";
import { fingerprintSpec, compareFingerprint, sha256File, pomImportFromSpec } from "../../src/artifact-fingerprint";
import { buildLastKnownResults, selectRegressionSpecs, type StoredRun } from "../../src/regression-selection";
import type { ExplorationResult } from "../../src/browser-explorer";
import type { TestCase } from "../../src/test-case-generator";

/**
 * Phase 6b contracts:
 *   (a) two cases / two runs in one module never overwrite each other's files;
 *   (b) a spec and the POM it imports always come from the same generation and
 *       the same target URL;
 *   (c) a regenerated file can never silently inherit an older PASS baseline.
 */

function exploration(url: string): ExplorationResult {
  return {
    target: { url, module: "Auth", scope: "Login", requirements: ["Login works"] },
    status: "SUCCESS",
    explorationStatus: "SUCCESS",
    exploredAt: new Date().toISOString(),
    pagesVisited: [url],
    elements: [{ id: "E-1", type: "button", role: "button", name: "Login", dataTestId: "login", selectorCandidates: ["getByRole('button', { name: 'Login' })"], url, source: "browser-exploration" }],
    workflows: [],
    observations: [],
    requirementsCoverage: [],
    warnings: [],
    provenance: [],
    secretsMaskedCount: 0,
    promptInjectionDetected: false,
  };
}

function testCase(id: string): TestCase {
  return {
    testCaseId: id,
    title: "Login",
    objective: "Login",
    preconditions: [],
    testData: "valid",
    steps: [{ step: 1, action: "Click Login", expected: "Login control is visible", selectorHint: "getByRole('button', { name: 'Login' })", expectedAssertion: { type: "visible" } }],
    expectedResult: "Login works",
    priority: "High",
    testType: "Functional",
    module: "Auth",
    sourceRequirements: ["Login works"],
    explorationReferences: [],
    assumptions: [],
    risks: [],
    status: "READY_FOR_AUTOMATION",
    automationEligibility: "ELIGIBLE",
    sources: [{ type: "requirement", requirement: "Login works" }],
    generatedAt: new Date().toISOString(),
  } as unknown as TestCase;
}

let root: string;
test.beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-6b-")); });
test.afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

test.describe("(a) same module, two runs cannot clobber each other", () => {
  test("two runs of module Auth in the same root write different files", () => {
    const first = generateAutomation({ testCases: [testCase("TC-1")], explorationResult: exploration("http://127.0.0.1:4173/"), outputRoot: root, artifactScope: "store-one" });
    const firstSpec = first.generated.find((file) => file.kind === "spec")!;
    const firstBody = fs.readFileSync(firstSpec.path, "utf8");

    const second = generateAutomation({ testCases: [testCase("TC-1")], explorationResult: exploration("http://127.0.0.1:4193/"), outputRoot: root, artifactScope: "store-two" });
    const secondSpec = second.generated.find((file) => file.kind === "spec")!;
    const secondBody = fs.readFileSync(secondSpec.path, "utf8");

    // Different paths, and the first run's content is untouched.
    expect(firstSpec.path).not.toBe(secondSpec.path);
    expect(fs.readFileSync(firstSpec.path, "utf8")).toBe(firstBody);
    expect(firstBody).not.toBe(secondBody);
    expect(firstSpec.path).toContain("Auth__store-one");
    expect(secondSpec.path).toContain("Auth__store-two");
  });

  test("two cases in one run get their own spec and share the run's POM", () => {
    const result = generateAutomation({ testCases: [testCase("TC-A"), testCase("TC-B")], explorationResult: exploration("http://127.0.0.1:4173/"), outputRoot: root, artifactScope: "store-one" });
    const specs = result.generated.filter((file) => file.kind === "spec");
    const poms = result.generated.filter((file) => file.kind === "pom");
    expect(specs).toHaveLength(2);
    expect(poms).toHaveLength(1);
    expect(new Set(specs.map((file) => file.path)).size).toBe(2);
    // Both specs import the SAME pom file, from this run's directory.
    for (const spec of specs) {
      const imported = pomImportFromSpec(fs.readFileSync(spec.path, "utf8"));
      expect(imported).toBeDefined();
      const resolved = path.resolve(path.dirname(spec.path), `${imported}.ts`);
      expect(resolved).toBe(poms[0].path);
    }
  });

  test("without a scope the module directory is shared (legacy behaviour)", () => {
    const result = generateAutomation({ testCases: [testCase("TC-A")], explorationResult: exploration("http://127.0.0.1:4173/"), outputRoot: root });
    expect(result.generated.find((file) => file.kind === "spec")!.path).toContain(path.join("tests", "generated", "Auth"));
  });
});

test.describe("(b) spec and POM always share one exploration and target", () => {
  test("the POM navigates to the target the spec was generated against", () => {
    const target = "http://127.0.0.1:4193/";
    const result = generateAutomation({ testCases: [testCase("TC-A")], explorationResult: exploration(target), outputRoot: root, artifactScope: "store-one" });
    const pom = result.generated.find((file) => file.kind === "pom")!;
    const spec = result.generated.find((file) => file.kind === "spec")!;
    expect(fs.readFileSync(pom.path, "utf8")).toContain(target);
    // The spec records the same target, so a mismatch is detectable.
    expect(spec.targetUrl).toBe(target);
    expect(pom.targetUrl).toBe(target);
    expect(fs.readFileSync(spec.path, "utf8")).toContain("4193");
  });

  test("two scopes with different targets keep their own POM content", () => {
    const one = generateAutomation({ testCases: [testCase("TC-A")], explorationResult: exploration("http://127.0.0.1:4173/"), outputRoot: root, artifactScope: "store-one" });
    const two = generateAutomation({ testCases: [testCase("TC-A")], explorationResult: exploration("http://127.0.0.1:4193/"), outputRoot: root, artifactScope: "store-two" });
    const pomOne = one.generated.find((file) => file.kind === "pom")!;
    const pomTwo = two.generated.find((file) => file.kind === "pom")!;
    expect(fs.readFileSync(pomOne.path, "utf8")).toContain("4173");
    expect(fs.readFileSync(pomTwo.path, "utf8")).toContain("4193");
  });
});

test.describe("(c) content fingerprints detect drift", () => {
  function generate(): { spec: string; pom: string } {
    const result = generateAutomation({ testCases: [testCase("TC-A")], explorationResult: exploration("http://127.0.0.1:4173/"), outputRoot: root, artifactScope: "store-one" });
    return {
      spec: result.generated.find((file) => file.kind === "spec")!.path,
      pom: result.generated.find((file) => file.kind === "pom")!.path,
    };
  }

  test("an unchanged spec and POM compare as ok", () => {
    const paths = generate();
    const fingerprint = fingerprintSpec(root, paths.spec);
    expect(fingerprint.specSha256).toBe(sha256File(paths.spec));
    expect(fingerprint.pomSha256).toBeTruthy();
    expect(compareFingerprint(fingerprint, root).status).toBe("ok");
  });

  test("a rewritten spec is reported as changed", () => {
    const paths = generate();
    const fingerprint = fingerprintSpec(root, paths.spec);
    fs.appendFileSync(paths.spec, "\n// regenerated by a later run\n", "utf8");
    const comparison = compareFingerprint(fingerprint, root);
    expect(comparison.status).toBe("changed");
    expect(comparison.reason).toContain("file changed since baseline");
  });

  test("a rewritten POM is reported as changed", () => {
    const paths = generate();
    const fingerprint = fingerprintSpec(root, paths.spec);
    fs.appendFileSync(paths.pom, "\n// regenerated\n", "utf8");
    const comparison = compareFingerprint(fingerprint, root);
    expect(comparison.status).toBe("changed");
    expect(comparison.reason).toContain("Page Object");
  });

  test("a deleted spec is reported as missing", () => {
    const paths = generate();
    const fingerprint = fingerprintSpec(root, paths.spec);
    fs.rmSync(paths.spec, { force: true });
    expect(compareFingerprint(fingerprint, root).status).toBe("missing");
  });

  test("a missing fingerprint is never treated as a match", () => {
    expect(compareFingerprint(undefined, root).status).toBe("changed");
  });
});

test.describe("regression selection honours the fingerprint", () => {
  function storedRun(fingerprintSpecPath: string, fingerprintSpecHash?: string, fingerprintPomHash?: string): StoredRun {
    const fingerprint = { specPath: fingerprintSpecPath, specSha256: fingerprintSpecHash, pomSha256: fingerprintPomHash };
    return {
      runId: "baseline-run",
      timestamp: "2026-01-01T00:00:00.000Z",
      fingerprints: [fingerprint],
      automation: { generated: [{ kind: "spec", testCaseId: "TC-A", path: `/repo/${fingerprintSpecPath}` }] },
      execution: { tests: [{ path: fingerprintSpecPath.replace(/^tests\//, ""), status: "PASS", source: "playwright-json" }] },
    };
  }

  // Generated specs are namespaced per approval store (artifactScope), e.g.
  // tests/generated/Auth__store-one/TC-A.spec.ts, not the bare module name --
  // the approval index must key on the SAME namespaced path the generator
  // actually produced, or every candidate is rejected before the fingerprint
  // comparison ever runs ("no approval store lists this spec as
  // READY_FOR_AUTOMATION").
  function approved(relativeSpec: string): Map<string, { storeId: string; testCaseId: string; status: string }> {
    return new Map([[relativeSpec, { storeId: "store-1", testCaseId: "TC-A", status: "READY_FOR_AUTOMATION" }]]);
  }

  test("unchanged content is included", () => {
    const result = generateAutomation({ testCases: [testCase("TC-A")], explorationResult: exploration("http://127.0.0.1:4173/"), outputRoot: root, artifactScope: "store-one" });
    const spec = result.generated.find((file) => file.kind === "spec")!;
    const pom = result.generated.find((file) => file.kind === "pom")!;
    // Fingerprint paths recorded relative to the repo; here the repo is `root`.
    const relativeSpec = path.relative(root, spec.path).replace(/\\/g, "/");
    const run = storedRun(relativeSpec, sha256File(spec.path), sha256File(pom.path));
    const lastKnown = buildLastKnownResults([run], root);
    const { included, candidates } = selectRegressionSpecs({ specPaths: [spec.path], root, lastKnown, approved: approved(relativeSpec) });
    expect(candidates[0].reason).toContain("unchanged content");
    expect(included).toHaveLength(1);
  });

  test("changed content is excluded with the file-changed reason", () => {
    const result = generateAutomation({ testCases: [testCase("TC-A")], explorationResult: exploration("http://127.0.0.1:4173/"), outputRoot: root, artifactScope: "store-one" });
    const spec = result.generated.find((file) => file.kind === "spec")!;
    const baselineHash = sha256File(spec.path)!;
    const relativeSpec = path.relative(root, spec.path).replace(/\\/g, "/");

    // The file is regenerated afterwards: bytes differ from the baseline.
    fs.appendFileSync(spec.path, "\n// later run\n", "utf8");

    const run = storedRun(relativeSpec, baselineHash, "stale-pom-hash");
    const lastKnown = buildLastKnownResults([run], root);
    const { included, candidates } = selectRegressionSpecs({ specPaths: [spec.path], root, lastKnown, approved: approved(relativeSpec) });
    expect(included).toHaveLength(0);
    expect(candidates[0].included).toBe(false);
    expect(candidates[0].reason).toContain("file changed since baseline");
  });
});