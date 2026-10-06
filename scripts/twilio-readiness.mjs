import { readFileSync } from "node:fs";
import { Messaging } from "node-appwrite";
export const prerequisites = ["dedicatedNumber", "messagingService", "inboundWebhook", "advancedOptOut", "a2pApprovedWhereRequired", "privacyLive", "termsLive", "smsTermsLive", "supportContact", "spendingAlerts"];
export async function twilioReadiness(ctx, webhook, siteUrl, { enforce = true } = {}) {
  let attestation;
  try { attestation = JSON.parse(readFileSync(process.env.MIO_LAUNCH_ATTESTATION ?? ".workflow/twilio-launch.json", "utf8")); }
  catch { attestation = {}; }
  const checks = Object.fromEntries(prerequisites.map(k => [k, { operatorConfirmed: attestation.checks?.[k] === true, verifiedByApplication: false }]));
  const fn = await ctx.functions.get({ functionId: "mio-sms" });
  const vars = Object.fromEntries(fn.vars.filter(x => !x.secret).map(x => [x.key, x.value]));
  const provider = await new Messaging(ctx.client).getProvider({ providerId: vars.APPWRITE_SMS_PROVIDER_ID });
  if (!provider.enabled || provider.provider !== "twilio" || provider.options.from !== vars.MIO_PHONE_NUMBER) throw new Error("Appwrite SMS provider routing mismatch");
  const auth = { Authorization: `Basic ${Buffer.from(`${provider.credentials.accountSid}:${provider.credentials.authToken}`).toString("base64")}` };
  const base = `https://api.twilio.com/2010-04-01/Accounts/${provider.credentials.accountSid}`;
  const response = await fetch(`${base}/IncomingPhoneNumbers.json?${new URLSearchParams({ PhoneNumber: vars.MIO_PHONE_NUMBER })}`, { headers: auth, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Twilio number inspection failed");
  const number = (await response.json()).incoming_phone_numbers.find(n => n.phone_number === vars.MIO_PHONE_NUMBER);
  const dedicated = !!number?.capabilities.sms && attestation.numberSid === number.sid && attestation.dedicatedSmsOnExistingNumber === true;
  checks.dedicatedNumber.verifiedByApplication = dedicated;
  checks.inboundWebhook.verifiedByApplication = number?.sms_url?.split("#")[0] === webhook;
  let serviceFound = false;
  if (/^MG[a-f0-9]{32}$/i.test(attestation.messagingServiceSid ?? "")) {
    const serviceResponse = await fetch(`https://messaging.twilio.com/v1/Services/${attestation.messagingServiceSid}/PhoneNumbers`, { headers: auth, signal: AbortSignal.timeout(15_000) });
    if (!serviceResponse.ok) throw new Error("Twilio Messaging Service inspection failed");
    serviceFound = (await serviceResponse.json()).phone_numbers.some(p => p.sid === number?.sid);
    const serviceDetails = await fetch(`https://messaging.twilio.com/v1/Services/${attestation.messagingServiceSid}`, { headers: auth, signal: AbortSignal.timeout(15_000) });
    if (!serviceDetails.ok) throw new Error("Messaging Service routing inspection failed");
    const service = await serviceDetails.json();
    checks.inboundWebhook.verifiedByApplication = service.use_inbound_webhook_on_number ? checks.inboundWebhook.verifiedByApplication : service.inbound_request_url === webhook;
  }
  checks.messagingService.verifiedByApplication = serviceFound;
  for (const [key, path] of [["privacyLive", "/privacy"], ["termsLive", "/terms"], ["smsTermsLive", "/sms-terms"]]) {
    const page = await fetch(new URL(path, siteUrl), { signal: AbortSignal.timeout(15_000), redirect: "error" });
    checks[key].verifiedByApplication = page.ok;
  }
  const ready = prerequisites.every(k => checks[k].operatorConfirmed) && dedicated && serviceFound && checks.inboundWebhook.verifiedByApplication && ["privacyLive", "termsLive", "smsTermsLive"].every(k => checks[k].verifiedByApplication) && typeof attestation.confirmedAt === "string" && typeof attestation.confirmedBy === "string";
  const report = { ready, checkedAt: new Date().toISOString(), checks, providerStateIsOperatorAttested: ["advancedOptOut", "a2pApprovedWhereRequired", "supportContact", "spendingAlerts"] };
  if (enforce && !ready) { console.log(JSON.stringify(report, null, 2)); throw new Error("Twilio launch prerequisites remain unconfirmed or routing is inconsistent"); }
  return report;
}
