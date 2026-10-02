import { detectPromptInjections, sanitizeSecrets } from "./document-ingestion";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type SlackIntegrationStatus =
  | "AVAILABLE"
  | "PARTIALLY_AVAILABLE"
  | "UNAVAILABLE"
  | "BLOCKED";

/**
 * Five-category classification per Section 48.3.
 */
export type SlackFindingClassification =
  | "A. REQUIREMENT CLARIFICATION"
  | "B. TECHNICAL CLARIFICATION"
  | "C. IMPLEMENTATION INFORMATION"
  | "D. HISTORICAL DISCUSSION"
  | "E. INFORMATIONAL ONLY";

export type SlackConflictKind =
  | "METHOD"
  | "STATUS_CODE"
  | "ENDPOINT"
  | "UI_TEXT"
  | "AUTH"
  | "SCHEMA"
  | "PERMISSION";

export interface SlackProvenance {
  source: "Slack";
  channel: string;
  messageTs: string;
  threadTs?: string;
  author?: string;
  dateUtc?: string;
  permalink?: string;
}

export interface SlackRecord {
  channel: string;
  messageTs: string;
  threadTs?: string;
  author?: string;
  dateUtc?: string;
  text: string;
  provenance: SlackProvenance;
}

export interface SlackFinding {
  text: string;
  classification: SlackFindingClassification;
  sourceType: "slack";
  provenance: SlackProvenance;
}

export interface SlackConflict {
  slackText: string;
  slackSource: SlackProvenance;
  jiraFact: string;
  kind: SlackConflictKind;
  detail: string;
}

export interface SlackIntegrationHealth {
  integration: "Slack";
  status: SlackIntegrationStatus;
  authenticated: boolean;
  searchAvailable: boolean;
  messageReadAvailable: boolean;
}

export interface SlackConfig {
  botToken: string;
  apiBaseUrl: string;
}

export interface SlackFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

export type SlackFetch = (
  url: string,
  init?: RequestInit
) => Promise<SlackFetchResponse>;

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

export interface SlackIngestionOptions {
  slackConfig?: SlackConfig | null;
  fetchImpl?: SlackFetch;
  maskSecrets?: boolean;
  detectPromptInjection?: boolean;
  maxMessages?: number;
  // Relevance context — scoped search, never blind
  jiraTicketKey?: string;
  jiraSummary?: string;
  featureName?: string;
  channels?: string[];
  // Jira authority facts for conflict detection
  jiraFacts?: JiraFacts;
}

export interface SlackIngestionResult {
  sourceType: "slack";
  status: SlackIntegrationStatus;
  records: SlackRecord[];
  findings: SlackFinding[];
  promptInjectionDetected: boolean;
  promptInjectionAttempts: string[];
  secretsMaskedCount: number;
  conflicts: SlackConflict[];
  conflictResult: "E. BLOCKED / REQUIREMENT CONFLICT" | "NO MATERIAL CONFLICT";
  error?: string;
  integrationHealth: SlackIntegrationHealth;
}

// ----------------------------------------------------------------------------
// Internal Slack API types
// ----------------------------------------------------------------------------

interface SlackMessage {
  ts: string;
  thread_ts?: string;
  user?: string;
  username?: string;
  text?: string;
  reply_count?: number;
  replies?: Array<{ ts: string; user?: string }>;
}

interface SlackSearchMatch {
  ts: string;
  channel?: { id?: string; name?: string };
  user?: string;
  username?: string;
  text?: string;
  permalink?: string;
}

const DEFAULT_SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_MAX_MESSAGES = 50;

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

export function getSlackConfig(): SlackConfig | null {
  const token =
    process.env.SLACK_BOT_TOKEN ||
    process.env.SLACK_TOKEN ||
    process.env.SLACK_API_TOKEN;

  if (!token) return null;

  return {
    botToken: token,
    apiBaseUrl: (process.env.SLACK_API_BASE_URL || DEFAULT_SLACK_API_BASE).replace(/\/+$/, ""),
  };
}

function slackHeaders(config: SlackConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.botToken}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

// ----------------------------------------------------------------------------
// Relevance helpers
// ----------------------------------------------------------------------------

