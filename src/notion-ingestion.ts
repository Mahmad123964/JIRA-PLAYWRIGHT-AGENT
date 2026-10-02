import { detectPromptInjections, sanitizeSecrets } from "./document-ingestion";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type NotionIntegrationStatus =
  | "AVAILABLE"
  | "PARTIALLY_AVAILABLE"
  | "UNAVAILABLE"
  | "BLOCKED";

export type NotionRequirementClassification =
  | "CONFIRMED"
  | "SUPPORTED"
  | "INFORMATIONAL"
  | "CONFLICTING"
  | "UNKNOWN";

export type NotionRequirementAuthority = "SUPPORTING" | "INFORMATIONAL";

export interface NotionProvenance {
  source: "Notion";
  pageId: string;
  title: string;
  url?: string;
}

export interface NotionRecord {
  pageId: string;
  title: string;
  url?: string;
  content: string;
  provenance: NotionProvenance;
}

export interface NotionRequirement {
  requirement: string;
  sourceType: "notion";
  sourceId: string;
  sourceTitle: string;
  location?: string;
  classification: NotionRequirementClassification;
  authority: NotionRequirementAuthority;
  provenance: NotionProvenance;
}

export type NotionConflictKind =
  | "METHOD"
  | "STATUS_CODE"
  | "ENDPOINT"
  | "UI_TEXT"
  | "AUTH"
  | "SCHEMA"
  | "PERMISSION";

export interface NotionConflict {
  notionRequirement: string;
  notionSource: NotionProvenance | null;
  jiraFact: string;
  kind: NotionConflictKind;
  detail: string;
}

export interface NotionIntegrationHealth {
  integration: "Notion";
  status: NotionIntegrationStatus;
  authenticated: boolean;
  searchAvailable: boolean;
  pageReadAvailable: boolean;
}

export interface NotionPageSummary {
  pageId: string;
  title: string;
  url?: string;
}

export interface NotionConfig {
  integrationToken: string;
  apiBaseUrl: string;
  notionVersion: string;
}

export interface NotionFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export type NotionFetch = (
  url: string,
  init?: RequestInit
) => Promise<NotionFetchResponse>;

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

export interface NotionIngestionOptions {
  query?: string;
  notionConfig?: NotionConfig | null;
  fetchImpl?: NotionFetch;
  maskSecrets?: boolean;
  detectPromptInjection?: boolean;
  maxPages?: number;
  // Relevance context (used to avoid blind ingestion of the whole workspace)
  jiraTicketKey?: string;
  jiraSummary?: string;
  featureName?: string;
  projectName?: string;
  // Jira authority facts, used for conflict detection
  jiraFacts?: JiraFacts;
}

export interface NotionIngestionResult {
  sourceType: "notion";
  status: NotionIntegrationStatus;
  records: NotionRecord[];
  requirements: NotionRequirement[];
  promptInjectionDetected: boolean;
  promptInjectionAttempts: string[];
  secretsMaskedCount: number;
  conflicts: NotionConflict[];
  conflictResult: "E. BLOCKED / REQUIREMENT CONFLICT" | "NO MATERIAL CONFLICT";
  error?: string;
  integrationHealth: NotionIntegrationHealth;
}

// ----------------------------------------------------------------------------
// Internal structures
// ----------------------------------------------------------------------------

interface ContentBlock {
  text: string;
  section: string;
}

interface NotionRichText {
  plain_text?: string;
  text?: { content?: string };
}

interface NotionApiPage {
  object: "page";
  id: string;
  url?: string;
  properties?: Record<string, unknown>;
}

