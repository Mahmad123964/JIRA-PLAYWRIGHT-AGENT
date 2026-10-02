require("dotenv").config();
const auth = Buffer.from(
  `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`,
).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");

async function verify() {
  const [res28, res29] = await Promise.all([
    fetch(
      `${baseUrl}/rest/api/3/issue/JPA-28?fields=summary,status,priority,description,issuelinks`,
      {
        headers: { Authorization: `Basic ${auth}` },
      },
    ),
    fetch(
      `${baseUrl}/rest/api/3/issue/JPA-29?fields=summary,status,priority,issuetype,issuelinks`,
      {
        headers: { Authorization: `Basic ${auth}` },
      },
    ),
  ]);

  const data28 = await res28.json();
  const data29 = await res29.json();

  console.log("JPA-28 Status:", data28.fields.status.name);
  console.log("JPA-28 Summary:", data28.fields.summary);
  console.log(
    "JPA-28 Links:",
    data28.fields.issuelinks.map((l) => ({
      type: l.type.name,
      inward: l.inwardIssue?.key,
      outward: l.outwardIssue?.key,
    })),
  );

  console.log("JPA-29 (Bug) Key:", data29.key);
  console.log("JPA-29 Status:", data29.fields.status.name);
  console.log("JPA-29 Summary:", data29.fields.summary);
  console.log("JPA-29 Priority:", data29.fields.priority.name);
  console.log("JPA-29 Type:", data29.fields.issuetype.name);
}

verify().catch(console.error);
