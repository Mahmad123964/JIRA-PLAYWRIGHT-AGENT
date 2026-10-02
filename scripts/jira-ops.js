require("dotenv").config();

const auth = Buffer.from(
  process.env.JIRA_EMAIL + ":" + process.env.JIRA_API_TOKEN,
).toString("base64");
const baseUrl = (process.env.JIRA_BASE_URL || "").replace(/\/+$/, "");

function textToAdfParagraphs(text) {
  const lines = text.split(/\r?\n/);
  return lines.map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  }));
}

async function moveTicket(issueKey, transitionId) {
  const res = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transition: { id: transitionId },
      }),
    },
  );
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(
      `Failed transition ${transitionId} for ${issueKey}: ${res.status} ${txt}`,
    );
  }
  return res.status;
}

async function appendDescription(issueKey, appendText) {
  const getRes = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=description`,
    {
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  const data = await getRes.json();
  const desc = data.fields?.description || {
    type: "doc",
    version: 1,
    content: [],
  };

  const updatedDesc = {
    ...desc,
    content: [...(desc.content || []), ...textToAdfParagraphs(appendText)],
  };

  const putRes = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fields: { description: updatedDesc },
      }),
    },
  );

  if (!putRes.ok && putRes.status !== 204) {
    const txt = await putRes.text();
    throw new Error(
      `Failed updating description for ${issueKey}: ${putRes.status} ${txt}`,
    );
  }
  return putRes.status;
}

async function verifyTicket(issueKey) {
  const res = await fetch(
    `${baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,status,priority,description`,
    {
      headers: { Authorization: `Basic ${auth}` },
    },
  );
  const data = await res.json();
  return {
    key: data.key,
    summary: data.fields.summary,
    status: data.fields.status.name,
    priority: data.fields.priority.name,
    rawDescription: JSON.stringify(data.fields.description || {}),
  };
}

module.exports = {
  moveTicket,
  appendDescription,
  verifyTicket,
};