interface NotionApiBlock {
  object: "block";
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

const DEFAULT_NOTION_API_BASE_URL = "https://api.notion.com/v1";
const DEFAULT_NOTION_VERSION = "2022-06-28";
const DEFAULT_MAX_PAGES = 20;
const MAX_NOTION_DEPTH = 5;

// ----------------------------------------------------------------------------
// Error handling
// ----------------------------------------------------------------------------

class NotionApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isHttpStatus(err: unknown, status: number): boolean {
  return err instanceof NotionApiError && err.status === status;
}

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

export function getNotionConfig(): NotionConfig | null {
  const token =
    process.env.NOTION_INTEGRATION_TOKEN ||
    process.env.NOTION_API_TOKEN ||
    process.env.NOTION_API_KEY;

  if (!token) {
    return null;
  }

  return {
    integrationToken: token,
    apiBaseUrl: (process.env.NOTION_API_BASE_URL || DEFAULT_NOTION_API_BASE_URL).replace(/\/+$/, ""),
    notionVersion: process.env.NOTION_VERSION || DEFAULT_NOTION_VERSION,
  };
}

function notionHeaders(config: NotionConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.integrationToken}`,
    "Notion-Version": config.notionVersion,
    "Content-Type": "application/json",
  };
}

// ----------------------------------------------------------------------------
// Keyword / relevance helpers
// ----------------------------------------------------------------------------

export function buildRelevanceKeywords(options: NotionIngestionOptions): string[] {
  const set = new Set<string>();

  const addWords = (value?: string) => {
    if (!value) return;
    for (const word of value.split(/[^A-Za-z0-9_-]+/)) {
      const trimmed = word.trim();
      if (trimmed.length >= 3) {
        set.add(trimmed.toLowerCase());
      }
    }
  };

  if (options.query) addWords(options.query);
  if (options.jiraTicketKey) {
    set.add(options.jiraTicketKey.toLowerCase());
    const baseKey = options.jiraTicketKey.split("-")[0];
    if (baseKey) set.add(baseKey.toLowerCase());
  }
  if (options.jiraSummary) addWords(options.jiraSummary);
  if (options.featureName) addWords(options.featureName);
  if (options.projectName) addWords(options.projectName);

  return Array.from(set);
}

function pageTitleMatchesKeywords(title: string, keywords: string[]): boolean {
  const lowerTitle = title.toLowerCase();
  return keywords.some((keyword) => lowerTitle.includes(keyword));
}

function contentMatchesKeywords(title: string, content: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const haystack = `${title}\n${content}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

// ----------------------------------------------------------------------------
// Notion API calls
// ----------------------------------------------------------------------------

async function verifyNotionAuth(
  config: NotionConfig,
  fetchImpl: NotionFetch
): Promise<boolean> {
  const res = await fetchImpl(`${config.apiBaseUrl}/users/me`, {
    method: "GET",
    headers: notionHeaders(config),
  });

  if (res.status === 401 || res.status === 403) {
    throw new NotionApiError(`Notion authentication failed: ${res.status}`, res.status);
  }

  if (!res.ok) {
    throw new NotionApiError(`Notion auth check failed: ${res.status}`, res.status);
  }

  const data = (await res.json()) as { object?: string; id?: string };
  // A 200 response with a parseable user object proves the token is valid.
  return Boolean(data && (data.object === "user" || data.id));
}

function extractPageTitle(page: NotionApiPage): string {
  const props = page.properties || {};
  for (const value of Object.values(props)) {
    const property = value as { type?: string; title?: NotionRichText[] };
    if (property.type === "title" && Array.isArray(property.title)) {
      return property.title
        .map((t) => t.plain_text ?? t.text?.content ?? "")
        .join("");
    }
  }
  return "";
}

async function searchNotionPages(
  query: string,
  config: NotionConfig,
  fetchImpl: NotionFetch
): Promise<NotionPageSummary[]> {
  const body: Record<string, unknown> = {
    page_size: 100,
  };
  if (query) {
    body.query = query;
  }

  const res = await fetchImpl(`${config.apiBaseUrl}/search`, {
    method: "POST",
    headers: notionHeaders(config),
    body: JSON.stringify(body),
  });

  if (res.status === 401 || res.status === 403) {
    throw new NotionApiError(`Notion search authentication failed: ${res.status}`, res.status);
  }
  if (!res.ok) {
    throw new NotionApiError(`Notion search failed: ${res.status}`, res.status);
  }

  const data = (await res.json()) as { results?: NotionApiPage[] };
  if (!data || !Array.isArray(data.results)) {
    throw new NotionApiError("Malformed Notion search response: missing results array", 200);
  }

  return data.results
    .filter((page): page is NotionApiPage => Boolean(page && page.object === "page"))
    .map((page) => ({
      pageId: page.id,
      title: extractPageTitle(page),
      url: page.url,
    }));
}

async function fetchBlockChildren(
  blockId: string,
  config: NotionConfig,
  fetchImpl: NotionFetch
): Promise<NotionApiBlock[]> {
  const res = await fetchImpl(
    `${config.apiBaseUrl}/blocks/${encodeURIComponent(blockId)}/children`,
    {
      method: "GET",
      headers: notionHeaders(config),
    }
  );

  if (res.status === 401 || res.status === 403) {
    throw new NotionApiError(`Notion block fetch authentication failed: ${res.status}`, res.status);
  }
  if (!res.ok) {
    throw new NotionApiError(`Notion block fetch failed: ${res.status}`, res.status);
  }

  const data = (await res.json()) as { results?: NotionApiBlock[] };
  if (!data || !Array.isArray(data.results)) {
    throw new NotionApiError("Malformed Notion block response: missing results array", 200);
  }

  return data.results;
}

// ----------------------------------------------------------------------------
// Block -> content conversion
// ----------------------------------------------------------------------------

function extractRichText(block: NotionApiBlock): NotionRichText[] {
  const payload = block[block.type] as { rich_text?: NotionRichText[] } | undefined;
  return payload?.rich_text ?? [];
}

function richTextToString(richText: NotionRichText[]): string {
  return richText
    .map((t) => t.plain_text ?? t.text?.content ?? "")
    .join("");
}

function isSectionBlock(block: NotionApiBlock): boolean {
  return (
    block.type === "heading_1" ||
    block.type === "heading_2" ||
    block.type === "heading_3" ||
    block.type === "child_page"
  );
}

function blockToContentBlock(
  block: NotionApiBlock,
  currentSection: string
): ContentBlock | null {
  const text = richTextToString(extractRichText(block));

  switch (block.type) {
    case "heading_1":
      return { text: `# ${text}\n`, section: text };
    case "heading_2":
      return { text: `## ${text}\n`, section: text };
    case "heading_3":
      return { text: `### ${text}\n`, section: text };
    case "paragraph":
      return { text: `${text}\n`, section: currentSection };
    case "bulleted_list_item":
      return { text: `- ${text}\n`, section: currentSection };
    case "numbered_list_item":
      return { text: `${text}\n`, section: currentSection };
    case "to_do":
      return { text: `- [ ] ${text}\n`, section: currentSection };
    case "quote":
      return { text: `> ${text}\n`, section: currentSection };
    case "code":
      return { text: `\`\`\`\n${text}\n\`\`\`\n`, section: currentSection };
    case "callout":
      return { text: `${text}\n`, section: currentSection };
    case "divider":
      return { text: "---\n", section: currentSection };
    case "child_page": {
      const title = (block.child_page as { title?: string } | undefined)?.title ?? "";
      return { text: `# ${title}\n`, section: title };
    }
    case "table_row": {
      const cells = (block.table_row as { cells?: NotionRichText[][] } | undefined)?.cells ?? [];
      const rowText = cells.map((cell) => richTextToString(cell)).join(" | ");
      return { text: `| ${rowText} |\n`, section: currentSection };
    }
    default: {
      if (text) {
        return { text: `${text}\n`, section: currentSection };
      }
      return null;
    }
  }
}

async function collectBlockContent(
  blocks: NotionApiBlock[],
  config: NotionConfig,
  fetchImpl: NotionFetch,
  depth: number,
  currentSection: string,
  visited: Set<string>
): Promise<ContentBlock[]> {
  if (depth > MAX_NOTION_DEPTH) {
    return [];
  }

  const out: ContentBlock[] = [];

  for (const block of blocks) {
    const own = blockToContentBlock(block, currentSection);
    if (own) {
      out.push(own);
      if (isSectionBlock(block)) {
        currentSection = own.section;
      }
    }

    if (block.has_children && !visited.has(block.id)) {
      visited.add(block.id);
      const childBlocks = await fetchBlockChildren(block.id, config, fetchImpl);
      const childContent = await collectBlockContent(
        childBlocks,
        config,
        fetchImpl,
        depth + 1,
        currentSection,
        visited
      );
      out.push(...childContent);
    }
  }

  return out;
}

async function getPageContentBlocks(
  pageId: string,
  config: NotionConfig,
  fetchImpl: NotionFetch
): Promise<ContentBlock[]> {
  const rootBlocks = await fetchBlockChildren(pageId, config, fetchImpl);
  const visited = new Set<string>([pageId]);
  return collectBlockContent(rootBlocks, config, fetchImpl, 0, "", visited);
}

// ----------------------------------------------------------------------------
// Requirement extraction
// ----------------------------------------------------------------------------

const REQUIREMENT_KEYWORDS =
  /\b(must|shall|should|required|requires|acceptance criteria|the system (must|shall)|the (app|api|application|user) (can|should|must|shall)|returns?|endpoint|route|status code|http (get|post|put|patch|delete)|method|schema|authentication|authorization|permission|permissions|validate|reject|accept|support|error code)\b/i;

function splitRequirementStatements(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*]\s+/, "")
        .replace(/^>\s*/, "")
        .replace(/^`{3}/, "")
        .replace(/`{3}$/, "")
        .trim()
    )
    .filter(Boolean);

  const statements: string[] = [];
  for (const line of lines) {
    const sentences = line.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length >= 8) {
        statements.push(trimmed);
      }
    }
  }
  return statements;
}

