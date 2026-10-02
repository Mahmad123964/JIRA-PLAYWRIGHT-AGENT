import { sanitizeSecrets, detectPromptInjections } from "./document-ingestion";
import type { ExplorationResult, DiscoveredElement, DiscoveredWorkflow } from "./browser-explorer";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type TestCaseStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EDITED"
  | "READY_FOR_AUTOMATION";

export type TestCasePriority = "Critical" | "High" | "Medium" | "Low";
export type TestCaseType = "Functional" | "Negative" | "Boundary" | "Validation" | "Navigation" | "Permission";

export interface TestStep {
  step: number;
  action: string;
  expected: string;
  /** Optional explicit observable assertion; absent means manual verification is required. */
  expectedAssertion?: {
    type: "visible" | "text" | "url";
    value?: string;
  };
  assertionProvenance?: TestCaseSource[];
  needsHumanInput?: string;
  selectorHint?: string;
  sourceElementId?: string;
}

export interface TestCaseSource {
  type: "manual" | "file" | "jira" | "notion" | "slack" | "github" | "pdf" | "browser-exploration" | "requirement" | "human-supplied";
  id?: string;
  pageId?: string;
  page?: string;
  observationId?: string;
  location?: string;
  requirement?: string;
}

export interface TestCase {
  testCaseId: string;
  title: string;
  objective: string;
  preconditions: string[];
  testData: string;
  steps: TestStep[];
  expectedResult: string;
  priority: TestCasePriority;
  testType: TestCaseType;
  module: string;
  sourceRequirements: string[];
  explorationReferences: string[];
  assumptions: string[];
  risks: string[];
  status: TestCaseStatus;
  automationEligibility: "ELIGIBLE" | "BLOCKED" | "UNKNOWN";
  sources: TestCaseSource[];
  provenance?: TestCaseSource[];
  generatedAt: string;
}

export interface HumanExpectedOutcome {
  requirement?: string;
  step?: number;
  type: "visible" | "text" | "url";
  value?: string;
  provenance: "human-supplied";
  note?: string;
}

export interface GeneratorInput {
  requirements: string[];
  explorationResult: ExplorationResult;
  module: string;
  scope: string;
  humanExpectedOutcomes?: HumanExpectedOutcome[];
  /** Optional Jira ticket key for traceability */
  jiraTicketKey?: string;
  /** Optional Notion page ID for traceability */
  notionPageId?: string;
}

export interface GeneratorResult {
  module: string;
  scope: string;
  generatedAt: string;
  testCases: TestCase[];
  totalGenerated: number;
  coverageSummary: {
    requirementsCovered: number;
    requirementsTotal: number;
    positiveScenarios: number;
    negativeScenarios: number;
    unknownRequirements: number;
    stepSummary: {
      total: number;
      executable: number;
      flagged: number;
      executableRatio: number;
    };
  };
  warnings: string[];
  secretsMaskedCount: number;
  promptInjectionDetected: boolean;
}

// ----------------------------------------------------------------------------
// ID generation
// ----------------------------------------------------------------------------

let _tcCounter = 0;

function nextTcId(module: string): string {
  const prefix = module
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6) || "TC";
  return `TC-${prefix}-${String(++_tcCounter).padStart(3, "0")}`;
}

// ----------------------------------------------------------------------------
// Requirement analysis helpers
// ----------------------------------------------------------------------------

const NEGATIVE_INDICATORS = [
  /invalid/i, /incorrect/i, /wrong/i, /error/i, /fail/i, /reject/i,
  /not allowed/i, /unauthorized/i, /forbidden/i, /missing/i, /empty/i,
  /without/i, /no \w+ provided/i,
];

const BOUNDARY_INDICATORS = [
  /maximum/i, /minimum/i, /limit/i, /boundary/i, /max/i, /min/i,
  /exactly/i, /at least/i, /at most/i, /characters/i, /length/i,
];

const VALIDATION_INDICATORS = [
  /required/i, /must/i, /shall/i, /validate/i, /format/i,
  /pattern/i, /valid/i, /mandatory/i,
];

const NAVIGATION_INDICATORS = [
  /navigate/i, /redirect/i, /go to/i, /link/i, /page/i, /route/i, /url/i,
];

