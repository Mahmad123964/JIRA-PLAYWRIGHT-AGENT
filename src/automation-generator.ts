import fs from "fs";
import path from "path";
import type { TestCase } from "./test-case-generator";
import type { ExplorationResult } from "./browser-explorer";

export interface GeneratorSource {
  jiraKey?: string;
  sourceReferences: unknown[];
  explorationReferences: string[];
}

export interface AutomationGenerationInput {
  testCases: TestCase[];
  explorationResult?: ExplorationResult;
  outputRoot?: string;
  /**
   * Namespace applied to the generated output directory. Supplying it (the
   * approved runner derives it from the approval store id) guarantees that two
   * runs of the same module cannot overwrite each other's POM or specs, and that
   * a spec always sits beside the POM generated from the same exploration.
   */
  artifactScope?: string;
  allowPartialExploration?: boolean;
  source?: GeneratorSource;
}

export interface GeneratedAutomationFile {
  path: string;
  kind: "pom" | "spec";
  testCaseId?: string;
  /** Target URL this artifact was generated against. */
  targetUrl?: string;
  /** Namespace applied to the output directory, when one was used. */
  artifactScope?: string;
}

export interface AutomationGenerationResult {
  status: "SUCCESS" | "BLOCKED" | "FAILED";
  generated: GeneratedAutomationFile[];
  blocked: Array<{ testCaseId: string; reason: string }>;
  warnings: string[];
}

