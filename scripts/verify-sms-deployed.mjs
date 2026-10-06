import assert from "node:assert/strict";
import { randomBytes, createHmac } from "node:crypto";
import { loadEnvFile } from "node:process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { AppwriteException, Client, Functions, Messaging, Query, TablesDB } from "node-appwrite";
import { localNow, localToInstant } from "../functions/mio-sms/src/time.ts";

// Explicit opt-in: this verifier sends real SMS to the currently bound account.
// It simulates signed Twilio callbacks; it does not claim handset origination.
loadEnvFile(".env.local"); loadEnvFile(".env.provisioning");
const config = JSON.parse(readFileSync("appwrite.config.json", "utf8"));
const client = new Client().setEndpoint(config.endpoint).setProject(config.projectId).setKey(process.env.APPWRITE_PROVISIONING_KEY);
const tables = new TablesDB(client), messaging = new Messaging(client), functions = new Functions(client);
const resource = (tableId, rowId) => ({ databaseId: "mio", tableId, rowId });
const evidence = { startedAt: new Date().toISOString(), callbacks: [], checks: [], reminderIds: [], noteIds: [], carrier: [] };
const fixtureNotes = new Set(), fixtureReminders = new Set();
const marker = `MioVerification${randomBytes(4).toString("hex")}`;
let connection;
function pass(label) { evidence.checks.push(label); console.log(`PASS ${label}`); }
async function absent(operation) { await assert.rejects(operation, error => error instanceof AppwriteException && error.code === 404, "Expected deleted fixture entity/message"); }
try {
  const deployed = await functions.get({ functionId: "mio-sms" });
  assert.equal(deployed.latestDeploymentStatus, "ready");
  assert.equal(deployed.vars.find(variable => variable.key === "MIO_AI_MODEL")?.value, "openai/gpt-5.6-luna");
  assert.ok(deployed.vars.some(variable => variable.key === "OPENROUTER_API_KEY" && variable.secret));
  const connections = await tables.listRows({ databaseId: "mio", tableId: "sms_connections", queries: [Query.limit(2)] });
  assert.equal(connections.total, 1, "This verifier requires exactly one existing connected account");
  connection = connections.rows[0];
  console.log("Deployed assistant ready; one verified connection exists.");
  if (!process.argv.includes("--send")) {
    console.log("Use --send for signed callback simulation and real outgoing SMS acceptance.");
  } else {
    const provider = await messaging.getProvider({ providerId: deployed.vars.find(variable => variable.key === "APPWRITE_SMS_PROVIDER_ID").value });
    const webhookUrl = deployed.vars.find(variable => variable.key === "TWILIO_WEBHOOK_URL").value;
    const { accountSid, authToken } = provider.credentials;
    const outboundStart = Date.now();
    async function turn(text) {
      const MessageSid = `SM${randomBytes(16).toString("hex")}`;
      const params = { AccountSid: accountSid, MessageSid, From: connection.phone, To: provider.options.from, Body: text, NumMedia: "0" };
      const signature = createHmac("sha1", authToken).update(webhookUrl + Object.keys(params).sort().map(key => key + params[key]).join("")).digest("base64");
      const response = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": signature }, body: new URLSearchParams(params), signal: AbortSignal.timeout(12_000) });
      assert.equal(response.status, 200, "Validated webhook must acknowledge durably accepted turn");
      const deadline = Date.now() + 180_000;
      let receipt;
      while (Date.now() < deadline) {
        try { receipt = await tables.getRow(resource("sms_receipts", MessageSid)); } catch (error) { if (error.code !== 404) throw error; }
        if (receipt?.replyQueued) break;
        await setTimeout(2000);
      }
      assert.ok(receipt?.replyQueued, "Deployed turn must finish and queue its reply");
      const history = await tables.getRow(resource("sms_turns", MessageSid));
      for (const id of history.noteIds) fixtureNotes.add(id);
      for (const id of history.reminderIds) fixtureReminders.add(id);
      evidence.callbacks.push({ sid: MessageSid, replyQueued: true });
      return { receipt, history };
    }
    if (!process.argv.includes("--proactive-only")) {
    const first = await turn(`Remember I want Shiplog to make weekly recaps for ${marker}.`);
    const noteId = first.history.noteIds[0]; assert.ok(noteId);
    await turn("Actually make that daily.");
    const edited = await tables.getRow(resource("notes", noteId));
    assert.match(edited.body, /daily/i, "Follow-up must edit the original note");
    const retrieved = await turn(`What did I say about ${marker}?`);
    assert.match(retrieved.receipt.reply, /daily/i, "Retrieval must reflect the edit");
    await turn("Delete that note."); await absent(() => tables.getRow(resource("notes", noteId)));
    pass("Deployed Luna create → edit → retrieve → delete uses one note");
    const conversation = await tables.getRow(resource("sms_conversations", connection.ownerId));
    const day = localNow(new Date(), conversation.timezone).slice(0, 10);
    const tomorrow = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const work = await turn(`Remind me I have ${marker} work tomorrow at 4 PM.`);
    const reminderId = work.history.reminderIds[0], workNoteId = work.history.noteIds[0];
    const original = await tables.getRow(resource("reminders", reminderId));
    await turn("Actually work is at 4:30.");
    const changed = await tables.getRow(resource("reminders", reminderId));
    assert.equal(Date.parse(changed.eventAt), Date.parse(localToInstant(`${tomorrow}T16:30`, conversation.timezone)), "Event time must use user timezone");
    assert.equal(Date.parse(changed.remindAt), Date.parse(localToInstant(`${tomorrow}T16:15`, conversation.timezone)), "Default notification offset must be preserved");
    assert.notEqual(changed.messageId, original.messageId);
    await absent(() => messaging.getMessage({ messageId: original.messageId }));
    const schedule = await messaging.getMessage({ messageId: changed.messageId }); assert.equal(schedule.status, "scheduled");
    assert.equal(Date.parse(schedule.scheduledAt), Date.parse(changed.remindAt));
    const workNote = await tables.getRow(resource("notes", workNoteId)); assert.match(`${workNote.title} ${workNote.body}`, /4:30|16:30/);
    await turn("And remind me 20 minutes before.");
    const offset = await tables.getRow(resource("reminders", reminderId)); assert.equal(Date.parse(offset.remindAt), Date.parse(localToInstant(`${tomorrow}T16:10`, conversation.timezone)));
    await turn("Cancel that reminder.");
    const canceled = await tables.getRow(resource("reminders", reminderId)); assert.equal(canceled.status, "canceled");
    await absent(() => messaging.getMessage({ messageId: offset.messageId }));
    pass("Deployed work correction updates the same note/reminder, replaces native schedule, preserves offset and cancels");
    }
    // A near-term task reminder proves native scheduler/provider delivery.
    const soon = await turn(`Remind me in 3 minutes to check the ${marker} deployment.`);
    const soonId = soon.history.reminderIds[0];
    const active = await tables.getRow(resource("reminders", soonId));
    assert.equal(active.status, "scheduled");
    evidence.proactiveMessageId = active.messageId; evidence.remindAt = active.remindAt;
    pass("Native proactive SMS scheduled; waiting for provider acceptance");
    const dueDeadline = Math.min(Date.parse(active.remindAt) + 120_000, Date.now() + 360_000);
    let delivered;
    while (Date.now() < dueDeadline) {
      delivered = await messaging.getMessage({ messageId: active.messageId });
      if (["sent", "success", "failed"].includes(delivered.status)) break;
      await setTimeout(3000);
    }
    assert.ok(["sent", "success"].includes(delivered.status), "Scheduled proactive message must be accepted by Appwrite/Twilio");
    pass("Native proactive SMS reached sent status");
    const auth = { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` };
    const query = new URLSearchParams({ To: connection.phone, From: provider.options.from, PageSize: "100" });
    let carrier;
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json?${query}`, { headers: auth });
      assert.equal(response.status, 200);
      const result = await response.json();
      carrier = result.messages.find(message => message.body === active.message && Date.parse(message.date_created) >= outboundStart);
      if (carrier?.status === "delivered") break;
      await setTimeout(3000);
    }
    assert.equal(carrier?.status, "delivered", "Twilio must report delivered for proactive SMS");
    evidence.carrier.push({ sid: carrier.sid, status: carrier.status, errorCode: carrier.error_code });
    pass("Twilio reports proactive SMS delivered; handset observation remains separate");
    evidence.success = true;
  }
} catch (error) {
  console.error("Deployed SMS verification failed", { code: error.code ?? null, type: error.type ?? null, check: error instanceof assert.AssertionError ? error.message : "request failed" });
  evidence.success = false; process.exitCode = 1;
} finally {
  // Only exact note IDs created by this verifier are cleaned up. Receipts,
  // turns and reminder lifecycle rows stay durable for replay safety/evidence.
  // In case of failure, preserve active reminders for inspection rather than
  // making an ambiguous cancellation or deleting Messaging delivery IDs.
  evidence.noteIds = [...fixtureNotes]; evidence.reminderIds = [...fixtureReminders];
  if (evidence.success) for (const noteId of fixtureNotes) {
    try {
      const note = await tables.getRow(resource("notes", noteId));
      if (note.ownerId === connection.ownerId && `${note.title} ${note.body}`.includes(marker)) await tables.deleteRow(resource("notes", noteId));
    } catch (error) { if (error.code !== 404) { evidence.cleanupFailed = true; process.exitCode = 1; } }
  }
  mkdirSync(".workflow", { recursive: true });
  writeFileSync(".workflow/sms-assistant-live.json", JSON.stringify(evidence, null, 2));
}
