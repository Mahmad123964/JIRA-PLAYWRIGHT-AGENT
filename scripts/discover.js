require("dotenv").config();

const auth = Buffer.from(
  process.env.JIRA_EMAIL + ":" + process.env.JIRA_API_TOKEN,
).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");
const projectKey = process.env.JIRA_PROJECT_KEY;

function adfToPlainText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  const child = (node.content || []).map(adfToPlainText).join("");
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "blockquote":
      return child + "\n";
    case "listItem":
      return "- " + child.trim() + "\n";
    case "bulletList":
    case "orderedList":
      return child + "\n";
    default:
      return child;
  }
}

async function run() {
  const [projRes, prioRes, searchRes] = await Promise.all([
    fetch(`${baseUrl}/rest/api/3/project/${projectKey}`, {
      headers: { Authorization: `Basic ${auth}` },
    }),
    fetch(`${baseUrl}/rest/api/3/priority`, {
      headers: { Authorization: `Basic ${auth}` },
    }),
    fetch(`${baseUrl}/rest/api/3/search/jql`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql: `project = ${projectKey} AND status = "To Do" ORDER BY created ASC`,
        fields: [
          "summary",
          "description",
          "status",
          "priority",
          "issuetype",
          "assignee",
          "parent",
          "issuelinks",
          "labels",
          "created",
        ],
        maxResults: 100,
      }),
    }),
  ]);

  const proj = await projRes.json();
  const priorities = await prioRes.json();
  const search = await searchRes.json();

  console.log(
    "PROJECT:",
    JSON.stringify({ key: proj.key, id: proj.id, name: proj.name }),
  );
  console.log(
    "PRIORITIES:",
    JSON.stringify(priorities.map((p) => ({ id: p.id, name: p.name }))),
  );
  console.log("COUNT:", search.issues.length);

  const tickets = search.issues.map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    description: adfToPlainText(i.fields.description).trim(),
    status: i.fields.status ? i.fields.status.name : "Unknown",
    priority: i.fields.priority ? i.fields.priority.name : "None",
    priorityId: Number(i.fields.priority ? i.fields.priority.id : 999),
    type: i.fields.issuetype ? i.fields.issuetype.name : "Task",
    assignee: i.fields.assignee ? i.fields.assignee.displayName : "Unassigned",
    parent: i.fields.parent ? i.fields.parent.key : null,
    links: (i.fields.issuelinks || []).map((l) => ({
      type: l.type.name,
      inward: l.inwardIssue?.key,
      outward: l.outwardIssue?.key,
    })),
    created: i.fields.created,
  }));

  console.log("TICKETS_RAW:", JSON.stringify(tickets, null, 2));
}

run().catch(console.error);
