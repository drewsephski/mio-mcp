import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import type { AgentRunner } from "../src/agent.ts";
import { createAgent } from "../src/agent.ts";
import { createSmsService } from "../src/service.ts";
import { localToInstant, reminderTimes } from "../src/time.ts";
import { backend } from "./backend.ts";

type Action = { name: string; input: Record<string, unknown> } | string;
function scripted(context: TestContext) {
  const db = backend(context);
  let script: Action[] = [], aiCalls = 0, steps = 0;
  const model = new MockLanguageModelV3({ doGenerate: async () => {
    const action = script.shift(); steps++;
    if (!action) throw new Error("Missing mocked model step");
    return { content: typeof action === "string" ? [{ type: "text" as const, text: action }] : [{ type: "tool-call" as const, toolCallId: `call${steps}`, toolName: action.name, input: JSON.stringify(action.input) }],
      finishReason: { unified: typeof action === "string" ? "stop" as const : "tool-calls" as const, raw: undefined },
      usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
    };
  } });
  const luna = createAgent({ languageModel: model });
  let clock = new Date("2026-10-06T17:00:00Z"), sid = 0;
  const agent: AgentRunner = async input => { aiCalls++; return luna(input); };
  const config = { databaseId: "mio", providerId: "provider", phone: "+15550000002", agent, now: () => clock };
  const service = createSmsService(db.tables, db.users, db.messaging, config);
  const message = (text: string) => ({ AccountSid: `AC${"a".repeat(32)}`, MessageSid: `SM${(++sid).toString(16).padStart(32, "0")}`, From: "+15550000001", To: config.phone, Body: text, NumMedia: 0 });
  return { ...db, service, model, message, config,
    setScript: (actions: Action[]) => { script = [...actions]; }, calls: () => aiCalls,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
    async turn(text: string, actions: Action[]) { script = [...actions]; const sms = message(text); await service.inbound(sms); await service.work("owner"); return sms; },
  };
}
const action = (name: string, input: Record<string, unknown> = {}): Action => ({ name, input });

test("conversation creates, edits, searches and deletes the same logical note; replay cannot resurrect it", async context => {
  const f = scripted(context);
  const sms = await f.turn("Remember I need to update LaunchStack", [action("createNote", { title: "Update LaunchStack", body: "I need to update LaunchStack", project: "LaunchStack" }), "Got it — update LaunchStack."]);
  const noteId = f.rowsIn("notes")[0].$id;
  await f.turn("Actually make that Open Agents", [action("getNote", { noteId }), action("updateNote", { noteId, changes: { title: "Update Open Agents", body: "I need to update Open Agents", project: "Open Agents" } }), "Updated — Open Agents."]);
  assert.equal(f.rowsIn("notes").length, 1);
  assert.equal(f.rowsIn("notes")[0].body, "I need to update Open Agents");
  await f.turn("What did I say about Open Agents?", [action("searchNotes", { query: "Open Agents" }), "You wanted to update Open Agents."]);
  assert.equal(f.rowsIn("notes").length, 1);
  await f.turn("delete that note", [action("getNote", { noteId }), action("deleteNote", { noteId, reference: "that note" }), "Deleted that note."]);
  assert.equal(f.rowsIn("notes").length, 0);
  const calls = f.calls(); await f.service.inbound(sms); await f.service.work("owner"); assert.equal(f.calls(), calls);
  assert.equal(f.rowsIn("notes").length, 0);
  await assert.rejects(f.service.inbound({ ...sms, Body: "tampered" }), /identity mismatch/);
  assert.equal(f.rowsIn("sms_turns").length, 4);
  const prompt = f.model.doGenerateCalls.at(-1)!.prompt;
  assert.match(JSON.stringify(prompt), /Open Agents/);
});