const PERMISSION_INDICATORS = [
  /permission/i, /role/i, /access/i, /admin/i, /authorized/i, /only/i,
];

function classifyRequirement(req: string): TestCaseType {
  if (NEGATIVE_INDICATORS.some((p) => p.test(req))) return "Negative";
  if (BOUNDARY_INDICATORS.some((p) => p.test(req))) return "Boundary";
  if (VALIDATION_INDICATORS.some((p) => p.test(req))) return "Validation";
  if (NAVIGATION_INDICATORS.some((p) => p.test(req))) return "Navigation";
  if (PERMISSION_INDICATORS.some((p) => p.test(req))) return "Permission";
  return "Functional";
}

function inferPriority(req: string, type: TestCaseType): TestCasePriority {
  if (/critical|blocker|must|shall|security|auth/i.test(req)) return "Critical";
  if (type === "Negative" || type === "Permission") return "High";
  if (type === "Validation" || type === "Boundary") return "Medium";
  return "Medium";
}

function isUnknownRequirement(req: string): boolean {
  return (
    /unknown|unclear|tbd|to be determined|requires clarification|not specified/i.test(req) ||
    req.trim().length < 10
  );
}

// ----------------------------------------------------------------------------
// Step generation
// ----------------------------------------------------------------------------

function findRelatedElements(
  req: string,
  elements: DiscoveredElement[]
): DiscoveredElement[] {
  const lower = req.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 3);
  return elements.filter((el) => {
    const elText = [el.name, el.ariaLabel, el.placeholder, el.role, el.nameAttr]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.some((w) => elText.includes(w));
  });
}

function generatePositiveSteps(
  req: string,
  relatedElements: DiscoveredElement[],
  workflow?: DiscoveredWorkflow
): TestStep[] {
  const steps: TestStep[] = [];

  if (workflow && workflow.steps.length > 0) {
    workflow.steps.forEach((s, i) => {
      steps.push({
        step: i + 1,
        action: s,
        expected: "Action completes successfully",
      });
    });
    return steps;
  }

  const inputs = relatedElements.filter((e) => e.type === "input" || e.type === "textarea");
  const buttons = relatedElements.filter((e) => e.type === "button");
  const links = relatedElements.filter((e) => e.type === "link");

  let stepNum = 1;

  if (inputs.length > 0) {
    for (const input of inputs.slice(0, 3)) {
      const label = input.ariaLabel || input.placeholder || input.name || "field";
      steps.push({
        step: stepNum++,
        action: `Enter valid value in "${label}" field`,
        expected: `"${label}" field accepts the input`,
        selectorHint: input.selectorCandidates[0],
        sourceElementId: input.id,
      });
    }
  }

  if (buttons.length > 0) {
    const btn = buttons[0];
    const label = btn.name || btn.ariaLabel || "button";
    steps.push({
      step: stepNum++,
      action: `Click "${label}" button`,
      expected: "Action is triggered successfully",
      selectorHint: btn.selectorCandidates[0],
      sourceElementId: btn.id,
    });
  }

  if (links.length > 0 && steps.length === 0) {
    const link = links[0];
    const label = link.name || link.ariaLabel || "link";
    steps.push({
      step: stepNum++,
      action: `Click "${label}" link`,
      expected: "Navigation occurs as expected",
      selectorHint: link.selectorCandidates[0],
      sourceElementId: link.id,
    });
  }

  if (steps.length === 0) {
    const heading = relatedElements.find((element) => element.type === "heading" && element.name);
    if (heading) {
      steps.push({
        step: 1,
        action: `Verify heading "${heading.name}" is displayed`,
        expected: `Heading text is "${heading.name}"`,
        selectorHint: heading.selectorCandidates[0],
        sourceElementId: heading.id,
      });
    } else {
      steps.push({
        step: 1,
        action: `Perform action related to: "${req}"`,
        expected: "System responds as specified in requirement",
      });
    }
  }

  return steps;
}

