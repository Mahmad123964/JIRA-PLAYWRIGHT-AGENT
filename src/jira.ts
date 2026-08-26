import axios from "axios";

declare const require: (moduleName: string) => { config: () => void };
declare const process: {
  env: Record<string, string | undefined>;
};
declare const Buffer: {
  from(value: string): {
    toString(encoding: string): string;
  };
};

const dotenv = require("dotenv");
dotenv.config();

type JiraAdfNode = {
  type?: string;
  text?: string;
  content?: JiraAdfNode[];
  version?: number;
};

type JiraIssueFields = {
  summary?: string;
  description?: JiraAdfNode | null;
  labels?: string[];
  status?: {
    name?: string;
  };
};

export type TodoTask = {
  summary: string;
  description: string;
  labels: string[];
  status: string;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const jiraBaseUrl = getRequiredEnv("JIRA_BASE_URL").replace(/\/+$/, "");
const jiraEmail = getRequiredEnv("JIRA_EMAIL");
const jiraApiToken = getRequiredEnv("JIRA_API_TOKEN");
const jiraAuthToken = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString("base64");

const jira = axios.create({
  baseURL: `${jiraBaseUrl}/rest/api/3`,
  headers: {
    Authorization: `Basic ${jiraAuthToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
});

jira.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase() ?? "GET";
  const params = config.params
    ? ` params=${JSON.stringify(config.params)}`
    : "";

  console.log(`Jira API request: ${method} ${config.baseURL}${config.url}${params}`);
  return config;
});

jira.interceptors.response.use(
  (response) => {
    console.log(
      `Jira API response: ${response.status} ${response.config.method?.toUpperCase()} ${response.config.url}`
    );
    return response;
  },
  (error) => {
    if (error.response) {
      console.error(
        `Jira API error: ${error.response.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`
      );
      console.error(error.response.data);
    } else {
      console.error(`Jira API error: ${error.message}`);
    }

    return Promise.reject(error);
  }
);

function getJiraErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const jiraMessages = error.response?.data?.errorMessages;
    const jiraErrors = error.response?.data?.errors;

    if (Array.isArray(jiraMessages) && jiraMessages.length > 0) {
      return `${status ?? "Unknown status"} ${jiraMessages.join("; ")}`;
    }

    if (jiraErrors && typeof jiraErrors === "object") {
      return `${status ?? "Unknown status"} ${JSON.stringify(jiraErrors)}`;
    }

    if (status) {
      return `${status} ${statusText ?? error.message}`;
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function handleJiraError(action: string, error: unknown): never {
  const message = getJiraErrorMessage(error);
  console.error(`Failed to ${action}: ${message}`);
  throw new Error(`Failed to ${action}: ${message}`);
}

function escapeJqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function adfToPlainText(node?: JiraAdfNode | null): string {
  if (!node) {
    return "";
  }

  if (node.type === "text") {
    return node.text ?? "";
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  const childText = (node.content ?? []).map(adfToPlainText).join("");

  switch (node.type) {
    case "paragraph":
    case "heading":
    case "blockquote":
    case "codeBlock":
      return `${childText}\n`;
    case "listItem":
      return `- ${childText.trim()}\n`;
    case "bulletList":
    case "orderedList":
    case "panel":
    case "table":
    case "tableRow":
      return `${childText}\n`;
    case "tableHeader":
    case "tableCell":
      return `${childText.trim()} `;
    default:
      return childText;
  }
}

function cleanPlainText(value: string): string {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDescription(description?: JiraAdfNode | null): string {
  return cleanPlainText(adfToPlainText(description));
}

function textToAdfParagraphs(text: string): JiraAdfNode[] {
  const lines = text.split(/\r?\n/);

  return lines.map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));
}

function appendTextToDescription(
  description: JiraAdfNode | null | undefined,
  appendText: string
): JiraAdfNode {
  const existingDescription = description ?? {
    type: "doc",
    version: 1,
    content: [],
  };

  return {
    ...existingDescription,
    type: "doc",
    version: existingDescription.version ?? 1,
    content: [
      ...(existingDescription.content ?? []),
      ...textToAdfParagraphs(appendText),
    ],
  };
}

function mapIssue(issue: { key: string; fields: JiraIssueFields }): TodoTask {
  return {
    summary: issue.fields.summary ?? "",
    description: extractDescription(issue.fields.description),
    labels: issue.fields.labels ?? [],
    status: issue.fields.status?.name ?? "",
  };
}

export async function getTodoTasks(projectKey: string): Promise<TodoTask[]> {
  try {
    const jql = `project = "${escapeJqlString(projectKey)}" AND status = "To Do"`;
    const issues: Array<{ key: string; fields: JiraIssueFields }> = [];
    let nextPageToken: string | undefined;

    do {
      const response = await jira.post("/search/jql", {
        jql,
        fields: ["summary", "description", "labels", "status"],
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      });

      issues.push(...response.data.issues);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    return issues.map(mapIssue);
  } catch (error) {
    handleJiraError(`get To Do tasks for project ${projectKey}`, error);
  }
}

export async function getTaskDescription(issueKey: string): Promise<string> {
  try {
    const response = await jira.get(`/issue/${encodeURIComponent(issueKey)}`, {
      params: {
        fields: "description",
      },
    });

    return extractDescription(response.data.fields.description);
  } catch (error) {
    handleJiraError(`get description for issue ${issueKey}`, error);
  }
}

export async function moveTask(
  issueKey: string,
  transitionName: string
): Promise<void> {
  try {
    const transitionsResponse = await jira.get(
      `/issue/${encodeURIComponent(issueKey)}/transitions`
    );

    const transition = transitionsResponse.data.transitions.find(
      (item: { id: string; name: string }) =>
        item.name.toLowerCase() === transitionName.toLowerCase()
    );

    if (!transition) {
      throw new Error(`Transition "${transitionName}" is not available for ${issueKey}`);
    }

    await jira.post(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
      transition: {
        id: transition.id,
      },
    });

    console.log(
      `Moved ${issueKey} using transition "${transition.name}" (${transition.id})`
    );
  } catch (error) {
    handleJiraError(
      `move issue ${issueKey} using transition ${transitionName}`,
      error
    );
  }
}

export async function updateDescription(
  issueKey: string,
  appendText: string
): Promise<void> {
  try {
    const issueResponse = await jira.get(`/issue/${encodeURIComponent(issueKey)}`, {
      params: {
        fields: "description",
      },
    });

    const currentDescription = extractDescription(issueResponse.data.fields.description);
    console.log(`Current description for ${issueKey}:`);
    console.log(currentDescription);

    const description = appendTextToDescription(
      issueResponse.data.fields.description,
      appendText
    );

    await jira.put(`/issue/${encodeURIComponent(issueKey)}`, {
      fields: {
        description,
      },
    });
  } catch (error) {
    handleJiraError(`update description for issue ${issueKey}`, error);
  }
}

export const GETTODOTASKS = getTodoTasks;
export const GETTASKDESCRIPTION = getTaskDescription;
export const MOVETASK = moveTask;
export const UPDATEDESCRIPTION = updateDescription;
