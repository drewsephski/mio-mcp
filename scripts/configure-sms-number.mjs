import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { Client, Messaging } from "node-appwrite";

loadEnvFile(".env.local"); loadEnvFile(".env.provisioning");
const providerId = process.env.APPWRITE_SMS_PROVIDER_ID ?? "6ac51435002ef67f3ecd";
const webhook = new URL(process.env.MIO_SMS_WEBHOOK_URL ?? "https://6ac51b26002d1520c40d.appwrite.network/inbound");
assert.equal(webhook.protocol, "https:"); assert.equal(webhook.pathname, "/inbound"); assert.equal(webhook.search, "");
const client = new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_PROVISIONING_KEY);
try {
  const provider = await new Messaging(client).getProvider({ providerId });
  assert.equal(provider.provider, "twilio"); assert.equal(provider.enabled, true);
  const { accountSid, authToken } = provider.credentials;
  assert.ok(accountSid && authToken && provider.options.from);
  const headers = { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
  const list = await fetch(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(provider.options.from)}`, { headers });
  assert.equal(list.status, 200);
  const numbers = (await list.json()).incoming_phone_numbers;
  const number = numbers.find(entry => entry.phone_number === provider.options.from);
  assert.ok(number?.capabilities.sms);
  const requested = `${webhook.href}#rc=3&rp=ct,rt,5xx`;
  assert.ok(["https://api.vapi.ai/twilio/sms", webhook.href, requested].includes(number.sms_url), "Unexpected existing SMS route; inspect before changing it.");
  console.log({ phone: number.phone_number, currentSmsUrl: number.sms_url, plannedSmsUrl: requested, preservedVoiceUrl: number.voice_url });
  if (!process.argv.includes("--apply")) process.exit(0);
  mkdirSync(".workflow", { recursive: true });
  if (number.sms_url === "https://api.vapi.ai/twilio/sms") writeFileSync(".workflow/twilio-sms-route-before.json", JSON.stringify({ sid: number.sid, phone: number.phone_number, smsUrl: number.sms_url, smsMethod: number.sms_method, voiceUrl: number.voice_url, voiceMethod: number.voice_method, statusCallback: number.status_callback }, null, 2), { mode: 0o600 });
  const response = await fetch(`${base}/IncomingPhoneNumbers/${number.sid}.json`, { method: "POST", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ SmsUrl: requested, SmsMethod: "POST" }) });
  assert.equal(response.status, 200);
  const updated = await response.json();
  for (const key of ["voice_url", "voice_method", "voice_application_sid", "status_callback"]) assert.equal(updated[key], number[key], `${key} must remain unchanged`);
  assert.equal(updated.sms_url, requested);
  console.log("Updated only the inbound SMS route. Vapi voice and status callback are unchanged; unconnected SMS is forwarded to Vapi by Mio.");
} catch (error) {
  console.error({ code: error.code ?? null, type: error.type ?? null, message: error instanceof assert.AssertionError ? error.message : "Provider configuration failed" });
  process.exitCode = 1;
}
