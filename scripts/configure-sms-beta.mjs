import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Client, Functions, ID } from "node-appwrite";
import { z } from "zod";

for (const path of [".env.local", ".env.provisioning"]) if (existsSync(path)) loadEnvFile(path);
const allowed = (process.env.MIO_INVITE_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean).map(value => z.email().parse(value));
const keys = ["MIO_MAX_INBOUND_PER_MINUTE", "MIO_MAX_AI_PER_HOUR", "MIO_MAX_AI_PER_DAY", "MIO_MAX_OUTBOUND_PER_DAY", "MIO_MAX_ACTIVE_REMINDERS", "MIO_MAX_SCHEDULED_OUTBOUND", "MIO_AI_TURN_CEILING_MICROS", "MIO_SMS_MESSAGE_CEILING_MICROS", "MIO_GLOBAL_AI_DAILY_MICROS", "MIO_GLOBAL_SMS_DAILY_MICROS"];
const variables = [{ key: "MIO_INVITE_EMAILS", value: allowed.join(","), secret: true }];
for (const key of keys) {
  const value = process.env[key];
  if (value === undefined) continue;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || (key.includes("CEILING") && Number(value) === 0)) throw new Error(`Invalid ${key}`);
  variables.push({ key, value, secret: false });
}
if (process.env.MIO_SUPPORT_EMAIL) variables.push({ key: "MIO_SUPPORT_EMAIL", value: z.email().parse(process.env.MIO_SUPPORT_EMAIL), secret: false });
variables.push({ key: "MIO_NUMBER_MODE", value: z.enum(["dedicated", "legacy-shared"]).parse(process.env.MIO_NUMBER_MODE ?? "dedicated"), secret: false });
console.log(`Plan: ${allowed.length} invited accounts, ${variables.length} Function variables. Also set the invite list and public contact on the Site.`);
if (!process.argv.includes("--apply")) { console.log("Dry run only. Add --apply to update the existing SMS Function variables."); process.exit(0); }
const config = JSON.parse(readFileSync("appwrite.config.json", "utf8"));
if (!process.env.APPWRITE_PROVISIONING_KEY) throw new Error("APPWRITE_PROVISIONING_KEY is required");
const functions = new Functions(new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(process.env.APPWRITE_PROVISIONING_KEY));
try {
  const existing = await functions.listVariables({ functionId: "mio-sms" });
  for (const variable of variables) {
    const previous = existing.variables.find(value => value.key === variable.key);
    if (previous) await functions.updateVariable({ functionId: "mio-sms", variableId: previous.$id, ...variable });
    else await functions.createVariable({ functionId: "mio-sms", variableId: ID.unique(), ...variable });
    console.log(`Configured ${variable.key}${variable.secret ? " (secret)" : ""}`);
  }
} catch (error) {
  console.error("Beta configuration failed", { code: error.code ?? null, type: error.type ?? null }); process.exitCode = 1;
}