export function buildSlackKeywords(options: SlackIngestionOptions): string[] {
  const set = new Set<string>();
  const addWords = (value?: string) => {
    if (!value) return;
    for (const word of value.split(/[^A-Za-z0-9_-]+/)) {
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
  if (options.featureName) addWords(options.featureName);
  return Array.from(set);
}

function isRelevant(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

// ----------------------------------------------------------------------------
// Classification (Section 48.3)
// ----------------------------------------------------------------------------

const REQUIREMENT_CLARIFICATION_PATTERNS =
  /\b(scope change|requirement change|acceptance criteria|product decision|we (will|won't|should|must)|confirmed:|approved:|decision:)\b/i;
const TECHNICAL_CLARIFICATION_PATTERNS =
  /\b(endpoint|api|payload|schema|http|status code|returns?|method|route|auth|token|header)\b/i;
const IMPLEMENTATION_PATTERNS =
  /\b(architecture|service|dependency|config|environment|deploy|infrastructure|database|cache)\b/i;

export function classifySlackFinding(text: string): SlackFindingClassification {
  if (REQUIREMENT_CLARIFICATION_PATTERNS.test(text)) return "A. REQUIREMENT CLARIFICATION";
  if (TECHNICAL_CLARIFICATION_PATTERNS.test(text)) return "B. TECHNICAL CLARIFICATION";
  if (IMPLEMENTATION_PATTERNS.test(text)) return "C. IMPLEMENTATION INFORMATION";
  return "E. INFORMATIONAL ONLY";
}

// ----------------------------------------------------------------------------
// Conflict detection
// ----------------------------------------------------------------------------

function detectHttpMethod(text: string): string | null {
  const m = text.match(/\b(get|post|put|patch|delete|head|options)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function detectStatusCode(text: string): number | null {
  const m = text.match(/\b(200|201|202|204|400|401|403|404|409|422|500|502|503)\b/);
  return m ? Number(m[1]) : null;
}

export function detectSlackConflict(
  text: string,
  provenance: SlackProvenance,
  jiraFacts: JiraFacts
): SlackConflict | null {
  const lower = text.toLowerCase();
  const method = detectHttpMethod(lower);

  for (const endpoint of jiraFacts.endpoints || []) {
    const p = (endpoint.path || "").toLowerCase();
    if (p && lower.includes(p)) {
      if (endpoint.method && method && method !== endpoint.method.toLowerCase()) {
        return {
          slackText: text,
          slackSource: provenance,
          jiraFact: `Expected ${endpoint.path} to use ${endpoint.method.toUpperCase()}`,
          kind: "METHOD",
          detail: `Slack states ${method.toUpperCase()} for ${endpoint.path}`,
        };
      }
      const status = detectStatusCode(lower);
      if (endpoint.expectedStatus && status && status !== endpoint.expectedStatus) {
        return {
          slackText: text,
          slackSource: provenance,
          jiraFact: `Expected ${endpoint.path} to return ${endpoint.expectedStatus}`,
          kind: "STATUS_CODE",
          detail: `Slack states ${status} for ${endpoint.path}`,
        };
      }
    }
  }

  if (jiraFacts.authModel) {
    const authMatch = lower.match(/(bearer|basic|oauth|api key|session|cookie)/);
    if (authMatch && /auth|authenticate|token|header|credential/.test(lower)) {
      if (jiraFacts.authModel.toLowerCase() !== authMatch[1]) {
        return {
          slackText: text,
          slackSource: provenance,
          jiraFact: `Expected auth model: ${jiraFacts.authModel}`,
          kind: "AUTH",
          detail: `Slack mentions ${authMatch[1]}`,
        };
      }
    }
  }

  return null;
}

// ----------------------------------------------------------------------------
// Slack API calls
// ----------------------------------------------------------------------------

class SlackApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "SlackApiError";
    this.status = status;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function verifySlackAuth(config: SlackConfig, fetchImpl: SlackFetch): Promise<boolean> {
  const res = await fetchImpl(`${config.apiBaseUrl}/auth.test`, {
    method: "POST",
    headers: slackHeaders(config),
  });

  if (res.status === 401 || res.status === 403) {
    throw new SlackApiError(`Slack authentication failed: ${res.status}`, res.status);
  }
  if (!res.ok) {
    throw new SlackApiError(`Slack auth check failed: ${res.status}`, res.status);
  }

  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!data.ok) {
    if (data.error === "invalid_auth" || data.error === "not_authed") {
      throw new SlackApiError(`Slack authentication failed: ${data.error}`, 401);
    }
    throw new SlackApiError(`Slack auth.test returned ok=false: ${data.error}`, res.status);
  }
  return true;
}

async function searchSlackMessages(
  query: string,
  config: SlackConfig,
  fetchImpl: SlackFetch,
  maxMessages: number
): Promise<SlackSearchMatch[]> {
  const params = new URLSearchParams({
    query,
    count: String(Math.min(maxMessages, 100)),
    sort: "timestamp",
    sort_dir: "desc",
  });

  const res = await fetchImpl(`${config.apiBaseUrl}/search.messages?${params.toString()}`, {
    method: "GET",
    headers: slackHeaders(config),
  });

  if (res.status === 401 || res.status === 403) {
    throw new SlackApiError(`Slack search authentication failed: ${res.status}`, res.status);
  }
  if (!res.ok) {
    throw new SlackApiError(`Slack search failed: ${res.status}`, res.status);
  }

  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    messages?: { matches?: SlackSearchMatch[] };
  };

  if (!data.ok) {
    throw new SlackApiError(`Slack search.messages returned ok=false: ${data.error}`, res.status);
  }

  return data.messages?.matches ?? [];
}

async function fetchThreadReplies(
  channelId: string,
  threadTs: string,
  config: SlackConfig,
  fetchImpl: SlackFetch
): Promise<SlackMessage[]> {
  const params = new URLSearchParams({ channel: channelId, ts: threadTs });
  const res = await fetchImpl(
    `${config.apiBaseUrl}/conversations.replies?${params.toString()}`,
    { method: "GET", headers: slackHeaders(config) }
  );

  if (!res.ok) return [];

  const data = (await res.json()) as { ok?: boolean; messages?: SlackMessage[] };
  if (!data.ok || !Array.isArray(data.messages)) return [];
  return data.messages;
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

function createEmptyResult(): SlackIngestionResult {
  return {
    sourceType: "slack",
    status: "UNAVAILABLE",
    records: [],
    findings: [],
    promptInjectionDetected: false,
    promptInjectionAttempts: [],
    secretsMaskedCount: 0,
    conflicts: [],
    conflictResult: "NO MATERIAL CONFLICT",
    integrationHealth: {
      integration: "Slack",
      status: "UNAVAILABLE",
      authenticated: false,
      searchAvailable: false,
      messageReadAvailable: false,
    },
  };
}

export async function ingestSlack(
  options: SlackIngestionOptions
): Promise<SlackIngestionResult> {
  const config =
    options.slackConfig === undefined ? getSlackConfig() : options.slackConfig;
  const fetchImpl =
    options.fetchImpl ?? (globalThis.fetch as unknown as SlackFetch);
  const maskSecrets = options.maskSecrets !== false;
  const detectInjection = options.detectPromptInjection !== false;
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;

  const base = createEmptyResult();

  // 1. No credentials -> honest UNAVAILABLE (Section 61.1)
  if (!config) {
    return {
      ...base,
      status: "UNAVAILABLE",
      error:
        "Slack integration is not configured. Set SLACK_BOT_TOKEN (or SLACK_TOKEN / SLACK_API_TOKEN) in .env.",
      integrationHealth: {
        integration: "Slack",
        status: "UNAVAILABLE",
        authenticated: false,
        searchAvailable: false,
        messageReadAvailable: false,
      },
    };
  }

  // 2. Verify authentication — never claim authenticated without proof
  let authenticated = false;
  try {
    authenticated = await verifySlackAuth(config, fetchImpl);
  } catch (err) {
    const isAuthErr =
      err instanceof SlackApiError && (err.status === 401 || err.status === 403);
    return {
      ...base,
      status: isAuthErr ? "BLOCKED" : "UNAVAILABLE",
      error: `Slack authentication failed: ${errorMessage(err)}`,
      integrationHealth: {
        integration: "Slack",
        status: isAuthErr ? "BLOCKED" : "UNAVAILABLE",
        authenticated: false,
        searchAvailable: false,
        messageReadAvailable: false,
      },
    };
  }

  if (!authenticated) {
    return {
      ...base,
      status: "BLOCKED",
      error: "Slack authentication could not be verified.",
      integrationHealth: {
        integration: "Slack",
        status: "BLOCKED",
        authenticated: false,
        searchAvailable: false,
        messageReadAvailable: false,
      },
    };
  }

  // 3. Refuse blind ingestion — require relevance context (Section 48.2)
  if (!options.jiraTicketKey && !options.jiraSummary && !options.featureName) {
    return {
      ...base,
      status: "BLOCKED",
      error:
        "Refusing to blindly search Slack: no jiraTicketKey, jiraSummary, or featureName provided.",
      integrationHealth: {
        integration: "Slack",
        status: "BLOCKED",
        authenticated: true,
        searchAvailable: false,
        messageReadAvailable: false,
      },
    };
  }

  // 4. Build scoped search query
  const keywords = buildSlackKeywords(options);
  const query =
    options.jiraTicketKey ||
    options.jiraSummary ||
    options.featureName ||
    keywords.join(" ");

  const records: SlackRecord[] = [];
  const findings: SlackFinding[] = [];
  const allInjections: string[] = [];
  const conflicts: SlackConflict[] = [];
  let totalMasked = 0;
  let searchAvailable = false;
  let messageReadAvailable = false;

  try {
    const matches = await searchSlackMessages(query, config, fetchImpl, maxMessages);
    searchAvailable = true;

    for (const match of matches) {
      const channelId = match.channel?.id ?? "";
      const channelName = match.channel?.name ?? channelId;
      const rawText = match.text ?? "";

      if (!isRelevant(rawText, keywords)) continue;

      let text = rawText;
      if (maskSecrets) {
        const { sanitized, maskedCount } = sanitizeSecrets(text);
        text = sanitized;
        totalMasked += maskedCount;
      }

      if (detectInjection) {
        const injections = detectPromptInjections(text);
        if (injections.length > 0) allInjections.push(...injections);
      }

      const provenance: SlackProvenance = {
        source: "Slack",
        channel: channelName,
        messageTs: match.ts,
        author: match.username || match.user,
        permalink: match.permalink,
      };

      records.push({
        channel: channelName,
        messageTs: match.ts,
        author: match.username || match.user,
        text,
        provenance,
      });

      const classification = classifySlackFinding(text);
      findings.push({ text, classification, sourceType: "slack", provenance });

      if (options.jiraFacts) {
        const conflict = detectSlackConflict(text, provenance, options.jiraFacts);
        if (conflict) conflicts.push(conflict);
      }

      // Fetch thread replies if this is a thread parent
      if (match.ts && channelId) {
        try {
          const replies = await fetchThreadReplies(channelId, match.ts, config, fetchImpl);
          messageReadAvailable = true;
          for (const reply of replies.slice(1)) {
            // skip first (parent)
            let replyText = reply.text ?? "";
            if (!isRelevant(replyText, keywords)) continue;

            if (maskSecrets) {
              const { sanitized, maskedCount } = sanitizeSecrets(replyText);
              replyText = sanitized;
              totalMasked += maskedCount;
            }
            if (detectInjection) {
              const injections = detectPromptInjections(replyText);
              if (injections.length > 0) allInjections.push(...injections);
            }

            const replyProvenance: SlackProvenance = {
              source: "Slack",
              channel: channelName,
              messageTs: reply.ts,
              threadTs: match.ts,
              author: reply.user,
            };

            records.push({
              channel: channelName,
              messageTs: reply.ts,
              threadTs: match.ts,
              author: reply.user,
              text: replyText,
              provenance: replyProvenance,
            });

            const replyClassification = classifySlackFinding(replyText);
            findings.push({
              text: replyText,
              classification: replyClassification,
              sourceType: "slack",
              provenance: replyProvenance,
            });

            if (options.jiraFacts) {
              const conflict = detectSlackConflict(replyText, replyProvenance, options.jiraFacts);
              if (conflict) conflicts.push(conflict);
            }
          }
        } catch {
          // Thread fetch failure is non-fatal
        }
      }
    }

    const status: SlackIntegrationStatus =
      records.length > 0 ? "AVAILABLE" : "PARTIALLY_AVAILABLE";

    return {
      ...base,
      status,
      records,
      findings,
      promptInjectionDetected: allInjections.length > 0,
      promptInjectionAttempts: allInjections,
      secretsMaskedCount: totalMasked,
      conflicts,
      conflictResult:
        conflicts.length > 0 ? "E. BLOCKED / REQUIREMENT CONFLICT" : "NO MATERIAL CONFLICT",
      integrationHealth: {
        integration: "Slack",
        status,
        authenticated: true,
        searchAvailable,
        messageReadAvailable,
      },
    };
  } catch (err) {
    const isAuthErr =
      err instanceof SlackApiError && (err.status === 401 || err.status === 403);
    return {
      ...base,
      status: isAuthErr ? "BLOCKED" : "UNAVAILABLE",
      error: `Slack search failed: ${errorMessage(err)}`,
      integrationHealth: {
        integration: "Slack",
        status: isAuthErr ? "BLOCKED" : "UNAVAILABLE",
        authenticated: true,
        searchAvailable: false,
        messageReadAvailable: false,
      },
    };
  }
}