function applyVerifiedAssertions(
  steps: TestStep[],
  elements: DiscoveredElement[],
  exploration: ExplorationResult,
  humanExpectedOutcomes: HumanExpectedOutcome[] = [],
  requirement: string
): TestStep[] {
  return steps.map((step) => {
    const humanOutcome = humanExpectedOutcomes.find((outcome) =>
      (outcome.requirement === requirement || !outcome.requirement) &&
      (outcome.step === undefined || outcome.step === step.step)
    );
    if (humanOutcome) {
      return {
        ...step,
        expectedAssertion: { type: humanOutcome.type, ...(humanOutcome.value !== undefined ? { value: humanOutcome.value } : {}) },
        assertionProvenance: [{ type: "human-supplied", requirement: humanOutcome.note || "human-supplied expected outcome" }],
        needsHumanInput: undefined,
      };
    }

    const element = step.sourceElementId ? elements.find((item) => item.id === step.sourceElementId) : undefined;
    if (!element || !step.selectorHint || !element.selectorCandidates.includes(step.selectorHint)) {
      return { ...step, needsHumanInput: "NEEDS_HUMAN_INPUT: no matching discovered element and selector evidence for this step" };
    }

    const source: TestCaseSource = {
      type: "browser-exploration",
      page: element.url,
      observationId: element.id,
      location: element.url,
      requirement: step.expected,
    };
    const expectedLower = step.expected.toLowerCase();
    const outcomeNeedsEvidence = /error|reject|validation|authenticated|redirect|navigate|url|message|success message|successful authentication/.test(expectedLower);

    if (element.type === "heading" && element.name && !outcomeNeedsEvidence) {
      return { ...step, expectedAssertion: { type: "text", value: element.name }, assertionProvenance: [source] };
    }
    if (["button", "input", "textarea", "select", "link", "testid-element"].includes(element.type) && !outcomeNeedsEvidence) {
      return { ...step, expectedAssertion: { type: "visible" }, assertionProvenance: [source] };
    }

    const observedUrl = exploration.pagesVisited.includes(element.url) ? element.url : undefined;
    if (observedUrl && /url|navigate|redirect/.test(expectedLower)) {
      return { ...step, expectedAssertion: { type: "url", value: observedUrl }, assertionProvenance: [{ ...source, location: observedUrl }] };
    }
    return { ...step, needsHumanInput: `NEEDS_HUMAN_INPUT: expected outcome is not directly proven by exploration data (${step.expected})` };
  });
}

function generateNegativeSteps(
  req: string,
  relatedElements: DiscoveredElement[]
): TestStep[] {
  const steps: TestStep[] = [];
  const inputs = relatedElements.filter((e) => e.type === "input" || e.type === "textarea");
  const buttons = relatedElements.filter((e) => e.type === "button");

  let stepNum = 1;

  if (inputs.length > 0) {
    for (const input of inputs.slice(0, 2)) {
      const label = input.ariaLabel || input.placeholder || input.name || "field";
      steps.push({
        step: stepNum++,
        action: `Enter invalid or empty value in "${label}" field`,
        expected: `Validation error is shown for "${label}"`,
        selectorHint: input.selectorCandidates[0],
        sourceElementId: input.id,
      });
    }
  }

  if (buttons.length > 0) {
    const btn = buttons[0];
    const label = btn.name || btn.ariaLabel || "submit button";
    steps.push({
      step: stepNum++,
      action: `Click "${label}" with invalid data`,
      expected: "System rejects the action and shows an appropriate error message",
      selectorHint: btn.selectorCandidates[0],
      sourceElementId: btn.id,
    });
  }

  if (steps.length === 0) {
    steps.push({
      step: 1,
      action: `Attempt action with invalid/missing data for: "${req}"`,
      expected: "System shows appropriate error or rejection",
    });
  }

  return steps;
}

// ----------------------------------------------------------------------------
// Test case generation per requirement
// ----------------------------------------------------------------------------

