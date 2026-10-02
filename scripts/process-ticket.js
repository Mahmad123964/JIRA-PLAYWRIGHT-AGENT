const {
  appendDescription,
  moveTicket,
  verifyTicket,
} = require("./jira-ops.js");

const [, , key, statusTransition, resultTextEncoded] = process.argv;

if (!key) {
  console.error("Missing key");
  process.exit(1);
}

const resultText = resultTextEncoded
  ? Buffer.from(resultTextEncoded, "base64").toString("utf8")
  : "";

(async () => {
  if (resultText) {
    await appendDescription(key, resultText);
    console.log(`${key} description updated.`);
  }

  if (statusTransition) {
    await moveTicket(key, statusTransition);
    console.log(`${key} moved with transition ${statusTransition}.`);
  }

  const ver = await verifyTicket(key);
  console.log(`${key} VERIFIED:`, JSON.stringify(ver));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
