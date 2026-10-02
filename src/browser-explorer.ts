import { chromium, Browser, Page } from "@playwright/test";
import { sanitizeSecrets, detectPromptInjections } from "./document-ingestion";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type ExplorationStatus =
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "BLOCKED"
  | "BLOCKED / MISSING REQUIREMENT"
  | "BLOCKED / AUTH REQUIRED"
  | "ERROR";

export type ExplorationOutcome = "SUCCESS" | "PARTIAL" | "FAILED" | "BLOCKED";

export interface ExplorationInput {
  url: string;
  module: string;
  scope: string;
  requirements: string[];
  /** Optional: max pages to visit (default 5) */
  maxPages?: number;
  /** Optional: credentials hint — never actual values */
  authRequired?: boolean;
}

export interface DiscoveredElement {
  id: string;
  type: string;
  role?: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  dataTestId?: string;
  elementId?: string;
  nameAttr?: string;
  selectorCandidates: string[];
  url: string;
  source: "browser-exploration";
}

export interface DiscoveredWorkflow {
  id: string;
  name: string;
  steps: string[];
  relatedRequirements: string[];
  url: string;
  source: "browser-exploration";
}

export interface ExplorationObservation {
  id: string;
  type: "page-load" | "element-found" | "navigation" | "form-found" | "error-state" | "auth-wall" | "info";
  description: string;
  url: string;
  detail?: string;
}

export interface RequirementCoverage {
  requirement: string;
  covered: boolean;
  coverageNote: string;
  relatedElements: string[];
}

export interface ExplorationProvenance {
  url: string;
  pageTitle: string;
  visitedAt: string;
  elementCount: number;
}

export interface ExplorationResult {
target: {
  url: string;
  module: string;
  scope: string;
  requirements: string[];
};
status: ExplorationStatus;
explorationStatus?: ExplorationOutcome;
  exploredAt: string;
  pagesVisited: string[];
  elements: DiscoveredElement[];
  workflows: DiscoveredWorkflow[];
  observations: ExplorationObservation[];
  requirementsCoverage: RequirementCoverage[];
  warnings: string[];
  provenance: ExplorationProvenance[];
  error?: string;
  secretsMaskedCount: number;
  promptInjectionDetected: boolean;
}

// ----------------------------------------------------------------------------
// Safety constants
// ----------------------------------------------------------------------------

const DESTRUCTIVE_PATTERNS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bpurchase\b/i,
  /\bbuy now\b/i,
  /\bcheckout\b/i,
  /\bplace order\b/i,
  /\bsend message\b/i,
  /\bsubmit payment\b/i,
];

const AUTH_INDICATORS = [
  /sign.?in/i,
  /log.?in/i,
  /login/i,
  /authenticate/i,
  /password/i,
  /credentials/i,
  /unauthorized/i,
  /401/,
  /403/,
  /access denied/i,
  /please log in/i,
];

const MAX_PAGES_DEFAULT = 5;
const MAX_ELEMENTS_PER_PAGE = 50;

let _observationCounter = 0;
let _elementCounter = 0;

function nextObsId(): string {
  return `OBS-${String(++_observationCounter).padStart(4, "0")}`;
}

function nextElemId(): string {
  return `ELEM-${String(++_elementCounter).padStart(4, "0")}`;
}

function browserUnavailableReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  return /executable doesn't exist|executable.*not found|browser.*not installed|browserType\.launch/i.test(message)
    ? "PLAYWRIGHT_BROWSER_NOT_INSTALLED"
    : undefined;
}

// ----------------------------------------------------------------------------
// Input validation
// ----------------------------------------------------------------------------

export function validateExplorationInput(input: unknown): { valid: boolean; error?: string } {
  if (!input || typeof input !== "object") {
    return { valid: false, error: "Input must be a non-null object" };
  }
  const i = input as Record<string, unknown>;

  if (!i.url || typeof i.url !== "string" || !i.url.trim()) {
    return { valid: false, error: "url is required and must be a non-empty string" };
  }

  try {
    const parsed = new URL(i.url as string);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: `url protocol must be http or https, got: ${parsed.protocol}` };
    }
  } catch {
    return { valid: false, error: `url is not a valid URL: ${i.url}` };
  }

  if (!i.module || typeof i.module !== "string" || !i.module.trim()) {
    return { valid: false, error: "module is required and must be a non-empty string" };
  }

  if (!i.scope || typeof i.scope !== "string" || !i.scope.trim()) {
    return { valid: false, error: "scope is required and must be a non-empty string" };
  }

  if (!Array.isArray(i.requirements)) {
    return { valid: false, error: "requirements must be an array" };
  }

  return { valid: true };
}