test("work reminder correction replaces native schedule without another note; follow-up changes offset", async context => {
  const f = scripted(context);
  // Predictable tool IDs are obtained from the staged note via a separate
  // first model step, just as Luna sees the tool result in its next step.
  const { digest } = await import("../src/inbound.ts");
  const firstSid = `SM${"1".padStart(32, "0")}`;
  const noteId = `n_${digest(`${firstSid}:0`).slice(0, 32)}`;
  await f.turn("Remind me I have work at 4", [action("createNote", { title: "Work at 4:00 PM", body: "Work today at 4:00 PM" }),
    action("createReminder", { noteId, eventLocal: "2026-10-06T16:00", message: "Heading to work soon? You're scheduled for 4:00." }), "Work at 4:00 — I'll text you at 3:45."]);
  const first = f.rowsIn("reminders")[0], reminderId = first.$id, oldMessageId = String(first.messageId);
  assert.equal(first.eventAt, "2026-10-06T21:00:00Z"); assert.equal(first.remindAt, "2026-10-06T20:45:00Z");
  assert.equal(f.messages.get(oldMessageId)!.status, "scheduled");
  f.loseMessage();
  await f.turn("Actually work is at 4:30", [action("getReminder", { reminderId }), action("getNote", { noteId }),
    action("updateNote", { noteId, changes: { title: "Work at 4:30 PM", body: "Work today at 4:30 PM" } }),
    action("updateReminder", { reminderId, eventTime: "16:30", message: "Heading to work soon? You're scheduled for 4:30." }), "Updated — 4:30. I'll remind you at 4:15."]);
  const updated = f.rowsIn("reminders")[0];
  assert.equal(f.rowsIn("notes").length, 1); assert.equal(f.rowsIn("reminders").length, 1);
  assert.equal(updated.eventAt, "2026-10-06T21:30:00Z"); assert.equal(updated.remindAt, "2026-10-06T21:15:00Z");
  assert.ok(f.deletedMessages.includes(oldMessageId)); assert.ok(!f.messages.has(oldMessageId));
  assert.equal(f.messages.get(String(updated.messageId))!.scheduledAt, updated.remindAt);
  await f.turn("And remind me 20 minutes before", [action("getReminder", { reminderId }), action("updateReminder", { reminderId, offsetMinutes: 20 }), "I'll text you at 4:10."]);
  assert.equal(f.rowsIn("reminders")[0].remindAt, "2026-10-06T21:10:00Z");
  assert.equal(f.rowsIn("reminders")[0].eventAt, "2026-10-06T21:30:00Z");
  await f.turn("cancel that reminder", [action("getReminder", { reminderId }), action("cancelReminder", { reminderId }), "Canceled that reminder."]);
  assert.equal(f.rowsIn("reminders")[0].status, "canceled");
  assert.ok(!f.messages.has(String(f.rowsIn("reminders")[0].messageId)));
});

test("tomorrow morning and make that 10 refer to one reminder using configured local dates", async context => {
  const f = scripted(context);
  await f.turn("remind me tomorrow morning", [action("createReminder", { eventLocal: "2026-10-07T09:00", offsetMinutes: 0, message: "Your morning reminder." }), "I'll text you tomorrow at 9 AM."]);
  const reminderId = f.rowsIn("reminders")[0].$id;
  await f.turn("make that 10 instead", [action("getReminder", { reminderId }), action("updateReminder", { reminderId, eventTime: "10:00" }), "Tomorrow at 10 AM — updated."]);
  assert.equal(f.rowsIn("reminders").length, 1);
  assert.equal(f.rowsIn("reminders")[0].eventAt, "2026-10-07T15:00:00Z");
  assert.equal(f.rowsIn("reminders")[0].remindAt, "2026-10-07T15:00:00Z");
});

test("Shiplog thought create, daily correction, retrieval and deletion preserve references", async context => {
  const f = scripted(context);
  await f.turn("Remember I want Shiplog to make weekly recaps.", [action("createNote", { title: "Shiplog recaps", body: "I want Shiplog to make weekly recaps." }), "Saved that Shiplog idea."]);
  const noteId = f.rowsIn("notes")[0].$id;
  await f.turn("Actually make that daily.", [action("getNote", { noteId }), action("updateNote", { noteId, changes: { body: "I want Shiplog to make daily recaps." } }), "Daily recaps — updated."]);
  await f.turn("What did I say about Shiplog?", [action("searchNotes", { query: "Shiplog" }), "You want Shiplog to make daily recaps."]);
  assert.equal(f.rowsIn("notes").length, 1);
  await f.turn("Delete that note.", [action("getNote", { noteId }), action("deleteNote", { noteId, reference: "that note" }), "Deleted it."]);
  assert.equal(f.rowsIn("notes").length, 0);
});

