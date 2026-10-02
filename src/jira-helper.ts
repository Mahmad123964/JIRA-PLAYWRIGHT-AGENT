import dotenv from "dotenv";
dotenv.config();

const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");
const projectKey = process.env.JIRA_PROJECT_KEY;

export async function jiraFetch(endpoint: string, options: RequestInit = {}) {
  const url = `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  return res;
}

export function adfToText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const child = (node.content || []).map(adfToText).join("");
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "blockquote":
      return `${child}\n`;
    case "listItem":
      return `- ${child.trim()}\n`;
    case "bulletList":
    case "orderedList":
      return `${child}\n`;
    default:
      return child;
  }
}

export function textToAdf(text: string) {
  return {
    type: "doc",
    version: 1,
    content: text.split(/\r?\n/).map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}