function generateTestCasesForRequirement(
  req: string,
  index: number,
  input: GeneratorInput
): TestCase[] {
  const cases: TestCase[] = [];
  const { explorationResult, module, jiraTicketKey, notionPageId } = input;
  const explorationBlocked = explorationResult.explorationStatus === "FAILED" || explorationResult.explorationStatus === "BLOCKED";

  if (isUnknownRequirement(req) || explorationBlocked) {
    const tc: TestCase = {
      testCaseId: nextTcId(module),
      title: `${explorationBlocked ? "[BLOCKED / NEEDS MANUAL VERIFICATION]" : "[REQUIRES CLARIFICATION]"} ${req.slice(0, 80)}`,
      objective: explorationBlocked
        ? "Browser exploration did not verify this requirement — manual verification is required"
        : "Requirement is unclear or underspecified — cannot generate test case",
      preconditions: [explorationBlocked
        ? "Browser exploration must complete successfully before automation"
        : "Requirement must be clarified before test can be written"],
      testData: explorationBlocked ? "UNKNOWN / BLOCKED / NEEDS_MANUAL_VERIFICATION" : "UNKNOWN / REQUIRES CLARIFICATION",
      steps: [{ step: 1, action: "Clarify requirement with stakeholder", expected: "Requirement is defined" }],
      expectedResult: explorationBlocked ? "UNKNOWN / BLOCKED / NEEDS_MANUAL_VERIFICATION" : "UNKNOWN / REQUIRES CLARIFICATION",
      priority: "Low",
      testType: "Functional",
      module,
      sourceRequirements: [req],
      explorationReferences: [],
      assumptions: ["Requirement needs clarification"],
      risks: ["Test cannot be automated without clear requirement"],
      status: "PENDING_APPROVAL",
      automationEligibility: explorationBlocked ? "BLOCKED" : "UNKNOWN",
      provenance: buildSources(req, jiraTicketKey, notionPageId),
      sources: buildSources(req, jiraTicketKey, notionPageId),
      generatedAt: new Date().toISOString(),
    };
    cases.push(tc);
    return cases;
  }

  const type = classifyRequirement(req);
  const priority = inferPriority(req, type);
  const relatedElements = findRelatedElements(req, explorationResult.elements);

  // Find related workflow
  const relatedWorkflow = explorationResult.workflows.find((wf) =>
    wf.relatedRequirements.includes(req)
  );

  const explorationRefs = [
    ...relatedElements.map((e) => e.id),
    ...(relatedWorkflow ? [relatedWorkflow.id] : []),
  ];

  const coverage = explorationResult.requirementsCoverage.find((c) => c.requirement === req);
  const preconditions = buildPreconditions(explorationResult, req);

  // Always generate positive scenario
  const positiveSteps = applyVerifiedAssertions(
    generatePositiveSteps(req, relatedElements, relatedWorkflow),
    relatedElements,
    explorationResult,
    input.humanExpectedOutcomes,
    req
  );
  cases.push({
    testCaseId: nextTcId(module),
    title: `[Positive] ${req.slice(0, 100)}`,
    objective: `Verify that: ${req}`,
    preconditions,
    testData: "Valid test data as per requirement",
    steps: positiveSteps,
    expectedResult: `System behaves as specified: ${req}`,
    priority,
    testType: type === "Negative" ? "Functional" : type,
    module,
    sourceRequirements: [req],
    explorationReferences: explorationRefs,
    assumptions: coverage?.coverageNote ? [coverage.coverageNote] : [],
    risks: relatedElements.length === 0 ? ["No UI elements discovered — selector may need manual verification"] : [],
    status: "PENDING_APPROVAL",
    automationEligibility: "ELIGIBLE",
    provenance: buildSources(req, jiraTicketKey, notionPageId, relatedElements[0]),
    sources: buildSources(req, jiraTicketKey, notionPageId, relatedElements[0]),
    generatedAt: new Date().toISOString(),
  });

  // Generate negative scenario for functional/validation requirements
  if (type === "Functional" || type === "Validation" || type === "Negative") {
    const negativeSteps = applyVerifiedAssertions(
      generateNegativeSteps(req, relatedElements),
      relatedElements,
      explorationResult,
      input.humanExpectedOutcomes,
      req
    );
    cases.push({
      testCaseId: nextTcId(module),
      title: `[Negative] ${req.slice(0, 100)}`,
      objective: `Verify system handles invalid/missing input for: ${req}`,
      preconditions,
      testData: "Invalid or empty test data",
      steps: negativeSteps,
      expectedResult: "System shows appropriate error message or rejects the action",
      priority: priority === "Critical" ? "High" : priority,
      testType: "Negative",
      module,
      sourceRequirements: [req],
      explorationReferences: explorationRefs,
      assumptions: [],
      risks: relatedElements.length === 0 ? ["No UI elements discovered — manual verification needed"] : [],
      status: "PENDING_APPROVAL",
      automationEligibility: "ELIGIBLE",
      provenance: buildSources(req, jiraTicketKey, notionPageId, relatedElements[0]),
      sources: buildSources(req, jiraTicketKey, notionPageId, relatedElements[0]),
      generatedAt: new Date().toISOString(),
    });
  }

  return cases;
}