test("ambiguous named notes ask a clarification and make no mutation", async context => {
  const f = scripted(context);
  f.seed("notes", "work1", { ownerId: "owner", title: "Work at 4:30", body: "work", archived: false });
  f.seed("notes", "work2", { ownerId: "owner", title: "Finish work dashboard", body: "work", archived: false });
  await f.turn("Delete the work note", [action("searchNotes", { query: "work" }), action("deleteNote", { noteId: "work1", reference: "work" }), "Which one — Work at 4:30 or Finish work dashboard?"]);
  assert.equal(f.rowsIn("notes").length, 2);
  assert.match(String(f.rowsIn("sms_receipts")[0].reply), /Which one/);
});

test("concurrent duplicate Twilio deliveries enqueue once and only one AI turn commits", async context => {
  const f = scripted(context);
  const sms = f.message("Remember the build");
  f.setScript([action("createNote", { title: "Build", body: "Remember the build" }), "Saved."]);
  await Promise.all([f.service.inbound(sms), f.service.inbound(sms)]);
  await Promise.all([f.service.work("owner"), f.service.work("owner")]);
  await f.service.inbound(sms);
  assert.equal(f.rowsIn("sms_jobs").length, 1); assert.equal(f.rowsIn("notes").length, 1);
  assert.equal(f.calls(), 1); assert.equal(f.rowsIn("sms_receipts").length, 1);
});

test("lost transaction and Messaging responses reconcile instead of replaying tools", async context => {
  const f = scripted(context); f.loseCommit(); f.loseMessage();
  const sms = await f.turn("Remember deployment", [action("createNote", { title: "Deployment", body: "Remember deployment" }), "Saved."]);
  await f.service.inbound(sms); await f.service.work("owner");
  assert.equal(f.calls(), 1); assert.equal(f.rowsIn("notes").length, 1);
  assert.equal(f.messages.size, 1); assert.equal(f.rowsIn("sms_receipts")[0].replyQueued, true);
});

test("model failure after staged mutation rolls back; retries never duplicate actions", async context => {
  const f = scripted(context);
  const sms = await f.turn("Remember deployment", [action("createNote", { title: "Deployment", body: "Remember deployment" })]);
  assert.equal(f.rowsIn("notes").length, 0); assert.equal(f.rowsIn("sms_receipts").length, 0);
  await f.service.inbound(sms); assert.equal(f.rowsIn("sms_jobs").length, 1);
  f.advance(120_000); f.setScript([action("createNote", { title: "Deployment", body: "Remember deployment" }), "Saved."]);
  await f.service.work("owner");
  assert.equal(f.rowsIn("notes").length, 1); assert.equal(f.calls(), 2);
});

test("terminal provider outage responds honestly with no partial notes", async context => {
  const f = scripted(context);
  await f.turn("Remember this", []);
  for (let attempt = 0; attempt < 2; attempt++) { f.advance(180_000); await f.service.work("owner"); }
  assert.equal(f.rowsIn("notes").length, 0); assert.equal(f.rowsIn("sms_jobs")[0].status, "failed");
  assert.match(String(f.rowsIn("sms_receipts")[0].reply), /Nothing was changed/);
});

test("tools independently reject foreign ownership, unread mutations and attachment deletion", async context => {
  const f = scripted(context);
  f.seed("notes", "foreign", { ownerId: "other", title: "Private", body: "secret" });
  f.seed("notes", "own", { ownerId: "owner", title: "Own", body: "text" });
  await f.turn("update this", [action("getNote", { noteId: "foreign" }), action("updateNote", { noteId: "own", changes: { body: "changed" } }), "I need to identify your note first."]);
  assert.equal(f.rows.get("notes:foreign")!.body, "secret"); assert.equal(f.rows.get("notes:own")!.body, "text");
  f.seed("attachments", "attachment", { ownerId: "owner", noteId: "own" });
  await f.turn("delete own", [action("getNote", { noteId: "own" }), action("deleteNote", { noteId: "own", reference: "own" }), "That has an attachment. Delete it in Mio or ask me to archive it."]);
  assert.ok(f.rows.has("notes:own"));
});