// ----------------------------------------------------------------------------
// Element discovery helpers
// ----------------------------------------------------------------------------

function buildSelectorCandidates(el: {
  role?: string;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
  dataTestId?: string;
  elementId?: string;
  nameAttr?: string;
}): string[] {
  const candidates: string[] = [];

  if (el.role && el.name && !["form", "navigation", "heading"].includes(el.role)) {
    candidates.push(`getByRole('${el.role}', { name: '${el.name}' })`);
  } else if (el.role && !["form", "navigation"].includes(el.role)) {
    candidates.push(`getByRole('${el.role}')`);
  }

  if (el.ariaLabel) {
    candidates.push(`getByLabel('${el.ariaLabel}')`);
  }

  if (el.placeholder) {
    candidates.push(`getByPlaceholder('${el.placeholder}')`);
  }

  if (el.name && !el.role) {
    candidates.push(`getByText('${el.name}')`);
  }

  if (el.dataTestId) {
    candidates.push(`locator('[data-testid="${el.dataTestId}"]')`);
  }

  if (el.elementId) {
    candidates.push(`locator('#${el.elementId}')`);
  }

  return candidates.filter(Boolean);
}

function isDestructiveElement(name: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(name));
}

// ----------------------------------------------------------------------------
// Page inspection
// ----------------------------------------------------------------------------

async function inspectPage(
  page: Page,
  url: string,
  module: string,
  requirements: string[]
): Promise<{
  elements: DiscoveredElement[];
  observations: ExplorationObservation[];
  pageTitle: string;
  hasAuthWall: boolean;
}> {
  const elements: DiscoveredElement[] = [];
  const observations: ExplorationObservation[] = [];
  let hasAuthWall = false;

  const pageTitle = await page.title().catch(() => "");
  const pageText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");

  // Check for auth wall
  if (AUTH_INDICATORS.some((p) => p.test(pageText) || p.test(pageTitle))) {
    const isLoginPage = AUTH_INDICATORS.slice(0, 4).some((p) => p.test(pageTitle));
    if (isLoginPage || AUTH_INDICATORS.slice(6).some((p) => p.test(pageText))) {
      hasAuthWall = true;
      observations.push({
        id: nextObsId(),
        type: "auth-wall",
        description: "Authentication wall detected on page",
        url,
        detail: `Page title: "${pageTitle}"`,
      });
    }
  }

  observations.push({
    id: nextObsId(),
    type: "page-load",
    description: `Page loaded: "${pageTitle}"`,
    url,
  });

  // Discover interactive elements
  const interactiveSelectors = [
    { selector: 'button:not([disabled])', type: "button" },
    { selector: 'input:not([type="hidden"])', type: "input" },
    { selector: 'a[href]', type: "link" },
    { selector: 'select', type: "select" },
    { selector: 'textarea', type: "textarea" },
    { selector: '[role="button"]', type: "button" },
    { selector: '[role="link"]', type: "link" },
    { selector: '[role="textbox"]', type: "input" },
    { selector: 'form', type: "form" },
    { selector: 'nav', type: "navigation" },
    { selector: 'h1, h2, h3, h4, h5, h6', type: "heading" },
    { selector: '[data-testid]', type: "testid-element" },
  ];

  for (const { selector, type } of interactiveSelectors) {
    if (elements.length >= MAX_ELEMENTS_PER_PAGE) break;

    try {
      const handles = await page.locator(selector).all();
      for (const handle of handles.slice(0, 10)) {
        if (elements.length >= MAX_ELEMENTS_PER_PAGE) break;

        try {
          const attrs = await handle.evaluate((el: Element) => {
            const e = el as HTMLElement & {
              type?: string;
              placeholder?: string;
              name?: string;
              href?: string;
            };
            return {
              role:
                e.getAttribute("role") ||
                ({
                  BUTTON: "button",
                  A: "link",
                  INPUT: (e as HTMLInputElement).type === "submit" ? "button" : "textbox",
                  TEXTAREA: "textbox",
                  SELECT: "combobox",
                  H1: "heading",
                  H2: "heading",
                  H3: "heading",
                  H4: "heading",
                  H5: "heading",
                  H6: "heading",
                  NAV: "navigation",
                  FORM: "form",
                } as Record<string, string>)[e.tagName] || e.tagName.toLowerCase(),
              name:
                e.getAttribute("aria-label") ||
                e.getAttribute("title") ||
                (e as HTMLButtonElement).innerText?.trim().slice(0, 80) ||
                e.getAttribute("value") ||
                "",
              placeholder: e.getAttribute("placeholder") || "",
              ariaLabel: e.getAttribute("aria-label") || "",
              dataTestId: e.getAttribute("data-testid") || "",
              elementId: e.getAttribute("id") || "",
              nameAttr: e.getAttribute("name") || "",
              inputType: e.getAttribute("type") || "",
              href: e.getAttribute("href") || "",
            };
          });

          // Skip destructive elements
          if (isDestructiveElement(attrs.name)) {
            observations.push({
              id: nextObsId(),
              type: "info",
              description: `Skipped potentially destructive element: "${attrs.name}"`,
              url,
            });
            continue;
          }

          const selectorCandidates = buildSelectorCandidates({
            role: attrs.role,
            name: attrs.name,
            placeholder: attrs.placeholder,
            ariaLabel: attrs.ariaLabel,
            dataTestId: attrs.dataTestId,
            elementId: attrs.elementId,
            nameAttr: attrs.nameAttr,
          });

          if (selectorCandidates.length === 0) continue;

          elements.push({
            id: nextElemId(),
            type,
            role: attrs.role || undefined,
            name: attrs.name || undefined,
            placeholder: attrs.placeholder || undefined,
            ariaLabel: attrs.ariaLabel || undefined,
            dataTestId: attrs.dataTestId || undefined,
            elementId: attrs.elementId || undefined,
            nameAttr: attrs.nameAttr || undefined,
            selectorCandidates,
            url,
            source: "browser-exploration",
          });
        } catch {
          // Element became stale — skip
        }
      }
    } catch {
      // Selector failed — skip
    }
  }

  if (elements.length > 0) {
    observations.push({
      id: nextObsId(),
      type: "element-found",
      description: `Discovered ${elements.length} interactive elements`,
      url,
    });
  }

  // Detect forms
  try {
    const formCount = await page.locator("form").count();
    if (formCount > 0) {
      observations.push({
        id: nextObsId(),
        type: "form-found",
        description: `Found ${formCount} form(s) on page`,
        url,
      });
    }
  } catch {
    // ignore
  }

  return { elements, observations, pageTitle, hasAuthWall };
}