function buildPreconditions(exploration: ExplorationResult, req: string): string[] {
  const preconditions: string[] = [`Target URL is accessible: ${exploration.target.url}`];

  const authObs = exploration.observations.find((o) => o.type === "auth-wall");
  if (authObs) {
    preconditions.push("User is authenticated (auth wall detected during exploration)");
  }

  if (/log.?in|sign.?in|authenticated/i.test(req)) {
    preconditions.push("Valid user credentials are available");
  }

  return preconditions;
}

function buildSources(
  req: string,
  jiraTicketKey?: string,
  notionPageId?: string,
  element?: DiscoveredElement
): TestCaseSource[] {
  const sources: TestCaseSource[] = [];

  if (jiraTicketKey) {
    sources.push({ type: "jira", id: jiraTicketKey, requirement: req });
  }

  if (notionPageId) {
    sources.push({ type: "notion", pageId: notionPageId });
  }

  if (element) {
    sources.push({
      type: "browser-exploration",
      page: element.url,
      observationId: element.id,
    });
  }

  if (sources.length === 0) {
    sources.push({ type: "requirement", requirement: req });
  }

  return sources;
}

// ----------------------------------------------------------------------------
// Main generator
// ----------------------------------------------------------------------------

export function generateTestCases(input: GeneratorInput): GeneratorResult {
  _tcCounter = 0;

  const warnings: string[] = [];
  let totalMasked = 0;
  let injectionDetected = false;

  // Sanitize all requirement text
  const sanitizedRequirements = input.requirements.map((req) => {
    const { sanitized, maskedCount } = sanitizeSecrets(req);
    totalMasked += maskedCount;
    const injections = detectPromptInjections(sanitized);
    if (injections.length > 0) {
      injectionDetected = true;
      warnings.push(`PROMPT INJECTION ATTEMPT DETECTED in requirement: "${injections[0]}"`);
      return "[QUARANTINED — prompt injection detected]";
    }
    return sanitized;
  });

  // Propagate exploration warnings
  warnings.push(...input.explorationResult.warnings);

  const allTestCases: TestCase[] = [];

  for (let i = 0; i < sanitizedRequirements.length; i++) {
    const req = sanitizedRequirements[i];
    const cases = generateTestCasesForRequirement(req, i, {
      ...input,
      requirements: sanitizedRequirements,
    });
    allTestCases.push(...cases);
  }

  const positiveScenarios = allTestCases.filter((tc) => tc.title.startsWith("[Positive]")).length;
  const negativeScenarios = allTestCases.filter((tc) => tc.testType === "Negative").length;
  const unknownRequirements = allTestCases.filter((tc) =>
    tc.title.startsWith("[REQUIRES CLARIFICATION]")
  ).length;
  const requirementsCovered = input.explorationResult.requirementsCoverage.filter(
    (c) => c.covered
  ).length;
  const totalSteps = allTestCases.reduce((sum, tc) => sum + tc.steps.length, 0);
  const executableSteps = allTestCases.reduce((sum, tc) => sum + tc.steps.filter((step) => Boolean(step.expectedAssertion && !step.needsHumanInput)).length, 0);
  const flaggedSteps = totalSteps - executableSteps;

  return {
    module: input.module,
    scope: input.scope,
    generatedAt: new Date().toISOString(),
    testCases: allTestCases,
    totalGenerated: allTestCases.length,
    coverageSummary: {
      requirementsCovered,
      requirementsTotal: input.requirements.length,
      positiveScenarios,
      negativeScenarios,
      unknownRequirements,
      stepSummary: {
        total: totalSteps,
        executable: executableSteps,
        flagged: flaggedSteps,
        executableRatio: totalSteps === 0 ? 0 : executableSteps / totalSteps,
      },
    },
    warnings,
    secretsMaskedCount: totalMasked,
    promptInjectionDetected: injectionDetected,
  };
}
