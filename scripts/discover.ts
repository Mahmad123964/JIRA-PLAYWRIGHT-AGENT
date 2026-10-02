import dotenv from "dotenv";
dotenv.config();

const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");
const projectKey = process.env.JIRA_PROJECT_KEY;

async function run() {
  const [projRes, prioRes, searchRes] = await Promise.all([
    fetch(`${baseUrl}/rest/api/3/project/${projectKey}`, { headers: { Authorization: `Basic ${auth}` } }),
    fetch(`${baseUrl}/rest/api/3/priority`, { headers: { Authorization: `Basic ${auth}` } }),
    fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        jql: `project = ${projectKey} AND status = "To Do" ORDER BY created ASC`,
        fields: ["summary", "description", "status", "priority", "issuetype", "assignee", "parent", "issuelinks", "labels", "created"],
        maxResults: 100
      })
    })
  ]);

  const proj = await projRes.json();
  const priorities = await prioRes.json();
  const search = await searchRes.json();

  console.log("PROJECT:", JSON.stringify({ key: proj.key, id: proj.id, name: proj.name }));
  console.log("PRIORITIES:", JSON.stringify(priorities.map((p: any) => ({ id: p.id, name: p.name }))));
  console.log("COUNT:", search.issues.length);
  console.log("ISSUES:", JSON.stringify(search.issues.map((i: any) => ({
    key: i.key,
    summary: i.fields.summary,
    priority: i.fields.priority?.name || "None",
    priorityId: Number(i.fields.priority?.id || 999),
    type: i.fields.issuetype.name,
    parent: i.fields.parent?.key || null,
    links: (i.fields.issuelinks || []).map((l: any) => ({
      type: l.type.name,
      inward: l.inwardIssue?.key,
      outward: l.outwardIssue?.key
    })),
    created: i.fields.created
  })), null, 2));
}

run().catch(console.error);