// ----------------------------------------------------------------------------
// Workflow inference
// ----------------------------------------------------------------------------

function inferWorkflows(
  elements: DiscoveredElement[],
  requirements: string[],
  module: string
): DiscoveredWorkflow[] {
  const workflows: DiscoveredWorkflow[] = [];

  // Group elements by page
  const pageMap = new Map<string, DiscoveredElement[]>();
  for (const el of elements) {
    const existing = pageMap.get(el.url) || [];
    existing.push(el);
    pageMap.set(el.url, existing);
  }

  for (const [pageUrl, pageElements] of pageMap) {
    const inputs = pageElements.filter((e) => e.type === "input" || e.type === "textarea");
    const buttons = pageElements.filter((e) => e.type === "button");
    const forms = pageElements.filter((e) => e.type === "form");

    // Form submission workflow
    if ((inputs.length > 0 && buttons.length > 0) || forms.length > 0) {
      const relatedReqs = requirements.filter((req) => {
        const lower = req.toLowerCase();
        return (
          lower.includes("submit") ||
          lower.includes("fill") ||
          lower.includes("enter") ||
          lower.includes("form") ||
          lower.includes("input") ||
          lower.includes("log in") ||
          lower.includes("login") ||
          lower.includes("sign in") ||
          lower.includes("register") ||
          lower.includes("search")
        );
      });

      const steps: string[] = [];
      for (const input of inputs.slice(0, 5)) {
        const label = input.ariaLabel || input.placeholder || input.name || input.nameAttr || "field";
        steps.push(`Fill in "${label}" field`);
      }
      for (const btn of buttons.slice(0, 3)) {
        const label = btn.name || btn.ariaLabel || "button";
        steps.push(`Click "${label}" button`);
      }

      if (steps.length > 0) {
        workflows.push({
          id: `WF-${String(workflows.length + 1).padStart(3, "0")}`,
          name: `${module} form interaction on ${new URL(pageUrl).pathname || "/"}`,
          steps,
          relatedRequirements: relatedReqs,
          url: pageUrl,
          source: "browser-exploration",
        });
      }
    }

    // Navigation workflow
    const links = pageElements.filter((e) => e.type === "link");
    if (links.length > 0) {
      const navLinks = links.slice(0, 5).map((l) => l.name || l.ariaLabel || "link");
      workflows.push({
        id: `WF-${String(workflows.length + 1).padStart(3, "0")}`,
        name: `Navigation from ${new URL(pageUrl).pathname || "/"}`,
        steps: navLinks.map((l) => `Click navigation link: "${l}"`),
        relatedRequirements: [],
        url: pageUrl,
        source: "browser-exploration",
      });
    }
  }

  return workflows;
}