function extractRequirements(
  contentBlocks: ContentBlock[],
  provenance: NotionProvenance,
  keywords: string[]
): NotionRequirement[] {
  const out: NotionRequirement[] = [];
  const textKeywords = keywords.join(" ").toLowerCase();

  for (const block of contentBlocks) {
    const statements = splitRequirementStatements(block.text);
    for (const statement of statements) {
      if (
        REQUIREMENT_KEYWORDS.test(statement) ||
        (textKeywords && statement.toLowerCase().includes(textKeywords))
      ) {
        out.push({
          requirement: statement,
          sourceType: "notion",
          sourceId: provenance.pageId,
          sourceTitle: provenance.title,
          location: block.section || undefined,
          classification: "SUPPORTED",
          authority: "SUPPORTING",
          provenance,
        });
      }
    }
  }

  return out;
}

// ----------------------------------------------------------------------------
// Classification & conflict detection
// ----------------------------------------------------------------------------

function detectHttpMethod(text: string): string | null {
  const match = text.match(/\b(get|post|put|patch|delete|head|options)\b/);
  return match ? match[1] : null;
}

function detectStatusInText(text: string): number | null {
  const match = text.match(/\b(200|201|202|204|400|401|403|404|409|422|500|502|503)\b/);
  return match ? Number(match[1]) : null;
}

