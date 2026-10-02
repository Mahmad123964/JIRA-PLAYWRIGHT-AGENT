import { detectPromptInjections, sanitizeSecrets } from "./document-ingestion";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type GitHubIntegrationStatus =
  | "AVAILABLE"
  | "PARTIALLY_AVAILABLE"
  | "UNAVAILABLE"
  | "BLOCKED";

export type GitHubRecordClassification =
  | "CONFIRMED"
  | "SUPPORTED"
  | "INFORMATIONAL"
  | "CONFLICTING"
  | "UNKNOWN";

export type GitHubConflictKind =
  | "METHOD"
  | "STATUS_CODE"
  | "ENDPOINT"
  | "UI_TEXT"
  | "AUTH"
  | "SCHEMA"
  | "PERMISSION";

export interface GitHubProvenance {
  source: "GitHub";
  repository: string;
  path: string;
  ref: string;
  url?: string;
  lineRange?: { start: number; end: number };
}

export interface GitHubRecord {
  sourceType: "github";
  repository: string;
  path: string;
  ref: string;
  content: string;
  provenance: GitHubProvenance;
}

export interface GitHubTechnicalFact {
  fact: string;
  classification: GitHubRecordClassification;
  authority: "TECHNICAL_EVIDENCE";
  supportingPath: string;
  provenance: GitHubProvenance;
}

export interface GitHubConflict {
  githubFact: string;
  githubSource: GitHubProvenance;
  jiraFact: string;
  kind: GitHubConflictKind;
  detail: string;
}

export interface GitHubIntegrationHealth {
  integration: "GitHub";
  status: GitHubIntegrationStatus;
  authenticated: boolean;
  searchAvailable: boolean;
  fileReadAvailable: boolean;
  recordsInspected: number;
  recordsAccepted: number;
  recordsRejected: number;
  promptInjectionsDetected: number;
  secretsMasked: number;
  conflictsDetected: number;
}

export interface GitHubConfig {
  token: string;
  apiBaseUrl: string;
  repository: string;
  owner: string;
  ref: string;
}

export interface GitHubFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export type GitHubFetch = (
  url: string,
  init?: RequestInit
) => Promise<GitHubFetchResponse>;

export interface JiraFactEndpoint {
  path: string;
  method?: string;
  expectedStatus?: number;
}

export interface JiraFacts {
  endpoints?: JiraFactEndpoint[];
  expectedUiText?: string[];
  authModel?: string;
  summary?: string;
}

export interface GitHubIngestionOptions {
  githubConfig?: GitHubConfig | null;
  fetchImpl?: GitHubFetch;
  maskSecrets?: boolean;
  detectPromptInjection?: boolean;
  maxFiles?: number;
  // Relevance context — scoped discovery, never blind
  jiraTicketKey?: string;
  jiraSummary?: string;
  featureKeywords?: string[];
  endpointNames?: string[];
  testNames?: string[];
  apiRouteNames?: string[];
  configRefs?: string[];
  // Jira authority facts for conflict detection
  jiraFacts?: JiraFacts;
}

export interface GitHubIngestionResult {
  sourceType: "github";
  status: GitHubIntegrationStatus;
  repository: string;
  ref: string;
  records: GitHubRecord[];
  technicalFacts: GitHubTechnicalFact[];
  promptInjectionDetected: boolean;
  promptInjectionAttempts: string[];
  secretsMaskedCount: number;
  conflicts: GitHubConflict[];
  conflictResult: "E. BLOCKED / REQUIREMENT CONFLICT" | "NO MATERIAL CONFLICT";
  error?: string;
  integrationHealth: GitHubIntegrationHealth;
}

// ----------------------------------------------------------------------------
// Internal GitHub API types
// ----------------------------------------------------------------------------

interface GitHubTreeItem {
  path?: string;
  type?: string;
  sha?: string;
  url?: string;
}

interface GitHubSearchItem {
  path?: string;
  repository?: { full_name?: string };
  html_url?: string;
}

