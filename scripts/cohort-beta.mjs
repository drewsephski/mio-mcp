import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseClient, safeFailure } from "./release/client.mjs";
import { prepareRelease } from "./prepare-release.mjs";
import { verifyRelease } from "./release/verify.mjs";
import { twilioReadiness } from "./twilio-readiness.mjs";
const requirements = ["isolation", "naturalConversation", "ambiguousReferences", "schedule", "edit", "cancellation", "nearSendRejection", "handsetDelivery", "stop", "reconnect", "quietHours", "timezones", "inboundLimit", "hourlyAiLimit", "dailyAiLimit", "outboundLimit", "activeReminderLimit", "globalBreaker", "operatorDenial", "emailDelivery"];
try {
  const ctx = releaseClient();
  const evidence = JSON.parse(readFileSync(process.env.MIO_COHORT_EVIDENCE ?? ".workflow/cohort-acceptance.json", "utf8"));
  assert.equal(evidence.users?.length, 2, "Exactly two cohort identities are required");
  assert.notEqual(evidence.users[0].userId, evidence.users[1].userId, "Separate accounts required");
  const phones = [];
  for (const identity of evidence.users) {
    const user = await ctx.users.get({ userId: identity.userId });
    assert.ok(user.status && user.emailVerification && (process.env.MIO_INVITE_EMAILS ?? "").split(",").map(x=>x.trim().toLowerCase()).includes(user.email.toLowerCase()), "Cohort identity must be verified and invited");
    const connection = await ctx.tables.getRow({ databaseId:"mio",tableId:"sms_connections",rowId:identity.userId });
    assert.equal(connection.ownerId, user.$id); phones.push(connection.phone);
  }
  assert.notEqual(phones[0], phones[1], "Separate connected phones required");
  const fn = await ctx.functions.get({functionId:"mio-sms"}), site=await ctx.sites.get({siteId:"mio-web"});
  const siteUrl=site.vars.find(v=>v.key==="APP_URL").value;
  await verifyRelease(ctx,prepareRelease(),siteUrl,process.env.MIO_OPERATIONS_TOKEN);
  await twilioReadiness(ctx,fn.vars.find(v=>v.key==="TWILIO_WEBHOOK_URL").value,siteUrl);
  for(const key of requirements) for(const identity of evidence.users) {
    const item = identity.checks?.[key];
    assert.ok(item?.result==="pass" && item.observer && Number.isFinite(Date.parse(item.observedAt)), `Missing human acceptance: ${key}`);
  }
  console.log("PASS release, provider routing, two distinct accounts/phones, and complete operator-attested acceptance. Handset assertions are human evidence, not API observations.");
} catch(e) {console.error(safeFailure(e));process.exitCode=1;}
