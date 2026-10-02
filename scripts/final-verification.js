require("dotenv").config();

const auth = Buffer.from(
  process.env.JIRA_EMAIL + ":" + process.env.JIRA_API_TOKEN,
).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");
const projectKey = process.env.JIRA_PROJECT_KEY;

async function run() {
  const processedKeys = ["JPA-24", "JPA-25", "JPA-26", "JPA-27"];

  // 1. Verify all processed tickets
  const ticketVerifications = await Promise.all(
    processedKeys.map(async (key) => {
      const res = await fetch(
        `${baseUrl}/rest/api/3/issue/${key}?fields=summary,status,priority,description,project`,
        {
          headers: { Authorization: `Basic ${auth}` },
        },
      );
      const data = await res.json();
      const plainDesc = JSON.stringify(data.fields?.description || {});
      return {
        key: data.key,
        project: data.fields?.project?.key,
        summary: data.fields?.summary,
        status: data.fields?.status?.name,
        priority: data.fields?.priority?.name,
        hasTestPath: /Test path: tests\//.test(plainDesc),
        hasResult: /Automation Result/.test(plainDesc),
      };
    }),
  );

  console.log(
    "PROCESSED_VERIFICATION:",
    JSON.stringify(ticketVerifications, null, 2),
  );

  // 2. Check remaining To Do in project
  const remainingRes = await fetch(`${baseUrl}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql: `project = ${projectKey} AND status = "To Do"`,
      fields: ["summary", "status"],
      maxResults: 50,
    }),
  });
  const remaining = await remainingRes.json();
  console.log("REMAINING_TODO_COUNT:", remaining.issues.length);

  // 3. Contamination check
  const foreignProjects = ticketVerifications.filter(
    (t) => t.project !== projectKey,
  );
  console.log(
    "CONTAMINATION_DETECTED:",
    foreignProjects.length > 0 ? "YES" : "NO",
  );
}

run().catch(console.error);
