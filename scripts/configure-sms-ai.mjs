import { loadEnvFile } from "node:process";
import { readFileSync } from "node:fs";
import { Client, Functions, ID } from "node-appwrite";

loadEnvFile(".env.local"); loadEnvFile(".env.provisioning");
const config = JSON.parse(readFileSync("appwrite.config.json", "utf8"));
const functions = new Functions(new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(process.env.APPWRITE_PROVISIONING_KEY));
if (!process.env.OPENROUTER_API_KEY || !process.env.APPWRITE_PROVISIONING_KEY) throw new Error("OpenRouter and provisioning keys are required");
try {
  const existing = await functions.listVariables({ functionId: "mio-sms" });
  const variables = [
    { key: "OPENROUTER_API_KEY", value: process.env.OPENROUTER_API_KEY, secret: true },
    { key: "MIO_AI_MODEL", value: process.env.MIO_AI_MODEL ?? "openai/gpt-5.6-luna", secret: false },
    { key: "MIO_DEFAULT_TIMEZONE", value: process.env.MIO_DEFAULT_TIMEZONE ?? "America/Chicago", secret: false },
    { key: "MIO_REMINDER_OFFSET_MINUTES", value: process.env.MIO_REMINDER_OFFSET_MINUTES ?? "15", secret: false },
  ];
  for (const variable of variables) {
    const previous = existing.variables.find(entry => entry.key === variable.key);
    if (previous) await functions.updateVariable({ functionId: "mio-sms", variableId: previous.$id, ...variable });
    else await functions.createVariable({ functionId: "mio-sms", variableId: ID.unique(), ...variable });
    console.log(`Configured Function variable ${variable.key}${variable.secret ? " (secret)" : ""}`);
  }
} catch (error) {
  console.error("SMS AI configuration failed", { code: error.code ?? null, type: error.type ?? null }); process.exitCode = 1;
}