test("storage failure inside an SDK tool invalidates the whole turn", async context => {
  const f = scripted(context); f.failStorage(true);
  await f.turn("Remember", [action("createNote", { title: "Failed", body: "Failed" }), "Saved."]);
  assert.equal(f.rowsIn("notes").length, 0); assert.equal(f.rowsIn("sms_receipts").length, 0);
});

test("disconnect cancels native reminders, blocks pending jobs and prevents private replies", async context => {
  const f = scripted(context);
  await f.turn("remind me tomorrow at 10", [action("createReminder", { eventLocal: "2026-10-07T10:00", offsetMinutes: 0, message: "Reminder" }), "Tomorrow at 10."]);
  const messageId = String(f.rowsIn("reminders")[0].messageId);
  await f.service.inbound(f.message("Later thought"));
  await f.service.disconnect("owner"); await f.service.work("owner");
  assert.ok(!f.messages.has(messageId)); assert.equal(f.rowsIn("reminders")[0].status, "canceled");
  assert.equal(f.rowsIn("sms_jobs").at(-1)!.status, "revoked"); assert.equal(f.calls(), 1);
});

test("rescheduling a message already processing does not create a second outgoing reminder", async context => {
  const f = scripted(context);
  await f.turn("remind me tomorrow at 10", [action("createReminder", { eventLocal: "2026-10-07T10:00", offsetMinutes: 0, message: "Reminder" }), "Tomorrow at 10."]);
  const reminder = f.rowsIn("reminders")[0]; f.messages.get(String(reminder.messageId))!.status = "processing";
  await f.turn("make that 11", [action("getReminder", { reminderId: reminder.$id }), action("updateReminder", { reminderId: reminder.$id, eventTime: "11:00" }), "Updated to 11."]);
  assert.equal(f.rowsIn("reminders")[0].status, "failed");
  assert.equal([...f.messages.values()].filter(message => message.data.content === "Reminder").length, 1);
  assert.match(String(f.rowsIn("sms_receipts").at(-1)!.reply), /couldn't confirm/);
});

test("Messaging outage delays confirmation; recovery schedules exactly one reminder", async context => {
  const f = scripted(context); f.failMessages(true);
  await f.turn("remind me tomorrow", [action("createReminder", { eventLocal: "2026-10-07T10:00", message: "Reminder" }), "Tomorrow at 10 — I'll text at 9:45."]);
  assert.equal(f.rowsIn("sms_receipts")[0].replyQueued, false);
  f.failMessages(false); await f.service.work("owner");
  assert.equal(f.rowsIn("sms_receipts")[0].replyQueued, true);
  assert.equal([...f.messages.values()].filter(message => message.status === "scheduled").length, 1);
});

test("timezone conversion uses IANA rules, crosses DST correctly and rejects gaps/overlaps", () => {
  assert.equal(localToInstant("2026-10-06T16:30", "America/Chicago"), "2026-10-06T21:30:00Z");
  assert.equal(localToInstant("2026-12-06T16:30", "America/Chicago"), "2026-12-06T22:30:00Z");
  assert.equal(localToInstant("2026-10-07T10:00", "Asia/Kolkata"), "2026-10-07T04:30:00Z");
  assert.throws(() => localToInstant("2026-03-08T02:30", "America/Chicago"));
  assert.throws(() => localToInstant("2026-11-01T01:30", "America/Chicago"));
  const before = reminderTimes("2026-03-08T03:10", "America/Chicago", 30);
  assert.equal(before.eventAt, "2026-03-08T08:10:00Z"); assert.equal(before.remindAt, "2026-03-08T07:40:00Z");
  assert.throws(() => reminderTimes("2026-10-07T10:00", "America/Chicago", 0, "2026-10-07T11:00"));
});

test("different SMS turns run in arrival order and load the committed previous entity", async context => {
  const f = scripted(context);
  await f.service.inbound(f.message("Remember LaunchStack"));
  await f.service.inbound(f.message("Actually Open Agents"));
  f.setScript([action("createNote", { title: "LaunchStack", body: "LaunchStack" }), "Saved."]);
  await f.service.work("owner");
  const noteId = f.rowsIn("notes")[0].$id;
  f.setScript([action("getNote", { noteId }), action("updateNote", { noteId, changes: { title: "Open Agents", body: "Open Agents" } }), "Updated."]);
  await f.service.work("owner");
  assert.equal(f.rowsIn("notes").length, 1); assert.equal(f.rowsIn("notes")[0].body, "Open Agents");
  assert.equal(f.rowsIn("sms_turns").length, 2);
});

test("a stale owner lease cannot commit staged model writes", async context => {
  const db = backend(context);
  const service = createSmsService(db.tables, db.users, db.messaging, { databaseId: "mio", providerId: "provider", phone: "+15550000002",
    agent: async input => {
      await input.tools.createNote.execute!({ title: "Stale", body: "Stale" }, { toolCallId: "stale", messages: [], abortSignal: input.signal, context: undefined });
      await db.tables.updateRow({ databaseId: "mio", tableId: "sms_conversations", rowId: "owner", data: { leaseToken: "replacement-owner-lease" } });
      return "Saved.";
    } });
  await service.inbound({ AccountSid: `AC${"a".repeat(32)}`, MessageSid: `SM${"c".repeat(32)}`, From: "+15550000001", To: "+15550000002", Body: "Remember this", NumMedia: 0 });
  await service.work("owner");
  assert.equal(db.rowsIn("notes").length, 0); assert.equal(db.rowsIn("sms_receipts").length, 0);
  assert.equal(db.rows.get("sms_conversations:owner")!.leaseToken, "replacement-owner-lease");
});

test("a time-only correction preserves tomorrow and date changes require the user's words", async context => {
  const f = scripted(context);
  await f.turn("Remind me work tomorrow at 4", [action("createReminder", { eventLocal: "2026-10-07T16:00", message: "Work soon" }), "Tomorrow at 4."]);
  const reminderId = f.rowsIn("reminders")[0].$id;
  await f.turn("Actually 4:30", [action("getReminder", { reminderId }), action("updateReminder", { reminderId, eventTime: "16:30" }), "Tomorrow at 4:30."]);
  assert.equal(f.rowsIn("reminders")[0].eventAt, "2026-10-07T21:30:00Z");
  await f.turn("make that 5", [action("getReminder", { reminderId }), action("updateReminder", { reminderId, eventDate: "2026-10-06", dateReference: "today" }), "The day is still tomorrow."]);
  assert.equal(f.rowsIn("reminders")[0].eventAt, "2026-10-07T21:30:00Z");
  await f.turn("make that Friday", [action("getReminder", { reminderId }), action("updateReminder", { reminderId, eventDate: "2026-10-09", dateReference: "Friday" }), "Friday at 4:30."]);
  assert.equal(f.rowsIn("reminders")[0].eventAt, "2026-10-09T21:30:00Z");
});

test("production worker cannot send Cloud verifier draft receipts", async context => {
  const f = scripted(context);
  f.seed("sms_receipts", `SM${"d".repeat(32)}`, { ownerId: "owner", phone: "+15550000001", targetId: "target", reply: "Verification only", replyQueued: false, deliveryMode: "draft" });
  await f.service.retryReplies(); assert.equal(f.messages.size, 0);
});

test("malformed model tool input rolls back earlier valid actions and never confirms them", async context => {
  const f = scripted(context);
  await f.turn("Remember work and remind me", [action("createNote", { title: "Work", body: "Work" }),
    action("createReminder", { eventLocal: "4pm", message: "Work" }), "Saved and scheduled."]);
  assert.equal(f.rowsIn("notes").length, 0); assert.equal(f.rowsIn("reminders").length, 0);
  assert.equal(f.rowsIn("sms_receipts").length, 0);
});

test("web deletion of a linked note cancels its native reminder on reconciliation", async context => {
  const f = scripted(context);
  const { digest } = await import("../src/inbound.ts");
  const noteId = `n_${digest(`SM${"1".padStart(32, "0")}:0`).slice(0, 32)}`;
  await f.turn("Remember work tomorrow", [action("createNote", { title: "Work", body: "Work tomorrow" }),
    action("createReminder", { noteId, eventLocal: "2026-10-07T16:00", message: "Work soon" }), "Tomorrow at 4."]);
  const reminder = f.rowsIn("reminders")[0];
  await f.tables.deleteRow({ databaseId: "mio", tableId: "notes", rowId: noteId });
  await f.service.work("owner");
  assert.equal(f.rowsIn("reminders")[0].status, "canceled"); assert.ok(!f.messages.has(String(reminder.messageId)));
});

test("a delivered reminder remains sent when its linked note is later deleted", async context => {
  const f = scripted(context);
  const { digest } = await import("../src/inbound.ts");
  const noteId = `n_${digest(`SM${"1".padStart(32, "0")}:0`).slice(0, 32)}`;
  await f.turn("Remember work tomorrow", [action("createNote", { title: "Work", body: "Work tomorrow" }),
    action("createReminder", { noteId, eventLocal: "2026-10-07T16:00", message: "Work soon" }), "Tomorrow at 4."]);
  const reminder = f.rowsIn("reminders")[0]; f.messages.get(String(reminder.messageId))!.status = "sent";
  await f.tables.deleteRow({ databaseId: "mio", tableId: "notes", rowId: noteId });
  await f.service.work("owner"); assert.equal(f.rowsIn("reminders")[0].status, "sent");
  assert.ok(f.messages.has(String(reminder.messageId)));
});

test("STOP racing with native activation cannot resurrect a reminder or send its confirmation", async context => {
  const f = scripted(context);
  const activate = f.messaging.updateSMS.bind(f.messaging);
  context.mock.method(f.messaging, "updateSMS", async (params: { messageId: string; draft?: boolean; scheduledAt?: string }) => {
    await f.service.disconnect("owner"); return activate(params);
  });
  await f.turn("Remind me tomorrow", [action("createReminder", { eventLocal: "2026-10-07T16:00", message: "Private reminder" }), "Tomorrow at 4."]);
  assert.equal(f.rowsIn("reminders")[0].status, "canceled");
  assert.equal(f.messages.size, 0); assert.equal(f.rowsIn("sms_receipts")[0].replyQueued, true);
});

test("revocation also suppresses a replacement failure reply after a message starts processing", async context => {
  const f = scripted(context);
  const activate = f.messaging.updateSMS.bind(f.messaging);
  context.mock.method(f.messaging, "updateSMS", async (params: { messageId: string; draft?: boolean; scheduledAt?: string }) => {
    const result = await activate(params);
    f.messages.get(params.messageId)!.status = "processing";
    await f.service.disconnect("owner"); return result;
  });
  await f.turn("Remind me tomorrow", [action("createReminder", { eventLocal: "2026-10-07T16:00", message: "Private reminder" }), "Tomorrow at 4."]);
  assert.equal(f.rowsIn("reminders")[0].status, "failed");
  assert.equal(f.messages.size, 1); assert.equal([...f.messages.values()][0].status, "processing");
  assert.equal(f.rowsIn("sms_receipts")[0].replyQueued, true);
});

test("a model reply cannot expose a retrieved web note UUID", async context => {
  const f = scripted(context);
  const noteId = "dfd145a4-fbad-421e-b60a-ad2136de7551";
  f.seed("notes", noteId, { ownerId: "owner", title: "Idea", body: "Thought" });
  await f.turn("What was that idea?", [action("getNote", { noteId }), `Your note ID is ${noteId}.`]);
  assert.equal(f.rowsIn("sms_receipts").length, 0); assert.equal(f.messages.size, 0);
});
