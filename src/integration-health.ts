import type { IntegrationHealth, IntegrationStatus } from "./core-models";

function configured(...names: string[]): boolean { return names.some((name) => Boolean(process.env[name])); }

export function getIntegrationHealth(): IntegrationHealth[] {
  return [
    { name: "Core QA Engine", status: "AVAILABLE" },
    { name: "Jira", status: configured("JIRA_BASE_URL", "JIRA_API_TOKEN") ? "AVAILABLE" : "UNAVAILABLE", reason: configured("JIRA_BASE_URL", "JIRA_API_TOKEN") ? undefined : "Jira environment variables are not configured" },
    { name: "Notion", status: configured("NOTION_INTEGRATION_TOKEN", "NOTION_API_TOKEN") ? "AVAILABLE" : "UNAVAILABLE", reason: "Notion connector is optional and not configured" },
    { name: "Slack", status: configured("SLACK_BOT_TOKEN") ? "AVAILABLE" : "UNAVAILABLE", reason: "Slack connector is optional and not configured" },
    { name: "GitHub", status: configured("GITHUB_TOKEN") ? "AVAILABLE" : "UNAVAILABLE", reason: "GitHub connector is optional and not configured" },
    { name: "Local file sources", status: "AVAILABLE" },
  ];
}

export function integrationStatus(name: string): IntegrationStatus { return getIntegrationHealth().find((item) => item.name.toLowerCase() === name.toLowerCase())?.status || "UNAVAILABLE"; }