// ----------------------------------------------------------------------------
// Relevant file patterns (Section 50.1)
// ----------------------------------------------------------------------------

const RELEVANT_FILE_PATTERNS: RegExp[] = [
  /README(\.\w+)?$/i,
  /package\.json$/i,
  /package-lock\.json$/i,
  /tsconfig(\.\w+)?\.json$/i,
  /playwright\.config\.\w+$/i,
  /openapi\.(yaml|yml|json)$/i,
  /swagger\.(yaml|yml|json)$/i,
  /\.openapi\.(yaml|yml|json)$/i,
  /\.swagger\.(yaml|yml|json)$/i,
  /schema\.(json|yaml|yml)$/i,
  /\.schema\.(json|yaml|yml)$/i,
  /\.env\.example$/i,
  /\.env\.sample$/i,
  /\.env\.template$/i,
];

// File extensions that may contain technical facts
const TECHNICAL_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs",
  ".json", ".yaml", ".yml",
  ".md", ".html",
]);

// Patterns that indicate API route definitions
const ROUTE_PATTERNS: RegExp[] = [
  /\b(app|router)\.(get|post|put|patch|delete|head|options)\s*\(/i,
  /\bpath\s*:\s*['"`]\/[^'"`]+['"`]/i,
  /\b(GET|POST|PUT|PATCH|DELETE)\s+\/\S+/,
  /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(/,
];

// Patterns that indicate test files
const TEST_FILE_PATTERNS: RegExp[] = [
  /\.spec\.(ts|js)$/i,
  /\.test\.(ts|js)$/i,
  /tests?\//i,
  /__tests__\//i,
];

// Patterns that indicate TypeScript interfaces/types
const TS_INTERFACE_PATTERNS: RegExp[] = [
  /\binterface\s+\w+/,
  /\btype\s+\w+\s*=/,
  /\benum\s+\w+/,
];

// Secret variable name patterns — detect names only, never values
const ENV_VAR_NAME_PATTERN =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|AUTH|CREDENTIAL)[A-Z0-9_]*)\s*=/g;

const DEFAULT_MAX_FILES = 30;

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

export function getGitHubConfig(): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const repoFull = process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repoFull.includes("/")
    ? repoFull.split("/", 2)
    : [process.env.GITHUB_OWNER || "", process.env.GITHUB_REPO || repoFull];

  if (!owner || !repo) return null;

  return {
    token,
    apiBaseUrl: (process.env.GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/+$/, ""),
    repository: repo,
    owner,
    ref: process.env.GITHUB_REF || process.env.GITHUB_BRANCH || "main",
  };
}

function githubHeaders(config: GitHubConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// ----------------------------------------------------------------------------
// Relevance helpers
// ----------------------------------------------------------------------------

export function buildGitHubKeywords(options: GitHubIngestionOptions): string[] {
  const set = new Set<string>();
  const addWords = (value?: string) => {
    if (!value) return;
    for (const word of value.split(/[^A-Za-z0-9_/-]+/)) {
      const t = word.trim();
      if (t.length >= 3) set.add(t.toLowerCase());
    }
  };
  if (options.jiraTicketKey) {
    set.add(options.jiraTicketKey.toLowerCase());
    const base = options.jiraTicketKey.split("-")[0];
    if (base) set.add(base.toLowerCase());
  }
  if (options.jiraSummary) addWords(options.jiraSummary);
  for (const kw of options.featureKeywords || []) addWords(kw);
  for (const ep of options.endpointNames || []) addWords(ep);
  for (const tn of options.testNames || []) addWords(tn);
  for (const ar of options.apiRouteNames || []) addWords(ar);
  for (const cr of options.configRefs || []) addWords(cr);
  return Array.from(set);
}

export function isRelevantFile(filePath: string, keywords: string[]): boolean {
  const lower = filePath.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));

  // Always include known relevant file patterns
  if (RELEVANT_FILE_PATTERNS.some((p) => p.test(filePath))) return true;

  // Include test files
  if (TEST_FILE_PATTERNS.some((p) => p.test(filePath))) return true;

  // Include files with technical extensions that match keywords
  if (TECHNICAL_EXTENSIONS.has(ext)) {
    if (keywords.length === 0) return true;
    return keywords.some((k) => lower.includes(k));
  }

  return false;
}

/**
 * Structural files (README, package.json, tsconfig, openapi, playwright.config, .env.example)
 * are always accepted regardless of content keywords — they provide project-level technical context.
 */
const ALWAYS_ACCEPT_PATTERNS: RegExp[] = [
  /README(\.\w+)?$/i,
  /package\.json$/i,
  /package-lock\.json$/i,
  /tsconfig(\.[\w.]+)?\.json$/i,
  /playwright\.config\.\w+$/i,
  /openapi\.(yaml|yml|json)$/i,
  /swagger\.(yaml|yml|json)$/i,
  /\.env\.example$/i,
  /\.env\.sample$/i,
  /\.env\.template$/i,
];

function contentIsRelevant(content: string, filePath: string, keywords: string[]): boolean {
  // Structural files are always accepted
  if (ALWAYS_ACCEPT_PATTERNS.some((p) => p.test(filePath))) return true;
  if (keywords.length === 0) return true;
  const lower = content.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

// ----------------------------------------------------------------------------
// Technical fact extraction (Section 53)
// ----------------------------------------------------------------------------

export function extractTechnicalFacts(
  content: string,
  filePath: string,
  provenance: GitHubProvenance
): string[] {
  const facts: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;

    // HTTP routes
    for (const pattern of ROUTE_PATTERNS) {
      if (pattern.test(line)) {
        facts.push(`Route definition: ${line.slice(0, 200)}`);
        break;
      }
    }

    // TypeScript interfaces/types
    for (const pattern of TS_INTERFACE_PATTERNS) {
      if (pattern.test(line)) {
        facts.push(`Type definition: ${line.slice(0, 200)}`);
        break;
      }
    }

    // OpenAPI/Swagger paths
    if (/^\s*(\/\w|\s+\/\w)/.test(line) && filePath.match(/\.(yaml|yml|json)$/i)) {
      if (/get:|post:|put:|patch:|delete:/i.test(lines[i + 1] || "")) {
        facts.push(`OpenAPI path: ${line.slice(0, 200)}`);
      }
    }

    // Environment variable names only (never values)
    const envMatches = line.matchAll(ENV_VAR_NAME_PATTERN);
    for (const match of envMatches) {
      facts.push(`Env var name: ${match[1]}`);
    }
  }

  return facts;
}

// ----------------------------------------------------------------------------
// Conflict detection (Section 54)
// ----------------------------------------------------------------------------

function detectHttpMethod(text: string): string | null {
  const m = text.match(/\b(get|post|put|patch|delete|head|options)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function detectStatusCode(text: string): number | null {
  const m = text.match(/\b(200|201|202|204|400|401|403|404|409|422|500|502|503)\b/);
  return m ? Number(m[1]) : null;
}

export function detectGitHubConflict(
  fact: string,
  provenance: GitHubProvenance,
  jiraFacts: JiraFacts
): GitHubConflict | null {
  const lower = fact.toLowerCase();
  const method = detectHttpMethod(lower);

  for (const endpoint of jiraFacts.endpoints || []) {
    const p = (endpoint.path || "").toLowerCase();
    if (p && lower.includes(p)) {
      if (endpoint.method && method && method !== endpoint.method.toLowerCase()) {
        return {
          githubFact: fact,
          githubSource: provenance,
          jiraFact: `Expected ${endpoint.path} to use ${endpoint.method.toUpperCase()}`,
          kind: "METHOD",
          detail: `GitHub source states ${method.toUpperCase()} for ${endpoint.path}`,
        };
      }
      const status = detectStatusCode(lower);
      if (endpoint.expectedStatus && status && status !== endpoint.expectedStatus) {
        return {
          githubFact: fact,
          githubSource: provenance,
          jiraFact: `Expected ${endpoint.path} to return ${endpoint.expectedStatus}`,
          kind: "STATUS_CODE",
          detail: `GitHub source states ${status} for ${endpoint.path}`,
        };
      }
    }
  }

  if (jiraFacts.authModel) {
    const authMatch = lower.match(/(bearer|basic|oauth|api key|session|cookie)/);
    if (authMatch && /auth|authenticate|token|header|credential/.test(lower)) {
      if (jiraFacts.authModel.toLowerCase() !== authMatch[1]) {
        return {
          githubFact: fact,
          githubSource: provenance,
          jiraFact: `Expected auth model: ${jiraFacts.authModel}`,
          kind: "AUTH",
          detail: `GitHub source mentions ${authMatch[1]}`,
        };
      }
    }
  }

  return null;
}

export function classifyGitHubFact(
  fact: string,
  jiraFacts?: JiraFacts
): GitHubRecordClassification {
  if (!jiraFacts) return "SUPPORTED";
  if (detectGitHubConflict(fact, { source: "GitHub", repository: "", path: "", ref: "" }, jiraFacts)) {
    return "CONFLICTING";
  }
  const lower = fact.toLowerCase();
  for (const endpoint of jiraFacts.endpoints || []) {
    const p = (endpoint.path || "").toLowerCase();
    if (p && lower.includes(p)) {
      const method = detectHttpMethod(lower);
      if (endpoint.method && method === endpoint.method.toLowerCase()) return "CONFIRMED";
    }
  }
  return "SUPPORTED";
}

// ----------------------------------------------------------------------------
// GitHub API calls
// ----------------------------------------------------------------------------

class GitHubApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function verifyGitHubAuth(
  config: GitHubConfig,
  fetchImpl: GitHubFetch
): Promise<boolean> {
  const res = await fetchImpl(`${config.apiBaseUrl}/user`, {
    method: "GET",
    headers: githubHeaders(config),
  });

  if (res.status === 401 || res.status === 403) {
    throw new GitHubApiError(`GitHub authentication failed: ${res.status}`, res.status);
  }
  if (!res.ok) {
    throw new GitHubApiError(`GitHub auth check failed: ${res.status}`, res.status);
  }

  const data = (await res.json()) as { login?: string; id?: number };
  return Boolean(data && (data.login || data.id));
}

async function getRepositoryTree(
  config: GitHubConfig,
  fetchImpl: GitHubFetch
): Promise<GitHubTreeItem[]> {
  const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/git/trees/${encodeURIComponent(config.ref)}?recursive=1`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: githubHeaders(config),
  });

  if (res.status === 401 || res.status === 403) {
    throw new GitHubApiError(`GitHub tree fetch authentication failed: ${res.status}`, res.status);
  }
  if (res.status === 404) {
    throw new GitHubApiError(
      `Repository or ref not found: ${config.owner}/${config.repository}@${config.ref}`,
      404
    );
  }
  if (!res.ok) {
    throw new GitHubApiError(`GitHub tree fetch failed: ${res.status}`, res.status);
  }

  const data = (await res.json()) as { tree?: GitHubTreeItem[]; truncated?: boolean };
  return data.tree ?? [];
}

