require("dotenv").config();
const { moveTicket, verifyTicket, appendDescription } = require("./jira-ops.js");

const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");

async function getTransitions(key) {
  const res = await fetch(`${baseUrl}/rest/api/3/issue/${key}/transitions`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  return res.json();
}

async function run() {
  const trans = await getTransitions("JPA-28");
  console.log("JPA-28 Available Transitions:", JSON.stringify(trans.transitions));

  // Move to In Progress (transition id: 21)
  console.log("Moving JPA-28 from To Do -> In Progress...");
  const moveRes = await moveTicket("JPA-28", "21");
  console.log("JPA-28 Transition Result:", moveRes);

  const ver = await verifyTicket("JPA-28");
  console.log("JPA-28 Status after transition:", ver.status);
}

run().catch(console.error);