function findMaterialConflict(
  requirement: string,
  jiraFacts: JiraFacts
): { kind: NotionConflictKind; jiraFact: string; detail: string } | null {
  const text = requirement.toLowerCase();
  const method = detectHttpMethod(text);

  for (const endpoint of jiraFacts.endpoints || []) {
    const path = (endpoint.path || "").toLowerCase();
    if (path && text.includes(path)) {
      if (endpoint.method && method && method !== endpoint.method.toLowerCase()) {
        return {
          kind: "METHOD",
          jiraFact: `Expected ${endpoint.path} to use ${endpoint.method.toUpperCase()}`,
          detail: `Notion states ${method.toUpperCase()} for ${endpoint.path}`,
        };
      }

      const status = detectStatusInText(text);
      if (endpoint.expectedStatus && status && status !== endpoint.expectedStatus) {
        return {
          kind: "STATUS_CODE",
          jiraFact: `Expected ${endpoint.path} to return ${endpoint.expectedStatus}`,
          detail: `Notion states ${status} for ${endpoint.path}`,
        };
      }
    }
  }

  if (jiraFacts.authModel) {
    const authMatch = text.match(/(bearer|basic|oauth|api key|session|cookie)/);
    if (authMatch && /auth|authenticate|token|header|credential|key/.test(text)) {
      if (jiraFacts.authModel.toLowerCase() !== authMatch[1]) {
        return {
          kind: "AUTH",
          jiraFact: `Expected auth model: ${jiraFacts.authModel}`,
          detail: `Notion mentions ${authMatch[1]}`,
        };
      }
    }
  }

  return null;
}

