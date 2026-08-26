require("dotenv").config();

const auth = Buffer.from(
  `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
).toString("base64");

async function getProject() {
  try {
    const response = await fetch(
      `${process.env.JIRA_BASE_URL}/rest/api/3/project/JPA`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
      }
    );

    const text = await response.text();

    console.log("=================================");
    console.log("JIRA PROJECT TEST");
    console.log("=================================");
    console.log("Status:", response.status);
    console.log("Response:");
    console.log(text);
    console.log("=================================");

  } catch (error) {
    console.log("❌ Connection failed:", error.message);
  }
}

getProject();