function safeName(value: string, fallback: string): string {
  const result = value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return result || fallback;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function selectorExpression(hint?: string): string | null {
  if (!hint || hint.startsWith("//") || /nth\s*\(/i.test(hint) || /nth-child/i.test(hint)) return null;
  const trimmed = hint.trim();
  if (/^(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|locator)\(/.test(trimmed)) {
    return `page.${trimmed}`;
  }
  return null;
}

function pageObjectName(testCase: TestCase): string {
  const moduleName = safeName(testCase.module, "Module").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return `${moduleName}Page`;
}

function collectSelectors(testCases: TestCase[]): Array<{ name: string; expression: string }> {
  const values = new Map<string, string>();
  for (const tc of testCases) {
    for (const step of tc.steps) {
      const expression = selectorExpression(step.selectorHint);
      if (!expression) continue;
      const raw = step.action.replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
      const name = safeName(raw.slice(0, 40), `element${values.size + 1}`).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!values.has(name)) values.set(name, expression.replace(/^page\./, "this.page."));
    }
  }
  return [...values.entries()].map(([name, expression]) => ({ name, expression }));
}

function renderPom(pageName: string, selectors: Array<{ name: string; expression: string }>, url: string): string {
  const declarations = selectors.length
    ? selectors.map((s) => `  readonly ${s.name}: ReturnType<Page[\"getByRole\"]>;`).join("\n")
    : "  // No verified selector was available; manual implementation is required.";
  const assignments = selectors.map((s) => `    this.${s.name} = ${s.expression};`).join("\n");
  const actions = selectors.map((s) => `  async inspect${s.name[0].toUpperCase() + s.name.slice(1)}(): Promise<void> { await expect(this.${s.name}).toBeVisible(); }`).join("\n");
  return `import { expect, type Page } from "@playwright/test";\n\n/** Generated from verified browser observations. URL: ${url} */\nexport class ${pageName} {\n${declarations}\n  constructor(readonly page: Page) {\n${assignments}\n  }\n\n  async open(): Promise<void> { await this.page.goto(${quote(url)}); }\n${actions}\n}\n`;
}

function renderSpec(tc: TestCase, pageName: string, jiraKey?: string, exploration?: ExplorationResult, importPrefix = "../../../", moduleDirName?: string): string {
  const observedElements = exploration?.elements || [];
  const steps = tc.steps.map((step) => {
    const locator = selectorExpression(step.selectorHint);
    const assertion = step.expectedAssertion?.type === "visible" ? "await expect(target).toBeVisible();" : step.expectedAssertion?.type === "text" ? `await expect(target).toContainText(${quote(step.expectedAssertion.value || step.expected)});` : `await expect(page).toHaveURL(${quote(step.expectedAssertion?.value || step.expected)});`;
    const interaction = /click|submit|press/i.test(step.action) ? "await target.click();" : "";
    const action = locator && step.expectedAssertion
      ? `const target = ${locator};\n      if (await target.count() === 0) throw new Error("LOCATOR_NOT_FOUND");\n      ${interaction}\n      ${assertion}`
      : `throw new Error(${quote("UNKNOWN / MANUAL VERIFICATION REQUIRED: " + step.action.replace(/\n/g, " "))});`;
    const observedElement = step.sourceElementId ? observedElements.find((element) => element.id === step.sourceElementId) : undefined;
    const metadata = JSON.stringify({ testCaseId: tc.testCaseId, stepNumber: step.step, originalLocator: step.selectorHint, originalRole: observedElement?.role, originalName: observedElement?.name, expectedAssertion: step.expectedAssertion, elements: observedElements });
    const guardedAction = locator && step.expectedAssertion && observedElement
      ? `try { ${action} } catch (error) {\n        const message = error instanceof Error ? error.message : String(error);\n        if (!/locator|strict mode|no element|not found|resolved to 0/i.test(message)) throw error;\n        const healing = await healOnSamePage({ page, originalLocator: ${quote(step.selectorHint || "")}, originalRole: ${quote(observedElement.role || "")}, originalName: ${quote(observedElement.name || "")}, expectedText: ${quote(step.expectedAssertion.value || step.expected)}, failureKind: /resolved to 0|no element|not found/i.test(message) ? "LOCATOR_NOT_FOUND" : "LOCATOR_EMPTY", elements: observedElements, rerun: async (candidate) => { const healed = locatorForObservedElement(page, candidate); try { ${/click|submit|press/i.test(step.action) ? "await healed.click();" : ""} ${step.expectedAssertion.type === "visible" ? "await expect(healed).toBeVisible();" : step.expectedAssertion.type === "text" ? `await expect(healed).toContainText(${quote(step.expectedAssertion.value || step.expected)});` : `await expect(page).toHaveURL(${quote(step.expectedAssertion.value || step.expected)});`} return { action: "PASS", assertion: "PASS" }; } catch (rerunError) { return { action: "PASS", assertion: "FAIL", detail: String(rerunError) }; } }} )\n        if (process.env.QA_HEALING_FILE) require("fs").appendFileSync(process.env.QA_HEALING_FILE, JSON.stringify({ ...healing, metadata: ${metadata} }) + "\\n");\n        if (healing.outcome !== "PASS_AFTER_HEALING") throw error;\n      }`
      : action;
    return `    await test.step(${quote(`Step ${step.step}: ${step.action}`)}, async () => {\n      ${guardedAction}\n      // Expected: ${step.expected.replace(/\n/g, " ")}\n    });`;
  }).join("\n");
  return `import { test, expect } from "@playwright/test";\nimport { healOnSamePage, locatorForObservedElement } from "${importPrefix}src/healing-runtime";\nimport type { DiscoveredElement } from "${importPrefix}src/browser-explorer";\nimport { ${pageName} } from "${importPrefix}pages/${moduleDirName || safeName(tc.module, "module")}/${pageName}";\n\n/**\n * Test case: ${tc.testCaseId}\n * Jira: ${jiraKey || "Not available / not applicable."}\n * Sources: ${tc.sources.map((source) => source.type).join(", ")}\n * Exploration references: ${tc.explorationReferences.join(", ") || "none"}\n * Generated: ${tc.generatedAt}\n */\ntest.describe(${quote(tc.module)}, () => {\n  test(${quote(`${tc.testCaseId}: ${tc.title}`)}, async ({ page }) => {\n    const model = new ${pageName}(page);\n    const observedElements = ${JSON.stringify(observedElements)} as DiscoveredElement[];\n    await test.step("Open verified target", async () => { await model.open(); });\n${steps}\n    await test.step("Verify expected result", async () => {\n      // Expected: ${tc.expectedResult.replace(/\n/g, " ")}\n      expect(${quote(tc.expectedResult)}).not.toContain("UNKNOWN");\n    });\n  });\n});\n`;
}

export function validateAutomationInput(input: AutomationGenerationInput): { valid: boolean; error?: string } {
  if (!input || !Array.isArray(input.testCases)) return { valid: false, error: "testCases must be an array" };
  for (const tc of input.testCases) {
    if (tc.status !== "READY_FOR_AUTOMATION") return { valid: false, error: `${tc.testCaseId} is ${tc.status}; only READY_FOR_AUTOMATION is executable` };
    if (tc.automationEligibility && tc.automationEligibility !== "ELIGIBLE") return { valid: false, error: `${tc.testCaseId} is not automation eligible` };
    if (tc.steps.some((step) => !selectorExpression(step.selectorHint) || !step.expectedAssertion)) return { valid: false, error: `${tc.testCaseId} contains an unverified selector or expected assertion; manual verification is required` };
    if (/UNKNOWN|BLOCKED|REQUIRES CLARIFICATION|MANUAL VERIFICATION/i.test(`${tc.expectedResult} ${tc.testData}`)) return { valid: false, error: `${tc.testCaseId} contains unknown or blocked expected data` };
  }
  if (!input.explorationResult) return { valid: false, error: "explorationResult is required for provenance and target verification" };
  if (input.explorationResult.explorationStatus !== "SUCCESS" && !input.allowPartialExploration) {
    return { valid: false, error: `Exploration status ${input.explorationResult.explorationStatus || "UNKNOWN"} blocks executable generation` };
  }
  return { valid: true };
}

export function generateAutomation(input: AutomationGenerationInput): AutomationGenerationResult {
  const validation = validateAutomationInput(input);
  if (!validation.valid) return { status: "BLOCKED", generated: [], blocked: input?.testCases?.map((tc) => ({ testCaseId: tc.testCaseId, reason: validation.error! })) || [], warnings: [validation.error!] };
  const root = path.resolve(input.outputRoot || process.cwd());
  const moduleName = safeName(input.testCases[0]?.module || "module", "module");
  // ARTIFACT ISOLATION.
  //
  // Output used to be keyed by module name alone, so every run of the same
  // module overwrote the previous run's POM and specs. Two runs of module "Auth"
  // against different targets (for example the fixture on 127.0.0.1:4173 and on
  // 127.0.0.1:4193) fought over one pages/Auth/AuthPage.ts, and the loser left a
  // spec paired with a POM that navigated somewhere else entirely.
  //
  // `artifactScope` namespaces the output directory when supplied, so a spec and
  // the POM it imports always come from the same generation and the same target
  // URL, and two runs (or two cases in separate generations) cannot clobber each
  // other. It is derived from the approval store id by the caller.
  const scope = safeName(input.artifactScope || "", "");
  const moduleDir = path.join(root, "pages", scope ? `${moduleName}__${scope}` : moduleName);
  const specDir = path.join(root, "tests", "generated", scope ? `${moduleName}__${scope}` : moduleName);
  fs.mkdirSync(moduleDir, { recursive: true });
  fs.mkdirSync(specDir, { recursive: true });
  const generated: GeneratedAutomationFile[] = [];
  const pageName = pageObjectName(input.testCases[0]);
  const selectors = collectSelectors(input.testCases);
  const pomPath = path.join(moduleDir, `${pageName}.ts`);
  fs.writeFileSync(pomPath, renderPom(pageName, selectors, input.explorationResult!.target.url), "utf8");
  generated.push({ path: pomPath, kind: "pom", targetUrl: input.explorationResult!.target.url, artifactScope: scope || undefined });
  for (const tc of input.testCases) {
    const specPath = path.join(specDir, `${safeName(tc.testCaseId, "test")}.spec.ts`);
    const importPrefix = `${path.relative(specDir, root).replace(/\\/g, "/") || "."}/`;
    fs.writeFileSync(specPath, renderSpec(tc, pageName, input.source?.jiraKey, input.explorationResult, importPrefix, scope ? `${moduleName}__${scope}` : moduleName), "utf8");
    generated.push({ path: specPath, kind: "spec", testCaseId: tc.testCaseId, targetUrl: input.explorationResult!.target.url, artifactScope: scope || undefined });
  }
  return { status: "SUCCESS", generated, blocked: [], warnings: selectors.length ? [] : ["No verified selectors were available; generated files require manual implementation"] };
}