async function searchRepositoryCode(
  query: string,
  config: GitHubConfig,
  fetchImpl: GitHubFetch,
  maxResults: number
): Promise<GitHubSearchItem[]> {
  const scopedQuery = `${query} repo:${config.owner}/${config.repository}`;
  const params = new URLSearchParams({
    q: scopedQuery,
    per_page: String(Math.min(maxResults, 30)),
  });

  const res = await fetchImpl(
    `${config.apiBaseUrl}/search/code?${params.toString()}`,
    {
      method: "GET",
      headers: githubHeaders(config),
    }
  );

  if (res.status === 401 || res.status === 403) {
    throw new GitHubApiError(`GitHub search authentication failed: ${res.status}`, res.status);
  }
  if (!res.ok) {
    // Search may be rate-limited or unavailable — non-fatal
    return [];
  }

  const data = (await res.json()) as { items?: GitHubSearchItem[] };
  return data.items ?? [];
}

async function fetchFileContent(
  filePath: string,
  config: GitHubConfig,
  fetchImpl: GitHubFetch
): Promise<string | null> {
  const url = `${config.apiBaseUrl}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(config.ref)}`;
  const res = await fetchImpl(url, {
    method: "GET",
    headers: githubHeaders(config),
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    content?: string;
    encoding?: string;
    type?: string;
    size?: number;
  };

  if (data.type !== "file") return null;
  // Skip large files (> 500KB)
  if (data.size && data.size > 512000) return null;

  if (data.encoding === "base64" && data.content) {
    try {
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
    } catch {
      return null;
    }
  }

  return null;
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

function createEmptyResult(repository = "", ref = ""): GitHubIngestionResult {
  return {
    sourceType: "github",
    status: "UNAVAILABLE",
    repository,
    ref,
    records: [],
    technicalFacts: [],
    promptInjectionDetected: false,
    promptInjectionAttempts: [],
    secretsMaskedCount: 0,
    conflicts: [],
    conflictResult: "NO MATERIAL CONFLICT",
    integrationHealth: {
      integration: "GitHub",
      status: "UNAVAILABLE",
      authenticated: false,
      searchAvailable: false,
      fileReadAvailable: false,
      recordsInspected: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      promptInjectionsDetected: 0,
      secretsMasked: 0,
      conflictsDetected: 0,
    },
  };
}

export async function ingestGitHub(
  options: GitHubIngestionOptions
): Promise<GitHubIngestionResult> {
  const config =
    options.githubConfig === undefined ? getGitHubConfig() : options.githubConfig;
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as GitHubFetch);
  const maskSecrets = options.maskSecrets !== false;
  const detectInjection = options.detectPromptInjection !== false;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  const repoName = config
    ? `${config.owner}/${config.repository}`
    : "";
  const ref = config?.ref ?? "";

  const base = createEmptyResult(repoName, ref);

  // 1. No credentials -> honest UNAVAILABLE (Section 61.1)
  if (!config) {
    return {
      ...base,
      status: "UNAVAILABLE",
      error:
        "GitHub integration is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repo) in .env.",
      integrationHealth: {
        ...base.integrationHealth,
        status: "UNAVAILABLE",
      },
    };
  }

  // 2. Verify authentication — never claim authenticated without proof
  let authenticated = false;
  try {
    authenticated = await verifyGitHubAuth(config, fetchImpl);
  } catch (err) {
    const isAuthErr =
      err instanceof GitHubApiError && (err.status === 401 || err.status === 403);
    return {
      ...base,
      status: isAuthErr ? "BLOCKED" : "UNAVAILABLE",
      error: `GitHub authentication failed: ${errorMessage(err)}`,
      integrationHealth: {
        ...base.integrationHealth,
        status: isAuthErr ? "BLOCKED" : "UNAVAILABLE",
      },
    };
  }

  if (!authenticated) {
    return {
      ...base,
      status: "BLOCKED",
      error: "GitHub authentication could not be verified.",
      integrationHealth: { ...base.integrationHealth, status: "BLOCKED" },
    };
  }

  // 3. Build relevance keywords
  const keywords = buildGitHubKeywords(options);

  const records: GitHubRecord[] = [];
  const technicalFacts: GitHubTechnicalFact[] = [];
  const allInjections: string[] = [];
  const conflicts: GitHubConflict[] = [];
  let totalMasked = 0;
  let recordsInspected = 0;
  let recordsRejected = 0;
  let searchAvailable = false;
  let fileReadAvailable = false;

  // 4. Discover relevant files via tree + optional code search
  const candidatePaths = new Set<string>();

  try {
    const tree = await getRepositoryTree(config, fetchImpl);
    searchAvailable = true;

    for (const item of tree) {
      if (item.type !== "blob" || !item.path) continue;
      if (isRelevantFile(item.path, keywords)) {
        candidatePaths.add(item.path);
      }
    }
  } catch (err) {
    const isAuthErr =
      err instanceof GitHubApiError && (err.status === 401 || err.status === 403);
    if (isAuthErr) {
      return {
        ...base,
        status: "BLOCKED",
        error: `GitHub repository access failed: ${errorMessage(err)}`,
        integrationHealth: {
          ...base.integrationHealth,
          authenticated: true,
          status: "BLOCKED",
        },
      };
    }
    // Non-auth failure — try code search as fallback
  }

  // 5. Scoped code search for additional relevant files (when keywords exist)
  if (keywords.length > 0) {
    try {
      const searchQuery = keywords.slice(0, 3).join(" OR ");
      const searchItems = await searchRepositoryCode(
        searchQuery,
        config,
        fetchImpl,
        maxFiles
      );
      for (const item of searchItems) {
        if (item.path) candidatePaths.add(item.path);
      }
    } catch {
      // Code search failure is non-fatal
    }
  }

  // 6. Fetch and process each candidate file
  const pathsToProcess = Array.from(candidatePaths).slice(0, maxFiles);

  for (const filePath of pathsToProcess) {
    recordsInspected++;

    const rawContent = await fetchFileContent(filePath, config, fetchImpl);
    if (rawContent === null) {
      recordsRejected++;
      continue;
    }

    fileReadAvailable = true;

    // Content-level relevance check
    if (!contentIsRelevant(rawContent, filePath, keywords)) {
      recordsRejected++;
      continue;
    }

    let content = rawContent;

    // Secret masking (Section 63, 56.3)
    if (maskSecrets) {
      const { sanitized, maskedCount } = sanitizeSecrets(content);
      content = sanitized;
      totalMasked += maskedCount;
    }

    // Prompt injection detection (Section 56)
    if (detectInjection) {
      const injections = detectPromptInjections(content);
      if (injections.length > 0) allInjections.push(...injections);
    }

    const provenance: GitHubProvenance = {
      source: "GitHub",
      repository: repoName,
      path: filePath,
      ref: config.ref,
      url: `https://github.com/${repoName}/blob/${config.ref}/${filePath}`,
    };

    records.push({
      sourceType: "github",
      repository: repoName,
      path: filePath,
      ref: config.ref,
      content: content.slice(0, 8000), // cap excerpt size
      provenance,
    });

    // Extract technical facts (Section 50.2 — TECHNICAL EVIDENCE, not requirements)
    const facts = extractTechnicalFacts(content, filePath, provenance);
    for (const fact of facts) {
      const classification = classifyGitHubFact(fact, options.jiraFacts);

      technicalFacts.push({
        fact,
        classification,
        authority: "TECHNICAL_EVIDENCE",
        supportingPath: filePath,
        provenance,
      });

      // Conflict detection (Section 54)
      if (options.jiraFacts) {
        const conflict = detectGitHubConflict(fact, provenance, options.jiraFacts);
        if (conflict) conflicts.push(conflict);
      }
    }
  }

  const status: GitHubIntegrationStatus =
    records.length > 0
      ? "AVAILABLE"
      : searchAvailable
      ? "PARTIALLY_AVAILABLE"
      : "UNAVAILABLE";

  return {
    ...base,
    status,
    records,
    technicalFacts,
    promptInjectionDetected: allInjections.length > 0,
    promptInjectionAttempts: allInjections,
    secretsMaskedCount: totalMasked,
    conflicts,
    conflictResult:
      conflicts.length > 0 ? "E. BLOCKED / REQUIREMENT CONFLICT" : "NO MATERIAL CONFLICT",
    integrationHealth: {
      integration: "GitHub",
      status,
      authenticated: true,
      searchAvailable,
      fileReadAvailable,
      recordsInspected,
      recordsAccepted: records.length,
      recordsRejected,
      promptInjectionsDetected: allInjections.length,
      secretsMasked: totalMasked,
      conflictsDetected: conflicts.length,
    },
  };
}