// ----------------------------------------------------------------------------
// Requirement coverage assessment
// ----------------------------------------------------------------------------

function assessRequirementCoverage(
  requirements: string[],
  elements: DiscoveredElement[],
  observations: ExplorationObservation[]
): RequirementCoverage[] {
  return requirements.map((req) => {
    const lower = req.toLowerCase();
    const relatedElements: string[] = [];

    // Check if any element name/role/placeholder relates to this requirement
    for (const el of elements) {
      const elText = [el.name, el.ariaLabel, el.placeholder, el.role]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const reqWords = lower.split(/\s+/).filter((w) => w.length > 3);
      if (reqWords.some((word) => elText.includes(word))) {
        relatedElements.push(el.id);
      }
    }

    const covered = relatedElements.length > 0;
    const authWallObs = observations.find((o) => o.type === "auth-wall");

    return {
      requirement: req,
      covered,
      coverageNote: authWallObs
        ? "Auth wall detected — full coverage requires authentication"
        : covered
        ? `${relatedElements.length} related element(s) discovered`
        : "No directly related UI elements found — may require deeper navigation or authentication",
      relatedElements,
    };
  });
}

// ----------------------------------------------------------------------------
// Main explorer
// ----------------------------------------------------------------------------

export async function exploreUrl(
  input: ExplorationInput,
  options: { headless?: boolean } = {}
): Promise<ExplorationResult> {
  // Reset counters per run
  _observationCounter = 0;
  _elementCounter = 0;

  const validation = validateExplorationInput(input);
  if (!validation.valid) {
    return {
      target: {
        url: input?.url || "",
        module: input?.module || "",
        scope: input?.scope || "",
        requirements: input?.requirements || [],
      },
      status: "BLOCKED / MISSING REQUIREMENT",
      explorationStatus: "BLOCKED",
      exploredAt: new Date().toISOString(),
      pagesVisited: [],
      elements: [],
      workflows: [],
      observations: [],
      requirementsCoverage: (input?.requirements || []).map((r) => ({
        requirement: r,
        covered: false,
        coverageNote: "Exploration blocked — invalid input",
        relatedElements: [],
      })),
      warnings: [`Input validation failed: ${validation.error}`],
      provenance: [],
      error: validation.error,
      secretsMaskedCount: 0,
      promptInjectionDetected: false,
    };
  }

  const maxPages = input.maxPages ?? MAX_PAGES_DEFAULT;
  const allElements: DiscoveredElement[] = [];
  const allObservations: ExplorationObservation[] = [];
  const allProvenance: ExplorationProvenance[] = [];
  const pagesVisited: string[] = [];
  const warnings: string[] = [];
  let totalMasked = 0;
  let injectionDetected = false;
  let blocked = false;
  let blockedReason = "";

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: options.headless !== false });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (compatible; JiraPlaywrightAgent/1.0; QA-Explorer)",
    });
    const page = await context.newPage();

    // Navigate to initial URL
    try {
      await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const browserReason = browserUnavailableReason(err);
      return {
        target: { url: input.url, module: input.module, scope: input.scope, requirements: input.requirements },
        status: browserReason ? "BLOCKED" : "ERROR",
        explorationStatus: browserReason ? "BLOCKED" : "FAILED",
        exploredAt: new Date().toISOString(),
        pagesVisited: [],
        elements: [],
        workflows: [],
        observations: [{ id: nextObsId(), type: "error-state", description: `Failed to load URL: ${msg}`, url: input.url }],
        requirementsCoverage: input.requirements.map((r) => ({
          requirement: r, covered: false, coverageNote: "Exploration failed — URL unreachable", relatedElements: [],
        })),
        warnings: [browserReason ? `${browserReason}: run npx playwright install` : `URL navigation failed: ${msg}`],
        provenance: [],
        error: browserReason || msg,
        secretsMaskedCount: 0,
        promptInjectionDetected: false,
      };
    }

    const visitedUrls = new Set<string>([input.url]);
    const queue: string[] = [input.url];

    while (queue.length > 0 && pagesVisited.length < maxPages) {
      const currentUrl = queue.shift()!;

      if (pagesVisited.includes(currentUrl)) continue;
      pagesVisited.push(currentUrl);

      // Navigate if not already on this page
      const currentPageUrl = page.url();
      if (currentPageUrl !== currentUrl) {
        try {
          await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        } catch {
          warnings.push(`Failed to navigate to: ${currentUrl}`);
          continue;
        }
      }

      const { elements, observations, pageTitle, hasAuthWall } = await inspectPage(
        page,
        currentUrl,
        input.module,
        input.requirements
      );

      // Sanitize page title
      const { sanitized: sanitizedTitle, maskedCount: titleMasked } = sanitizeSecrets(pageTitle);
      totalMasked += titleMasked;

      // Check for prompt injection in page title
      const titleInjections = detectPromptInjections(sanitizedTitle);
      if (titleInjections.length > 0) {
        injectionDetected = true;
        warnings.push(`PROMPT INJECTION ATTEMPT DETECTED in page title at ${currentUrl}`);
      }

      if (hasAuthWall) {
        blocked = true;
        blockedReason = `Authentication required at ${currentUrl} but no authenticated session or credentials were provided`;
        warnings.push(blockedReason);
      }

      allElements.push(...elements);
      allObservations.push(...observations);
      allProvenance.push({
        url: currentUrl,
        pageTitle: sanitizedTitle,
        visitedAt: new Date().toISOString(),
        elementCount: elements.length,
      });

      // Discover in-scope links for further exploration (scoped, not blind crawl)
      if (pagesVisited.length < maxPages && !hasAuthWall) {
        try {
          const links = await page.locator("a[href]").all();
          for (const link of links.slice(0, 20)) {
            try {
              const href = await link.getAttribute("href");
              if (!href) continue;

              let absoluteUrl: string;
              try {
                absoluteUrl = new URL(href, currentUrl).toString();
              } catch {
                continue;
              }

              // Only follow same-origin links
              const base = new URL(input.url);
              const target = new URL(absoluteUrl);
              if (target.origin !== base.origin) continue;

              // Scope check — only follow if link text relates to module/scope
              const linkText = (await link.textContent() || "").toLowerCase();
              const scopeWords = [input.module, input.scope, ...input.requirements]
                .join(" ")
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length > 3);

              const isRelevant = scopeWords.some((w) => linkText.includes(w) || absoluteUrl.toLowerCase().includes(w));

              if (isRelevant && !visitedUrls.has(absoluteUrl)) {
                visitedUrls.add(absoluteUrl);
                queue.push(absoluteUrl);
              }
            } catch {
              // stale link — skip
            }
          }
        } catch {
          // link discovery failed — non-fatal
        }
      }
    }

    await browser.close();
    browser = null;

    const workflows = inferWorkflows(allElements, input.requirements, input.module);
    const requirementsCoverage = assessRequirementCoverage(
      input.requirements,
      allElements,
      allObservations
    );

    const status: ExplorationStatus = blocked
      ? "BLOCKED / AUTH REQUIRED"
      : allElements.length > 0
      ? "SUCCESS"
      : pagesVisited.length > 0
      ? "PARTIAL"
      : "ERROR";

    return {
      target: { url: input.url, module: input.module, scope: input.scope, requirements: input.requirements },
      status,
      explorationStatus: blocked ? "BLOCKED" : allElements.length > 0 ? "SUCCESS" : pagesVisited.length > 0 ? "PARTIAL" : "FAILED",
      exploredAt: new Date().toISOString(),
      pagesVisited,
      elements: allElements,
      workflows,
      observations: allObservations,
      requirementsCoverage,
      warnings,
      provenance: allProvenance,
      error: blocked ? blockedReason : undefined,
      secretsMaskedCount: totalMasked,
      promptInjectionDetected: injectionDetected,
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    const browserReason = browserUnavailableReason(err);
    return {
      target: { url: input.url, module: input.module, scope: input.scope, requirements: input.requirements },
      status: browserReason ? "BLOCKED" : "ERROR",
      explorationStatus: browserReason ? "BLOCKED" : "FAILED",
      exploredAt: new Date().toISOString(),
      pagesVisited,
      elements: allElements,
      workflows: [],
      observations: allObservations,
      requirementsCoverage: input.requirements.map((r) => ({
        requirement: r, covered: false, coverageNote: "Exploration failed", relatedElements: [],
      })),
      warnings: [...warnings, browserReason ? `${browserReason}: run npx playwright install` : `Exploration error: ${msg}`],
      provenance: allProvenance,
      error: browserReason || msg,
      secretsMaskedCount: totalMasked,
      promptInjectionDetected: injectionDetected,
    };
  }
}