export function detectMaterialConflict(
  requirement: string,
  provenance: NotionProvenance | null,
  jiraFacts: JiraFacts
): NotionConflict | null {
  const found = findMaterialConflict(requirement, jiraFacts);
  if (!found) return null;
  return {
    notionRequirement: requirement,
    notionSource: provenance,
    jiraFact: found.jiraFact,
    kind: found.kind,
    detail: found.detail,
  };
}

function corroboratesJira(requirement: string, jiraFacts: JiraFacts): boolean {
  const text = requirement.toLowerCase();

  for (const endpoint of jiraFacts.endpoints || []) {
    const path = (endpoint.path || "").toLowerCase();
    if (path && text.includes(path)) {
      const method = detectHttpMethod(text);
      if (endpoint.method && method === endpoint.method.toLowerCase()) {
        return true;
      }
      const status = detectStatusInText(text);
      if (endpoint.expectedStatus && status === endpoint.expectedStatus) {
        return true;
      }
    }
  }

  if (jiraFacts.expectedUiText) {
    for (const uiText of jiraFacts.expectedUiText) {
      if (text.includes(uiText.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

export function classifyRequirement(
  requirement: string,
  jiraFacts?: JiraFacts
): NotionRequirementClassification {
  if (!jiraFacts) {
    return "SUPPORTED";
  }
  if (findMaterialConflict(requirement, jiraFacts)) {
    return "CONFLICTING";
  }
  if (corroboratesJira(requirement, jiraFacts)) {
    return "CONFIRMED";
  }
  return "SUPPORTED";
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

function createEmptyResult(): NotionIngestionResult {
  return {
    sourceType: "notion",
    status: "UNAVAILABLE",
    records: [],
    requirements: [],
    promptInjectionDetected: false,
    promptInjectionAttempts: [],
    secretsMaskedCount: 0,
    conflicts: [],
    conflictResult: "NO MATERIAL CONFLICT",
    integrationHealth: {
      integration: "Notion",
      status: "UNAVAILABLE",
      authenticated: false,
      searchAvailable: false,
      pageReadAvailable: false,
    },
  };
}

export async function ingestNotion(
  options: NotionIngestionOptions
): Promise<NotionIngestionResult> {
  const config =
    options.notionConfig === undefined ? getNotionConfig() : options.notionConfig;
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as NotionFetch);
  const maskSecrets = options.maskSecrets !== false;
  const detectInjection = options.detectPromptInjection !== false;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const base = createEmptyResult();

  // 1. Connector not configured -> honest UNAVAILABLE
  if (!config) {
    return {
      ...base,
      status: "UNAVAILABLE",
      error:
        "Notion integration is not configured. Set NOTION_INTEGRATION_TOKEN (or NOTION_API_TOKEN / NOTION_API_KEY) in .env.",
      integrationHealth: {
        integration: "Notion",
        status: "UNAVAILABLE",
        authenticated: false,
        searchAvailable: false,
        pageReadAvailable: false,
      },
    };
  }

  // 2. Verify authentication (never claim authenticated without proof)
  let authenticated = false;
  try {
    authenticated = await verifyNotionAuth(config, fetchImpl);
  } catch (err) {
    if (isHttpStatus(err, 401) || isHttpStatus(err, 403)) {
      return {
        ...base,
        status: "BLOCKED",
        error: `Notion authentication failed: ${errorMessage(err)}`,
        integrationHealth: {
          integration: "Notion",
          status: "BLOCKED",
          authenticated: false,
          searchAvailable: false,
          pageReadAvailable: false,
        },
      };
    }

    return {
      ...base,
      status: "UNAVAILABLE",
      error: `Notion integration is unreachable: ${errorMessage(err)}`,
      integrationHealth: {
        integration: "Notion",
        status: "UNAVAILABLE",
        authenticated: false,
        searchAvailable: false,
        pageReadAvailable: false,
      },
    };
  }

  if (!authenticated) {
    return {
      ...base,
      status: "BLOCKED",
      error: "Notion authentication could not be verified.",
      integrationHealth: {
        integration: "Notion",
        status: "BLOCKED",
        authenticated: false,
        searchAvailable: false,
        pageReadAvailable: false,
      },
    };
  }

  // 3. Refuse blind ingestion: need a query or relevance context
  if (!options.query && !options.jiraTicketKey && !options.jiraSummary && !options.featureName && !options.projectName) {
    return {
      ...base,
      status: "BLOCKED",
      error:
        "Refusing to blindly ingest the Notion workspace: no search query or relevance context provided.",
      integrationHealth: {
        integration: "Notion",
        status: "BLOCKED",
        authenticated: true,
        searchAvailable: false,
        pageReadAvailable: false,
      },
    };
  }

  // 4. Search
  const query = options.query || options.jiraTicketKey || options.jiraSummary || "";
  let searchAvailable = false;
  let pageReadAvailable = false;
  let blockReadSuccess = true;

  try {
    const pageSummaries = await searchNotionPages(query, config, fetchImpl);
    searchAvailable = true;

    const keywords = buildRelevanceKeywords(options);
    const titleFiltered =
      keywords.length === 0
        ? pageSummaries
        : pageSummaries.filter((page) => pageTitleMatchesKeywords(page.title, keywords));

    const candidates = titleFiltered.slice(0, maxPages);

    const records: NotionRecord[] = [];
    const requirements: NotionRequirement[] = [];
    const allInjections: string[] = [];
    const conflicts: NotionConflict[] = [];
    let totalMasked = 0;

    for (const page of candidates) {
      try {
        const contentBlocks = await getPageContentBlocks(page.pageId, config, fetchImpl);
        pageReadAvailable = true;

        const rawContent = contentBlocks.map((block) => block.text).join("");

        let content = rawContent;
        if (maskSecrets) {
          const { sanitized, maskedCount } = sanitizeSecrets(content);
          content = sanitized;
          totalMasked += maskedCount;
        }

        if (detectInjection) {
          const injections = detectPromptInjections(content);
          if (injections.length > 0) {
            allInjections.push(...injections);
          }
        }

        // Content-level relevance re-check (title may match but content may not)
        if (!contentMatchesKeywords(page.title, content, keywords)) {
          continue;
        }

        const provenance: NotionProvenance = {
          source: "Notion",
          pageId: page.pageId,
          title: page.title,
          url: page.url,
        };

        records.push({
          pageId: page.pageId,
          title: page.title,
          url: page.url,
          content,
          provenance,
        });

        const extracted = extractRequirements(contentBlocks, provenance, keywords);
        for (const requirement of extracted) {
          requirement.classification = classifyRequirement(
            requirement.requirement,
            options.jiraFacts
          );

          if (options.jiraFacts) {
            const conflict = detectMaterialConflict(
              requirement.requirement,
              provenance,
              options.jiraFacts
            );
            if (conflict) {
              conflicts.push(conflict);
            }
          }

          requirements.push(requirement);
        }
      } catch (err) {
        blockReadSuccess = false;
      }
    }

    const status: NotionIntegrationStatus = blockReadSuccess ? "AVAILABLE" : "PARTIALLY_AVAILABLE";

    return {
      ...base,
      status,
      records,
      requirements,
      promptInjectionDetected: allInjections.length > 0,
      promptInjectionAttempts: allInjections,
      secretsMaskedCount: totalMasked,
      conflicts,
      conflictResult:
        conflicts.length > 0 ? "E. BLOCKED / REQUIREMENT CONFLICT" : "NO MATERIAL CONFLICT",
      integrationHealth: {
        integration: "Notion",
        status,
        authenticated: true,
        searchAvailable: true,
        pageReadAvailable,
      },
    };
  } catch (err) {
    if (isHttpStatus(err, 401) || isHttpStatus(err, 403)) {
      return {
        ...base,
        status: "BLOCKED",
        error: `Notion search authentication failed: ${errorMessage(err)}`,
        integrationHealth: {
          integration: "Notion",
          status: "BLOCKED",
          authenticated: false,
          searchAvailable: false,
          pageReadAvailable: false,
        },
      };
    }

    return {
      ...base,
      status: "UNAVAILABLE",
      error: `Notion search failed: ${errorMessage(err)}`,
      integrationHealth: {
        integration: "Notion",
        status: "UNAVAILABLE",
        authenticated: true,
        searchAvailable: false,
        pageReadAvailable: false,
      },
    };
  }
}
